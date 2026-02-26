import type { Tool, ToolResult } from './types.js';
import type { LLMClient } from '../llm/client.js';
import type { ToolRegistry } from './registry.js';
import type { ZenCodeConfig } from '../config/types.js';
import type { SubAgentTracker } from '../core/sub-agent-tracker.js';
import { SubAgent } from '../core/sub-agent.js';

interface TaskInput {
  description: string;
  tools?: string[];
}

const DEFAULT_TOOLS = ['read-file', 'glob', 'grep'];
const MAX_CONCURRENT = 10;
const MAX_TURNS_LIMIT = 15;

/**
 * 创建 spawn-agents 工具 - 并行启动多个子 Agent
 */
export function createSpawnAgentsTool(
  client: LLMClient,
  registry: ToolRegistry,
  config: ZenCodeConfig,
  tracker?: SubAgentTracker,
): Tool {
  return {
    name: 'spawn-agents',
    description:
      '并行启动多个子 Agent 执行任务。每个子 Agent 有独立对话，默认只能用只读工具 (read-file, glob, grep)。适用于同时读取和分析多个文件、搜索多个模式等场景。',
    parameters: {
      type: 'object',
      properties: {
        tasks: {
          type: 'array',
          description: '要并行执行的任务列表',
          items: {
            type: 'object',
            properties: {
              description: {
                type: 'string',
                description: '任务描述',
              },
              tools: {
                type: 'array',
                description:
                  '允许使用的工具列表（默认 read-file, glob, grep），不可包含 spawn-agents',
                items: { type: 'string' },
              },
            },
            required: ['description'],
          },
        },
        max_turns: {
          type: 'number',
          description: '每个子 Agent 的最大轮数（默认 10，上限 15）',
        },
      },
      required: ['tasks'],
    },
    permissionLevel: 'auto',

    async execute(params: Record<string, unknown>): Promise<ToolResult> {
      const tasks = params['tasks'] as TaskInput[];
      const maxTurns = Math.min(
        (params['max_turns'] as number) || 10,
        MAX_TURNS_LIMIT,
      );

      if (!tasks || tasks.length === 0) {
        return { content: '错误：未提供任务' };
      }

      if (tasks.length > MAX_CONCURRENT) {
        return { content: `错误：最多支持 ${MAX_CONCURRENT} 个并发任务` };
      }

      // 获取 auto 权限的工具列表
      const autoTools = registry
        .listTools()
        .filter((t) => registry.getPermissionLevel(t) === 'auto' && t !== 'spawn-agents');

      const descriptions = tasks.map((t) => t.description);

      // 通知 tracker 开始
      tracker?.start(descriptions);

      const agents = tasks.map((task) => {
        // 取请求工具与 auto 工具的交集，排除 spawn-agents
        let tools = task.tools
          ? task.tools
              .filter((t) => t !== 'spawn-agents')
              .filter((t) => autoTools.includes(t))
          : DEFAULT_TOOLS.filter((t) => autoTools.includes(t));

        if (tools.length === 0) {
          tools = DEFAULT_TOOLS.filter((t) => autoTools.includes(t));
        }

        return new SubAgent(client, registry, config, task.description, tools, maxTurns);
      });

      // 包装每个 agent 的 run，追踪完成/失败
      const wrappedRuns = agents.map((agent) =>
        agent.run().then(
          (result) => { tracker?.markCompleted(); return result; },
          (err) => { tracker?.markFailed(); throw err; },
        ),
      );

      const results = await Promise.allSettled(wrappedRuns);

      // 通知 tracker 结束
      tracker?.finish();

      const succeeded = results.filter((r) => r.status === 'fulfilled').length;
      const failed = results.filter((r) => r.status === 'rejected').length;

      const output = results
        .map((result, i) => {
          const task = tasks[i]!;
          const status = result.status === 'fulfilled' ? '✓' : '✗';
          const header = `=== ${status} 任务 ${i + 1}: ${task.description} ===`;
          if (result.status === 'fulfilled') {
            return `${header}\n${result.value}`;
          }
          return `${header}\n错误: ${result.reason}`;
        })
        .join('\n\n');

      const summary = `[${succeeded} 成功${failed > 0 ? `, ${failed} 失败` : ''}]`;

      return { content: `${summary}\n\n${output}` };
    },
  };
}
