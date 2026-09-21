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

## 3. ビジュアル表現・ChatGPT風プロンプトバー・自動スクリーンセーバー仕様

### (1) ChatGPT風タスク追加プロンプトバー (Floating Prompt Input Bar)
- `border-radius: 24px` の浮遊型プロンプト入力バー。インラインに親タスク指定ピル `📁 ルートタスク` を内包し、Enter キーまたは `( ↑ )` 送信ボタンで即座にタスクを作成。

### (2) ビューモード分類 (`ViewMode`)
1. **`TREE_VIEW` (純粋ツリー表示)**:
   - TODO/PROGRESS/DONE の カラム分割を完全排除 し、単一キャンバス上に純粋な樹状ツリーとして表示。
   - 末端タスクには `[TODO]` `[PROGRESS]` `[DONE]` バッジ、親タスクには `🔒 自動算出` ＋ 進捗率バーを表示。
2. **`OBSIDIAN_GRAPH_VIEW` (Obsidian風ノードグラフ表示)**:
   - 暗闇のキャンバスにノードと光る接続線が漂うグラフィカル表現。
   - **ノードドラッグ**: ノードをマウスで掴んで物理的に引っ張る操作に対応。
   - **クリック連動**: ノードをクリックすると、カンバン/ツリーの該当タスクカードを選択・ハイライト。
3. **`KANBAN_VIEW` (3カラム カンバン表示)**:
   - 3カラムレイアウト。

### (3) 無操作自動スクリーンセーバー移行 (Idle Background Screensaver)
- 4秒間操作がない場合、画面背景全体で Obsidian グラフが漂うスクリーンセーバーモードに移行し、メイン UI を半透明化。
- **画面上の任意の位置をクリック** することで、即座に直前の作業ビューへ復帰。

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
