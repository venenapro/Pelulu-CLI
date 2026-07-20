/**
 * REPL — interactive CLI with rich TUI
 */
import { createInterface } from 'readline';
import chalk from 'chalk';
import { bus } from './core/event-bus.js';
import { getConfig } from './core/config.js';
import { formatToolResult } from './core/formatter.js';
import { parseIntent } from './core/intent.js';
import { FileTracker } from './core/file-tracker.js';
import { handleCommand } from './repl-commands.js';
import { getCompletions } from './core/completion.js';
import { formatKeybindings } from './core/keybindings.js';
import {
  renderBanner, renderStatus, renderTools, renderHelp,
  renderToolCall, renderToolResult, renderAiResponse,
  renderUserInput, createPrompt,
} from './tui/renderer.js';

export class REPL {
  constructor(registry, mqtt, stats, session, extras = {}) {
    this.registry = registry;
    this.mqtt = mqtt;
    this.stats = stats;
    this.session = session;
    this.fileTracker = new FileTracker();
    this.thinking = extras.thinking || null;
    this.sender = extras.sender || null;
    this.autoFormat = extras.autoFormat || null;
    this.rl = null;
    this.history = [];
  }

  start() {
    const config = getConfig();
    this._events();

    if (!process.stdin.isTTY) {
      console.log(chalk.gray('  Non-interactive mode. Agent running in background.'));
      process.stdin.resume();
      return;
    }

    const dirName = process.cwd().split('/').pop() || process.cwd();
    this.rl = createInterface({
      input: process.stdin, output: process.stdout,
      prompt: createPrompt(dirName), historySize: 200,
      completer: (line) => {
        const hits = getCompletions(line);
        return [hits.length ? hits : [], line];
      },
    });
    this.rl.prompt();
    this.rl.on('line', (input) => this._line(input.trim()));
    this.rl.on('close', () => { console.log(chalk.gray('\n  Goodbye! 👋\n')); process.exit(0); });
  }

  _events() {
    bus.on('llm:text', (text) => {
      if (this.thinking) this.thinking.set('idle');
      // Clear any thinking indicator line
      process.stdout.write('\r' + ' '.repeat(60) + '\r');
      renderAiResponse(text);
      if (this.rl) this.rl.prompt();
    });

    bus.on('tts:sentence', (text) => {
      // TTS is audio output, no need to display text
    });

    bus.on('tool:called', ({ name, result, args }) => {
      renderToolCall(name, args?.action, args);
      renderToolResult(!result.isError, result.content?.[0]?.text);
    });

    bus.on('ready', () => {
      if (this.rl) this.rl.prompt();
    });
  }

  async _line(input) {
    if (!input) return this.rl?.prompt();
    if (input.startsWith('/')) return this._cmd(input);

    // Try intent parsing
    const intent = parseIntent(input);
    if (intent.matched) {
      renderUserInput(input);
      if (this.thinking) this.thinking.set('tool_call');
      const result = await this.registry.call(intent.tool, intent.params);
      if (this.thinking) this.thinking.set('idle');
      // Clear thinking indicator
      process.stdout.write('\r' + ' '.repeat(60) + '\r');
      const formatted = formatToolResult(intent.tool, intent.action, result);
      console.log(`\n${formatted}\n`);
      this.history.push({ role: 'user', text: input, ts: Date.now() });
      this.rl?.prompt();
      return;
    }

    // Send to XiaoZhi
    renderUserInput(input);
    this.history.push({ role: 'user', text: input, ts: Date.now() });
    if (this.thinking) this.thinking.set('thinking');
    this.mqtt.sendText(input);
    this.rl?.prompt();
  }

  async _cmd(input) {
    const [cmd, ...rest] = input.split(' ');
    const arg = rest.join(' ');
    const ctx = {
      registry: this.registry, mqtt: this.mqtt, stats: this.stats,
      session: this.session, fileTracker: this.fileTracker, history: this.history,
    };
    const special = await handleCommand(cmd, arg, ctx);

    if (special === 'help') renderHelp();
    if (special === 'tools') renderTools(this.registry.list());
    if (special === 'keys') console.log(formatKeybindings());
    if (special === 'status') {
      const s = this.session.getStats();
      renderStatus({
        'MQTT': this.mqtt.connected ? '[OK] Connected' : '[ERR] Disconnected',
        'Session': this.mqtt.sessionId || 'none',
        'Tools': `${this.registry.all().length} (${this.registry.all().reduce((s, t) => s + (t.actions?.length || 0), 0)} actions)`,
        'Turns': s.turns,
        'Tool Calls': `${s.toolCalls} (${s.errors} errors)`,
        'Uptime': `${s.uptime}s`,
        'Workspace': process.cwd(),
      });
    }
    this.rl?.prompt();
  }
}
