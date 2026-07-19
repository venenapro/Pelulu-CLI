/**
 * Git Tool — consolidated git operations (1 MCP tool, 10 actions)
 * Actions: init, clone, status, diff, log, add, commit, push, pull, branch
 */
import { exec } from 'child_process';
import { log } from '../core/logger.js';
import { getConfig } from '../core/config.js';

function git(cmd, cwd) {
  return new Promise((resolve, reject) => {
    exec(`git ${cmd}`, { cwd, timeout: 30000, maxBuffer: 512 * 1024 }, (err, stdout, stderr) => {
      if (err?.killed) return reject(new Error('Git timed out'));
      resolve({ stdout: stdout?.trim() || '', stderr: stderr?.trim() || '', code: err?.code ?? 0 });
    });
  });
}

function cwd(params) { return params?.cwd || getConfig().agent?.workspace || process.cwd(); }

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
      await git(cmd);
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
      log('git', `📝 Committed: ${params.message}`);
      return { committed: true, message: params.message, output: r.stdout.slice(-300) };
    },
  },

  push: {
    required: [],
    handler: async (params) => {
      const dir = cwd(params);
      const remote = params.remote || '';
      const branch = params.branch || '';
      const r = await git(`push ${remote} ${branch}`.trim(), dir);
      return { pushed: true, output: r.stdout.slice(-300) || r.stderr.slice(-300) };
    },
  },

  pull: {
    required: [],
    handler: async (params) => {
      const dir = cwd(params);
      const remote = params.remote || '';
      const branch = params.branch || '';
      const r = await git(`pull ${remote} ${branch}`.trim(), dir);
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
