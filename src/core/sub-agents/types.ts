/**
 * 可配置子 Agent 类型定义
 */

export interface SubAgentModelConfig {
  model?: string;
  api_key?: string;
  base_url?: string;
}

export interface SubAgentConfig {
  name: string;           // 子 Agent 名
  description: string;    // 描述（显示在 dispatch 工具说明中）
  prompt: string;         // 子 Agent 的系统提示词
  tools: string[];        // 允许使用的工具名
  max_turns?: number;     // 最大轮数（默认 15）
  timeout?: number;       // 超时秒数（默认 120）
  model?: SubAgentModelConfig; // 可选的模型覆盖
}
