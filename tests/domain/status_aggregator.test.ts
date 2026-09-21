import { describe, it, expect } from 'vitest';
import { StatusAggregator } from '../../src/domain/status_aggregator.js';
import { Task } from '../../src/domain/types.js';

describe('StatusAggregator', () => {
  const aggregator = new StatusAggregator();

  const createDummyTask = (id: string, parentId: string | null, status: 'TODO' | 'IN_PROGRESS' | 'DONE'): Task => ({
    id,
    projectId: 'p1',
    parentId,
    title: `Task ${id}`,
    status,
    orderIndex: 0,
    updatedAt: 1000,
    authorNodeId: 'node-1',
  });

  it('should set parent status to DONE when ALL child tasks are DONE', () => {
    const tasksMap = new Map<string, Task>();
    tasksMap.set('parent', createDummyTask('parent', null, 'TODO'));
    tasksMap.set('child1', createDummyTask('child1', 'parent', 'DONE'));
    tasksMap.set('child2', createDummyTask('child2', 'parent', 'DONE'));

    aggregator.recalculateStatuses(tasksMap);
    expect(tasksMap.get('parent')?.status).toBe('DONE');
  });

  it('should set parent status to IN_PROGRESS when SOME child tasks are IN_PROGRESS or DONE', () => {
    const tasksMap = new Map<string, Task>();
    tasksMap.set('parent', createDummyTask('parent', null, 'TODO'));
    tasksMap.set('child1', createDummyTask('child1', 'parent', 'DONE'));
    tasksMap.set('child2', createDummyTask('child2', 'parent', 'TODO'));

    aggregator.recalculateStatuses(tasksMap);
    expect(tasksMap.get('parent')?.status).toBe('IN_PROGRESS');
  });

  it('should set parent status to TODO when ALL child tasks are TODO', () => {
    const tasksMap = new Map<string, Task>();
    tasksMap.set('parent', createDummyTask('parent', null, 'IN_PROGRESS'));
    tasksMap.set('child1', createDummyTask('child1', 'parent', 'TODO'));
    tasksMap.set('child2', createDummyTask('child2', 'parent', 'TODO'));

    aggregator.recalculateStatuses(tasksMap);
    expect(tasksMap.get('parent')?.status).toBe('TODO');
  });

  it('should recursively aggregate nested tree hierarchies', () => {
    const tasksMap = new Map<string, Task>();
    tasksMap.set('grandparent', createDummyTask('grandparent', null, 'TODO'));
    tasksMap.set('parent', createDummyTask('parent', 'grandparent', 'TODO'));
    tasksMap.set('child', createDummyTask('child', 'parent', 'DONE'));

    aggregator.recalculateStatuses(tasksMap);
    expect(tasksMap.get('parent')?.status).toBe('DONE');
    expect(tasksMap.get('grandparent')?.status).toBe('DONE');
  });
});
