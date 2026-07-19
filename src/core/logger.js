/**
 * Logger — colored terminal output with levels
 */
let _debug = false;

export const COLORS = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

const ICONS = {
  ok: '✅', err: '❌', warn: '⚠️', info: 'ℹ️',
  tool: '🔧', mcp: '🔗', plugin: '🧩', system: '⚙️',
  user: '👤', ai: '🤖', debug: '🔍', file: '📁',
};

export function setDebug(enabled) { _debug = enabled; }
export function isDebug() { return _debug; }
export function debug(msg, data) { log('debug', msg, data); }

export function log(level, msg, data) {
  if (level === 'debug' && !_debug) return;
  const icon = ICONS[level] || '';
  const color = {
    ok: COLORS.green, err: COLORS.red, warn: COLORS.yellow,
    info: COLORS.blue, tool: COLORS.cyan, mcp: COLORS.magenta,
    debug: COLORS.gray, user: COLORS.bold, ai: COLORS.green,
  }[level] || '';

  const prefix = `${color}${icon} ${COLORS.reset}`;
  console.log(`${prefix}${msg}`);
  if (data && _debug) console.log(`${COLORS.gray}${JSON.stringify(data, null, 2)}${COLORS.reset}`);
}

export function table(rows) {
  if (!rows.length) return;
  const keys = Object.keys(rows[0]);
  const widths = keys.map(k => Math.max(k.length, ...rows.map(r => String(r[k] ?? '').length)));
  const sep = widths.map(w => '─'.repeat(w + 2)).join('┼');
  console.log(keys.map((k, i) => k.padEnd(widths[i])).join(' │ '));
  console.log(sep);
  for (const row of rows) {
    console.log(keys.map((k, i) => String(row[k] ?? '').padEnd(widths[i])).join(' │ '));
  }
}

export function banner(title, lines = []) {
  const width = Math.max(title.length + 4, ...lines.map(l => l.length + 4), 40);
  const pad = (s) => `  ${s}${' '.repeat(width - s.length - 2)}  `;
  console.log('');
  console.log(`${COLORS.cyan}╔${'═'.repeat(width)}╗`);
  console.log(`║${COLORS.bold}${pad(title)}${COLORS.cyan}║`);
  if (lines.length) {
    console.log(`╠${'═'.repeat(width)}╣`);
    for (const line of lines) console.log(`║${COLORS.reset}${pad(line)}${COLORS.cyan}║`);
  }
  console.log(`╚${'═'.repeat(width)}╝${COLORS.reset}`);
  console.log('');
}
