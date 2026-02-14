import React from 'react';
import { Box, Text } from 'ink';
import type { ToolCallState } from '../state.js';

interface ToolCallLineProps {
  toolCall: ToolCallState;
}

export function getToolParamSummary(name: string, params: Record<string, unknown>): string {
  switch (name) {
    case 'bash':
      return String(params['command'] || '').slice(0, 60);
    case 'read-file':
    case 'write-file':
    case 'edit-file':
      return String(params['path'] || '');
    case 'glob':
      return String(params['pattern'] || '');
    case 'grep':
      return String(params['pattern'] || '');
    case 'send-to-coder':
      return String(params['task'] || '').slice(0, 40);
    case 'spawn-agents': {
      const tasks = params['tasks'] as { description: string }[] | undefined;
      if (!tasks) return '';
      if (tasks.length <= 2) {
        return tasks.map((t) => t.description.slice(0, 30)).join(', ');
      }
      return `${tasks.length} 个并行任务`;
    }
    case 'todo': {
      const action = String(params['action'] || '');
      const id = params['id'] ? ` [${params['id']}]` : '';
      return `${action}${id}`;
    }
    case 'memo': {
      const action = String(params['action'] || '');
      const key = params['key'] ? ` [${params['key']}]` : '';
      if (action === 'write') {
        const s = params['summary'] || params['content'];
        const preview = s ? String(s).slice(0, 50) : '';
        return `write${key}${preview ? ' ' + preview : ''}`;
      }
      return `${action}${key}`;
    }
    default: {
      const keys = Object.keys(params);
      if (keys.length > 0 && keys[0]) {
        return String(params[keys[0]] || '').slice(0, 40);
      }
      return '';
    }
  }
}

export function getToolIcon(name: string): string {
  switch (name) {
    case 'bash': return '$';
    case 'write-file': return '+';
    case 'edit-file': return '±';
    case 'read-file': return '📄';
    case 'glob': return '🔍';
    case 'grep': return '🔍';
    case 'spawn-agents': return '⚡';
    case 'todo': return '📋';
    case 'memo': return '📝';
    default: return '⚙';
  }
}

/** 提取写入/编辑工具的代码内容 */
function getCodeContent(name: string, params: Record<string, unknown>): string | null {
  if (name === 'write-file') {
    return (params['content'] as string | undefined) || null;
  }
  if (name === 'edit-file') {
    return (params['new_string'] as string | undefined) || null;
  }
  return null;
}

/** 截断代码为最多 maxLines 行的预览 */
function truncateCode(code: string, maxLines: number): string {
  const lines = code.split('\n');
  if (lines.length <= maxLines) return code;
  return lines.slice(0, maxLines).join('\n') + `\n... (共 ${lines.length} 行)`;
}

/**
 * 工具完成后的完整显示（用于 Static 区域）
 * 显示 ✓/✗ 状态 + 工具信息 + 结果预览
 * 写入/编辑工具完成后显示折叠的代码预览（最多 5 行）
 */
export function ToolCallLine({ toolCall }: ToolCallLineProps) {
  const { name, params, status, resultSummary, resultContent, denyFeedback } = toolCall;
  const summary = getToolParamSummary(name, params);
  const icon = getToolIcon(name);

  const isWriteTool = name === 'write-file' || name === 'edit-file';
  const rawCode = isWriteTool && status === 'done' ? getCodeContent(name, params) : null;

  let statusNode: React.ReactNode;
  let statusText = '';

  switch (status) {
    case 'running':
      statusNode = <Text color="yellow">⏳</Text>;
      break;
    case 'done':
      statusNode = <Text color="green">✓</Text>;
      statusText = resultSummary || '';
      break;
    case 'denied':
      statusNode = <Text color="red">✗</Text>;
      statusText = 'denied';
      break;
    case 'confirming':
      statusNode = <Text color="yellow">⚠</Text>;
      statusText = '[y/N]';
      break;
  }

  return (
    <Box flexDirection="column" marginLeft={2}>
      <Box gap={1}>
        {statusNode}
        <Text color="yellow" bold>{icon} {name}</Text>
        {summary ? <Text dimColor>{summary}</Text> : null}
        {statusText ? <Text dimColor>{statusText}</Text> : null}
      </Box>

      {/* 写入/编辑工具的折叠代码预览（完成后显示，最多 5 行） */}
      {status === 'done' && rawCode && (
        <Box marginLeft={3} marginTop={0}>
          <Text dimColor>{truncateCode(rawCode, 5)}</Text>
        </Box>
      )}

      {/* 非写入工具的结果预览（完成后显示） */}
      {status === 'done' && !isWriteTool && resultContent && (
        <Box
          marginLeft={3}
          marginTop={0}
          borderStyle="single"
          borderColor="gray"
          paddingX={1}
        >
          <Text dimColor>{resultContent}</Text>
        </Box>
      )}

      {/* Show deny feedback */}
      {status === 'denied' && denyFeedback && (
        <Box marginLeft={3} gap={1}>
          <Text color="red">反馈:</Text>
          <Text>{denyFeedback}</Text>
        </Box>
      )}
    </Box>
  );
}
