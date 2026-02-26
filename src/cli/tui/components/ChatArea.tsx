import React from 'react';
import { Box } from 'ink';
import type { ChatMessage } from '../state.js';
import { MessageBubble } from './MessageBubble.js';

interface ChatAreaProps {
  messages: ChatMessage[];
}

export const ChatArea = React.memo(function ChatArea({ messages }: ChatAreaProps) {
  return (
    <Box flexDirection="column" width="100%">
      {messages.map((msg) => (
        <MessageBubble key={msg.id} message={msg} />
      ))}
    </Box>
  );
});
