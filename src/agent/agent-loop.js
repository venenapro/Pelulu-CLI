/**
 * AgentLoop — Core observe→think→act cycle (OpenHands-style)
 * 
 * Handles both:
 * - Plain text responses from XiaoZhi
 * - MCP tool calls from XiaoZhi
 */
import { bus } from '../core/event-bus.js';
import { log, debug } from '../core/logger.js';

export const AgentState = {
  IDLE: 'idle',
  THINKING: 'thinking',
  ACTING: 'acting',
  FINISHED: 'finished',
  ERROR: 'error',
  WAITING_USER: 'waiting_user',
};

export class AgentLoop {
  #state = AgentState.IDLE;
  #iteration = 0;
  #maxIterations;
  #abortController = null;
  #history = [];
  #plan = null;
  #onStateChange = null;
  #onIteration = null;
  #totalTokens = 0;
  #totalCost = 0;
  #pendingResolve = null;

  constructor({ maxIterations = 100, onStateChange, onIteration } = {}) {
    this.#maxIterations = maxIterations;
    this.#onStateChange = onStateChange;
    this.#onIteration = onIteration;
  }

  get state() { return this.#state; }
  get iteration() { return this.#iteration; }
  get history() { return [...this.#history]; }
  get plan() { return this.#plan; }
  get totalTokens() { return this.#totalTokens; }
  get totalCost() { return this.#totalCost; }

  #setState(newState) {
    const old = this.#state;
    this.#state = newState;
    debug('agent', `State: ${old} → ${newState}`);
    bus.emit('agent:state', { from: old, to: newState });
    this.#onStateChange?.(old, newState);
  }

  /**
   * Run the agent loop for a user prompt
   */
  async run(userPrompt, deps) {
    const { llm, tools, context, systemPrompt, sandbox, confirm } = deps;

    this.#iteration = 0;
    this.#abortController = new AbortController();
    this.#setState(AgentState.THINKING);

    this.#history.push({
      role: 'user',
      content: userPrompt,
      timestamp: Date.now(),
    });

    try {
      while (this.#iteration < this.#maxIterations) {
        this.#iteration++;
        debug('agent', `=== Iteration ${this.#iteration} ===`);

        if (this.#abortController.signal.aborted) {
          this.#setState(AgentState.FINISHED);
          return { success: true, result: 'Aborted by user', iterations: this.#iteration };
        }

        // 1. Send message and wait for response (text or tool call)
        this.#setState(AgentState.THINKING);
        
        const response = await this.#sendAndWaitForResponse(userPrompt, llm, tools);
        
        if (!response) {
          // Timeout or no response
          this.#setState(AgentState.FINISHED);
          return { success: false, result: 'No response from LLM', iterations: this.#iteration };
        }

        // 2. Process response
        if (response.type === 'text') {
          // Plain text response - treat as final answer
          debug('agent', `Got text response: ${response.content.length} chars`);
          this.#history.push({
            role: 'assistant',
            content: response.content,
            timestamp: Date.now(),
          });
          
          this.#setState(AgentState.FINISHED);
          bus.emit('agent:finish', { result: response.content, iterations: this.#iteration });
          return {
            success: true,
            result: response.content,
            iterations: this.#iteration,
            tokens: this.#totalTokens,
            cost: this.#totalCost,
          };
        } else if (response.type === 'tool_call') {
          // MCP tool call - execute it
          debug('agent', `Got tool call: ${response.name}.${response.args?.action}`);
          this.#setState(AgentState.ACTING);
          
          const result = await this.#executeTool(response, { tools, sandbox, confirm });
          
          this.#history.push({
            role: 'assistant',
            content: null,
            tool_calls: [{ name: response.name, args: response.args }],
            timestamp: Date.now(),
          });
          
          this.#history.push({
            role: 'tool',
            tool_call_id: response.id,
            name: response.name,
            content: JSON.stringify(result),
            timestamp: Date.now(),
          });

          this.#onIteration?.({
            iteration: this.#iteration,
            toolCalls: [{ name: response.name, action: response.args?.action }],
          });

          // Continue loop - XiaoZhi will send another response after tool result
          debug('agent', 'Tool executed, waiting for next response...');
        }
      }

      // Max iterations reached
      this.#setState(AgentState.FINISHED);
      const maxResult = `Reached maximum iterations (${this.#maxIterations}). Task may be incomplete.`;
      bus.emit('agent:finish', { result: maxResult, iterations: this.#iteration, maxReached: true });
      return {
        success: false,
        result: maxResult,
        iterations: this.#iteration,
        tokens: this.#totalTokens,
        cost: this.#totalCost,
      };

    } catch (error) {
      this.#setState(AgentState.ERROR);
      bus.emit('agent:error', { error: error.message, iteration: this.#iteration });
      return {
        success: false,
        result: `Error: ${error.message}`,
        iterations: this.#iteration,
        tokens: this.#totalTokens,
        cost: this.#totalCost,
      };
    }
  }

  /**
   * Send message and wait for response (text or MCP tool call)
   */
  async #sendAndWaitForResponse(userPrompt, llm, tools) {
    return new Promise((resolve, reject) => {
      const timeout = 120000; // 2 minutes timeout
      let resolved = false;
      let responseBuffer = '';
      let responseTimer = null;
      let toolCallReceived = false;

      const cleanup = () => {
        if (responseTimer) clearTimeout(responseTimer);
        bus.off('llm:text', onText);
        bus.off('mcp:tool_call', onToolCall);
      };

      const finalizeAsText = () => {
        if (resolved) return;
        // If we received a tool call, don't finalize as text
        if (toolCallReceived) return;
        resolved = true;
        cleanup();
        resolve({ type: 'text', content: responseBuffer.trim() });
      };

      const onText = (text) => {
        if (resolved || toolCallReceived) return;
        responseBuffer += text;
        
        // Reset timer - if no new text for 2 seconds, consider response complete
        if (responseTimer) clearTimeout(responseTimer);
        responseTimer = setTimeout(finalizeAsText, 2000);
      };

      const onToolCall = (data) => {
        if (resolved) return;
        toolCallReceived = true;
        resolved = true;
        cleanup();
        resolve({ type: 'tool_call', ...data });
      };

      // Set up timeout
      const timeoutTimer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          cleanup();
          reject(new Error('LLM request timed out'));
        }
      }, timeout);

      // Handle abort
      this.#abortController.signal.addEventListener('abort', () => {
        if (!resolved) {
          resolved = true;
          cleanup();
          clearTimeout(timeoutTimer);
          reject(new Error('AbortError'));
        }
      }, { once: true });

      // Listen for responses
      bus.on('llm:text', onText);
      bus.on('mcp:tool_call', onToolCall);

      // Send the message
      llm.sendPrompt(userPrompt).catch(err => {
        if (!resolved) {
          resolved = true;
          cleanup();
          clearTimeout(timeoutTimer);
          reject(err);
        }
      });
    });
  }

  /**
   * Execute a tool call
   */
  async #executeTool(toolCall, { tools, sandbox, confirm }) {
    try {
      if (confirm) {
        const destructive = confirm.isDestructive(toolCall.name, toolCall.args);
        if (destructive.destructive) {
          const ok = await confirm.ask(toolCall.name, toolCall.args, destructive);
          if (!ok) return { isError: true, content: [{ type: 'text', text: 'Cancelled by user' }] };
        }
      }

      if (sandbox) {
        sandbox.validate(toolCall.name, toolCall.args);
      }

      const start = Date.now();
      const result = await tools.call(toolCall.name, toolCall.args);
      const duration = Date.now() - start;

      debug('agent', `Tool ${toolCall.name}.${toolCall.args?.action} → ${duration}ms, error=${result.isError}`);

      bus.emit('tool:called', {
        name: toolCall.name,
        args: toolCall.args,
        result,
        duration,
        iteration: this.#iteration,
      });

      return result;
    } catch (error) {
      return { isError: true, content: [{ type: 'text', text: error.message }] };
    }
  }

  abort() {
    this.#abortController?.abort();
    debug('agent', 'Abort requested');
  }

  setPlan(plan) {
    this.#plan = plan;
    bus.emit('agent:plan', { plan: plan?.toJSON() });
  }

  clearHistory() {
    this.#history = [];
    this.#iteration = 0;
    this.#totalTokens = 0;
    this.#totalCost = 0;
    this.#plan = null;
  }

  getSummary() {
    return {
      state: this.#state,
      iteration: this.#iteration,
      maxIterations: this.#maxIterations,
      messages: this.#history.length,
      toolCalls: this.#history.filter(m => m.role === 'tool').length,
      tokens: this.#totalTokens,
      cost: this.#totalCost,
      hasPlan: !!this.#plan,
    };
  }
}
