/**
 * SystemPrompt — Minimal system prompt for XiaoZhi
 * 
 * XiaoZhi doesn't support system prompts, so this is used
 * only for agent-internal context tracking.
 */

/**
 * Build minimal system prompt (for internal use only, NOT sent to XiaoZhi)
 */
export function buildSystemPrompt({ config, context, plan }) {
  const name = config.agent?.name || 'Pelulu';
  const parts = [`You are ${name}, a coding agent.`];

  if (context) {
    // Extract only git branch and project type
    const branch = context.match(/Branch:\s*(\S+)/)?.[1];
    const type = context.match(/Type:\s*(\S+)/)?.[1];
    if (branch || type) {
      parts.push([branch && `git:${branch}`, type].filter(Boolean).join(' | '));
    }
  }

  if (plan) {
    parts.push(`Plan: ${plan.goal} (${plan.progress?.percent || 0}%)`);
  }

  return parts.join(' ');
}

/**
 * Match microagents based on user input
 */
export function matchMicroagents(userInput, allMicroagents) {
  if (!allMicroagents?.length) return [];
  const input = userInput.toLowerCase();
  return allMicroagents.filter(agent => {
    if (!agent.trigger?.length) return true;
    return agent.trigger.some(kw => input.includes(kw.toLowerCase()));
  });
}
