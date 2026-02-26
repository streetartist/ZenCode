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
import { Header } from './components/Header.js';

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
  const [, setWidth] = useState(stdout.columns);

  useEffect(() => {
    const onResize = () => {
      setWidth(stdout.columns);
    };
    stdout.on('resize', onResize);
    return () => { stdout.off('resize', onResize); };
  }, [stdout]);

  const [state, dispatch] = useReducer(
    tuiReducer,
    createInitialState(config.model),
  );

  // Reset counter: forces full re-mount when /clear is used
  const [resetKey, setResetKey] = useState(0);
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
      if (state.isRunning) {
        agentRef.current.interrupt();
        currentCallbacksRef.current?._stopBatcher?.();
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
    <Box key={resetKey} flexDirection="column" paddingX={0} width="100%">
      <Box paddingX={1} flexDirection="column">
        <Header modelName={state.modelName} />
        <ChatArea messages={state.messages} />
      </Box>

      {state.error && (
        <Box borderStyle="round" borderColor="#fb4934" paddingX={1} marginBottom={1}>
          <Text color="#fb4934" bold>ERROR: </Text>
          <Text color="#fb4934">{state.error}</Text>
        </Box>
      )}

      {confirmPending && (
        <ConfirmPrompt confirm={confirmPending} onRespond={handleConfirmResponse} />
      )}

      {state.todoPlan && <TodoPanel plan={state.todoPlan} />}

      <Box marginTop={1}>
        <InputArea
          onSubmit={handleSubmit}
          isRunning={state.isRunning || !!confirmPending}
          onExitRequest={() => process.exit(0)}
        />
      </Box>

      <Box marginTop={0}>
        <StatusBar
          isRunning={state.isRunning}
          modelName={state.modelName}
          todoPlan={state.todoPlan}
          subAgentProgress={state.subAgentProgress}
        />
      </Box>
    </Box>
  );
}

// --- Slash commands ---
interface SlashCommandContext {
  config: ZenCodeConfig;
  agent: Agent;
  registry: ToolRegistry;
  dispatch: React.Dispatch<TuiAction>;
  setResetKey: React.Dispatch<React.SetStateAction<number>>;
  client: LLMClient;
  todoStore: TodoStore;
  subAgentTracker: SubAgentTracker;
  agentRegistry: SubAgentConfigRegistry;
  skillRegistry: SkillRegistry;
}

function handleSlashCommand(input: string, ctx: SlashCommandContext) {
  const { config, agent, registry, dispatch, setResetKey, client, todoStore, subAgentTracker, agentRegistry, skillRegistry } = ctx;
  const parts = input.trim().split(/\s+/);
  const command = parts[0];

  switch (command) {
    case '/help':
      dispatch({ type: 'ADD_USER_MESSAGE', text: input });
      dispatch({ type: 'START_ASSISTANT' });
      {
        let helpText = `可用命令:
  /help                显示此帮助信息
  /skills              列出所有可用技能
  /agents              列出所有可用子 Agent
  /parallel            切换并行子 Agent 功能 on/off
  /todo                切换 todo 计划功能 on/off
  /clear               清空对话历史
  /info                显示当前配置
  Ctrl+C               取消当前请求 / 退出
  Ctrl+D               退出`;
        const skills = skillRegistry.list();
        if (skills.length > 0) {
          helpText += `\n\n可用技能:\n${skills.map(s => `  /${s.name}  ${s.description}`).join('\n')}`;
        }
        dispatch({ type: 'APPEND_CONTENT', text: helpText });
      }
      dispatch({ type: 'FINISH_STREAMING' });
      break;

    case '/skills': {
      const skills = skillRegistry.list();
      dispatch({ type: 'ADD_USER_MESSAGE', text: input });
      dispatch({ type: 'START_ASSISTANT' });
      if (skills.length === 0) {
        dispatch({ type: 'APPEND_CONTENT', text: '暂无可用技能。在 ~/.zencode/skills/ 或 .zencode/skills/ 放置 YAML 文件添加技能。' });
      } else {
        const lines = skills.map(s => `  /${s.name}: ${s.description}`);
        dispatch({ type: 'APPEND_CONTENT', text: `可用技能 (${skills.length}):\n${lines.join('\n')}` });
      }
      dispatch({ type: 'FINISH_STREAMING' });
      break;
    }

    case '/agents': {
      const agents = agentRegistry.list();
      dispatch({ type: 'ADD_USER_MESSAGE', text: input });
      dispatch({ type: 'START_ASSISTANT' });
      if (agents.length === 0) {
        dispatch({ type: 'APPEND_CONTENT', text: '暂无可用子 Agent。' });
      } else {
        const lines = agents.map(a => `  ${a.name}: ${a.description} [tools: ${a.tools.join(', ')}]`);
        dispatch({ type: 'APPEND_CONTENT', text: `可用子 Agent (${agents.length}):\n${lines.join('\n')}` });
      }
      dispatch({ type: 'FINISH_STREAMING' });
      break;
    }

    case '/clear':
      agent.getConversation().clear();
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
        registry.register(createSpawnAgentsTool(client, registry, config, subAgentTracker));
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
        text: `模型: ${config.model}\n基础 URL: ${config.base_url}\n子 Agent: ${agentRegistry.listNames().join(', ') || '无'}\n技能: ${skillRegistry.listNames().map(n => '/' + n).join(', ') || '无'}`,
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
