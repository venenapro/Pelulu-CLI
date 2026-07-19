/**
 * Watch Tool — file change monitoring (1 MCP tool, 3 actions)
 * Actions: start, stop, status
 */
import { watch as fsWatch } from 'fs';
import { resolve, join } from 'path';
import { homedir } from 'os';
import { readdir, stat } from 'fs/promises';
import { log } from '../core/logger.js';
import { bus } from '../core/event-bus.js';

const HOME = homedir();
const _watchers = new Map();

function safe(p) {
  return resolve((p || '.').replace(/^~(?=$|[/\\])/g, HOME));
}

const ACTIONS = {
  start: {
    required: ['path'],
    handler: async ({ path, recursive, filter }) => {
      const abs = safe(path);
      if (_watchers.has(abs)) throw new Error(`Already watching: ${abs}`);

      const watcher = fsWatch(abs, { recursive: recursive !== false }, (eventType, filename) => {
        if (filter && !filename.includes(filter)) return;
        const event = { type: eventType, file: filename, path: abs, ts: Date.now() };
        log('watch', `📁 ${eventType}: ${filename}`);
        bus.emit('file:change', event);
      });

      _watchers.set(abs, { watcher, started: Date.now() });
      log('watch', `👁️ Watching: ${abs}`);
      return { watching: true, path: abs };
    },
  },

  stop: {
    required: ['path'],
    handler: async ({ path }) => {
      const abs = safe(path);
      const entry = _watchers.get(abs);
      if (!entry) throw new Error(`Not watching: ${abs}`);
      entry.watcher.close();
      _watchers.delete(abs);
      return { stopped: true, path: abs };
    },
  },

  status: {
    required: [],
    handler: async () => {
      const watchers = [];
      for (const [path, entry] of _watchers) {
        watchers.push({ path, uptime: Math.round((Date.now() - entry.started) / 1000) });
      }
      return { count: watchers.length, watchers };
    },
  },
};

const actionNames = Object.keys(ACTIONS);

export default {
  name: 'watch',
  description: 'File monitoring: start, stop, status',
  actions: actionNames.map(name => ({ name, required: ACTIONS[name].required })),
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: actionNames },
      path: { type: 'string', description: 'Directory to watch' },
      recursive: { type: 'boolean', description: 'Watch recursively' },
      filter: { type: 'string', description: 'Filename filter' },
    },
    required: ['action'],
  },
  async handler({ action, ...params }) {
    const a = ACTIONS[action];
    if (!a) throw new Error(`Unknown action: ${action}`);
    for (const f of a.required) {
      if (params[f] === undefined) throw new Error(`Missing required: ${f}`);
    }
    return a.handler(params);
  },
};
