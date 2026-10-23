import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { JsonlFileRepository } from '../src/adapters/jsonl_repository.js';
import { JsonStateSnapshotExporter } from '../src/adapters/snapshot_exporter.js';
import { NodeService } from '../src/core/node_service.js';
import { MockPeerTransport } from './mocks/mock_transport.js';
import { SyncEngine } from '../src/domain/sync_engine.js';
import { StructuredTaskValidator } from '../src/domain/task_validator.js';

describe('Bootstrap near-term sample tasks logic', () => {
  const testDir = path.join(process.cwd(), 'tests', 'scratch_bootstrap_test');
  const dataFile = path.join(testDir, 'events.jsonl');
  const snapshotFile = path.join(testDir, 'state.json');

  beforeEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should generate near-term fictional tasks when no tasks exist', async () => {
    const repository = new JsonlFileRepository(dataFile);
    await repository.init();
    const snapshotExporter = new JsonStateSnapshotExporter(snapshotFile);
    const transport = new MockPeerTransport();
    const syncEngine = new SyncEngine();
    const validator = new StructuredTaskValidator();

    const nodeService = new NodeService({
      nodeId: 'test-bootstrap-node',
      repository,
      transport,
      syncEngine,
      validator,
      snapshotExporter,
    });

    let activeProjectId = 'default-project';

    // Simulate bootstrap check
    const existingSnapshot = await snapshotExporter.loadSnapshot();
    const allEvents = await nodeService.getAllEvents();

    const existingProjectEvent = allEvents.find((e) => e.type === 'PROJECT_CREATED');
    if (existingSnapshot && existingSnapshot.projectId) {
      activeProjectId = existingSnapshot.projectId;
    } else if (existingProjectEvent && existingProjectEvent.projectId) {
      activeProjectId = existingProjectEvent.projectId;
    }

    const hasSnapshotTasks = Boolean(
      existingSnapshot && Array.isArray(existingSnapshot.tasks) && existingSnapshot.tasks.length > 0
    );
    const hasEventTasks = allEvents.some((e) => e.type === 'TASK_CREATED');

    expect(hasSnapshotTasks).toBe(false);
    expect(hasEventTasks).toBe(false);

    // Bootstrap execution
    if (!existingProjectEvent) {
      const projEvt = await nodeService.createProject('LAN Share-Log Project');
      activeProjectId = projEvt.projectId;
    }

    const now = Date.now();
    const DAY_MS = 86400000;
    const getTargetDate = (daysOffset: number): number => {
      const d = new Date(now + daysOffset * DAY_MS);
      d.setHours(23, 59, 59, 999);
      return d.getTime();
    };

    // 1. 親タスク: Webサービス リニューアルPJ
    const root1 = await nodeService.createTask(activeProjectId, {
      title: '親タスク: Webサービス リニューアルPJ',
      priority: 'HIGH',
      status: 'IN_PROGRESS',
      orderIndex: 1,
      dueDate: getTargetDate(12),
    });
    const root1Id = root1.payload.taskId;

    // 1-1. 中階層: 要件定義・基本設計 (DONE)
    const mid1 = await nodeService.createTask(activeProjectId, {
      parentId: root1Id,
      title: '中階層: 要件定義・基本設計',
      priority: 'HIGH',
      status: 'DONE',
      orderIndex: 1,
      dueDate: getTargetDate(-2),
    });
    const mid1Id = mid1.payload.taskId;

    await nodeService.createTask(activeProjectId, {
      parentId: mid1Id,
      title: '子タスク: Local-First同期プロトコル策定',
      status: 'DONE',
      priority: 'HIGH',
      orderIndex: 1,
      dueDate: getTargetDate(-4),
    });

    await nodeService.createTask(activeProjectId, {
      parentId: mid1Id,
      title: '子タスク: データスキーマ＆JSONL仕様確定',
      status: 'DONE',
      priority: 'MEDIUM',
      orderIndex: 2,
      dueDate: getTargetDate(-2),
    });

    // 1-2. 中階層: フロントエンド＆UI実装 (IN_PROGRESS)
    const mid2 = await nodeService.createTask(activeProjectId, {
      parentId: root1Id,
      title: '中階層: フロントエンド＆UI実装',
      priority: 'HIGH',
      status: 'IN_PROGRESS',
      orderIndex: 2,
      dueDate: getTargetDate(5),
    });
    const mid2Id = mid2.payload.taskId;

    await nodeService.createTask(activeProjectId, {
      parentId: mid2Id,
      title: '子タスク: Obsidian風ノードグラフの物理演算調整',
      status: 'DONE',
      priority: 'MEDIUM',
      orderIndex: 1,
      dueDate: getTargetDate(-1),
    });

    await nodeService.createTask(activeProjectId, {
      parentId: mid2Id,
      title: '子タスク: タイムライン・ガントチャート描画の実装',
      status: 'IN_PROGRESS',
      priority: 'HIGH',
      orderIndex: 2,
      dueDate: getTargetDate(2),
    });

    await nodeService.createTask(activeProjectId, {
      parentId: mid2Id,
      title: '子タスク: WebSocketリアルタイム反映の検証',
      status: 'TODO',
      priority: 'HIGH',
      orderIndex: 3,
      dueDate: getTargetDate(5),
    });

    // 1-3. 中階層: テスト＆リリース準備 (TODO)
    const mid3 = await nodeService.createTask(activeProjectId, {
      parentId: root1Id,
      title: '中階層: テスト＆リリース準備',
      priority: 'MEDIUM',
      status: 'TODO',
      orderIndex: 3,
      dueDate: getTargetDate(10),
    });
    const mid3Id = mid3.payload.taskId;

    await nodeService.createTask(activeProjectId, {
      parentId: mid3Id,
      title: '子タスク: 複数ノード間P2P同期の結合テスト',
      status: 'TODO',
      priority: 'MEDIUM',
      orderIndex: 1,
      dueDate: getTargetDate(8),
    });

    await nodeService.createTask(activeProjectId, {
      parentId: mid3Id,
      title: '子タスク: スタンドアロンバイナリのパッケージング',
      status: 'TODO',
      priority: 'LOW',
      orderIndex: 2,
      dueDate: getTargetDate(10),
    });

    // 2. 独立タスク: 全体キックオフ＆進捗定例ミーティング
    await nodeService.createTask(activeProjectId, {
      title: '独立タスク: 全体キックオフ＆進捗定例ミーティング',
      priority: 'HIGH',
      status: 'IN_PROGRESS',
      orderIndex: 2,
      dueDate: getTargetDate(1),
    });

    const state = await nodeService.getProjectState(activeProjectId);
    expect(state.tasks.size).toBe(12);

    const tasks = Array.from(state.tasks.values());
    const inProgressTasks = tasks.filter((t) => t.status === 'IN_PROGRESS');
    expect(inProgressTasks.length).toBeGreaterThan(0);

    const doneTasks = tasks.filter((t) => t.status === 'DONE');
    expect(doneTasks.length).toBeGreaterThan(0);

    const todoTasks = tasks.filter((t) => t.status === 'TODO');
    expect(todoTasks.length).toBeGreaterThan(0);

    // Verify snapshot was created
    const savedSnapshot = await snapshotExporter.loadSnapshot();
    expect(savedSnapshot).not.toBeNull();
    expect(savedSnapshot?.tasks.length).toBe(12);
  });
});
