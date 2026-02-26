import React from 'react';
import { render } from 'ink';
import type { ZenCodeConfig } from '../../config/types.js';
import { createLLMClient } from '../../llm/client.js';
import { ToolRegistry } from '../../tools/registry.js';
import { registerCoreTools } from '../../tools/register.js';
import { Agent } from '../../core/agent.js';
import { buildPrompt } from '../../core/prompt/builder.js';
import { TodoStore } from '../../core/todo-store.js';
import { SubAgentTracker } from '../../core/sub-agent-tracker.js';
import { SubAgentConfigRegistry } from '../../core/sub-agents/registry.js';
import { loadAllAgentConfigs } from '../../core/sub-agents/loader.js';
import { SkillRegistry } from '../../core/skills/registry.js';
import { loadAllSkills } from '../../core/skills/loader.js';
import { createSpawnAgentsTool } from '../../tools/spawn-agents.js';
import { createTodoTool } from '../../tools/todo.js';
import { createDispatchTool } from '../../tools/dispatch.js';
import { App } from './App.js';

interface TuiOptions {
  config: ZenCodeConfig;
}

/**
 * Start the full-screen TUI using Ink (React for CLI)
 */
export async function startTui(options: TuiOptions): Promise<void> {
  const { config } = options;

  // Load sub-agent configs (before buildPrompt so agents layer can be included)
  const agentRegistry = new SubAgentConfigRegistry();
  for (const agentConfig of loadAllAgentConfigs()) {
    agentRegistry.register(agentConfig);
  }

  // Build system prompt
  const { systemPrompt } = await buildPrompt(config, agentRegistry.list());

  // Register tools
  const registry = new ToolRegistry();
  registerCoreTools(registry);
  registry.setPermissions(config.permissions);

  // Create LLM client
  const client = createLLMClient({
    apiKey: config.api_key,
    baseURL: config.base_url,
    model: config.model,
    temperature: config.temperature,
    maxTokens: config.max_tokens,
  });

  // Create stores
  const todoStore = new TodoStore();
  const subAgentTracker = new SubAgentTracker();

  // Load skills
  const skillRegistry = new SkillRegistry();
  for (const skill of loadAllSkills()) {
    skillRegistry.register(skill);
  }

  // Register tools based on feature flags
  if (config.features.parallel_agents === 'on') {
    registry.register(createSpawnAgentsTool(client, registry, config, subAgentTracker));
  }
  if (config.features.todo === 'on') {
    registry.register(createTodoTool(todoStore));
  }
  // Register dispatch tool (sub-agent system)
  registry.register(createDispatchTool(client, registry, config, agentRegistry, subAgentTracker));

  // Create agent
  const agent = new Agent(client, registry, config, systemPrompt);

  // Render the full-screen TUI
  const { waitUntilExit } = render(
    <App
      config={config}
      client={client}
      agent={agent}
      registry={registry}
      todoStore={todoStore}
      subAgentTracker={subAgentTracker}
      agentRegistry={agentRegistry}
      skillRegistry={skillRegistry}
    />,
    {
      patchConsole: true,
      exitOnCtrlC: false,
    },
  );

  await waitUntilExit();
}
