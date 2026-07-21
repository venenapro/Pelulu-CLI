/**
 * Git Tool — consolidated git operations (1 MCP tool, 10 actions)
 * Actions: init, clone, status, diff, log, add, commit, push, pull, branch
 *
 * Long-running operations (clone, push, pull) stream progress via task:progress
 * so the TUI shows live feedback instead of appearing stuck.
 */
import { exec } from 'child_process';
import { log } from '../core/logger.js';
import { getConfig } from '../core/config.js';
import { bus } from '../core/event-bus.js';

function git(cmd, cwd, { timeout = 60000 } = {}) {
  return new Promise((resolve, reject) => {
    exec(`git ${cmd}`, { cwd, timeout, maxBuffer: 512 * 1024 }, (err, stdout, stderr) => {
      if (err?.killed) return reject(new Error('Git timed out'));
      resolve({ stdout: stdout?.trim() || '', stderr: stderr?.trim() || '', code: err?.code ?? 0 });
    });
  });
}

function cwd(params) { return params?.cwd || getConfig().agent?.workspace || process.cwd(); }

/**
 * Run a git command with progress reporting. For operations that may take
 * a while (clone, push, pull), emits task:progress events.
 */
async function gitWithProgress(cmd, dir, { label, timeout = 120000 } = {}) {
  const started = Date.now();
  const tag = label || `git ${cmd.split(' ')[0]}`;

  bus.emit('task:progress', {
    tool: 'git', running: true, phase: 'exec',
    target: tag, elapsed: 0, log: `running: git ${cmd}`,
  });

  try {
    const result = await git(cmd, dir, { timeout });
    const elapsed = Math.round((Date.now() - started) / 1000);
    bus.emit('task:progress', {
      tool: 'git', running: false, phase: 'done',
      target: tag, elapsed, log: result.code === 0 ? 'completed' : `exit ${result.code}`,
    });
    return result;
  } catch (err) {
    bus.emit('task:progress', {
      tool: 'git', running: false, phase: 'error',
      target: tag, elapsed: Math.round((Date.now() - started) / 1000),
      log: err.message,
    });
    throw err;
  }
}

const ACTIONS = {
  init: {
    required: [],
    handler: async (params) => {
      const dir = cwd(params);
      await git('init', dir);
      return { initialized: true, path: dir };
    },
  },

  clone: {
    required: ['url'],
    handler: async ({ url, path, branch }) => {
      const cmd = `clone${branch ? ` -b ${branch}` : ''} "${url}"${path ? ` "${path}"` : ''}`;
      log('git', `[CLONE] ${url}`);
      const result = await gitWithProgress(cmd, undefined, {
        label: `clone ${url.split('/').pop()?.replace('.git', '') || url}`,
        timeout: 120000,
      });
      if (result.code !== 0) throw new Error(result.stderr || 'clone failed');
      return { cloned: true, url, path: path || url.split('/').pop()?.replace('.git', '') };
    },
  },

  status: {
    required: [],
    handler: async (params) => {
      const dir = cwd(params);
      const r = await git('status --porcelain', dir);
      const branch = await git('rev-parse --abbrev-ref HEAD', dir);
      return { branch: branch.stdout, dirty: !!r.stdout, changes: r.stdout.split('\n').filter(Boolean) };
    },
  },

  diff: {
    required: [],
    handler: async (params) => {
      const dir = cwd(params);
      const staged = params.staged ? ' --staged' : '';
      const file = params.file ? ` -- "${params.file}"` : '';
      const r = await git(`diff${staged} --stat${file}`, dir);
      const detail = await git(`diff${staged}${file}`, dir);
      return { summary: r.stdout || 'No changes', detail: detail.stdout?.slice(0, 5000) || '' };
    },
  },

  log: {
    required: [],
    handler: async (params) => {
      const dir = cwd(params);
      const n = params.limit || 10;
      const r = await git(`log --oneline -${n}`, dir);
      return { commits: r.stdout.split('\n').filter(Boolean) };
    },
  },

  add: {
    required: [],
    handler: async (params) => {
      const dir = cwd(params);
      const files = params.files || '.';
      await git(`add ${files}`, dir);
      return { added: files };
    },
  },

  commit: {
    required: ['message'],
    handler: async (params) => {
      const dir = cwd(params);
      const msg = params.message.replace(/"/g, '\\"');
      const r = await git(`commit -m "${msg}"`, dir);
      if (r.code !== 0 && r.stderr.includes('nothing to commit')) return { committed: false, reason: 'nothing to commit' };
      log('git', `[COMMIT] ${params.message}`);
      return { committed: true, message: params.message, output: r.stdout.slice(-300) };
    },
  },

  push: {
    required: [],
    handler: async (params) => {
      const dir = cwd(params);
      const remote = params.remote || '';
      const branch = params.branch || '';
      log('git', `[PUSH] ${remote} ${branch}`);
      const r = await gitWithProgress(`push ${remote} ${branch}`.trim(), dir, {
        label: `push ${remote || 'origin'} ${branch || 'current'}`,
        timeout: 60000,
      });
      if (r.code !== 0) throw new Error(r.stderr || 'push failed');
      return { pushed: true, output: r.stdout.slice(-300) || r.stderr.slice(-300) };
    },
  },

  pull: {
    required: [],
    handler: async (params) => {
      const dir = cwd(params);
      const remote = params.remote || '';
      const branch = params.branch || '';
      log('git', `[PULL] ${remote} ${branch}`);
      const r = await gitWithProgress(`pull ${remote} ${branch}`.trim(), dir, {
        label: `pull ${remote || 'origin'} ${branch || 'current'}`,
        timeout: 60000,
      });
      if (r.code !== 0) throw new Error(r.stderr || 'pull failed');
      return { pulled: true, output: r.stdout.slice(-300) };
    },
  },

  branch: {
    required: [],
    handler: async (params) => {
      const dir = cwd(params);
      if (params.delete && params.name) {
        await git(`branch -d ${params.name}`, dir);
        return { deleted: params.name };
      }
      if (params.name) {
        await git(`branch ${params.name}`, dir);
        return { created: params.name };
      }
      const r = await git('branch -a', dir);
      return { branches: r.stdout.split('\n').filter(Boolean) };
    },
  },
};

const actionNames = Object.keys(ACTIONS);

export default {
  name: 'git',
  description: 'Git operations: init, clone, status, diff, log, add, commit, push, pull, branch',
  actions: actionNames.map(name => ({ name, required: ACTIONS[name].required })),
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: actionNames },
      cwd: { type: 'string', description: 'Working directory' },
      url: { type: 'string', description: 'Repo URL (for clone)' },
      path: { type: 'string', description: 'Target path' },
      branch: { type: 'string', description: 'Branch name' },
      message: { type: 'string', description: 'Commit message' },
      files: { type: 'string', description: 'Files to add' },
      remote: { type: 'string', description: 'Remote name' },
      limit: { type: 'number', description: 'Log limit' },
      staged: { type: 'boolean', description: 'Staged diff' },
      file: { type: 'string', description: 'Specific file for diff' },
      name: { type: 'string', description: 'Branch name' },
      delete: { type: 'boolean', description: 'Delete branch' },
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
