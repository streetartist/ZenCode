export interface TodoItem {
  id: string;
  title: string;
  status: 'pending' | 'in-progress' | 'completed';
}

export interface TodoPlan {
  items: TodoItem[];
}

type TodoListener = (plan: TodoPlan | null) => void;

/**
 * Todo 状态存储（可观察）
 *
 * LLM 通过 todo 工具操作，TUI 订阅变化实时渲染面板
 */
export class TodoStore {
  private plan: TodoPlan | null = null;
  private listeners = new Set<TodoListener>();

  create(items: { id: string; title: string }[]): TodoPlan {
    this.plan = {
      items: items.map((item) => ({
        id: item.id,
        title: item.title,
        status: 'pending' as const,
      })),
    };
    this.notify();
    return this.plan;
  }

  update(id: string, status: TodoItem['status']): TodoItem | null {
    if (!this.plan) return null;
    const item = this.plan.items.find((i) => i.id === id);
    if (!item) return null;
    item.status = status;
    this.notify();
    return { ...item };
  }

  list(): TodoPlan | null {
    return this.plan;
  }

  clear(): void {
    this.plan = null;
    this.notify();
  }

  subscribe(listener: TodoListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    const snapshot = this.plan
      ? { items: this.plan.items.map((i) => ({ ...i })) }
      : null;
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}
