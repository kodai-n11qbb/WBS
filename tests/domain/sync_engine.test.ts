import { describe, it, expect } from 'vitest';
import { SyncEngine } from '../../src/domain/sync_engine.js';
import { SyncEvent } from '../../src/domain/types.js';

describe('SyncEngine', () => {
  it('should build project state with structured task data', () => {
    const engine = new SyncEngine();
    const events: SyncEvent[] = [
      {
        id: 'e1',
        projectId: 'p1',
        authorNodeId: 'node-A',
        timestamp: 1000,
        sequence: 1,
        type: 'PROJECT_CREATED',
        payload: { name: 'P2P Project' },
      },
      {
        id: 'e2',
        projectId: 'p1',
        authorNodeId: 'node-A',
        timestamp: 1001,
        sequence: 2,
        type: 'TASK_CREATED',
        payload: {
          taskId: 't1',
          title: 'Setup Repo',
          intent: 'Initialize architecture with P2P specs',
          definitionOfDone: [{ id: 'd1', text: 'Create docs', completed: true }],
          priority: 'HIGH',
          status: 'TODO',
          orderIndex: 0,
        },
      },
    ];

    const state = engine.reduceEvents(events);
    expect(state.project?.name).toBe('P2P Project');
    expect(state.tasks.get('t1')).toMatchObject({
      id: 't1',
      title: 'Setup Repo',
      intent: 'Initialize architecture with P2P specs',
      priority: 'HIGH',
      status: 'TODO',
      orderIndex: 0,
    });
  });

  it('should handle TASK_DELETED event (Tombstone deletion)', () => {
    const engine = new SyncEngine();
    const events: SyncEvent[] = [
      {
        id: 'e1',
        projectId: 'p1',
        authorNodeId: 'node-A',
        timestamp: 1000,
        sequence: 1,
        type: 'TASK_CREATED',
        payload: { taskId: 't1', title: 'Task 1', intent: 'Intent 1', status: 'TODO', orderIndex: 0 },
      },
      {
        id: 'e2',
        projectId: 'p1',
        authorNodeId: 'node-B',
        timestamp: 1200,
        sequence: 1,
        type: 'TASK_DELETED',
        payload: { taskId: 't1' },
      },
    ];

    const state = engine.reduceEvents(events);
    expect(state.tasks.has('t1')).toBe(false);
    expect(state.tasks.size).toBe(0);
  });

  it('should handle TASK_REORDERED event from drag & drop', () => {
    const engine = new SyncEngine();
    const events: SyncEvent[] = [
      {
        id: 'e1',
        projectId: 'p1',
        authorNodeId: 'node-A',
        timestamp: 1000,
        sequence: 1,
        type: 'TASK_CREATED',
        payload: { taskId: 't1', title: 'Task 1', intent: 'Intent 1', status: 'TODO', orderIndex: 0 },
      },
      {
        id: 'e2',
        projectId: 'p1',
        authorNodeId: 'node-A',
        timestamp: 1100,
        sequence: 2,
        type: 'TASK_REORDERED',
        payload: { taskId: 't1', newOrderIndex: 3 },
      },
    ];

    const state = engine.reduceEvents(events);
    expect(state.tasks.get('t1')?.orderIndex).toBe(3);
  });
});
