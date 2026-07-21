#!/usr/bin/env node
/**
 * Pelulu CLI — Entry Point
 * Ink-based TUI with React components
 * 
 * Now with OpenHands-style agent capabilities:
 * - Agent Loop (observe→think→act)
 * - Plan Management
 * - Enhanced Context
 * - History Condensation
 */
import { dirname, join } from 'path';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import chalk from 'chalk';
import { existsSync } from 'fs';
import { loadConfig, saveConfig, expand } from './core/config.js';
import { log, setDebug, debug, setInkMode, initFileLog, flushLogs, getLogFile, writeRawToLog } from './core/logger.js';
import { bus } from './core/event-bus.js';
import { ToolRegistry } from './core/tool-registry.js';
import { jobManager } from './core/job-manager.js';
import { Sandbox } from './core/sandbox.js';
import { SessionState } from './core/session.js';
import { Stats } from './core/stats.js';
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
import { renderUpdateNotification, renderPostUpdate, renderAsciiBanner } from './tui/renderer.js';
import { startInkTUI } from './tui/ink-entry.js';

// Import new agent system
import { AgentController } from './agent/agent-controller.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const args = process.argv.slice(2);
if (args.includes('--debug')) setDebug(true);
const LIST_TOOLS = args.includes('--list-tools');
const NO_AGENT = args.includes('--no-agent');

