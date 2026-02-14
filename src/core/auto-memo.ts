/**
 * 自动 Memo 记录 — 文件操作后自动存储完整内容
 *
 * 所有 Agent（Orchestrator、Coder、SubAgent）的工具执行循环中调用。
 * 只负责存储文件内容供 memo read 查看，不生成摘要。
 * 摘要由 AI Agent 自己通过 memo write 编写。
 */

import type { MemoStore } from './memo-store.js';

/**
 * 工具执行成功后自动记录文件内容到 memo
 *
 * - write-file → 存储完整文件内容
 * - edit-file  → 存储 diff（旧/新）
 * - read-file  → 存储文件内容
 *
 * summary 只记录操作类型和行数，不做符号提取。
 * Agent 应通过 memo write 补充有意义的摘要。
 */
export function autoMemoForTool(
  memoStore: MemoStore | undefined,
  toolName: string,
  params: Record<string, unknown>,
  result: string,
): void {
  if (!memoStore) return;

  if (toolName === 'write-file') {
    const filePath = params['path'] as string;
    const content = params['content'] as string || '';
    const lines = content.split('\n').length;
    memoStore.write(
      `file:${filePath}`,
      content,
      'auto',
      `新建 ${lines}行`,
    );
  }

  if (toolName === 'edit-file') {
    const filePath = params['path'] as string;
    const newStr = params['new_string'] as string || '';
    const oldStr = params['old_string'] as string || '';
    const changeLines = newStr.split('\n').length;
    memoStore.write(
      `file:${filePath}`,
      `--- 旧 ---\n${oldStr}\n--- 新 ---\n${newStr}`,
      'auto',
      `编辑 ${changeLines}行变更`,
    );
  }

  if (toolName === 'read-file') {
    const filePath = params['path'] as string;
    const lines = result.split('\n').length;
    memoStore.write(
      `file:${filePath}`,
      result,
      'auto',
      `已读 ${lines}行`,
    );
  }
}
