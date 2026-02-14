import type { Tool, ToolResult } from './types.js';
import type { TodoStore } from '../core/todo-store.js';

/**
 * 创建 todo 工具 - 计划管理
 */
export function createTodoTool(store: TodoStore): Tool {
  return {
    name: 'todo',
    description:
      '管理任务计划。支持创建计划、更新条目状态、查看计划和清空计划。对于包含多个步骤的任务，先创建计划再逐步执行。',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: '操作类型',
          enum: ['create', 'update', 'list', 'clear'],
        },
        items: {
          type: 'array',
          description: 'create 时必填：计划条目列表',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: '条目 ID' },
              title: { type: 'string', description: '条目标题' },
            },
            required: ['id', 'title'],
          },
        },
        id: {
          type: 'string',
          description: 'update 时必填：要更新的条目 ID',
        },
        status: {
          type: 'string',
          description: 'update 时必填：新状态',
          enum: ['pending', 'in-progress', 'completed'],
        },
      },
      required: ['action'],
    },
    permissionLevel: 'auto',

    async execute(params: Record<string, unknown>): Promise<ToolResult> {
      const action = params['action'] as string;

      switch (action) {
        case 'create': {
          const items = params['items'] as
            | { id: string; title: string }[]
            | undefined;
          if (!items || items.length === 0) {
            return { content: '错误：create 需要提供 items' };
          }
          const plan = store.create(items);
          const lines = plan.items.map(
            (item) => `○ [${item.id}] ${item.title}`,
          );
          return {
            content: `计划已创建（${plan.items.length} 个条目）：\n${lines.join('\n')}`,
          };
        }

        case 'update': {
          const id = params['id'] as string | undefined;
          const status = params['status'] as string | undefined;
          if (!id || !status) {
            return { content: '错误：update 需要提供 id 和 status' };
          }
          const item = store.update(
            id,
            status as 'pending' | 'in-progress' | 'completed',
          );
          if (!item) {
            return { content: `错误：未找到条目 "${id}"` };
          }
          const icon =
            item.status === 'completed'
              ? '●'
              : item.status === 'in-progress'
                ? '◐'
                : '○';
          return {
            content: `已更新：${icon} [${item.id}] ${item.title} → ${item.status}`,
          };
        }

        case 'list': {
          const plan = store.list();
          if (!plan) {
            return { content: '当前没有计划' };
          }
          const completed = plan.items.filter(
            (i) => i.status === 'completed',
          ).length;
          const lines = plan.items.map((item) => {
            const icon =
              item.status === 'completed'
                ? '●'
                : item.status === 'in-progress'
                  ? '◐'
                  : '○';
            return `${icon} [${item.id}] ${item.title}`;
          });
          return {
            content: `计划进度 ${completed}/${plan.items.length}：\n${lines.join('\n')}`,
          };
        }

        case 'clear': {
          store.clear();
          return { content: '计划已清空' };
        }

        default:
          return {
            content: `错误：未知操作 "${action}"。支持: create, update, list, clear`,
          };
      }
    },
  };
}
