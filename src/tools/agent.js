/**
 * Agent Tool — Expose agent capabilities (1 MCP tool, 5 actions)
 * Actions: run, status, abort, reset, context
 */
import { bus } from '../core/event-bus.js';

let agentController = null;

export function setAgentController(controller) {
  agentController = controller;
}

const ACTIONS = {
  run: {
    required: ['task'],
    handler: async ({ task }) => {
      if (!agentController) throw new Error('Agent not initialized');
      const result = await agentController.run(task, { generatePlan: false });
      return { success: result.success, result: result.result, iterations: result.iterations };
    },
  },

  status: {
    required: [],
    handler: async () => {
      if (!agentController) throw new Error('Agent not initialized');
      return agentController.summary;
    },
  },

  abort: {
    required: [],
    handler: async () => {
      if (!agentController) throw new Error('Agent not initialized');
      agentController.abort();
      return { aborted: true };
    },
  },

  reset: {
    required: [],
    handler: async () => {
      if (!agentController) throw new Error('Agent not initialized');
      agentController.reset();
      return { reset: true };
    },
  },

  context: {
    required: [],
    handler: async () => {
      if (!agentController) throw new Error('Agent not initialized');
      return { context: await agentController.getContext() };
    },
  },
};

const actionNames = Object.keys(ACTIONS);

export default {
  name: 'agent',
  description: 'Agent: run task, status, abort, reset, context',
  actions: actionNames.map(name => ({ name, required: ACTIONS[name].required })),
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string' },
      task: { type: 'string' },
    },
    required: ['action'],
  },
  async handler({ action, ...params }) {
    const a = ACTIONS[action];
    if (!a) throw new Error(`Unknown: ${action}. Use: ${actionNames.join(', ')}`);
    for (const f of a.required) {
      if (params[f] === undefined) throw new Error(`Missing: ${f}`);
    }
    return a.handler(params);
  },
};
