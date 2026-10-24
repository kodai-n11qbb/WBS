import { Task } from './types.js';
import crypto from 'node:crypto';

export interface SpreadsheetSyncPayload {
  action: 'SYNC_MATRIX';
  matrix: string[][];
  backgrounds: string[][];
  fontColors: string[][];
}

export interface SpreadsheetSyncResult {
  success: boolean;
  message?: string;
  updatedRows?: number;
  timestamp?: string;
}

const DAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'];

/**
 * WBSタスク群から「縦軸WBS階層ツリー × 横軸日程カレンダー」の2次元ガントマトリクスを一括構築する
 */
export function buildSpreadsheetMatrix(
  tasks: Task[],
  baseDate: Date = new Date(),
  dayCount: number = 14
): SpreadsheetSyncPayload {
  const today = new Date(baseDate);
  today.setHours(0, 0, 0, 0);

  // 日付範囲の算出: 本日前2日 〜 本日後14日
  const startOffset = -2;
  const totalDays = dayCount + 3; // -2 〜 +14 = 17日間
  const dateColumns: Array<{ dateStr: string; headerLabel: string; timeKey: number; isToday: boolean }> = [];

  for (let i = 0; i < totalDays; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + startOffset + i);
    d.setHours(0, 0, 0, 0);

    const m = d.getMonth() + 1;
    const day = d.getDate();
    const dayOfWeek = DAY_NAMES[d.getDay()];
    const isToday = d.getTime() === today.getTime();
    const headerLabel = isToday ? `${m}/${day} (${dayOfWeek} 今日)` : `${m}/${day} (${dayOfWeek})`;

    const yyyy = d.getFullYear();
    const mm = String(m).padStart(2, '0');
    const dd = String(day).padStart(2, '0');
    const dateStr = `${yyyy}-${mm}-${dd}`;

    dateColumns.push({
      dateStr,
      headerLabel,
      timeKey: d.getTime(),
      isToday,
    });
  }

  const rangeStartTime = dateColumns[0].timeKey;
  const rangeEndTime = dateColumns[dateColumns.length - 1].timeKey + 86400000 - 1;

  // 1. ヘッダー行の作成
  const headerRow: string[] = [
    'No',
    'WBSタスク階層ツリー',
    'ステータス',
    '完了予定日',
    '📅 期日未設定',
    '◀ 過去',
    ...dateColumns.map((c) => c.headerLabel),
    '未来 ▶',
  ];

  const headerBgRow: string[] = [
    '#1e293b',
    '#1e293b',
    '#1e293b',
    '#1e293b',
    '#334155',
    '#334155',
    ...dateColumns.map((c) => (c.isToday ? '#0f766e' : '#1e293b')),
    '#334155',
  ];

  const headerFontRow: string[] = headerRow.map(() => '#ffffff');

  // 2. ツリー構造の構築（DFS探索）
  interface TreeNode {
    task: Task;
    children: TreeNode[];
  }

  const taskMap = new Map<string, TreeNode>();
  tasks.forEach((t) => taskMap.set(t.id, { task: t, children: [] }));

  const rootNodes: TreeNode[] = [];
  tasks.forEach((t) => {
    const node = taskMap.get(t.id)!;
    if (t.parentId && taskMap.has(t.parentId)) {
      taskMap.get(t.parentId)!.children.push(node);
    } else {
      rootNodes.push(node);
    }
  });

  const sortNodes = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => (a.task.orderIndex || 0) - (b.task.orderIndex || 0));
    nodes.forEach((n) => sortNodes(n.children));
  };
  sortNodes(rootNodes);

  interface FlatTreeItem {
    task: Task;
    displayName: string;
    depth: number;
  }

  const flatList: FlatTreeItem[] = [];

  function traverse(nodes: TreeNode[], depth: number, prefix: string) {
    nodes.forEach((node, idx) => {
      const isLast = idx === nodes.length - 1;
      let branch = '';
      if (depth === 0) {
        branch = node.children.length > 0 ? '▼ ' : '';
      } else {
        branch = prefix + (isLast ? '└─ ' : '├─ ');
      }

      const nextPrefix = depth === 0 ? '　' : prefix + (isLast ? '　　' : '│　');
      flatList.push({
        task: node.task,
        displayName: branch + node.task.title,
        depth,
      });

      if (node.children.length > 0) {
        traverse(node.children, depth + 1, nextPrefix);
      }
    });
  }

  traverse(rootNodes, 0, '');

  // 3. データ行の作成
  const dataRows: string[][] = [];
  const bgRows: string[][] = [];
  const fontRows: string[][] = [];

  const statusDisplayMap = {
    DONE: { label: '✔ 完了', bg: '#dcfce7', text: '#15803d' },
    IN_PROGRESS: { label: '■ 進行中', bg: '#fef3c7', text: '#b45309' },
    TODO: { label: '● 未着手', bg: '#e0f2fe', text: '#0369a1' },
  };

  flatList.forEach((item, index) => {
    const t = item.task;
    const rowNo = String(index + 1);
    const statusInfo = statusDisplayMap[t.status] || { label: t.status, bg: '#f1f5f9', text: '#475569' };

    let dueDateStr = '(未設定)';
    let dueTime = 0;
    if (t.dueDate) {
      const d = new Date(t.dueDate);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      dueDateStr = `${yyyy}-${mm}-${dd}`;
      dueTime = new Date(yyyy, d.getMonth(), d.getDate()).getTime();
    }

    const rowBg = index % 2 === 0 ? '#ffffff' : '#f8fafc';

    const rowVals: string[] = [rowNo, item.displayName, statusInfo.label, dueDateStr];
    const rowBgs: string[] = [rowBg, rowBg, statusInfo.bg, rowBg];
    const rowFonts: string[] = ['#64748b', '#0f172a', statusInfo.text, '#475569'];

    // ゾーン & 日付列判定
    let unscheduledCell = '';
    let pastCell = '';
    let futureCell = '';
    const dateCells = new Array(dateColumns.length).fill('');

    let unscheduledBg = rowBg;
    let pastBg = rowBg;
    let futureBg = rowBg;
    const dateBgs = new Array(dateColumns.length).fill(rowBg);

    let unscheduledFont = '#475569';
    let pastFont = '#475569';
    let futureFont = '#475569';
    const dateFonts = new Array(dateColumns.length).fill('#475569');

    if (!t.dueDate) {
      unscheduledCell = statusInfo.label;
      unscheduledBg = statusInfo.bg;
      unscheduledFont = statusInfo.text;
    } else {
      if (dueTime < rangeStartTime) {
        pastCell = statusInfo.label;
        pastBg = statusInfo.bg;
        pastFont = statusInfo.text;
      } else if (dueTime > rangeEndTime) {
        futureCell = statusInfo.label;
        futureBg = statusInfo.bg;
        futureFont = statusInfo.text;
      } else {
        const colIdx = dateColumns.findIndex((c) => c.timeKey === dueTime);
        if (colIdx !== -1) {
          dateCells[colIdx] = statusInfo.label;
          dateBgs[colIdx] = statusInfo.bg;
          dateFonts[colIdx] = statusInfo.text;
        }
      }
    }

    rowVals.push(unscheduledCell, pastCell, ...dateCells, futureCell);
    rowBgs.push(unscheduledBg, pastBg, ...dateBgs, futureBg);
    rowFonts.push(unscheduledFont, pastFont, ...dateFonts, futureFont);

    dataRows.push(rowVals);
    bgRows.push(rowBgs);
    fontRows.push(rowFonts);
  });

  return {
    action: 'SYNC_MATRIX',
    matrix: [headerRow, ...dataRows],
    backgrounds: [headerBgRow, ...bgRows],
    fontColors: [headerFontRow, ...fontRows],
  };
}

