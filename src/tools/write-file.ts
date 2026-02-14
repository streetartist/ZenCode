import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Tool, ToolResult } from './types.js';

export const writeFileTool: Tool = {
  name: 'write-file',
  description: '创建新文件或完整重写文件。如果是修改已有文件，优先使用 edit-file。会自动创建父目录。',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: '文件路径',
      },
      content: {
        type: 'string',
        description: '要写入的文件内容',
      },
      overwrite: {
        type: 'boolean',
        description: '文件已存在时是否确认覆盖，默认 false',
      },
    },
    required: ['path', 'content'],
  },
  permissionLevel: 'confirm',

  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const filePath = path.resolve(params['path'] as string);
    const content = params['content'] as string;

    try {
      // 确保父目录存在
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, content, 'utf-8');
      return { content: `文件已写入：${filePath}` };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { content: `写入文件失败：${msg}` };
    }
  },
};
