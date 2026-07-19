/**
 * Intent — parse natural language commands for direct tool execution
 * "read index.js" → file read {path: "index.js"}
 * "run npm test" → shell exec {command: "npm test"}
 * "git status" → git status
 */
const PATTERNS = [
  // File operations
  { re: /^(read|cat|show|open)\s+(.+)/i, tool: 'file', action: 'read', extract: (m) => ({ path: m[2] }) },
  { re: /^(write|create|make)\s+(?:file\s+)?(.+)/i, tool: 'file', action: 'write', extract: (m) => ({ path: m[2] }) },
  { re: /^(edit|change|replace)\s+(.+)/i, tool: 'file', action: 'edit', extract: (m) => ({ path: m[2] }) },
  { re: /^(delete|remove|rm)\s+(.+)/i, tool: 'file', action: 'delete', extract: (m) => ({ path: m[2] }) },
  { re: /^(list|ls|dir)\s*(.*)/i, tool: 'file', action: 'list', extract: (m) => ({ path: m[2] || '.' }) },
  { re: /^(mkdir)\s+(.+)/i, tool: 'file', action: 'mkdir', extract: (m) => ({ path: m[2] }) },
  { re: /^(exists|exist|check)\s+(.+)/i, tool: 'file', action: 'exists', extract: (m) => ({ path: m[2] }) },
  { re: /^(copy|cp)\s+(\S+)\s+(\S+)/i, tool: 'file', action: 'copy', extract: (m) => ({ from: m[2], to: m[3] }) },
  { re: /^(move|mv)\s+(\S+)\s+(\S+)/i, tool: 'file', action: 'move', extract: (m) => ({ from: m[2], to: m[3] }) },
  // Shell
  { re: /^(run|exec|execute)\s+(.+)/i, tool: 'shell', action: 'exec', extract: (m) => ({ command: m[2] }) },
  { re: /^\.\/(.+)/i, tool: 'shell', action: 'exec', extract: (m) => ({ command: `./${m[1]}` }) },
  // Git
  { re: /^(git)\s+(.+)/i, tool: 'git', action: null, extract: (m) => {
    const parts = m[2].split(' ');
    return { action: parts[0], message: parts.slice(1).join(' ') || undefined };
  }},
  { re: /^(commit)\s+(.+)/i, tool: 'git', action: 'commit', extract: (m) => ({ message: m[2] }) },
  { re: /^(push|pull|clone|status|diff|log)\s*(.*)/i, tool: 'git', action: (m) => m[1].toLowerCase(), extract: (m) => ({}) },
  // Search
  { re: /^(search|grep|find)\s+(.+)/i, tool: 'search', action: 'grep', extract: (m) => ({ pattern: m[2] }) },
  { re: /^(where|locate)\s+(.+)/i, tool: 'search', action: 'find', extract: (m) => ({ name: m[2] }) },
  // Project
  { re: /^(build|compile)\s*(.*)/i, tool: 'project', action: 'build', extract: () => ({}) },
  { re: /^(test|check)\s*(.*)/i, tool: 'project', action: 'test', extract: () => ({}) },
  { re: /^(lint|format|fmt)\s*(.*)/i, tool: 'project', action: 'lint', extract: () => ({}) },
  { re: /^(install|deps)\s*(.*)/i, tool: 'project', action: 'deps', extract: () => ({ install: true }) },
  // Process
  { re: /^(kill)\s+(\d+)/i, tool: 'process', action: 'kill', extract: (m) => ({ pid: parseInt(m[2]) }) },
  { re: /^(ps|processes|top)\s*(.*)/i, tool: 'process', action: 'list', extract: (m) => ({ filter: m[2] || undefined }) },
  // Network
  { re: /^(fetch|curl|http)\s+(.+)/i, tool: 'network', action: 'fetch', extract: (m) => ({ url: m[2] }) },
  { re: /^(ping)\s+(.+)/i, tool: 'network', action: 'ping', extract: (m) => ({ host: m[2] }) },
  { re: /^(download)\s+(.+)/i, tool: 'network', action: 'download', extract: (m) => ({ url: m[2] }) },
  // AI
  { re: /^(analyze|inspect)\s+(.+)/i, tool: 'ai', action: 'analyze', extract: (m) => ({ path: m[2] }) },
  { re: /^(summarize|summary)\s+(.+)/i, tool: 'ai', action: 'summarize', extract: (m) => ({ path: m[2] }) },
  { re: /^(diff)\s+(\S+)\s+(\S+)/i, tool: 'ai', action: 'diff', extract: (m) => ({ file1: m[2], file2: m[3] }) },
  // Snippet
  { re: /^(snippet|snip)\s+save\s+(\S+)\s+(.+)/i, tool: 'snippet', action: 'save', extract: (m) => ({ name: m[2], code: m[3] }) },
  { re: /^(snippet|snip)\s+load\s+(\S+)/i, tool: 'snippet', action: 'load', extract: (m) => ({ name: m[2] }) },
  { re: /^(snippet|snip)\s+list/i, tool: 'snippet', action: 'list', extract: () => ({}) },
  // Env
  { re: /^(env|envvar)\s+(\S+)/i, tool: 'env', action: 'get', extract: (m) => ({ name: m[2] }) },
  // Template
  { re: /^(scaffold|scaffold|new project|create project)\s+(\S+)\s+(\S+)/i, tool: 'template', action: 'create', extract: (m) => ({ template: m[2], name: m[3] }) },
  { re: /^(templates|scaffolds)/i, tool: 'template', action: 'list', extract: () => ({}) },
  // History
  { re: /^(history|log|calls)\s*(.*)/i, tool: 'history', action: 'list', extract: (m) => ({ limit: parseInt(m[2]) || 20 }) },
  // Config
  { re: /^(config|conf|setting)\s+(get|set|list|reset)\s*(.*)/i, tool: 'config', action: null, extract: (m) => ({ action: m[2], key: m[3] || undefined }) },
  // Diff
  { re: /^(diff|compare)\s+(\S+)\s+(\S+)/i, tool: 'diff', action: 'compare', extract: (m) => ({ file1: m[2], file2: m[3] }) },
  // Watch
  { re: /^(watch|monitor)\s+(.+)/i, tool: 'watch', action: 'start', extract: (m) => ({ path: m[2] }) },
  { re: /^(unwatch|stop watching)\s+(.+)/i, tool: 'watch', action: 'stop', extract: (m) => ({ path: m[2] }) },
];

export function parseIntent(input) {
  for (const { re, tool, action, extract } of PATTERNS) {
    const match = input.match(re);
    if (match) {
      const params = extract(match);
      return {
        matched: true,
        tool,
        action: action || params.action,
        params: { ...params, action: action || params.action },
      };
    }
  }
  return { matched: false };
}
