import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { parse as parseYaml } from 'yaml';
import type { SubAgentConfig } from './types.js';
import { presetAgents } from './presets.js';

/**
 * 从 YAML 文件加载单个子 Agent 配置
 */
function loadAgentYaml(filePath: string): SubAgentConfig | null {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const parsed = parseYaml(content) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') return null;
    if (!parsed['name'] || !parsed['prompt'] || !parsed['tools']) return null;

    return {
      name: parsed['name'] as string,
      description: (parsed['description'] as string) || '',
      prompt: parsed['prompt'] as string,
      tools: parsed['tools'] as string[],
      max_turns: parsed['max_turns'] as number | undefined,
      timeout: parsed['timeout'] as number | undefined,
      model: parsed['model'] as SubAgentConfig['model'],
    };
  } catch {
    return null;
  }
}

/**
 * 从目录加载所有 YAML 子 Agent 配置
 */
function loadAgentsFromDir(dir: string): SubAgentConfig[] {
  try {
    if (!fs.existsSync(dir)) return [];
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));
    const agents: SubAgentConfig[] = [];
    for (const file of files) {
      const agent = loadAgentYaml(path.join(dir, file));
      if (agent) agents.push(agent);
    }
    return agents;
  } catch {
    return [];
  }
}

/**
 * 加载所有子 Agent 配置（按优先级低→高合并）
 *
 * 1. 内置预设（代码中）
 * 2. 全局用户目录：~/.zencode/agents/*.yaml
 * 3. 项目目录：.zencode/agents/*.yaml
 *
 * 同名配置高优先级覆盖低优先级
 */
export function loadAllAgentConfigs(): SubAgentConfig[] {
  const configMap = new Map<string, SubAgentConfig>();

  // 1. 内置预置（最低优先级）
  for (const agent of presetAgents) {
    configMap.set(agent.name, agent);
  }

  // 2. 全局用户目录：~/.zencode/agents/*.yaml
  const globalDir = path.join(os.homedir(), '.zencode', 'agents');
  for (const agent of loadAgentsFromDir(globalDir)) {
    configMap.set(agent.name, agent);
  }

  // 3. 项目目录：.zencode/agents/*.yaml（最高优先级）
  const projectDir = path.resolve('.zencode', 'agents');
  for (const agent of loadAgentsFromDir(projectDir)) {
    configMap.set(agent.name, agent);
  }

  return [...configMap.values()];
}
