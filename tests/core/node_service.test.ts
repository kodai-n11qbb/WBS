import { describe, it, expect, beforeEach } from 'vitest';
import { NodeService } from '../../src/core/node_service.js';
import { InMemoryRepository } from '../../src/adapters/in_memory_repository.js';
import { MockPeerTransport } from '../mocks/mock_transport.js';
import { SyncEngine } from '../../src/domain/sync_engine.js';
import { StructuredTaskValidator } from '../../src/domain/task_validator.js';

describe('NodeService (with DI and Structured Tasks)', () => {
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

  it('should create a structured task when payload is valid', async () => {
    const event = await service.createStructuredTask('p1', {
      title: 'Valid Structured Task',
      intent: 'Verify end-to-end task creation via DI service',
      definitionOfDone: [{ id: 'd1', text: 'DoD 1', completed: false }],
      priority: 'HIGH',
    });

    expect(event.type).toBe('TASK_CREATED');
    expect(event.payload.title).toBe('Valid Structured Task');
    expect(event.payload.intent).toBe('Verify end-to-end task creation via DI service');

    const state = await service.getProjectState('p1');
    expect(state.tasks.size).toBe(1);
  });

  it('should throw error when payload violates structuring rules', async () => {
    await expect(
      service.createStructuredTask('p1', {
        title: 'Short',
        intent: '', // Missing intent
        definitionOfDone: [], // Missing DoD
      })
    ).rejects.toThrow('タスク作成失敗');
  });

  it('should delete task (Tombstone) and broadcast EVENT_BROADCAST', async () => {
    const createEvent = await service.createStructuredTask('p1', {
      title: 'Task To Be Deleted',
      intent: 'Testing Tombstone deletion',
      definitionOfDone: [{ id: 'd1', text: 'DoD 1', completed: false }],
    });

    const taskId = createEvent.payload.taskId;
    expect((await service.getProjectState('p1')).tasks.size).toBe(1);

    await service.deleteTask('p1', taskId);
    expect((await service.getProjectState('p1')).tasks.size).toBe(0);

    // Check broadcast message
    const lastBroadcast = transport.broadcastedMessages[transport.broadcastedMessages.length - 1];
    expect(lastBroadcast.type).toBe('EVENT_BROADCAST');
    if (lastBroadcast.type === 'EVENT_BROADCAST') {
      expect(lastBroadcast.event.type).toBe('TASK_DELETED');
    }
  });

  it('should reorder task via drag & drop and broadcast event', async () => {
    const createEvent = await service.createStructuredTask('p1', {
      title: 'Task To Be Reordered',
      intent: 'Testing Drag and Drop Reordering',
      definitionOfDone: [{ id: 'd1', text: 'DoD 1', completed: false }],
    });

    const taskId = createEvent.payload.taskId;
    await service.reorderTask('p1', taskId, 5);

    const state = await service.getProjectState('p1');
    expect(state.tasks.get(taskId)?.orderIndex).toBe(5);
  });
});
