# 03. データモデルと同期仕様

[インデックスへ戻る](./index.md) | [前へ: アーキテクチャ抽象](./02_architecture.md)

---

## 1. ドメインモデルエンティティ（Local-First 原則）

オフライン時の独立編集と接続時の自動マージを実現するため、直接上書き更新ではなく **「イベントログの集約（Event Sourcing）」** および **「Gitライクなハッシュチェーンログ (JSONL)」** の原則を採用します。

### 主要概念
- **Project**: 管理対象のプロジェクト枠組み（ID, Name, CreatedAt, OwnerNodeId）
- **Visual Tree Task**: ツリー構造、自動ステータス集約、表示折りたたみフラグを持つ作業項目
- **Member / Node**: ネットワーク内の参加者ノード（NodeID, DisplayName, LastSeenAt）
- **Git-like Event Log**: 履歴追跡を可能にする不変 (Immutable) な JSONL レコード

---

## 2. ビジュアルツリータスク仕様 (Visual Tree Task Spec)

```typescript
export interface Task {
  id: string;
  projectId: string;
  parentId?: string | null;      // 親タスクのID（nullの場合は最上位Rootタスク）
  childTaskIds: string[];        // 子タスク（サブタスク）のID一覧
  title: string;                 // タスク名 (必須)
  status: 'TODO' | 'IN_PROGRESS' | 'DONE'; // 自動集約または個別設定ステータス
  orderIndex: number;            // 表示順序（Drag & Drop / 十字キー移動用）
  isCollapsed?: boolean;         // 視覚的ツリーの折りたたみUI状態
  assignedNodeId?: string;
  updatedAt: number;
  authorNodeId: string;
}
```

---

## 3. 親タスクの自動ステータス計算ルール (Status Aggregation Rule)

ドメイン層において、親タスクのステータスは直下の子タスク群の状態に基づいて以下のように決定論的 (Deterministic) に再計算・更新されます。

```
                    [親タスクの自動ステータス算出]
                                  |
           +----------------------+----------------------+
           |                      |                      |
           v                      v                      v
   【子タスク全件が DONE】  【子タスク一部がPROGRESS/DONE】 【子タスク全件が TODO】
           |                      |                      |
           v                      v                      v
     親 status = DONE      親 status = IN_PROGRESS    親 status = TODO
```

- **適用タイミング**: 子タスクの追加・ステータス更新・削除・Drag&Dropドロップが発生した瞬間、親ノードを再帰的に遡ってステータスが自動同期されます。

---

## 4. Drag & Drop ペアレンティング と キーボード移動イベント

### (1) Drag & Drop イベント
1. **`TASK_STATUS_UPDATED`**: カラム（TODO / IN_PROGRESS / DONE）へのドロップ。
2. **`TASK_PARENT_CHANGED`** (カード同士のドロップ時):
   - Payload: `{ taskId, newParentId }`
   - あるカードを別のカードの上に重なるようドロップすることで、瞬時にそのカードの子タスクとしてツリー接続を再構築します。

### (2) 十字キー (Arrow Keys) ナビゲーション
キーボードフォーカスされているアクティブタスクに対し、以下のキー操作をバインドします：
- **`ArrowUp` / `ArrowDown`**: カラム内またはツリーノード間でのフォーカス移動。
- **`ArrowLeft` / `ArrowRight`**: タスクのステータスを前後に変更（TODO ⇄ IN_PROGRESS ⇄ DONE）。
- **`Shift + ArrowUp / ArrowDown`**: 親タスクの変更（階層の昇格・降格）。

---

## 5. Gitライクな JSONL 履歴追跡ログ仕様 (Git-like Audit Log)

すべての操作（ペアレンティング付け替え、自動ステータス更新含む）は改ざん不能な Git ライクなイベントログとして `.jsonl` ファイル（1行1JSON）に追記（Append-Only）されます。

```json
{
  "id": "evt-uuid-002",
  "projectId": "p1",
  "authorNodeId": "node-alpha",
  "timestamp": 1700000000000,
  "sequence": 2,
  "type": "TASK_PARENT_CHANGED",
  "previousHash": "a1b2c3d4e5f6...",
  "hash": "f6e5d4c3b2a1...",
  "payload": {
    "taskId": "t-child-10",
    "newParentId": "t-parent-01"
  }
}
```

---

[次へ: 拡張性およびプラグイン設計](./04_extension_spec.md)
