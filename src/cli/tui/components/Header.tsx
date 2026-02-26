import React from 'react';
import { Box, Text } from 'ink';

interface HeaderProps {
  modelName: string;
}

export function Header({ modelName }: HeaderProps) {
  return (
    <Box 
      flexDirection="column"
      width="100%"
      borderStyle="round"
      borderColor="#504945"
      paddingX={1}
      marginTop={0}
      marginBottom={1}
    >
      <Box justifyContent="space-between">
        <Box gap={1}>
          <Text bold color="#fe8019">ZEN CODE</Text>
          <Text color="#a89984" dimColor>v0.2.3</Text>
        </Box>
        <Text color="#83a598" bold>{modelName}</Text>
      </Box>
    </Box>
  );
}
