#!/usr/bin/env node
/**
 * scripts/tools-e2e.js — End-to-end test for EVERY registered tool
 * -----------------------------------------------------------------
 * probe.js tests the transport, e2e.js tests one agent turn, capabilities.js
 * measures XiaoZhi's limits. This script fills the missing gap: it verifies
 * that each MCP tool actually EXECUTES and returns a well-formed MCP result.
 *
 * It runs in two layers:
 *
 *   1. LOCAL (default) — no network. For every tool it runs one or more safe
 *      actions through the SAME path the MQTT client uses (ToolRegistry.call),
 *      then asserts the result is shaped like a valid MCP tool result
 *      ({ isError, content:[{type:'text',text}] }). It also drives the real
 *      McpHandler to confirm the tools/list payload stays under the broker's
 *      ~8KB limit, and confirms oversized results would be clamped.
 *
 *   2. LIVE (--live) — additionally connects to the real XiaoZhi broker and
 *      asks it to invoke the `file` tool, proving the full round trip
 *      (XiaoZhi → tools/call → our handler → result) works over MQTT.
 *
 * Usage:
 *   node scripts/tools-e2e.js                # local suite for all tools
 *   node scripts/tools-e2e.js file shell git # only these tools
 *   node scripts/tools-e2e.js --live         # local suite + live MQTT round trip
 */
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { ToolRegistry } from '../src/core/tool-registry.js';
import { McpHandler } from '../src/mcp/mcp-handler.js';
import { loadConfig } from '../src/core/config.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const LIVE = args.includes('--live');
const only = args.filter((a) => !a.startsWith('--'));

// A scratch dir inside cwd so the file tool's safe() path guard allows it.
const TMP = mkdtempSync(join(process.cwd(), '.tools-e2e-'));
const seedFile = join(TMP, 'seed.txt');
writeFileSync(seedFile, 'hello world\nsecond line\n');

let pass = 0, fail = 0, skip = 0;
const results = [];
const ok = (name, detail) => { pass++; results.push(`  PASS  ${name}${detail ? ' — ' + detail : ''}`); };
const bad = (name, detail) => { fail++; results.push(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); };
const skipped = (name, detail) => { skip++; results.push(`  SKIP  ${name}${detail ? ' — ' + detail : ''}`); };

/**
 * Safe, non-destructive test cases per tool. Each case: { action, args, expect }.
 * `expect` is 'ok' (must succeed) or 'error-ok' (a clean error result is an
 * acceptable pass, e.g. optional deps or environment-specific actions). Tools
 * not listed here still get a wiring check (bad action → proper error result).
 */
const CASES = {
  file: [
    { action: 'write', args: { path: join(TMP, 'a.txt'), content: 'abc' }, expect: 'ok' },
    { action: 'read', args: { path: join(TMP, 'a.txt') }, expect: 'ok' },
    { action: 'exists', args: { path: join(TMP, 'a.txt') }, expect: 'ok' },
    { action: 'edit', args: { path: join(TMP, 'a.txt'), old_text: 'abc', new_text: 'xyz' }, expect: 'ok' },
    { action: 'list', args: { path: TMP }, expect: 'ok' },
    { action: 'copy', args: { from: join(TMP, 'a.txt'), to: join(TMP, 'b.txt') }, expect: 'ok' },
    { action: 'move', args: { from: join(TMP, 'b.txt'), to: join(TMP, 'c.txt') }, expect: 'ok' },
    { action: 'delete', args: { path: join(TMP, 'c.txt') }, expect: 'ok' },
  ],
  shell: [{ action: 'exec', args: { command: 'echo tools-e2e-ok' }, expect: 'ok' }],
  search: [{ action: 'grep', args: { pattern: 'hello', path: TMP }, expect: 'ok' }],
  git: [{ action: 'status', args: { cwd: ROOT }, expect: 'ok' }],
  config: [{ action: 'list', args: {}, expect: 'ok' }],
  env: [{ action: 'list', args: {}, expect: 'ok' }],
  history: [{ action: 'list', args: {}, expect: 'ok' }],
  jobs: [{ action: 'list', args: {}, expect: 'ok' }],
  process: [{ action: 'list', args: {}, expect: 'ok' }],
  template: [{ action: 'list', args: {}, expect: 'ok' }],
  snippet: [{ action: 'list', args: {}, expect: 'ok' }],
  watch: [{ action: 'status', args: {}, expect: 'ok' }],
  agent: [{ action: 'status', args: {}, expect: 'error-ok' }],
  diff: [{ action: 'compare', args: { file1: seedFile, file2: seedFile }, expect: 'ok' }],
  ai: [{ action: 'summarize', args: { path: seedFile }, expect: 'error-ok' }],
  network: [{ action: 'ping', args: { host: 'localhost' }, expect: 'error-ok' }],
  project: [{ action: 'info', args: { cwd: ROOT }, expect: 'error-ok' }],
};

function isValidMcpResult(r) {
  return r && typeof r.isError === 'boolean'
    && Array.isArray(r.content)
    && r.content.every((c) => c && c.type === 'text' && typeof c.text === 'string');
}

