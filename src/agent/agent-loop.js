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
    this._promptSent = false;

    try {
      // Send prompt only once at the start
      await this.#sendOnce(llm);

      while (this.#iteration < this.#maxIterations) {
        this.#iteration++;
        this.#setState(AgentState.THINKING);

        // Emit progress
        bus.emit('agent:progress', {
          iteration: this.#iteration,
          maxIterations: this.#maxIterations,
          state: 'thinking',
          message: `Thinking... (iteration ${this.#iteration})`,
        });

        if (this.#abortController.signal.aborted) {
          this.#setState(AgentState.FINISHED);
          return { success: true, result: 'Aborted', iterations: this.#iteration };
        }

        // Wait for response (text or tool call) — does NOT send prompt again
        let response;
        try {
          response = await this.#waitForResponse();
        } catch (err) {
          if (err.message.includes('Timeout')) {
            bus.emit('agent:progress', {
              iteration: this.#iteration,
              state: 'timeout',
              message: 'XiaoZhi tidak merespons, coba lagi...',
            });
            try {
              response = await this.#waitForResponse();
            } catch (err2) {
              this.#setState(AgentState.FINISHED);
              return { success: false, result: 'Timeout: XiaoZhi tidak merespons setelah 2 percobaan', iterations: this.#iteration };
            }
          } else {
            throw err;
          }
        }

        if (!response) {
          this.#setState(AgentState.FINISHED);
          return { success: false, result: 'No response', iterations: this.#iteration };
        }

        // Handle text response (final answer)
        if (response.type === 'text') {
          this.#history.push({ role: 'assistant', content: response.content, ts: Date.now() });
          this.#setState(AgentState.FINISHED);
          bus.emit('agent:progress', {
            iteration: this.#iteration,
            state: 'done',
            message: 'Done!',
          });
          return { success: true, result: response.content, iterations: this.#iteration };
        }

        // Handle tool call — wait for MQTT client to execute it, don't double-execute
        if (response.type === 'tool_call') {
          this.#setState(AgentState.ACTING);
          
          bus.emit('agent:progress', {
            iteration: this.#iteration,
            state: 'tool',
            tool: response.name,
            action: response.args?.action,
            message: `Executing ${response.name}.${response.args?.action || ''}...`,
          });

          // Wait for the tool result from MQTT client (already executed there)
          const result = await this.#waitForToolResult(response);
          
          this.#history.push({ role: 'tool', name: response.name, content: JSON.stringify(result), ts: Date.now() });
          
          bus.emit('agent:progress', {
            iteration: this.#iteration,
            state: 'tool_done',
            tool: response.name,
            message: `${response.name} done, waiting for next response...`,
          });

          debug('agent', `Tool done, waiting for next response...`);
        }
      }

      this.#setState(AgentState.FINISHED);
      return { success: false, result: `Max iterations (${this.#maxIterations}) reached`, iterations: this.#iteration };

    } catch (err) {
      this.#setState(AgentState.ERROR);
      bus.emit('agent:error', { error: err.message, iteration: this.#iteration });
      return { success: false, result: `Error: ${err.message}`, iterations: this.#iteration };
    }
  }

  abort() {
    this.#abortController?.abort();
  }

  /**
   * Send prompt to XiaoZhi — only once per run
   */
  async #sendOnce(llm) {
    if (this._promptSent) return;
    this._promptSent = true;
    debug('agent', `Sending prompt: ${this.#history[0].content}`);
    await llm.sendPrompt(this.#history[0].content);
  }

  /**
   * Wait for response from XiaoZhi (text or MCP tool call)
   * Does NOT send prompt — that's done once in #sendOnce
   */
  #waitForResponse() {
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
        
        bus.emit('agent:progress', {
          state: 'receiving',
          message: `Receiving: ${buffer.length} chars...`,
        });

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
    });
  }

  /**
   * Wait for tool result from MQTT client (avoids double-execution)
   * Falls back to direct execution if MQTT doesn't respond in time
   */
  #waitForToolResult(call) {
    return new Promise((resolve) => {
      let resolved = false;

      const onResult = ({ name, args, result }) => {
        if (resolved) return;
        if (name === call.name && args?.action === call.args?.action) {
          resolved = true;
          bus.off('mcp:tool_result', onResult);
          clearTimeout(fallbackTimer);
          debug('agent', `Got tool result from MQTT: ${name}`);
          resolve(result);
        }
      };

      // Fallback: if MQTT doesn't respond in 10s, execute directly
      const fallbackTimer = setTimeout(async () => {
        if (resolved) return;
        resolved = true;
        bus.off('mcp:tool_result', onResult);
        debug('agent', `Tool result timeout, executing directly: ${call.name}`);
        try {
          const result = await this.#execToolDirect(call);
          resolve(result);
        } catch (err) {
          resolve({ isError: true, content: [{ type: 'text', text: err.message }] });
        }
      }, 10000);

      bus.on('mcp:tool_result', onResult);
    });
  }

  /**
   * Direct tool execution (fallback only)
   */
  async #execToolDirect(call) {
    return { isError: true, content: [{ type: 'text', text: 'Tool execution via MQTT timed out' }] };
  }

  // Tool execution removed — handled by MQTT client
  // Agent loop only waits for results via mcp:tool_result events
}
