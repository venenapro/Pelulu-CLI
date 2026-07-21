/**
 * jobs — universal poll interface for background tool runs.
 *
 * Any tool action that takes longer than the grace window is turned into a
 * background job (see core/job-manager.js). This tool is how the AI keeps
 * track of them so it never assumes a still-running action "timed out":
 *
 *   jobs { action: "list" }                 -> all recent jobs + their status
 *   jobs { action: "status", id: "job_x" }  -> one job (or the latest if no id)
 *   jobs { action: "wait",   id: "job_x" }  -> wait briefly for it to finish
 *   jobs { action: "result", id: "job_x" }  -> the finished job's result payload
 *   jobs { action: "cancel", id: "job_x" }  -> request cancellation
 */
import { jobManager } from '../core/job-manager.js';

function describe(job) {
  if (!job) return null;
  const snap = jobManager.snapshot(job);
  return {
    ...snap,
    hint:
      snap.status === 'running'
        ? `Still running (${snap.elapsed_s}s). Poll again with action=status id=${snap.id}, or action=wait.`
        : snap.status === 'done'
          ? `Finished in ${snap.elapsed_s}s. Use action=result id=${snap.id} to read the output.`
          : `${snap.status}.`,
  };
}

const ACTIONS = {
  list: () => {
    const jobs = jobManager.list().map(describe);
    const running = jobs.filter((j) => j.status === 'running').length;
    return {
      total: jobs.length,
      running,
      message: running
        ? `${running} job(s) still running. Poll them with action=status.`
        : 'No jobs are currently running.',
      jobs: jobs.slice(-15),
    };
  },

  status: ({ id }) => {
    const job = id ? jobManager.get(id) : jobManager.latest();
    if (!job) return { status: 'none', message: 'No jobs yet. Start a tool action first.' };
    return describe(job);
  },

  wait: async ({ id, timeout }) => {
    const target = id ? jobManager.get(id) : jobManager.latest();
    if (!target) return { status: 'none', message: 'No jobs to wait for.' };
    const ms = Math.min(Math.max(Number(timeout) || 20000, 1000), 25000); // capped < XiaoZhi timeout
    const job = await jobManager.wait(target.id, ms);
    const out = describe(job);
    if (job.status === 'running') out.message = `Still running after ${Math.round(ms / 1000)}s — poll again or action=wait.`;
    return out;
  },

  result: ({ id }) => {
    const job = id ? jobManager.get(id) : jobManager.latest();
    if (!job) return { status: 'none', message: 'No jobs yet.' };
    if (job.status === 'running') return { ...describe(job), message: 'Not finished yet — use action=wait first.' };
    return { id: job.id, tool: job.tool, action: job.action, status: job.status, error: job.error || undefined, result: job.result };
  },

  cancel: ({ id }) => {
    const job = id ? jobManager.get(id) : jobManager.latest();
    if (!job) return { status: 'none', message: 'No job to cancel.' };
    const ok = jobManager.cancel(job.id);
    return { id: job.id, cancelled: ok, message: ok ? 'Cancellation requested.' : `Job is already ${job.status}.` };
  },
};

export default {
  name: 'jobs',
  description: 'Track background tool jobs so long-running actions never look timed out. Actions: list, status, wait, result, cancel.',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['list', 'status', 'wait', 'result', 'cancel'] },
      id: { type: 'string', description: 'Job id (defaults to the latest job)' },
      timeout: { type: 'number', description: 'wait: max ms to block (<=25000)' },
    },
    required: ['action'],
  },
  async handler(args = {}) {
    const action = args.action || 'status';
    const fn = ACTIONS[action];
    if (!fn) return { error: `Unknown action "${action}". Use: ${Object.keys(ACTIONS).join(', ')}` };
    return await fn(args);
  },
};
