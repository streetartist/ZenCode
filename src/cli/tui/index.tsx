import React from 'react';
import { render } from 'ink';
import type { ZenCodeConfig } from '../../config/types.js';
import { createLLMClient } from '../../llm/client.js';
import { ToolRegistry } from '../../tools/registry.js';
import { registerCoreTools } from '../../tools/register.js';
import { Agent } from '../../core/agent.js';
import { Orchestrator } from '../../core/dual-agent/orchestrator.js';
import { buildPrompt } from '../../core/prompt/builder.js';
import { TodoStore } from '../../core/todo-store.js';
import { MemoStore } from '../../core/memo-store.js';
import { SubAgentTracker } from '../../core/sub-agent-tracker.js';
import { createSpawnAgentsTool } from '../../tools/spawn-agents.js';
import { createTodoTool } from '../../tools/todo.js';
import { createMemoTool } from '../../tools/memo.js';
import { App } from './App.js';

interface TuiOptions {
  config: ZenCodeConfig;
}

/**
 * Start the full-screen TUI using Ink (React for CLI)
 */
export async function startTui(options: TuiOptions): Promise<void> {
  const { config } = options;

  // Build system prompt
  const { systemPrompt } = await buildPrompt(config);

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
  const memoStore = new MemoStore();
  const subAgentTracker = new SubAgentTracker();

  // Register new tools based on feature flags
  if (config.features.parallel_agents === 'on') {
    registry.register(createSpawnAgentsTool(client, registry, config, subAgentTracker, memoStore));
  }
  if (config.features.todo === 'on') {
    registry.register(createTodoTool(todoStore));
  }
  registry.register(createMemoTool(memoStore));

  // Create both agents so /single and /dual switching works
  const agent = new Agent(client, registry, config, systemPrompt, undefined, memoStore);
  const orchestrator = new Orchestrator(registry, config, systemPrompt, memoStore);

  // Render the full-screen TUI
  const { waitUntilExit } = render(
    <App
      config={config}
      client={client}
      agent={agent}
      orchestrator={orchestrator}
      registry={registry}
      todoStore={todoStore}
      memoStore={memoStore}
      subAgentTracker={subAgentTracker}
    />,
    { patchConsole: true },
  );

  await waitUntilExit();
}
