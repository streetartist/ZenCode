import React from 'react';
import { Box, Text } from 'ink';
import type { ChatMessage } from '../state.js';
import { ToolCallLine } from './ToolCallLine.js';

interface MessageBubbleProps {
  message: ChatMessage;
}

export const MessageBubble = React.memo(function MessageBubble({ message }: MessageBubbleProps) {
  const { role, blocks, isStreaming } = message;

  const color = role === 'user' ? 'green' : role === 'assistant' ? 'cyan' : 'gray';
  const icon = role === 'user' ? '>' : role === 'assistant' ? '◆' : '•';

  return (
    <Box flexDirection="column" marginBottom={1}>
      {blocks.map((block, i) => {
        if (block.type === 'text') {
          return (
            <Box key={`text-${i}`}>
              {i === 0 ? (
                <Text color={color} bold>{icon} </Text>
              ) : (
                <Text>  </Text>
              )}
              <Box flexDirection="column" flexGrow={1}>
                <Text>{block.text}</Text>
              </Box>
            </Box>
          );
        } else {
          return (
            <ToolCallLine key={block.toolCall.id} toolCall={block.toolCall} />
          );
        }
      })}
      {blocks.length === 0 && (
        <Box>
          <Text color={color} bold>{icon} </Text>
          {isStreaming && <Text dimColor>...</Text>}
        </Box>
      )}
    </Box>
  );
});
