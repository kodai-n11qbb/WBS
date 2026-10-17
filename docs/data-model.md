# 3.3 データモデル (data-model.md)

[ドキュメントインデックスへ戻る](./index.md) | [前へ: 技術スタック](./tech-stack.md) | [次へ: API設計](./api-design.md)

---

## 1. コアエンティティ定義

### (1) タスクエンティティ (`Task`)
プロジェクトを構成する個々のタスクを表現するドメインモデル。

```typescript
export type TaskStatus = 'TODO' | 'IN_PROGRESS' | 'DONE';
export type TaskPriority = 'HIGH' | 'MEDIUM' | 'LOW';

export interface Task {
  id: string;               // UUID (一意の識別子)
  projectId: string;        // 所属プロジェクトID
  parentId?: string | null; // 親タスクID (nullまたは未定義時はルートノード)
  title: string;            // タスク名 (唯一の必須入力項目)
  priority: TaskPriority;   // 優先度 ('HIGH' | 'MEDIUM' | 'LOW')
  status: TaskStatus;       // 状態 ('TODO' | 'IN_PROGRESS' | 'DONE')
  orderIndex: number;       // 表示順序ソートキー
  dueDate?: number | null;  // 完了予定日 (ミリ秒タイムスタンプ)。IN_PROGRESS時は必須
  isCollapsed?: boolean;    // サブツリー折りたたみ状態 (UIローカル)
  assignedNodeId?: string;  // 担当ノードID
  updatedAt: number;        // 最終更新ミリ秒タイムスタンプ
  authorNodeId: string;     // 最終更新を行ったノードID (Undo判定に使用)
}
```

### (2) プロジェクトエンティティ (`Project`)
```typescript
export interface Project {
  id: string;        // プロジェクトID (例: "default-project")
  name: string;      // プロジェクト名
  createdAt: number; // 作成ミリ秒タイムスタンプ
}
```

---

## 2. イベントモデル (`SyncEvent`)

WBSer はイベントソーシングを採用しており、すべての状態変更は不可変な `SyncEvent` として `events.jsonl` に記録されます。

```typescript
export type EventType =
  | 'PROJECT_CREATED'        // プロジェクト初期化
  | 'TASK_CREATED'           // タスク新規作成
  | 'TASK_STATUS_UPDATED'    // ステータス更新 (IN_PROGRESS時はdueDate必須)
  | 'TASK_TITLE_UPDATED'     // タスク名更新
  | 'TASK_DUE_DATE_UPDATED'  // 完了予定日更新
  | 'TASK_REORDERED'         // 表示順序更新
  | 'TASK_PARENT_CHANGED'    // 親タスク変更 (ツリー構造組み換え)
  | 'TASK_COLLAPSE_TOGGLED'  // 折りたたみ切替
  | 'TASK_DELETED'           // タスク削除 (3子要素以上の場合はreason必須)
  | 'UNDO_ACTION';           // 端末単位の直前アクション取り消し

export interface SyncEvent {
  id: string;               // イベント固有のUUID (重複排除キー)
  projectId: string;        // 対象プロジェクトID
  authorNodeId: string;     // 発行元端末ノードID
  timestamp: number;        // 発生日時 (Unixミリ秒)
  sequence: number;         // ノードローカルのシーケンス番号
  type: EventType;          // イベント種別
  previousHash?: string;    // 改ざん検証用 直前ハッシュ (任意)
  hash?: string;            // このイベントのハッシュ値 (任意)
  payload: Record<string, any>; // イベント固有の変更データ
}
```

### 各イベントのペイロード (`payload`) 仕様
- **`TASK_CREATED`**: `{ task: Task }`
- **`TASK_STATUS_UPDATED`**: `{ taskId: string, status: TaskStatus, dueDate?: number | null }`
- **`TASK_TITLE_UPDATED`**: `{ taskId: string, title: string }`
- **`TASK_DUE_DATE_UPDATED`**: `{ taskId: string, dueDate: number | null }`
- **`TASK_PARENT_CHANGED`**: `{ taskId: string, newParentId: string | null }`
- **`TASK_DELETED`**: `{ taskId: string, reason?: string, deletedSnapshot?: Task }`
- **`UNDO_ACTION`**: `{ targetEventId: string, revertedEventType: EventType, inversePayload: any }`

---

## 3. 状態スナップショット (`state.json`)

`events.jsonl` を先頭から順次適用して集約された現在の最新タスク状態。

```json
{
  "projectId": "default-project",
  "updatedAt": 1789980033297,
  "tasks": [
    {
      "id": "86c31535-fbca-4083-85bb-4007efab4f08",
      "projectId": "default-project",
      "title": "設計ドキュメントの更新",
      "status": "IN_PROGRESS",
      "parentId": null,
      "priority": "MEDIUM",
      "orderIndex": 1789980009938,
      "dueDate": 1792454400000,
      "updatedAt": 1789980033297,
      "authorNodeId": "dev-node-1"
    }
  ]
}
```

---

## 4. 設定スキーマ (`config.json`)

```json
{
  "mode": "P2P",
  "dataDir": "/Users/abekoudai/Desktop/WBSer/data",
  "hostAddress": "192.168.1.50:3000",
  "port": 3000,
  "nodeName": "node-dev1",
  "autoOpen": true,
  "watchMode": "auto"
}
```

| プロパティ | 型 | デフォルト | 説明 |
| :--- | :--- | :--- | :--- |
| `mode` | `'P2P' \| 'CLIENT' \| 'HOST'` | `'P2P'` | システム動作モード |
| `dataDir` | `string` | `"data"` | データ保存ディレクトリの絶対パス |
| `hostAddress` | `string` | `""` | CLIENTモード時の接続先親機アドレス |
| `port` | `number` | `3000` | 内部Web/WebSocketサーバーのリッスンポート |
| `nodeName` | `string` | 自動生成UUID | 自端末ノードの識別表示名 |
| `autoOpen` | `boolean` | `true` | 起動時に既定ブラウザを自動オープンするか否か |
| `watchMode` | `'auto' \| 'fs' \| 'polling' \| 'off'` | `'auto'` | 外部ファイル監視方式 |
