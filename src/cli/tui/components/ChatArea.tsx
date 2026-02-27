import React, { useMemo } from 'react';
import { Box, Static, useStdout } from 'ink';
import type { ChatMessage } from '../state.js';
import { MessageBubble } from './MessageBubble.js';
import { Header } from './Header.js';

interface ChatAreaProps {
  messages: ChatMessage[];
  modelName: string;
}

// 定义一个稳定的 Header 项引用，防止 Static 组件重复渲染它
const HEADER_ITEM = { id: 'static-header', isHeader: true };

export const ChatArea = React.memo(function ChatArea({ messages, modelName }: ChatAreaProps) {
  const completedMessages = messages.filter(m => !m.isStreaming);
  const activeMessages = messages.filter(m => m.isStreaming);

  // Only update static items when the number of completed messages changes
  // or when an assistant message finishes streaming.
  const completedCount = completedMessages.length;
  const lastCompletedId = completedMessages[completedMessages.length - 1]?.id;

  // 构造稳定引用的静态项列表
  const staticItems = useMemo(() => [
    HEADER_ITEM,
    ...completedMessages
  ], [completedCount, lastCompletedId]);

  return (
    <Box flexDirection="column" width="100%">
      <Static items={staticItems}>
        {(item: any) => {
          if (item.isHeader) {
            return <Header key="header" modelName={modelName} />;
          }
          return <MessageBubble key={item.id} message={item} />;
        }}
      </Static>
      {activeMessages.map((msg) => (
        <MessageBubble key={msg.id} message={msg} />
      ))}
    </Box>
  );
}, (prev, next) => {
  return prev.messages === next.messages && prev.modelName === next.modelName;
});
