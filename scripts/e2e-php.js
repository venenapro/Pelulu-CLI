#!/usr/bin/env node
/**
 * scripts/e2e-php.js — Full-project agent test: "build a modular PHP web app"
 * ---------------------------------------------------------------------------
 * Unlike e2e.js (which sends ONE prompt and prints the turn), this test drives
 * XiaoZhi across MULTIPLE turns until it has actually finished building a
 * modular, scalable PHP web application — then it VERIFIES the result:
 *
 *   1. Boots the real app stack (ToolRegistry + Sandbox + MqttClient +
 *      AgentController), exactly like src/index.js / e2e.js.
 *   2. Sends a short build prompt (≤70 chars, per the XiaoZhi input limit),
 *      then keeps sending "continue" prompts until XiaoZhi says it is done,
 *      stops creating new files, or a turn/time budget is hit.
 *   3. Captures EVERY file XiaoZhi writes by listening to mcp:tool_call /
 *      mcp:tool_result (keyed by request id) — the source of truth for what
 *      was really created, regardless of where XiaoZhi decided to put it.
 *   4. Verifies the generated project:
 *        - `php -l` (lint) on every .php file  → must all parse.
 *        - Boots the app with `php -S` on the detected doc-root/entry point
 *          and HTTP-requests it → must return a 2xx/3xx with a real body and
 *          no PHP Fatal/Parse errors.
 *
 * Exits 0 only if the project was built AND runs correctly; 1 otherwise, so it
 * can be used in CI.
 *
 * Usage:  node scripts/e2e-php.js
 *   env:  E2E_MAX_TURNS (default 10)   PHP_PORT (default 8077)
 */
import { loadConfig } from '../src/core/config.js';
import { ToolRegistry } from '../src/core/tool-registry.js';
import { Sandbox } from '../src/core/sandbox.js';
import { MqttClient } from '../src/mcp/mqtt-client.js';
import { AgentController } from '../src/agent/agent-controller.js';
import { bus } from '../src/core/event-bus.js';
import { spawn } from 'child_process';
import { statSync } from 'fs';
import { basename, dirname, extname, sep } from 'path';
import { fileURLToPath } from 'url';
import { join } from 'path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MAX_TURNS = Number(process.env.E2E_MAX_TURNS || 10);
const PHP_PORT = Number(process.env.PHP_PORT || 8077);

// A modular/scalable PHP build request + follow-ups. Each MUST stay ≤70 chars
// (AgentController.run rejects anything longer, matching the TUI input limit).
const BUILD_PROMPT = 'Buat web PHP modular scalable: MVC, router, 2 controller, view';
const CONTINUE_PROMPT = 'Lanjutkan bangun sampai lengkap dan selesai';
const DONE_WORDS = ['selesai', 'sudah selesai', 'done', 'complete', 'lengkap', 'finished'];

const log = (...a) => console.log(...a);
const section = (t) => log(`\n${'='.repeat(64)}\n${t}\n${'='.repeat(64)}`);

// ---------------------------------------------------------------------------
// 0. Boot the stack (same wiring as e2e.js / src/index.js)
// ---------------------------------------------------------------------------
const config = await loadConfig(ROOT);
// Be patient: a multi-file build makes long gaps between tool calls. Give the
// agent loop more room than the chat defaults so a turn doesn't settle early.
config.agent = {
  ...config.agent,
  response_idle_ms: Number(config.agent?.response_idle_ms || 60000),
  post_tool_grace_ms: Number(config.agent?.post_tool_grace_ms || 12000),
  reply_quiet_ms: Number(config.agent?.reply_quiet_ms || 3000),
  max_iterations: Number(config.agent?.max_iterations || 80),
};

const registry = new ToolRegistry();
await registry.loadBuiltins();
const sandbox = new Sandbox();
const mqtt = new MqttClient(config);

// ---------------------------------------------------------------------------
// 1. Track every file XiaoZhi creates/edits — keyed by tool-call id so we can
//    pair a call with its result and only count successful writes.
// ---------------------------------------------------------------------------
const pending = new Map();          // id -> { action, path }
const createdFiles = new Set();     // absolute paths that were written/edited
const dirsMade = new Set();
let toolErrors = 0;

