/**
 * AutoFormat — format code after edits
 * Detects project type and runs appropriate formatter
 */
import { exec } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { getConfig } from './config.js';
import { log, debug } from './logger.js';

const FORMATTERS = {
  node: { cmd: 'npx prettier --write', ext: ['js', 'jsx', 'ts', 'tsx', 'json', 'md'] },
  python: { cmd: 'python -m black', ext: ['py'] },
  rust: { cmd: 'rustfmt', ext: ['rs'] },
  go: { cmd: 'gofmt -w', ext: ['go'] },
};

async function detectType(cwd) {
  if (existsSync(join(cwd, 'package.json'))) return 'node';
  if (existsSync(join(cwd, 'pyproject.toml')) || existsSync(join(cwd, 'requirements.txt'))) return 'python';
  if (existsSync(join(cwd, 'Cargo.toml'))) return 'rust';
  if (existsSync(join(cwd, 'go.mod'))) return 'go';
  return null;
}

export async function autoFormat(filePath) {
  const cfg = getConfig();
  if (!cfg.tools?.auto_format) return; // disabled by default

  const cwd = cfg.agent?.workspace || process.cwd();
  const type = await detectType(cwd);
  if (!type) return;

  const formatter = FORMATTERS[type];
  if (!formatter) return;

  const ext = filePath.split('.').pop()?.toLowerCase();
  if (!formatter.ext.includes(ext)) return;

  return new Promise((resolve) => {
    exec(`${formatter.cmd} "${filePath}"`, { cwd, timeout: 10000 }, (err, stdout, stderr) => {
      if (err) debug(`Auto-format failed: ${err.message}`);
      else log('file', `🎨 Formatted: ${filePath}`);
      resolve(!err);
    });
  });
}
