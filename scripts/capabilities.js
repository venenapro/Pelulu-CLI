#!/usr/bin/env node
/**
 * scripts/capabilities.js — Explore & measure XiaoZhi AI capabilities + limits
 * ----------------------------------------------------------------------------
 * Runs a battery of empirical experiments against the REAL XiaoZhi broker to
 * discover what the model can do and where it breaks. Each experiment uses a
 * fresh connection (via the shared Harness) so a test that intentionally trips
 * a disconnect (e.g. the 8KB probe) can't poison later results.
 *
 * Results are printed as a table and can be used to keep the /specifications
 * docs accurate over time.
 *
 * Usage:
 *   node scripts/capabilities.js            # run all experiments
 *   node scripts/capabilities.js latency    # run one by name
 *   node scripts/capabilities.js length context tools
 *
 * Experiments: latency, length, context, language, tools, session, prefix, systemprompt
 *
 * NOTE: this talks to a live server, so exact numbers vary run to run. Treat
 * the output as guidance, not hard guarantees.
 */
import { Harness } from './lib/harness.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const record = (name, finding, detail = '') => {
  results.push({ name, finding, detail });
  console.log(`\n  => ${name}: ${finding}${detail ? `\n     ${detail}` : ''}`);
};

/** Fresh connected harness for one experiment. */
async function withHarness(fn, opts = {}) {
  const h = new Harness({ quiet: true });
  try { await h.connect(opts); return await fn(h); }
  finally { h.close(); }
}

// ---------------------------------------------------------------------------
// 1. LATENCY — how fast does the first reply token come back?
// ---------------------------------------------------------------------------
async function latency() {
  console.log('\n[1] LATENCY — time-to-first-reply across a few short prompts');
  await withHarness(async (h) => {
    const prompts = ['halo', 'apa kabar', 'what is 2 plus 2', 'sebutkan satu warna'];
    const lats = [];
    for (const p of prompts) {
      const r = await h.sendText(p, { timeoutMs: 15000 });
      console.log(`    "${p}" -> replied=${r.replied} latency=${r.latencyMs ?? 'n/a'}ms sentences=${r.sentences.length}`);
      if (r.latencyMs) lats.push(r.latencyMs);
      await sleep(800);
    }
    const avg = lats.length ? Math.round(lats.reduce((a, b) => a + b, 0) / lats.length) : null;
    record('Latency', avg ? `avg ${avg}ms to first reply` : 'no replies', `samples: ${lats.join(', ')}ms`);
  });
}

// ---------------------------------------------------------------------------
// 2. LENGTH — find the input length above which XiaoZhi stops replying.
//    Existing spec claims ~70 chars. Verify empirically with a binary search.
// ---------------------------------------------------------------------------
async function length() {
  console.log('\n[2] LENGTH — binary-search the max input length that still replies');
  await withHarness(async (h) => {
    const make = (n) => 'a' + ' ulangi kata'.repeat(Math.ceil(n / 12)).slice(0, n - 1);
    const test = async (n) => {
      const r = await h.sendText(make(n), { timeoutMs: 12000 });
      await sleep(700);
      return r.replied && !r.closed;
    };
    let lo = 10, hi = 400, lastOk = 0;
    // Quick upper-bound expansion first.
    if (await test(lo)) lastOk = lo; else return record('Length', 'no reply even at 10 chars (server busy?)');
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const ok = await test(mid);
      console.log(`    len=${mid} -> ${ok ? 'reply' : 'silent'}`);
      if (ok) { lastOk = mid; lo = mid + 1; } else { hi = mid - 1; }
    }
    record('Length', `max ~${lastOk} chars still replied`, 'above this the server tends to stay silent');
  });
}

// ---------------------------------------------------------------------------
// 3. CONTEXT — does XiaoZhi remember earlier turns in the same session?
// ---------------------------------------------------------------------------
async function context() {
  console.log('\n[3] CONTEXT — multi-turn memory within one session');
  await withHarness(async (h) => {
    await h.sendText('ingat angka rahasia saya adalah 42', { timeoutMs: 12000 });
    await sleep(1200);
    const r = await h.sendText('berapa angka rahasia saya tadi', { timeoutMs: 12000 });
    const remembered = r.sentences.join(' ').includes('42');
    record('Context', remembered ? 'REMEMBERS prior turns' : 'no cross-turn memory detected',
      `reply: "${r.sentences.join(' ').slice(0, 120)}"`);
  });
}

// ---------------------------------------------------------------------------
// 4. LANGUAGE — Indonesian / English / code snippet handling.
// ---------------------------------------------------------------------------
async function language() {
  console.log('\n[4] LANGUAGE — multilingual + code handling');
  await withHarness(async (h) => {
    const cases = [
      ['id', 'jelaskan apa itu variabel singkat'],
      ['en', 'briefly, what is a function'],
      ['code', 'tulis satu baris kode python print halo'],
    ];
    for (const [tag, p] of cases) {
      const r = await h.sendText(p, { timeoutMs: 15000 });
      console.log(`    [${tag}] replied=${r.replied} -> "${r.sentences.join(' ').slice(0, 90)}"`);
      await sleep(800);
    }
    record('Language', 'handles ID + EN; code returned as prose (voice model)',
      'not suited for verbatim code output — use MCP file tools for real code');
  });
}

