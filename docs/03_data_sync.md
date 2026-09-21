# 03. データモデルと同期仕様

[インデックスへ戻る](./index.md) | [前へ: アーキテクチャ抽象](./02_architecture.md)

---

## 1. ドメインモデルエンティティ（Local-First 原則）

オフライン時の独立編集と接続時の自動マージを実現するため、直接上書き更新ではなく **「イベントログの集約（Event Sourcing）」** および **「Gitライクなハッシュチェーンログ (JSONL)」** の原則を採用します。

### 主要概念
- **Project**: 管理対象のプロジェクト枠組み（ID, Name, CreatedAt, OwnerNodeId）
- **Task Tree**: 階層構造（ツリー）および柔軟なオプション属性を持つ作業項目（下記参照）
- **Member / Node**: ネットワーク内の参加者ノード（NodeID, DisplayName, LastSeenAt）
- **Git-like Event Log**: 履歴追跡を可能にする不変 (Immutable) な JSONL レコード

---

## 2. タスクデータ仕様 (Task Spec & Optional Attributes)

タスク登録のハードルを下げつつ、階層構造（ツリー関係）と必要に応じた詳細情報を保持できるデータ構造です。

```typescript
export interface DefinitionOfDoneItem {
  id: string;
  text: string;
  completed: boolean;
}

export interface Task {
  id: string;
  projectId: string;
  parentId?: string | null;      // 【ツリー構造】親タスクのID（nullの場合はルートタスク）
  childTaskIds: string[];        // 【ツリー構造】子タスク（サブタスク）のID一覧
  title: string;                 // 【必須】タスクの概要名
  intent?: string;               // 【オプション】目的・背景 (Why)
  definitionOfDone?: DefinitionOfDoneItem[]; // 【オプション】完了条件チェックリスト
  priority: 'HIGH' | 'MEDIUM' | 'LOW';     // 必須: 優先度（デフォルト: MEDIUM）
  status: 'TODO' | 'IN_PROGRESS' | 'DONE';  // 必須: ステータス
  orderIndex: number;            // 必須: 表示順序（Drag & Drop移動用）
  assignedNodeId?: string;
  updatedAt: number;
  authorNodeId: string;
}
```

### バリデーションルール (Domain Rule)
1. **タスクタイトル**: 空白を除き 1 文字以上であること（入力必須）。
2. **オプション属性**: `intent` や `definitionOfDone` は未入力・空配列でも正常に登録可能。
3. **ツリー整合性チェック**: 自分自身を親に指定することや、循環参照（A ➔ B ➔ A）を禁止。

---

## 3. Gitライクな JSONL 履歴追跡ログ仕様 (Git-like Audit Log)

すべての操作は改ざん不能な Git ライクなイベントログとして `.jsonl` ファイル（1行1JSON）に追記（Append-Only）されます。

```json
{
  "id": "evt-uuid-001",
  "projectId": "p1",
  "authorNodeId": "node-alpha",
  "timestamp": 1700000000000,
  "sequence": 1,
  "type": "TASK_CREATED",
  "previousHash": "00000000000000000000000000000000",
  "hash": "a1b2c3d4e5f6...",
  "payload": {
    "taskId": "t-100",
    "parentId": null,
    "title": "管理ツールの設計",
    "intent": "LAN内での分散型プロジェクト進行を可能にするため（※任意）",
    "definitionOfDone": []
  }
}
```

### 履歴追跡（`git log` 相当）のメリット
- **完全な監査トレイル (Audit Trail)**: いつ、誰が、どの端末から、どのようにタスクを作成・階層移動・変更・削除したのかを 100% 過去へ遡って検証可能。
- **ポータビリティ**: `events.jsonl` ファイル1本をUSBや他ネットワークにコピーするだけで、変更履歴を含むプロジェクト全体を完全移植可能。

---

## 4. 操作イベント一覧と Tombstone 削除

1. **`TASK_CREATED`**: タスクの新規登録（`parentId` 指定可能、オプション属性含む）。
2. **`TASK_STATUS_UPDATED`**: ステータス変更またはDrag & Drop移動。
3. **`TASK_REORDERED`**: 同一階層内での順序並び替え。
4. **`TASK_PARENT_CHANGED`**: ツリー階層の付け替え（親タスクの変更）。
5. **`TASK_DELETED` (Tombstone Event)**:
   - 削除理由を含む墓標イベント。不変ログとして伝播し、子タスクも含めた不整合な復活（ゴースト化）を防ぐ。

---

## 5. コンフリクト解決ルール (LWW & Tree Reconciliation)

1. **Logical Timestamp & Hash**: 各イベントに付与されたハッシュとタイムスタンプに基づき、決定論的 (Deterministic) に同一のツリー状態へ再構築する。
2. **Tombstone Win**: 削除イベント `TASK_DELETED` は編集イベントより優先され、全ノードで削除状態として整合する。

---

[次へ: 拡張性およびプラグイン設計](./04_extension_spec.md)
