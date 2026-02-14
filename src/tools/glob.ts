import { glob as globFn } from 'glob';
import type { Tool, ToolResult } from './types.js';

export const globTool: Tool = {
  name: 'glob',
  description: '按 glob 模式搜索文件路径。用于查找文件位置，如 "**/*.ts"、"src/**/config.*"。自动忽略 node_modules 和 .git。',
  parameters: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'Glob 模式，如 "**/*.ts"、"src/**/*.js"',
      },
      cwd: {
        type: 'string',
        description: '搜索的根目录，默认为工作目录',
      },
    },
    required: ['pattern'],
  },
  permissionLevel: 'auto',

  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const pattern = params['pattern'] as string;
    const cwd = (params['cwd'] as string) || process.cwd();

    try {
      const files = await globFn(pattern, {
        cwd,
        nodir: true,
        dot: false,
        ignore: ['**/node_modules/**', '**/.git/**'],
      });

      if (files.length === 0) {
        return { content: '未找到匹配的文件' };
      }

      return { content: files.join('\n') };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { content: `搜索失败：${msg}` };
    }
  },
};
