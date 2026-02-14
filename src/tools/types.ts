// 工具接口定义

export interface ToolResult {
  content: string;
  truncated?: boolean;
}

export type PermissionLevel = 'auto' | 'confirm' | 'deny';

export interface ToolParameter {
  type: string;
  description: string;
  required?: boolean;
  enum?: string[];
  default?: unknown;
}

export interface ToolSchema {
  type: 'object';
  properties: Record<string, ToolParameter | Record<string, unknown>>;
  required?: string[];
}

export interface Tool {
  name: string;
  description: string;
  parameters: ToolSchema;
  permissionLevel: PermissionLevel;
  execute(params: Record<string, unknown>): Promise<ToolResult>;
}
