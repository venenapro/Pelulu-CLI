/**
 * SystemPrompt — builds context prompt for XiaoZhi LLM
 * 
 * Now supports both legacy mode and OpenHands-style agent mode.
 * The agent mode provides richer context and tool descriptions.
 */

// Re-export from agent module for backward compatibility
export { buildSystemPrompt as buildAgentSystemPrompt } from '../agent/system-prompt.js';

/**
 * Legacy system prompt (for direct XiaoZhi MQTT mode)
 */
export function buildSystemPrompt(registry, config) {
  const tools = registry.list();
  const agentName = config.agent?.name || 'Pelulu';
  const lines = [
    `You are ${agentName}, an AI coding agent running in Termux/Node.js.`,
    `You have access to ${tools.length} tools. Use them to help the user.`,
    '',
    '## Available Tools',
    '',
  ];

  for (const tool of tools) {
    lines.push(`### ${tool.name}`);
    lines.push(`${tool.description}`);
    if (tool.actions && tool.actions.length > 0) {
      lines.push(`Actions: ${tool.actions.map(a => typeof a === 'string' ? a : a.name).join(', ')}`);
    }
    lines.push('');
  }

  lines.push('## Tool Call Format');
  lines.push('When you need to use a tool, respond with a JSON object:');
  lines.push('```json');
  lines.push('{"tool": "tool_name", "action": "action_name", "param1": "value1", ...}');
  lines.push('```');
  lines.push('');
  lines.push('Example: {"tool": "file", "action": "read", "path": "./src/index.js"}');
  lines.push('Example: {"tool": "shell", "action": "exec", "command": "npm test"}');
  lines.push('Example: {"tool": "git", "action": "status"}');
  lines.push('');

  lines.push('## Guidelines');
  lines.push('- Always read files before editing them');
  lines.push('- Use git status before committing');
  lines.push('- Run tests after making changes');
  lines.push('- Be concise in explanations');
  lines.push('- Show code changes clearly');
  lines.push('- When done, call: {"tool": "finish", "result": "summary of what was done"}');

  return lines.join('\n');
}

export function buildToolHint(toolName, action) {
  return `[Calling ${toolName}.${action}]`;
}
