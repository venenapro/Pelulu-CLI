#!/usr/bin/env node
/**
 * XiaoZhi Coding Agent — CLI Entry Point
 * Usage: cd my-project && xcode
 */
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { loadConfig, saveConfig } from './core/config.js';
import { log, setDebug } from './core/logger.js';
import { bus } from './core/event-bus.js';
import { ToolRegistry } from './core/tool-registry.js';
import { Sandbox } from './core/sandbox.js';
import { SessionState } from './core/session.js';
import { Stats } from './core/stats.js';
import { buildSystemPrompt } from './core/system-prompt.js';
import { buildContext } from './core/context.js';
import { isDestructive, askConfirmation } from './core/confirm.js';
import { runWizard } from './core/wizard.js';
import { MqttClient } from './mcp/mqtt-client.js';
import { WssEndpoint } from './mcp/wss-endpoint.js';
import { PluginManager } from './plugins/manager.js';
import { REPL } from './repl.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const args = process.argv.slice(2);
if (args.includes('--debug')) setDebug(true);
if (args.includes('--wizard')) { /* force wizard */ }
const LIST_TOOLS = args.includes('--list-tools');

async function main() {
  // 1. Load config + wizard
  const config = await loadConfig(ROOT);

  // 2. Auto-detect CWD as workspace (like Claude Code, Gemini CLI, etc.)
  const cwd = process.cwd();
  config.agent = { ...config.agent, workspace: cwd };
  log('info', `Workspace: ${cwd}`);

  if (!config._wizard_done || args.includes('--wizard')) {
    await runWizard(ROOT);
  }

  // 3. Load tools
  const registry = new ToolRegistry();
  log('info', 'Loading tools...');
  await registry.loadBuiltins();

  // 4. Load plugins
  const plugins = new PluginManager(registry);
  await plugins.load();

  if (LIST_TOOLS) {
    const tools = registry.list();
    console.log('\n🔧 Tools:\n');
    for (const t of tools) console.log(`  ${t.name} — ${t.description} (${t.actions.join(', ')})`);
    console.log(`\n  ${tools.length} tools, ${tools.reduce((s, t) => s + t.actions.length, 0)} actions\n`);
    process.exit(0);
  }

  // 5. Initialize systems
  const sandbox = new Sandbox();
  const session = new SessionState();
  const stats = new Stats();

  // 6. Build context & system prompt
  const context = await buildContext();
  const systemPrompt = buildSystemPrompt(registry, config);
  log('info', `Context: ${context.split('\n').length} lines`);

  // 7. Connect to XiaoZhi
  const mqtt = new MqttClient(config);

  bus.on('activation:required', ({ code }) => {
    console.log('');
    console.log(`  ╔═════════════════════════════════════════════╗`);
    console.log(`  ║  🔐 Kode Aktivasi: ${String(code).padEnd(25)}║`);
    console.log(`  ║  🌐 https://xiaozhi.me                     ║`);
    console.log(`  ╚═════════════════════════════════════════════╝`);
    console.log('');
  });

  try {
    log('info', 'Connecting to XiaoZhi...');
    await mqtt.connect();
  } catch (e) {
    log('err', `Connection failed: ${e.message}`);
    process.exit(1);
  }

  // 8. Register MCP tool handler
  mqtt.registerToolHandler(
    async (name, args) => {
      const destructive = isDestructive(name, args);
      if (destructive.destructive) {
        const ok = await askConfirmation(name, args, destructive);
        if (!ok) return { isError: true, content: [{ type: 'text', text: 'Cancelled by user' }] };
      }
      sandbox.validate(name, args);
      const start = Date.now();
      log('tool', `🔧 ${name} → ${args.action || '-'}`);
      try {
        const result = await registry.call(name, args);
        stats.record(name, args.action, !result.isError, Date.now() - start);
        session.addToolCall(name, args, result);
        log('tool', result.isError ? `❌ ${result.content?.[0]?.text}` : `✅ OK`);
        bus.emit('tool:called', { name, result, args });
        return result;
      } catch (e) {
        stats.record(name, args.action, false, Date.now() - start, e.message);
        throw e;
      }
    },
    () => registry.toMcpTools()
  );

  // 9. Optional WSS endpoint
  let wss = null;
  if (config.mcp?.endpoint_url) {
    wss = new WssEndpoint(config.mcp.endpoint_url, () => registry.toMcpTools(), async (name, args) => {
      sandbox.validate(name, args);
      return registry.call(name, args);
    });
    wss.start();
  }

  // 10. Track conversation
  bus.on('user:text', (text) => session.addUserMessage(text));
  bus.on('llm:text', (text) => session.addAiMessage(text));

  // 11. Save config & start REPL
  await saveConfig(ROOT, config);
  const repl = new REPL(registry, mqtt, stats, session);
  repl.start();

  // Graceful shutdown
  const shutdown = async () => {
    log('info', 'Shutting down...');
    console.log(stats.formatReport());
    if (wss) wss.stop();
    await registry.shutdown();
    mqtt.disconnect();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(e => { log('err', `Fatal: ${e.message}`); process.exit(1); });
