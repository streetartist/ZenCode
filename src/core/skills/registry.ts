import type { Skill } from './types.js';

/**
 * Skill 注册表 - 管理用户可调用的技能
 */
export class SkillRegistry {
  private skills = new Map<string, Skill>();

  register(skill: Skill): void {
    this.skills.set(skill.name, skill);
  }

  get(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  has(name: string): boolean {
    return this.skills.has(name);
  }

  list(): Skill[] {
    return [...this.skills.values()];
  }

  listNames(): string[] {
    return [...this.skills.keys()];
  }

  /**
   * 展开 skill 的 prompt 模板，替换 $ARGS 为用户参数
   */
  expandPrompt(skill: Skill, args: string): string {
    if (args && skill.prompt.includes('$ARGS')) {
      return skill.prompt.replace(/\$ARGS/g, args);
    }
    // 没有 $ARGS 占位符时，将用户参数追加到末尾
    if (args) {
      return `${skill.prompt}\n\n用户补充: ${args}`;
    }
    return skill.prompt;
  }
}
