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
  #postToolGraceMs;

  constructor({ maxIterations = 50, idleTimeoutMs = 45000, quietMs = 2500, postToolGraceMs = 9000 } = {}) {
    this.#maxIterations = maxIterations;
    // Hard cap: reject only if NOTHING at all (text, speech, tool) arrives for
    // this long. Reset on every event, so long multi-tool turns stay alive.
    this.#idleTimeoutMs = idleTimeoutMs;
    // A spoken/text reply is considered complete after this much silence.
    this.#quietMs = quietMs;
    // After the last tool result, how long to wait for XiaoZhi to either run
    // another tool or speak before concluding the turn as "tools done, no
    // verbal reply". Keeps a silent voice model from hanging the whole turn.
    this.#postToolGraceMs = postToolGraceMs;
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
   * Run one user turn.
   *
   * IMPORTANT — architecture: XiaoZhi is the MCP *client* and drives its own
   * server-side think→act loop. Our CLI is the MCP *server*: `mqtt-client.js`
   * already receives each `tools/call`, executes it, and returns the result to
   * XiaoZhi automatically. So this loop must NOT drive tool execution or wait
   * for tools in lock-step. It is a single, persistent OBSERVER of the whole
   * turn's event stream. Oscillating between "wait for text" and "wait for tool
   * result" phases (the old design) meant the final `tts:sentence` reply landed
   * in a gap where nothing was listening — which is exactly why the turn hung
   * and reported "XiaoZhi not responding" after files were read.
   */
  async run(userPrompt, { llm } = {}) {
    this.#iteration = 0;
    this.#abortController = new AbortController();
    this.#history = [{ role: 'user', content: userPrompt, ts: Date.now() }];

    this.#setState(AgentState.THINKING);
    bus.emit('agent:progress', { state: 'thinking', message: 'Thinking...' });

    try {
      const outcome = await this.#observeTurn(llm);
      this.#setState(AgentState.FINISHED);
      return outcome;
    } catch (err) {
      if (err.message === 'AbortError') {
        this.#setState(AgentState.FINISHED);
        return { success: true, result: 'Aborted', iterations: this.#iteration };
      }
      this.#setState(AgentState.ERROR);
      bus.emit('agent:error', { error: err.message, iteration: this.#iteration });
      return { success: false, result: `Error: ${err.message}`, iterations: this.#iteration };
    }
  }

  abort() {
    this.#abortController?.abort();
  }

  /**
   * Observe a full turn with ONE set of listeners that stay attached from the
   * moment the prompt is sent until the turn settles. Nothing is ever missed
   * between tool calls.
   *
   * Completion rules (whichever fires first):
   *   - Spoken/text reply settles: buffer got text, then went quiet for
   *     #quietMs, and no tool call is in flight → success with the reply.
   *   - Tools finished silently: XiaoZhi ran tools and produced no verbal
   *     reply within #postToolGraceMs of the last result → success, reported
   *     as the tool activity (prevents the long hang the user was seeing).
   *   - Hard idle: absolutely nothing (text, speech, tool call, tool result)
   *     for #idleTimeoutMs → treated as a stalled turn.
   */
  #observeTurn(llm) {
    return new Promise((resolve, reject) => {
      let settled = false;
      let buffer = '';
      let pendingTools = 0;   // tool calls started but not yet resulted
      let toolsRun = 0;       // total tool calls seen this turn
      let lastTool = null;    // name of the most recent tool
      let quietTimer = null;  // fires when a verbal reply goes quiet
      let graceTimer = null;  // fires when tools finish with no verbal reply
      let idleTimer = null;   // hard "nothing at all is happening" cap

      const clearTimers = () => {
        clearTimeout(quietTimer); clearTimeout(graceTimer); clearTimeout(idleTimer);
      };
      const cleanup = () => {
        clearTimers();
        bus.off('llm:text', onText);
        bus.off('tts:sentence', onText);
        bus.off('mcp:tool_call', onToolCall);
        bus.off('mcp:tool_result', onToolResult);
      };

      const finish = (outcome) => {
        if (settled) return;
        settled = true;
        cleanup();
        bus.emit('agent:progress', { state: 'done', message: 'Done!' });
        resolve(outcome);
      };

      const finishWithText = () => {
        if (pendingTools > 0) return; // a tool is still running; not done yet
        const content = buffer.trim();
        if (!content) return;
        this.#history.push({ role: 'assistant', content, ts: Date.now() });
        finish({ success: true, result: content, iterations: this.#iteration });
      };

      const finishSilentTools = () => {
        if (settled || pendingTools > 0 || buffer.trim()) return;
        const summary = `Completed ${toolsRun} tool ${toolsRun === 1 ? 'action' : 'actions'}${lastTool ? ` (last: ${lastTool})` : ''}.`;
        this.#history.push({ role: 'assistant', content: summary, ts: Date.now() });
        finish({ success: true, result: summary, iterations: this.#iteration });
      };

      // Reset the hard idle cap on every sign of life.
      const armIdle = () => {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
          if (settled) return;
          if (buffer.trim()) { finishWithText(); return; }
          if (toolsRun > 0) { finishSilentTools(); return; }
          settled = true;
          cleanup();
          reject(new Error('Timeout: XiaoZhi not responding'));
        }, this.#idleTimeoutMs);
      };

      const onText = (text) => {
        if (settled || typeof text !== 'string') return;
        buffer += (buffer ? ' ' : '') + text;
        clearTimeout(graceTimer); // a verbal reply supersedes the silent-tool path
        armIdle();
        bus.emit('agent:progress', { state: 'receiving', message: `Receiving ${buffer.length} chars...` });
        clearTimeout(quietTimer);
        quietTimer = setTimeout(finishWithText, this.#quietMs);
      };

      const onToolCall = ({ name, args }) => {
        if (settled) return;
        pendingTools++;
        toolsRun++;
        lastTool = name;
        this.#iteration++;
        this.#setState(AgentState.ACTING);
        clearTimeout(quietTimer); // don't finish text while a tool is running
        clearTimeout(graceTimer);
        armIdle();
        bus.emit('agent:progress', {
          state: 'tool', tool: name, action: args?.action,
          iteration: this.#iteration,
          message: `Running ${name}${args?.action ? '.' + args.action : ''}...`,
        });
      };

      const onToolResult = ({ name, result }) => {
        if (settled) return;
        if (pendingTools > 0) pendingTools--;
        this.#history.push({ role: 'tool', name, content: JSON.stringify(result), ts: Date.now() });
        this.#setState(AgentState.THINKING);
        armIdle();
        bus.emit('agent:progress', {
          state: 'tool_done', tool: name,
          message: `${name} done${result?.isError ? ' (error)' : ''}, waiting for next step...`,
        });
        if (pendingTools === 0) {
          // All in-flight tools are done. Give XiaoZhi a grace window to either
          // fire another tool call or speak a final reply. If it stays silent,
          // conclude the turn instead of hanging until the idle timeout.
          clearTimeout(graceTimer);
          graceTimer = setTimeout(finishSilentTools, this.#postToolGraceMs);
        }
      };

      this.#abortController.signal.addEventListener('abort', () => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error('AbortError'));
      }, { once: true });

      bus.on('llm:text', onText);
      bus.on('tts:sentence', onText);
      bus.on('mcp:tool_call', onToolCall);
      bus.on('mcp:tool_result', onToolResult);

      armIdle();

      // Send the prompt exactly once, after listeners are attached so we never
      // miss an immediate reply.
      debug('agent', `Sending prompt: ${userPrompt}`);
      Promise.resolve(llm?.sendPrompt(userPrompt)).catch((err) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(err instanceof Error ? err : new Error(String(err)));
      });
    });
  }
}
