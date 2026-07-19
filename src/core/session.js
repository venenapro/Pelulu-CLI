/**
 * SessionState — tracks conversation context, tool history, and working state
 */
export class SessionState {
  constructor() {
    this.messages = [];
    this.toolCalls = [];
    this.startTime = Date.now();
    this.turnCount = 0;
    this.cwd = process.cwd();
  }

  addUserMessage(text) {
    this.messages.push({ role: 'user', text, ts: Date.now() });
    this.turnCount++;
    // Keep last 50 messages
    if (this.messages.length > 50) this.messages = this.messages.slice(-50);
  }

  addAiMessage(text) {
    this.messages.push({ role: 'ai', text, ts: Date.now() });
  }

  addToolCall(name, args, result) {
    this.toolCalls.push({ name, args, result: result?.isError ? 'error' : 'ok', ts: Date.now() });
    // Keep last 100 tool calls
    if (this.toolCalls.length > 100) this.toolCalls = this.toolCalls.slice(-100);
  }

  getRecentContext(n = 10) {
    return this.messages.slice(-n);
  }

  getStats() {
    return {
      uptime: Math.round((Date.now() - this.startTime) / 1000),
      turns: this.turnCount,
      messages: this.messages.length,
      toolCalls: this.toolCalls.length,
      errors: this.toolCalls.filter(t => t.result === 'error').length,
    };
  }

  getCwd() { return this.cwd; }
  setCwd(path) { this.cwd = path; }
}
