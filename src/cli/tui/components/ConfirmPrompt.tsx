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

    // Left / right to navigate
    if (key.leftArrow) {
      setSelected((prev) => (prev - 1 + OPTIONS.length) % OPTIONS.length);
    } else if (key.rightArrow) {
      setSelected((prev) => (prev + 1) % OPTIONS.length);
    }
    // Enter to confirm selection
    else if (key.return) {
      onRespond(OPTIONS[selected]!.key);
    }
    // Shortcut keys
    else if (input === 'y' || input === 'Y') {
      onRespond('allow');
    } else if (input === 'n' || input === 'N') {
      onRespond('deny');
    } else if (input === 'a' || input === 'A') {
      onRespond('always');
    }
    // Tab to enter feedback mode
    else if (key.tab) {
      setFeedbackMode(true);
    }
    // Escape to deny
    else if (key.escape) {
      onRespond('deny');
    }
  }, { isActive: !feedbackMode });

  const { lines, label } = getToolDetails(confirm.toolName, confirm.params);

  // Feedback input mode
  if (feedbackMode) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor="yellow"
          paddingX={1}
        >
          <Text bold color="yellow">{label}</Text>
          {lines.map((line, i) => (
            <Text key={i} dimColor>{line}</Text>
          ))}
        </Box>
        <Box paddingX={1} gap={1}>
          <Text color="cyan">反馈: </Text>
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
        <Box paddingX={1}>
          <Text dimColor>Enter 发送  Esc 返回选择</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      {/* Tool detail box */}
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor="yellow"
        paddingX={1}
      >
        <Text bold color="yellow">{label}</Text>
        {lines.map((line, i) => (
          <Text key={i} dimColor>{line}</Text>
        ))}
      </Box>

      {/* Selection bar */}
      <Box marginTop={0} paddingX={1} gap={2}>
        {OPTIONS.map((opt, i) => {
          const isSelected = i === selected;
          return (
            <Box key={opt.key}>
              {isSelected ? (
                <Text bold color="cyan" inverse> {opt.label} </Text>
              ) : (
                <Text dimColor> {opt.label} </Text>
              )}
            </Box>
          );
        })}
      </Box>

      {/* Hint */}
      <Box paddingX={1}>
        <Text dimColor>
          ← → 选择  Enter 确认  y 允许  n 拒绝  a 始终  Tab 反馈
        </Text>
      </Box>
    </Box>
  );
}
