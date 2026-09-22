import { describe, it, expect } from 'vitest';
import { SyncEngine } from '../../src/domain/sync_engine.js';
import { SyncEvent } from '../../src/domain/types.js';

describe('SyncEngine (Tree Structure & Optional Attributes)', () => {
  it('should build project state with parentId and optional fields', () => {
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
          taskId: 't-parent',
          title: 'Parent Task',
          status: 'TODO',
          orderIndex: 0,
        },
      },
      {
        id: 'e3',
        projectId: 'p1',
        authorNodeId: 'node-A',
        timestamp: 1002,
        sequence: 3,
        type: 'TASK_CREATED',
        payload: {
          taskId: 't-child',
          parentId: 't-parent',
          title: 'Subtask 1',
          status: 'TODO',
          orderIndex: 0,
        },
      },
    ];

    const state = engine.reduceEvents(events);
    expect(state.tasks.get('t-parent')?.title).toBe('Parent Task');
    expect(state.tasks.get('t-child')?.parentId).toBe('t-parent');
  });

  it('should handle TASK_PARENT_CHANGED event', () => {
    const engine = new SyncEngine();
    const events: SyncEvent[] = [
      {
        id: 'e1',
        projectId: 'p1',
        authorNodeId: 'node-A',
        timestamp: 1000,
        sequence: 1,
        type: 'TASK_CREATED',
        payload: { taskId: 't1', title: 'Task 1', status: 'TODO', orderIndex: 0 },
      },
      {
        id: 'e2',
        projectId: 'p1',
        authorNodeId: 'node-A',
        timestamp: 1100,
        sequence: 2,
        type: 'TASK_PARENT_CHANGED',
        payload: { taskId: 't1', newParentId: 't-parent-target' },
      },
    ];

    const state = engine.reduceEvents(events);
    expect(state.tasks.get('t1')?.parentId).toBe('t-parent-target');
  });

  it('should cascade delete child subtasks when parent task is deleted', () => {
    const engine = new SyncEngine();
    const events: SyncEvent[] = [
      {
        id: 'e1',
        projectId: 'p1',
        authorNodeId: 'node-A',
        timestamp: 1000,
        sequence: 1,
        type: 'TASK_CREATED',
        payload: { taskId: 't-parent', title: 'Parent Task', status: 'TODO', orderIndex: 0 },
      },
      {
        id: 'e2',
        projectId: 'p1',
        authorNodeId: 'node-A',
        timestamp: 1001,
        sequence: 2,
        type: 'TASK_CREATED',
        payload: { taskId: 't-child', parentId: 't-parent', title: 'Child Task', status: 'TODO', orderIndex: 0 },
      },
      {
        id: 'e3',
        projectId: 'p1',
        authorNodeId: 'node-A',
        timestamp: 1002,
        sequence: 3,
        type: 'TASK_DELETED',
        payload: { taskId: 't-parent' },
      },
    ];

    const state = engine.reduceEvents(events);
    expect(state.tasks.has('t-parent')).toBe(false);
    expect(state.tasks.has('t-child')).toBe(false);
  });

  it('should handle TASK_TITLE_UPDATED event', () => {
    const engine = new SyncEngine();
    const events: SyncEvent[] = [
      {
        id: 'e1',
        projectId: 'p1',
        authorNodeId: 'node-A',
        timestamp: 1000,
        sequence: 1,
        type: 'TASK_CREATED',
        payload: { taskId: 't1', title: 'Old Title', status: 'TODO', orderIndex: 0 },
      },
      {
        id: 'e2',
        projectId: 'p1',
        authorNodeId: 'node-A',
        timestamp: 1100,
        sequence: 2,
        type: 'TASK_TITLE_UPDATED',
        payload: { taskId: 't1', title: 'New Updated Title' },
      },
    ];

    const state = engine.reduceEvents(events);
    expect(state.tasks.get('t1')?.title).toBe('New Updated Title');
  });
});

