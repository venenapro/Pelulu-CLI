/**
 * Ink Entry — renders the Ink TUI and connects to Pelulu internals
 * Falls back to readline REPL if Ink can't start (non-TTY, etc.)
 */
import React from 'react';
import { render } from 'ink';
import { createApp } from './ink-app.js';

export function startInkTUI({ registry, mqtt, stats, session, bus, config, extras }) {
  const App = createApp({ registry, mqtt, stats, session, bus, config, extras });

  try {
    const { unmount, waitUntilExit } = render(
      React.createElement(App),
      { exitOnCtrlC: false },
    );
    return { unmount, waitUntilExit };
  } catch (e) {
    // Fallback: if Ink fails (non-TTY, etc.), use readline REPL
    return startFallbackREPL({ registry, mqtt, stats, session, bus, config, extras });
  }
}

async function startFallbackREPL({ registry, mqtt, stats, session, bus, extras }) {
  const { createInterface } = await import('readline');
  const chalk = (await import('chalk')).default;
  const { getCompletions } = await import('../core/completion.js');

  console.log(chalk.gray('\n  Non-interactive mode. Type to chat.\n'));

  const rl = createInterface({
    input: process.stdin, output: process.stdout,
    prompt: chalk.cyan('> '),
    completer: (line) => {
      const hits = getCompletions(line);
      return [hits.length ? hits : [], line];
    },
  });

  bus.on('llm:text', (text) => {
    const clean = text.replace(/\p{Emoji_Presentation}/gu, '').replace(/\p{Extended_Pictographic}/gu, '').trim();
    if (clean) console.log(chalk.white(`  ${clean}`));
    rl.prompt();
  });

  bus.on('tool:called', ({ name, result, args }) => {
    const status = result.isError ? chalk.red('x') : chalk.green('v');
    const detail = args?.path || args?.command || '';
    console.log(chalk.dim(`  ${name}.${args?.action || ''} ${detail} ${status}`));
  });

  bus.on('ready', () => rl.prompt());

  rl.on('line', async (input) => {
    const text = input.trim();
    if (!text) return rl.prompt();

    if (text.startsWith('/quit') || text.startsWith('/exit')) {
      process.exit(0);
    }

    // Intent parsing
    try {
      const { parseIntent } = await import('../core/intent.js');
      const intent = parseIntent(text);
      if (intent.matched) {
        const result = await registry.call(intent.tool, intent.params);
        const { formatToolResult } = await import('../core/formatter.js');
        console.log(`\n${formatToolResult(intent.tool, intent.action, result)}\n`);
        return rl.prompt();
      }
    } catch {}

    mqtt.sendText(text);
    rl.prompt();
  });

  rl.on('close', () => process.exit(0));
  rl.prompt();

  return {
    unmount: () => rl.close(),
    waitUntilExit: () => new Promise(() => {}),
  };
}
