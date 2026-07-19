/**
 * CompletableInput — TextInput with Tab auto-completion
 * Wraps ink-text-input and adds completion support
 */
import React, { useState, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { getCompletions } from '../core/completion.js';

export function CompletableInput({ onSubmit, placeholder }) {
  const [value, setValue] = useState('');
  const [completions, setCompletions] = useState([]);
  const [completionIndex, setCompletionIndex] = useState(0);
  const [showCompletions, setShowCompletions] = useState(false);

  // Handle Tab for completion
  useInput((input, key) => {
    if (key.tab) {
      if (!showCompletions) {
        // First Tab: show completions
        const hits = getCompletions(value);
        if (hits.length > 0) {
          setCompletions(hits);
          setCompletionIndex(0);
          setShowCompletions(true);
          // Auto-fill first match
          if (hits.length === 1) {
            setValue(hits[0] + ' ');
            setShowCompletions(false);
          } else {
            setValue(hits[0]);
          }
        }
      } else {
        // Subsequent Tab: cycle through completions
        const next = (completionIndex + 1) % completions.length;
        setCompletionIndex(next);
        setValue(completions[next]);
      }
    } else if (key.escape) {
      // Escape: hide completions
      setShowCompletions(false);
      setCompletions([]);
      setCompletionIndex(0);
    } else if (key.return) {
      // Enter: submit
      const trimmed = value.trim();
      if (trimmed) {
        onSubmit(trimmed);
        setValue('');
      }
      setShowCompletions(false);
      setCompletions([]);
    } else {
      // Any other key: reset completions
      if (showCompletions) {
        setShowCompletions(false);
        setCompletions([]);
        setCompletionIndex(0);
      }
    }
  });

  // Update value from TextInput (but not on Tab/Enter which are handled above)
  const handleChange = useCallback((val) => {
    setValue(val);
    // Live completion hints
    if (val.length > 0) {
      const hits = getCompletions(val);
      if (hits.length > 0 && hits[0] !== val) {
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

  // Handle TextInput submit (Enter key)
  const handleSubmit = useCallback((val) => {
    const trimmed = val.trim();
    if (trimmed) {
      onSubmit(trimmed);
      setValue('');
    }
    setShowCompletions(false);
    setCompletions([]);
  }, [onSubmit]);

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

    // Input line
    React.createElement(Box, { paddingX: 1 },
      React.createElement(Text, { color: 'cyan' }, '> '),
      React.createElement(TextInput, {
        value,
        onChange: handleChange,
        onSubmit: handleSubmit,
        placeholder: placeholder || 'type a message...',
        // Don't show cursor when we have a completion suggestion
        showCursor: !showCompletions || completions.length <= 1,
      }),
      // Show ghost completion (the remaining part of the suggested completion)
      showCompletions && completions.length > 0 && value.length > 0
        ? React.createElement(Text, { dimColor: true },
            completions[completionIndex]?.slice(value.length) || ''
          )
        : null,
    ),
  );
}
