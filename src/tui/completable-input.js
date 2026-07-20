/**
 * CompletableInput — TextInput with Tab auto-completion + char counter
 * Wraps ink-text-input and adds completion support
 */
import React, { useState, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { getCompletions } from '../core/completion.js';

const MAX_CHARS = 70;

export function CompletableInput({ onSubmit, placeholder }) {
  const [value, setValue] = useState('');
  const [completions, setCompletions] = useState([]);
  const [completionIndex, setCompletionIndex] = useState(0);
  const [showCompletions, setShowCompletions] = useState(false);

  const isAtLimit = value.length >= MAX_CHARS;
  const charCount = value.length;
  const remaining = MAX_CHARS - charCount;

  // Handle Tab for completion
  useInput((input, key) => {
    if (key.tab) {
      if (!showCompletions) {
        const hits = getCompletions(value);
        if (hits.length > 0) {
          setCompletions(hits);
          setCompletionIndex(0);
          setShowCompletions(true);
          if (hits.length === 1) {
            // Only auto-fill if within limit
            const filled = hits[0] + ' ';
            if (filled.length <= MAX_CHARS) {
              setValue(filled);
            }
            setShowCompletions(false);
          } else {
            setValue(hits[0].slice(0, MAX_CHARS));
          }
        }
      } else {
        const next = (completionIndex + 1) % completions.length;
        setCompletionIndex(next);
        setValue(completions[next].slice(0, MAX_CHARS));
      }
    } else if (key.escape) {
      setShowCompletions(false);
      setCompletions([]);
      setCompletionIndex(0);
    } else if (key.return) {
      setShowCompletions(false);
      setCompletions([]);
    } else {
      if (showCompletions) {
        setShowCompletions(false);
        setCompletions([]);
        setCompletionIndex(0);
      }
    }
  });

  // Update value from TextInput
  const handleChange = useCallback((val) => {
    // Enforce max chars
    const trimmed = val.slice(0, MAX_CHARS);
    setValue(trimmed);

    if (trimmed.length > 0) {
      const hits = getCompletions(trimmed);
      if (hits.length > 0 && hits[0] !== trimmed) {
        setCompletions(hits);
        setShowCompletions(true);
        setCompletionIndex(0);
      } else {
        setShowCompletions(false);
      }
    } else {
      setShowCompletions(false);
    }
  }, []);

  // Handle TextInput submit
  const handleSubmit = useCallback((val) => {
    const trimmed = val.trim();
    if (trimmed) {
      onSubmit(trimmed);
      setValue('');
    }
    setShowCompletions(false);
    setCompletions([]);
  }, [onSubmit]);

  // Color for char counter
  const counterColor = isAtLimit ? 'red' : remaining <= 10 ? 'yellow' : 'dim';

  return React.createElement(Box, { flexDirection: 'column', width: '100%' },
    // Completion suggestions
    showCompletions && completions.length > 1
      ? React.createElement(Box, {
          paddingLeft: 2, paddingBottom: 0,
          flexDirection: 'row', flexWrap: 'wrap', gap: 1,
        },
        completions.slice(0, 8).map((c, i) =>
          React.createElement(Text, {
            key: c,
            color: i === completionIndex ? 'cyan' : 'dim',
            bold: i === completionIndex,
            dimColor: i !== completionIndex,
          },
            i === completionIndex ? `[${c}]` : ` ${c} `
          )
        ),
      )
      : null,

    // Input line with char counter
    React.createElement(Box, { paddingX: 1, flexDirection: 'row', alignItems: 'center' },
      React.createElement(Text, { color: 'cyan' }, '> '),
      React.createElement(Box, { flexDirection: 'column', flexGrow: 1 },
        React.createElement(TextInput, {
          value,
          onChange: handleChange,
          onSubmit: handleSubmit,
          placeholder: isAtLimit ? '⚠️ limit reached!' : (placeholder || 'type a message...'),
          showCursor: !showCompletions || completions.length <= 1,
        }),
      ),
      // Char counter
      React.createElement(Box, { marginLeft: 1 },
        React.createElement(Text, { color: counterColor },
          isAtLimit ? `🚫 ${MAX_CHARS}/${MAX_CHARS}` : `${charCount}/${MAX_CHARS}`
        ),
      ),
    ),
  );
}
