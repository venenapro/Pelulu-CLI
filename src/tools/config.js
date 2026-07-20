/**
 * Config Tool — runtime configuration management (1 MCP tool, 4 actions)
 * Actions: get, set, list, reset
 */
import { getConfig, saveConfig } from '../core/config.js';
import { log } from '../core/logger.js';

const EDITABLE = ['tools.shell_timeout', 'tools.max_output', 'tools.auto_format', 'agent.workspace'];

function getNested(obj, path) {
  return path.split('.').reduce((o, k) => o?.[k], obj);
}

function setNested(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  const target = keys.reduce((o, k) => o[k] = o[k] || {}, obj);
  target[last] = value;
}

const ACTIONS = {
  get: {
    required: ['key'],
    handler: async ({ key }) => {
      const config = getConfig();
      const value = getNested(config, key);
      if (value === undefined) throw new Error(`Config key not found: ${key}`);
      return { key, value };
    },
  },

  set: {
    required: ['key', 'value'],
    handler: async ({ key, value }) => {
      if (!EDITABLE.includes(key)) throw new Error(`Cannot edit: ${key}. Editable: ${EDITABLE.join(', ')}`);
      const config = getConfig();
      setNested(config, key, value);
      await saveConfig(config._root, config);
      log('config', `[CFG] Set ${key} = ${value}`);
      return { key, value, saved: true };
    },
  },

  list: {
    required: [],
    handler: async () => {
      const config = getConfig();
      const { _root, _path, ...clean } = config;
      return { config: clean, editable: EDITABLE };
    },
  },

  reset: {
    required: [],
    handler: async () => {
      const config = getConfig();
      config.tools = { shell_timeout: 30000, max_output: 10000 };
      await saveConfig(config._root, config);
      return { reset: true };
    },
  },
};

const actionNames = Object.keys(ACTIONS);

export default {
  name: 'config',
  description: 'Runtime config: get, set, list, reset',
  actions: actionNames.map(name => ({ name, required: ACTIONS[name].required })),
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: actionNames },
      key: { type: 'string', description: 'Config key (dot notation)' },
      value: { type: 'string', description: 'Value to set' },
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
