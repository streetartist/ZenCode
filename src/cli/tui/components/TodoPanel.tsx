import React from 'react';
import { Box, Text } from 'ink';
import type { TodoPlan } from '../../../core/todo-store.js';

interface TodoPanelProps {
  plan: TodoPlan;
}

function getStatusIcon(status: string): string {
  switch (status) {
    case 'completed':
      return '●';
    case 'in-progress':
      return '◐';
    default:
      return '○';
  }
}

function getStatusColor(status: string): string {
  switch (status) {
    case 'completed':
      return 'green';
    case 'in-progress':
      return 'yellow';
    default:
      return 'gray';
  }
}

export function TodoPanel({ plan }: TodoPanelProps) {
  const completed = plan.items.filter((i) => i.status === 'completed').length;
  const total = plan.items.length;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      paddingX={1}
      marginBottom={0}
    >
      <Box justifyContent="space-between">
        <Text bold color="cyan">
          Plan
        </Text>
        <Text dimColor>
          {completed}/{total}
        </Text>
      </Box>
      {plan.items.map((item) => (
        <Box key={item.id} gap={1}>
          <Text color={getStatusColor(item.status)}>
            {getStatusIcon(item.status)}
          </Text>
          <Text
            color={item.status === 'completed' ? 'green' : undefined}
            dimColor={item.status === 'pending'}
          >
            {item.title}
          </Text>
        </Box>
      ))}
    </Box>
  );
}
