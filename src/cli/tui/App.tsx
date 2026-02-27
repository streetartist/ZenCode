import React, { useReducer, useCallback, useEffect, useRef, useState } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import type { ZenCodeConfig } from '../../config/types.js';
import type { Agent } from '../../core/agent.js';
import type { ToolRegistry } from '../../tools/registry.js';
import type { TodoStore } from '../../core/todo-store.js';
import type { SubAgentTracker } from '../../core/sub-agent-tracker.js';
import type { SubAgentConfigRegistry } from '../../core/sub-agents/registry.js';
import type { SkillRegistry } from '../../core/skills/registry.js';
import { isAbortError, type LLMClient } from '../../llm/client.js';
import { setStructuredConfirmHandler } from '../../tools/permission.js';
import type { ConfirmExecutionResult } from '../../tools/permission.js';
import { tuiReducer, createInitialState, type TuiAction, type ConfirmPending, type ConfirmResult } from './state.js';
import { createBridgeCallbacks, registerConfirmToolId } from './bridge.js';
import { createSpawnAgentsTool } from '../../tools/spawn-agents.js';
import { createTodoTool } from '../../tools/todo.js';
import { ChatArea } from './components/ChatArea.js';
import { InputArea } from './components/InputArea.js';
import { StatusBar } from './components/StatusBar.js';
import { ConfirmPrompt } from './components/ConfirmPrompt.js';
import { TodoPanel } from './components/TodoPanel.js';

interface AppProps {
  config: ZenCodeConfig;
  client: LLMClient;
  agent: Agent;
  registry: ToolRegistry;
  todoStore: TodoStore;
  subAgentTracker: SubAgentTracker;
  agentRegistry: SubAgentConfigRegistry;
  skillRegistry: SkillRegistry;
}

