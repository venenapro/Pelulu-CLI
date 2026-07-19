/**
 * History Tool — tool call history and session info (1 MCP tool, 3 actions)
 * Actions: list, clear, stats
 */
import { log } from '../core/logger.js';

// Shared history store (injected via init)
let _history = [];

export function setHistoryStore(history) { _history = history; }

const ACTIONS = {
  list: {
    required: [],
    handler: async ({ limit }) => {
      const n = limit || 20;
      const recent = _history.slice(-n);
      return { count: recent.length, total: _history.length, calls: recent };
    },
  },

  clear: {
    required: [],
    handler: async () => {
      const count = _history.length;
      _history.length = 0;
      return { cleared: count };
    },
  },

  stats: {
    required: [],
    handler: async () => {
      const freq = {};
      for (const h of _history) {
        const key = `${h.tool}.${h.action || '-'}`;
        freq[key] = (freq[key] || 0) + 1;
      }
      const top = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 10);
      return { total: _history.length, topTools: top.map(([name, count]) => ({ name, count })) };
    },
  },
};

const actionNames = Object.keys(ACTIONS);

export default {
  name: 'history',
  description: 'Tool call history: list, clear, stats',
  actions: actionNames.map(name => ({ name, required: ACTIONS[name].required })),
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: actionNames },
      limit: { type: 'number', description: 'Number of recent calls to show' },
    },
    required: ['action'],
  },
  async handler({ action, ...params }) {
    const a = ACTIONS[action];
    if (!a) throw new Error(`Unknown action: ${action}`);
    return a.handler(params);
  },
};
