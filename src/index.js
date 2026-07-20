#!/usr/bin/env node
/**
 * Pelulu CLI — Entry Point
 * Ink-based TUI with React components
 */
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';
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
import { handleError } from './core/error-handler.js';
import { withRetry } from './core/retry.js';
import { withSpinner } from './core/spinner.js';
import { Thinking } from './core/thinking.js';
import { autoFormat } from './core/auto-format.js';
import { FileTracker } from './core/file-tracker.js';
import { MqttClient } from './mcp/mqtt-client.js';
import { MessageSender } from './mcp/message-sender.js';
import { WssEndpoint } from './mcp/wss-endpoint.js';
import { PluginManager } from './plugins/manager.js';
import { checkForUpdates } from './core/update-checker.js';
import { renderUpdateNotification } from './tui/renderer.js';
import { startInkTUI } from './tui/ink-entry.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const args = process.argv.slice(2);
if (args.includes('--debug')) setDebug(true);
const LIST_TOOLS = args.includes('--list-tools');

async function main() {
  // Buffer ALL startup logs for Ink to display inside TUI
  const startupLogs = [];
  const origLog = console.log;
  const bufferLog = (...args) => startupLogs.push(args.join(' '));

  // 1. Load config
  const config = await loadConfig(ROOT);

  // 2. Check for updates — block if outdated
  const update = await checkForUpdates(ROOT);
  if (update.available) {
    renderUpdateNotification(update);
    process.exit(1);
  }

  // 3. Workspace & wizard
  const cwd = process.cwd();
  config.agent = { ...config.agent, workspace: cwd };
  if (!config._wizard_done || args.includes('--wizard')) {
    await runWizard(ROOT);
  }

  // Redirect console.log to buffer — everything after this goes into Ink
  console.log = bufferLog;

  // 4. Load tools
  const registry = new ToolRegistry();
  const pluginMgr = new PluginManager(registry);

  const { loaded } = await withSpinner('Loading tools...', async () => {
    return await registry.loadBuiltins();
  });
  await pluginMgr.load();
  const actions = registry.all().reduce((s, t) => s + (t.actions?.length || 0), 0);

  if (LIST_TOOLS) {
    console.log = origLog;
    const tools = registry.list();
    console.log('\nTools:\n');
    for (const t of tools) console.log(`  ${t.name} — ${t.description} (${t.actions.join(', ')})`);
    console.log(`\n  ${tools.length} tools, ${tools.reduce((s, t) => s + t.actions.length, 0)} actions\n`);
    process.exit(0);
  }

  // 5. Initialize systems
  const sandbox = new Sandbox();
  const session = new SessionState();
  const stats = new Stats();
  const thinking = new Thinking();
  const fileTracker = new FileTracker();

  // 6. Build context & system prompt
  const context = await buildContext();
  const systemPrompt = buildSystemPrompt(registry, config);

  // 7. Connect to XiaoZhi
  const mqtt = new MqttClient(config);

  bus.on('activation:required', ({ code }) => {
    startupLogs.push('');
    startupLogs.push(`  Kode Aktivasi: ${code}`);
    startupLogs.push(`  https://xiaozhi.me`);
    startupLogs.push('');
  });

  try {
    await withRetry(() => mqtt.connect(), { maxRetries: 2, delay: 2000 });
  } catch (e) {
    console.log = origLog;
    console.error(chalk.red(`\n  Connection failed: ${e.message}\n`));
    process.exit(1);
  }

  // 8. Message sender
  const sender = new MessageSender(mqtt);

  // 9. Register MCP tool handler
  mqtt.registerToolHandler(
    async (name, args) => {
      const destructive = isDestructive(name, args);
      if (destructive.destructive) {
        const ok = await askConfirmation(name, args, destructive);
        if (!ok) return { isError: true, content: [{ type: 'text', text: 'Cancelled by user' }] };
      }
      sandbox.validate(name, args);

      thinking.set('tool_call');
      const start = Date.now();
      try {
        const result = await registry.call(name, args);
        stats.record(name, args.action, !result.isError, Date.now() - start);
        session.addToolCall(name, args, result);

        if (name === 'file' && (args.action === 'write' || args.action === 'edit') && args.path) {
          autoFormat(args.path).catch(() => {});
        }

        thinking.set('idle');
        bus.emit('tool:called', { name, result, args });
        return result;
      } catch (e) {
        stats.record(name, args.action, false, Date.now() - start, e.message);
        thinking.set('idle');
        throw new Error(handleError(e));
      }
    },
    () => registry.toMcpTools()
  );

  // 10. Optional WSS endpoint
  let wss = null;
  if (config.mcp?.endpoint_url) {
    wss = new WssEndpoint(config.mcp.endpoint_url, () => registry.toMcpTools(), async (name, args) => {
      sandbox.validate(name, args);
      return registry.call(name, args);
    });
    wss.start();
  }

  // 11. Track conversation
  bus.on('user:text', (text) => session.addUserMessage(text));
  bus.on('llm:text', (text) => session.addAiMessage(text));

  // 12. Save config
  await saveConfig(ROOT, config);

  // 13. Start Ink TUI
  const { unmount, waitUntilExit } = startInkTUI({
    registry, mqtt, stats, session, bus, config,
    extras: { fileTracker, thinking, sender, autoFormat, startupLogs },
  });

  // Graceful shutdown
  const shutdown = async () => {
    unmount();
    if (wss) wss.stop();
    await registry.shutdown();
    mqtt.disconnect();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await waitUntilExit();
  await shutdown();
}

main().catch(e => {
  console.error(chalk.red(`\n  Fatal: ${handleError(e)}\n`));
  process.exit(1);
});
