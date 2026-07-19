#!/usr/bin/env node
/**
 * Pelulu CLI — Entry Point
 * Usage: cd my-project && pelulu
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
import { withRetry, isRetryable } from './core/retry.js';
import { withSpinner } from './core/spinner.js';
import { Thinking } from './core/thinking.js';
import { autoFormat } from './core/auto-format.js';
import { MqttClient } from './mcp/mqtt-client.js';
import { MessageSender } from './mcp/message-sender.js';
import { WssEndpoint } from './mcp/wss-endpoint.js';
import { PluginManager } from './plugins/manager.js';
import { REPL } from './repl.js';
import { checkForUpdates } from './core/update-checker.js';
import {
  renderUpdateNotification, renderUpdateError,
  renderBanner, renderInitLine, renderReady,
} from './tui/renderer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const args = process.argv.slice(2);
if (args.includes('--debug')) setDebug(true);
if (args.includes('--wizard')) { /* force wizard */ }
const LIST_TOOLS = args.includes('--list-tools');

async function main() {
  // 1. Load config
  const config = await loadConfig(ROOT);

  // 2. Check for updates
  const update = await checkForUpdates(ROOT);
  if (update.available) {
    renderUpdateNotification(update);
    const readline = await import('readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise(resolve => {
      rl.question(chalk.yellow('  ⏩ Lanjutkan tanpa update? (y/N): '), resolve);
    });
    rl.close();
    if (answer.trim().toLowerCase() !== 'y') {
      console.log(chalk.green('\n  ✅ Silakan update terlebih dahulu. Keluar...\n'));
      process.exit(0);
    }
    console.log(chalk.dim('  ⚠️  Melanjutkan tanpa update...\n'));
  } else if (update.error) {
    renderUpdateError(update.message);
  }

  // 3. Workspace & wizard
  const cwd = process.cwd();
  config.agent = { ...config.agent, workspace: cwd };
  if (!config._wizard_done || args.includes('--wizard')) {
    await runWizard(ROOT);
  }

  // 4. Load tools (with spinner)
  const registry = new ToolRegistry();
  const pluginMgr = new PluginManager(registry);

  const { loaded, failed } = await withSpinner('Loading tools...', async () => {
    const result = await registry.loadBuiltins();
    await pluginMgr.load();
    return result;
  });
  const actions = registry.all().reduce((s, t) => s + (t.actions?.length || 0), 0);
  renderInitLine('🔧', `${loaded} tools loaded`, `${actions} actions${failed ? `, ${failed} failed` : ''}`);

  // --list-tools mode
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
  const thinking = new Thinking();

  // 6. Build context & system prompt
  const context = await buildContext();
  const systemPrompt = buildSystemPrompt(registry, config);

  // 7. Connect to XiaoZhi (with spinner)
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
    await withSpinner('Connecting to XiaoZhi...', async () => {
      await withRetry(() => mqtt.connect(), { maxRetries: 2, delay: 2000 });
    });
  } catch (e) {
    renderInitLine('❌', `Connection failed: ${e.message}`);
    process.exit(1);
  }

  // 8. Message sender (retry + queue)
  const sender = new MessageSender(mqtt);

  // 9. Register MCP tool handler (with error-handler, retry, auto-format, thinking)
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
        const result = await withRetry(
          () => registry.call(name, args),
          { maxRetries: isRetryable ? 1 : 0, delay: 1000 }
        );
        stats.record(name, args.action, !result.isError, Date.now() - start);
        session.addToolCall(name, args, result);

        // Auto-format after file writes
        if (name === 'file' && (args.action === 'write' || args.action === 'edit') && args.path) {
          autoFormat(args.path).catch(() => {});
        }

        thinking.set('idle');
        bus.emit('tool:called', { name, result, args });
        return result;
      } catch (e) {
        stats.record(name, args.action, false, Date.now() - start, e.message);
        thinking.set('idle');
        const enhanced = handleError(e);
        throw new Error(enhanced);
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

  // 12. Thinking indicator events
  bus.on('thinking', ({ state, icon, text }) => {
    if (state !== 'idle') {
      process.stdout.write(chalk.dim(`\r  ${icon} ${text}`) + ' '.repeat(20) + '\r');
    }
  });

  // 13. Save config & render banner
  await saveConfig(ROOT, config);

  // Banner with all info merged (replaces separate status bar)
  renderBanner(config, registry.all(), mqtt.connected, {
    session: mqtt.sessionId,
  });

  // 14. Start REPL
  const repl = new REPL(registry, mqtt, stats, session, { thinking, sender, autoFormat });
  repl.start();

  // Graceful shutdown
  const shutdown = async () => {
    console.log('');
    console.log(stats.formatReport());
    if (wss) wss.stop();
    await registry.shutdown();
    mqtt.disconnect();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(e => {
  console.error(chalk.red(`\n  Fatal: ${handleError(e)}\n`));
  process.exit(1);
});