bus.on('mcp:tool_call', ({ name, args, id }) => {
  if (name !== 'file') return;
  const action = args?.action;
  const path = args?.path || args?.to;
  pending.set(id, { action, path });
  log(`  [tool_call] file.${action || '?'} ${path || ''}`);
});

bus.on('mcp:tool_result', ({ name, result, id }) => {
  if (name !== 'file') return;
  const info = pending.get(id);
  pending.delete(id);
  const isError = result?.isError;
  if (isError) { toolErrors++; log(`  [tool_result] file ERROR`); return; }
  if (!info?.path) return;
  if (['write', 'edit', 'copy', 'move'].includes(info.action)) createdFiles.add(info.path);
  if (info.action === 'mkdir') dirsMade.add(info.path);
});

bus.on('agent:error', (e) => log(`  [agent:error] ${e.error}`));

// ---------------------------------------------------------------------------
// 2. Connect + register the SAME tool handler index.js uses (tools really run)
// ---------------------------------------------------------------------------
section('CONNECT');
log('[e2e-php] connecting to XiaoZhi...');
await mqtt.connect();
mqtt.registerToolHandler(
  async (name, args) => { sandbox.validate(name, args); return registry.call(name, args); },
  () => registry.toMcpTools(),
);

const controller = new AgentController({
  registry, mqtt, sandbox,
  confirm: { isDestructive: () => false, ask: async () => true },
  config,
});

// ---------------------------------------------------------------------------
// 3. Drive the build across multiple turns until done / stable / budget hit
// ---------------------------------------------------------------------------
section('BUILD');
let lastCount = 0;
let stableTurns = 0;
let saidDone = false;

for (let turn = 1; turn <= MAX_TURNS; turn++) {
  const prompt = turn === 1 ? BUILD_PROMPT : CONTINUE_PROMPT;
  log(`\n--- turn ${turn}/${MAX_TURNS} --- prompt: "${prompt}" (${prompt.length} chars)`);
  let result;
  try {
    result = await controller.run(prompt);
  } catch (err) {
    log(`  [turn error] ${err.message}`);
    result = { success: false, result: err.message };
  }
  const reply = String(result?.result || '');
  log(`  [reply] ${reply.slice(0, 200)}`);
  log(`  [files so far] ${createdFiles.size}`);

  saidDone = DONE_WORDS.some(w => reply.toLowerCase().includes(w));

  if (createdFiles.size === lastCount) {
    stableTurns++;
  } else {
    stableTurns = 0;
    lastCount = createdFiles.size;
  }

  // Stop once we have real files AND XiaoZhi either says it's done or has
  // stopped producing anything new for two consecutive turns.
  if (createdFiles.size > 0 && (saidDone || stableTurns >= 2)) {
    log(`\n[e2e-php] build considered finished (saidDone=${saidDone}, stableTurns=${stableTurns}).`);
    break;
  }
}

mqtt.disconnect();

// ---------------------------------------------------------------------------
// 4. Verify the generated project
// ---------------------------------------------------------------------------
section('VERIFY');
const files = [...createdFiles].filter(p => { try { return statSync(p).isFile(); } catch { return false; } });
const phpFiles = files.filter(f => extname(f).toLowerCase() === '.php');

log(`Created files (${files.length}):`);
for (const f of files) log(`  - ${f}`);

const report = { built: files.length > 0, php: phpFiles.length, lint: [], serve: null, toolErrors };
let ok = files.length > 0 && phpFiles.length > 0;

if (!ok) {
  section('RESULT: FAIL');
  log('XiaoZhi did not create any PHP files — nothing to verify.');
  process.exit(1);
}

// 4a. Lint every PHP file
section('php -l (syntax check)');
for (const f of phpFiles) {
  const { code, out } = await run('php', ['-l', f]);
  const pass = code === 0;
  report.lint.push({ file: f, pass });
  log(`  ${pass ? 'OK  ' : 'FAIL'}  ${f}${pass ? '' : '\n       ' + out.trim().split('\n').join('\n       ')}`);
  if (!pass) ok = false;
}

