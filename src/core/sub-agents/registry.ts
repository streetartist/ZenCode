import type { SubAgentConfig } from './types.js';

/**
 * 子 Agent 配置注册表
 */
export class SubAgentConfigRegistry {
  private configs = new Map<string, SubAgentConfig>();

  register(config: SubAgentConfig): void {
    this.configs.set(config.name, config);
  }

  get(name: string): SubAgentConfig | undefined {
    return this.configs.get(name);
  }

  has(name: string): boolean {
    return this.configs.has(name);
  }

  list(): SubAgentConfig[] {
    return [...this.configs.values()];
  }

  listNames(): string[] {
    return [...this.configs.keys()];
  }

  /**
   * 生成子 Agent 列表描述（用于 dispatch 工具的说明）
   */
  buildAgentListDescription(): string {
    if (this.configs.size === 0) return '暂无可用子 Agent';
    return [...this.configs.values()]
      .map(s => `- ${s.name}: ${s.description}`)
      .join('\n');
  }
}
