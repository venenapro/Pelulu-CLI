/**
 * Confirm — ask before destructive operations
 * Pattern: Claude Code asks before rm, force push, overwrite, etc.
 */
import { createInterface } from 'readline';
import { COLORS } from './logger.js';

const DESTRUCTIVE_PATTERNS = [
  { pattern: /delete|remove|rm/i, level: 'warn', msg: 'This will delete files' },
  { pattern: /force.*push|push.*force/i, level: 'danger', msg: 'Force push will overwrite remote' },
  { pattern: /reset.*--hard/i, level: 'danger', msg: 'Hard reset will lose changes' },
  { pattern: /checkout.*--force/i, level: 'warn', msg: 'Force checkout will discard changes' },
  { pattern: /drop.*table|truncate/i, level: 'danger', msg: 'Database destructive operation' },
  { pattern: /chmod.*777/i, level: 'warn', msg: 'Insecure permissions' },
];

export function isDestructive(toolName, args) {
  const str = JSON.stringify(args);
  for (const { pattern, level, msg } of DESTRUCTIVE_PATTERNS) {
    if (pattern.test(str)) return { destructive: true, level, msg };
  }
  if (toolName === 'file' && args.action === 'delete') return { destructive: true, level: 'warn', msg: 'Delete file' };
  if (toolName === 'shell' && /rm\s/.test(args.command)) return { destructive: true, level: 'warn', msg: 'Remove files' };
  return { destructive: false };
}

export async function askConfirmation(toolName, args, check) {
  if (!check.destructive) return true;

  const color = check.level === 'danger' ? COLORS.red : COLORS.yellow;
  const icon = check.level === 'danger' ? '🚨' : '⚠️';

  console.log(`\n${color}${icon} ${check.msg}${COLORS.reset}`);
  console.log(`${COLORS.dim}  Tool: ${toolName}${COLORS.reset}`);
  console.log(`${COLORS.dim}  Args: ${JSON.stringify(args).slice(0, 100)}${COLORS.reset}`);

  if (!process.stdin.isTTY) {
    console.log(`${COLORS.yellow}  Auto-approved (non-interactive)${COLORS.reset}\n`);
    return true;
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${color}  Continue? (y/N): ${COLORS.reset}`, (answer) => {
      rl.close();
      const ok = answer.trim().toLowerCase() === 'y';
      if (!ok) console.log(`${COLORS.red}  ❌ Cancelled${COLORS.reset}\n`);
      resolve(ok);
    });
  });
}
