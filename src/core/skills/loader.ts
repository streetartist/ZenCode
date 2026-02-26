import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { parse as parseYaml } from 'yaml';
import type { Skill } from './types.js';

/**
 * 从 YAML 文件加载单个 Skill
 */
function loadSkillYaml(filePath: string): Skill | null {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const parsed = parseYaml(content) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') return null;
    if (!parsed['name'] || !parsed['prompt']) return null;

    return {
      name: parsed['name'] as string,
      description: (parsed['description'] as string) || '',
      prompt: parsed['prompt'] as string,
    };
  } catch {
    return null;
  }
}

/**
 * 从目录加载所有 YAML Skill 文件
 */
function loadSkillsFromDir(dir: string): Skill[] {
  try {
    if (!fs.existsSync(dir)) return [];
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));
    const skills: Skill[] = [];
    for (const file of files) {
      const skill = loadSkillYaml(path.join(dir, file));
      if (skill) skills.push(skill);
    }
    return skills;
  } catch {
    return [];
  }
}

/**
 * 加载所有 Skill（按优先级低→高合并）
 *
 * 1. 全局用户目录：~/.zencode/skills/*.yaml
 * 2. 项目目录：.zencode/skills/*.yaml
 *
 * 同名 skill 高优先级覆盖低优先级
 */
export function loadAllSkills(): Skill[] {
  const skillMap = new Map<string, Skill>();

  // 1. 全局用户目录
  const globalDir = path.join(os.homedir(), '.zencode', 'skills');
  for (const skill of loadSkillsFromDir(globalDir)) {
    skillMap.set(skill.name, skill);
  }

  // 2. 项目目录
  const projectDir = path.resolve('.zencode', 'skills');
  for (const skill of loadSkillsFromDir(projectDir)) {
    skillMap.set(skill.name, skill);
  }

  return [...skillMap.values()];
}
