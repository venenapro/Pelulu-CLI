/**
 * Logger — colored terminal output with levels + file logging
 * Supports Ink mode: when active, logs go through bus instead of console
 */
import { writeFile, mkdir, appendFile, readdir, unlink } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';

let _debug = false;
let _inkMode = false;
let _bus = null;
let _logFile = null;
let _logQueue = [];
let _logTimer = null;

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

export function setInkMode(enabled, bus) {
  _inkMode = enabled;
  _bus = bus;
}
export function isInkMode() { return _inkMode; }

const ICONS = {
  ok: '[OK]', err: '[ERR]', warn: '[WARN]', info: '[i]',
  tool: '[TOOL]', mcp: '[MCP]', plugin: '[PLUG]', system: '[SYS]',
  user: '[USER]', ai: '[AI]', debug: '[DBG]', file: '[FILE]',
};

export function setDebug(enabled) { _debug = enabled; }
export function isDebug() { return _debug; }
export function debug(msg, data) { log('debug', msg, data); }

/**
 * Initialize file logging
 * Deletes old logs, keeps only the latest one
 */
export async function initFileLog(root, appName = 'pelulu') {
  const logDir = join(root, 'logs');
  await mkdir(logDir, { recursive: true });

  // Delete old log files
  try {
    const files = await readdir(logDir);
    for (const f of files) {
      if (f.endsWith('.log')) {
        await unlink(join(logDir, f)).catch(() => {});
      }
    }
  } catch {}

  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const time = now.toISOString().slice(11, 19).replace(/:/g, '-');
  _logFile = join(logDir, `${appName}-${date}_${time}.log`);
  
  // Write header
  const header = `═══════════════════════════════════════\n` +
    `${appName} Log\n` +
    `Started: ${now.toISOString()}\n` +
    `═══════════════════════════════════════\n\n`;
  await writeFile(_logFile, header, 'utf-8');
  return _logFile;
}

/**
 * Write log entry to file
 */
function writeToFile(level, msg, data) {
  if (!_logFile) return;
  
  const ts = new Date().toISOString().slice(11, 23);
  const icon = ICONS[level] || '';
  let line = `${ts} ${icon} ${msg}`;
  if (data && _debug) line += ` ${JSON.stringify(data)}`;
  line += '\n';
  
  _logQueue.push(line);
  _flushSoon();
}

/**
 * Write raw text to log file (for AI responses, chat messages)
 */
export function writeRawToLog(text) {
  if (!_logFile || !text) return;
  const ts = new Date().toISOString().slice(11, 23);
  _logQueue.push(`${ts} ${text}\n`);
  _flushSoon();
}

function _flushSoon() {
  if (_logTimer) return;
  _logTimer = setTimeout(async () => {
    const batch = _logQueue.join('');
    _logQueue = [];
    _logTimer = null;
    try {
      await appendFile(_logFile, batch, 'utf-8');
    } catch {}
  }, 500);
}

export function log(level, msg, data) {
  if (level === 'debug' && !_debug) return;

  // Write to file
  writeToFile(level, msg, data);

  // In Ink mode, route logs through bus so they render inside the TUI
  if (_inkMode && _bus) {
    _bus.emit('log:message', { level, msg, data });
    return;
  }

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

/**
 * Flush pending logs to file
 */
export async function flushLogs() {
  if (_logTimer) {
    clearTimeout(_logTimer);
    _logTimer = null;
  }
  if (_logQueue.length > 0 && _logFile) {
    const batch = _logQueue.join('');
    _logQueue = [];
    try {
      await appendFile(_logFile, batch, 'utf-8');
    } catch {}
  }
}

/**
 * Get log file path
 */
export function getLogFile() {
  return _logFile;
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
