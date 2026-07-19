/**
 * SystemPrompt — builds context prompt for XiaoZhi LLM
 * Tells the AI what tools are available and how to use them
 */

export function buildSystemPrompt(registry, config) {
  const tools = registry.list();
  const lines = [
    `You are ${config.agent?.name || 'a coding agent'} running in Termux/Node.js.`,
    `You have access to ${tools.length} MCP tools. Use them to help the user.`,
    '',
    '## Available Tools',
    '',
  ];

  for (const tool of tools) {
    lines.push(`### ${tool.name}`);
    lines.push(`${tool.description}`);
    lines.push(`Actions: ${tool.actions.join(', ')}`);
    lines.push('');
  }

  lines.push('## Tool Call Format');
  lines.push('When you need to use a tool, call it with the action and required parameters.');
  lines.push('Example: file(action="read", path="./src/index.js")');
  lines.push('Example: shell(action="exec", command="npm test")');
  lines.push('Example: git(action="status")');
  lines.push('');

  lines.push('## Guidelines');
  lines.push('- Always read files before editing them');
  lines.push('- Use git status before committing');
  lines.push('- Run tests after making changes');
  lines.push('- Be concise in explanations');
  lines.push('- Show code changes clearly');

  return lines.join('\n');
}

export function buildToolHint(toolName, action) {
  return `[Calling ${toolName}.${action}]`;
}
