/**
 * Ink UI Components — building blocks for Pelulu TUI
 * Uses React.createElement (no JSX — ESM compatible, no build step)
 */
import React, { useState, useEffect, useRef } from 'react';
import { Box, Text, useStdin } from 'ink';
import TextInput from 'ink-text-input';

// ─── Status Bar ───────────────────────────────────────────
export function StatusBar({ connected, session, toolCount, actionCount }) {
  return React.createElement(Box, {
    borderStyle: 'single', borderColor: 'cyan', width: '100%', paddingX: 0,
  },
    React.createElement(Text, { color: 'cyan', bold: true }, ' pelulu '),
    React.createElement(Text, { dimColor: true }, '│ '),
    React.createElement(Text, { color: connected ? 'green' : 'red', dimColor: !connected },
      connected ? 'on' : 'off'
    ),
    React.createElement(Text, { dimColor: true }, ` ${toolCount}t ${actionCount}a `),
    React.createElement(Text, { dimColor: true }, '│ '),
    React.createElement(Text, { dimColor: true }, session ? session.slice(0, 8) : '-'),
  );
}

// ─── Strip Emojis ─────────────────────────────────────────
function stripEmojis(text) {
  return text
    .replace(/\p{Emoji_Presentation}/gu, '')
    .replace(/\p{Emoji_Modifier_Base}\p{Emoji_Modifier}?/gu, '')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/[\u2600-\u27BF]/g, '')
    .replace(/[\u{1F000}-\u{1FFFF}]/gu, '')
    .replace(/[\u200D\uFE0F]/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ ([.,;:!?])/g, '$1')
    .trim();
}

// ─── Wrap text helper ─────────────────────────────────────
function wrapText(text, maxWidth) {
  const lines = [];
  for (const paragraph of text.split('\n')) {
    if (!paragraph.trim()) { lines.push(''); continue; }
    const words = paragraph.split(/\s+/);
    let line = '';
    for (const word of words) {
      if (line.length + word.length + 1 > maxWidth && line.length > 0) {
        lines.push(line);
        line = word;
      } else {
        line = line ? `${line} ${word}` : word;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

// ─── Message Bubble ───────────────────────────────────────
export function MessageBubble({ message }) {
  const { role, content } = message;
  const isUser = role === 'user';
  const isTool = role === 'tool';
  const isSystem = role === 'system';

  if (isTool) {
    return React.createElement(Box, { paddingLeft: 2 },
      React.createElement(Text, { dimColor: true },
        `${message.toolName || 'tool'}${message.action ? '.' + message.action : ''}  ${message.detail || ''}`
      ),
    );
  }

  if (isSystem) {
    return React.createElement(Box, { paddingLeft: 2 },
      React.createElement(Text, { dimColor: true, italic: true }, content),
    );
  }

  // Log messages (from logger routed through bus)
  if (role === 'log') {
    return React.createElement(Box, { paddingLeft: 2 },
      React.createElement(Text, { dimColor: true }, content),
    );
  }

  const cleanContent = stripEmojis(content);
  if (!cleanContent) return null;

  const color = isUser ? 'blue' : 'white';
  const w = (process.stdout.columns || 80) - 6;

  if (isUser) {
    return React.createElement(Box, { paddingLeft: 1, flexDirection: 'column' },
      React.createElement(Text, { color, bold: true }, `> ${cleanContent}`),
    );
  }

  // Assistant: wrap + indent all lines
  const lines = wrapText(cleanContent, w);
  return React.createElement(Box, { paddingLeft: 2, flexDirection: 'column' },
    ...lines.map((line, i) =>
      React.createElement(Text, { key: i, color }, line)
    ),
  );
}

// ─── Tool Result Line ─────────────────────────────────────
export function ToolResultLine({ success, detail }) {
  return React.createElement(Box, { paddingLeft: 4 },
    React.createElement(Text, { color: success ? 'green' : 'red' },
      success ? `v ${detail || 'OK'}` : `x ${detail || 'error'}`
    ),
  );
}

// ─── Input Bar ────────────────────────────────────────────
export function InputBar({ onSubmit, placeholder }) {
  const [value, setValue] = useState('');

  const handleSubmit = (val) => {
    const trimmed = val.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
    setValue('');
  };

  return React.createElement(Box, { paddingX: 1 },
    React.createElement(Text, { color: 'cyan' }, '> '),
    React.createElement(TextInput, {
      value,
      onChange: setValue,
      onSubmit: handleSubmit,
      placeholder: placeholder || 'type a message...',
    }),
  );
}

// ─── Thinking Indicator ───────────────────────────────────
export function ThinkingIndicator({ state }) {
  if (!state || state === 'idle') return null;

  const labels = {
    thinking: 'thinking...',
    tool_call: 'using tool...',
    reading: 'reading file...',
    writing: 'writing...',
    searching: 'searching...',
  };

  return React.createElement(Box, { paddingLeft: 2 },
    React.createElement(Text, { dimColor: true, italic: true },
      `.. ${labels[state] || 'processing...'}`
    ),
  );
}

// ─── Divider ──────────────────────────────────────────────
export function Divider() {
  return React.createElement(Box, { width: '100%' },
    React.createElement(Text, { dimColor: true }, '─'.repeat(process.stdout.columns || 80)),
  );
}

