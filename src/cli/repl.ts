import * as readline from 'node:readline';
import type { ZenCodeConfig, CollaborationMode } from '../config/types.js';
import { createLLMClient, type LLMClient } from '../llm/client.js';
import { ToolRegistry } from '../tools/registry.js';
import { Agent, type AgentCallbacks } from '../core/agent.js';
import { Orchestrator, type OrchestratorCallbacks } from '../core/dual-agent/orchestrator.js';
import { buildPrompt } from '../core/prompt/builder.js';
import { registerCoreTools } from '../tools/register.js';
import { setConfirmHandler } from '../tools/permission.js';
import { TodoStore } from '../core/todo-store.js';
import { MemoStore } from '../core/memo-store.js';
import { createSpawnAgentsTool } from '../tools/spawn-agents.js';
import { createTodoTool } from '../tools/todo.js';
import { createMemoTool } from '../tools/memo.js';
import { createThinkFilter } from './tui/bridge.js';
import {
  printWelcome,
  printStream,
  printToolCall,
  printToolResult,
  printError,
  printInfo,
  printSuccess,
  printWarning,
} from './ui.js';

interface ReplOptions {
  config: ZenCodeConfig;
}

/**
 * 处理斜杠命令
 */
function handleSlashCommand(
  input: string,
  context: {
    config: ZenCodeConfig;
    orchestrator?: Orchestrator;
    registry: ToolRegistry;
    client: LLMClient;
    todoStore: TodoStore;
    memoStore: MemoStore;
    setMode?: (mode: CollaborationMode) => void;
  },
): boolean | 'clear' {
  const parts = input.trim().split(/\s+/);
  const command = parts[0];

  switch (command) {
    case '/help':
      console.log(`
可用命令:
  /help                显示此帮助信息
  /mode [模式]         切换协作模式 (delegated/autonomous/controlled)
  /single              切换到单 Agent 模式
  /dual                切换到双 Agent 模式
  /parallel            切换并行子 Agent 功能 on/off
  /todo                切换 todo 计划功能 on/off
  /clear               清空对话历史
  /info                显示当前配置
  /exit                退出
`);
      return true;

    case '/mode': {
      const mode = parts[1];
      if (!mode) {
        printInfo(`当前协作模式: ${context.config.collaboration}`);
        printInfo('可选: delegated, autonomous, controlled');
        return true;
      }
      if (['delegated', 'autonomous', 'controlled'].includes(mode)) {
        context.config.collaboration = mode as CollaborationMode;
        context.setMode?.(mode as CollaborationMode);
        printSuccess(`已切换到 ${mode} 模式`);
      } else {
        printError(`无效模式: ${mode}。可选: delegated, autonomous, controlled`);
      }
      return true;
    }

    case '/single':
      context.config.agent_mode = 'single';
      printSuccess('已切换到单 Agent 模式');
      return true;

    case '/dual':
      context.config.agent_mode = 'dual';
      printSuccess('已切换到双 Agent 模式');
      return true;

    case '/clear':
      printSuccess('对话历史已清空');
      return 'clear';

    case '/parallel': {
      const current = context.config.features.parallel_agents;
      const next = current === 'on' ? 'off' : 'on';
      context.config.features.parallel_agents = next;
      if (next === 'off') {
        context.registry.unregister('spawn-agents');
      } else if (!context.registry.has('spawn-agents')) {
        context.registry.register(
          createSpawnAgentsTool(context.client, context.registry, context.config, undefined, context.memoStore),
        );
      }
      printSuccess(`并行子 Agent 功能已${next === 'on' ? '开启' : '关闭'}`);
      return true;
    }

    case '/todo': {
      const current = context.config.features.todo;
      const next = current === 'on' ? 'off' : 'on';
      context.config.features.todo = next;
      if (next === 'off') {
        context.registry.unregister('todo');
      } else if (!context.registry.has('todo')) {
        context.registry.register(createTodoTool(context.todoStore));
      }
      printSuccess(`Todo 计划功能已${next === 'on' ? '开启' : '关闭'}`);
      return true;
    }

    case '/info':
      printInfo(`模型: ${context.config.model}`);
      printInfo(`Agent 模式: ${context.config.agent_mode}`);
      printInfo(`协作模式: ${context.config.collaboration}`);
      printInfo(`基础 URL: ${context.config.base_url}`);
      return true;

    case '/exit':
      process.exit(0);

    default:
      printWarning(`未知命令: ${command}。输入 /help 查看帮助。`);
      return true;
  }
}

/**
 * 启动交互式 REPL
 */
