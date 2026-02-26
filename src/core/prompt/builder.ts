import * as fs from 'node:fs';
import type { ZenCodeConfig } from '../../config/types.js';
import type { SubAgentConfig } from '../sub-agents/types.js';
import { buildCorePrompt } from './layers/core.js';
import { buildPlanningPrompt } from './layers/planning.js';
import { buildParallelPrompt } from './layers/parallel.js';
import { buildGitPrompt } from './layers/git.js';
import { buildAgentsPrompt } from './layers/agents.js';
import { buildProjectPrompt, loadUserPrompts } from './layers/project.js';

export interface PromptBuildResult {
  systemPrompt: string;
  layers: string[];
}

/**
 * 检测当前目录是否为 git 仓库
 */
function isGitRepo(): boolean {
  try {
    fs.statSync('.git');
    return true;
  } catch {
    return false;
  }
}

/**
 * 分层提示词构建器 - 按需组装各层
 */
export async function buildPrompt(config: ZenCodeConfig, agents?: SubAgentConfig[]): Promise<PromptBuildResult> {
  const layers: string[] = [];

  // Layer 0: 核心层（始终加载）
  layers.push(buildCorePrompt());

  // Layer 1: 思考层（默认开启）
  if (config.features.planning_layer === 'on') {
    layers.push(buildPlanningPrompt());
  }

  // Layer 2: Git 层（自动检测或手动开启）
  const gitEnabled =
    config.features.git === 'on' ||
    (config.features.git === 'auto' && isGitRepo());
  if (gitEnabled) {
    layers.push(buildGitPrompt());
  }

  // Layer 3: 并行子 Agent 层
  if (config.features.parallel_agents === 'on') {
    layers.push(buildParallelPrompt());
  }

  // Layer 4: 子 Agent 层（有可用 agent 时加载）
  if (agents && agents.length > 0) {
    const agentsPrompt = buildAgentsPrompt(agents);
    if (agentsPrompt) {
      layers.push(agentsPrompt);
    }
  }

  // Layer 5: 项目层（ZENCODE.md）
  const projectPrompt = await buildProjectPrompt();
  if (projectPrompt) {
    layers.push(projectPrompt);
  }

  // Layer 6: 用户自定义提示词
  if (config.prompts.length > 0) {
    const userPrompts = await loadUserPrompts(config.prompts);
    layers.push(...userPrompts);
  }

  // 合并所有层
  const systemPrompt = layers.join('\n\n');

  return { systemPrompt, layers };
}

