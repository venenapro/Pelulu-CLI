/**
 * TUI Renderer — rich terminal UI using chalk
 * Like Claude Code / Gemini CLI / OpenCode
 */
import chalk from 'chalk';
import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

const box = {
  tl: '╭', tr: '╮', bl: '╰', br: '╯',
  h: '─', v: '│', ml: '├', mr: '┤',
};

function horizontal(width, char = box.h) {
  return char.repeat(width);
}

function pad(text, width) {
  return text + ' '.repeat(Math.max(0, width - text.length));
}

function center(text, width) {
  const left = Math.floor((width - text.length) / 2);
  return ' '.repeat(left) + text + ' '.repeat(width - left - text.length);
}

/**
 * Read version from package.json (cached)
 */
let _cachedVersion = null;
async function getVersion() {
  if (_cachedVersion) return _cachedVersion;
  try {
    const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf-8'));
    _cachedVersion = pkg.version || '0.0.0';
  } catch {
    _cachedVersion = '0.0.0';
  }
  return _cachedVersion;
}

function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

/**
 * Render the Pelulu ASCII art banner (displayed once at startup)
 */
export async function renderAsciiBanner() {
  const version = await getVersion();
  const w = 52;

  console.log('');
  console.log(chalk.cyan(`${box.tl}${horizontal(w, box.h)}${box.tr}`));

  // ASCII art — cute coding cat
  const art = [
    chalk.cyan('  /\\_/\\  ') + chalk.cyanBright('  ____        _ _'),
    chalk.cyan('  ( o.o ) ') + chalk.cyanBright('  |  _ \ _   _| | |_   _'),
    chalk.cyan('   > ^ <  ') + chalk.cyanBright('  | |_) | | | | | | | | |'),
    chalk.cyan('  /|   |\\ ') + chalk.cyanBright('  |  __/| |_| | | | |_| |'),
    chalk.cyan(' (_|   |_)') + chalk.cyanBright('  |_|    \__,_|_|_|\__, |'),
    chalk.cyan('           ') + chalk.cyanBright('                |___/ '),
  ];

  for (const line of art) {
    console.log(chalk.cyan(`${box.v}`) + line + ' '.repeat(Math.max(0, w - stripAnsi(line).length + 1)) + chalk.cyan(`${box.v}`));
  }

  console.log(chalk.cyan(`${box.ml}${horizontal(w, box.h)}${box.mr}`));

  const tagline = chalk.cyanBright.bold('  🐱 coding companion') + chalk.gray(`  v${version}`);
  const features = chalk.gray('  18 tools  •  MCP protocol  •  agent mode  •  xiaozhi.me');

  console.log(chalk.cyan(`${box.v}`) + tagline + ' '.repeat(Math.max(0, w - stripAnsi(tagline).length)) + chalk.cyan(`${box.v}`));
  console.log(chalk.cyan(`${box.v}`) + features + ' '.repeat(Math.max(0, w - stripAnsi(features).length)) + chalk.cyan(`${box.v}`));

  console.log(chalk.cyan(`${box.bl}${horizontal(w, box.h)}${box.br}`));
  console.log('');
}

export function renderBanner(config, tools, connected, meta = {}) {
  const w = 48;
  const actions = tools.reduce((s, t) => s + (t.actions?.length || 0), 0);
  const cwd = process.cwd();
  const dirName = cwd.split('/').pop() || cwd;
  const session = meta.session || '-';
  const version = config.agent?.version || '';

  console.log('');
  console.log(chalk.cyan(`${box.tl}${horizontal(w, box.h)}${box.tr}`));
  console.log(chalk.cyan(`${box.v}`) + chalk.bold.white(center(`${config.agent?.name || 'Pelulu CLI'}${version ? ' v' + version : ''}`, w)) + chalk.cyan(`${box.v}`));
  console.log(chalk.cyan(`${box.ml}${horizontal(w, box.h)}${box.mr}`));
  console.log(chalk.cyan(`${box.v}`) + chalk.gray(pad(`  ${dirName}`, w)) + chalk.cyan(`${box.v}`));
  console.log(chalk.cyan(`${box.v}`) + chalk.gray(pad(`  ${tools.length} tools / ${actions} actions`, w)) + chalk.cyan(`${box.v}`));
  console.log(chalk.cyan(`${box.v}`) + chalk.gray(pad(`  ${connected ? 'MQTT: on' : 'MQTT: off'}  |  Session: ${session}`, w)) + chalk.cyan(`${box.v}`));
  console.log(chalk.cyan(`${box.bl}${horizontal(w, box.h)}${box.br}`));
  console.log('');
}

