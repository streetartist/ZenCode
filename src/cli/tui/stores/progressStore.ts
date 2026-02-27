import { EventEmitter } from 'events';

export interface StreamingProgress {
  name: string;
  progress: string;
}

class ProgressStore extends EventEmitter {
  private current?: StreamingProgress;

  update(progress?: StreamingProgress) {
    this.current = progress;
    this.emit('change', progress);
  }

  get() {
    return this.current;
  }
}

export const progressStore = new ProgressStore();
