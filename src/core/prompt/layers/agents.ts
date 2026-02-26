import type { SubAgentConfig } from '../../sub-agents/types.js';

/**
 * Layer - 子 Agent 提示词层
 *
 * 当有可用子 Agent 时注入，告诉模型何时使用 dispatch。
 */
export function buildAgentsPrompt(agents: SubAgentConfig[]): string | null {
  if (agents.length === 0) return null;

  const agentList = agents
    .map(a => `- **${a.name}**：${a.description}`)
    .join('\n');

  return `# 子 Agent

你可以通过 dispatch 工具调度以下专用子 Agent：

${agentList}

使用场景：当任务需要专业角色（如代码审查、架构分析）且子 Agent 的能力比你直接做更合适时，使用 dispatch 委派。`;
}
