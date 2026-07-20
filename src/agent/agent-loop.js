/**
 * AgentLoop — Core observe→think→act cycle
 * 
 * Handles:
 * - Plain text responses from XiaoZhi (via llm:text)
 * - MCP tool calls from XiaoZhi (via mcp:tool_call)
 */
import { bus } from '../core/event-bus.js';
import { debug } from '../core/logger.js';

export const AgentState = {
  IDLE: 'idle',
  THINKING: 'thinking',
  ACTING: 'acting',
  FINISHED: 'finished',
  ERROR: 'error',
};

export class AgentLoop {
  #state = AgentState.IDLE;
  #iteration = 0;
  #maxIterations;
  #abortController = null;
  #history = [];

  constructor({ maxIterations = 50 } = {}) {
    this.#maxIterations = maxIterations;
  }

  get state() { return this.#state; }
  get iteration() { return this.#iteration; }
  get history() { return [...this.#history]; }

  #setState(s) {
    const old = this.#state;
    this.#state = s;
    debug('agent', `${old} → ${s}`);
    bus.emit('agent:state', { from: old, to: s });
  }

  /**
   * Run agent loop for a user prompt
   */
  async run(userPrompt, { llm, tools, sandbox, confirm }) {
    this.#iteration = 0;
    this.#abortController = new AbortController();
    this.#history = [{ role: 'user', content: userPrompt, ts: Date.now() }];

    try {
      while (this.#iteration < this.#maxIterations) {
        this.#iteration++;
        this.#setState(AgentState.THINKING);

        if (this.#abortController.signal.aborted) {
          this.#setState(AgentState.FINISHED);
          return { success: true, result: 'Aborted', iterations: this.#iteration };
        }

        // Wait for response (text or tool call)
        const response = await this.#waitForResponse(llm, tools);
        if (!response) {
          this.#setState(AgentState.FINISHED);
          return { success: false, result: 'No response', iterations: this.#iteration };
        }

        // Handle text response (final answer)
        if (response.type === 'text') {
          this.#history.push({ role: 'assistant', content: response.content, ts: Date.now() });
          this.#setState(AgentState.FINISHED);
          return { success: true, result: response.content, iterations: this.#iteration };
        }

        // Handle tool call
        if (response.type === 'tool_call') {
          this.#setState(AgentState.ACTING);
          const result = await this.#execTool(response, { tools, sandbox, confirm });
          
          this.#history.push({ role: 'tool', name: response.name, content: JSON.stringify(result), ts: Date.now() });
          
          // Continue loop - XiaoZhi will respond after tool result
          debug('agent', `Tool done, waiting for next response...`);
        }
      }

      this.#setState(AgentState.FINISHED);
      return { success: false, result: `Max iterations (${this.#maxIterations}) reached`, iterations: this.#iteration };

    } catch (err) {
      this.#setState(AgentState.ERROR);
      return { success: false, result: `Error: ${err.message}`, iterations: this.#iteration };
    }
  }

  abort() {
    this.#abortController?.abort();
  }

  /**
   * Wait for response from XiaoZhi (text or MCP tool call)
   */
  #waitForResponse(llm, tools) {
    return new Promise((resolve, reject) => {
      let resolved = false;
      let buffer = '';
      let timer = null;
      let gotToolCall = false;

      const cleanup = () => {
        if (timer) clearTimeout(timer);
        bus.off('llm:text', onText);
        bus.off('mcp:tool_call', onTool);
      };

      const onText = (text) => {
        if (resolved || gotToolCall) return;
        buffer += text;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          if (!resolved && !gotToolCall && buffer) {
            resolved = true;
            cleanup();
            resolve({ type: 'text', content: buffer.trim() });
          }
        }, 2000);
      };

      const onTool = (data) => {
        if (resolved) return;
        gotToolCall = true;
        resolved = true;
        cleanup();
        resolve({ type: 'tool_call', ...data });
      };

      // Timeout after 60s
      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          cleanup();
          reject(new Error('Timeout: XiaoZhi tidak merespons'));
        }
      }, 60000);

      // Abort handler
      this.#abortController.signal.addEventListener('abort', () => {
        if (!resolved) {
          resolved = true;
          cleanup();
          clearTimeout(timeout);
          reject(new Error('AbortError'));
        }
      }, { once: true });

      bus.on('llm:text', onText);
      bus.on('mcp:tool_call', onTool);

      // Send prompt
      llm.sendPrompt(this.#history[0].content).catch(err => {
        if (!resolved) {
          resolved = true;
          cleanup();
          clearTimeout(timeout);
          reject(err);
        }
      });
    });
  }

  /**
   * Execute a tool call
   */
  async #execTool(call, { tools, sandbox, confirm }) {
    try {
      if (confirm?.isDestructive(call.name, call.args)?.destructive) {
        const ok = await confirm.ask(call.name, call.args);
        if (!ok) return { isError: true, content: [{ type: 'text', text: 'Cancelled' }] };
      }
      sandbox?.validate(call.name, call.args);
      
      const start = Date.now();
      const result = await tools.call(call.name, call.args);
      debug('agent', `${call.name}.${call.args?.action} → ${Date.now() - start}ms`);
      return result;
    } catch (err) {
      return { isError: true, content: [{ type: 'text', text: err.message }] };
    }
  }
}
