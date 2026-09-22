import { describe, it, expect, beforeEach } from 'vitest';
import { NodeService } from '../../src/core/node_service.js';
import { InMemoryRepository } from '../../src/adapters/in_memory_repository.js';
import { MockPeerTransport } from '../mocks/mock_transport.js';
import { SyncEngine } from '../../src/domain/sync_engine.js';
import { StructuredTaskValidator } from '../../src/domain/task_validator.js';

describe('NodeService (with Tree Tasks & Flexible Attributes)', () => {
  let repository: InMemoryRepository;
  let transport: MockPeerTransport;
  let syncEngine: SyncEngine;
  let validator: StructuredTaskValidator;
  let service: NodeService;

  beforeEach(() => {
    repository = new InMemoryRepository();
    transport = new MockPeerTransport();
    syncEngine = new SyncEngine();
    validator = new StructuredTaskValidator();

    service = new NodeService({
      nodeId: 'test-node-1',
      repository,
      transport,
      syncEngine,
      validator,
    });
  });

  it('should create task with title only (optional attributes omitted)', async () => {
    const event = await service.createTask('p1', {
      title: 'Simple Title Only Task',
    });

    expect(event.type).toBe('TASK_CREATED');
    expect(event.payload.title).toBe('Simple Title Only Task');

    const state = await service.getProjectState('p1');
    expect(state.tasks.size).toBe(1);
    expect(state.tasks.get(event.payload.taskId)?.title).toBe('Simple Title Only Task');
  });

  it('should create child task linked to parentId', async () => {
    const parentEvent = await service.createTask('p1', { title: 'Parent Task' });
    const parentId = parentEvent.payload.taskId;

    const childEvent = await service.createTask('p1', {
      parentId,
      title: 'Child Subtask',
    });

    expect(childEvent.payload.parentId).toBe(parentId);

    const state = await service.getProjectState('p1');
    expect(state.tasks.get(childEvent.payload.taskId)?.parentId).toBe(parentId);
  });

  it('should change task parent hierarchy via changeTaskParent', async () => {
    const taskEvent = await service.createTask('p1', { title: 'Standalone Task' });
    const taskId = taskEvent.payload.taskId;

    await service.changeTaskParent('p1', taskId, 'new-parent-id');

    const state = await service.getProjectState('p1');
    expect(state.tasks.get(taskId)?.parentId).toBe('new-parent-id');
  });

  it('should update task title via updateTaskTitle', async () => {
    const taskEvent = await service.createTask('p1', { title: 'Initial Title' });
    const taskId = taskEvent.payload.taskId;

    await service.updateTaskTitle('p1', taskId, 'Updated Title via NodeService');

    const state = await service.getProjectState('p1');
    expect(state.tasks.get(taskId)?.title).toBe('Updated Title via NodeService');
  });

  it('should throw error when updating task title to empty string', async () => {
    const taskEvent = await service.createTask('p1', { title: 'Valid Title' });
    const taskId = taskEvent.payload.taskId;

    await expect(service.updateTaskTitle('p1', taskId, '   ')).rejects.toThrow(
      'タスクタイトルは空にできません'
    );
  });
});

