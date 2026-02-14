import React, { useReducer, useCallback, useEffect, useRef, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { ZenCodeConfig, CollaborationMode } from '../../config/types.js';
import type { Agent } from '../../core/agent.js';
import type { Orchestrator, OrchestratorCallbacks } from '../../core/dual-agent/orchestrator.js';
import type { ToolRegistry } from '../../tools/registry.js';
import type { TodoStore } from '../../core/todo-store.js';
import type { MemoStore } from '../../core/memo-store.js';
import type { SubAgentTracker } from '../../core/sub-agent-tracker.js';
import type { LLMClient } from '../../llm/client.js';
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
  orchestrator: Orchestrator;
  registry: ToolRegistry;
  todoStore: TodoStore;
  memoStore: MemoStore;
  subAgentTracker: SubAgentTracker;
}

export function App({ config, client, agent, orchestrator, registry, todoStore, memoStore, subAgentTracker }: AppProps) {
  const [state, dispatch] = useReducer(
    tuiReducer,
    createInitialState(
      config.model,
      config.agent_mode,
      config.collaboration,
    ),
  );

  // Reset counter: forces full re-mount when /clear is used (like kilocode)
  const [resetKey, setResetKey] = useState(0);

  const agentRef = useRef(agent);
  const orchestratorRef = useRef(orchestrator);
  const todoStoreRef = useRef(todoStore);
  const subAgentTrackerRef = useRef(subAgentTracker);
  agentRef.current = agent;
  orchestratorRef.current = orchestrator;
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
      // null = finished, dispatch immediately
      if (progress === null) {
        if (timer) { clearTimeout(timer); timer = null; }
        dispatch({ type: 'SET_SUB_AGENT_PROGRESS', progress: null });
        return;
      }
      // Throttle: at most once per 2000ms（减少动态区域重绘）
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

  // --- Handle user message submission ---
  const handleSubmit = useCallback(async (text: string) => {
    if (text.startsWith('/')) {
      handleSlashCommand(text, {
        config, agent: agentRef.current, orchestrator: orchestratorRef.current, registry, dispatch, setResetKey,
        client, todoStore, memoStore, subAgentTracker,
      });
      return;
    }

    dispatch({ type: 'ADD_USER_MESSAGE', text });
    dispatch({ type: 'START_ASSISTANT' });
    dispatch({ type: 'SET_RUNNING', running: true });

    const callbacks = createBridgeCallbacks(dispatch);

    try {
      if (config.agent_mode === 'single') {
        await agentRef.current.run(text, callbacks);
      } else {
        await orchestratorRef.current.run(text, callbacks as unknown as OrchestratorCallbacks);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      dispatch({ type: 'SET_ERROR', error: msg });
    }

    (callbacks as any)._stopBatcher?.();
    dispatch({ type: 'FINISH_STREAMING' });
    dispatch({ type: 'SET_RUNNING', running: false });
  }, [config]);

  // --- Handle confirm response ---
  const handleConfirmResponse = useCallback((result: ConfirmResult) => {
    if (confirmPending) {
      confirmPending.resolve(result);
      dispatch({ type: 'CONFIRM_RESPONDED', id: '' });
      const approved = result === 'allow' || result === 'always';
      // Only update confirming → running for approved tools.
      // Denied tools will be handled by bridge's onDenied callback (with feedback).
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
    if (input === 'c' && key.ctrl) {
      if (state.isRunning) {
        dispatch({ type: 'SET_RUNNING', running: false });
        dispatch({ type: 'FINISH_STREAMING' });
      } else {
        process.exit(0);
      }
      return;
    }
    if (input === 'd' && key.ctrl) {
      process.exit(0);
    }
  });

  return (
    <Box key={resetKey} flexDirection="column">
      {/* Messages area */}
      <Box flexDirection="column" overflow="hidden">
        <ChatArea messages={state.messages} />
      </Box>

      {/* Error */}
      {state.error && (
        <Box
          borderStyle="round"
          borderColor="red"
          paddingX={1}
          marginBottom={1}
        >
          <Text color="red" bold>✖ Error: </Text>
          <Text color="red">{state.error}</Text>
        </Box>
      )}

      {/* Confirm prompt */}
      {confirmPending && (
        <ConfirmPrompt
          confirm={confirmPending}
          onRespond={handleConfirmResponse}
        />
      )}

      {/* Todo panel */}
      {state.todoPlan && (
        <TodoPanel plan={state.todoPlan} />
      )}

      {/* Input */}
      <InputArea
        onSubmit={handleSubmit}
        isRunning={state.isRunning || !!confirmPending}
      />

      {/* Status bar */}
      <StatusBar
        agentMode={state.agentMode}
        collaboration={state.collaboration}
        coderWorking={state.coderWorking}
        isRunning={state.isRunning}
        modelName={state.modelName}
        todoPlan={state.todoPlan}
        subAgentProgress={state.subAgentProgress}
      />
    </Box>
  );
}

// --- Slash commands ---
interface SlashCommandContext {
  config: ZenCodeConfig;
  agent: Agent;
  orchestrator: Orchestrator | undefined;
  registry: ToolRegistry;
  dispatch: React.Dispatch<TuiAction>;
  setResetKey: React.Dispatch<React.SetStateAction<number>>;
  client: LLMClient;
  todoStore: TodoStore;
  memoStore: MemoStore;
  subAgentTracker: SubAgentTracker;
}

function handleSlashCommand(input: string, ctx: SlashCommandContext) {
  const { config, agent, orchestrator, registry, dispatch, setResetKey, client, todoStore, memoStore, subAgentTracker } = ctx;
  const parts = input.trim().split(/\s+/);
  const command = parts[0];

  switch (command) {
    case '/help':
      dispatch({ type: 'ADD_USER_MESSAGE', text: input });
      dispatch({ type: 'START_ASSISTANT' });
      dispatch({
        type: 'APPEND_CONTENT',
        text: `可用命令:
  /help                显示此帮助信息
  /mode [模式]         切换协作模式 (delegated/autonomous/controlled)
  /single              切换到单 Agent 模式
  /dual                切换到双 Agent 模式
  /parallel            切换并行子 Agent 功能 on/off
  /todo                切换 todo 计划功能 on/off
  /clear               清空对话历史
  /info                显示当前配置
  Ctrl+C               取消当前请求 / 退出
  Ctrl+D               退出`,
      });
      dispatch({ type: 'FINISH_STREAMING' });
      break;

    case '/mode': {
      const mode = parts[1];
      if (!mode) {
        dispatch({ type: 'ADD_USER_MESSAGE', text: input });
        dispatch({ type: 'START_ASSISTANT' });
        dispatch({
          type: 'APPEND_CONTENT',
          text: `当前协作模式: ${config.collaboration}\n可选: delegated, autonomous, controlled`,
        });
        dispatch({ type: 'FINISH_STREAMING' });
      } else if (['delegated', 'autonomous', 'controlled'].includes(mode)) {
        config.collaboration = mode as CollaborationMode;
        orchestrator?.setMode(mode as CollaborationMode);
        dispatch({ type: 'SET_MODE', agentMode: config.agent_mode, collaboration: mode });
      }
      break;
    }

    case '/single':
      config.agent_mode = 'single';
      dispatch({ type: 'SET_MODE', agentMode: 'single', collaboration: config.collaboration });
      break;

    case '/dual':
      config.agent_mode = 'dual';
      dispatch({ type: 'SET_MODE', agentMode: 'dual', collaboration: config.collaboration });
      break;

    case '/clear':
      agent.getConversation().clear();
      orchestrator?.getConversation().clear();
      memoStore.clear();
      dispatch({ type: 'CLEAR_MESSAGES' });
      setResetKey(prev => prev + 1);
      break;

    case '/parallel': {
      const current = config.features.parallel_agents;
      const next = current === 'on' ? 'off' : 'on';
      config.features.parallel_agents = next;
      if (next === 'off') {
        registry.unregister('spawn-agents');
      } else if (!registry.has('spawn-agents')) {
        registry.register(createSpawnAgentsTool(client, registry, config, subAgentTracker, memoStore));
      }
      dispatch({ type: 'ADD_USER_MESSAGE', text: input });
      dispatch({ type: 'START_ASSISTANT' });
      dispatch({ type: 'APPEND_CONTENT', text: `并行子 Agent 功能已${next === 'on' ? '开启' : '关闭'}` });
      dispatch({ type: 'FINISH_STREAMING' });
      break;
    }

    case '/todo': {
      const current = config.features.todo;
      const next = current === 'on' ? 'off' : 'on';
      config.features.todo = next;
      if (next === 'off') {
        registry.unregister('todo');
      } else if (!registry.has('todo')) {
        registry.register(createTodoTool(todoStore));
      }
      dispatch({ type: 'ADD_USER_MESSAGE', text: input });
      dispatch({ type: 'START_ASSISTANT' });
      dispatch({ type: 'APPEND_CONTENT', text: `Todo 计划功能已${next === 'on' ? '开启' : '关闭'}` });
      dispatch({ type: 'FINISH_STREAMING' });
      break;
    }

    case '/info':
      dispatch({ type: 'ADD_USER_MESSAGE', text: input });
      dispatch({ type: 'START_ASSISTANT' });
      dispatch({
        type: 'APPEND_CONTENT',
        text: `模型: ${config.model}\nAgent 模式: ${config.agent_mode}\n协作模式: ${config.collaboration}\n基础 URL: ${config.base_url}`,
      });
      dispatch({ type: 'FINISH_STREAMING' });
      break;

    default:
      dispatch({ type: 'ADD_USER_MESSAGE', text: input });
      dispatch({ type: 'START_ASSISTANT' });
      dispatch({
        type: 'APPEND_CONTENT',
        text: `未知命令: ${command}。输入 /help 查看帮助。`,
      });
      dispatch({ type: 'FINISH_STREAMING' });
      break;
  }
}
