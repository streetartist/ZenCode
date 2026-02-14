import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * 跟踪当前 Agent 会话中已读取的文件路径
 *
 * 用于强制执行"先读后改"规则：
 * - read-file 成功后标记为已读
 * - write-file 成功后标记为已读（agent 刚写入，知道内容）
 * - edit-file 调用前检查是否已读，未读则拒绝并提示
 *
 * 同时提供 write-file 覆盖检查：
 * - 文件已存在且未传 overwrite: true → 返回警告
 */
export class ReadTracker {
  private files = new Set<string>();

  /** 标记文件已被读取 */
  markRead(filePath: string): void {
    this.files.add(this.normalize(filePath));
  }

  /** 标记文件已被写入（新建/重写，agent 已知内容） */
  markWritten(filePath: string): void {
    this.files.add(this.normalize(filePath));
  }

  /** 检查文件是否已读取 */
  hasRead(filePath: string): boolean {
    return this.files.has(this.normalize(filePath));
  }

  /**
   * 检查 write-file 是否会覆盖已有文件
   * @returns 警告消息（需要拦截），或 null（可以继续执行）
   */
  checkWriteOverwrite(filePath: string, overwrite?: boolean): string | null {
    const resolved = path.resolve(filePath);
    if (!overwrite && fs.existsSync(resolved)) {
      return `⚠ 文件已存在：${filePath}\n修改已有文件请用 read-file + edit-file（更精确安全）。\n如确需完整重写，请重新调用 write-file 并设置 overwrite: true。`;
    }
    return null;
  }

  private normalize(filePath: string): string {
    return filePath.replace(/\\/g, '/').replace(/^\.\//, '');
  }
}
