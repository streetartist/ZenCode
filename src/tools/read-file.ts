import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Tool, ToolResult } from './types.js';

export const readFileTool: Tool = {
  name: 'read-file',
  description: '读取文件内容。修改文件前必须先读取。支持 offset/limit 读取大文件的指定部分。返回带行号的内容。',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: '文件路径（相对于工作目录或绝对路径）',
      },
      offset: {
        type: 'number',
        description: '起始行号（从1开始），默认从头读取',
      },
      limit: {
        type: 'number',
        description: '读取的行数，默认读取全部',
      },
    },
    required: ['path'],
  },
  permissionLevel: 'auto',

  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const filePath = path.resolve(params['path'] as string);
    const offset = (params['offset'] as number) || 1;
    const limit = params['limit'] as number | undefined;

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.split('\n');

      const startIdx = Math.max(0, offset - 1);
      const endIdx = limit ? startIdx + limit : lines.length;
      const selectedLines = lines.slice(startIdx, endIdx);

      // 带行号输出
      const numbered = selectedLines
        .map((line, i) => `${String(startIdx + i + 1).padStart(5)}\t${line}`)
        .join('\n');

      return { content: numbered || '（空文件）' };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { content: `读取文件失败：${msg}` };
    }
  },
};