export function App({ config, client, agent, registry, todoStore, subAgentTracker, agentRegistry, skillRegistry }: AppProps) {
  const { stdout } = useStdout();
  // Reset counter: forces full re-mount when /clear is used or terminal resizes
  const [resetKey, setResetKey] = useState(0);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let lastCols = stdout.columns;
    let lastRows = stdout.rows;

    const onResize = () => {
      if (stdout.columns === lastCols && stdout.rows === lastRows) return;
      lastCols = stdout.columns;
      lastRows = stdout.rows;

      clearTimeout(timer);
      timer = setTimeout(() => {
        // Clear terminal (screen + scrollback) and home cursor
        process.stdout.write('\x1b[2J\x1b[3J\x1b[H');
        setResetKey(prev => prev + 1);
      }, 100);
    };
    stdout.on('resize', onResize);
    return () => {
      stdout.off('resize', onResize);
      clearTimeout(timer);
    };
  }, [stdout]);

  const [state, dispatch] = useReducer(
    tuiReducer,
    createInitialState(config.model),
  );

  const currentCallbacksRef = useRef<(ReturnType<typeof createBridgeCallbacks> & { _stopBatcher?: () => void }) | null>(null);

  const agentRef = useRef(agent);
  const todoStoreRef = useRef(todoStore);
  const subAgentTrackerRef = useRef(subAgentTracker);
  agentRef.current = agent;
  todoStoreRef.current = todoStore;
  subAgentTrackerRef.current = subAgentTracker;

  // Subscribe to TodoStore changes
  useEffect(() => {
    return todoStoreRef.current.subscribe((plan) => {
      dispatch({ type: 'SET_TODO_PLAN', plan });
    });
  }, []);

  // Subscribe to SubAgentTracker changes (throttled to reduce re-renders)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let latest: import('../../core/sub-agent-tracker.js').SubAgentProgress | null = null;

    const unsub = subAgentTrackerRef.current.subscribe((progress) => {
      latest = progress;
      if (progress === null) {
        if (timer) { clearTimeout(timer); timer = null; }
        dispatch({ type: 'SET_SUB_AGENT_PROGRESS', progress: null });
        return;
      }
      if (!timer) {
        dispatch({ type: 'SET_SUB_AGENT_PROGRESS', progress });
        timer = setTimeout(() => {
          timer = null;
          if (latest) dispatch({ type: 'SET_SUB_AGENT_PROGRESS', progress: latest });
        }, 2000);
      }
    });

    return () => { unsub(); if (timer) clearTimeout(timer); };
  }, []);

  // Find active confirm pending
  const confirmPending = state.messages.reduce<ConfirmPending | undefined>(
    (found, msg) => found || msg.confirmPending,
    undefined,
  );

  // --- Register structured confirm handler ---
  useEffect(() => {
    setStructuredConfirmHandler((toolName, params) => {
      return new Promise<ConfirmExecutionResult>((resolve) => {
        const id = `confirm-${Date.now()}`;
        registerConfirmToolId(toolName, id);
        dispatch({
          type: 'TOOL_CONFIRMING',
          id,
          name: toolName,
          params,
          resolve: (result: ConfirmResult) => {
            if (result === 'always') {
              registry.addAutoApprove(toolName);
              resolve({ approved: true });
            } else if (result === 'allow') {
              resolve({ approved: true });
            } else if (result === 'deny') {
              resolve({ approved: false });
            } else {
              resolve({ approved: false, feedback: result.feedback });
            }
          },
        });
      });
    });
    return () => { setStructuredConfirmHandler(null); };
  }, [registry]);

  // --- Run agent with a message ---
  const runAgent = useCallback(async (text: string) => {
    dispatch({ type: 'ADD_USER_MESSAGE', text });
    dispatch({ type: 'START_ASSISTANT' });
    dispatch({ type: 'SET_RUNNING', running: true });

    const callbacks = createBridgeCallbacks(dispatch);
    currentCallbacksRef.current = callbacks as ReturnType<typeof createBridgeCallbacks> & { _stopBatcher?: () => void };

    try {
      await agentRef.current.run(text, callbacks);
    } catch (err) {
      if (!isAbortError(err)) {
        const msg = err instanceof Error ? err.message : String(err);
        dispatch({ type: 'SET_ERROR', error: msg });
      }
    } finally {
      currentCallbacksRef.current = null;
    }

    (callbacks as any)._stopBatcher?.();
    dispatch({ type: 'FINISH_STREAMING' });
    dispatch({ type: 'SET_RUNNING', running: false });
  }, []);

  // --- Handle user message submission ---
  const handleSubmit = useCallback(async (text: string) => {
    if (text.startsWith('/')) {
      // Check if it's a user-defined skill first
      const parts = text.slice(1).split(/\s+/);
      const skillName = parts[0]!;
      const skillArgs = parts.slice(1).join(' ');
      const skill = skillRegistry.get(skillName);

      if (skill) {
        // Execute skill: expand prompt and send to agent
        const expandedPrompt = skillRegistry.expandPrompt(skill, skillArgs);
        await runAgent(expandedPrompt);
        return;
      }

      // Otherwise handle built-in slash commands
      handleSlashCommand(text, {
        config, agent: agentRef.current, registry, dispatch, setResetKey,
        client, todoStore, subAgentTracker, agentRegistry, skillRegistry,
      });
      return;
    }

    await runAgent(text);
  }, [config, runAgent]);

  // --- Handle confirm response ---
  const handleConfirmResponse = useCallback((result: ConfirmResult) => {
    if (confirmPending) {
      confirmPending.resolve(result);
      dispatch({ type: 'CONFIRM_RESPONDED', id: '' });
      const approved = result === 'allow' || result === 'always';
      if (approved) {
        for (const msg of state.messages) {
          for (const block of msg.blocks) {
            if (block.type === 'tool' && block.toolCall.status === 'confirming') {
              dispatch({ type: 'TOOL_EXECUTING', id: block.toolCall.id, name: block.toolCall.name, params: block.toolCall.params });
            }
          }
        }
      }
    }
  }, [confirmPending, state.messages]);

  // --- Keyboard shortcuts ---
  useInput((input, key) => {
    if (key.escape) {
      if (state.isRunning) {
        agentRef.current.interrupt();
        currentCallbacksRef.current?._stopBatcher?.();
        dispatch({ type: 'SET_RUNNING', running: false });
        dispatch({ type: 'FINISH_STREAMING' });
      }
      return;
    }

    if (input === 'c' && key.ctrl) {
      if (state.isRunning || confirmPending) {
        agentRef.current.interrupt();
        currentCallbacksRef.current?._stopBatcher?.();
        dispatch({ type: 'CONFIRM_RESPONDED', id: '' });
        dispatch({ type: 'SET_RUNNING', running: false });
        dispatch({ type: 'FINISH_STREAMING' });
        return;
      }
    }
    if (input === 'd' && key.ctrl) {
      process.exit(0);
    }
  });

  return (
    <Box key={resetKey} flexDirection="column" paddingLeft={1} paddingRight={1} width="100%">
      <ChatArea 
        messages={state.messages} 
        modelName={state.modelName} 
      />

      {state.error && (
        <Box borderStyle="round" borderColor="#fb4934" paddingX={1} marginBottom={0}>
          <Text color="#fb4934" bold>ERROR: </Text>
          <Text color="#fb4934">{state.error}</Text>
        </Box>
      )}

      {confirmPending && (
        <ConfirmPrompt confirm={confirmPending} onRespond={handleConfirmResponse} />
      )}

      {state.todoPlan && <TodoPanel plan={state.todoPlan} />}

      <Box marginTop={0}>
        <InputArea
          onSubmit={handleSubmit}
          isRunning={state.isRunning || !!confirmPending}
          onExitRequest={() => process.exit(0)}
        />
      </Box>

      <StatusBar
        isRunning={state.isRunning}
        modelName={state.modelName}
        todoPlan={state.todoPlan}
        subAgentProgress={state.subAgentProgress}
      />
    </Box>
  );
}

// ... rest remains same
