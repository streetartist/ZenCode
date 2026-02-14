import { describe, it, expect } from 'vitest';
import { buildCorePrompt } from '../src/core/prompt/layers/core.js';
import { buildPlanningPrompt } from '../src/core/prompt/layers/planning.js';
import { buildGitPrompt } from '../src/core/prompt/layers/git.js';
import { buildPrompt, buildCoderPrompt } from '../src/core/prompt/builder.js';
import { DEFAULT_CONFIG } from '../src/config/defaults.js';

describe('Prompt System', () => {
  it('core prompt should contain working directory', () => {
    const prompt = buildCorePrompt();
    expect(prompt).toContain('ZenCode');
    expect(prompt).toContain(process.cwd());
  });

  it('core prompt should be under 1000 characters', () => {
    const prompt = buildCorePrompt();
    expect(prompt.length).toBeLessThan(1000);
  });

  it('planning prompt should exist', () => {
    const prompt = buildPlanningPrompt();
    expect(prompt).toContain('上下文');
    expect(prompt).toContain('实施');
    expect(prompt).toContain('todo');
  });

  it('git prompt should exist', () => {
    const prompt = buildGitPrompt();
    expect(prompt).toContain('git');
  });

  it('coder prompt should be minimal', () => {
    const prompt = buildCoderPrompt();
    expect(prompt.length).toBeLessThan(50);
  });

  it('buildPrompt should include core layer', async () => {
    const config = { ...DEFAULT_CONFIG };
    const { systemPrompt, layers } = await buildPrompt(config);
    expect(systemPrompt).toContain('ZenCode');
    expect(layers.length).toBeGreaterThanOrEqual(1);
  });

  it('buildPrompt should include planning layer when enabled', async () => {
    const config = { ...DEFAULT_CONFIG, features: { ...DEFAULT_CONFIG.features, planning_layer: 'on' as const } };
    const { systemPrompt } = await buildPrompt(config);
    expect(systemPrompt).toContain('分析');
  });

  it('buildPrompt should exclude planning layer when disabled', async () => {
    const config = { ...DEFAULT_CONFIG, features: { ...DEFAULT_CONFIG.features, planning_layer: 'off' as const } };
    const { systemPrompt } = await buildPrompt(config);
    expect(systemPrompt).not.toContain('处理编程任务时');
  });
});
