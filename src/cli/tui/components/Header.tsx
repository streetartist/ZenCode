import React from 'react';
import { Box, Text, useStdout } from 'ink';

interface HeaderProps {
  modelName: string;
}

export function Header({ modelName }: HeaderProps) {
  const { stdout } = useStdout();
  // ZenCode ASCII Logo (Small & Clean)
  const logo = [
    ' ███████╗███████╗███╗   ██╗ ██████╗  ██████╗ ██████╗ ███████╗',
    ' ╚══███╔╝██╔════╝████╗  ██║██╔════╝ ██╔═══██╗██╔══██╗██╔════╝',
    '   ███╔╝ █████╗  ██╔██╗ ██║██║      ██║   ██║██║  ██║█████╗  ',
    '  ███╔╝  ██╔══╝  ██║╚██╗██║██║      ██║   ██║██║  ██║██╔══╝  ',
    ' ███████╗███████╗██║ ╚████║╚██████╗ ╚██████╔╝██████╔╝███████╗',
    ' ╚══════╝╚══════╝╚═╝  ╚═══╝ ╚═════╝  ╚═════╝ ╚═════╝ ╚══════╝',
  ];

  // Parent App has paddingLeft=1 + paddingRight=1, so available width = columns - 2
  const width = (stdout?.columns ?? 80) - 2;

  return (
    <Box
      flexDirection="column"
      width={width}
      borderStyle="round"
      borderColor="#504945"
      paddingX={1}
      marginTop={0}
      marginBottom={1}
    >
      <Box flexDirection="column" marginBottom={1} alignItems="center">
        {logo.map((line, i) => (
          <Text key={i} color="#fe8019" bold>
            {line}
          </Text>
        ))}
      </Box>

      <Box justifyContent="space-between" borderStyle="single" borderTop={true} borderBottom={false} borderLeft={false} borderRight={false} borderColor="#3c3836" paddingTop={0}>
        <Box gap={1}>
          <Text bold color="#fabd2f">ZEN CODE</Text>
          <Text color="#a89984" dimColor>v0.4.1</Text>
        </Box>
        <Text color="#83a598" bold>{modelName}</Text>
      </Box>
    </Box>
  );
}
