import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import type { TodoPlan } from '../../../core/todo-store.js';
import type { SubAgentProgress } from '../../../core/sub-agent-tracker.js';
import { progressStore, type StreamingProgress } from '../stores/progressStore.js';

interface StatusBarProps {
  isRunning: boolean;
  modelName: string;
  todoPlan?: TodoPlan | null;
  subAgentProgress?: SubAgentProgress | null;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export const StatusBar = React.memo(function StatusBar({ isRunning, modelName, todoPlan, subAgentProgress }: StatusBarProps) {
  const [activeStreamingTool, setActiveStreamingTool] = useState<StreamingProgress | undefined>(progressStore.get());

  useEffect(() => {
    const handleUpdate = (progress?: StreamingProgress) => {
      setActiveStreamingTool(progress);
    };
    progressStore.on('change', handleUpdate);
    return () => { progressStore.off('change', handleUpdate); };
  }, []);

  const todoProgress = todoPlan
    ? `${todoPlan.items.filter((i) => i.status === 'completed').length}/${todoPlan.items.length}`
    : null;

  return (
    <Box marginTop={1} height={1} width="100%">
      <Box backgroundColor="#3c3836" paddingX={1} flexShrink={0}>
        <Text color="#ebdbb2" bold>ZENCODE</Text>
      </Box>

      <Box backgroundColor="#504945" paddingX={1} flexGrow={1} flexBasis={0}>
        <Text color="#ebdbb2" wrap="truncate-end">{modelName}</Text>

        {isRunning && !subAgentProgress && !activeStreamingTool && (
          <>
            <Text color="#ebdbb2"> │ </Text>
            <Text color="#8ec07c">● thinking...</Text>
          </>
        )}

        {activeStreamingTool && (
          <>
            <Text color="#ebdbb2"> │ </Text>
            <Text color="#fabd2f" wrap="truncate-end">● {activeStreamingTool.name}: {activeStreamingTool.progress}</Text>
          </>
        )}

        {subAgentProgress && (
          <>
            <Text color="#ebdbb2"> │ </Text>
            <Text color="#b8bb26">Agents: {subAgentProgress.completed + subAgentProgress.failed}/{subAgentProgress.total}</Text>
            <Text color="#ebdbb2"> │ </Text>
            <Text color="#83a598">tokens: {formatTokens(subAgentProgress.tokens)}</Text>
          </>
        )}

        {todoProgress && (
          <>
            <Text color="#ebdbb2"> │ </Text>
            <Text color="#fabd2f">Plan: {todoProgress}</Text>
          </>
        )}
      </Box>

      <Box backgroundColor="#3c3836" paddingX={1} flexShrink={0}>
        <Text color="#ebdbb2">/help</Text>
      </Box>
    </Box>
  );
});
