/**
 * LLMClient — Unified LLM interface for XiaoZhi AI
 * 
 * Wraps XiaoZhi's MQTT-based LLM into a standard chat interface.
 * XiaoZhi returns plain text, so tool calls are parsed from JSON in the response.
 */
import { bus } from '../core/event-bus.js';
import { log, debug } from '../core/logger.js';

export class LLMClient {
  #mqtt;
  #config;
  #requestId = 0;
  #pendingRequests = new Map();
  #model = null;
  #usage = { total_tokens: 0, cost: 0 };
  #responseBuffer = '';
  #responseTimer = null;
  #collecting = false;

  constructor(mqtt, config) {
    this.#mqtt = mqtt;
    this.#config = config;

    // Listen for LLM text responses from MQTT
    bus.on('llm:text', (text) => this.#onLlmText(text));
  }

  get model() { return this.#model; }
  get usage() { return { ...this.#usage }; }

  /**
   * Handle incoming LLM text from MQTT
   * XiaoZhi may send multiple messages for one response, so we buffer them
   */
  #onLlmText(text) {
    if (!this.#collecting) return;

    this.#responseBuffer += text;

    // Reset the "done" timer - if no new text comes for 2 seconds, consider response complete
    if (this.#responseTimer) clearTimeout(this.#responseTimer);
    this.#responseTimer = setTimeout(() => this.#finalizeResponse(), 2000);
  }

  /**
   * Finalize the collected response and resolve the pending request
   */
  #finalizeResponse() {
    if (!this.#collecting) return;
    this.#collecting = false;
    this.#responseTimer = null;

    const content = this.#responseBuffer.trim();
    this.#responseBuffer = '';

    // Get the oldest pending request
    const entries = [...this.#pendingRequests.entries()];
    if (entries.length === 0) return;

    const [id, pending] = entries[0];
    clearTimeout(pending.timer);
    this.#pendingRequests.delete(id);

    // Parse tool calls from the response
    const toolCalls = this.#parseToolCalls(content);
    const cleanContent = toolCalls ? this.#stripToolCalls(content) : content;

    debug('llm', `Response resolved: ${cleanContent.length} chars, ${toolCalls?.length || 0} tool calls`);

    pending.resolve({
      content: cleanContent,
      tool_calls: toolCalls || [],
      usage: {},
    });
  }

  /**
   * Send messages to LLM and get response
   * @param {Array} messages - Array of {role, content, tool_calls?}
   * @param {object} options - { tools, signal }
   * @returns {object} - { content, tool_calls, usage }
   */
  async chat(messages, options = {}) {
    const { tools, signal } = options;
    const id = `req_${++this.#requestId}`;

    return new Promise((resolve, reject) => {
      // Set up timeout
      const timeout = this.#config.llm?.timeout || 120000;
      const timer = setTimeout(() => {
        this.#pendingRequests.delete(id);
        this.#collecting = false;
        this.#responseBuffer = '';
        reject(new Error('LLM request timed out'));
      }, timeout);

      // Handle abort
      if (signal) {
        signal.addEventListener('abort', () => {
          clearTimeout(timer);
          this.#pendingRequests.delete(id);
          this.#collecting = false;
          this.#responseBuffer = '';
          reject(new Error('AbortError'));
        }, { once: true });
      }

      // Store pending request
      this.#pendingRequests.set(id, { resolve, reject, timer });

      // Start collecting response
      this.#collecting = true;
      this.#responseBuffer = '';

      // Send to XiaoZhi via MQTT
      this.#sendToLLM(id, messages, tools);
    });
  }

  /**
   * Send messages to LLM via MQTT
   */
  async #sendToLLM(requestId, messages, tools) {
    // Build the prompt from messages
    const prompt = this.#buildPrompt(messages);

    // Build tool descriptions for the prompt
    const toolDescriptions = tools ? this.#buildToolDescriptions(tools) : '';

    // Combine into a single message for XiaoZhi
    const fullPrompt = toolDescriptions
      ? `${prompt}\n\n${toolDescriptions}`
      : prompt;

    debug('llm', `Sending request ${requestId} (${messages.length} messages)`);

    // Send via MQTT
    try {
      await this.#mqtt.sendText(fullPrompt, { requestId });
    } catch (err) {
      const pending = this.#pendingRequests.get(requestId);
      if (pending) {
        clearTimeout(pending.timer);
        this.#pendingRequests.delete(requestId);
      }
      this.#collecting = false;
      throw err;
    }
  }

  /**
   * Build a single prompt from messages array
   */
  #buildPrompt(messages) {
    const parts = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        parts.push(`[System]: ${msg.content}`);
      } else if (msg.role === 'user') {
        parts.push(`[User]: ${msg.content}`);
      } else if (msg.role === 'assistant') {
        if (msg.content) {
          parts.push(`[Assistant]: ${msg.content}`);
        }
        if (msg.tool_calls) {
          for (const tc of msg.tool_calls) {
            parts.push(`[Tool Call]: ${tc.name}(${JSON.stringify(tc.args)})`);
          }
        }
      } else if (msg.role === 'tool') {
        parts.push(`[Tool Result: ${msg.name}]: ${msg.content}`);
      }
    }

    return parts.join('\n\n');
  }

  /**
   * Build tool descriptions for the prompt
   */
  #buildToolDescriptions(tools) {
    const lines = ['## Available Tools', ''];

    for (const tool of tools) {
      lines.push(`### ${tool.name}`);
      lines.push(tool.description);

      if (tool.inputSchema?.properties) {
        const props = tool.inputSchema.properties;
        const paramLines = Object.entries(props)
          .filter(([k]) => k !== 'action')
          .map(([k, v]) => `  - ${k}: ${v.description || v.type}`);
        if (paramLines.length > 0) {
          lines.push('Parameters:');
          lines.push(...paramLines);
        }
      }
      lines.push('');
    }

    lines.push('To call a tool, respond with a JSON object:');
    lines.push('{"tool": "tool_name", "action": "action_name", "param1": "value1", ...}');
    lines.push('');
    lines.push('When done, respond with: {"tool": "finish", "result": "summary of what was done"}');

    return lines.join('\n');
  }

  /**
   * Parse tool calls from text content
   * Looks for JSON objects with "tool" key
   */
  #parseToolCalls(content) {
    if (!content) return null;

    const toolCalls = [];
    
    // Match JSON objects that have a "tool" key
    // Support both single-line and multi-line JSON
    const jsonPattern = /\{[^{}]*"tool"\s*:\s*"[^"]+[^{}]*\}/g;
    const matches = content.match(jsonPattern);

    if (matches) {
      for (const match of matches) {
        try {
          const parsed = JSON.parse(match);
          if (parsed.tool) {
            toolCalls.push({
              id: `tc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
              name: parsed.tool,
              args: { ...parsed, tool: undefined },
            });
          }
        } catch {
          // Not valid JSON, skip
        }
      }
    }

    return toolCalls.length > 0 ? toolCalls : null;
  }

  /**
   * Strip tool call JSON from content
   */
  #stripToolCalls(content) {
    if (!content) return content;
    return content.replace(/\{[^{}]*"tool"\s*:\s*"[^"]+[^{}]*\}/g, '').trim();
  }

  /**
   * Switch to a different model
   */
  setModel(model) {
    this.#model = model;
    debug('llm', `Model switched to: ${model}`);
  }

  /**
   * Clear pending requests
   */
  clearPending() {
    for (const [id, pending] of this.#pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Cleared'));
    }
    this.#pendingRequests.clear();
    this.#collecting = false;
    this.#responseBuffer = '';
  }
}
