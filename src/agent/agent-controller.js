/**
 * AgentController — Orchestrates the agent system
 */
import { AgentLoop } from './agent-loop.js';
import { LLMClient } from './llm-client.js';
import { ContextBuilder } from './context-builder.js';
import { bus } from '../core/event-bus.js';
import { debug } from '../core/logger.js';

export class AgentController {
  #loop;
  #llm;
  #contextBuilder;
  #registry;
  #sandbox;
  #confirm;
  #config;
  #running = false;

  constructor({ registry, mqtt, sandbox, confirm, config }) {
    this.#registry = registry;
    this.#sandbox = sandbox;
    this.#confirm = confirm;
    this.#config = config;
    this.#loop = new AgentLoop({
      maxIterations: config.agent?.max_iterations || 50,
      idleTimeoutMs: config.agent?.response_idle_ms || 45000,
      quietMs: config.agent?.reply_quiet_ms || 2500,
    });
    this.#llm = new LLMClient(mqtt);
    this.#contextBuilder = new ContextBuilder();
  }

  get isRunning() { return this.#running; }

  get summary() {
    return {
      state: this.#loop.state,
      iteration: this.#loop.iteration,
      history: this.#loop.history.length,
      running: this.#running,
    };
  }

  /**
   * Run agent for a user prompt
   */
  async run(userPrompt, options = {}) {
    // Validate input length
    const MAX_LEN = 70;
    if (userPrompt.length > MAX_LEN) {
      throw new Error(`Input too long (${userPrompt.length}/${MAX_LEN} chars)`);
    }

    if (this.#running) {
      this.abort();
      await new Promise(r => setTimeout(r, 300));
    }

    this.#running = true;
    const start = Date.now();

    try {
      debug('agent', `Running: ${userPrompt}`);
      
      const result = await this.#loop.run(userPrompt, {
        llm: this.#llm,
        tools: this.#registry,
        sandbox: this.#sandbox,
        confirm: this.#confirm,
      });

      result.duration = Date.now() - start;
      debug('agent', `Done in ${result.duration}ms: ${result.success}`);
      return result;

    } finally {
      this.#running = false;
    }
  }

  /**
   * Abort current run
   */
  abort() {
    this.#loop.abort();
    this.#running = false;
    debug('agent', 'Aborted');
  }

  /**
   * Get workspace context
   */
  async getContext() {
    return this.#contextBuilder.build();
  }

  /**
   * Reset agent state
   */
  reset() {
    this.#running = false;
  }
}
