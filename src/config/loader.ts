import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { parse as parseYaml } from 'yaml';
import type { ZenCodeConfig } from './types.js';
import { DEFAULT_CONFIG } from './defaults.js';

/**
 * 深度合并两个对象，source 中的值覆盖 target 中的值
 */
function deepMerge(target: Record<string, any>, source: Record<string, any>): any {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    const sourceVal = source[key];
    const targetVal = target[key];
    if (
      sourceVal !== undefined &&
      sourceVal !== null &&
      typeof sourceVal === 'object' &&
      !Array.isArray(sourceVal) &&
      typeof targetVal === 'object' &&
      !Array.isArray(targetVal) &&
      targetVal !== null
    ) {
      result[key] = deepMerge(targetVal, sourceVal);
    } else if (sourceVal !== undefined) {
      result[key] = sourceVal;
    }
  }
  return result;
}

/**
 * 加载 YAML 配置文件，如果不存在返回空对象
 */
function loadYamlFile(filePath: string): Partial<ZenCodeConfig> {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return (parseYaml(content) as Partial<ZenCodeConfig>) || {};
  } catch {
    return {};
  }
}

/**
 * 从环境变量加载配置
 */
function loadEnvConfig(): Partial<ZenCodeConfig> {
  const config: Partial<ZenCodeConfig> = {};

  if (process.env['ZENCODE_API_KEY']) {
    config.api_key = process.env['ZENCODE_API_KEY'];
  }
  if (process.env['ZENCODE_MODEL']) {
    config.model = process.env['ZENCODE_MODEL'];
  }
  if (process.env['ZENCODE_BASE_URL']) {
    config.base_url = process.env['ZENCODE_BASE_URL'];
  }
  if (process.env['ZENCODE_MODE']) {
    const mode = process.env['ZENCODE_MODE'];
    if (mode === 'dual' || mode === 'single') {
      config.agent_mode = mode;
    }
  }

  return config;
}

/**
 * 从 CLI 参数加载配置
 */
export interface CliOptions {
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  single?: boolean;
  dual?: boolean;
  mode?: string;
}

function loadCliConfig(opts: CliOptions): Partial<ZenCodeConfig> {
  const config: Partial<ZenCodeConfig> = {};

  if (opts.model) config.model = opts.model;
  if (opts.apiKey) config.api_key = opts.apiKey;
  if (opts.baseUrl) config.base_url = opts.baseUrl;
  if (opts.single) config.agent_mode = 'single';
  if (opts.dual) config.agent_mode = 'dual';
  if (opts.mode) {
    const m = opts.mode;
    if (m === 'delegated' || m === 'autonomous' || m === 'controlled') {
      config.collaboration = m;
    }
  }

  return config;
}

/**
 * 加载并合并所有配置源
 * 优先级（从低到高）：默认值 < 全局配置 < 项目配置 < 环境变量 < CLI参数
 */
export function loadConfig(cliOpts: CliOptions = {}): ZenCodeConfig {
  const globalConfigPath = path.join(os.homedir(), '.zencode', 'config.yaml');
  const projectDirConfigPath = path.resolve('.zencode', 'config.yaml');
  const projectFileConfigPath = path.resolve('.zencode.yaml');

  let config = { ...DEFAULT_CONFIG };
  config = deepMerge(config, loadYamlFile(globalConfigPath));
  config = deepMerge(config, loadYamlFile(projectDirConfigPath));
  config = deepMerge(config, loadYamlFile(projectFileConfigPath));
  config = deepMerge(config, loadEnvConfig());
  config = deepMerge(config, loadCliConfig(cliOpts));

  return config;
}

/**
 * 解析模型配置，合并 orchestrator/coder 的配置与全局配置
 */
export function resolveModelConfig(
  config: ZenCodeConfig,
  role: 'orchestrator' | 'coder',
): Required<Pick<ZenCodeConfig, 'model' | 'api_key' | 'base_url' | 'temperature' | 'max_tokens'>> {
  const roleConfig = config.dual_agent[role] || {};
  return {
    model: roleConfig.model || config.model,
    api_key: roleConfig.api_key || config.api_key,
    base_url: roleConfig.base_url || config.base_url,
    temperature: roleConfig.temperature ?? config.temperature,
    max_tokens: roleConfig.max_tokens ?? config.max_tokens,
  };
}
