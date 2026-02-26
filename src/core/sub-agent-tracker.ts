/**
 * 子 Agent 并行执行追踪器
 *
 * spawn-agents 工具在执行时更新状态，TUI 订阅变化实时渲染。
 */

export interface SubAgentProgress {
  total: number;
  completed: number;
  failed: number;
  descriptions: string[];
  tokens: number;
}

type ProgressListener = (progress: SubAgentProgress | null) => void;

export class SubAgentTracker {
  private progress: SubAgentProgress | null = null;
  private listeners = new Set<ProgressListener>();

  start(descriptions: string[]): void {
    this.progress = {
      total: descriptions.length,
      completed: 0,
      failed: 0,
      descriptions,
      tokens: 0,
    };
    this.notify();
  }

  markCompleted(): void {
    if (!this.progress) return;
    this.progress = { ...this.progress, completed: this.progress.completed + 1 };
    this.notify();
  }

  markFailed(): void {
    if (!this.progress) return;
    this.progress = { ...this.progress, failed: this.progress.failed + 1 };
    this.notify();
  }

  addTokens(count: number): void {
    if (!this.progress) return;
    this.progress = { ...this.progress, tokens: this.progress.tokens + count };
    this.notify();
  }

  finish(): void {
    this.progress = null;
    this.notify();
  }

  get current(): SubAgentProgress | null {
    return this.progress;
  }

  subscribe(listener: ProgressListener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private notify(): void {
    const snapshot = this.progress ? { ...this.progress } : null;
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}
