# 03. データモデルと同期仕様

[インデックスへ戻る](./index.md) | [前へ: システムアーキテクチャ抽象](./02_architecture.md) | [次へ: 拡張性およびプラグイン設計](./04_extension_spec.md)

---

## 1. データ同期概念とデータエンティティ

本ツール **「WBSer」** では、運用の柔軟性に応じて **3つの動作モード（HOST / CLIENT / P2P）** を選択・切り替え可能とします。

- **Event**: 発生したすべての変更アクション（不可変なイベントログデータ）
- **State**: 現在の最新タスク状態（`./.wbser_data/state.json` にスナップショットとして出力）
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
  status: 'TODO' | 'IN_PROGRESS' | 'DONE'; // ステータス (IN_PROGRESS時はdueDate必須)
  orderIndex: number;            // 表示順序（ステータス変更時も保持）
  dueDate?: number | null;       // 完了予定日 (タイムスタンプ / YYYY-MM-DD)
  isCollapsed?: boolean;         // 端末ローカルUI状態
  updatedAt: number;
  authorNodeId: string;
}
```

### (2) 隠しディレクトリ直下 最新状態ファイル (`./.wbser_data/state.json`)
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
      "orderIndex": 1789980009938,
      "dueDate": 1792454400000
    }
  ]
}
```

---

## 3. 動作モード ＆ アドレス設定仕様 (HOST / CLIENT / P2P Modes)

利用環境や運用方針に応じて、以下の3つの動作モードを `config.json` または Terminal対話ウィザード (`npm run setup`) から切り替え可能です。

| モード名 | 端末のアドレス (hostAddress) | データ保存ディレクトリ (dataDir) | 概要 |
| :--- | :--- | :--- | :--- |
| **`P2P`** (分散モード) | **不要** (自動発見) | **要指定** (絶対パス: `/path/to/data`) | 共有データ保存ディレクトリ (`state.json`, `events.jsonl`) を指定して分散動作 |
| **`CLIENT`** (クライアントモード) | **要指定** (`192.168.1.50:3000`) | **不要** (ホスト側が処理) | 指定したホスト端末アドレスへ接続 |
| **`HOST`** (ホストモード) | **不要** (自身がホスト) | **要指定** (絶対パス: `/path/to/data`) | この端末をホスト親機として起動し接続受付 |

### (1) `config.json` スキーマ仕様
```json
{
  "mode": "P2P",
  "dataDir": "/Users/abekoudai/Desktop/WBSer/data",
  "hostAddress": "192.168.1.50:3000",
  "port": 3000,
  "nodeName": "node-dev1",
  "autoOpen": true
}
```
> ※ `dataDir` はターミナル実行時のカレントディレクトリを基準にした絶対パス (`path.resolve`) として自動解決・保持されます。既存の `./.wbser_data` ディレクトリが存在する場合は自動フォールバック検出・復元されます。

---

## 4. UI ビジュアル ＆ インタラクション仕様

### (1) 端末単位 Undo (1つ戻す) ボタン
- ヘッダーバーに `[ ↺ 1つ戻す (Undo) ]` ボタンを配置。自端末 (`authorNodeId`) の直前操作を取り消し。

### (2) 進行中 (IN_PROGRESS) ステータス切替時の完了予定日強制
- ステータスを `IN_PROGRESS` に変更する際、`dueDate` 未設定の場合は完了予定日入力モーダルがポップアップし必須入力。

### (3) Obsidian Graph View ダブルクリック最上部頂点化・サブツリー限定表示 ＆ インスペクターシールド
- **ノードダブルクリック最上部頂点化 ＆ 上方向親接続線**: 要素をダブルクリックした際、親要素が存在する場合は対象要素が最上部の親要素であるかのように画面最上部に浮上配置され、上方向へ接続線（発光・点線）を延伸描画。
- **サブツリー限定絞り込み表示 (Subtree Focus Isolation)**: ダブルクリックされた要素およびその配下の子要素群のみが表示されているかのように他分岐・他ツリーを非表示化。
- **相対ネスト表示適用**: 画面右端のネスト表示切替（1階層 | 2階層 | すべて）は、現在絞り込み表示中のサブツリー配下に対して相対的に適用。
- **インスペクター干渉・隠蔽防止**: タスク選択時に展開されるインスペクターパネル周辺の子要素やラベル・リンク線が重なって隠れるのを防ぐ物理領域・Z-indexシールド保護を適用。
- **左上固定親ナビゲーションUI (`.graph-parent-nav`)**: 画面左上に `position: absolute` で `← 親要素へ移動: [親タスク名]` ボタンを表示し親ノードへナビゲーション。

### (4) GanttProject スタイル 日付管理ガントチャート ＆ 遅延表示
- **親完了予定日超過の赤表示・遅延日数表示**: 子タスクの `dueDate` が親タスクの `dueDate` を超過している場合、超過領域を赤色ハイライトし「`+N日遅延`」のバッジを表示。
- **ヘッダー幅の完全一致 (`gantt-ticks-header` Alignment)**: `gantt-ticks-header` のセル幅を `gantt-bar-cell` と完全に一致させ横ズレを防止。

### (5) 3子要素以上の削除理由ログ入力モーダル
- 子要素が3つ以上存在するタスク削除時、10文字以上の削除理由入力を求め、`TASK_DELETED` イベントの `reason` に記録。

---

## 5. イベントログ同期メカニズム (`./.wbser_data/events.jsonl`)

### (1) イベントの種類 (`EventType`)
1. `PROJECT_CREATED`: プロジェクト初期化
2. `TASK_CREATED`: タスク生成 (`dueDate` 含む)
3. `TASK_STATUS_UPDATED`: ステータス変更 (`IN_PROGRESS` 時 `dueDate` 必須)
4. `TASK_TITLE_UPDATED`: タスク名変更
5. `TASK_DUE_DATE_UPDATED`: 完了予定日変更
6. `TASK_PARENT_CHANGED`: 親タスク変更
7. `TASK_REORDERED`: 表示順序変更
8. `TASK_DELETED`: タスク削除 (`reason` 10文字以上ログ記録)
9. `UNDO_ACTION`: 端末単位直前操作の取り消し

---

[次へ: 拡張性およびプラグイン設計](./04_extension_spec.md)
