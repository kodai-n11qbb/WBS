import { describe, it, expect } from 'vitest';
import { buildSpreadsheetMatrix, computeMatrixHash } from '../../src/domain/spreadsheet_sync_service.js';
import { Task } from '../../src/domain/types.js';

describe('SpreadsheetSyncService', () => {
  const baseDate = new Date(2026, 9, 24, 10, 0, 0); // 2026-10-24 10:00:00

  const sampleTasks: Task[] = [
    {
      id: 'task-root-1',
      projectId: 'p-1',
      parentId: null,
      title: '親タスクA: Webリニューアル',
      status: 'IN_PROGRESS',
      priority: 'HIGH',
      orderIndex: 1,
      dueDate: new Date(2026, 11, 1).getTime(), // 2026-12-01 (未来ゾーン)
      updatedAt: 100,
      authorNodeId: 'node-1',
    },
    {
      id: 'task-child-1',
      projectId: 'p-1',
      parentId: 'task-root-1',
      title: '要件定義',
      status: 'DONE',
      priority: 'HIGH',
      orderIndex: 1,
      dueDate: new Date(2026, 9, 22).getTime(), // 2026-10-22 (範囲内)
      updatedAt: 101,
      authorNodeId: 'node-1',
    },
    {
      id: 'task-child-2',
      projectId: 'p-1',
      parentId: 'task-root-1',
      title: '過去のメモ作成',
      status: 'DONE',
      priority: 'LOW',
      orderIndex: 2,
      dueDate: new Date(2026, 9, 10).getTime(), // 2026-10-10 (過去ゾーン)
      updatedAt: 102,
      authorNodeId: 'node-1',
    },
    {
      id: 'task-isolated-1',
      projectId: 'p-1',
      parentId: null,
      title: '未定の単独タスク',
      status: 'TODO',
      priority: 'MEDIUM',
      orderIndex: 2,
      dueDate: null, // 期日未設定
      updatedAt: 103,
      authorNodeId: 'node-1',
    },
  ];

  it('WBS階層ツリーと日程マトリクスを正しく2次元配列に構築できること', () => {
    const payload = buildSpreadsheetMatrix(sampleTasks, baseDate, 14);

    expect(payload.action).toBe('SYNC_MATRIX');
    expect(payload.matrix.length).toBe(5); // ヘッダー + 4タスク
    expect(payload.backgrounds.length).toBe(5);
    expect(payload.fontColors.length).toBe(5);

    const header = payload.matrix[0];
    expect(header[0]).toBe('No');
    expect(header[1]).toBe('WBSタスク階層ツリー');
    expect(header[2]).toBe('ステータス');
    expect(header[3]).toBe('完了予定日');
    expect(header[4]).toBe('📅 期日未設定');
    expect(header[5]).toBe('◀ 過去');

    // 本日のヘッダー列が存在すること (10/24 土 今日)
    const todayColIdx = header.findIndex((h) => h.includes('今日'));
    expect(todayColIdx).toBeGreaterThan(5);

    // 1行目: 親タスクA (未来ゾーンに配置)
    const row1 = payload.matrix[1];
    expect(row1[0]).toBe('1');
    expect(row1[1]).toContain('▼ 親タスクA');
    expect(row1[2]).toBe('■ 進行中');
    expect(row1[3]).toBe('2026-12-01');
    expect(row1[row1.length - 1]).toBe('■ 進行中'); // 未来列にマーク

    // 2行目: 子タスク (要件定義, 10/22 の列に配置)
    const row2 = payload.matrix[2];
    expect(row2[1]).toContain('├─ 要件定義');
    expect(row2[2]).toBe('✔ 完了');
    const oct22ColIdx = header.findIndex((h) => h.startsWith('10/22'));
    expect(oct22ColIdx).toBeGreaterThan(0);
    expect(row2[oct22ColIdx]).toBe('✔ 完了');

    // 3行目: 過去のメモ作成 (過去列に配置)
    const row3 = payload.matrix[3];
    expect(row3[1]).toContain('└─ 過去のメモ作成');
    expect(row3[5]).toBe('✔ 完了'); // ◀ 過去列

    // 4行目: 未定の単独タスク (期日未設定列に配置)
    const row4 = payload.matrix[4];
    expect(row4[1]).toBe('未定の単独タスク'); // 単独タスクは▼なし
    expect(row4[2]).toBe('● 未着手');
    expect(row4[3]).toBe('(未設定)');
    expect(row4[4]).toBe('● 未着手'); // 📅 期日未設定列
  });

  it('マトリクスのハッシュ値計算が安定し、内容変更を検知できること', () => {
    const payload1 = buildSpreadsheetMatrix(sampleTasks, baseDate, 14);
    const hash1 = computeMatrixHash(payload1.matrix);
    const hash1Again = computeMatrixHash(payload1.matrix);
    expect(hash1).toBe(hash1Again);

    // タスクタイトル変更
    const modifiedTasks = [...sampleTasks];
    modifiedTasks[0] = { ...modifiedTasks[0], title: 'タイトル変更' };
    const payload2 = buildSpreadsheetMatrix(modifiedTasks, baseDate, 14);
    const hash2 = computeMatrixHash(payload2.matrix);

    expect(hash1).not.toBe(hash2);
  });
});
