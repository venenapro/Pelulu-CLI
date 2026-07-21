/**
 * AgentLoop — Core observe→think→act cycle
 *
 * Handles the THREE ways XiaoZhi actually talks back:
 * - Spoken replies via `tts:sentence`  ← this is the PRIMARY reply channel
 * - Plain text replies via `llm:text`  ← rarely used, but supported
 * - MCP tool calls via `mcp:tool_call`
 *
 * Turn completion is activity-aware: the loop treats text/speech/tool events as
 * liveness and only considers the turn finished after a short quiet period, so
 * multi-step builds (write several files, then a spoken "done") no longer look
 * like a timeout. Previously the loop ignored `tts:sentence` entirely, so after
 * a tool ran it waited out the full timeout and reported "XiaoZhi not
 * responding" even though XiaoZhi had already answered by voice.
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
  #idleTimeoutMs;
  #quietMs;

  constructor({ maxIterations = 50, idleTimeoutMs = 45000, quietMs = 2500 } = {}) {
    this.#maxIterations = maxIterations;
    // Hard cap: reject only if NOTHING at all (text, speech, tool) arrives for
    // this long. Reset on every event, so long multi-tool turns stay alive.
    this.#idleTimeoutMs = idleTimeoutMs;
    // A spoken/text reply is considered complete after this much silence.
    this.#quietMs = quietMs;
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
              message: 'XiaoZhi not responding, retrying...',
            });
            try {
              response = await this.#waitForResponse();
            } catch (err2) {
              this.#setState(AgentState.FINISHED);
              return { success: false, result: 'Timeout: XiaoZhi did not respond after 2 attempts', iterations: this.#iteration };
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
   * Wait for the next thing XiaoZhi does: a tool call, or a text/spoken reply.
   * Does NOT send the prompt — that happens once in #sendOnce.
   *
   * Resolves with:
   *   { type: 'tool_call', ... }  when XiaoZhi invokes an MCP tool
   *   { type: 'text', content }   when a text/spoken reply settles (quiet gap)
   * Rejects with a Timeout error only if NOTHING arrives for #idleTimeoutMs.
   */
  #waitForResponse() {
    return new Promise((resolve, reject) => {
      let resolved = false;
      let buffer = '';
      let quietTimer = null;
      let idleTimer = null;

      const cleanup = () => {
        if (quietTimer) clearTimeout(quietTimer);
        if (idleTimer) clearTimeout(idleTimer);
        bus.off('llm:text', onReplyText);
        bus.off('tts:sentence', onReplyText);
        bus.off('mcp:tool_call', onTool);
        bus.off('mcp:tool_result', onLiveness);
      };

      const finishText = () => {
        if (resolved) return;
        resolved = true;
        cleanup();
        resolve({ type: 'text', content: buffer.trim() });
      };

      // Reset the hard idle cap on ANY sign of life (text, speech, tools).
      const armIdle = () => {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
          if (resolved) return;
          // If we already have a partial reply, treat it as done rather than
          // discarding a real answer as a timeout.
          if (buffer.trim()) { finishText(); return; }
          resolved = true;
          cleanup();
          reject(new Error('Timeout: XiaoZhi not responding'));
        }, this.#idleTimeoutMs);
      };

      // XiaoZhi's reply arrives as spoken sentences (tts:sentence) and/or
      // plain text (llm:text). We accumulate both and consider the reply
      // finished once it goes quiet for #quietMs.
      const onReplyText = (text) => {
        if (resolved) return;
        buffer += (buffer ? ' ' : '') + text;
        bus.emit('agent:progress', {
          state: 'receiving',
          message: `Receiving: ${buffer.length} chars...`,
        });
        armIdle();
        if (quietTimer) clearTimeout(quietTimer);
        quietTimer = setTimeout(finishText, this.#quietMs);
      };

      // A tool call interrupts text buffering — hand control back to the loop
      // so it can wait for the tool result, then keep listening next iteration.
      const onTool = (data) => {
        if (resolved) return;
        resolved = true;
        cleanup();
        resolve({ type: 'tool_call', ...data });
      };

      // Tool results are liveness only: they keep the idle cap from firing
      // while XiaoZhi works through several tools before speaking.
      const onLiveness = () => { if (!resolved) armIdle(); };

      this.#abortController.signal.addEventListener('abort', () => {
        if (resolved) return;
        resolved = true;
        cleanup();
        reject(new Error('AbortError'));
      }, { once: true });

      bus.on('llm:text', onReplyText);
      bus.on('tts:sentence', onReplyText);
      bus.on('mcp:tool_call', onTool);
      bus.on('mcp:tool_result', onLiveness);

      armIdle();
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
