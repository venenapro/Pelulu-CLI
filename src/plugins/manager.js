/**
 * PluginManager — loads external plugins from plugins/ directory
 *
 * Plugin structure:
 *   export default { name, description, version, init?, tools?, shutdown? }
 *   tools: [{ name, description, inputSchema, handler }]
 */
import { readdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { log, debug } from '../core/logger.js';
import { bus } from '../core/event-bus.js';
import { getConfig } from '../core/config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGINS_DIR = join(__dirname);

export class PluginManager {
  #plugins = new Map();
  #registry = null;

  constructor(registry) {
    this.#registry = registry;
  }

  async load() {
    const config = getConfig();
    const disabled = new Set(config.plugins?.disabled || []);

    try {
      const files = await readdir(PLUGINS_DIR);
      for (const file of files.filter(f => f.endsWith('.js') && f !== 'manager.js')) {
        const name = file.replace('.js', '');
        if (disabled.has(name)) { debug(`Plugin "${name}" disabled`); continue; }

        try {
          const mod = await import(join(PLUGINS_DIR, file));
          const plugin = mod.default || mod;
          if (!plugin?.name) continue;

          if (plugin.init) await plugin.init({ bus, config });
          if (plugin.tools) {
            for (const tool of plugin.tools) {
              this.#registry.register(tool);
            }
          }
          this.#plugins.set(plugin.name, plugin);
          log('plugin', `  ${plugin.name} v${plugin.version || '?'} — ${plugin.description || ''}`);
        } catch (e) {
          log('warn', `Plugin "${name}" failed: ${e.message}`);
        }
      }
    } catch (e) {
      debug(`Plugins dir scan: ${e.message}`);
    }

    log('info', `${this.#plugins.size} plugins loaded`);
  }

  list() {
    return [...this.#plugins.values()].map(p => ({
      name: p.name, version: p.version || '-', description: p.description || '-',
    }));
  }

  async shutdown() {
    for (const [name, p] of this.#plugins) {
      try { if (p.shutdown) await p.shutdown(); } catch (e) { debug(`Plugin "${name}" shutdown error: ${e.message}`); }
    }
    this.#plugins.clear();
  }
}
