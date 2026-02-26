import React from 'react';
import { Box, Text } from 'ink';
import type { ChatMessage } from '../state.js';
import { ToolCallLine } from './ToolCallLine.js';

interface MessageBubbleProps {
  message: ChatMessage;
}

export const MessageBubble = React.memo(function MessageBubble({ message }: MessageBubbleProps) {
  const { role, blocks, isStreaming } = message;

  const isUser = role === 'user';
  const label = isUser ? 'USER' : 'AI';
  const labelBg = isUser ? '#b8bb26' : '#83a598';
  const labelFg = '#282828';
  const contentColor = isUser ? '#ebdbb2' : '#ebdbb2';

  return (
    <Box flexDirection="column" marginBottom={1} width="100%">
      <Box marginBottom={0}>
        <Box backgroundColor={labelBg} width={9} paddingLeft={1} marginRight={1}>
          <Text color={labelFg} bold>{label}</Text>
        </Box>
        {isStreaming && <Text color="#83a598" dimColor italic>typing...</Text>}
      </Box>

      <Box flexDirection="column" width="100%">
        {blocks.map((block, i) => {
          if (block.type === 'text') {
            const text = block.text.trim();
            if (!text && !isStreaming) return null;
            return (
              <Box key={`text-${i}`} paddingLeft={2} marginBottom={i < blocks.length - 1 ? 1 : 0} width="100%">
                <Text color={contentColor}>{text}</Text>
              </Box>
            );
          } else if (block.type === 'thought') {
            return (
              <Box key={`thought-${i}`} flexDirection="column" marginBottom={0} width="100%">
                <Box gap={1} marginBottom={0}>
                  <Box backgroundColor="#504945" width={9} justifyContent="center">
                    <Text color="#a89984" bold>THINK</Text>
                  </Box>
                </Box>
                <Box paddingLeft={2} marginBottom={0}>
                  <Text color="#928374" italic>{block.text.trim()}</Text>
                </Box>
              </Box>
            );
          } else {
            return (
              <Box key={block.toolCall.id} paddingLeft={2} width="100%">
                <ToolCallLine toolCall={block.toolCall} />
              </Box>
            );
          }
        })}
        {blocks.length === 0 && isStreaming && (
          <Box paddingLeft={2}>
            <Text dimColor>...</Text>
          </Box>
        )}
      </Box>
    </Box>
  );
});
