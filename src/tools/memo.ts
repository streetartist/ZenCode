import type { Tool, ToolResult } from './types.js';
import type { MemoStore } from '../core/memo-store.js';

/**
 * 创建 memo 工具 - 共享备忘录
 *
 * 所有 Agent 通过此工具读写共享备忘录，实现跨上下文协作。
 */
export function createMemoTool(store: MemoStore): Tool {
  return {
    name: 'memo',
    description:
      '共享备忘录：在多个 Agent 之间共享信息。write 写入发现/决策/摘要供其他 Agent 读取，read 按 key 读取，list 查看所有可用条目。',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: '操作类型',
          enum: ['write', 'read', 'list', 'delete', 'clear'],
        },
        key: {
          type: 'string',
          description: 'write/read/delete 时必填：备忘录 key',
        },
        content: {
          type: 'string',
          description: 'write 时必填：要写入的内容（最多 3000 字符）',
        },
        summary: {
          type: 'string',
          description: 'write 时可选：一行摘要（不填则自动截取 content 前 80 字符）',
        },
      },
      required: ['action'],
    },
    permissionLevel: 'auto',

    async execute(params: Record<string, unknown>): Promise<ToolResult> {
      const action = params['action'] as string;

      switch (action) {
        case 'write': {
          const key = params['key'] as string | undefined;
          const content = params['content'] as string | undefined;
          const summary = params['summary'] as string | undefined;
          if (!key || !content) {
            return { content: '错误：write 需要提供 key 和 content' };
          }
          const entry = store.write(key, content, 'agent', summary);
          return { content: `memo [${entry.key}]: ${entry.summary}` };
        }

        case 'read': {
          const key = params['key'] as string | undefined;
          if (!key) {
            return { content: '错误：read 需要提供 key' };
          }
          const entry = store.read(key);
          if (!entry) {
            return { content: `memo [${key}] 不存在` };
          }
          return { content: `[${entry.key}] by ${entry.author}:\n${entry.content}` };
        }

        case 'list': {
          const items = store.list();
          if (items.length === 0) {
            return { content: '备忘录为空' };
          }
          const lines = items.map(
            (item) => `[${item.key}] (${item.author}) ${item.summary}`,
          );
          return { content: `共 ${items.length} 条备忘录：\n${lines.join('\n')}` };
        }

        case 'delete': {
          const key = params['key'] as string | undefined;
          if (!key) {
            return { content: '错误：delete 需要提供 key' };
          }
          const ok = store.delete(key);
          return { content: ok ? `已删除 memo [${key}]` : `memo [${key}] 不存在` };
        }

        case 'clear': {
          store.clear();
          return { content: '备忘录已清空' };
        }

        default:
          return { content: `错误：未知操作 "${action}"。支持: write, read, list, delete, clear` };
      }
    },
  };
}
