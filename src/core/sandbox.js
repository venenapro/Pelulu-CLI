/**
 * Sandbox — safety layer for tool execution
 * Validates inputs, blocks dangerous operations, rate limits
 */
import { resolve } from 'path';
import { homedir } from 'os';

const HOME = homedir();
const DANGEROUS_PATTERNS = [
  /rm\s+-rf\s+\/$/i, /rm\s+-rf\s+\/[^a-z]/i, /rm\s+-rf\s+\/\s/i,
  /mkfs/i, /dd\s+if=.*of=\/dev/i,
  />\s*\/dev\/sd/i, /chmod\s+000/i, /shutdown/i, /reboot/i,
];
const RATE_LIMIT_WINDOW = 1000; // 1 second
const MAX_CALLS_PER_WINDOW = 10;

export class Sandbox {
  #callTimes = [];

  validate(toolName, args) {
    // Rate limiting
    const now = Date.now();
    this.#callTimes = this.#callTimes.filter(t => now - t < RATE_LIMIT_WINDOW);
    if (this.#callTimes.length >= MAX_CALLS_PER_WINDOW) {
      throw new Error('Rate limit exceeded. Slow down.');
    }
    this.#callTimes.push(now);

    // Validate shell commands
    if (toolName === 'shell' && args.command) {
      for (const pattern of DANGEROUS_PATTERNS) {
        if (pattern.test(args.command)) {
          throw new Error(`Blocked dangerous command: ${args.command}`);
        }
      }
    }

    // Validate file paths
    if (args.path) {
      const abs = resolve(args.path.replace(/^~(?=$|[/\\])/g, HOME));
      const blocked = ['/etc/shadow', '/etc/passwd', '/etc/sudoers', '/proc', '/sys'];
      if (blocked.some(p => abs.startsWith(p))) {
        throw new Error(`Access denied: ${abs}`);
      }
    }

    // Validate git commit messages
    if (toolName === 'git' && args.action === 'commit' && !args.message) {
      throw new Error('Commit message required');
    }

    return true;
  }
}
