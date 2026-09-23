import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { JsonStateSnapshotExporter } from '../../src/adapters/snapshot_exporter.js';
import { ProjectState } from '../../src/domain/types.js';

describe('JsonStateSnapshotExporter (State Snapshot Exporter)', () => {
  const testDir = path.join(process.cwd(), 'tests', 'scratch_test_dir');
  const snapshotPath = path.join(testDir, 'test_state.json');

  beforeEach(() => {
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should save project state into a clean, human-readable state.json snapshot file', async () => {
    const exporter = new JsonStateSnapshotExporter(snapshotPath);

    const mockState: ProjectState = {
      project: { id: 'p1', name: 'Test Project', createdAt: 1000 },
      tasks: new Map([
        [
          't1',
          {
            id: 't1',
            projectId: 'p1',
            parentId: null,
            title: 'Root Task 1',
            status: 'TODO',
            priority: 'MEDIUM',
            orderIndex: 100,
            isCollapsed: false,
            updatedAt: 1000,
            authorNodeId: 'n1',
          },
        ],
        [
          't2',
          {
            id: 't2',
            projectId: 'p1',
            parentId: 't1',
            title: 'Subtask 1',
            status: 'DONE',
            priority: 'HIGH',
            orderIndex: 200,
            isCollapsed: false,
            updatedAt: 2000,
            authorNodeId: 'n1',
          },
        ],
      ]),
    };

    await exporter.saveSnapshot(mockState);

    expect(fs.existsSync(snapshotPath)).toBe(true);

    const fileContent = fs.readFileSync(snapshotPath, 'utf-8');
    const parsedData = JSON.parse(fileContent);

    expect(parsedData.projectId).toBe('p1');
    expect(parsedData.projectName).toBe('Test Project');
    expect(parsedData.totalTasks).toBe(2);
    expect(parsedData.tasks).toHaveLength(2);
    expect(parsedData.tasks[0].id).toBe('t1');
    expect(parsedData.tasks[0].parentId).toBeNull();
    expect(parsedData.tasks[1].id).toBe('t2');
    expect(parsedData.tasks[1].parentId).toBe('t1');
  });

  it('should load snapshot correctly when file exists, or return null if file does not exist', async () => {
    const exporter = new JsonStateSnapshotExporter(snapshotPath);

    const nonExistentSnapshot = await exporter.loadSnapshot();
    expect(nonExistentSnapshot).toBeNull();

    const mockData = {
      projectId: 'p2',
      projectName: 'Loaded Project',
      totalTasks: 1,
      tasks: [
        {
          id: 't_loaded',
          projectId: 'p2',
          parentId: null,
          title: 'Existing Task',
          status: 'IN_PROGRESS',
          priority: 'HIGH',
          orderIndex: 10,
          isCollapsed: false,
          updatedAt: 3000,
          authorNodeId: 'n_host',
        },
      ],
    };

    fs.writeFileSync(snapshotPath, JSON.stringify(mockData, null, 2), 'utf-8');

    const loadedSnapshot = await exporter.loadSnapshot();
    expect(loadedSnapshot).not.toBeNull();
    expect(loadedSnapshot?.projectId).toBe('p2');
    expect(loadedSnapshot?.projectName).toBe('Loaded Project');
    expect(loadedSnapshot?.tasks).toHaveLength(1);
    expect(loadedSnapshot?.tasks[0].id).toBe('t_loaded');
    expect(loadedSnapshot?.tasks[0].title).toBe('Existing Task');
  });
});
