import React, { useRef } from 'react';
import { Static, Box, Text } from 'ink';
import type { ChatMessage } from '../state.js';
import type { ToolCallState } from '../state.js';
import { MessageBubble } from './MessageBubble.js';
import { ToolCallLine, getToolIcon, getToolParamSummary } from './ToolCallLine.js';

interface ChatAreaProps {
  messages: ChatMessage[];
}

/**
 * Static 渲染项 —— 推入 Ink <Static> 后写入 scrollback，永不重绘。
 *
 * 类型说明：
 * - message:     完整消息（未经流式渲染的用户/系统消息）
 * - line:        文本行（流式渲染的 assistant 消息，逐行推入）
 * - tool-header: 工具开始标记（⏳ icon，工具刚出现时推入，不可更新）
 * - tool-done:   工具完成结果（✓/✗ + 结果摘要，完成时推入）
 */
interface StaticItem {
  id: string;
  type: 'message' | 'line' | 'tool-header' | 'tool-done';
  message?: ChatMessage;
  text?: string;
  isFirstLine?: boolean;
  toolCall?: ToolCallState;
}

/**
 * 将消息分为已完成（static）和活跃（dynamic）
 */
function splitMessages(messages: ChatMessage[]): { staticMsgs: ChatMessage[]; streamingMsg: ChatMessage | null; otherDynamic: ChatMessage[] } {
  let staticEnd = 0;
  for (let i = 0; i < messages.length; i++) {
    if (messages[i]!.isStreaming || messages[i]!.confirmPending) break;
    staticEnd = i + 1;
  }
  const dynamicMsgs = messages.slice(staticEnd);
  const streamingMsg = dynamicMsgs.find(m => m.isStreaming) || null;
  const otherDynamic = dynamicMsgs.filter(m => m !== streamingMsg);
  return {
    staticMsgs: messages.slice(0, staticEnd),
    streamingMsg,
    otherDynamic,
  };
}

/**
 * 从消息的 blocks 中提取 static 项和 dynamic 节点。
 *
 * 核心策略（log-style，面向 Windows 终端兼容）：
 * - 完整的文本行（以 \n 结尾）→ Static（每行一个 item）
 * - 工具开始 → Static（tool-header，⏳ 标记）
 * - 工具完成 → Static（tool-done，✓/✗ + 结果摘要）
 * - 写入/编辑工具进行中 → Dynamic（实时行数指示器，1 行）
 * - 正在输入的部分行 → Dynamic（最多 1 行，最小重绘面积）
 */
function extractFromBlocks(
  msg: ChatMessage,
  staticItems: StaticItem[],
  dynamicNodes: React.ReactNode[],
  isStreaming: boolean,
) {
  let lineIdx = 0;

  for (let bi = 0; bi < msg.blocks.length; bi++) {
    const block = msg.blocks[bi]!;
    const isLastBlock = bi === msg.blocks.length - 1;

    if (block.type === 'text') {
      const lines = block.text.split('\n');

      if (isStreaming && isLastBlock) {
        // 最后一个 text block 仍在流式输入：完整行 → static，末尾部分行 → dynamic
        const partial = lines.pop() || '';
        for (const line of lines) {
          staticItems.push({
            id: `${msg.id}-L${lineIdx}`,
            type: 'line',
            text: line,
            isFirstLine: lineIdx === 0,
          });
          lineIdx++;
        }
        // 部分行（或第一行占位）→ dynamic（最多 1 行）
        if (partial || lineIdx === 0) {
          dynamicNodes.push(
            <Box key="partial">
              <Text color="cyan" bold>{lineIdx === 0 ? '◆ ' : '  '}</Text>
              <Box flexGrow={1}><Text>{partial}</Text></Box>
            </Box>,
          );
        }
      } else {
        // 已完成的 text block：所有行 → static
        for (const line of lines) {
          staticItems.push({
            id: `${msg.id}-L${lineIdx}`,
            type: 'line',
            text: line,
            isFirstLine: lineIdx === 0,
          });
          lineIdx++;
        }
      }
    } else if (block.type === 'tool') {
      const tc = block.toolCall;
      const isWriteTool = tc.name === 'write-file' || tc.name === 'edit-file';

      // tool-header: 工具开始标记
      staticItems.push({
        id: `${msg.id}-TH${tc.id}`,
        type: 'tool-header',
        toolCall: tc,
      });

      // 写入/编辑工具进行中：动态区域显示实时行数
      if (isWriteTool && tc.status === 'running' && isStreaming) {
        const lineCount = parseInt(tc.streamingContent || '0', 10);
        dynamicNodes.push(
          <Box key={`tool-progress-${tc.id}`} paddingX={1} marginLeft={4}>
            <Text color="cyan">✎ 生成中...{lineCount > 0 ? ` ${lineCount} 行` : ''}</Text>
          </Box>,
        );
      }

      // tool-done: 完成/拒绝的结果
      if (tc.status === 'done' || tc.status === 'denied') {
        staticItems.push({
          id: `${msg.id}-TD${tc.id}`,
          type: 'tool-done',
          toolCall: tc,
        });
      }
    }
  }
}

