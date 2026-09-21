import { Task, TaskStatus } from './types.js';

export interface StatusAggregatorPort {
  recalculateStatuses(tasks: Map<string, Task>): void;
}

export class StatusAggregator implements StatusAggregatorPort {
  /**
   * Recalculates parent task statuses bottom-up based on child task statuses.
   */
  public recalculateStatuses(tasks: Map<string, Task>): void {
    // 1. Group children by parentId
    const childrenMap = new Map<string, Task[]>();
    for (const task of tasks.values()) {
      if (task.parentId) {
        if (!childrenMap.has(task.parentId)) {
          childrenMap.set(task.parentId, []);
        }
        childrenMap.get(task.parentId)!.push(task);
      }
    }

    // 2. Perform iterative bottom-up status evaluation until no more status changes occur
    let changed = true;
    let iterations = 0;
    const maxIterations = 20; // Safety guard against circular refs

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
