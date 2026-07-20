/**
 * MessageSender — handles sending messages to XiaoZhi with proper timing
 * Ensures MCP handshake is complete before sending
 * Waits for tool calls to finish before sending next message
 * Retries on timeout
 */
import { log, debug } from '../core/logger.js';
import { bus } from '../core/event-bus.js';

export class MessageSender {
  constructor(mqtt) {
    this.mqtt = mqtt;
    this.queue = [];
    this.sending = false;
    this.waitingForResponse = false;
    this.lastToolCallTime = 0;
    this.toolCallCount = 0;
    this.responseTimeout = null;
    this.retryCount = 0;
    this.maxRetries = 2;
    this.responseWaitMs = 60000; // Wait up to 60s for response
    this.toolCooldownMs = 3000; // Wait 3s after last tool call

    // Track tool calls
    bus.on('tool:called', () => {
      this.lastToolCallTime = Date.now();
      this.toolCallCount++;
    });
  }

  /**
   * Send a message, waiting for MCP handshake if needed
   */
  async send(text, options = {}) {
    const { timeout = 120000, waitForTools = true, retries = 2 } = options;

    // Wait for MCP handshake
    await this._waitForReady();

    log('info', `📤 Sending: "${text.slice(0, 80)}..."`);
    this.mqtt.sendText(text);

    if (!waitForTools) return { sent: true };

    // Wait for response
    return this._waitForResponse(timeout, retries);
  }

  /**
   * Send multiple messages sequentially
   */
  async sendSequence(messages, options = {}) {
    const results = [];
    for (let i = 0; i < messages.length; i++) {
      log('info', `\n📨 [${i + 1}/${messages.length}]`);
      const result = await this.send(messages[i], options);
      results.push(result);
      if (result.timeout && !options.continueOnTimeout) {
        log('warn', `Timeout on message ${i + 1}, stopping sequence`);
        break;
      }
      // Cool down between messages
      if (i < messages.length - 1) {
        await new Promise(r => setTimeout(r, 2000));
      }
    }
    return results;
  }

  async _waitForReady() {
    if (this.mqtt.mcp.toolsReceived) return;

    log('info', '[...] Waiting for MCP handshake...');
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('MCP handshake timeout')), 30000);
      const check = setInterval(() => {
        if (this.mqtt.mcp.toolsReceived) {
          clearInterval(check);
          clearTimeout(timeout);
          log('ok', 'MCP ready');
          resolve();
        }
      }, 500);
    });
  }

  async _waitForResponse(timeoutMs, maxRetries) {
    return new Promise((resolve) => {
      const startTime = Date.now();
      let toolCallsBefore = this.toolCallCount;
      let lastActivity = Date.now();
      let resolved = false;

      // Track activity
      const onTool = () => { lastActivity = Date.now(); };
      const onLlm = () => { lastActivity = Date.now(); };
      bus.on('tool:called', onTool);
      bus.on('llm:text', onLlm);

      const cleanup = () => {
        bus.off('tool:called', onTool);
        bus.off('llm:text', onLlm);
        if (check) clearInterval(check);
        if (timer) clearTimeout(timer);
      };

      // Timeout
      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          cleanup();
          const newCalls = this.toolCallCount - toolCallsBefore;
          if (newCalls === 0 && maxRetries > 0) {
            log('warn', '⏰ No response, retrying...');
            cleanup();
            resolve(this._retry(timeoutMs, maxRetries));
          } else {
            resolve({ timeout: true, toolCalls: newCalls });
          }
        }
      }, timeoutMs);

      // Check if done (no new activity for 8s after tool calls)
      const check = setInterval(() => {
        if (resolved) return;
        const elapsed = Date.now() - startTime;
        const quietFor = Date.now() - lastActivity;
        const newCalls = this.toolCallCount - toolCallsBefore;

        // If we got tool calls and been quiet for 8s, we're done
        if (newCalls > 0 && quietFor > 8000) {
          resolved = true;
          cleanup();
          resolve({ success: true, toolCalls: newCalls, elapsed });
        }
      }, 1000);
    });
  }

  async _retry(timeoutMs, retriesLeft) {
    this.retryCount++;
    log('info', `🔄 Retry ${this.retryCount}...`);
    await new Promise(r => setTimeout(r, 3000));
    // Don't resend, just wait for response again
    return this._waitForResponse(timeoutMs, retriesLeft - 1);
  }
}
