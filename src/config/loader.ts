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

  return config;
}

/**
 * 从 CLI 参数加载配置
 */
export interface CliOptions {
  model?: string;
  apiKey?: string;
  baseUrl?: string;
}

function loadCliConfig(opts: CliOptions): Partial<ZenCodeConfig> {
  const config: Partial<ZenCodeConfig> = {};

  if (opts.model) config.model = opts.model;
  if (opts.apiKey) config.api_key = opts.apiKey;
  if (opts.baseUrl) config.base_url = opts.baseUrl;

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
