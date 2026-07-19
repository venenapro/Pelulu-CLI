/**
 * Env Tool — environment variable operations (1 MCP tool, 3 actions)
 */
const SENSITIVE = ['KEY', 'TOKEN', 'SECRET', 'PASSWORD', 'CREDENTIAL', 'PRIVATE'];

function isSensitive(name) {
  return SENSITIVE.some(s => name.toUpperCase().includes(s));
}

function mask(name, value) {
  if (isSensitive(name)) return '***MASKED***';
  return value;
}

const ACTIONS = {
  async get({ name }) {
    if (!name) throw new Error('env name required');
    const value = process.env[name];
    if (value === undefined) return { name, exists: false };
    return { name, value: mask(name, value), exists: true };
  },

  async set({ name, value }) {
    if (!name) throw new Error('env name required');
    if (isSensitive(name)) throw new Error('Cannot set sensitive env var via tool');
    process.env[name] = value || '';
    return { name, set: true };
  },

  async list({ filter }) {
    const vars = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (filter && !k.includes(filter.toUpperCase()) && !k.includes(filter)) continue;
      vars[k] = mask(k, v);
    }
    return { count: Object.keys(vars).length, vars };
  },
};

export default {
  name: 'env',
  description: 'Environment variables: get, set, list',
  actions: Object.keys(ACTIONS).map(name => ({ name })),
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: Object.keys(ACTIONS) },
      name: { type: 'string', description: 'Variable name' },
      value: { type: 'string', description: 'Value to set' },
      filter: { type: 'string', description: 'Filter pattern (for list)' },
    },
    required: ['action'],
  },
  async handler({ action, ...params }) {
    if (!ACTIONS[action]) throw new Error(`Unknown action: ${action}. Use: ${Object.keys(ACTIONS).join(', ')}`);
    return ACTIONS[action](params);
  },
};
