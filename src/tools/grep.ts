import { exec } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Tool, ToolResult } from './types.js';

/**
 * 纯 JS 实现的 grep，不依赖外部命令
 */
async function jsGrep(
  pattern: string,
  searchPath: string,
  options: { ignoreCase?: boolean; maxResults?: number; glob?: string },
): Promise<string[]> {
  const regex = new RegExp(pattern, options.ignoreCase ? 'i' : '');
  const results: string[] = [];
  const maxResults = options.maxResults ?? 200;

  async function searchFile(filePath: string) {
    if (results.length >= maxResults) return;
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (results.length >= maxResults) break;
        if (regex.test(lines[i]!)) {
          results.push(`${filePath}:${i + 1}: ${lines[i]}`);
        }
      }
    } catch {
      // 跳过无法读取的文件
    }
  }

  async function searchDir(dirPath: string) {
    if (results.length >= maxResults) return;
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        if (results.length >= maxResults) break;
        const fullPath = path.join(dirPath, entry.name);

        // 跳过常见无关目录
        if (entry.isDirectory()) {
          if (['node_modules', '.git', 'dist', '.next', '__pycache__'].includes(entry.name)) {
            continue;
          }
          await searchDir(fullPath);
        } else if (entry.isFile()) {
          // 简单过滤二进制文件
          const ext = path.extname(entry.name).toLowerCase();
          const textExts = [
            '.ts', '.tsx', '.js', '.jsx', '.json', '.md', '.txt', '.yaml', '.yml',
            '.toml', '.css', '.scss', '.html', '.vue', '.svelte', '.py', '.go',
            '.rs', '.java', '.c', '.cpp', '.h', '.hpp', '.rb', '.php', '.sh',
            '.bash', '.zsh', '.fish', '.sql', '.xml', '.svg', '.env', '.gitignore',
            '.editorconfig', '.prettierrc', '.eslintrc',
          ];
          if (ext && !textExts.includes(ext)) continue;
          await searchFile(fullPath);
        }
      }
    } catch {
      // 跳过无法访问的目录
    }
  }

  const stat = await fs.stat(searchPath);
  if (stat.isFile()) {
    await searchFile(searchPath);
  } else {
    await searchDir(searchPath);
  }

  return results;
}

export const grepTool: Tool = {
  name: 'grep',
  description: '在文件内容中搜索正则表达式。用于查找函数定义、类引用、特定代码模式。返回匹配的文件路径、行号和内容。',
  parameters: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: '正则表达式搜索模式',
      },
      path: {
        type: 'string',
        description: '搜索的文件或目录路径，默认为工作目录',
      },
      ignore_case: {
        type: 'boolean',
        description: '是否忽略大小写',
      },
    },
    required: ['pattern'],
  },
  permissionLevel: 'auto',

  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const pattern = params['pattern'] as string;
    const searchPath = (params['path'] as string) || process.cwd();
    const ignoreCase = (params['ignore_case'] as boolean) ?? false;

    try {
      const resolvedPath = path.resolve(searchPath);
      const results = await jsGrep(pattern, resolvedPath, {
        ignoreCase,
        maxResults: 200,
      });

      if (results.length === 0) {
        return { content: '未找到匹配内容' };
      }

      return { content: results.join('\n') };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { content: `搜索失败：${msg}` };
    }
  },
};
