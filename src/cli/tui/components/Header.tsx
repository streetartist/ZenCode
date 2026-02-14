import React from 'react';
import { Box, Text } from 'ink';

interface HeaderProps {
  modelName: string;
}

export function Header({ modelName }: HeaderProps) {
  return (
    <Box justifyContent="space-between" paddingX={1}>
      <Text bold color="cyan">ZenCode</Text>
      <Text dimColor>{modelName}</Text>
    </Box>
  );
}
