/**
 * JobManager — universal async job layer for ALL tools.
 *
 * WHY: XiaoZhi aborts any MCP tool call that runs longer than ~30s and then
 * assumes the tool "timed out" — even though it is still working. That is the
 * root cause of the "system timeout padahal berjalan" bug. Instead of making
 * every one of the tools background-aware by hand, we wrap the tool dispatch
 * boundary in a single job layer:
 *
 *   - Fast actions (finish within `graceMs`) return their result inline, exactly
 *     as before — no behaviour change for reads/config/etc.
 *   - Slow actions keep running in the BACKGROUND and immediately return a
 *     job handle. The AI (or the user) then polls the `jobs` tool for progress
 *     and the final result, so the agent never stalls or hallucinates a failure.
 *
 * Every job streams lifecycle events on the bus (job:started / job:progress /
 * job:done) so the TUI can show continuous, inline feedback for ANY tool.
 */
import { randomUUID } from 'crypto';
import { bus } from './event-bus.js';
import { debug } from './logger.js';

const MAX_JOBS = 40;          // ring-buffer cap so memory never grows unbounded
const DEFAULT_GRACE_MS = 8000; // < XiaoZhi's ~30s timeout, with wide margin

class JobManager {
  #jobs = new Map();   // id -> job
  #order = [];         // insertion order for pruning + "latest"

  /**
   * Run `executor(job)` under a job. Resolves as soon as we know whether the
   * work finished quickly or had to be backgrounded.
   *
   * @returns {Promise<{done:boolean, job:object, result?:any, error?:Error}>}
   *   done=true  -> finished within the grace window (result/error populated)
   *   done=false -> still running in the background (poll via the `jobs` tool)
   */
  async dispatch({ tool, action, label } = {}, executor, { graceMs = DEFAULT_GRACE_MS } = {}) {
    const job = this.#create({ tool, action, label });

    // Kick off the actual work. We attach terminal handlers up-front so the job
    // is always finalized regardless of whether we returned inline or backgrounded.
    const work = Promise.resolve()
      .then(() => executor(job))
      .then((result) => { this.#finish(job, result); return { kind: 'result', result }; })
      .catch((error) => { this.#fail(job, error); return { kind: 'error', error }; });

    const raced = await Promise.race([
      work,
      new Promise((res) => setTimeout(() => res({ kind: 'timeout' }), graceMs)),
    ]);

    if (raced.kind === 'result') return { done: true, job, result: raced.result };
    if (raced.kind === 'error') return { done: true, job, error: raced.error };

    // Timed out the grace window -> run in background, let the AI poll.
    job.backgrounded = true;
    debug('job', `${tool}.${action || ''} backgrounded as ${job.id}`);
    bus.emit('job:backgrounded', this.snapshot(job));
    return { done: false, job };
  }

  /** Append a human-readable progress line to a running job (streamed to TUI). */
  progress(jobId, message, extra = {}) {
    const job = this.#jobs.get(jobId);
    if (!job || job.status !== 'running') return;
    const entry = { at: Date.now(), message, ...extra };
    job.progress.push(entry);
    if (job.progress.length > 100) job.progress.shift();
    bus.emit('job:progress', { id: job.id, tool: job.tool, action: job.action, message, ...extra });
  }

  get(id) { return this.#jobs.get(id) || null; }

  /** Most recent job (running preferred), for "status" with no explicit id. */
  latest() {
    for (let i = this.#order.length - 1; i >= 0; i--) {
      const job = this.#jobs.get(this.#order[i]);
      if (job && job.status === 'running') return job;
    }
    const lastId = this.#order[this.#order.length - 1];
    return lastId ? this.#jobs.get(lastId) : null;
  }

  list() { return this.#order.map((id) => this.#jobs.get(id)).filter(Boolean); }

  running() { return this.list().filter((j) => j.status === 'running'); }

  /**
   * Cooperative cancel: flag the job so cancel-aware executors can bail out.
   * Non-cooperative work keeps running but its result is discarded.
   */
  cancel(id) {
    const job = this.#jobs.get(id);
    if (!job || job.status !== 'running') return false;
    job.cancelRequested = true;
    return true;
  }

  /** Wait up to `timeoutMs` for a job to leave the running state. */
  async wait(id, timeoutMs = 20000) {
    const job = this.#jobs.get(id);
    if (!job) return null;
    if (job.status !== 'running') return job;
    return new Promise((resolve) => {
      const done = () => { clearInterval(poll); clearTimeout(timer); bus.off('job:done', onDone); resolve(job); };
      const onDone = (snap) => { if (snap.id === id) done(); };
      const poll = setInterval(() => { if (job.status !== 'running') done(); }, 200);
      const timer = setTimeout(() => { clearInterval(poll); bus.off('job:done', onDone); resolve(job); }, timeoutMs);
      bus.on('job:done', onDone);
    });
  }

  /** Plain, serializable view of a job for tool results / events. */
  snapshot(job) {
    if (!job) return null;
    const now = job.finishedAt || Date.now();
    return {
      id: job.id,
      tool: job.tool,
      action: job.action,
      label: job.label,
      status: job.status,
      backgrounded: !!job.backgrounded,
      elapsed_s: Math.round((now - job.startedAt) / 1000),
      progress: job.progress.slice(-5).map((p) => p.message),
      error: job.error || undefined,
    };
  }

  // ─── internals ───────────────────────────────────────────
  #create({ tool, action, label }) {
    const job = {
      id: `job_${randomUUID().slice(0, 8)}`,
      tool, action,
      label: label || `${tool}${action ? `.${action}` : ''}`,
      status: 'running',
      startedAt: Date.now(),
      finishedAt: null,
      progress: [],
      result: undefined,
      error: null,
      backgrounded: false,
      cancelRequested: false,
    };
    this.#jobs.set(job.id, job);
    this.#order.push(job.id);
    this.#prune();
    bus.emit('job:started', this.snapshot(job));
    return job;
  }

  #finish(job, result) {
    if (job.status !== 'running') return;
    job.status = job.cancelRequested ? 'cancelled' : 'done';
    job.finishedAt = Date.now();
    job.result = this.#normalizeResult(result);
    bus.emit('job:done', { ...this.snapshot(job), result: job.result });
  }

  #fail(job, error) {
    if (job.status !== 'running') return;
    job.status = 'error';
    job.finishedAt = Date.now();
    job.error = error?.message || String(error);
    bus.emit('job:done', { ...this.snapshot(job), error: job.error });
  }

  /**
   * Tool results come back in MCP shape ({ isError, content:[{text}] }). Unwrap
   * to the raw payload so polling the `jobs` tool returns clean data.
   */
  #normalizeResult(result) {
    if (result && Array.isArray(result.content) && result.content[0]?.type === 'text') {
      const text = result.content[0].text;
      try { return JSON.parse(text); } catch { return text; }
    }
    return result;
  }

  #prune() {
    while (this.#order.length > MAX_JOBS) {
      const oldest = this.#order.shift();
      const job = this.#jobs.get(oldest);
      // Never evict a job that is still running.
      if (job && job.status === 'running') { this.#order.push(oldest); break; }
      this.#jobs.delete(oldest);
    }
  }
}

export const jobManager = new JobManager();
