import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { ConfirmPending, ConfirmResult } from '../state.js';

interface ConfirmPromptProps {
  confirm: ConfirmPending;
  onRespond: (result: ConfirmResult) => void;
}

const OPTIONS: { key: 'allow' | 'always' | 'deny'; label: string }[] = [
  { key: 'allow', label: '允许' },
  { key: 'always', label: '始终允许' },
  { key: 'deny', label: '拒绝' },
];

function getToolDetails(toolName: string, params: Record<string, unknown>): { lines: string[]; label: string } {
  const lines: string[] = [];
  let label = toolName;

  switch (toolName) {
    case 'bash':
      label = 'Bash';
      lines.push(`命令: ${String(params['command'] || '')}`);
      break;
    case 'write-file':
      label = 'Write';
      lines.push(`文件: ${String(params['path'] || '')}`);
      if (params['content']) {
        const content = String(params['content']);
        const preview = content.length > 120 ? content.slice(0, 120) + '...' : content;
        lines.push(`内容: ${preview.split('\n').slice(0, 3).join('\n      ')}`);
      }
      break;
    case 'edit-file':
      label = 'Edit';
      lines.push(`文件: ${String(params['path'] || '')}`);
      if (params['old_string']) {
        const old = String(params['old_string']);
        const preview = old.length > 80 ? old.slice(0, 80) + '...' : old;
        lines.push(`替换: ${preview}`);
      }
      if (params['new_string']) {
        const neu = String(params['new_string']);
        const preview = neu.length > 80 ? neu.slice(0, 80) + '...' : neu;
        lines.push(`为:   ${preview}`);
      }
      break;
    case 'git':
      label = 'Git';
      lines.push(`命令: git ${String(params['command'] || '')}`);
      break;
    default:
      for (const [key, value] of Object.entries(params)) {
        const str = typeof value === 'string' ? value : JSON.stringify(value);
        lines.push(`${key}: ${str.slice(0, 80)}`);
      }
      break;
  }

  return { lines, label };
}

/** Minimal clean text input — only accepts printable chars, ignores escape sequences */
function FeedbackInput({ onSubmit }: { onSubmit: (text: string) => void }) {
  const [value, setValue] = useState('');
  const [cursor, setCursor] = useState(0);

  useInput((input, key) => {
    if (key.return) {
      onSubmit(value);
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
    if (key.escape) { onSubmit(''); return; } // Escape cancels feedback

    if (key.ctrl || key.meta) return;
    if (!input || input.length === 0) return;
    if (input.includes('\x1b') || input.includes('\x00')) return;
    for (let i = 0; i < input.length; i++) {
      const code = input.charCodeAt(i);
      if (code < 0x20) return;
      if (code === 0x7f || (code >= 0x80 && code <= 0x9f)) return;
    }

    setValue(prev => prev.slice(0, cursor) + input + prev.slice(cursor));
    setCursor(prev => prev + input.length);
  });

  if (value.length === 0) {
    return (
      <>
        <Text inverse> </Text>
        <Text dimColor>输入反馈指令给 AI...</Text>
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

export function ConfirmPrompt({ confirm, onRespond }: ConfirmPromptProps) {
  const [selected, setSelected] = useState(0);
  const [feedbackMode, setFeedbackMode] = useState(false);

  useInput((input, key) => {
    if (feedbackMode) return;

    if (key.leftArrow) {
      setSelected((prev) => (prev - 1 + OPTIONS.length) % OPTIONS.length);
    } else if (key.rightArrow) {
      setSelected((prev) => (prev + 1) % OPTIONS.length);
    }
    else if (key.return) {
      onRespond(OPTIONS[selected]!.key);
    }
    else if (input === 'y' || input === 'Y') {
      onRespond('allow');
    } else if (input === 'n' || input === 'N') {
      onRespond('deny');
    } else if (input === 'a' || input === 'A') {
      onRespond('always');
    }
    else if (key.tab) {
      setFeedbackMode(true);
    }
    else if (key.escape) {
      onRespond('deny');
    }
  }, { isActive: !feedbackMode });

  const { lines, label } = getToolDetails(confirm.toolName, confirm.params);

  if (feedbackMode) {
    return (
      <Box flexDirection="column" paddingX={0} marginY={1}>
        <Box backgroundColor="#fe8019" paddingX={1}>
          <Text color="#282828" bold> FEEDBACK </Text>
        </Box>
        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor="#fe8019"
          paddingX={1}
        >
          <Text bold color="#fabd2f">{label}</Text>
          {lines.map((line, i) => (
            <Text key={i} color="#a89984">{line}</Text>
          ))}
          <Box marginTop={1} gap={1}>
            <Text color="#83a598" bold>Reason: </Text>
            <FeedbackInput
              onSubmit={(text) => {
                const trimmed = text.trim();
                if (trimmed) {
                  onRespond({ feedback: trimmed });
                } else {
                  setFeedbackMode(false);
                }
              }}
            />
          </Box>
        </Box>
        <Box paddingX={1}>
          <Text dimColor>Enter to send · Esc to cancel</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={0} marginY={1}>
      <Box backgroundColor="#fe8019" paddingX={1}>
        <Text color="#282828" bold> CONFIRMATION REQUIRED </Text>
      </Box>
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor="#fe8019"
        paddingX={1}
      >
        <Text bold color="#fabd2f">{label}</Text>
        {lines.map((line, i) => (
          <Text key={i} color="#a89984">{line}</Text>
        ))}

        <Box marginTop={1} gap={2} justifyContent="center">
          {OPTIONS.map((opt, i) => {
            const isSelected = i === selected;
            const optColor = opt.key === 'deny' ? '#fb4934' : opt.key === 'allow' ? '#b8bb26' : '#8ec07c';
            return (
              <Box key={opt.key}>
                {isSelected ? (
                  <Text bold backgroundColor={optColor} color="#282828"> {opt.label} </Text>
                ) : (
                  <Text color={optColor}> {opt.label} </Text>
                )}
              </Box>
            );
          })}
        </Box>
      </Box>

      <Box paddingX={1}>
        <Text dimColor>
          ← → select · Enter confirm · y/n shortcuts · Tab feedback
        </Text>
      </Box>
    </Box>
  );
}
