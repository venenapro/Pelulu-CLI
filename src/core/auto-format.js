/**
 * AutoFormat — format code after edits
 * Detects project type and runs appropriate formatter
 * Falls back to basic cleanup if no formatter is available
 */
import { exec } from 'child_process';
import { readFile, writeFile } from 'fs/promises';
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

/**
 * Basic formatter — no external deps required
 * Trims trailing whitespace, ensures final newline, normalizes blank lines
 */
async function basicFormat(filePath) {
  try {
    const content = await readFile(filePath, 'utf-8');
    const formatted = content
      .replace(/[ \t]+$/gm, '')     // trailing whitespace
      .replace(/\n{3,}/g, '\n\n')   // max 2 consecutive blank lines
      .replace(/\r\n/g, '\n')       // normalize line endings
      .replace(/\r/g, '\n');

    // Ensure final newline
    const final = formatted.endsWith('\n') ? formatted : formatted + '\n';

    if (final !== content) {
      await writeFile(filePath, final, 'utf-8');
      log('file', `formatted: ${filePath}`);
      return true;
    }
    return false;
  } catch (e) {
    debug(`Basic format failed: ${e.message}`);
    return false;
  }
}

/**
 * Try external formatter (prettier, black, etc.)
 * Returns true if successful, false if not available or failed
 */
async function externalFormat(formatter, filePath, cwd) {
  return new Promise((resolve) => {
    exec(`${formatter.cmd} "${filePath}"`, { cwd, timeout: 10000 }, (err, stdout, stderr) => {
      if (err) {
        debug(`External formatter failed: ${err.message}`);
        resolve(false);
      } else {
        log('file', `formatted: ${filePath}`);
        resolve(true);
      }
    });
  });
}

export async function autoFormat(filePath) {
  const cfg = getConfig();
  if (!cfg.tools?.auto_format) return; // disabled by default

  const cwd = cfg.agent?.workspace || process.cwd();
  const type = await detectType(cwd);

  const ext = filePath.split('.').pop()?.toLowerCase();
  const codeExts = ['js', 'jsx', 'ts', 'tsx', 'json', 'md', 'py', 'rs', 'go', 'css', 'html', 'yaml', 'yml', 'toml'];
  if (!codeExts.includes(ext)) return;

  // Try external formatter first
  if (type && FORMATTERS[type]) {
    const formatter = FORMATTERS[type];
    if (formatter.ext.includes(ext)) {
      const ok = await externalFormat(formatter, filePath, cwd);
      if (ok) return;
    }
  }

  // Fallback to basic format
  await basicFormat(filePath);
}
