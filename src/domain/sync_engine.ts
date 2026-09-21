import { ProjectState, SyncEvent, Task } from './types.js';

export class SyncEngine {
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
   * Handles deduplication and deterministic LWW (Last-Write-Wins) resolution.
   */
  public reduceEvents(events: SyncEvent[]): ProjectState {
    // Deduplicate by event.id
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
          const { taskId, title, status, assignedNodeId } = event.payload;
          state.tasks.set(taskId, {
            id: taskId,
            projectId: event.projectId,
            title: title || '',
            status: status || 'TODO',
            assignedNodeId,
            updatedAt: event.timestamp,
            authorNodeId: event.authorNodeId,
          });
          break;
        }

        case 'TASK_STATUS_UPDATED': {
          const { taskId, status } = event.payload;
          const existing = state.tasks.get(taskId);
          if (existing) {
            existing.status = status;
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

    return state;
  }
}
