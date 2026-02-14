import { describe, it, expect } from 'vitest';
import { ToolRegistry } from '../src/tools/registry.js';
import { getMode } from '../src/core/dual-agent/modes.js';

describe('Dual Agent Modes', () => {
  it('delegated mode should give coder full tools', () => {
    const mode = getMode('delegated');
    expect(mode.coderHasTools).toBe(true);
    expect(mode.coderToolNames).toEqual(['read-file', 'write-file', 'edit-file', 'bash', 'glob', 'grep', 'memo']);
    expect(mode.coderSystemPrompt).toBeTruthy();
  });

  it('autonomous mode should give coder tools', () => {
    const mode = getMode('autonomous');
    expect(mode.coderHasTools).toBe(true);
    expect(mode.coderToolNames).toBeDefined();
    expect(mode.coderToolNames!.length).toBeGreaterThan(0);
  });

  it('controlled mode should not give coder tools', () => {
    const mode = getMode('controlled');
    expect(mode.coderHasTools).toBe(false);
  });
});

describe('ToolRegistry', () => {
  it('should register and retrieve tools', () => {
    const registry = new ToolRegistry();
    registry.register({
      name: 'test-tool',
      description: 'test',
      parameters: { type: 'object', properties: {} },
      permissionLevel: 'auto',
      execute: async () => ({ content: 'ok' }),
    });

    expect(registry.has('test-tool')).toBe(true);
    expect(registry.get('test-tool')?.name).toBe('test-tool');
  });

  it('should export tool definitions', () => {
    const registry = new ToolRegistry();
    registry.register({
      name: 'my-tool',
      description: 'desc',
      parameters: { type: 'object', properties: { a: { type: 'string', description: 'arg' } } },
      permissionLevel: 'auto',
      execute: async () => ({ content: 'ok' }),
    });

    const defs = registry.toToolDefinitions();
    expect(defs).toHaveLength(1);
    expect(defs[0]!.function.name).toBe('my-tool');
    expect(defs[0]!.type).toBe('function');
  });

  it('should filter tool definitions', () => {
    const registry = new ToolRegistry();
    registry.register({
      name: 'tool-a',
      description: 'a',
      parameters: { type: 'object', properties: {} },
      permissionLevel: 'auto',
      execute: async () => ({ content: '' }),
    });
    registry.register({
      name: 'tool-b',
      description: 'b',
      parameters: { type: 'object', properties: {} },
      permissionLevel: 'auto',
      execute: async () => ({ content: '' }),
    });

    const filtered = registry.toToolDefinitions(['tool-a']);
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.function.name).toBe('tool-a');
  });
});