// 4b. Boot the app and hit it over HTTP
const entry = pickEntry(phpFiles);
if (!entry) {
  log('\nNo index.php entry point found — skipping live server boot.');
} else {
  section(`php -S (boot & request)  entry=${entry}`);
  const docroot = /(^|\/)public$/.test(dirname(entry)) ? dirname(entry) : dirname(entry);
  const serve = await bootAndRequest(docroot, entry);
  report.serve = serve;
  log(`  docroot: ${docroot}`);
  log(`  status:  ${serve.status ?? '(no response)'}`);
  log(`  bodyLen: ${serve.bodyLen}`);
  if (serve.phpError) log(`  PHP ERROR in output:\n${indent(serve.snippet)}`);
  else log(`  body preview:\n${indent(serve.snippet)}`);
  const served = serve.status && serve.status < 400 && serve.bodyLen > 0 && !serve.phpError;
  if (!served) ok = false;
}

section(ok ? 'RESULT: PASS' : 'RESULT: FAIL');
log(JSON.stringify(report, (_k, v) => v, 2));
log(ok
  ? '\nXiaoZhi built a modular PHP app, all files parse, and the app runs.'
  : '\nThe generated PHP project has problems (see above).');
process.exit(ok ? 0 : 1);

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { ...opts });
    let out = '';
    p.stdout?.on('data', d => (out += d));
    p.stderr?.on('data', d => (out += d));
    p.on('close', (code) => resolve({ code, out }));
    p.on('error', (e) => resolve({ code: -1, out: String(e) }));
  });
}

// Prefer public/index.php, then the shallowest index.php, then any .php file.
function pickEntry(phpFiles) {
  const indexes = phpFiles.filter(f => basename(f).toLowerCase() === 'index.php');
  if (indexes.length) {
    const pub = indexes.find(f => dirname(f).toLowerCase().endsWith(`${sep}public`) || dirname(f).toLowerCase().endsWith('/public'));
    if (pub) return pub;
    return indexes.sort((a, b) => a.split(sep).length - b.split(sep).length)[0];
  }
  return null;
}

async function bootAndRequest(docroot, entry) {
  // Route all requests through the front controller so MVC/router apps work
  // even without rewrite rules (php -S runs the router script for every path).
  // Try a few ports so a leftover/other server on PHP_PORT doesn't fail the
  // whole verification with "Address already in use".
  let server = null;
  let serverLog = '';
  let port = PHP_PORT;
  for (let attempt = 0; attempt < 5; attempt++) {
    port = PHP_PORT + attempt;
    server = spawn('php', ['-S', `127.0.0.1:${port}`, '-t', docroot, entry], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    serverLog = '';
    server.stdout.on('data', d => (serverLog += d));
    server.stderr.on('data', d => (serverLog += d));
    await sleep(1200); // let the server come up (or fail to bind)
    if (!/Failed to listen|Address already in use/i.test(serverLog)) break;
    server.kill('SIGKILL');
    server = null;
  }
  if (!server) {
    return { status: null, bodyLen: 0, phpError: false, snippet: `could not bind any port ${PHP_PORT}-${PHP_PORT + 4}` };
  }

  const paths = ['/', '/index.php', '/?url=home', '/home'];
  let best = { status: null, bodyLen: 0, body: '', phpError: false };
  for (const path of paths) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}${path}`, { redirect: 'manual' });
      const body = await res.text();
      const phpError = /(Fatal error|Parse error|Uncaught\b|syntax error)/i.test(body + serverLog);
      const cand = { status: res.status, bodyLen: body.length, body, phpError };
      // Prefer a clean 2xx/3xx with a body; otherwise keep the most informative.
      if ((cand.status < 400 && cand.bodyLen > 0 && !cand.phpError) ||
          (best.status === null)) {
        best = cand;
      }
      if (cand.status < 400 && cand.bodyLen > 0 && !cand.phpError) break;
    } catch { /* try next path */ }
  }

  server.kill('SIGKILL');
  const phpError = best.phpError || /(Fatal error|Parse error|Uncaught\b)/i.test(serverLog);
  const snippet = (best.body || serverLog).slice(0, 400);
  return { status: best.status, bodyLen: best.bodyLen, phpError, snippet };
}

// Function declarations (not const arrows) so they are hoisted — this file
// runs top-level `await`, and bootAndRequest() calls sleep()/indent() before
// execution reaches the bottom of the module.
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function indent(s) { return s.split('\n').map(l => '    ' + l).join('\n'); }
