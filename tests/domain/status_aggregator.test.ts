import { describe, it, expect } from 'vitest';
import { StatusAggregator } from '../../src/domain/status_aggregator.js';
import { Task } from '../../src/domain/types.js';

describe('StatusAggregator (Completion Rate & Parent Status)', () => {
  const aggregator = new StatusAggregator();

  const createDummyTask = (id: string, parentId: string | null, status: 'TODO' | 'IN_PROGRESS' | 'DONE'): Task => ({
    id,
    projectId: 'p1',
    parentId,
    title: `Task ${id}`,
    priority: 'MEDIUM',
    status,
    orderIndex: 0,
    updatedAt: 1000,
    authorNodeId: 'node-1',
  });

  it('should calculate completion rate for parent task correctly', () => {
    const tasksMap = new Map<string, Task>();
    tasksMap.set('parent', createDummyTask('parent', null, 'TODO'));
    tasksMap.set('child1', createDummyTask('child1', 'parent', 'DONE'));
    tasksMap.set('child2', createDummyTask('child2', 'parent', 'DONE'));
    tasksMap.set('child3', createDummyTask('child3', 'parent', 'TODO'));

    const rate = aggregator.calculateCompletionRate('parent', tasksMap);
    expect(rate.total).toBe(3);
    expect(rate.completed).toBe(2);
    expect(rate.percentage).toBe(66.7);
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
});