export function renderStatus(status) {
  const w = 48;
  console.log('');
  console.log(chalk.cyan(`${box.tl}${horizontal(w, box.h)}${box.tr}`));
  console.log(chalk.cyan(`${box.v}`) + chalk.bold.white(pad('  [STATS] Status', w)) + chalk.cyan(`${box.v}`));
  console.log(chalk.cyan(`${box.ml}${horizontal(w, box.h)}${box.mr}`));
  for (const [key, value] of Object.entries(status)) {
    console.log(chalk.cyan(`${box.v}`) + chalk.gray(pad(`  ${key}: ${value}`, w)) + chalk.cyan(`${box.v}`));
  }
  console.log(chalk.cyan(`${box.bl}${horizontal(w, box.h)}${box.br}`));
  console.log('');
}

export function renderTools(tools) {
  console.log('');
  console.log(chalk.bold.white('Available Tools:'));
  console.log('');
  for (const t of tools) {
    const actions = t.actions?.map(a => a.name || a).join(', ') || '';
    console.log(chalk.cyan(`  ${t.name}`) + chalk.gray(` — ${t.description}`));
    console.log(chalk.dim(`    ${actions}`));
  }
  console.log('');
}

export function renderToolCall(name, action, args) {
  const ts = new Date().toLocaleTimeString();
  const actionStr = action ? `.${action}` : '';
  const detail = args?.path || args?.command || args?.pattern || args?.url || '';
  const detailStr = detail ? chalk.dim(`  ${detail}`) : '';
  console.log(`  ${chalk.dim(ts)} ${chalk.cyan(name)}${chalk.white(actionStr)}${detailStr}`);
}

export function renderToolResult(success, data) {
  if (success) {
    console.log(chalk.green(`     [OK] OK`));
  } else {
    console.log(chalk.red(`     [ERR] ${data || 'error'}`));
  }
}

function stripEmojis(text) {
  return text
    .replace(/\p{Emoji_Presentation}/gu, '')
    .replace(/\p{Emoji_Modifier_Base}\p{Emoji_Modifier}?/gu, '')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/[\u2600-\u27BF]/g, '')
    .replace(/[\u{1F000}-\u{1FFFF}]/gu, '')
    .replace(/[\u200D\uFE0F]/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ ([.,;:!?])/g, '$1')
    .trim();
}

export function renderAiResponse(text) {
  const clean = stripEmojis(text);
  if (!clean) return;
  console.log('');
  const lines = wrapText(clean, 80);
  for (const line of lines) {
    console.log(chalk.white(`  ${line}`));
  }
  console.log('');
}

function wrapText(text, maxWidth) {
  const paragraphs = text.split('\n');
  const result = [];
  for (const para of paragraphs) {
    if (!para.trim()) { result.push(''); continue; }
    const words = para.split(/\s+/);
    let line = '';
    for (const word of words) {
      if (line.length + word.length + 1 > maxWidth && line.length > 0) {
        result.push(line);
        line = word;
      } else {
        line = line ? `${line} ${word}` : word;
      }
    }
    if (line) result.push(line);
  }
  return result;
}

export function renderUserInput(text) {
  const ts = new Date().toLocaleTimeString();
  console.log(chalk.dim(`  ${ts} `) + chalk.blue('> ') + chalk.white(text));
}

