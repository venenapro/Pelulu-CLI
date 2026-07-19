/**
 * TUI Renderer — rich terminal UI using chalk
 * Like Claude Code / Gemini CLI / OpenCode
 */
import chalk from 'chalk';
import { createInterface } from 'readline';

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

export function renderBanner(config, tools, connected) {
  const w = 48;
  const actions = tools.reduce((s, t) => s + (t.actions?.length || 0), 0);
  const cwd = process.cwd();
  const dirName = cwd.split('/').pop() || cwd;

  console.log('');
  console.log(chalk.cyan(`${box.tl}${horizontal(w, box.h)}${box.tr}`));
  console.log(chalk.cyan(`${box.v}`) + chalk.bold.white(center(`🐾 ${config.agent?.name || 'Pelulu CLI'}`, w)) + chalk.cyan(`${box.v}`));
  console.log(chalk.cyan(`${box.ml}${horizontal(w, box.h)}${box.mr}`));
  console.log(chalk.cyan(`${box.v}`) + chalk.gray(pad(`  📁 ${dirName}`, w)) + chalk.cyan(`${box.v}`));
  console.log(chalk.cyan(`${box.v}`) + chalk.gray(pad(`  🔧 ${tools.length} tools · ${actions} actions · 15 MCP slots used`, w)) + chalk.cyan(`${box.v}`));
  console.log(chalk.cyan(`${box.v}`) + chalk.gray(pad(`  ${connected ? '🟢 MQTT Connected' : '🔴 Disconnected'}`, w)) + chalk.cyan(`${box.v}`));
  console.log(chalk.cyan(`${box.bl}${horizontal(w, box.h)}${box.br}`));
  console.log('');
}

export function renderStatus(status) {
  const w = 48;
  console.log('');
  console.log(chalk.cyan(`${box.tl}${horizontal(w, box.h)}${box.tr}`));
  console.log(chalk.cyan(`${box.v}`) + chalk.bold.white(pad('  📊 Status', w)) + chalk.cyan(`${box.v}`));
  console.log(chalk.cyan(`${box.ml}${horizontal(w, box.h)}${box.mr}`));
  for (const [key, value] of Object.entries(status)) {
    console.log(chalk.cyan(`${box.v}`) + chalk.gray(pad(`  ${key}: ${value}`, w)) + chalk.cyan(`${box.v}`));
  }
  console.log(chalk.cyan(`${box.bl}${horizontal(w, box.h)}${box.br}`));
  console.log('');
}

export function renderTools(tools) {
  console.log('');
  console.log(chalk.bold.white('🔧 Available Tools:'));
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
  console.log('');
  console.log(chalk.dim(`  ${ts} `) + chalk.cyan('⚙️ ') + chalk.white(`${name}.${action}`));
  if (args?.path) console.log(chalk.dim(`     📁 ${args.path}`));
  if (args?.command) console.log(chalk.dim(`     💻 ${args.command}`));
}

export function renderToolResult(success, data) {
  if (success) {
    console.log(chalk.green(`     ✅ OK`));
  } else {
    console.log(chalk.red(`     ❌ ${data || 'error'}`));
  }
}

export function renderAiResponse(text) {
  console.log('');
  console.log(chalk.green(`  🤖 ${text}`));
  console.log('');
}

export function renderUserInput(text) {
  const ts = new Date().toLocaleTimeString();
  console.log(chalk.dim(`  ${ts} `) + chalk.blue('👤 ') + chalk.white(text));
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
  console.log(chalk.cyan('    /clear') + chalk.gray('           Clear screen'));
  console.log(chalk.cyan('    /quit') + chalk.gray('            Exit'));
  console.log('');
  console.log(chalk.bold.white('  Shortcuts:'));
  console.log(chalk.cyan('    read index.js') + chalk.gray('     → file read'));
  console.log(chalk.cyan('    run npm test') + chalk.gray('      → shell exec'));
  console.log(chalk.cyan('    git status') + chalk.gray('        → git status'));
  console.log(chalk.cyan('    build') + chalk.gray('              → project build'));
  console.log('');
}

export function createPrompt(dirName) {
  return chalk.cyan(`${dirName} `) + chalk.white('❯ ');
}
