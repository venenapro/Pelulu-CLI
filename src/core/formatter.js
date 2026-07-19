/**
 * Formatter — rich output formatting for tool results
 * Like Claude Code's structured output display
 */
import { COLORS } from './logger.js';

export function formatToolResult(toolName, action, result) {
  if (result.isError) return formatError(result.content?.[0]?.text);
  const data = tryParse(result.content?.[0]?.text);
  if (!data) return result.content?.[0]?.text || 'OK';

  switch (toolName) {
    case 'file': return formatFileResult(action, data);
    case 'git': return formatGitResult(action, data);
    case 'shell': return formatShellResult(data);
    case 'search': return formatSearchResult(action, data);
    case 'project': return formatProjectResult(action, data);
    case 'process': return formatProcessResult(data);
    default: return JSON.stringify(data, null, 2);
  }
}

function tryParse(text) {
  try { return JSON.parse(text); } catch { return null; }
}

function formatError(text) {
  return `${COLORS.red}❌ ${text}${COLORS.reset}`;
}

function formatFileResult(action, data) {
  if (action === 'read') {
    const lines = data.content?.split('\n').length || 0;
    return `${COLORS.green}✅${COLORS.reset} ${data.path} (${lines} lines, ${data.totalSize} chars)`;
  }
  if (action === 'write') return `${COLORS.green}✅${COLORS.reset} Written: ${data.path} (${data.written} chars)`;
  if (action === 'edit') return `${COLORS.green}✅${COLORS.reset} Edited: ${data.path} (${data.occurrences} occurrence(s))`;
  if (action === 'list') {
    const dirs = data.items?.filter(i => i.type === 'dir').length || 0;
    const files = data.items?.filter(i => i.type === 'file').length || 0;
    return `${COLORS.green}✅${COLORS.reset} ${data.path}: ${dirs} dirs, ${files} files`;
  }
  if (action === 'exists') return data.exists ? `✅ ${data.type}: ${data.path}` : `❌ Not found: ${data.path}`;
  if (action === 'delete') return `${COLORS.yellow}🗑️${COLORS.reset} Deleted: ${data.path}`;
  return `${COLORS.green}✅${COLORS.reset} ${action}: ${JSON.stringify(data)}`;
}

function formatGitResult(action, data) {
  if (action === 'status') {
    const dirty = data.dirty ? `${COLORS.yellow}dirty${COLORS.reset}` : `${COLORS.green}clean${COLORS.reset}`;
    return `🌿 ${data.branch} (${dirty}) ${data.changes?.length || 0} changes`;
  }
  if (action === 'log') return `📜 ${data.commits?.length || 0} commits:\n  ${data.commits?.join('\n  ')}`;
  if (action === 'commit') return data.committed ? `${COLORS.green}✅${COLORS.reset} Committed: ${data.message}` : `⚠️ ${data.reason}`;
  if (action === 'branch') return data.branches ? `🌿 Branches:\n  ${data.branches.join('\n  ')}` : `✅ ${data.created || data.deleted}`;
  return `${COLORS.green}✅${COLORS.reset} git ${action}: ${JSON.stringify(data)}`;
}

function formatShellResult(data) {
  const exit = data.exitCode === 0 ? `${COLORS.green}0${COLORS.reset}` : `${COLORS.red}${data.exitCode}${COLORS.reset}`;
  let out = `Exit: ${exit}`;
  if (data.stdout) out += `\n${COLORS.dim}${data.stdout.slice(0, 500)}${COLORS.reset}`;
  if (data.stderr) out += `\n${COLORS.red}${data.stderr.slice(0, 200)}${COLORS.reset}`;
  return out;
}

function formatSearchResult(action, data) {
  if (action === 'grep') return `🔍 ${data.matches} matches for "${data.pattern}":\n  ${(data.results || []).join('\n  ')}`;
  if (action === 'find') return `🔍 ${data.matches} files matching "${data.pattern}":\n  ${(data.files || []).join('\n  ')}`;
  if (action === 'web') return `🌐 ${data.url} (${data.status}):\n${data.body?.slice(0, 500)}`;
  return JSON.stringify(data, null, 2);
}

function formatProjectResult(action, data) {
  if (action === 'build') return data.success ? `${COLORS.green}✅ Build OK${COLORS.reset} (${data.type})` : `${COLORS.red}❌ Build failed${COLORS.reset} (exit ${data.exitCode})`;
  if (action === 'test') return data.passed ? `${COLORS.green}✅ Tests passed${COLORS.reset}` : `${COLORS.red}❌ Tests failed${COLORS.reset} (exit ${data.exitCode})`;
  if (action === 'info') return `📁 ${data.name || data.type}: ${data.scripts?.join(', ') || 'no scripts'}`;
  return JSON.stringify(data, null, 2);
}

function formatProcessResult(data) {
  return data.processes || data.top || JSON.stringify(data, null, 2);
}