function renderStaticItem(item: StaticItem) {
  if (item.type === 'message') {
    return (
      <Box key={item.id} paddingX={1}>
        <MessageBubble message={item.message!} />
      </Box>
    );
  }
  if (item.type === 'line') {
    return (
      <Box key={item.id} paddingX={1}>
        <Text color="cyan" bold>{item.isFirstLine ? '◆ ' : '  '}</Text>
        <Text>{item.text}</Text>
      </Box>
    );
  }
  if (item.type === 'tool-header') {
    const tc = item.toolCall!;
    const icon = getToolIcon(tc.name);
    const summary = getToolParamSummary(tc.name, tc.params);
    return (
      <Box key={item.id} paddingX={1} marginLeft={2}>
        <Box gap={1}>
          <Text color="yellow">⏳</Text>
          <Text color="yellow" bold>{icon} {tc.name}</Text>
          {summary ? <Text dimColor>{summary}</Text> : null}
        </Box>
      </Box>
    );
  }
  if (item.type === 'tool-done') {
    return (
      <Box key={item.id} paddingX={1} marginLeft={0}>
        <ToolCallLine toolCall={item.toolCall!} />
      </Box>
    );
  }
  return null;
}

export const ChatArea = React.memo(function ChatArea({ messages }: ChatAreaProps) {
  const { staticMsgs, streamingMsg, otherDynamic } = splitMessages(messages);

  // 记住哪些消息已按行推入 Static（完成后不再用 MessageBubble 重复渲染）
  const streamedIds = useRef(new Set<string>());
  if (streamingMsg) {
    streamedIds.current.add(streamingMsg.id);
  }

  // ── 计算当前所有应该存在的 static items ──
  const currentItems: StaticItem[] = [];

  for (const msg of staticMsgs) {
    if (streamedIds.current.has(msg.id)) {
      const ignore: React.ReactNode[] = [];
      extractFromBlocks(msg, currentItems, ignore, false);
    } else {
      currentItems.push({ id: msg.id, type: 'message', message: msg });
    }
  }

  const dynamicNodes: React.ReactNode[] = [];
  if (streamingMsg) {
    extractFromBlocks(streamingMsg, currentItems, dynamicNodes, true);
  }

  // ── 去重累积：保证每个 ID 的 item 只出现一次 ──
  // Ink 的 <Static> 在 items 数组引用变化时可能重复渲染。
  // 用 ref 维护一个只增不减的累积数组，彻底避免重复。
  const seenIds = useRef(new Set<string>());
  const accumulated = useRef<StaticItem[]>([]);

  let hasNew = false;
  for (const item of currentItems) {
    if (!seenIds.current.has(item.id)) {
      seenIds.current.add(item.id);
      accumulated.current.push(item);
      hasNew = true;
    }
  }
  // 当有新 item 时，创建新数组引用让 Ink 感知变化
  if (hasNew) {
    accumulated.current = [...accumulated.current];
  }

  const staticItems = accumulated.current;

  // 流式消息无内容时显示占位符
  const showPlaceholder = streamingMsg && streamingMsg.blocks.length === 0;

  return (
    <Box flexDirection="column">
      {staticItems.length > 0 && (
        <Static items={staticItems}>
          {renderStaticItem}
        </Static>
      )}

      {/* 动态区域：最多 1 行（部分文本行 或 部分代码行） */}
      {(dynamicNodes.length > 0 || showPlaceholder) && (
        <Box flexDirection="column" paddingX={1}>
          {showPlaceholder && (
            <Box>
              <Text color="cyan" bold>◆ </Text>
              <Text dimColor>...</Text>
            </Box>
          )}
          {dynamicNodes}
        </Box>
      )}

      {/* 其他动态消息（如确认弹窗） */}
      {otherDynamic.map(msg => (
        <Box key={msg.id} paddingX={1}>
          <MessageBubble message={msg} />
        </Box>
      ))}
    </Box>
  );
});
