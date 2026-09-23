# 03. データモデルと同期仕様

[インデックスへ戻る](./index.md) | [前へ: システムアーキテクチャ抽象](./02_architecture.md) | [次へ: 拡張性およびプラグイン設計](./04_extension_spec.md)

---

## 1. データ同期概念とデータエンティティ

本ツールでは、運用の柔軟性に応じて **3つの動作モード（HOST / CLIENT / P2P）** を選択・切り替え可能とします。

- **Event**: 発生したすべての変更アクション（不可変なイベントログデータ）
- **State**: 現在の最新タスク状態（`data/state.json` にスナップショットとして出力）
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
  orderIndex: number;            // 表示順序（ステータス変更時も保持）
  dueDate?: number | null;       // 完了予定日 (タイムスタンプ / YYYY-MM-DD)
  isCollapsed?: boolean;         // 端末ローカルUI状態
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
      "orderIndex": 1789980009938,
      "dueDate": 1792454400000
    }
  ]
}
```

---

## 3. 動作モード ＆ アドレス設定仕様 (HOST / CLIENT / P2P Modes)

利用環境や運用方針に応じて、以下の3つの動作モードを `config.json` または Terminal対話ウィザード (`npm run setup`) から切り替え可能です。

| モード名 | 端末のアドレス (hostAddress) | データのアドレス (dataPath) | 概要 |
| :--- | :--- | :--- | :--- |
| **`P2P`** (分散モード) | **不要** (自動発見) | **要指定** (`data/state.json`) | 共有データのアドレスを参照・共有して分散動作 |
| **`CLIENT`** (クライアントモード) | **要指定** (`192.168.1.50:3000`) | **不要** (ホスト側が処理) | 指定したホスト端末アドレスへ接続 |
| **`HOST`** (ホストモード) | **不要** (自身がホスト) | **要指定** (`data/state.json`) | この端末をホスト親機として起動し接続受付 |

### (1) `config.json` スキーマ仕様
```json
{
  "mode": "P2P",
  "dataPath": "./data/state.json",
  "hostAddress": "192.168.1.50:3000",
  "port": 3000,
  "nodeName": "node-dev1",
  "autoOpen": true
}
```

### (2) 対話型セットアップCLI (`npm run setup`)
- ターミナルから `npm run setup` を実行すると対話形式で質問が表示され、設定された `config.json` の生成と単一バイナリ (`bin/`) のビルドを出力。

---

## 4. UI ビジュアル ＆ インタラクション仕様

### (1) クリーン・モノトーンデザイン ＆ テーマ切り替え (Linear / Raycast Style)
- 絵文字や過度なBlob背景、ネオングローを全廃し、Linear / Raycast 風のソリッドなテキスト主体デザインを採用。
- CSSカスタムプロパティ (`[data-theme="dark"]` / `[data-theme="light"]`) による瞬時のテーマ切替と `localStorage` 永続化。

### (2) Obsidian Graph View ＆ ノード・インスペクター ＆ キーボードショートカット
- **デフォルトネスト深度「すべて」**: アプリ起動・初期描画時にデフォルトで「すべて (`'all'`)」階層を展開。
- **ノード直接クリック動作**: ノードを選択・クリックするとノード近傍にインスペクターポップオーバーを表示。
  - **タイトル編集**: 即座のインライン入力・保存 (`TASK_TITLE_UPDATED`)。
  - **完了予定日設定**: `<input type="date">` での完了予定日設定 (`TASK_DUE_DATE_UPDATED`)。
  - **1タップステータス切り替え**: `[ TODO ]` / `[ 進行中 ]` / `[ 完了 ]` の即時変更 (`TASK_STATUS_UPDATED`)。
  - **ルート化昇格**: `[ ルート化 ]` ボタンで親タスク解除 (`TASK_PARENT_CHANGED`)。
- **親設定モーダルでの Enter / Esc ショートカット**:
  - ノード結合・親移動ダイアログ表示時、**Enter キーで確定**、**Esc キーでキャンセル**を実行。
- **キャンバスマウスドラッグによるルート化**: キャンバス上のノードドラッグ時、キャンバス内最上部エリア (`Y <= 60px`) に直接ドロップゾーンを描画し、そこでリリースされた場合にルート化を適用。

### (3) GanttProject スタイル 日付管理ガントチャート ＆ 予定日マーカードラッグ
- 縦軸 (Y軸) は樹状ツリー構造に従って親子階層順に配置。
- 左側グリッドテーブルに `ツリータスク名` | `ステータス` | `完了予定日` を表示。
- 右側タイムラインに日付単位刻みヘッダー軸と実稼働期間バー (`IN_PROGRESS` Window) および完了予定日マーカー (`gantt-due-marker` 🚩) を描画。
- **完了予定日マーカー (`🚩`) のドラッグ＆ドロップ直接操作**: タイムライン上のマーカーを掴んで動かし、ドロップした位置の日時で `TASK_DUE_DATE_UPDATED` イベントを発火・即時保存。
- **最長完了予定日の自動判定・全描画**: 全タスクの中で一番遠い完了予定日 (`dueDate`) を判定し、タイムライン右端内に完全に映し切れるようタイムライン領域を自動スケール。
- ステータス変更時にタスクの並び順 (`orderIndex`) をそのまま保持。

---

## 5. イベントログ同期メカニズム (`data/events.jsonl`)

### (1) イベントの種類 (`EventType`)
1. `PROJECT_CREATED`: プロジェクト初期化
2. `TASK_CREATED`: タスク生成 (`dueDate` 含む)
3. `TASK_STATUS_UPDATED`: ステータス変更
4. `TASK_TITLE_UPDATED`: タスク名（タイトル）変更
5. `TASK_DUE_DATE_UPDATED`: 完了予定日変更
6. `TASK_PARENT_CHANGED`: 親タスク変更（階層移動・ルート化）
7. `TASK_REORDERED`: 表示順序変更
8. `TASK_DELETED`: タスク削除

### (2) 同期フロー (LAN P2P Event Reconciliation)
- 各ノードは起動時に UDP ピア発見を実行し、接続要求 (`SYNC_REQUEST`) を送信。
- 受信側ノードは自身が保持する `events.jsonl` の最新ハッシュ値を照合し、未所有の差分イベントデータ (`SYNC_RESPONSE`) を返却。
- 差分イベントを適用後、`data/state.json` のスナップショットを更新。

---

[次へ: 拡張性およびプラグイン設計](./04_extension_spec.md)
