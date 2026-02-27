import React, { useRef, useState } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';

interface InputAreaProps {
  onSubmit: (text: string) => void;
  isRunning: boolean;
  onExitRequest: () => void;
  onScroll?: (direction: 'up' | 'down') => void;
}

/**
 * Custom text input that only accepts printable characters.
 */
function CleanTextInput({
  onSubmit,
  placeholder,
  onExitRequest,
  onScroll
}: {
  onSubmit: (text: string) => void;
  placeholder?: string;
  onExitRequest: () => void;
  onScroll?: (direction: 'up' | 'down') => void;
}) {
  const [value, setValue] = useState('');
  const [cursor, setCursor] = useState(0);
  const lastCtrlCAtRef = useRef(0);
  const pastedTextsRef = useRef<string[]>([]);

  useInput((input, key) => {
    // Scroll handling
    if (onScroll) {
      if (key.pageUp || (key.upArrow && key.shift)) {
        onScroll('up');
        return;
      }
      if (key.pageDown || (key.downArrow && key.shift)) {
        onScroll('down');
        return;
      }
    }

    if (input === 'c' && key.ctrl) {
      if (value.length > 0) {
        setValue('');
        setCursor(0);
        lastCtrlCAtRef.current = 0;
        pastedTextsRef.current = [];
        return;
      }

      const now = Date.now();
      const isDoublePress = now - lastCtrlCAtRef.current <= 1200;
      if (isDoublePress) {
        onExitRequest();
        lastCtrlCAtRef.current = 0;
      } else {
        lastCtrlCAtRef.current = now;
      }
      return;
    }

    if (key.return) {
      let trimmed = value.trim();
      if (trimmed) {
        // Expand [pasted text#N] placeholders with actual stored text
        const stored = pastedTextsRef.current;
        trimmed = trimmed.replace(/\[pasted text#(\d+)\]/g, (_match, numStr) => {
          const idx = parseInt(numStr, 10) - 1;
          return idx >= 0 && idx < stored.length ? stored[idx] : _match;
        });
        onSubmit(trimmed);
      }
      setValue('');
      setCursor(0);
      pastedTextsRef.current = [];
      return;
    }
    if (key.backspace || key.delete) {
      if (cursor > 0) {
        setValue(prev => prev.slice(0, cursor - 1) + prev.slice(cursor));
        setCursor(prev => prev - 1);
      }
      return;
    }
    if (key.leftArrow) { setCursor(prev => Math.max(0, prev - 1)); return; }
    if (key.rightArrow) { setCursor(prev => Math.min(value.length, prev + 1)); return; }
    if (input === 'a' && key.ctrl) { setCursor(0); return; }
    if (input === 'e' && key.ctrl) { setCursor(value.length); return; }
    if (input === 'u' && key.ctrl) { setValue(prev => prev.slice(cursor)); setCursor(0); return; }

    // Multi-line paste detection
    if (input.includes('\n') || input.includes('\r')) {
      // Clean escape sequences and normalize newlines
      const cleaned = input
        .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .trim();
      if (cleaned.length > 0) {
        pastedTextsRef.current.push(cleaned);
        const placeholder = `[pasted text#${pastedTextsRef.current.length}]`;
        setValue(prev => prev.slice(0, cursor) + placeholder + prev.slice(cursor));
        setCursor(prev => prev + placeholder.length);
      }
      return;
    }

    if (key.ctrl || key.meta || key.escape) return;
    if (!input || input.length === 0) return;
    if (input.includes('\x1b') || input.includes('\x00')) return;

    // Filter out some common terminal escape sequences
    if (/^(?:\[<\d+;\d+;\d+[Mm])+$/.test(input)) return;
    if (/^\[<[0-9;Mm]*$/.test(input)) return;
    if (input === '[5~' || input === '[6~') return;

    for (let i = 0; i < input.length; i++) {
      const code = input.charCodeAt(i);
      if (code < 0x20 && code !== 0x09) return;
      if (code === 0x7f || (code >= 0x80 && code <= 0x9f)) return;
    }

    setValue(prev => prev.slice(0, cursor) + input + prev.slice(cursor));
    setCursor(prev => prev + input.length);
  });

  if (value.length === 0) {
    return (
      <Text wrap="wrap">
        <Text inverse> </Text>
        <Text dimColor>{placeholder || ''}</Text>
      </Text>
    );
  }

  const before = value.slice(0, cursor);
  const at = cursor < value.length ? value[cursor] : ' ';
  const after = cursor < value.length ? value.slice(cursor + 1) : '';

  return (
    <Text wrap="wrap">
      {before}<Text inverse>{at}</Text>{after}
    </Text>
  );
}

export const InputArea = React.memo(function InputArea({ onSubmit, isRunning, onExitRequest, onScroll }: InputAreaProps) {
  const { stdout } = useStdout();
  // Label box: paddingX(1) + " INPUT "(7) + paddingX(1) = 9 cols, + marginRight(1) = 10
  const labelCols = 10;
  const textWidth = (stdout?.columns ?? 80) - 2 - labelCols;

  return (
    <Box paddingX={0}>
      <Box backgroundColor={isRunning ? "#504945" : "#b8bb26"} paddingX={1} marginRight={1}>
        <Text color="#282828" bold>{isRunning ? " WAIT " : " INPUT "}</Text>
      </Box>
      <Box width={textWidth}>
        {isRunning ? (
          <Text color="#a89984" italic>Thinking...</Text>
        ) : (
          <CleanTextInput
            onSubmit={onSubmit}
            placeholder="Type a message or /command..."
            onExitRequest={onExitRequest}
            onScroll={onScroll}
          />
        )}
      </Box>
    </Box>
  );
});