export async function startRepl(options: ReplOptions): Promise<void> {
  const { config } = options;

  // 构建提示词
  const { systemPrompt } = await buildPrompt(config);

  // 注册工具
  const registry = new ToolRegistry();
  registerCoreTools(registry);
  registry.setPermissions(config.permissions);

  // 创建 LLM 客户端
  const client = createLLMClient({
    apiKey: config.api_key,
    baseURL: config.base_url,
    model: config.model,
    temperature: config.temperature,
    maxTokens: config.max_tokens,
  });

  // 创建 stores 并注册新工具
  const todoStore = new TodoStore();
  const memoStore = new MemoStore();
  if (config.features.parallel_agents === 'on') {
    registry.register(createSpawnAgentsTool(client, registry, config, undefined, memoStore));
  }
  if (config.features.todo === 'on') {
    registry.register(createTodoTool(todoStore));
  }
  registry.register(createMemoTool(memoStore));

  // 根据模式创建 Agent
  let singleAgent: Agent | undefined;
  let orchestrator: Orchestrator | undefined;

  if (config.agent_mode === 'single') {
    singleAgent = new Agent(client, registry, config, systemPrompt, undefined, memoStore);
  } else {
    orchestrator = new Orchestrator(registry, config, systemPrompt, memoStore);
  }

  // 打印欢迎信息
  const modeLabel = config.agent_mode === 'dual'
    ? `双Agent (${config.collaboration})`
    : '单Agent';
  printWelcome(config.model, modeLabel);

  // 创建 readline 接口
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '> ',
    historySize: 100,
  });

  // 注入确认处理函数：复用 REPL 的 readline
  // 先 pause REPL readline，用原始 stdin 读取，再 resume
  setConfirmHandler(async (promptText: string): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      // 直接用 process.stdout 输出提示，用 process.stdin 读取一行
      process.stdout.write(promptText);
      const onData = (data: Buffer) => {
        process.stdin.removeListener('data', onData);
        process.stdin.pause();
        const answer = data.toString().trim().toLowerCase();
        resolve(answer === 'y');
      };
      process.stdin.resume();
      process.stdin.once('data', onData);
    });
  });

  rl.prompt();

  rl.on('line', async (line) => {
    const input = line.trim();
    if (!input) {
      rl.prompt();
      return;
    }

    // 处理斜杠命令
    if (input.startsWith('/')) {
      const handled = handleSlashCommand(input, {
        config,
        orchestrator,
        registry,
        client,
        todoStore,
        memoStore,
        setMode: (mode) => {
          orchestrator?.setMode(mode);
        },
      });
      if (handled === 'clear') {
        // 重建 Agent，清空对话历史
        singleAgent = new Agent(client, registry, config, systemPrompt, undefined, memoStore);
        orchestrator = new Orchestrator(registry, config, systemPrompt, memoStore);
        memoStore.clear();
        rl.prompt();
        return;
      }
      if (handled) {
        rl.prompt();
        return;
      }
    }

    // 切换模式可能需要重新创建 agent
    if (config.agent_mode === 'single' && !singleAgent) {
      singleAgent = new Agent(client, registry, config, systemPrompt, undefined, memoStore);
      orchestrator = undefined;
    } else if (config.agent_mode === 'dual' && !orchestrator) {
      orchestrator = new Orchestrator(registry, config, systemPrompt, memoStore);
      singleAgent = undefined;
    }

    // 暂停 REPL readline，防止和确认弹窗抢 stdin
    rl.pause();

    // 构建回调
    let isStreaming = false;
    const thinkFilter = createThinkFilter();
    const callbacks: AgentCallbacks & OrchestratorCallbacks = {
      onContent: (text) => {
        const filtered = thinkFilter(text);
        if (!filtered) return;
        if (!isStreaming) {
          isStreaming = true;
          process.stdout.write('\n');
        }
        printStream(filtered);
      },
      onToolExecuting: (name, params) => {
        if (isStreaming) {
          process.stdout.write('\n');
          isStreaming = false;
        }
        printToolCall(name, params);
      },
      onToolResult: (name, result, truncated) => {
        printToolResult(name, result, truncated);
      },
      onCoderStart: () => {
        if (isStreaming) {
          process.stdout.write('\n');
          isStreaming = false;
        }
        printInfo('编码 Agent 开始工作...');
      },
      onCoderEnd: () => {
        printInfo('编码 Agent 完成');
      },
      onError: (err) => {
        if (isStreaming) {
          process.stdout.write('\n');
          isStreaming = false;
        }
        printError(err.message);
      },
    };

    try {
      if (config.agent_mode === 'single' && singleAgent) {
        await singleAgent.run(input, callbacks);
      } else if (orchestrator) {
        await orchestrator.run(input, callbacks);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      printError(msg);
    }

    if (isStreaming) {
      process.stdout.write('\n');
    }
    console.log(); // 空行分隔

    // 恢复 REPL readline
    rl.resume();
    rl.prompt();
  });

  rl.on('close', () => {
    console.log('\n再见！');
    process.exit(0);
  });
}
