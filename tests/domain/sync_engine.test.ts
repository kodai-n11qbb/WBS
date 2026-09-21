import { describe, it, expect } from 'vitest';
import { SyncEngine } from '../../src/domain/sync_engine.js';
import { SyncEvent } from '../../src/domain/types.js';

describe('SyncEngine', () => {
  it('should build project state from sequential events', () => {
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
        payload: { taskId: 't1', title: 'Setup Repo', status: 'TODO' },
      },
    ];

    const state = engine.reduceEvents(events);
    expect(state.project?.name).toBe('P2P Project');
    expect(state.tasks.get('t1')).toEqual({
      id: 't1',
      projectId: 'p1',
      title: 'Setup Repo',
      status: 'TODO',
      updatedAt: 1001,
      authorNodeId: 'node-A',
    });
  });

  it('should merge concurrent offline events deterministically (LWW)', () => {
    const engine = new SyncEngine();
    const eventsNodeA: SyncEvent[] = [
      {
        id: 'e1',
        projectId: 'p1',
        authorNodeId: 'node-A',
        timestamp: 1000,
        sequence: 1,
        type: 'TASK_CREATED',
        payload: { taskId: 't1', title: 'Task 1', status: 'TODO' },
      },
      {
        id: 'e2-A',
        projectId: 'p1',
        authorNodeId: 'node-A',
        timestamp: 1050,
        sequence: 2,
        type: 'TASK_STATUS_UPDATED',
        payload: { taskId: 't1', status: 'IN_PROGRESS' },
      },
    ];

    const eventsNodeB: SyncEvent[] = [
      {
        id: 'e2-B',
        projectId: 'p1',
        authorNodeId: 'node-B',
        timestamp: 1100, // Later timestamp from Node B
        sequence: 1,
        type: 'TASK_STATUS_UPDATED',
        payload: { taskId: 't1', status: 'DONE' },
      },
    ];

    // Out-of-order / merged event list
    const combinedEvents = [...eventsNodeA, ...eventsNodeB];
    const state = engine.reduceEvents(combinedEvents);

    // Node B's update (timestamp 1100) should win over Node A (timestamp 1050)
    expect(state.tasks.get('t1')?.status).toBe('DONE');
    expect(state.tasks.get('t1')?.updatedAt).toBe(1100);
  });

  it('should deduplicate identical events correctly', () => {
    const engine = new SyncEngine();
    const event: SyncEvent = {
      id: 'e1',
      projectId: 'p1',
      authorNodeId: 'node-A',
      timestamp: 1000,
      sequence: 1,
      type: 'TASK_CREATED',
      payload: { taskId: 't1', title: 'Task 1', status: 'TODO' },
    };

    const state = engine.reduceEvents([event, event, event]);
    expect(state.tasks.size).toBe(1);
  });
});
