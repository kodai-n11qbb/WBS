import { ProjectState, SyncEvent, Task } from './types.js';
import { StatusAggregatorPort, StatusAggregator } from './status_aggregator.js';

export class SyncEngine {
  private statusAggregator: StatusAggregatorPort;

  constructor(statusAggregator?: StatusAggregatorPort) {
    this.statusAggregator = statusAggregator || new StatusAggregator();
  }

  /**
   * Sorts events deterministically based on Timestamp -> Sequence -> AuthorNodeId -> EventId
   */
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

  /**
   * Reduces an array of SyncEvents into a consolidated ProjectState.
   * Handles deduplication, Tombstone deletion, parentId hierarchy, collapse toggling, and auto status aggregation.
   */
  public reduceEvents(events: SyncEvent[]): ProjectState {
    const eventMap = new Map<string, SyncEvent>();
    for (const event of events) {
      if (!eventMap.has(event.id)) {
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
          const {
            taskId,
            parentId,
            title,
            intent,
            definitionOfDone,
            priority,
            status,
            orderIndex,
            isCollapsed,
            assignedNodeId,
          } = event.payload;
          state.tasks.set(taskId, {
            id: taskId,
            projectId: event.projectId,
            parentId: parentId || null,
            title: title || '',
            intent: intent || '',
            definitionOfDone: Array.isArray(definitionOfDone) ? definitionOfDone : [],
            priority: priority || 'MEDIUM',
            status: status || 'TODO',
            orderIndex: typeof orderIndex === 'number' ? orderIndex : 0,
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
            existing.parentId = newParentId || null;
            existing.updatedAt = event.timestamp;
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
          state.tasks.delete(taskId);
          break;
        }
      }
    }

    // Automatically recalculate parent task statuses based on child tasks
    this.statusAggregator.recalculateStatuses(state.tasks);

    return state;
  }
}
