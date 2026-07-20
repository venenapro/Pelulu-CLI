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

  const cat = [
    '   /\\_/\\  ',
    '  ( o.o ) ',
    '   > ^ <  ',
    '  /|   |\\ ',
    ' (_|   |_)',
  ];

  const info = [
    chalk.cyan.bold('P E L U L U - C L I'),
    chalk.gray(`v${version}`),
    chalk.cyan('coding companion'),
    chalk.gray('powered by XiaoZhi'),
    '',
  ];

  console.log('');
  console.log(chalk.cyan(`${box.tl}${horizontal(w, box.h)}${box.tr}`));

  for (let i = 0; i < Math.max(cat.length, info.length); i++) {
    const left = cat[i] ? chalk.cyan(cat[i]) : ' '.repeat(11);
    const right = info[i] || '';
    const gap = '    ';
    console.log(chalk.cyan(`${box.v}`) + left + gap + right + ' '.repeat(Math.max(0, w - 11 - gap.length - stripAnsi(right).length)) + chalk.cyan(`${box.v}`));
  }

  console.log(chalk.cyan(`${box.ml}${horizontal(w, box.h)}${box.mr}`));

  const features = chalk.gray('  18 tools  •  MCP protocol  •  agent mode');
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
  console.log(chalk.yellow(`${box.v}`) + chalk.gray(pad('  Menginstall update secara otomatis...', w)) + chalk.yellow(`${box.v}`));
  console.log(chalk.yellow(`${box.bl}${horizontal(w, box.h)}${box.br}`));
  console.log('');
}

/**
 * Render usage info after successful update
 */
export function renderPostUpdate(packageName, version) {
  const w = 52;
  console.log('');
  console.log(chalk.green(`${box.tl}${horizontal(w, box.h)}${box.tr}`));
  console.log(chalk.green(`${box.v}`) + chalk.bold.green(center(`  ✓ ${packageName} v${version} installed!`, w)) + chalk.green(`${box.v}`));
  console.log(chalk.green(`${box.ml}${horizontal(w, box.h)}${box.mr}`));
  console.log(chalk.green(`${box.v}`) + chalk.white(pad('  Run:', w)) + chalk.green(`${box.v}`));
  console.log(chalk.green(`${box.v}`) + chalk.cyan(pad(`  $ ${packageName}`, w)) + chalk.green(`${box.v}`));
  console.log(chalk.green(`${box.v}`) + chalk.gray(pad('', w)) + chalk.green(`${box.v}`));
  console.log(chalk.green(`${box.v}`) + chalk.white(pad('  Commands:', w)) + chalk.green(`${box.v}`));
  console.log(chalk.green(`${box.v}`) + chalk.gray(pad('  /help    — show commands', w)) + chalk.green(`${box.v}`));
  console.log(chalk.green(`${box.v}`) + chalk.gray(pad('  /tools   — list tools', w)) + chalk.green(`${box.v}`));
  console.log(chalk.green(`${box.v}`) + chalk.gray(pad('  /status  — connection status', w)) + chalk.green(`${box.v}`));
  console.log(chalk.green(`${box.v}`) + chalk.gray(pad('  /clear   — clear screen', w)) + chalk.green(`${box.v}`));
  console.log(chalk.green(`${box.v}`) + chalk.gray(pad('  /quit    — exit', w)) + chalk.green(`${box.v}`));
  console.log(chalk.green(`${box.bl}${horizontal(w, box.h)}${box.br}`));
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
