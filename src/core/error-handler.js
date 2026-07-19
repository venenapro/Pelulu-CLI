/**
 * ErrorHandler — smart error handling with suggestions
 * Like Claude Code: shows what went wrong + how to fix it
 */
import { COLORS } from './logger.js';

const ERROR_SUGGESTIONS = {
  'ENOENT': (e) => `File not found. Check the path: ${e.path || ''}`,
  'EACCES': () => 'Permission denied. Check file permissions.',
  'EISDIR': () => 'Is a directory, not a file. Use "list" action instead.',
  'ENOTDIR': () => 'Not a directory. Check the path.',
  'EEXIST': () => 'Already exists. Use "edit" to modify or delete first.',
  'ETIMEDOUT': () => 'Timed out. Try increasing timeout or check network.',
  'ECONNREFUSED': () => 'Connection refused. Is the server running?',
  'ENOTFOUND': () => 'Host not found. Check the URL or DNS.',
  'MODULE_NOT_FOUND': (e) => `Module not found. Run: npm install`,
  'SyntaxError': () => 'Syntax error in code. Check brackets, quotes, semicolons.',
};

export function handleError(error) {
  const code = error.code || error.constructor?.name || 'UNKNOWN';
  const suggestion = ERROR_SUGGESTIONS[code]?.(error) || null;

  const lines = [`${COLORS.red}❌ ${error.message}${COLORS.reset}`];
  if (suggestion) lines.push(`${COLORS.yellow}💡 ${suggestion}${COLORS.reset}`);

  return lines.join('\n');
}

export function wrapToolError(toolName, action, fn) {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (e) {
      const enhanced = handleError(e);
      throw new Error(enhanced);
    }
  };
}
