// 配置类型定义

export interface ModelConfig {
  model: string;
  api_key?: string;
  base_url?: string;
  temperature?: number;
  max_tokens?: number;
}

export interface DualAgentConfig {
  orchestrator?: Partial<ModelConfig>;
  coder?: Partial<ModelConfig>;
}

export interface FeaturesConfig {
  git: 'auto' | 'on' | 'off';
  mcp: 'on' | 'off';
  planning_layer: 'on' | 'off';
  parallel_agents: 'on' | 'off';
  todo: 'on' | 'off';
}

export interface PermissionsConfig {
  auto_approve: string[];
  require_approval: string[];
}

export interface McpServerConfig {
  name: string;
  command: string;
  args?: string[];
}

export type AgentMode = 'dual' | 'single';
export type CollaborationMode = 'delegated' | 'autonomous' | 'controlled';

export interface ZenCodeConfig {
  // 默认模型配置
  model: string;
  api_key: string;
  base_url: string;
  temperature: number;
  max_tokens: number;

  // Agent 模式
  agent_mode: AgentMode;
  collaboration: CollaborationMode;

  // 双 Agent 配置
  dual_agent: DualAgentConfig;

  // 功能开关
  features: FeaturesConfig;

  // 权限
  permissions: PermissionsConfig;

  // MCP
  mcp_servers: McpServerConfig[];

  // 自定义提示词
  prompts: string[];

  // 工具输出最大长度
  max_tool_output: number;
}
