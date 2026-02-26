import React, { useRef, useState } from 'react';
import { Box, Text, useInput } from 'ink';

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
      const trimmed = value.trim();
      if (trimmed) {
        onSubmit(trimmed);
      }
      setValue('');
      setCursor(0);
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
      <>
        <Text inverse> </Text>
        <Text dimColor>{placeholder || ''}</Text>
      </>
    );
  }

  const before = value.slice(0, cursor);
  const at = cursor < value.length ? value[cursor] : ' ';
  const after = cursor < value.length ? value.slice(cursor + 1) : '';

  return (
    <>
      <Text>{before}</Text>
      <Text inverse>{at}</Text>
      <Text>{after}</Text>
    </>
  );
}

export function InputArea({ onSubmit, isRunning, onExitRequest, onScroll }: InputAreaProps) {
  return (
    <Box paddingX={0}>
      <Box backgroundColor={isRunning ? "#504945" : "#b8bb26"} paddingX={1} marginRight={1}>
        <Text color="#282828" bold>{isRunning ? " WAIT " : " INPUT "}</Text>
      </Box>
      <Box flexGrow={1}>
        {isRunning ? (
          <Box flexGrow={1} onWheel={(event) => {
            // Ink handles wheel? Not really, but just in case for future.
          }}>
            <Text color="#a89984" italic>Thinking...</Text>
          </Box>
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
}
