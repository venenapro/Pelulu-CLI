/**
 * HistoryCondenser — Manage long conversations (OpenHands-style)
 * 
 * When history gets too long, condense it by:
 * 1. Summarizing old messages
 * 2. Keeping recent messages intact
 * 3. Preserving important context (files read, errors, decisions)
 */
import { debug } from '../core/logger.js';

export class HistoryCondenser {
  #maxMessages;
  #maxTokens;
  #condensedHistory = [];

  constructor({ maxMessages = 50, maxTokens = 100000 } = {}) {
    this.#maxMessages = maxMessages;
    this.#maxTokens = maxTokens;
  }

  /**
   * Check if history needs condensation
   */
  needsCondensation(messages) {
    if (messages.length > this.#maxMessages) return true;
    const estimatedTokens = this.#estimateTokens(messages);
    if (estimatedTokens > this.#maxTokens) return true;
    return false;
  }

  /**
   * Condense history to fit within limits
   * @param {Array} messages - Full message history
   * @param {object} llm - LLM client for summarization (optional)
   * @returns {Array} - Condensed messages
   */
  async condense(messages, llm = null) {
    if (!this.needsCondensation(messages)) return messages;

    debug('history', `Condensing ${messages.length} messages`);

    // Strategy 1: Keep first message + last N messages
    const keepRecent = Math.floor(this.#maxMessages * 0.7);
    const firstMessage = messages[0];
    const recentMessages = messages.slice(-keepRecent);

    // Strategy 2: Summarize middle section if LLM available
    if (llm) {
      const middleMessages = messages.slice(1, -keepRecent);
      const summary = await this.#summarize(middleMessages, llm);

      if (summary) {
        return [
          firstMessage,
          { role: 'system', content: `[Previous conversation summary]: ${summary}` },
          ...recentMessages,
        ];
      }
    }

    // Fallback: Just keep first + recent
    return [firstMessage, ...recentMessages];
  }

  /**
   * Summarize a batch of messages using LLM
   */
  async #summarize(messages, llm) {
    try {
      const conversation = messages.map(m => {
        if (m.role === 'user') return `User: ${m.content}`;
        if (m.role === 'assistant') return `Assistant: ${m.content || '(tool call)'}`;
        if (m.role === 'tool') return `Tool (${m.name}): ${typeof m.content === 'string' ? m.content.slice(0, 200) : '(result)'}`;
        return '';
      }).filter(Boolean).join('\n');

      const response = await llm.chat([
        { role: 'system', content: 'Summarize this conversation concisely. Focus on: files modified, decisions made, errors encountered, and current task status. Max 200 words.' },
        { role: 'user', content: conversation },
      ]);

      let content = response.content;
      if (Array.isArray(content)) {
        content = content.filter(c => c.type === 'text').map(c => c.text).join('');
      }

      return content;
    } catch (err) {
      debug('history', `Summarization failed: ${err.message}`);
      return null;
    }
  }

  /**
   * Extract important context from messages
   * This context is preserved even when messages are condensed
   */
  extractImportantContext(messages) {
    const context = {
      filesRead: new Set(),
      filesModified: new Set(),
      errors: [],
      decisions: [],
      toolCalls: [],
    };

    for (const msg of messages) {
      // Track file operations
      if (msg.role === 'tool' && msg.name === 'file') {
        try {
          const result = JSON.parse(msg.content);
          if (result.path) {
            if (msg.args?.action === 'read') context.filesRead.add(result.path);
            if (msg.args?.action === 'write' || msg.args?.action === 'edit') {
              context.filesModified.add(result.path);
            }
          }
        } catch {}
      }

      // Track errors
      if (msg.role === 'tool' && msg.content?.includes('error')) {
        context.errors.push(msg.content.slice(0, 200));
      }

      // Track tool calls
      if (msg.role === 'tool') {
        context.toolCalls.push({
          name: msg.name,
          timestamp: msg.timestamp,
        });
      }
    }

    return {
      filesRead: [...context.filesRead],
      filesModified: [...context.filesModified],
      recentErrors: context.errors.slice(-5),
      totalToolCalls: context.toolCalls.length,
    };
  }

  /**
   * Estimate token count (rough approximation)
   */
  #estimateTokens(messages) {
    let totalChars = 0;
    for (const msg of messages) {
      if (typeof msg.content === 'string') {
        totalChars += msg.content.length;
      }
      if (msg.tool_calls) {
        totalChars += JSON.stringify(msg.tool_calls).length;
      }
    }
    // Rough estimate: ~4 chars per token
    return Math.ceil(totalChars / 4);
  }

  /**
   * Build context summary for condensed history
   */
  buildContextSummary(messages) {
    const context = this.extractImportantContext(messages);
    const parts = [];

    if (context.filesRead.length > 0) {
      parts.push(`Files read: ${context.filesRead.join(', ')}`);
    }
    if (context.filesModified.length > 0) {
      parts.push(`Files modified: ${context.filesModified.join(', ')}`);
    }
    if (context.recentErrors.length > 0) {
      parts.push(`Recent errors:\n${context.recentErrors.map(e => `  - ${e}`).join('\n')}`);
    }
    parts.push(`Total tool calls: ${context.totalToolCalls}`);

    return parts.join('\n');
  }

  /**
   * Get optimal message window for a given token budget
   */
  getWindow(messages, tokenBudget) {
    let currentTokens = 0;
    let endIndex = messages.length;

    // Walk backwards from the end
    for (let i = messages.length - 1; i >= 0; i--) {
      const msgTokens = this.#estimateTokens([messages[i]]);
      if (currentTokens + msgTokens > tokenBudget) break;
      currentTokens += msgTokens;
      endIndex = i;
    }

    // Always include the first message (user's original request)
    if (endIndex > 1) {
      return [messages[0], ...messages.slice(endIndex)];
    }
    return messages.slice(endIndex);
  }
}
