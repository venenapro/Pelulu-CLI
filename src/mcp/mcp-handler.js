/**
 * McpHandler — MCP protocol message handler
 * Handles: initialize, tools/list, tools/call, ping
 */
import { log, debug } from '../core/logger.js';

const PROTOCOL_VERSION = '2024-11-05';

export class McpHandler {
  #toolsFn;
  #toolHandler;
  #nameMap = new Map();
  #initialized = false;
  #toolsReceived = false;

  constructor() {}

  setToolProvider(toolsFn) { this.#toolsFn = toolsFn; }
  setToolCaller(handler) { this.#toolHandler = handler; }

  get initialized() { return this.#initialized; }
  get toolsReceived() { return this.#toolsReceived; }

  reset() {
    this.#initialized = false;
    this.#toolsReceived = false;
    this.#nameMap.clear();
  }

  /**
   * Handle incoming MCP message, return response(s) to send
   */
  handleMessage(msg) {
    const p = msg.payload;
    if (!p) return [];

    const responses = [];

    if (p.method === 'initialize') {
      responses.push({
        type: 'mcp', payload: {
          jsonrpc: '2.0', id: p.id,
          result: {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: { tools: {} },
            serverInfo: { name: 'pelulu-cli', version: '1.0.0' },
          },
        },
      });
      log('mcp', 'Initialize OK');
    }

    if (p.method === 'notifications/initialized') {
      this.#initialized = true;
      log('mcp', 'Initialized ✓');
    }

    if (p.method === 'tools/list') {
      this.#toolsReceived = true;
      this.#nameMap.clear();
      let tools = (this.#toolsFn?.() || []).map(t => {
        const safeName = this._sanitize(t.name);
        this.#nameMap.set(safeName, t.name);
        return this._optimizeTool({ name: safeName, description: t.description, inputSchema: t.inputSchema || { type: 'object', properties: {} } });
      });
      // Hard guard: the XiaoZhi broker disconnects the client if the
      // tools/list payload exceeds ~8KB. Progressively shrink until it fits so
      // a newly added tool can never silently break the whole connection.
      tools = this._fitUnderLimit(tools, p.id);
      const bytes = Buffer.byteLength(JSON.stringify({ jsonrpc: '2.0', id: p.id, result: { tools } }));
      responses.push({ type: 'mcp', payload: { jsonrpc: '2.0', id: p.id, result: { tools } } });
      log('mcp', `Sent ${tools.length} tools (${bytes} bytes)`);
    }

    if (p.method === 'tools/call') {
      // Return a deferred response — caller must handle async
      const requested = p.params?.name;
      const name = this.#nameMap.get(requested) || requested;
      return [{ type: 'tool_call', id: p.id, name, args: p.params?.arguments || {} }];
    }

    if (p.method === 'ping') {
      responses.push({ type: 'mcp', payload: { jsonrpc: '2.0', id: p.id, result: {} } });
    }

    return responses;
  }

  async executeTool(name, args) {
    if (!this.#toolHandler) throw new Error('No tool handler registered');
    return this.#toolHandler(name, args);
  }

  _sanitize(name) {
    return String(name).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
  }

  /**
   * Keep the serialized tools/list under the broker's ~8KB limit.
   * Step 1: trim descriptions. Step 2: drop schema properties down to just
   * `action`. We stop as soon as we're safely under the limit.
   */
  _fitUnderLimit(tools, id, limit = 7800) {
    const size = (t) => Buffer.byteLength(JSON.stringify({ jsonrpc: '2.0', id, result: { tools: t } }));
    if (size(tools) <= limit) return tools;

    // Step 1: shorten descriptions to ~40 chars.
    let trimmed = tools.map(t => ({ ...t, description: (t.description || '').slice(0, 40) }));
    if (size(trimmed) <= limit) { log('warn', 'tools/list trimmed descriptions to fit 8KB'); return trimmed; }

    // Step 2: reduce each schema to only the `action` property.
    trimmed = trimmed.map(t => {
      const props = t.inputSchema?.properties || {};
      const minimal = props.action ? { action: props.action } : {};
      return { ...t, description: (t.description || '').slice(0, 24), inputSchema: { type: 'object', properties: minimal } };
    });
    if (size(trimmed) <= limit) { log('warn', 'tools/list reduced schemas to fit 8KB'); return trimmed; }

    // Step 3 (last resort): drop tools from the end until it fits.
    while (trimmed.length > 1 && size(trimmed) > limit) trimmed.pop();
    log('warn', `tools/list truncated to ${trimmed.length} tools to fit 8KB`);
    return trimmed;
  }

  /**
   * Optimize tool definition to stay under 8KB MQTT broker limit
   * - Keep descriptions (truncated to 200 chars)
   * - Keep enum values (critical for XiaoZhi to know valid actions)
   * - Keep required fields (critical for XiaoZhi to know what's mandatory)
   */
  _optimizeTool(tool) {
    const optimized = {
      name: tool.name,
      description: tool.description?.slice(0, 100) || '',
      inputSchema: { type: 'object', properties: {} }
    };

    // Keep first 4 properties only (to stay under 8KB MQTT limit)
    // action + first 3 params — enough for XiaoZhi to understand the tool
    if (tool.inputSchema?.properties) {
      const entries = Object.entries(tool.inputSchema.properties);
      for (const [key, val] of entries.slice(0, 4)) {
        const prop = { type: val.type };
        if (val.enum) prop.enum = val.enum;
        optimized.inputSchema.properties[key] = prop;
      }
    }

    return optimized;
  }
}
