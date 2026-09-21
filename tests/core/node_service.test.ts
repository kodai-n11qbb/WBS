import { describe, it, expect, beforeEach } from 'vitest';
import { NodeService } from '../../src/core/node_service.js';
import { InMemoryRepository } from '../../src/adapters/in_memory_repository.js';
import { MockPeerTransport } from '../mocks/mock_transport.js';
import { SyncEngine } from '../../src/domain/sync_engine.js';

describe('NodeService (with Dependency Injection)', () => {
  let repository: InMemoryRepository;
  let transport: MockPeerTransport;
  let syncEngine: SyncEngine;
  let service: NodeService;

  beforeEach(() => {
    repository = new InMemoryRepository();
    transport = new MockPeerTransport();
    syncEngine = new SyncEngine();
    
    // Inject dependencies into NodeService
    service = new NodeService({
      nodeId: 'test-node-1',
      repository,
      transport,
      syncEngine,
    });
  });

  it('should create a new task, save it locally, and broadcast via transport', async () => {
    const event = await service.createTask('p1', 'Test Task', 'TODO');
    
    expect(event.projectId).toBe('p1');
    expect(event.payload.title).toBe('Test Task');

    // Check local repository
    const storedEvents = await repository.getAllEvents();
    expect(storedEvents).toHaveLength(1);
    expect(storedEvents[0].id).toBe(event.id);

    // Check transport broadcast
    expect(transport.broadcastedMessages).toHaveLength(1);
    expect(transport.broadcastedMessages[0].type).toBe('EVENT_BROADCAST');
  });

  it('should receive broadcast from peer and integrate into state', async () => {
    const remoteEvent = {
      id: 'e-remote-1',
      projectId: 'p1',
      authorNodeId: 'node-remote',
      timestamp: 2000,
      sequence: 1,
      type: 'TASK_CREATED' as const,
      payload: { taskId: 't-remote', title: 'Remote Task', status: 'IN_PROGRESS' },
    };

    // Simulate incoming transport message
    await transport.simulateIncomingMessage(
      { nodeId: 'node-remote', address: '192.168.1.50', port: 8080, lastSeen: Date.now() },
      { type: 'EVENT_BROADCAST', event: remoteEvent }
    );

    const state = await service.getProjectState('p1');
    expect(state.tasks.get('t-remote')?.title).toBe('Remote Task');
    expect(state.tasks.get('t-remote')?.status).toBe('IN_PROGRESS');
  });
});
