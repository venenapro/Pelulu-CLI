/**
 * ToolRegistry — central registry for consolidated MCP tools
 *
 * Pattern: Each tool has name, description, inputSchema with "action" enum.
 * Handler receives { action, ...params } and routes to the action handler.
 *
 * This keeps us well under XiaoZhi's 32 MCP tool limit.
 */
import { readdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { log, debug } from './logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TOOLS_DIR = join(__dirname, '..', 'tools');

export class ToolRegistry {
  #tools = new Map();

  async loadBuiltins() {
    const failed = [];
    try {
      const files = await readdir(TOOLS_DIR);
      for (const file of files.filter(f => f.endsWith('.js'))) {
        try {
          const mod = await import(join(TOOLS_DIR, file));
          const tool = mod.default || mod;
          if (tool?.name && tool?.handler) this.register(tool);
        } catch (e) { failed.push(file); }
      }
    } catch (e) { /* silent */ }
    if (failed.length) log('warn', `Failed tools: ${failed.join(', ')}`);
    return { loaded: this.#tools.size, failed: failed.length };
  }

  register(tool) {
    if (!tool.name || !tool.handler) throw new Error('Tool needs name + handler');
    this.#tools.set(tool.name, tool);
  }

  get(name) { return this.#tools.get(name); }

  all() { return [...this.#tools.values()]; }

  list() {
    return this.all().map(t => ({
      name: t.name,
      description: t.description,
      actions: t.actions?.map(a => a.name) || [],
    }));
  }

  toMcpTools() {
    return this.all().map(t => {
      const schema = t.inputSchema || { type: 'object', properties: {} };
      const compact = { type: 'object', properties: {} };
      // Send all properties with type + enum only (no descriptions)
      if (schema.properties) {
        for (const [k, v] of Object.entries(schema.properties)) {
          const prop = { type: v.type };
          if (v.enum) prop.enum = v.enum;
          compact.properties[k] = prop;
        }
      }
      return { name: t.name, description: t.description, inputSchema: compact };
    });
  }

  async call(name, args = {}) {
    const tool = this.#tools.get(name);
    if (!tool) return { isError: true, content: [{ type: 'text', text: `Unknown tool: ${name}` }] };
    try {
      const result = await tool.handler(args);
      return { isError: false, content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result) }] };
    } catch (e) {
      return { isError: true, content: [{ type: 'text', text: e.message }] };
    }
  }

  async shutdown() {
    for (const tool of this.#tools.values()) {
      if (tool.shutdown) await tool.shutdown();
    }
    this.#tools.clear();
  }
}
