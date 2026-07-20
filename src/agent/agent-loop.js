/**
 * AgentLoop — Core observe→think→act cycle (OpenHands-style)
 * 
 * This is the heart of the agent. It:
 * 1. Observes the current state (context, history, workspace)
 * 2. Thinks by calling the LLM with system prompt + context
 * 3. Acts by executing tool calls returned by the LLM
 * 4. Loops until the agent calls "finish" or hits max iterations
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
   * @param {string} userPrompt - The user's request
   * @param {object} deps - Dependencies { llm, tools, context, systemPrompt, sandbox, confirm }
   * @returns {object} - { success, result, iterations, tokens, cost }
   */
  async run(userPrompt, deps) {
    const { llm, tools, context, systemPrompt, sandbox, confirm } = deps;

    // Initialize
    this.#iteration = 0;
    this.#abortController = new AbortController();
    this.#setState(AgentState.THINKING);

    // Add user message to history
    this.#history.push({
      role: 'user',
      content: userPrompt,
      timestamp: Date.now(),
    });

    try {
      while (this.#iteration < this.#maxIterations) {
        this.#iteration++;
        debug('agent', `=== Iteration ${this.#iteration} ===`);

        // Check abort
        if (this.#abortController.signal.aborted) {
          this.#setState(AgentState.FINISHED);
          return { success: true, result: 'Aborted by user', iterations: this.#iteration };
        }

        // 1. OBSERVE — build messages for LLM
        this.#setState(AgentState.THINKING);
        const messages = this.#buildMessages(systemPrompt, context);

        // Wait for MCP tools to be processed on first iteration
        if (this.#iteration === 1) {
          debug('agent', 'Waiting for MCP tools to be processed...');
          await new Promise(r => setTimeout(r, 3000));
        }

        // 2. THINK — call LLM
        let llmResponse;
        try {
          llmResponse = await llm.chat(messages, {
            tools: tools.toMcpTools(),
            signal: this.#abortController.signal,
          });
        } catch (err) {
          if (err.name === 'AbortError') {
            this.#setState(AgentState.FINISHED);
            return { success: true, result: 'Aborted', iterations: this.#iteration };
          }
          throw err;
        }

        // Track tokens/cost
        if (llmResponse.usage) {
          this.#totalTokens += llmResponse.usage.total_tokens || 0;
          this.#totalCost += llmResponse.usage.cost || 0;
        }

        // 3. Process response
        const { content, toolCalls, finish } = this.#parseResponse(llmResponse);

        // Add assistant message to history
        this.#history.push({
          role: 'assistant',
          content: content,
          tool_calls: toolCalls,
          timestamp: Date.now(),
        });

        // Emit for UI
        if (content) {
          bus.emit('agent:response', { content, iteration: this.#iteration });
        }

        // 4. Check if agent wants to finish
        if (finish) {
          this.#setState(AgentState.FINISHED);
          bus.emit('agent:finish', { result: finish.result, iterations: this.#iteration });
          return {
            success: true,
            result: finish.result || content,
            iterations: this.#iteration,
            tokens: this.#totalTokens,
            cost: this.#totalCost,
          };
        }

        // 5. If no tool calls and has content, treat as final answer (XiaoZhi returns plain text)
        if ((!toolCalls || toolCalls.length === 0) && content && content.length > 0) {
          debug('agent', 'No tool calls, treating response as final answer');
          this.#setState(AgentState.FINISHED);
          bus.emit('agent:finish', { result: content, iterations: this.#iteration });
          return {
            success: true,
            result: content,
            iterations: this.#iteration,
            tokens: this.#totalTokens,
            cost: this.#totalCost,
          };
        }

        // 6. Execute tool calls
        if (toolCalls && toolCalls.length > 0) {
          this.#setState(AgentState.ACTING);
          const results = await this.#executeTools(toolCalls, { tools, sandbox, confirm });

          // Add tool results to history
          for (const { call, result } of results) {
            this.#history.push({
              role: 'tool',
              tool_call_id: call.id,
              name: call.name,
              content: JSON.stringify(result),
              timestamp: Date.now(),
            });
          }

          // Notify iteration callback
          this.#onIteration?.({
            iteration: this.#iteration,
            toolCalls: results.map(r => ({ name: r.call.name, action: r.call.args.action })),
          });
        }

        // Back to thinking for next iteration
        this.#setState(AgentState.THINKING);
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
   * Abort the current run
   */
  abort() {
    this.#abortController?.abort();
    debug('agent', 'Abort requested');
  }

  /**
   * Build messages array for LLM
   * Context is already in systemPrompt, don't duplicate!
   */
  #buildMessages(systemPrompt, context) {
    const messages = [
      { role: 'system', content: systemPrompt },
    ];

    // Add plan if exists (only if not already in system prompt)
    if (this.#plan && !systemPrompt.includes('## Plan')) {
      messages.push({
        role: 'system',
        content: `## Current Plan\n${this.#plan.toPrompt()}`,
      });
    }

    // Add history (with smart truncation)
    const historyToAdd = this.#truncateHistory(this.#history);
    messages.push(...historyToAdd);

    return messages;
  }

  /**
   * Truncate history to fit context window
   */
  #truncateHistory(history) {
    // Keep last 30 messages by default
    // More sophisticated condensation can be added
    const MAX_HISTORY = 30;
    if (history.length <= MAX_HISTORY) return history;

    // Keep first message (user's original request) and last N messages
    const first = history[0];
    const recent = history.slice(-MAX_HISTORY + 1);
    return [first, ...recent];
  }

  /**
   * Parse LLM response into content, tool calls, and finish signal
   */
  #parseResponse(response) {
    let content = '';
    let toolCalls = [];
    let finish = null;

    // Extract content
    if (typeof response.content === 'string') {
      content = response.content;
    } else if (Array.isArray(response.content)) {
      content = response.content
        .filter(c => c.type === 'text')
        .map(c => c.text)
        .join('\n');
    }

    // Extract tool calls
    if (response.tool_calls) {
      toolCalls = response.tool_calls.map(tc => ({
        id: tc.id,
        name: tc.function?.name || tc.name,
        args: typeof tc.function?.arguments === 'string'
          ? JSON.parse(tc.function.arguments)
          : tc.function?.arguments || tc.args || {},
      }));
    }

    // Check for finish tool call
    const finishCall = toolCalls.find(tc => tc.name === 'finish');
    if (finishCall) {
      finish = {
        result: finishCall.args?.result || content,
      };
      // Remove finish from tool calls (don't execute it)
      toolCalls = toolCalls.filter(tc => tc.name !== 'finish');
    }

    return { content, toolCalls, finish };
  }

  /**
   * Execute tool calls with sandbox validation and confirmation
   */
  async #executeTools(toolCalls, { tools, sandbox, confirm }) {
    const results = [];

    for (const call of toolCalls) {
      try {
        // Destructive action check
        if (confirm) {
          const destructive = confirm.isDestructive(call.name, call.args);
          if (destructive.destructive) {
            const ok = await confirm.ask(call.name, call.args, destructive);
            if (!ok) {
              results.push({
                call,
                result: { isError: true, content: [{ type: 'text', text: 'Cancelled by user' }] },
              });
              continue;
            }
          }
        }

        // Sandbox validation
        if (sandbox) {
          sandbox.validate(call.name, call.args);
        }

        // Execute
        const start = Date.now();
        const result = await tools.call(call.name, call.args);
        const duration = Date.now() - start;

        debug('agent', `Tool ${call.name}.${call.args.action} → ${duration}ms, error=${result.isError}`);

        results.push({ call, result, duration });

        // Emit for UI
        bus.emit('tool:called', {
          name: call.name,
          args: call.args,
          result,
          duration,
          iteration: this.#iteration,
        });

      } catch (error) {
        results.push({
          call,
          result: { isError: true, content: [{ type: 'text', text: error.message }] },
        });
      }
    }

    return results;
  }

  /**
   * Set the current plan
   */
  setPlan(plan) {
    this.#plan = plan;
    bus.emit('agent:plan', { plan: plan?.toJSON() });
  }

  /**
   * Clear history (for new conversation)
   */
  clearHistory() {
    this.#history = [];
    this.#iteration = 0;
    this.#totalTokens = 0;
    this.#totalCost = 0;
    this.#plan = null;
  }

  /**
   * Get conversation summary for display
   */
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
