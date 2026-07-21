/**
 * Project Tool — project lifecycle operations (1 MCP tool, 6 actions)
 * Actions: init, build, test, lint, deps, info
 *
 * Long-running operations (build, test, deps) stream progress via task:progress
 * so the TUI shows live feedback instead of appearing stuck.
 */
import { exec } from 'child_process';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { log } from '../core/logger.js';
import { getConfig } from '../core/config.js';
import { bus } from '../core/event-bus.js';

function run(cmd, cwd, timeout = 120000) {
  return new Promise((resolve, reject) => {
    exec(cmd, { cwd, timeout, maxBuffer: 512 * 1024 }, (err, stdout, stderr) => {
      if (err?.killed) return reject(new Error(`Timed out: ${cmd}`));
      resolve({ stdout: stdout?.trim() || '', stderr: stderr?.trim() || '', code: err?.code ?? 0 });
    });
  });
}

/**
 * Run a command with progress reporting for long operations.
 */
async function runWithProgress(cmd, dir, { label, timeout = 120000 } = {}) {
  const started = Date.now();
  bus.emit('task:progress', {
    tool: 'project', running: true, phase: 'exec',
    target: label || cmd.split(' ')[0], elapsed: 0, log: `running: ${cmd}`,
  });

  try {
    const result = await run(cmd, dir, timeout);
    const elapsed = Math.round((Date.now() - started) / 1000);
    bus.emit('task:progress', {
      tool: 'project', running: false, phase: 'done',
      target: label || cmd.split(' ')[0], elapsed,
      log: result.code === 0 ? 'completed' : `exit ${result.code}`,
    });
    return result;
  } catch (err) {
    bus.emit('task:progress', {
      tool: 'project', running: false, phase: 'error',
      target: label || cmd.split(' ')[0],
      elapsed: Math.round((Date.now() - started) / 1000), log: err.message,
    });
    throw err;
  }
}

function cwd(p) { return p || getConfig().agent?.workspace || process.cwd(); }

async function detectProject(dir) {
  const checks = [
    ['package.json', 'node'], ['requirements.txt', 'python'], ['pyproject.toml', 'python'],
    ['Cargo.toml', 'rust'], ['go.mod', 'go'], ['CMakeLists.txt', 'cmake'], ['Makefile', 'make'],
    ['pom.xml', 'java'], ['build.gradle', 'gradle'],
  ];
  for (const [file, type] of checks) {
    if (existsSync(join(dir, file))) return type;
  }
  return 'unknown';
}

const BUILD_CMD = { node: 'npm run build', python: 'python -m build', go: 'go build ./...', rust: 'cargo build', make: 'make', cmake: 'cmake --build build', java: 'mvn package', gradle: 'gradle build' };
const TEST_CMD = { node: 'npm test', python: 'pytest', go: 'go test ./...', rust: 'cargo test', make: 'make test', java: 'mvn test', gradle: 'gradle test' };
const LINT_CMD = { node: 'npx eslint . 2>&1 || true', python: 'ruff check . 2>&1 || true', go: 'golangci-lint run 2>&1 || true', rust: 'cargo clippy 2>&1 || true' };
const INSTALL_CMD = { node: 'npm install', python: 'pip install -r requirements.txt', go: 'go mod download', rust: 'cargo fetch', java: 'mvn dependency:resolve', gradle: 'gradle dependencies' };

const ACTIONS = {
  init: {
    required: [],
    handler: async (params) => {
      const dir = cwd(params.path);
      const type = params.template || await detectProject(dir);
      const cmds = { node: 'npm init -y', python: 'python -m venv .venv', go: 'go mod init project', rust: 'cargo init' };
      if (!cmds[type]) throw new Error(`No init for ${type}`);
      await run(cmds[type], dir);
      return { initialized: true, type, path: dir };
    },
  },

  build: {
    required: [],
    handler: async (params) => {
      const dir = cwd(params.path);
      const type = await detectProject(dir);
      const cmd = BUILD_CMD[type];
      if (!cmd) throw new Error(`No build for ${type}`);
      log('project', `[BUILD] Building (${type})...`);
      const r = await runWithProgress(cmd, dir, { label: `build (${type})`, timeout: 180000 });
      return { success: r.code === 0, type, exitCode: r.code, output: r.stdout.slice(-500) || r.stderr.slice(-500) };
    },
  },

  test: {
    required: [],
    handler: async (params) => {
      const dir = cwd(params.path);
      const type = await detectProject(dir);
      const cmd = TEST_CMD[type];
      if (!cmd) throw new Error(`No test for ${type}`);
      log('project', `[TEST] Testing (${type})...`);
      const r = await runWithProgress(cmd, dir, { label: `test (${type})`, timeout: 180000 });
      return { passed: r.code === 0, type, exitCode: r.code, output: r.stdout.slice(-1000) || r.stderr.slice(-1000) };
    },
  },

  lint: {
    required: [],
    handler: async (params) => {
      const dir = cwd(params.path);
      const type = await detectProject(dir);
      const cmd = LINT_CMD[type];
      if (!cmd) throw new Error(`No lint for ${type}`);
      const r = await runWithProgress(cmd, dir, { label: `lint (${type})` });
      return { type, issues: r.stdout.slice(-2000) };
    },
  },

  deps: {
    required: [],
    handler: async (params) => {
      const dir = cwd(params.path);
      const type = await detectProject(dir);
      if (params.install) {
        const cmd = INSTALL_CMD[type];
        if (!cmd) throw new Error(`No install for ${type}`);
        log('project', `[DEPS] Installing (${type})...`);
        await runWithProgress(cmd, dir, { label: `deps install (${type})`, timeout: 180000 });
        return { installed: true, type };
      }
      try {
        if (type === 'node') {
          const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf-8'));
          return { type, dependencies: pkg.dependencies || {}, devDependencies: pkg.devDependencies || {} };
        }
        return { type, message: 'Set install=true to install deps' };
      } catch { return { type, error: 'Could not read project config' }; }
    },
  },

  info: {
    required: [],
    handler: async (params) => {
      const dir = cwd(params.path);
      const type = await detectProject(dir);
      const info = { type, path: dir };
      try {
        if (type === 'node') {
          const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf-8'));
          info.name = pkg.name; info.version = pkg.version;
          info.scripts = Object.keys(pkg.scripts || {});
          info.deps = Object.keys(pkg.dependencies || {});
        }
      } catch {}
      return info;
    },
  },
};

const actionNames = Object.keys(ACTIONS);

export default {
  name: 'project',
  description: 'Project lifecycle: init, build, test, lint, deps, info (auto-detects type)',
  actions: actionNames.map(name => ({ name, required: ACTIONS[name].required })),
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: actionNames },
      path: { type: 'string', description: 'Project directory' },
      template: { type: 'string', description: 'Project type for init' },
      install: { type: 'boolean', description: 'Install deps' },
    },
    required: ['action'],
  },
  async handler({ action, ...params }) {
    const a = ACTIONS[action];
    if (!a) throw new Error(`Unknown action: ${action}. Use: ${actionNames.join(', ')}`);
    return a.handler(params);
  },
};
