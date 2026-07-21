/**
 * Shell Tool — consolidated shell operations (1 MCP tool, 4 actions)
 * Actions: exec, bg, ps, kill
 *
 * Long-running commands are streamable: stdout/stderr are captured in chunks
 * and reported via task:progress so the TUI can show live output. The job
 * layer (core/job-manager.js) auto-backgrounds anything > 8s.
 */
import { exec, spawn } from 'child_process';
import { log } from '../core/logger.js';
import { getConfig } from '../core/config.js';
import { bus } from '../core/event-bus.js';
import { jobManager } from '../core/job-manager.js';

const BLOCKED = [/rm\s+-rf\s+\//, /mkfs/, /dd\s+if=.*of=\/dev/, /chmod\s+777\s+\//];

function isBlocked(cmd) { return BLOCKED.some(re => re.test(cmd)); }

/**
 * Run a command with streaming progress. Emits task:progress on each chunk
 * so the TUI shows live output instead of waiting for the full result.
 */
function runStreaming(cmd, timeout, { label } = {}) {
  return new Promise((resolve, reject) => {
    if (isBlocked(cmd)) return reject(new Error('Blocked: dangerous command'));
    const cfg = getConfig();
    const t = timeout || cfg.tools?.shell_timeout || 30000;
    const started = Date.now();
    let stdout = '';
    let stderr = '';
    let chunkCount = 0;

    const child = spawn('bash', ['-c', cmd], {
      timeout: t,
      maxBuffer: 1024 * 1024,
      env: { ...process.env, FORCE_COLOR: '0' },
    });

    child.stdout?.on('data', (d) => {
      stdout += d;
      chunkCount++;
      if (chunkCount % 5 === 0) {
        bus.emit('task:progress', {
          tool: 'shell', running: true,
          phase: 'exec', target: label || cmd.slice(0, 60),
          elapsed: Math.round((Date.now() - started) / 1000),
          log: `${stdout.length + stderr.length} bytes captured`,
        });
      }
    });

    child.stderr?.on('data', (d) => {
      stderr += d;
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0 && !stdout && stderr) {
        reject(new Error(stderr.trim().slice(0, 500)));
      } else {
        resolve({ stdout: stdout.trim(), stderr: stderr.trim(), code: code ?? 0 });
      }
    });

    // Timeout guard
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`Timed out after ${t}ms`));
    }, t);
    child.on('close', () => clearTimeout(timer));
  });
}

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
      log('shell', `[EXEC] $ ${command}`);
      // Use streaming for commands that might take a while
      const cfg = getConfig();
      const t = timeout || cfg.tools?.shell_timeout || 30000;
      const result = t > 10000
        ? await runStreaming(command, timeout, { label: command.slice(0, 60) })
        : await run(command, timeout);
      const maxLen = cfg.tools?.max_output || 10000;
      return { stdout: result.stdout.slice(0, maxLen), stderr: result.stderr.slice(0, 2000), exitCode: result.code };
    },
  },

  bg: {
    required: ['command'],
    handler: async ({ command }) => {
      log('shell', `[BG] $ ${command}`);
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
