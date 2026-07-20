/**
 * FileTracker — track file changes during session
 * Shows summary of what was modified, like Claude Code's change tracking
 */
import { COLORS } from './logger.js';

export class FileTracker {
  constructor() {
    this.changes = new Map(); // path → { action, count, firstTs, lastTs }
  }

  track(path, action) {
    const existing = this.changes.get(path);
    if (existing) {
      existing.count++;
      existing.lastTs = Date.now();
      existing.action = action; // latest action
    } else {
      this.changes.set(path, { action, count: 1, firstTs: Date.now(), lastTs: Date.now() });
    }
  }

  getChanges() {
    return [...this.changes.entries()].map(([path, info]) => ({ path, ...info }));
  }

  getSummary() {
    const changes = this.getChanges();
    if (!changes.length) return 'No file changes this session';

    const created = changes.filter(c => c.action === 'created');
    const modified = changes.filter(c => c.action === 'modified');
    const deleted = changes.filter(c => c.action === 'deleted');

    const lines = [`${COLORS.bold}[DIR] File Changes:${COLORS.reset}`];
    if (created.length) lines.push(`  ${COLORS.green}[NEW] Created:${COLORS.reset} ${created.map(c => c.path).join(', ')}`);
    if (modified.length) lines.push(`  ${COLORS.yellow}[EDIT] Modified:${COLORS.reset} ${modified.map(c => `${c.path} (${c.count}x)`).join(', ')}`);
    if (deleted.length) lines.push(`  ${COLORS.red}[DEL] Deleted:${COLORS.reset} ${deleted.map(c => c.path).join(', ')}`);

    return lines.join('\n');
  }

  reset() { this.changes.clear(); }
}
