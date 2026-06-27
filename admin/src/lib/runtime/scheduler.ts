export type TaskPriority = 1 | 2 | 3 | 4;
export const TaskPriority = {
  P1_IMMEDIATE: 1 as TaskPriority,
  P2_HIGH: 2 as TaskPriority,
  P3_DEFERRED: 3 as TaskPriority,
  P4_IDLE: 4 as TaskPriority,
} as const;

type TaskCallback = () => void | Promise<void>;

interface ScheduledTask {
  id: string;
  priority: TaskPriority;
  callback: TaskCallback;
  addedAt: number;
}

class PerformanceScheduler {
  private taskQueue: ScheduledTask[] = [];
  private isProcessing = false;

  public schedule(callback: TaskCallback, priority: TaskPriority = TaskPriority.P3_DEFERRED): string {
    const taskId = Math.random().toString(36).substring(2, 9);
    const task: ScheduledTask = {
      id: taskId,
      priority,
      callback,
      addedAt: Date.now(),
    };
    
    this.taskQueue.push(task);
    this.triggerProcessing();
    return taskId;
  }

  private triggerProcessing() {
    if (this.isProcessing || this.taskQueue.length === 0) return;
    this.isProcessing = true;

    // Process tasks in a coordinated frame manner
    if (typeof window !== 'undefined') {
      window.requestAnimationFrame(() => this.processQueue());
    } else {
      setTimeout(() => this.processQueue(), 16);
    }
  }

  private async processQueue() {
    // Sort queue by priority ascending (P1 has lowest enum value but highest priority)
    this.taskQueue.sort((a, b) => a.priority - b.priority);

    const task = this.taskQueue.shift();
    if (!task) {
      this.isProcessing = false;
      return;
    }

    try {
      if (task.priority === TaskPriority.P1_IMMEDIATE) {
        // P1 runs instantly in current microtask loop
        await task.callback();
      } else if (task.priority === TaskPriority.P2_HIGH) {
        // P2 runs in animation frame
        await task.callback();
      } else if (task.priority === TaskPriority.P3_DEFERRED) {
        // P3 runs in requestIdleCallback
        if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
          (window as any).requestIdleCallback(async () => {
            await task.callback();
          }, { timeout: 2000 });
        } else {
          setTimeout(async () => {
            await task.callback();
          }, 50);
        }
      } else {
        // P4 runs strictly on idle
        if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
          (window as any).requestIdleCallback(async () => {
            await task.callback();
          }, { timeout: 10000 });
        } else {
          setTimeout(async () => {
            await task.callback();
          }, 200);
        }
      }
    } catch (err) {
      console.error(`PerformanceScheduler task ${task.id} failed:`, err);
    } finally {
      this.isProcessing = false;
      // Continue processing next tick
      if (this.taskQueue.length > 0) {
        this.triggerProcessing();
      }
    }
  }
}

export const performanceScheduler = new PerformanceScheduler();
