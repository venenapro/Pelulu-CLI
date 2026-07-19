/**
 * Stats — tool usage analytics and session metrics
 */
export class Stats {
  constructor() {
    this.toolCalls = [];
    this.startTime = Date.now();
    this.errors = [];
  }

  record(toolName, action, success, duration, error) {
    this.toolCalls.push({
      tool: toolName,
      action,
      success,
      duration,
      ts: Date.now(),
    });
    if (!success && error) this.errors.push({ tool: toolName, action, error, ts: Date.now() });
    // Keep last 500 calls
    if (this.toolCalls.length > 500) this.toolCalls = this.toolCalls.slice(-500);
  }

  getSummary() {
    const total = this.toolCalls.length;
    const success = this.toolCalls.filter(t => t.success).length;
    const failed = total - success;
    const avgDuration = total ? Math.round(this.toolCalls.reduce((s, t) => s + t.duration, 0) / total) : 0;
    const uptime = Math.round((Date.now() - this.startTime) / 1000);

    // Tool frequency
    const freq = {};
    for (const t of this.toolCalls) {
      freq[t.tool] = (freq[t.tool] || 0) + 1;
    }
    const topTools = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 5);

    return { total, success, failed, avgDuration, uptime, topTools };
  }

  formatReport() {
    const s = this.getSummary();
    const lines = [
      `📊 Session Stats`,
      `   Uptime: ${s.uptime}s`,
      `   Tool calls: ${s.total} (${s.success} ✅ / ${s.failed} ❌)`,
      `   Avg duration: ${s.avgDuration}ms`,
    ];
    if (s.topTools.length) {
      lines.push('   Top tools:');
      for (const [tool, count] of s.topTools) {
        lines.push(`     ${tool}: ${count} calls`);
      }
    }
    if (this.errors.length) {
      lines.push(`   Recent errors:`);
      for (const e of this.errors.slice(-3)) {
        lines.push(`     ${e.tool}.${e.action}: ${e.error.slice(0, 60)}`);
      }
    }
    return lines.join('\n');
  }

  getToolStats(toolName) {
    const calls = this.toolCalls.filter(t => t.tool === toolName);
    return {
      tool: toolName,
      calls: calls.length,
      success: calls.filter(t => t.success).length,
      avgDuration: calls.length ? Math.round(calls.reduce((s, t) => s + t.duration, 0) / calls.length) : 0,
    };
  }
}
