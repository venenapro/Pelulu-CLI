/**
 * Agent Tool — Expose agent capabilities as a tool (1 MCP tool, 6 actions)
 * Actions: run, plan, status, abort, reset, history
 * 
 * This tool allows the LLM to use the agent system for complex tasks.
 */
import { bus } from '../core/event-bus.js';
import { log } from '../core/logger.js';

let agentController = null;

export function setAgentController(controller) {
  agentController = controller;
}

const ACTIONS = {
  run: {
    required: ['task'],
    handler: async ({ task, generate_plan }) => {
      if (!agentController) throw new Error('Agent system not initialized');
      log('agent', `[RUN] ${task}`);

      const result = await agentController.run(task, {
        generatePlan: generate_plan !== false,
      });

      return {
        success: result.success,
        result: result.result,
        iterations: result.iterations,
        duration: result.duration,
        plan: result.plan,
      };
    },
  },

  plan: {
    required: [],
    handler: async ({ goal, steps, plan_action }) => {
      if (!agentController) throw new Error('Agent system not initialized');

      // If goal is provided, create a plan
      if (goal) {
        const plan = agentController.createPlan(goal, steps || []);
        return { created: true, plan: plan.toJSON() };
      }

      if (plan_action === 'clear') {
        agentController.clearPlan();
        return { cleared: true };
      }

      // Default: show plan status
      return { status: agentController.getPlanStatus() };
    },
  },

  status: {
    required: [],
    handler: async () => {
      if (!agentController) throw new Error('Agent system not initialized');
      return agentController.summary;
    },
  },

  abort: {
    required: [],
    handler: async () => {
      if (!agentController) throw new Error('Agent system not initialized');
      agentController.abort();
      return { aborted: true };
    },
  },

  reset: {
    required: [],
    handler: async () => {
      if (!agentController) throw new Error('Agent system not initialized');
      agentController.reset();
      return { reset: true };
    },
  },

  history: {
    required: [],
    handler: async ({ limit, condensed }) => {
      if (!agentController) throw new Error('Agent system not initialized');

      let history;
      if (condensed) {
        history = await agentController.getCondensedHistory();
      } else {
        history = agentController.getHistory();
      }

      if (limit) {
        history = history.slice(-limit);
      }

      return {
        messages: history.length,
        history: history.map(m => ({
          role: m.role,
          content: typeof m.content === 'string' ? m.content.slice(0, 500) : '(complex)',
          timestamp: m.timestamp,
        })),
      };
    },
  },

  context: {
    required: [],
    handler: async () => {
      if (!agentController) throw new Error('Agent system not initialized');
      const context = await agentController.getContext();
      return { context };
    },
  },
};

const actionNames = Object.keys(ACTIONS);

export default {
  name: 'agent',
  description: 'Agent system: run (execute task with agent loop), plan (manage plans), status, abort, reset, history, context',
  actions: actionNames.map(name => ({ name, required: ACTIONS[name].required })),
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: actionNames, description: 'Action to perform' },
      task: { type: 'string', description: 'Task to execute (for run)' },
      goal: { type: 'string', description: 'Plan goal (for plan create)' },
      steps: { type: 'array', description: 'Plan steps (for plan create)', items: { type: 'object' } },
      plan_action: { type: 'string', enum: ['create', 'clear', 'status'], description: 'Plan sub-action' },
      generate_plan: { type: 'boolean', description: 'Auto-generate plan (for run)' },
      limit: { type: 'number', description: 'History limit' },
      condensed: { type: 'boolean', description: 'Use condensed history' },
    },
    required: ['action'],
  },
  async handler({ action, ...params }) {
    const a = ACTIONS[action];
    if (!a) throw new Error(`Unknown action: ${action}. Use: ${actionNames.join(', ')}`);
    for (const field of a.required) {
      if (params[field] === undefined) throw new Error(`Missing required: ${field}`);
    }
    return a.handler(params);
  },
};
