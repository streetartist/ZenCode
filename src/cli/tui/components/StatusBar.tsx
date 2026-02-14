import React from 'react';
import { Box, Text } from 'ink';
import type { TodoPlan } from '../../../core/todo-store.js';
import type { SubAgentProgress } from '../../../core/sub-agent-tracker.js';

interface StatusBarProps {
  agentMode: string;
  collaboration: string;
  coderWorking: boolean;
  isRunning: boolean;
  modelName: string;
  todoPlan?: TodoPlan | null;
  subAgentProgress?: SubAgentProgress | null;
}

export function StatusBar({ agentMode, collaboration, coderWorking, isRunning, modelName, todoPlan, subAgentProgress }: StatusBarProps) {
  const modeLabel = agentMode === 'dual' ? `dual(${collaboration})` : 'single';
  const todoProgress = todoPlan
    ? `${todoPlan.items.filter((i) => i.status === 'completed').length}/${todoPlan.items.length}`
    : null;

  return (
    <Box paddingX={1} gap={1}>
      <Text dimColor>──</Text>
      <Text bold>{modeLabel}</Text>
      <Text dimColor>▶</Text>
      <Text bold>{modelName}</Text>
      {coderWorking && (
        <>
          <Text dimColor>│</Text>
          <Text color="yellow">⚙ coder</Text>
        </>
      )}
      {isRunning && !coderWorking && !subAgentProgress && (
        <>
          <Text dimColor>│</Text>
          <Text color="cyan">thinking...</Text>
        </>
      )}
      {subAgentProgress && (
        <>
          <Text dimColor>│</Text>
          <Text color="magenta">⚡ {subAgentProgress.completed + subAgentProgress.failed}/{subAgentProgress.total} agents</Text>
        </>
      )}
      {todoProgress && (
        <>
          <Text dimColor>│</Text>
          <Text color="cyan">plan {todoProgress}</Text>
        </>
      )}
      <Text dimColor>│</Text>
      <Text dimColor>/help</Text>
    </Box>
  );
}
