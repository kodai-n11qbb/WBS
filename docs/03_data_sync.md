# 03. データモデルと同期仕様

[インデックスへ戻る](./index.md) | [前へ: アーキテクチャ抽象](./02_architecture.md)

---

## 1. ドメインモデルエンティティ（Minimal & Local-First 原則）

複雑なオプション入力を排除し、**「タスク名」「ステータス」「親子ツリー関係」** のみに限定した極小（Minimal）モデルを採用します。

### 主要概念
- **Project**: 管理対象のプロジェクト枠組み（ID, Name, CreatedAt, OwnerNodeId）
- **Minimal Tree Task**: 親子ツリー関係、ステータス、折りたたみ状態を持つ作業項目
- **Member / Node**: ネットワーク内の参加者ノード（NodeID, DisplayName, LastSeenAt）
- **Git-like Event Log**: 履歴追跡を可能にする不変 (Immutable) な JSONL レコード

---

## 2. ミニマルタスクデータ仕様 (Minimal Task Spec)

```typescript
export interface Task {
  id: string;
  projectId: string;
  parentId?: string | null;      // 親タスクのID（nullの場合はルートタスク）
  title: string;                 // タスク名 (唯一の必須属性)
  status: 'TODO' | 'IN_PROGRESS' | 'DONE'; // ステータス
  orderIndex: number;            // 表示順序
  isCollapsed?: boolean;         // 視覚的ツリーの折りたたみ状態
  updatedAt: number;
  authorNodeId: string;
}
```

### 計算可能プロパティ (Computed Properties)
- **子タスク進捗率 (Completion Rate)**:
  `childTasks` における `DONE` タスクの割合（例: `2 / 3` 完了 ➔ 66.7%）。親タスクカード上にプログレスバーとして動的描画。

---

## 3. 全階層でのステータス視覚化 ＆ 自動集計ルール

### (1) 全階層ステータスバッジ
ツリー表示時、ルートタスク・子タスク・孫タスクなど、**どの階層のタスクカードにもステータスバッジ (`[TODO]` `[PROGRESS]` `[DONE]`) が表示** され、ワンクリックまたはキーボード `←` `→` 操作で直接ステータス変更が可能です。

### (2) 親タスクの自動ステータス計算ルール
ドメイン層において、親タスクのステータスは直下の子タスク群の状態に基づいて自動連動します：

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

---

## 4. ビューモード切替仕様 (View Mode Toggle)

プレゼンテーション層において、画面上の切替トグルにより以下の2つのビュー表示モードを自由に切り替え可能です。

1. **`TREE_VIEW` (メイン表示)**:
   - 親ノードから子ノードへと接続された樹状ツリー表現。
   - 各カードでの全階層ステータスバッジ ＋ 親タスクの進捗率可視化 ＋ 開閉トグル ＋ カード間 Drag & Drop ペアレンティング。
2. **`KANBAN_VIEW`**:
   - 従来の TODO / IN_PROGRESS / DONE の 3 カラムレイアウト。

---

## 5. 操作イベントおよび Git ライク JSONL ログ

1. **`TASK_CREATED`**: ミニマルタスク新規登録（`parentId` 指定可能）。
2. **`TASK_STATUS_UPDATED`**: ステータス変更。
3. **`TASK_REORDERED`**: 表示順序の変更。
4. **`TASK_PARENT_CHANGED`**: カード同士のDrag & Dropによる親子関係の変更。
5. **`TASK_COLLAPSE_TOGGLED`**: ツリーの開閉切り替え。
6. **`TASK_DELETED` (Tombstone Event)**: 墓標削除イベント。

---

[次へ: 拡張性およびプラグイン設計](./04_extension_spec.md)
