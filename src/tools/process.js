/**
 * Process Tool — process management (1 MCP tool, 4 actions)
 */
import { exec } from 'child_process';
import { log } from '../core/logger.js';

function run(cmd) {
  return new Promise((resolve) => {
    exec(cmd, { timeout: 10000, maxBuffer: 256 * 1024 }, (_, stdout, stderr) => {
      resolve({ stdout: stdout?.trim() || '', stderr: stderr?.trim() || '' });
    });
  });
}

const ACTIONS = {
  async list({ filter }) {
    const cmd = filter
      ? `ps aux | grep -i "${filter}" | grep -v grep`
      : 'ps aux --sort=-%mem | head -20';
    const r = await run(cmd);
    return { processes: r.stdout };
  },

  async info({ pid }) {
    if (!pid) throw new Error('pid required');
    const r = await run(`ps -p ${pid} -o pid,ppid,user,%cpu,%mem,vsz,rss,etime,cmd --no-headers`);
    if (!r.stdout) throw new Error(`Process ${pid} not found`);
    const parts = r.stdout.trim().split(/\s+/);
    return { pid: parts[0], ppid: parts[1], user: parts[2], cpu: parts[3], mem: parts[4], vsz: parts[5], rss: parts[6], time: parts[7], cmd: parts.slice(8).join(' ') };
  },

  async kill({ pid, signal }) {
    if (!pid) throw new Error('pid required');
    const sig = signal || 'SIGTERM';
    try {
      process.kill(pid, sig);
      return { pid, signal, killed: true };
    } catch (e) {
      throw new Error(`Cannot kill ${pid}: ${e.message}`);
    }
  },

  async top({ limit }) {
    const n = limit || 15;
    const r = await run(`ps aux --sort=-%cpu | head -${n + 1}`);
    return { top: r.stdout };
  },
};

export default {
  name: 'process',
  description: 'Process management: list, info, kill, top',
  actions: Object.keys(ACTIONS).map(name => ({ name })),
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: Object.keys(ACTIONS) },
      pid: { type: 'number', description: 'Process ID' },
      signal: { type: 'string', description: 'Signal (default SIGTERM)' },
      filter: { type: 'string', description: 'Filter pattern' },
      limit: { type: 'number', description: 'Number of processes' },
    },
    required: ['action'],
  },
  async handler({ action, ...params }) {
    if (!ACTIONS[action]) throw new Error(`Unknown action: ${action}. Use: ${Object.keys(ACTIONS).join(', ')}`);
    return ACTIONS[action](params);
  },
};
