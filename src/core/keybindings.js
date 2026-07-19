/**
 * Keybindings — keyboard shortcuts for the REPL
 * Inspired by Claude Code's keyboard shortcuts
 */
export const KEYBINDINGS = {
  'Ctrl+C': 'Cancel current input / Exit',
  'Ctrl+D': 'Exit (EOF)',
  'Ctrl+L': 'Clear screen',
  'Ctrl+U': 'Clear line',
  'Ctrl+K': 'Delete to end of line',
  'Ctrl+A': 'Move to start of line',
  'Ctrl+E': 'Move to end of line',
  'Up/Down': 'Navigate history',
  'Tab': 'Auto-complete (planned)',
};

export function setupKeybindings(rl) {
  // readline handles most of these automatically
  // Custom bindings can be added here
  return rl;
}

export function formatKeybindings() {
  const lines = ['⌨️ Keyboard Shortcuts:'];
  for (const [key, desc] of Object.entries(KEYBINDINGS)) {
    lines.push(`  ${key.padEnd(15)} ${desc}`);
  }
  return lines.join('\n');
}
