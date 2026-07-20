/**
 * SystemPrompt — Enhanced system prompt builder (OpenHands-style)
 * 
 * Builds a comprehensive system prompt with:
 * - Agent identity and capabilities
 * - Available tools with detailed schemas
 * - Workspace context
 * - Microagents/skills (trigger-based)
 * - Plan status
 * - Guidelines and constraints
 */

/**
 * Build the main system prompt
 */
export function buildSystemPrompt({ registry, config, context, microagents, plan }) {
  const tools = registry.all();
  const sections = [];

  // 1. Agent Identity
  sections.push(buildIdentitySection(config));

  // 2. Capabilities
  sections.push(buildCapabilitiesSection());

  // 3. Tools
  sections.push(buildToolsSection(tools));

  // 4. Workspace Context
  if (context) {
    sections.push(`## Workspace Context\n${context}`);
  }

  // 5. Microagents/Skills
  if (microagents && microagents.length > 0) {
    sections.push(buildMicroagentsSection(microagents));
  }

  // 6. Plan Status
  if (plan) {
    sections.push(`## Current Plan\n${plan.toPrompt()}`);
  }

  // 7. Guidelines
  sections.push(buildGuidelinesSection());

  // 8. Response Format
  sections.push(buildResponseFormatSection());

  return sections.join('\n\n');
}

function buildIdentitySection(config) {
  const name = config.agent?.name || 'Pelulu';
  return `# ${name} — AI Coding Agent

You are ${name}, an autonomous AI coding agent. You help users with software development tasks by reading, writing, and executing code.

You work in a terminal environment and have access to various tools for file operations, shell commands, git, and more.

Your goal is to complete tasks efficiently and correctly. You should:
- Think step by step before acting
- Read files before modifying them
- Test your changes when possible
- Explain what you're doing clearly`;
}

function buildCapabilitiesSection() {
  return `## Capabilities

You can:
- **Read and write files** — View, create, edit, and delete files
- **Execute shell commands** — Run any command, manage processes
- **Git operations** — Clone, commit, push, pull, manage branches
- **Search code** — Find files, grep content, analyze patterns
- **Manage projects** — Detect project type, run scripts, manage dependencies
- **Plan complex tasks** — Break down tasks into steps and track progress
- **Ask for clarification** — When requirements are unclear, ask the user`;
}

function buildToolsSection(tools) {
  const lines = ['## Available Tools', ''];

  for (const tool of tools) {
    lines.push(`### ${tool.name}`);
    lines.push(tool.description);

    if (tool.actions && tool.actions.length > 0) {
      lines.push('');
      lines.push('**Actions:**');
      for (const action of tool.actions) {
        const required = action.required?.length > 0 ? ` (required: ${action.required.join(', ')})` : '';
        lines.push(`- \`${action.name}\`${required}`);
      }
    }

    if (tool.inputSchema?.properties) {
      lines.push('');
      lines.push('**Parameters:**');
      const props = tool.inputSchema.properties;
      for (const [key, val] of Object.entries(props)) {
        if (key === 'action') continue;
        const desc = val.description || val.type;
        lines.push(`- \`${key}\` — ${desc}`);
      }
    }

    lines.push('');
  }

  // Add the special "finish" tool
  lines.push('### finish');
  lines.push('Signal that you have completed the task.');
  lines.push('');
  lines.push('**Parameters:**');
  lines.push('- `result` — Summary of what was accomplished');
  lines.push('');

  return lines.join('\n');
}

function buildMicroagentsSection(microagents) {
  const lines = ['## Skills & Knowledge', ''];

  for (const agent of microagents) {
    if (agent.trigger) {
      lines.push(`### [Triggered by: ${agent.trigger.join(', ')}]`);
    } else {
      lines.push('### [Always Active]');
    }
    lines.push(agent.content);
    lines.push('');
  }

  return lines.join('\n');
}

function buildGuidelinesSection() {
  return `## Guidelines

### Safety
- Never run destructive commands without explicit confirmation
- Always read a file before editing it
- Back up important files before major changes
- Use \`git status\` before committing

### Efficiency
- Prefer editing over rewriting entire files
- Use search tools to find relevant code before making changes
- Combine related changes into single operations
- Run tests after making changes

### Communication
- Be concise but clear in explanations
- Show code changes using diff format when possible
- Explain your reasoning for complex decisions
- Ask for clarification when requirements are ambiguous

### Error Handling
- If a tool call fails, analyze the error and try a different approach
- Don't retry the same failing command without changes
- If stuck, explain the problem and ask for guidance

### Git Best Practices
- Make atomic commits with clear messages
- Use branches for experimental changes
- Pull before pushing to avoid conflicts
- Review changes with \`git diff\` before committing`;
}

function buildResponseFormatSection() {
  return `## Response Format

When you need to use a tool, call it directly. You can call multiple tools in sequence.

When you've completed the task, call the \`finish\` tool with a summary of what you did.

Example flow:
1. User: "Fix the bug in auth.js"
2. You: Read auth.js, find the bug
3. You: Edit auth.js to fix the bug
4. You: Run tests to verify
5. You: Call finish(result="Fixed the null check in authenticate()")`;
}

/**
 * Build microagents from skill files
 */
export function loadMicroagents(skillsDir) {
  // This would load .md files from skills directory
  // For now, return empty - will be implemented with file loading
  return [];
}

/**
 * Match microagents based on user input
 */
export function matchMicroagents(userInput, allMicroagents) {
  const input = userInput.toLowerCase();
  const matched = [];

  for (const agent of allMicroagents) {
    if (!agent.trigger || agent.trigger.length === 0) {
      // Always-active agents
      matched.push(agent);
      continue;
    }

    // Check if any trigger keyword matches
    const triggered = agent.trigger.some(keyword =>
      input.includes(keyword.toLowerCase())
    );
    if (triggered) {
      matched.push(agent);
    }
  }

  return matched;
}
