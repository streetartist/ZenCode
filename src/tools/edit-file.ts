import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Tool, ToolResult } from './types.js';

export const editFileTool: Tool = {
  name: 'edit-file',
  description: '通过字符串替换编辑文件（推荐的文件修改方式）。old_string 必须在文件中唯一匹配，将被替换为 new_string。匹配失败时请提供更多上下文使其唯一，或使用 replace_all。',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: '文件路径',
      },
      old_string: {
        type: 'string',
        description: '要被替换的原始字符串（必须唯一匹配）',
      },
      new_string: {
        type: 'string',
        description: '替换后的字符串',
      },
      replace_all: {
        type: 'boolean',
        description: '是否替换所有匹配项，默认 false',
      },
    },
    required: ['path', 'old_string', 'new_string'],
  },
  permissionLevel: 'confirm',

  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const filePath = path.resolve(params['path'] as string);
    const oldString = params['old_string'] as string;
    const newString = params['new_string'] as string;
    const replaceAll = (params['replace_all'] as boolean) ?? false;

    try {
      const content = await fs.readFile(filePath, 'utf-8');

      if (replaceAll) {
        const newContent = content.split(oldString).join(newString);
        if (newContent === content) {
          return { content: `未找到匹配内容：${oldString.slice(0, 50)}...` };
        }
        await fs.writeFile(filePath, newContent, 'utf-8');
        const count = content.split(oldString).length - 1;
        return { content: `已替换 ${count} 处匹配` };
      }

      // 检查唯一性
      const firstIdx = content.indexOf(oldString);
      if (firstIdx === -1) {
        return { content: `未找到匹配内容：${oldString.slice(0, 100)}` };
      }

      const secondIdx = content.indexOf(oldString, firstIdx + 1);
      if (secondIdx !== -1) {
        return { content: `old_string 不唯一，找到多处匹配。请提供更多上下文使其唯一。` };
      }

      const newContent = content.slice(0, firstIdx) + newString + content.slice(firstIdx + oldString.length);
      await fs.writeFile(filePath, newContent, 'utf-8');

      return { content: `文件已编辑：${filePath}` };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { content: `编辑文件失败：${msg}` };
    }
  },
};
