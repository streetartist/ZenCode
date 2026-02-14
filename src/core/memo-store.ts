/**
 * Memo 共享备忘录（Blackboard Pattern）
 *
 * 所有 Agent（Orchestrator、Coder、SubAgent）共享同一个 MemoStore，
 * 通过 memo 工具按需读写。每个 Agent 只拉取自己需要的条目，不占其他 Agent 的上下文。
 */

export interface MemoEntry {
  key: string;
  summary: string;
  content: string;
  author: string;
  updatedAt: number;
}

const MAX_ENTRIES = 30;
const MAX_CONTENT_LENGTH = 3000;

export class MemoStore {
  private entries = new Map<string, MemoEntry>();

  write(key: string, content: string, author: string = 'agent', summary?: string): MemoEntry {
    const trimmed = content.slice(0, MAX_CONTENT_LENGTH);
    const entry: MemoEntry = {
      key,
      summary: summary || content.slice(0, 80).replace(/\n/g, ' '),
      content: trimmed,
      author,
      updatedAt: Date.now(),
    };

    // 超过上限时移除最旧的
    if (!this.entries.has(key) && this.entries.size >= MAX_ENTRIES) {
      let oldest: string | null = null;
      let oldestTime = Infinity;
      for (const [k, v] of this.entries) {
        if (v.updatedAt < oldestTime) {
          oldestTime = v.updatedAt;
          oldest = k;
        }
      }
      if (oldest) this.entries.delete(oldest);
    }

    this.entries.set(key, entry);
    return entry;
  }

  read(key: string): MemoEntry | null {
    return this.entries.get(key) ?? null;
  }

  list(): { key: string; author: string; summary: string }[] {
    return [...this.entries.values()].map((e) => ({
      key: e.key,
      author: e.author,
      summary: e.summary,
    }));
  }

  delete(key: string): boolean {
    return this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }

  /**
   * 生成备忘录索引（注入 Coder 任务中）
   * 只输出 key + summary，清爽紧凑
   * Coder 需要详情时用 memo read <key> 获取完整内容
   */
  buildIndex(): string | null {
    if (this.entries.size === 0) return null;
    return [...this.entries.values()]
      .map((e) => `[${e.key}] ${e.summary}`)
      .join('\n');
  }
}
