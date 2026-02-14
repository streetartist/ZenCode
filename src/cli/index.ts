import { Command } from 'commander';
import type { CliOptions } from '../config/loader.js';
import { loadConfig } from '../config/loader.js';
import { createLLMClient } from '../llm/client.js';
import { ToolRegistry } from '../tools/registry.js';
import { registerCoreTools } from '../tools/register.js';
import { Agent, type AgentCallbacks } from '../core/agent.js';
import { Orchestrator, type OrchestratorCallbacks } from '../core/dual-agent/orchestrator.js';
import { buildPrompt } from '../core/prompt/builder.js';
import { startRepl } from './repl.js';
import { TodoStore } from '../core/todo-store.js';
import { MemoStore } from '../core/memo-store.js';
import { createSpawnAgentsTool } from '../tools/spawn-agents.js';
import { createTodoTool } from '../tools/todo.js';
import { createMemoTool } from '../tools/memo.js';
import { createThinkFilter } from './tui/bridge.js';
import { printStream, printToolCall, printToolResult, printError, printInfo } from './ui.js';

export { registerCoreTools };

/**
 * 单次执行模式（非交互式）
 */
async function runOnce(prompt: string, config: ReturnType<typeof loadConfig>): Promise<void> {
  const { systemPrompt } = await buildPrompt(config);
  const registry = new ToolRegistry();
  registerCoreTools(registry);
  registry.setPermissions(config.permissions);

  const client = createLLMClient({
    apiKey: config.api_key,
    baseURL: config.base_url,
    model: config.model,
    temperature: config.temperature,
    maxTokens: config.max_tokens,
  });

  // Register new tools based on feature flags
  const todoStore = new TodoStore();
  const memoStore = new MemoStore();
  if (config.features.parallel_agents === 'on') {
    registry.register(createSpawnAgentsTool(client, registry, config, undefined, memoStore));
  }
  if (config.features.todo === 'on') {
    registry.register(createTodoTool(todoStore));
  }
  registry.register(createMemoTool(memoStore));

  let isStreaming = false;
  const thinkFilter = createThinkFilter();
  const callbacks: AgentCallbacks & OrchestratorCallbacks = {
    onContent: (text) => {
      const filtered = thinkFilter(text);
      if (!filtered) return;
      if (!isStreaming) {
        isStreaming = true;
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
      printError(err.message);
    },
  };

  try {
    if (config.agent_mode === 'single') {
      const agent = new Agent(client, registry, config, systemPrompt, undefined, memoStore);
      await agent.run(prompt, callbacks);
    } else {
      const orchestrator = new Orchestrator(registry, config, systemPrompt, memoStore);
      await orchestrator.run(prompt, callbacks);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    printError(msg);
    process.exit(1);
  }

  if (isStreaming) {
    process.stdout.write('\n');
  }
}

/**
 * 创建 CLI 程序
 */
export function createCli(): Command {
  const program = new Command();

  program
    .name('zencode')
    .description('极简 CLI AI 编程工具')
    .version('0.2.1')
    .option('-m, --model <model>', '指定模型名称')
    .option('-k, --api-key <key>', 'API 密钥')
    .option('-u, --base-url <url>', 'API 基础 URL')
    .option('--single', '使用单 Agent 模式')
    .option('--dual', '使用双 Agent 模式')
    .option('--mode <mode>', '协作模式 (delegated/autonomous/controlled)')
    .option('--simple', '使用简单 REPL 模式（非全屏 TUI）')
    .argument('[prompt...]', '直接执行的提示词（非交互式）')
    .action(async (promptParts: string[], opts: CliOptions & { simple?: boolean }) => {
      const config = loadConfig(opts);

      // 验证 API key
      if (!config.api_key) {
        printError('未设置 API 密钥。请通过以下方式之一设置：');
        printError('  1. 环境变量 ZENCODE_API_KEY');
        printError('  2. 配置文件 ~/.zencode/config.yaml 中设置 api_key');
        printError('  3. CLI 参数 --api-key');
        process.exit(1);
      }

      const prompt = promptParts.join(' ');

      if (prompt) {
        // 单次执行模式
        await runOnce(prompt, config);
      } else if (opts.simple) {
        // 简单 REPL 模式（旧版）
        await startRepl({ config });
      } else {
        // 全屏 TUI 模式（默认）
        const { startTui } = await import('./tui/index.js');
        await startTui({ config });
      }
    });

  return program;
}
