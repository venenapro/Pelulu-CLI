#!/usr/bin/env node
/**
 * scripts/e2e.js — End-to-end agent test against the REAL XiaoZhi broker
 * ----------------------------------------------------------------------
 * Boots the actual app stack (ToolRegistry + MqttClient + AgentController) the
 * same way src/index.js does, connects to XiaoZhi, sends ONE prompt, and prints
 * the streamed events plus the final result. Unlike probe.js (which only tests
 * the transport), this exercises the full agent loop AND live tool execution,
 * so it catches bugs in agent-loop.js / mcp-handler.js / tool wiring.
 *
 * Usage:  node scripts/e2e.js ["your prompt"]
 * Example (tool call):  node scripts/e2e.js "buat file hello.txt isi Halo"
 */
import { loadConfig } from '../src/core/config.js';
import { ToolRegistry } from '../src/core/tool-registry.js';
import { Sandbox } from '../src/core/sandbox.js';
import { MqttClient } from '../src/mcp/mqtt-client.js';
import { AgentController } from '../src/agent/agent-controller.js';
import { bus } from '../src/core/event-bus.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PROMPT = process.argv[2] || 'halo';

const config = await loadConfig(ROOT);

// 1. Tools
const registry = new ToolRegistry();
await registry.loadBuiltins();

// 2. Sandbox (validates tool args before execution)
const sandbox = new Sandbox();

// 3. Connect to XiaoZhi
const mqtt = new MqttClient(config);

// Trace every relevant event so we can see the full turn play out
bus.on('mcp:tool_call', ({ name, args }) => console.log(`  [tool_call] ${name}.${args?.action || ''}`));
bus.on('mcp:tool_result', ({ name, result }) => console.log(`  [tool_result] ${name} ${result?.isError ? 'ERROR' : 'ok'}`));
bus.on('tts:sentence', (t) => console.log(`  [tts] ${t}`));
bus.on('llm:text', (t) => console.log(`  [llm] ${t}`));
bus.on('agent:progress', (p) => console.log(`  [progress] ${p.state}: ${p.message || ''}`));
bus.on('agent:error', (e) => console.log(`  [agent:error] ${e.error}`));

console.log('[e2e] connecting...');
await mqtt.connect();

// 4. Register the SAME tool handler index.js uses, so tool calls really run
mqtt.registerToolHandler(
  async (name, args) => { sandbox.validate(name, args); return registry.call(name, args); },
  () => registry.toMcpTools(),
);

// 5. Drive one turn through the real controller
const controller = new AgentController({
  registry, mqtt, sandbox,
  confirm: { isDestructive: () => false, ask: async () => true },
  config,
});

console.log(`[e2e] prompt: "${PROMPT}"`);
const result = await controller.run(PROMPT);
console.log('\n[e2e] RESULT:', JSON.stringify(result, null, 2));

mqtt.disconnect();
process.exit(0);
