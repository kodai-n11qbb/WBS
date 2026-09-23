import { ProjectState, SyncEvent, Task } from './types.js';
import { StatusAggregatorPort, StatusAggregator } from './status_aggregator.js';

export class SyncEngine {
  private statusAggregator: StatusAggregatorPort;

  constructor(statusAggregator?: StatusAggregatorPort) {
    this.statusAggregator = statusAggregator || new StatusAggregator();
  }

  public sortEvents(events: SyncEvent[]): SyncEvent[] {
    return [...events].sort((a, b) => {
      if (a.timestamp !== b.timestamp) {
        return a.timestamp - b.timestamp;
      }
      if (a.sequence !== b.sequence) {
        return a.sequence - b.sequence;
      }
      if (a.authorNodeId !== b.authorNodeId) {
        return a.authorNodeId.localeCompare(b.authorNodeId);
      }
      return a.id.localeCompare(b.id);
    });
  }

  public reduceEvents(events: SyncEvent[]): ProjectState {
    const revertedIds = new Set<string>();
    for (const event of events) {
      if (event.type === 'UNDO_ACTION' && event.payload?.revertedEventId) {
        revertedIds.add(event.payload.revertedEventId);
      }
    }

    const eventMap = new Map<string, SyncEvent>();
    for (const event of events) {
      if (event.type !== 'UNDO_ACTION' && !revertedIds.has(event.id) && !eventMap.has(event.id)) {
        eventMap.set(event.id, event);
      }
    }

    const sorted = this.sortEvents(Array.from(eventMap.values()));
    const state: ProjectState = {
      tasks: new Map<string, Task>(),
    };

    for (const event of sorted) {
      switch (event.type) {
        case 'PROJECT_CREATED':
          state.project = {
            id: event.projectId,
            name: event.payload.name || 'Untitled Project',
            createdAt: event.timestamp,
          };
          break;

        case 'TASK_CREATED': {
          const { taskId, parentId, title, priority, status, orderIndex, dueDate, isCollapsed, assignedNodeId } =
            event.payload;
          state.tasks.set(taskId, {
            id: taskId,
            projectId: event.projectId,
            parentId: parentId || null,
            title: title || '',
            priority: priority || 'MEDIUM',
            status: status || 'TODO',
            orderIndex: typeof orderIndex === 'number' ? orderIndex : 0,
            dueDate: typeof dueDate === 'number' ? dueDate : null,
            isCollapsed: Boolean(isCollapsed),
            assignedNodeId,
            updatedAt: event.timestamp,
            authorNodeId: event.authorNodeId,
          });
          break;
        }

        case 'TASK_STATUS_UPDATED': {
          const { taskId, status, newOrderIndex } = event.payload;
          const existing = state.tasks.get(taskId);
          if (existing) {
            existing.status = status;
            if (typeof newOrderIndex === 'number') {
              existing.orderIndex = newOrderIndex;
            }
            existing.updatedAt = event.timestamp;
          }
          break;
        }

        case 'TASK_TITLE_UPDATED': {
          const { taskId, title } = event.payload;
          const existing = state.tasks.get(taskId);
          if (existing && typeof title === 'string') {
            existing.title = title.trim();
            existing.updatedAt = event.timestamp;
          }
          break;
        }

        case 'TASK_DUE_DATE_UPDATED': {
          const { taskId, dueDate } = event.payload;
          const existing = state.tasks.get(taskId);
          if (existing) {
            existing.dueDate = typeof dueDate === 'number' ? dueDate : null;
            existing.updatedAt = event.timestamp;
          }
          break;
        }


        case 'TASK_REORDERED': {
          const { taskId, newOrderIndex } = event.payload;
          const existing = state.tasks.get(taskId);
          if (existing && typeof newOrderIndex === 'number') {
            existing.orderIndex = newOrderIndex;
            existing.updatedAt = event.timestamp;
          }
          break;
        }

        case 'TASK_PARENT_CHANGED': {
          const { taskId, newParentId } = event.payload;
          const existing = state.tasks.get(taskId);
          if (existing) {
            const validation = this.statusAggregator ? 
              this.validateCycle(taskId, newParentId || null, state.tasks) : { valid: true };
            if (validation.valid) {
              existing.parentId = newParentId || null;
              existing.updatedAt = event.timestamp;
            }
          }
          break;
        }

        case 'TASK_COLLAPSE_TOGGLED': {
          const { taskId, isCollapsed } = event.payload;
          const existing = state.tasks.get(taskId);
          if (existing) {
            existing.isCollapsed = typeof isCollapsed === 'boolean' ? isCollapsed : !existing.isCollapsed;
            existing.updatedAt = event.timestamp;
          }
          break;
        }

        case 'TASK_DELETED': {
          const { taskId } = event.payload;
          const toDelete = new Set<string>([taskId]);
          let added = true;
          while (added) {
            added = false;
            for (const [id, t] of state.tasks.entries()) {
              if (t.parentId && toDelete.has(t.parentId) && !toDelete.has(id)) {
                toDelete.add(id);
                added = true;
              }
            }
          }
          for (const id of toDelete) {
            state.tasks.delete(id);
          }
          break;
        }
      }
    }

    this.statusAggregator.recalculateStatuses(state.tasks);

    return state;
  }

  private validateCycle(taskId: string, newParentId: string | null, tasks: Map<string, Task>): { valid: boolean } {
    if (!newParentId) return { valid: true };
    if (taskId === newParentId) return { valid: false };

    let currentId: string | null | undefined = newParentId;
    const visited = new Set<string>();

    while (currentId) {
      if (currentId === taskId) {
        return { valid: false };
      }
      if (visited.has(currentId)) break;
      visited.add(currentId);
      const parentTask = tasks.get(currentId);
      currentId = parentTask ? parentTask.parentId : null;
    }

    return { valid: true };
  }
}