async function main() {
  // Buffer ALL startup logs for Ink to display inside TUI
  const startupLogs = [];
  const origLog = console.log;
  const bufferLog = (...args) => startupLogs.push(args.join(' '));

  // 1. Load config
  const config = await loadConfig(ROOT);

  // 1b. Initialize file logging (deletes old logs, keeps only latest)
  const appName = config.agent?.name?.toLowerCase().replace(/\s+/g, '-') || 'pelulu';
  const logFile = await initFileLog(ROOT, appName);
  debug('init', `Log file: ${logFile}`);

  // 1c. Enable Ink mode early — route ALL logs through bus (no console.log leak)
  if (process.stdin.isTTY) {
    setInkMode(true, bus);
  }

  // 2. Auto-update — silently install latest if outdated
  const update = await checkForUpdates(ROOT);
  if (update.available) {
    const pkgName = await (async () => {
      try { return JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf-8')).name; } catch { return 'pelulu-cli'; }
    })();
    try {
      const { execSync } = await import('child_process');
      execSync(`npm install -g ${pkgName}@latest`, { stdio: 'ignore' });
      renderPostUpdate(pkgName, update.remote);
      process.exit(0);
    } catch (e) {
      console.error(chalk.red(`  ✗ Update failed: ${e.message}`));
      console.log(chalk.gray(`  Run manually: npm install -g ${pkgName}@latest`));
      process.exit(1);
    }
  }

  // 3. Workspace & wizard
  const cwd = process.cwd();
  config.agent = { ...config.agent, workspace: cwd };
  if (!config._wizard_done || args.includes('--wizard')) {
    await runWizard(ROOT);
  }

  // Banner is now a React component inside Ink TUI (AsciiBanner)
  // Only render console banner for fallback REPL (non-TTY)
  if (!process.stdin.isTTY) {
    await renderAsciiBanner();
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

  // 7. Connect to XiaoZhi
  const mqtt = new MqttClient(config);

  bus.on('activation:required', ({ code }) => {
    // Display DIRECTLY to console (not buffered) — user must see this!
    origLog('');
    origLog(chalk.red('  ╔══════════════════════════════════════════╗'));
    origLog(chalk.red('  ║') + chalk.bold.white('         ACTIVATION REQUIRED              ') + chalk.red('║'));
    origLog(chalk.red('  ╠══════════════════════════════════════════╣'));
    origLog(chalk.red('  ║') + chalk.yellow(`  Code: ${code}`) + ' '.repeat(33 - code.length) + chalk.red('║'));
    origLog(chalk.red('  ║') + chalk.cyan('  https://xiaozhi.me') + ' '.repeat(23) + chalk.red('║'));
    origLog(chalk.red('  ╚══════════════════════════════════════════╝'));
    origLog('');
    origLog(chalk.gray('  Waiting for activation... (checking every 5s)'));
    origLog('');
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

  // 9. Initialize Agent Controller (OpenHands-style)
  let agentController = null;
  if (!NO_AGENT) {
    agentController = new AgentController({
      registry,
      mqtt,
      sandbox,
      confirm: { isDestructive, ask: askConfirmation },
      config,
    });

    startupLogs.push(chalk.green('  ✓ Agent system initialized'));
    startupLogs.push(chalk.gray(`    - Max iterations: ${config.agent?.max_iterations || 50}`));
    startupLogs.push(chalk.gray(`    - Max input: 70 chars`));
    startupLogs.push(chalk.gray(`    - Log: ${getLogFile()}`));
  }

  // 10. Register MCP tool handler (for XiaoZhi direct tool calls)
  // Agent calls are auto-approved — XiaoZhi controls the flow, no y/N prompts
  // File tool actions that mutate the filesystem — tracked + surfaced in chat
  const FILE_MUTATIONS = ['write', 'edit', 'delete', 'mkdir', 'copy', 'move'];

  mqtt.registerToolHandler(
    async (name, args) => {
      sandbox.validate(name, args);

      thinking.set('tool_call');
      const start = Date.now();

      // Capture pre-state so we can report created vs modified accurately
      const trackedPath = args?.to || args?.path;
      let preExisted = false;
      if (name === 'file' && FILE_MUTATIONS.includes(args?.action) && trackedPath) {
        try { preExisted = existsSync(expand(trackedPath)); } catch {}
      }

      // Post-processing shared by the inline and background completion paths:
      // record stats, track file mutations, and surface the result in the TUI.
      const finalize = (result) => {
        stats.record(name, args.action, !result.isError, Date.now() - start);
        session.addToolCall(name, args, result);

        // Track file changes and broadcast them so the TUI can show tracking in chat
        if (name === 'file' && !result.isError && FILE_MUTATIONS.includes(args.action) && trackedPath) {
          const change =
            args.action === 'delete' ? 'deleted'
            : (args.action === 'edit' || preExisted) ? 'modified'
            : 'created';
          fileTracker.track(trackedPath, change);
          bus.emit('files:changed', { path: trackedPath, change, changes: fileTracker.getChanges() });

          if (args.action === 'write' || args.action === 'edit') {
            autoFormat(trackedPath).catch(() => {});
          }
        }

        bus.emit('tool:called', { name, result, args });
      };

      try {
        // Route EVERY tool action through the job layer. Fast actions resolve
        // inline (unchanged UX); slow ones background themselves and return a
        // pollable job handle so XiaoZhi never assumes a timeout while the tool
        // is still working. The AI polls progress/results with the `jobs` tool.
        const dispatched = await jobManager.dispatch(
          { tool: name, action: args.action, label: `${name}${args.action ? `.${args.action}` : ''}` },
          () => registry.call(name, args),
        );

        if (dispatched.done) {
          if (dispatched.error) throw dispatched.error;
          finalize(dispatched.result);
          thinking.set('idle');
          return dispatched.result;
        }

        // Backgrounded: tell XiaoZhi it's running and how to follow up. Finalize
        // the real result once the background work completes.
        const job = dispatched.job;
        jobManager.wait(job.id, 3_600_000).then(() => {
          if (job.status === 'done' && job.result) {
            const wrapped = { isError: false, content: [{ type: 'text', text: typeof job.result === 'string' ? job.result : JSON.stringify(job.result) }] };
            finalize(wrapped);
          }
        }).catch(() => {});

        thinking.set('idle');
        return {
          isError: false,
          content: [{ type: 'text', text: JSON.stringify({
            status: 'running',
            job_id: job.id,
            tool: name,
            action: args.action,
            message: `"${name}${args.action ? `.${args.action}` : ''}" is running in the background (job ${job.id}). It is NOT an error or timeout. Poll it with the jobs tool: {"action":"wait","id":"${job.id}"} to wait, or {"action":"status","id":"${job.id}"} to check progress.`,
          }) }],
        };
      } catch (e) {
        stats.record(name, args.action, false, Date.now() - start, e.message);
        thinking.set('idle');
        throw new Error(handleError(e));
      }
    },
    () => registry.toMcpTools()
  );

  // 11. Optional WSS endpoint
  let wss = null;
  if (config.mcp?.endpoint_url) {
    wss = new WssEndpoint(config.mcp.endpoint_url, () => registry.toMcpTools(), async (name, args) => {
      sandbox.validate(name, args);
      return registry.call(name, args);
    });
    wss.start();
  }

  // 12. Track conversation + log AI responses
  bus.on('user:text', (text) => {
    session.addUserMessage(text);
    writeRawToLog(`[USER] ${text}`);
  });
  bus.on('llm:text', (text) => {
    session.addAiMessage(text);
    writeRawToLog(`[AI] ${text}`);
  });
  bus.on('tts:sentence', (text) => {
    writeRawToLog(`[AI-TTS] ${text}`);
  });

  // 13. Save config
  await saveConfig(ROOT, config);

  // 14. Start Ink TUI
  const { unmount, waitUntilExit } = startInkTUI({
    registry, mqtt, stats, session, bus, config,
    extras: {
      fileTracker, thinking, sender, autoFormat, startupLogs,
      agentController, // Pass agent controller to TUI
    },
  });

  // Graceful shutdown
  const shutdown = async () => {
    unmount();
    if (agentController) agentController.abort();
    if (wss) wss.stop();
    await registry.shutdown();
    mqtt.disconnect();
    await flushLogs();
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
