/**
 * Diff — visual code change display
 * Shows before/after with colors, like Claude Code's diff view
 */
import { COLORS } from './logger.js';

export function showDiff(oldText, newText, filePath) {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const maxLen = Math.max(oldLines.length, newLines.length);

  console.log(`\n${COLORS.bold}[EDIT] Changes: ${filePath || ''}${COLORS.reset}\n`);

  let changes = 0;
  for (let i = 0; i < maxLen; i++) {
    const old = oldLines[i];
    const new_ = newLines[i];

    if (old === new_) {
      console.log(`${COLORS.gray}  ${String(i + 1).padStart(4)} │ ${old || ''}${COLORS.reset}`);
    } else {
      changes++;
      if (old !== undefined) console.log(`${COLORS.red}- ${String(i + 1).padStart(4)} │ ${old}${COLORS.reset}`);
      if (new_ !== undefined) console.log(`${COLORS.green}+ ${String(i + 1).padStart(4)} │ ${new_}${COLORS.reset}`);
    }
  }

  console.log(`\n${COLORS.dim}  ${changes} line(s) changed${COLORS.reset}\n`);
  return changes;
}

export function showPatch(filePath, hunks) {
  console.log(`\n${COLORS.bold}[EDIT] Patch: ${filePath}${COLORS.reset}\n`);
  for (const hunk of hunks) {
    console.log(`${COLORS.cyan}@@ ${hunk.header || ''} @@${COLORS.reset}`);
    for (const line of hunk.lines) {
      if (line.startsWith('+')) console.log(`${COLORS.green}${line}${COLORS.reset}`);
      else if (line.startsWith('-')) console.log(`${COLORS.red}${line}${COLORS.reset}`);
      else console.log(`${COLORS.gray}${line}${COLORS.reset}`);
    }
  }
  console.log();
}

export function formatFileChange(action, path, details) {
  const icons = { created: '[NEW]', modified: '[EDIT]', deleted: '[DEL]', renamed: '[REN]' };
  const icon = icons[action] || '[FILE]';
  const detailStr = details ? ` ${COLORS.dim}(${details})${COLORS.reset}` : '';
  return `${icon} ${action}: ${path}${detailStr}`;
}
