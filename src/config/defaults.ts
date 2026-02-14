import type { ZenCodeConfig } from './types.js';

export const DEFAULT_CONFIG: ZenCodeConfig = {
  model: 'deepseek-chat',
  api_key: '',
  base_url: 'https://api.deepseek.com/v1',
  temperature: 0.7,
  max_tokens: 8192,

  agent_mode: 'dual',
  collaboration: 'delegated',

  dual_agent: {},

  features: {
    git: 'auto',
    mcp: 'off',
    planning_layer: 'on',
    parallel_agents: 'on',
    todo: 'on',
  },

  permissions: {
    auto_approve: ['read-file', 'glob', 'grep', 'spawn-agents', 'todo', 'memo'],
    require_approval: ['write-file', 'edit-file', 'bash', 'git'],
  },

  mcp_servers: [],
  prompts: [],
  max_tool_output: 30000,
};
