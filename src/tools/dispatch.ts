import type { Tool, ToolResult } from './types.js';
import type { LLMClient } from '../llm/client.js';
import type { ToolRegistry } from './registry.js';
import type { ZenCodeConfig } from '../config/types.js';
import type { AgentCallbacks } from '../core/agent.js';
import type { SubAgentConfigRegistry } from '../core/sub-agents/registry.js';
import { SubAgentRunner } from '../core/sub-agents/runner.js';
import { createLLMClient } from '../llm/client.js';

/**
 * 创建 dispatch 工具 - 主 Agent 调度子 Agent 的入口
 */
export function createDispatchTool(
  defaultClient: LLMClient,
  toolRegistry: ToolRegistry,
  config: ZenCodeConfig,
  agentRegistry: SubAgentConfigRegistry,
  callbacks?: () => AgentCallbacks,
): Tool {
  return {
    name: 'dispatch',
    description: '调度子 Agent 执行专门任务。子 Agent 有独立对话和专属系统提示词，适用于需要专业角色的场景。',
    parameters: {
      type: 'object',
      properties: {
        agent: {
          type: 'string',
          description: `子 Agent 名称。可选: ${agentRegistry.listNames().join(', ')}`,
          enum: agentRegistry.listNames(),
        },
        task: {
          type: 'string',
          description: '要执行的具体任务描述',
        },
        context: {
          type: 'string',
          description: '可选的额外上下文信息（如参考文件路径、依赖关系等）',
        },
      },
      required: ['agent', 'task'],
    },
    permissionLevel: 'auto',

    async execute(params: Record<string, unknown>): Promise<ToolResult> {
      const agentName = params['agent'] as string;
      const task = params['task'] as string;
      const context = params['context'] as string | undefined;

      const agentConfig = agentRegistry.get(agentName);
      if (!agentConfig) {
        return { content: `错误：未找到子 Agent "${agentName}"。可用: ${agentRegistry.listNames().join(', ')}` };
      }

      // 决定使用的 LLM 客户端
      let client = defaultClient;
      if (agentConfig.model) {
        client = createLLMClient({
          apiKey: agentConfig.model.api_key || config.api_key,
          baseURL: agentConfig.model.base_url || config.base_url,
          model: agentConfig.model.model || config.model,
          temperature: config.temperature,
          maxTokens: config.max_tokens,
        });
      }

      const runner = new SubAgentRunner(client, toolRegistry, config, agentConfig);

      try {
        const result = await runner.execute(task, context, callbacks?.() ?? {});
        return { content: result || '（子 Agent 执行完成，无输出）' };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: `子 Agent 执行错误：${msg}` };
      }
    },
  };
}
