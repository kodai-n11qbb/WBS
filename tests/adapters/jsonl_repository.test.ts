import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { JsonlFileRepository } from '../../src/adapters/jsonl_repository.js';
import { SyncEvent } from '../../src/domain/types.js';

describe('JsonlFileRepository', () => {
  const testDir = path.join(__dirname, '../temp_test_data');
  const filePath = path.join(testDir, 'test_events.jsonl');

  beforeEach(() => {
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  });

  afterEach(() => {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    if (fs.existsSync(testDir)) {
      fs.rmdirSync(testDir);
    }
  });

  it('should save single event and append to jsonl file', async () => {
    const repo = new JsonlFileRepository(filePath);
    await repo.init();

    const event: SyncEvent = {
      id: 'e1',
      projectId: 'p1',
      authorNodeId: 'node-1',
      timestamp: 1000,
      sequence: 1,
      type: 'PROJECT_CREATED',
      payload: { name: 'Test Project' },
    };

    const saved = await repo.saveEvent(event);
    expect(saved).toBe(true);

    const allEvents = await repo.getAllEvents();
    expect(allEvents).toHaveLength(1);
    expect(allEvents[0].id).toBe('e1');

    // Verify file content
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    expect(fileContent).toContain('"id":"e1"');
  });

  it('should reload events from existing jsonl file upon re-initialization', async () => {
    const repo1 = new JsonlFileRepository(filePath);
    await repo1.init();

    await repo1.saveEvent({
      id: 'e1',
      projectId: 'p1',
      authorNodeId: 'node-1',
      timestamp: 1000,
      sequence: 1,
      type: 'PROJECT_CREATED',
      payload: { name: 'Test Project' },
    });

    await repo1.saveEvent({
      id: 'e2',
      projectId: 'p1',
      authorNodeId: 'node-1',
      timestamp: 1001,
      sequence: 2,
      type: 'TASK_CREATED',
      payload: { taskId: 't1', title: 'Task Title', status: 'TODO', orderIndex: 0 },
    });

    // Create new repo instance pointing to the same file (simulating app restart)
    const repo2 = new JsonlFileRepository(filePath);
    await repo2.init();

    const reloadedEvents = await repo2.getAllEvents();
    expect(reloadedEvents).toHaveLength(2);
    expect(reloadedEvents[1].id).toBe('e2');
  });

  it('should dynamically reload events from disk when file is externally modified', async () => {
    const repo = new JsonlFileRepository(filePath);
    await repo.init();

    await repo.saveEvent({
      id: 'e1',
      projectId: 'p1',
      authorNodeId: 'node-1',
      timestamp: 1000,
      sequence: 1,
      type: 'PROJECT_CREATED',
      payload: { name: 'Test Project' },
    });

    expect(await repo.getAllEvents()).toHaveLength(1);

    // Simulate external process appending a new event line to the jsonl file directly
    const externalEvent: SyncEvent = {
      id: 'e_external_1',
      projectId: 'p1',
      authorNodeId: 'external-node',
      timestamp: 2000,
      sequence: 2,
      type: 'TASK_CREATED',
      payload: { taskId: 't_ext', title: 'External Task', status: 'TODO', orderIndex: 1 },
    };

    fs.appendFileSync(filePath, JSON.stringify(externalEvent) + '\n', 'utf-8');

    // Call reloadFromDisk
    const newCount = await repo.reloadFromDisk();
    expect(newCount).toBe(1);

    const updatedEvents = await repo.getAllEvents();
    expect(updatedEvents).toHaveLength(2);
    expect(updatedEvents.some((e) => e.id === 'e_external_1')).toBe(true);
  });
});
