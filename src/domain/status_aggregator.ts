import { Task, TaskStatus } from './types.js';

export interface CompletionRate {
  total: number;
  completed: number;
  percentage: number;
}

export interface StatusAggregatorPort {
  recalculateStatuses(tasks: Map<string, Task>): void;
  calculateCompletionRate(parentId: string, tasks: Map<string, Task>): CompletionRate;
}

export class StatusAggregator implements StatusAggregatorPort {
  /**
   * Recalculates parent task statuses bottom-up based on child task statuses.
   */
  public recalculateStatuses(tasks: Map<string, Task>): void {
    const childrenMap = new Map<string, Task[]>();
    for (const task of tasks.values()) {
      if (task.parentId) {
        if (!childrenMap.has(task.parentId)) {
          childrenMap.set(task.parentId, []);
        }
        childrenMap.get(task.parentId)!.push(task);
      }
    }

    let changed = true;
    let iterations = 0;
    const maxIterations = 20;

    while (changed && iterations < maxIterations) {
      changed = false;
      iterations++;

      for (const [parentId, children] of childrenMap.entries()) {
        const parentTask = tasks.get(parentId);
        if (!parentTask || children.length === 0) continue;

        const calculatedStatus = this.calculateParentStatus(children);
        if (parentTask.status !== calculatedStatus) {
          parentTask.status = calculatedStatus;
          changed = true;
        }
      }
    }
  }

  /**
   * Calculates completion percentage for a parent task's direct children.
   */
  public calculateCompletionRate(parentId: string, tasks: Map<string, Task>): CompletionRate {
    const children = Array.from(tasks.values()).filter((t) => t.parentId === parentId);
    if (children.length === 0) {
      return { total: 0, completed: 0, percentage: 0 };
    }

    const completed = children.filter((c) => c.status === 'DONE').length;
    const percentage = Math.round((completed / children.length) * 1000) / 10;
    return {
      total: children.length,
      completed,
      percentage,
    };
  }

  private calculateParentStatus(children: Task[]): TaskStatus {
    const statuses = children.map((c) => c.status);
    const allDone = statuses.every((s) => s === 'DONE');
    if (allDone) {
      return 'DONE';
    }

    const hasInProgressOrDone = statuses.some((s) => s === 'IN_PROGRESS' || s === 'DONE');
    if (hasInProgressOrDone) {
      return 'IN_PROGRESS';
    }

    return 'TODO';
  }
}
