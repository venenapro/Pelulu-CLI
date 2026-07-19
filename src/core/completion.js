/**
 * Completion — command completion hints for REPL
 */
const COMMANDS = [
  '/tools', '/help', '/status', '/stats', '/workspace', '/files',
  '/call', '/conv', '/history', '/doctor', '/model', '/clear', '/quit',
];

const TOOL_NAMES = [
  'file', 'shell', 'git', 'search', 'project', 'process',
  'network', 'env', 'ai', 'snippet', 'template', 'history',
  'config', 'diff', 'watch',
];

const ACTIONS = {
  file: ['read', 'write', 'edit', 'list', 'delete', 'mkdir', 'copy', 'move', 'exists'],
  shell: ['exec', 'bg', 'ps', 'kill'],
  git: ['init', 'clone', 'status', 'diff', 'log', 'add', 'commit', 'push', 'pull', 'branch'],
  search: ['grep', 'find', 'web'],
  project: ['init', 'build', 'test', 'lint', 'deps', 'info'],
  process: ['list', 'info', 'kill', 'top'],
  network: ['fetch', 'download', 'ping'],
  env: ['get', 'set', 'list'],
  ai: ['explain', 'analyze', 'detectLanguage', 'summarize', 'diff'],
  snippet: ['save', 'load', 'list', 'delete'],
  template: ['list', 'create', 'info'],
  history: ['list', 'clear', 'stats'],
  config: ['get', 'set', 'list', 'reset'],
  diff: ['compare', 'stats', 'patch'],
  watch: ['start', 'stop', 'status'],
};

export function getCompletions(input) {
  const parts = input.trim().split(/\s+/);

  // Command completion
  if (parts.length === 1 && parts[0].startsWith('/')) {
    return COMMANDS.filter(c => c.startsWith(parts[0]));
  }

  // Tool name completion after /call
  if (parts[0] === '/call' && parts.length === 2) {
    return TOOL_NAMES.filter(t => t.startsWith(parts[1]));
  }

  // Action completion after /call <tool>
  if (parts[0] === '/call' && parts.length === 3) {
    const tool = parts[1];
    const actions = ACTIONS[tool];
    if (actions) return actions.filter(a => a.startsWith(parts[2]));
  }

  // Intent completion
  if (parts.length === 1) {
    const intents = ['read', 'write', 'edit', 'run', 'git', 'build', 'test', 'search', 'ls', 'mkdir', 'kill', 'fetch', 'ping', 'analyze'];
    return intents.filter(i => i.startsWith(parts[0]));
  }

  return [];
}

export function formatCompletions(completions) {
  if (!completions.length) return '';
  return completions.map(c => `  ${c}`).join('\n');
}
