# 03. データモデルと同期仕様

[インデックスへ戻る](./index.md) | [前へ: アーキテクチャ抽象](./02_architecture.md)

---

## 1. ドメインモデルエンティティ（Local-First 原則 ＆ スナップショット運用）

オフライン時の独立編集と接続時の自動マージ、および人間・他ツールからの最新情報可視性を両立するため、**「ディレクトリ直下の最新状態スナップショット (`data/state.json`)」** と **「Gitライクな追跡ログ (`data/events.jsonl`)」** のハイブリッド構成を採用します。

### 主要概念
- **Project State Snapshot (`data/state.json`)**: 現在アクティブな全タスクの状態がリアルタイムで更新・保存されるMaterialized View（最新情報そのもの）
- **Git-like Event Log (`data/events.jsonl`)**: P2P差分同期や過去履歴の復元用として追記管理される不可変イベントログ
- **Graph & Tree Task**: 単一の親 (`parentId`: 最大1つ。親なしの場合は `null`) を持つ階層ツリー構造作業項目
- **Member / Node**: ネットワーク内の参加者ノード（NodeID, DisplayName, LastSeenAt）

---

## 2. ミニマルタスクデータ仕様 (Task Spec & State JSON Format)

### (1) タスクエンティティインターフェース
```typescript
export interface Task {
  id: string;
  projectId: string;
  parentId?: string | null;      // 親タスクのID（nullの場合はルート/独立浮遊タスク）
  title: string;                 // タスク名 (唯一の必須属性)
  status: 'TODO' | 'IN_PROGRESS' | 'DONE'; // ステータス
  orderIndex: number;            // 表示順序
  isCollapsed?: boolean;         // ツリーの折りたたみ状態
  updatedAt: number;
  authorNodeId: string;
}
```

### (2) ディレクトリ直下 最新状態ファイル (`data/state.json`)
```json
{
  "projectId": "default-project",
  "updatedAt": 1789980033297,
  "tasks": [
    {
      "id": "86c31535-fbca-4083-85bb-4007efab4f08",
      "title": "設計ドキュメントの更新",
      "status": "IN_PROGRESS",
      "parentId": null,
      "priority": "MEDIUM",
      "orderIndex": 1789980009938
    }
  ]
}
```

---

## 3. ビジュアル表現・画面浮遊・バネ物理仕様

### (1) 画面下部固定 ChatGPT風プロンプトバー (Bottom Fixed Floating Prompt Bar)
- `position: fixed; bottom: 1.5rem;` で常時画面下部に浮遊配置。
- **直接ルートタスク生成**: 親を指定せずに作成したタスクは、人工的な未分類フォルダに入らず、**そのまま独立したルートタスク (`parentId: null`) として生成** されます。

### (2) ビューモード分類 (`ViewMode`)
1. **`TREE_VIEW` (画面浮遊カード ＆ 純粋ツリー表示)**:
   - 親を持たない独立ルートタスクは画面上の空きスペースを優しく漂う発光フローズンカード (`.floating-unclassified-card`) として独立描画。
   - 浮遊カードを掴んでツリー内の親タスク枠内へドラッグ＆ドロップ（**「↙ 子要素として追加」** ガイド表示）することで、直感的に子タスク化。
   - 明確な接続線（Connector lines）と視認性の高い階層インデント構造。
   - 親タスクの背景グラデーション (`linear-gradient`) による省スペース進捗 fill 描画。
2. **`OBSIDIAN_GRAPH_VIEW` (Obsidian風ノードグラフ表示)**:
   - 暗闇のキャンバスにノードと光る接続線が漂うグラフィカル表現。
   - **バネ物理ドラッグ**: ノードをドラッグすると接続先のノードがバネのように引きずられて連動。
   - **枠内ドロップ親子化**: ノードを別のノードの円盤枠内（半径45px）へ重ねると確認ダイアログが表示され、承認で親タスク変更イベント (`TASK_PARENT_CHANGED`) を発行。
   - **クリック連動**: ノードをクリックすると、ツリー表示の該当タスクカードを選択・ハイライト。
3. **`KANBAN_VIEW` (3カラム カンバン表示)**:
   - 3カラムレイアウト。**全ルートタスクは「To Do」カラム内に通常のTODOアイテムとして配置**。
   - 誤操作防止のためドラッグ＆ドロップは無効化し、ステータス変更ボタン `[未着手] [進行中] [完了]` およびキーボード `←` / `→` 操作で進捗変更。

---

## 4. 操作イベント一覧と Git ライク JSONL ログ

1. **`TASK_CREATED`**: タスク新規登録（`parentId: null` でルートタスク作成）。
2. **`TASK_STATUS_UPDATED`**: ステータス変更。
3. **`TASK_REORDERED`**: 表示順序の変更。
4. **`TASK_PARENT_CHANGED`**: カード間または Obsidian ノード重なりドラッグによる親子関係変更（単一親 `parentId` 上書き）。
5. **`TASK_COLLAPSE_TOGGLED`**: ツリーの開閉切り替え。
6. **`TASK_DELETED` (Tombstone Event)**: 墓標削除イベント。

---

[次へ: 拡張性およびプラグイン設計](./04_extension_spec.md)


