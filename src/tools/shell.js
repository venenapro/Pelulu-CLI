/**
 * Shell Tool — consolidated shell operations (1 MCP tool, 4 actions)
 * Actions: exec, bg, ps, kill
 */
import { exec, spawn } from 'child_process';
import { log } from '../core/logger.js';
import { getConfig } from '../core/config.js';

const BLOCKED = [/rm\s+-rf\s+\//, /mkfs/, /dd\s+if=.*of=\/dev/, /chmod\s+777\s+\//];

function isBlocked(cmd) { return BLOCKED.some(re => re.test(cmd)); }

function run(cmd, timeout) {
  return new Promise((resolve, reject) => {
    if (isBlocked(cmd)) return reject(new Error('Blocked: dangerous command'));
    const cfg = getConfig();
    const t = timeout || cfg.tools?.shell_timeout || 30000;
    exec(cmd, { timeout: t, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      if (err?.killed) return reject(new Error(`Timed out after ${t}ms`));
      resolve({ stdout: stdout?.trim() || '', stderr: stderr?.trim() || '', code: err?.code ?? 0 });
    });
  });
}

const ACTIONS = {
  exec: {
    required: ['command'],
    handler: async ({ command, timeout }) => {
      log('shell', `⚙️ $ ${command}`);
      const result = await run(command, timeout);
      const maxLen = getConfig().tools?.max_output || 10000;
      return { stdout: result.stdout.slice(0, maxLen), stderr: result.stderr.slice(0, 2000), exitCode: result.code };
    },
  },

  bg: {
    required: ['command'],
    handler: async ({ command }) => {
      log('shell', `⚙️ [bg] $ ${command}`);
      const child = spawn('bash', ['-c', command], { detached: true, stdio: 'ignore' });
      child.unref();
      return { pid: child.pid, background: true, command };
    },
  },

  ps: {
    required: [],
    handler: async ({ filter }) => {
      const cmd = filter ? `ps aux | grep -i "${filter}" | grep -v grep` : 'ps aux --sort=-%cpu | head -20';
      const result = await run(cmd);
      return { processes: result.stdout };
    },
  },

  kill: {
    required: ['pid'],
    handler: async ({ pid, signal }) => {
      const sig = signal || 'SIGTERM';
      process.kill(pid, sig);
      return { pid, signal: sig, killed: true };
    },
  },
};

const actionNames = Object.keys(ACTIONS);

export default {
  name: 'shell',
  description: 'Shell operations: exec (run command), bg (background process), ps (list), kill',
  actions: actionNames.map(name => ({ name, required: ACTIONS[name].required })),
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: actionNames },
      command: { type: 'string', description: 'Shell command' },
      timeout: { type: 'number', description: 'Timeout ms' },
      filter: { type: 'string', description: 'Process filter' },
      pid: { type: 'number', description: 'Process ID' },
      signal: { type: 'string', description: 'Signal (default SIGTERM)' },
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
