import type { Tool, ToolResult } from './types.js';
import type { ToolDefinition } from '../llm/types.js';
import type { PermissionsConfig } from '../config/types.js';

export class ToolRegistry {
  private tools = new Map<string, Tool>();
  private permissionOverrides: PermissionsConfig | null = null;

  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  /**
   * 设置权限覆盖配置
   */
  setPermissions(permissions: PermissionsConfig): void {
    this.permissionOverrides = permissions;
  }

  /**
   * 运行时将某工具升级为自动批准（始终允许）
   */
  addAutoApprove(toolName: string): void {
    if (!this.permissionOverrides) {
      this.permissionOverrides = { auto_approve: [], require_approval: [] };
    }
    if (!this.permissionOverrides.auto_approve.includes(toolName)) {
      this.permissionOverrides.auto_approve.push(toolName);
    }
    // 从 require_approval 中移除
    this.permissionOverrides.require_approval =
      this.permissionOverrides.require_approval.filter((n) => n !== toolName);
  }

  /**
   * 获取工具的有效权限级别
   */
  getPermissionLevel(toolName: string): 'auto' | 'confirm' | 'deny' {
    if (this.permissionOverrides) {
      if (this.permissionOverrides.auto_approve.includes(toolName)) return 'auto';
      if (this.permissionOverrides.require_approval.includes(toolName)) return 'confirm';
    }
    const tool = this.tools.get(toolName);
    return tool?.permissionLevel ?? 'confirm';
  }

  /**
   * 执行工具调用
   */
  async execute(name: string, params: Record<string, unknown>, maxOutput: number): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return { content: `错误：未找到工具 "${name}"` };
    }

    try {
      const result = await tool.execute(params);

      // 截断过长的输出
      if (result.content.length > maxOutput) {
        return {
          content: result.content.slice(0, maxOutput) + '\n\n[输出已截断]',
          truncated: true,
        };
      }

      return result;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { content: `工具执行错误：${msg}` };
    }
  }

  /**
   * 导出为 OpenAI function calling 格式
   */
  toToolDefinitions(filter?: string[]): ToolDefinition[] {
    const tools: ToolDefinition[] = [];
    for (const [name, tool] of this.tools) {
      if (filter && !filter.includes(name)) continue;
      tools.push({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters as unknown as Record<string, unknown>,
        },
      });
    }
    return tools;
  }

  /**
   * 获取所有已注册的工具名
   */
  listTools(): string[] {
    return [...this.tools.keys()];
  }
}
