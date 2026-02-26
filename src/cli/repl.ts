import * as readline from 'node:readline';
import type { ZenCodeConfig } from '../config/types.js';
import { createLLMClient, type LLMClient } from '../llm/client.js';
import { ToolRegistry } from '../tools/registry.js';
import { Agent, type AgentCallbacks } from '../core/agent.js';
import { buildPrompt } from '../core/prompt/builder.js';
import { registerCoreTools } from '../tools/register.js';
import { setConfirmHandler } from '../tools/permission.js';
import { TodoStore } from '../core/todo-store.js';
import { SubAgentConfigRegistry } from '../core/sub-agents/registry.js';
import { loadAllAgentConfigs } from '../core/sub-agents/loader.js';
import { SkillRegistry } from '../core/skills/registry.js';
import { loadAllSkills } from '../core/skills/loader.js';
import { createSpawnAgentsTool } from '../tools/spawn-agents.js';
import { createTodoTool } from '../tools/todo.js';
import { createDispatchTool } from '../tools/dispatch.js';
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
    registry: ToolRegistry;
    client: LLMClient;
    todoStore: TodoStore;
    agentRegistry: SubAgentConfigRegistry;
    skillRegistry: SkillRegistry;
  },
): boolean | 'clear' {
  const parts = input.trim().split(/\s+/);
  const command = parts[0];

  switch (command) {
    case '/help':
      console.log(`
可用命令:
  /help                显示此帮助信息
  /skills              列出所有可用技能（用户自定义斜杠命令）
  /agents              列出所有可用子 Agent
  /parallel            切换并行子 Agent 功能 on/off
  /todo                切换 todo 计划功能 on/off
  /clear               清空对话历史
  /info                显示当前配置
  /exit                退出
`);
      return true;

    case '/skills': {
      const skills = context.skillRegistry.list();
      if (skills.length === 0) {
        printInfo('暂无可用技能。在 ~/.zencode/skills/ 或 .zencode/skills/ 中添加 YAML 文件定义技能。');
      } else {
        printInfo(`可用技能 (${skills.length}):`);
        for (const s of skills) {
          printInfo(`  /${s.name}: ${s.description}`);
        }
      }
      return true;
    }

    case '/agents': {
      const agents = context.agentRegistry.list();
      if (agents.length === 0) {
        printInfo('暂无可用子 Agent');
      } else {
        printInfo(`可用子 Agent (${agents.length}):`);
        for (const a of agents) {
          printInfo(`  ${a.name}: ${a.description}`);
        }
      }
      return true;
    }

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
          createSpawnAgentsTool(context.client, context.registry, context.config),
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
      printInfo(`基础 URL: ${context.config.base_url}`);
      printInfo(`子 Agent: ${context.agentRegistry.listNames().join(', ') || '无'}`);
      printInfo(`技能: ${context.skillRegistry.listNames().join(', ') || '无'}`);
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

  // Load sub-agent configs (before buildPrompt so agents layer can be included)
  const agentRegistry = new SubAgentConfigRegistry();
  for (const agentConfig of loadAllAgentConfigs()) {
    agentRegistry.register(agentConfig);
  }

  // 构建提示词
  const { systemPrompt } = await buildPrompt(config, agentRegistry.list());

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
  if (config.features.parallel_agents === 'on') {
    registry.register(createSpawnAgentsTool(client, registry, config));
  }
  if (config.features.todo === 'on') {
    registry.register(createTodoTool(todoStore));
  }

  // Load skills
  const skillRegistry = new SkillRegistry();
  for (const skill of loadAllSkills()) {
    skillRegistry.register(skill);
  }

  // Register dispatch tool (sub-agent system)
  registry.register(createDispatchTool(client, registry, config, agentRegistry));

  // 创建 Agent
  let agent = new Agent(client, registry, config, systemPrompt);

  // 打印欢迎信息
  printWelcome(config.model);

  // 创建 readline 接口
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '> ',
    historySize: 100,
  });

  // 注入确认处理函数
  setConfirmHandler(async (promptText: string): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
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
      // 先检查是否是用户定义的 skill
      const slashParts = input.slice(1).split(/\s+/);
      const skillName = slashParts[0] ?? '';
      const skillArgs = slashParts.slice(1).join(' ');
      const skill = skillRegistry.get(skillName);

      if (skill) {
        // 展开 skill prompt 并发送给主 Agent
        const expandedPrompt = skillRegistry.expandPrompt(skill, skillArgs);
        rl.pause();

        let isStreaming = false;
        const thinkFilter = createThinkFilter();
        const callbacks: AgentCallbacks = {
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
          onError: (err) => {
            if (isStreaming) {
              process.stdout.write('\n');
              isStreaming = false;
            }
            printError(err.message);
          },
        };

        try {
          await agent.run(expandedPrompt, callbacks);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          printError(msg);
        }

        if (isStreaming) {
          process.stdout.write('\n');
        }
        console.log();
        rl.resume();
        rl.prompt();
        return;
      }

      // 内置斜杠命令
      const handled = handleSlashCommand(input, {
        config,
        registry,
        client,
        todoStore,
        agentRegistry,
        skillRegistry,
      });
      if (handled === 'clear') {
        // 重建 Agent，清空对话历史
        agent = new Agent(client, registry, config, systemPrompt);
        rl.prompt();
        return;
      }
      if (handled) {
        rl.prompt();
        return;
      }
    }

    // 暂停 REPL readline，防止和确认弹窗抢 stdin
    rl.pause();

    // 构建回调
    let isStreaming = false;
    const thinkFilter = createThinkFilter();
    const callbacks: AgentCallbacks = {
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
      onError: (err) => {
        if (isStreaming) {
          process.stdout.write('\n');
          isStreaming = false;
        }
        printError(err.message);
      },
    };

    try {
      await agent.run(input, callbacks);
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