export function renderHelp() {
  console.log('');
  console.log(chalk.bold.white('  Commands:'));
  console.log(chalk.cyan('    /tools') + chalk.gray('        Show MCP tools'));
  console.log(chalk.cyan('    /help <tool>') + chalk.gray('    Tool examples'));
  console.log(chalk.cyan('    /status') + chalk.gray('         Connection & session'));
  console.log(chalk.cyan('    /stats') + chalk.gray('          Usage statistics'));
  console.log(chalk.cyan('    /workspace') + chalk.gray('       Project info'));
  console.log(chalk.cyan('    /files') + chalk.gray('           File changes'));
  console.log(chalk.cyan('    /call <tool>') + chalk.gray('     Call tool directly'));
  console.log(chalk.cyan('    /doctor') + chalk.gray('          Health check'));
  console.log(chalk.cyan('    /keys') + chalk.gray('           Keyboard shortcuts'));
  console.log(chalk.cyan('    /clear') + chalk.gray('           Clear screen'));
  console.log(chalk.cyan('    /quit') + chalk.gray('            Exit'));
  console.log('');
  console.log(chalk.bold.white('  Shortcuts:'));
  console.log(chalk.cyan('    read <file>') + chalk.gray('       file read'));
  console.log(chalk.cyan('    run <cmd>') + chalk.gray('        shell exec'));
  console.log(chalk.cyan('    git <cmd>') + chalk.gray('        git operation'));
  console.log(chalk.cyan('    build / test / lint') + chalk.gray(' project actions'));
  console.log(chalk.cyan('    Tab') + chalk.gray('               auto-complete'));
  console.log('');
}

export function createPrompt(dirName) {
  return chalk.cyan(`${dirName} `) + chalk.white('❯ ');
}

export function renderUpdateNotification(update) {
  const w = 56;
  const { local, remote, release } = update;

  console.log('');
  console.log(chalk.yellow(`${box.tl}${horizontal(w, box.h)}${box.tr}`));
  console.log(chalk.yellow(`${box.v}`) + chalk.bold.yellow(center('  UPDATE TERSEDIA!', w)) + chalk.yellow(`${box.v}`));
  console.log(chalk.yellow(`${box.ml}${horizontal(w, box.h)}${box.mr}`));
  console.log(chalk.yellow(`${box.v}`) + chalk.white(pad(`  Versi lokal   : ${local}`, w)) + chalk.yellow(`${box.v}`));
  console.log(chalk.yellow(`${box.v}`) + chalk.green(pad(`  Versi terbaru : ${remote}`, w)) + chalk.yellow(`${box.v}`));

  if (release?.name && release.name !== release.tag) {
    console.log(chalk.yellow(`${box.v}`) + chalk.gray(pad(`  Release       : ${release.name}`, w)) + chalk.yellow(`${box.v}`));
  }
  if (release?.url) {
    console.log(chalk.yellow(`${box.v}`) + chalk.cyan(pad(`  ${release.url}`, w)) + chalk.yellow(`${box.v}`));
  }

  console.log(chalk.yellow(`${box.ml}${horizontal(w, box.h)}${box.mr}`));
  console.log(chalk.yellow(`${box.v}`) + chalk.bold.white(pad('  Jalankan perintah berikut untuk update:', w)) + chalk.yellow(`${box.v}`));
  console.log(chalk.yellow(`${box.v}`) + chalk.green(pad('  npm install pelulu-cli@latest', w)) + chalk.yellow(`${box.v}`));
  console.log(chalk.yellow(`${box.bl}${horizontal(w, box.h)}${box.br}`));
  console.log('');
}

export function renderUpdateError(message) {
  console.log(chalk.dim(`  [WARN]  Update check failed: ${message}`));
}

export function renderInitLine(icon, text, detail = '') {
  const detailStr = detail ? chalk.dim(` (${detail})`) : '';
  console.log(chalk.gray(`  ${icon} ${text}`) + detailStr);
}

export function renderReady(sessionId) {
  console.log(chalk.green(`  ✓ Ready`) + chalk.dim(`  session: ${sessionId || '-'}`));
  console.log('');
}
