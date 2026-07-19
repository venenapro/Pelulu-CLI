/**
 * Ink UI Components — building blocks for Pelulu TUI
 * Uses React.createElement (no JSX — ESM compatible, no build step)
 */
import React, { useState, useEffect, useRef } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';

// ─── Status Bar ───────────────────────────────────────────
export function StatusBar({ connected, session, toolCount, actionCount }) {
  return React.createElement(Box, {
    borderStyle: 'round', borderColor: 'cyan', width: '100%', paddingX: 1,
  },
    React.createElement(Text, { color: 'cyan' }, 'pelulu'),
    React.createElement(Text, { dimColor: true }, ' '),
    React.createElement(Text, { color: connected ? 'green' : 'red', dimColor: !connected },
      connected ? 'on' : 'off'
    ),
    React.createElement(Text, { dimColor: true }, ' '),
    React.createElement(Text, { dimColor: true }, `${toolCount}t ${actionCount}a`),
    React.createElement(Text, { dimColor: true }, ' '),
    React.createElement(Text, { dimColor: true }, session ? `${session.slice(0, 8)}` : '-'),
  );
}

// ─── Message Bubble ───────────────────────────────────────
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

export function MessageBubble({ message }) {
  const { role, content } = message;
  const isUser = role === 'user';
  const isTool = role === 'tool';
  const isSystem = role === 'system';

  if (isTool) {
    return React.createElement(Box, { paddingLeft: 2 },
      React.createElement(Text, { dimColor: true },
        `  ${message.toolName || 'tool'}${message.action ? '.' + message.action : ''}  ${message.detail || ''}`
      ),
    );
  }

  if (isSystem) {
    return React.createElement(Box, { paddingLeft: 2 },
      React.createElement(Text, { dimColor: true, italic: true }, `  ${content}`),
    );
  }

  const cleanContent = isUser ? content : stripEmojis(content);
  if (!cleanContent) return null;

  const icon = isUser ? '>' : '*';
  const color = isUser ? 'blue' : 'white';
  const prefix = isUser ? '  > ' : '    ';

  return React.createElement(Box, { paddingLeft: 0, flexDirection: 'column' },
    React.createElement(Text, { color, bold: isUser },
      `${prefix}${cleanContent}`
    ),
  );
}

// ─── Tool Result Line ─────────────────────────────────────
export function ToolResultLine({ success, detail }) {
  return React.createElement(Box, { paddingLeft: 4 },
    React.createElement(Text, { color: success ? 'green' : 'red' },
      success ? `  v ${detail || 'OK'}` : `  x ${detail || 'error'}`
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
    thinking: 'Thinking...',
    tool_call: 'Using tool...',
    reading: 'Reading file...',
    writing: 'Writing...',
    searching: 'Searching...',
  };

  return React.createElement(Box, { paddingLeft: 2 },
    React.createElement(Text, { dimColor: true, italic: true },
      `  .. ${labels[state] || 'Processing...'}`
    ),
  );
}

// ─── Divider ──────────────────────────────────────────────
export function Divider() {
  const w = process.stdout.columns || 80;
  return React.createElement(Text, { dimColor: true }, '─'.repeat(w - 4));
}
