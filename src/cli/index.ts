import { Command } from 'commander';
import type { CliOptions } from '../config/loader.js';
import { loadConfig } from '../config/loader.js';
import { createLLMClient } from '../llm/client.js';
import { ToolRegistry } from '../tools/registry.js';
import { registerCoreTools } from '../tools/register.js';
import { Agent, type AgentCallbacks } from '../core/agent.js';
import { buildPrompt } from '../core/prompt/builder.js';
import { startRepl } from './repl.js';
import { TodoStore } from '../core/todo-store.js';
import { SubAgentConfigRegistry } from '../core/sub-agents/registry.js';
import { loadAllAgentConfigs } from '../core/sub-agents/loader.js';
import { createSpawnAgentsTool } from '../tools/spawn-agents.js';
import { createTodoTool } from '../tools/todo.js';
import { createDispatchTool } from '../tools/dispatch.js';
import { createThinkFilter } from './tui/bridge.js';
import { printStream, printToolCall, printToolResult, printError, printInfo } from './ui.js';

export { registerCoreTools };

/**
 * 单次执行模式（非交互式）
 */
async function runOnce(prompt: string, config: ReturnType<typeof loadConfig>): Promise<void> {
  // Load sub-agent configs (before buildPrompt so agents layer can be included)
  const agentRegistry = new SubAgentConfigRegistry();
  for (const agentConfig of loadAllAgentConfigs()) {
    agentRegistry.register(agentConfig);
  }

  const { systemPrompt } = await buildPrompt(config, agentRegistry.list());
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

  // Register tools based on feature flags
  const todoStore = new TodoStore();
  if (config.features.parallel_agents === 'on') {
    registry.register(createSpawnAgentsTool(client, registry, config));
  }
  if (config.features.todo === 'on') {
    registry.register(createTodoTool(todoStore));
  }

  registry.register(createDispatchTool(client, registry, config, agentRegistry));

  let isStreaming = false;
  const thinkFilter = createThinkFilter();
  const callbacks: AgentCallbacks = {
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
    onError: (err) => {
      printError(err.message);
    },
  };

  try {
    const agent = new Agent(client, registry, config, systemPrompt);
    await agent.run(prompt, callbacks);
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
    .version('0.4.1')
    .option('-m, --model <model>', '指定模型名称')
    .option('-k, --api-key <key>', 'API 密钥')
    .option('-u, --base-url <url>', 'API 基础 URL')
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
        // Clear terminal for a clean start
        process.stdout.write('\x1Bc');
        await startTui({ config });
      }
    });

  return program;
}