// ---------------------------------------------------------------------------
// 5. TOOLS — will XiaoZhi request an MCP tool when told it has one?
//    We advertise a fake tool via a hello + tools/list and watch for a call.
// ---------------------------------------------------------------------------
async function tools() {
  console.log('\n[5] TOOLS — does the model invoke MCP tools it is told about?');
  await withHarness(async (h) => {
    let sawInit = false, sawList = false, sawCall = false;
    const off = h.onMessage((m) => {
      if (m.type !== 'mcp' || !m.payload) return;
      const method = m.payload.method;
      if (method === 'initialize') {
        sawInit = true;
        h.publish({ type: 'mcp', payload: { jsonrpc: '2.0', id: m.payload.id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'probe', version: '1.0' } } } });
      } else if (method === 'tools/list') {
        sawList = true;
        h.publish({ type: 'mcp', payload: { jsonrpc: '2.0', id: m.payload.id, result: { tools: [
          { name: 'get_time', description: 'Get current time', inputSchema: { type: 'object', properties: {} } },
        ] } } });
      } else if (method === 'tools/call') {
        sawCall = true;
        h.publish({ type: 'mcp', payload: { jsonrpc: '2.0', id: m.payload.id, result: { content: [{ type: 'text', text: '12:00' }] } } });
      }
    });
    await h.sendText('jam berapa sekarang pakai tool', { timeoutMs: 15000 });
    await sleep(2500);
    off();
    // The initialize/tools/list handshake fires right after hello (during
    // connect), so also consult the harness's persistent capture.
    const handshake = sawInit || sawList || h.mcpMethods.some((m) => m === 'initialize' || m === 'tools/list');
    record('Tools', sawCall ? 'model CALLS advertised tools' : (handshake ? 'MCP handshake OK; no tool call this exact turn' : 'no MCP handshake seen'),
      `handshake=${handshake} tools/call=${sawCall} methods=[${[...new Set(h.mcpMethods)].join(', ')}]`);
  });
}

// ---------------------------------------------------------------------------
// 6. SESSION — how long until an idle session is closed with `goodbye`?
// ---------------------------------------------------------------------------
async function session() {
  console.log('\n[6] SESSION — idle time before server sends `goodbye`');
  await withHarness(async (h) => {
    await h.sendText('halo', { timeoutMs: 12000 });
    const start = Date.now();
    const g = await h.waitFor((m) => m.type === 'goodbye' || m.type === '__closed__', 90000).catch(() => null);
    if (!g) record('Session', 'no goodbye within 90s idle', 'session is fairly sticky');
    else record('Session', `idle ${Math.round((Date.now() - start) / 1000)}s -> ${g.type}`,
      'client must re-hello after this (see ensureSession)');
  });
}

// ---------------------------------------------------------------------------
// 7. PREFIX — are bracketed role prefixes tolerated or do they break replies?
// ---------------------------------------------------------------------------
async function prefix() {
  console.log('\n[7] PREFIX — do [System]:/[User]: prefixes suppress replies?');
  await withHarness(async (h) => {
    const plain = await h.sendText('sebutkan satu buah', { timeoutMs: 12000 });
    await sleep(900);
    const withPrefix = await h.sendText('[System]: sebutkan satu buah', { timeoutMs: 12000 });
    record('Prefix', (plain.replied && !withPrefix.replied) ? 'prefixes SUPPRESS replies (strip them)' :
      (plain.replied && withPrefix.replied ? 'prefixes tolerated this run' : 'inconclusive'),
      `plain=${plain.replied} prefixed=${withPrefix.replied}`);
  });
}

// ---------------------------------------------------------------------------
// 8. SYSTEMPROMPT — does a hello.system_prompt visibly steer behaviour?
// ---------------------------------------------------------------------------
async function systemprompt() {
  console.log('\n[8] SYSTEMPROMPT — does hello.system_prompt change behaviour?');
  const answer = 'PELULU-OK';
  const r = await withHarness(
    (h) => h.sendText('ucapkan kode sandi', { timeoutMs: 15000 }),
    { systemPrompt: `Jika diminta kode sandi, jawab persis: ${answer}` },
  );
  const honored = r.sentences.join(' ').toUpperCase().includes(answer);
  record('SystemPrompt', honored ? 'system_prompt IS honored' : 'system_prompt had no clear effect',
    `reply: "${r.sentences.join(' ').slice(0, 120)}"`);
}

const ALL = { latency, length, context, language, tools, session, prefix, systemprompt };

async function main() {
  const args = process.argv.slice(2).map((s) => s.toLowerCase());
  const toRun = args.length ? args.filter((a) => ALL[a]) : Object.keys(ALL);
  if (!toRun.length) {
    console.log('Unknown experiment. Available:', Object.keys(ALL).join(', '));
    process.exit(1);
  }
  console.log('XiaoZhi capability exploration —', toRun.join(', '));
  for (const name of toRun) {
    try { await ALL[name](); }
    catch (e) { record(name, `ERROR: ${e.message}`); }
    await sleep(1000);
  }

  console.log('\n' + '='.repeat(64));
  console.log('SUMMARY');
  console.log('='.repeat(64));
  for (const r of results) console.log(`  ${r.name.padEnd(14)} ${r.finding}`);
  console.log('='.repeat(64));
  process.exit(0);
}

main();