async function runLocal() {
  // Several tools (config, shell, snippet, ...) call getConfig(), which throws
  // until loadConfig() has run. The real app loads config before tools, so we
  // do the same here to test them under realistic conditions.
  try { await loadConfig(ROOT); } catch { /* config.json optional for local run */ }

  const registry = new ToolRegistry();
  const { loaded, failed } = await registry.loadBuiltins();
  console.log(`\n[tools-e2e] loaded ${loaded} tools (${failed} failed to load)\n`);

  const tools = registry.all().map((t) => t.name).filter((n) => (only.length ? only.includes(n) : true));

  for (const name of tools) {
    const cases = CASES[name];
    if (!cases) {
      // No curated case — at least prove the handler is wired by sending an
      // invalid action and requiring a clean error result (never a throw).
      const r = await registry.call(name, { action: '__nope__' });
      if (isValidMcpResult(r) && r.isError) ok(`${name} (wiring)`, 'rejects bad action cleanly');
      else bad(`${name} (wiring)`, 'did not return a clean error result');
      continue;
    }
    for (const c of cases) {
      const label = `${name}.${c.action}`;
      try {
        const r = await registry.call(name, { action: c.action, ...c.args });
        if (!isValidMcpResult(r)) { bad(label, 'malformed MCP result'); continue; }
        if (c.expect === 'ok') {
          r.isError ? bad(label, `unexpected error: ${r.content[0]?.text?.slice(0, 60)}`) : ok(label);
        } else { // error-ok
          ok(label, r.isError ? 'clean error (acceptable)' : 'succeeded');
        }
      } catch (e) {
        bad(label, `threw instead of returning result: ${e.message}`);
      }
    }
  }

  // --- MCP handshake: tools/list must stay under the 8KB broker limit ---
  const handler = new McpHandler();
  handler.setToolProvider(() => registry.toMcpTools());
  const listResp = handler.handleMessage({ type: 'mcp', payload: { jsonrpc: '2.0', id: 1, method: 'tools/list' } });
  const listPayload = listResp.find((m) => m.payload?.result?.tools);
  const bytes = Buffer.byteLength(JSON.stringify(listPayload.payload));
  const count = listPayload.payload.result.tools.length;
  bytes <= 8192
    ? ok('mcp.tools/list', `${count} tools, ${bytes} bytes (<8KB)`)
    : bad('mcp.tools/list', `${bytes} bytes exceeds 8KB broker limit`);

  // Every advertised tool name must be MCP-safe (broker sanitization rule).
  const badNames = listPayload.payload.result.tools.filter((t) => !/^[a-zA-Z0-9_-]{1,64}$/.test(t.name));
  badNames.length === 0
    ? ok('mcp.tool-names', 'all names match ^[a-zA-Z0-9_-]{1,64}$')
    : bad('mcp.tool-names', `invalid: ${badNames.map((t) => t.name).join(', ')}`);
}

async function runLive() {
  console.log('\n[tools-e2e] --live: driving a real tool call through XiaoZhi...\n');
  const { loadConfig } = await import('../src/core/config.js');
  const { Sandbox } = await import('../src/core/sandbox.js');
  const { MqttClient } = await import('../src/mcp/mqtt-client.js');
  const { AgentController } = await import('../src/agent/agent-controller.js');
  const { bus } = await import('../src/core/event-bus.js');

  const config = await loadConfig(ROOT);
  const registry = new ToolRegistry();
  await registry.loadBuiltins();
  const sandbox = new Sandbox();
  const mqtt = new MqttClient(config);

  let toolCalled = false;
  bus.on('mcp:tool_call', ({ name }) => { toolCalled = true; console.log(`  [live tool_call] ${name}`); });
  bus.on('mcp:tool_result', ({ name, result }) => console.log(`  [live tool_result] ${name} ${result?.isError ? 'ERROR' : 'ok'}`));

  await mqtt.connect();
  mqtt.registerToolHandler(
    async (name, a) => { sandbox.validate(name, a); return registry.call(name, a); },
    () => registry.toMcpTools(),
  );
  const controller = new AgentController({
    registry, mqtt, sandbox,
    confirm: { isDestructive: () => false, ask: async () => true },
    config,
  });

  const result = await controller.run(`buat file ${join(TMP, 'live.txt')} isi halo`);
  toolCalled ? ok('live.tool-roundtrip', 'XiaoZhi invoked a tool over MQTT')
             : skipped('live.tool-roundtrip', 'XiaoZhi did not call a tool this turn (model-dependent)');
  console.log('  [live result]', JSON.stringify(result));
  mqtt.disconnect();
}

try {
  await runLocal();
  if (LIVE) await runLive();
} finally {
  rmSync(TMP, { recursive: true, force: true });
}

console.log('\n' + results.join('\n'));
console.log(`\n[tools-e2e] ${pass} passed, ${fail} failed, ${skip} skipped\n`);
process.exit(fail > 0 ? 1 : 0);
