import React from 'react';
import { Box, Text } from 'ink';
import type { TodoPlan } from '../../../core/todo-store.js';

interface TodoPanelProps {
  plan: TodoPlan;
}

function getStatusIcon(status: string): string {
  switch (status) {
    case 'completed':
      return '*';
    case 'in-progress':
      return '>';
    default:
      return ' ';
  }
}

function getStatusColor(status: string): string {
  switch (status) {
    case 'completed':
      return '#b8bb26';
    case 'in-progress':
      return '#fabd2f';
    default:
      return '#928374';
  }
}

export function TodoPanel({ plan }: TodoPanelProps) {
  const completed = plan.items.filter((i) => i.status === 'completed').length;
  const total = plan.items.length;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="#83a598"
      paddingX={1}
      marginY={1}
    >
      <Box justifyContent="space-between" marginBottom={1}>
        <Text bold color="#83a598">
          PROJECT PLAN
        </Text>
        <Text color="#ebdbb2">
          {completed}/{total} tasks
        </Text>
      </Box>
      {plan.items.map((item) => (
        <Box key={item.id} gap={0}>
          <Text color={getStatusColor(item.status)}>
            [{getStatusIcon(item.status)}]
          </Text>
          <Text> </Text>
          <Text
            color={item.status === 'completed' ? '#b8bb26' : item.status === 'in-progress' ? '#fabd2f' : '#ebdbb2'}
            dimColor={item.status === 'pending'}
            strikethrough={item.status === 'completed'}
          >
            {item.title}
          </Text>
        </Box>
      ))}
    </Box>
  );
}