/**
 * データのハッシュ値を計算（差分検知用）
 */
export function computeMatrixHash(matrix: string[][]): string {
  return crypto.createHash('sha256').update(JSON.stringify(matrix)).digest('hex');
}

/**
 * Google Apps Script WebhookへマトリクスをPOST送信
 */
export async function pushToGoogleSpreadsheet(
  webhookUrl: string,
  payload: SpreadsheetSyncPayload,
  timeoutMs: number = 12000
): Promise<SpreadsheetSyncResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      redirect: 'follow', // GASのリダイレクト(HTTP 302)を自動追従
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!res.ok) {
      return {
        success: false,
        message: `HTTP エラー: ${res.status} ${res.statusText}`,
      };
    }

    const text = await res.text();
    let data: any = {};
    try {
      data = JSON.parse(text);
    } catch {
      data = { status: 'OK', raw: text };
    }

    if (data.status === 'OK') {
      return {
        success: true,
        updatedRows: data.updatedRows || payload.matrix.length,
        timestamp: data.timestamp || new Date().toISOString(),
      };
    } else {
      return {
        success: false,
        message: data.error || data.message || 'スプレッドシート側でエラーが発生しました',
      };
    }
  } catch (err: any) {
    clearTimeout(timer);
    return {
      success: false,
      message: err.name === 'AbortError' ? '通信がタイムアウトしました (12秒)' : (err.message || '接続エラー'),
    };
  }
}
