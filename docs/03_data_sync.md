# 03. データモデルと同期仕様

[インデックスへ戻る](./index.md) | [前へ: アーキテクチャ抽象](./02_architecture.md)

---

## 1. ドメインモデルエンティティ（Local-First 原則）

オフライン時の独立編集と接続時の自動マージを実現するため、直接上書き更新ではなく **「イベントログの集約（Event Sourcing）」** および **「Gitライクなハッシュチェーンログ (JSONL)」** の原則を採用します。

### 主要概念
- **Project**: 管理対象のプロジェクト枠組み（ID, Name, CreatedAt, OwnerNodeId）
- **Graph & Tree Task**: 親子ツリー関係、ステータス、折りたたみ状態を持つ作業項目
- **Member / Node**: ネットワーク内の参加者ノード（NodeID, DisplayName, LastSeenAt）
- **Git-like Event Log**: 履歴追跡を可能にする不変 (Immutable) な JSONL レコード

---

## 2. ミニマルタスクデータ仕様 (Task Spec)

```typescript
export interface Task {
  id: string;
  projectId: string;
  parentId?: string | null;      // 親タスクのID（nullの場合はルートタスク）
  title: string;                 // タスク名 (唯一の必須属性)
  status: 'TODO' | 'IN_PROGRESS' | 'DONE'; // ステータス
  orderIndex: number;            // 表示順序
  isCollapsed?: boolean;         // ツリーの折りたたみ状態
  updatedAt: number;
  authorNodeId: string;
}
```

---

## 3. 3つのビジュアル表現 ＆ 無操作自動イマーシブ遷移仕様

### (1) ビューモード分類 (`ViewMode`)
1. **`TREE_VIEW` (純粋ツリー表示)**:
   - TODO/PROGRESS/DONE の **カラム分割を完全排除** し、単一キャンバス上に純粋な樹状ツリーとして表示。
   - カードごとに全階層ステータスバッジ `[TODO]` `[PROGRESS]` `[DONE]` ＋ 親進捗率バーを表示。
2. **`OBSIDIAN_GRAPH_VIEW` (Obsidian風ノードグラフ表示)**:
   - Obsidian の Graph View のように、暗闇のキャンバスにノードと光る接続線が漂うグラフィカル表現。
3. **`KANBAN_VIEW` (3カラム カンバン表示)**:
   - 従来の 3カラムレイアウト。

### (2) 無操作自動イマーシブ遷移 (Idle Auto-Transition)
- ユーザーのマウス移動やキー入力が一定時間（デフォルト: 4秒）途絶えた場合、画面が自動的に **`OBSIDIAN_GRAPH_VIEW`** へ滑らかに移行します。
- ユーザーがキーを押すかマウスを動かすと、即座に元の操作モード（`TREE_VIEW` / `KANBAN_VIEW`）へ即復帰します。

---

## 4. 操作イベント一覧と Git ライク JSONL ログ

1. **`TASK_CREATED`**: タスク新規登録。
2. **`TASK_STATUS_UPDATED`**: ステータス変更。
3. **`TASK_REORDERED`**: 表示順序の変更。
4. **`TASK_PARENT_CHANGED`**: カード同士のDrag & Dropによる親子関係の変更。
5. **`TASK_COLLAPSE_TOGGLED`**: ツリーの開閉切り替え。
6. **`TASK_DELETED` (Tombstone Event)**: 墓標削除イベント。

---

[次へ: 拡張性およびプラグイン設計](./04_extension_spec.md)
