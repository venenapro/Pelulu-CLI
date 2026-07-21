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
    // Trimmed descriptions to stay under XiaoZhi broker 8KB limit
    const desc = {
      agent: 'Agent: spawn, list, status',
      ai: 'Code analysis, summarize, diff',
      config: 'Config: get, set, list, reset',
      diff: 'File comparison: compare, patch',
      env: 'Env variables: get, set, list',
      file: 'File ops: read, write, edit, delete, copy',
      git: 'Git: init, clone, status, diff, commit, push',
      history: 'Tool history: list, clear, stats',
      jobs: 'Poll background jobs: list, status, wait, result, cancel',
      network: 'Network: fetch, download, ping',
      process: 'Process: list, info, kill, top',
      project: 'Project: init, build, test, lint',
      search: 'Search: grep, find, web fetch',
      shell: 'Shell: exec, background, ps, kill',
      snippet: 'Snippets: save, load, list, delete',
      template: 'Templates: list, create, info',
      watch: 'File watch: start, stop, status',
    };
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
      return { name: t.name, description: desc[t.name] || t.description, inputSchema: compact };
    });
  }

  async call(name, args = {}) {
    const tool = this.#tools.get(name);
    if (!tool) return { isError: true, content: [{ type: 'text', text: `Unknown tool: ${name}` }] };
    try {
      const result = await tool.handler(args, this._toolsRef());
      return { isError: false, content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result) }] };
    } catch (e) {
      return { isError: true, content: [{ type: 'text', text: e.message }] };
    }
  }

  /** Call a tool and return parsed result (for internal tool-to-tool calls) */
  async callParsed(name, args = {}) {
    const tool = this.#tools.get(name);
    if (!tool) throw new Error(`Unknown tool: ${name}`);
    return await tool.handler(args, this._toolsRef());
  }

  /**
   * The reference handed to every tool handler. Beyond `call`, it exposes tool
   * discovery (`has` / `names`) so orchestrator tools can adapt dynamically to
   * whatever tools are actually loaded instead of hardcoding a fixed pipeline.
   */
  _toolsRef() {
    return {
      call: (toolName, toolArgs) => this.callParsed(toolName, toolArgs),
      has: (toolName) => this.#tools.has(toolName),
      names: () => [...this.#tools.keys()],
    };
  }

  async shutdown() {
    for (const tool of this.#tools.values()) {
      if (tool.shutdown) await tool.shutdown();
    }
    this.#tools.clear();
  }
}
