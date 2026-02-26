import React from 'react';
import { Box, Text } from 'ink';
import type { ToolCallState } from '../state.js';

interface ToolCallLineProps {
  toolCall: ToolCallState;
}

export function getToolParamSummary(name: string, params: Record<string, unknown>): string {
  switch (name) {
    case 'bash':
      return String(params['command'] || '').slice(0, 100);
    case 'read-file':
    case 'write-file':
    case 'edit-file':
      return String(params['path'] || '');
    case 'glob':
    case 'grep':
      return String(params['pattern'] || '');
    default:
      const keys = Object.keys(params);
      return keys.length > 0 ? String(params[keys[0]] || '').slice(0, 60) : '';
  }
}

function truncateContent(text: string, maxLines: number): string[] {
  const lines = text.split('\n');
  const result: string[] = [];
  for (let line of lines) {
    if (result.length >= maxLines) break;
    // Replace tabs with spaces and strip \r to avoid terminal width miscalculation
    result.push(line.replace(/\r/g, '').replace(/\t/g, '  '));
  }
  if (lines.length > maxLines) {
    result.push(`... (and ${lines.length - maxLines} more lines)`);
  }
  return result;
}

export function ToolCallLine({ toolCall }: ToolCallLineProps) {
  const { name, params, status, resultContent, denyFeedback } = toolCall;
  const summary = getToolParamSummary(name, params);

  let borderColor = '#504945';
  let titleColor = '#fabd2f';
  let statusColor = '#fabd2f';
  let statusText = 'RUNNING';

  if (status === 'done') {
    borderColor = '#b8bb26';
    titleColor = '#b8bb26';
    statusColor = '#b8bb26';
    statusText = 'DONE';
  } else if (status === 'denied') {
    borderColor = '#fb4934';
    titleColor = '#fb4934';
    statusColor = '#fb4934';
    statusText = 'DENIED';
  } else if (status === 'confirming') {
    borderColor = '#fe8019';
    titleColor = '#fe8019';
    statusColor = '#fe8019';
    statusText = 'CONFIRM';
  }

  const contentLines = resultContent ? truncateContent(resultContent, 15) : [];

  return (
    <Box flexDirection="column" marginTop={0} marginBottom={1} width="100%">
      <Box 
        flexDirection="column" 
        borderStyle="round" 
        borderColor={borderColor} 
        paddingX={1}
        width="100%"
      >
        <Box gap={1}>
          <Box backgroundColor={statusColor} width={9} justifyContent="center">
            <Text color="#282828" bold>{statusText}</Text>
          </Box>
          <Text color={titleColor} bold>{name.toUpperCase()}</Text>
          <Text color="#ebdbb2" dimColor italic wrap="truncate-end">{summary}</Text>
        </Box>

        {status === 'done' && contentLines.length > 0 && (
          <Box flexDirection="column" marginTop={1}>
            {contentLines.map((line, i) => (
              <Text key={i} color="#ebdbb2" wrap="truncate-end">{line}</Text>
            ))}
          </Box>
        )}

        {status === 'denied' && denyFeedback && (
          <Box gap={1} marginTop={0}>
            <Text color="#fb4934" bold>REASON:</Text>
            <Text color="#ebdbb2">{denyFeedback}</Text>
          </Box>
        )}

        {status === 'confirming' && (
          <Box marginTop={0}>
            <Text color="#fe8019" italic>Waiting for your permission...</Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}
