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
  orderIndex: number;            // 表示順序
  isCollapsed?: boolean;         // ツリーの折りたたみ状態（端末ローカルUI状態・P2P非同期）
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

## 4. UI ビジュアル仕様

### (1) Obsidian Graph View（前面メイン表示）
- 全画面キャンバス上にタスクネットワークを描画。
- **階層型Y軸重力 (Hierarchical Gravity)**: 上位の親・祖先ノードほど画面上部へ移動し、配下の子・孫ノードは下方向へぶら下がるように物理配置。
- **実用重視の静かな描画**: 過度な装飾やド派手なエフェクトを排した直感的なノード表示。

### (2) 画面端 ネスト表示深度コントロール (Screen Edge Nesting Depth Control)
- 画面端に配置されたコントロールにより、表示するネストの深さを切り替え可能：
  - **デフォルト (Default)**: 主要階層までのバランス表示
  - **数値指定 (Custom Number)**: 階層数 (1, 2, 3...) の明示指定
  - **すべて表示 (All)**: 全深度の展開表示

### (3) 整理された最小限ヘッダー (Minimal Header)
- 最小限のタイトル表記、ネットワーク接続ステータス、最低限のボタンのみで構成されるクリーンなヘッダー。

---

## 5. イベントログ同期メカニズム (`data/events.jsonl`)

### (1) イベントの種類 (`EventType`)
1. `PROJECT_CREATED`: プロジェクト初期化
2. `TASK_CREATED`: タスク生成
3. `TASK_STATUS_UPDATED`: ステータス変更
4. `TASK_PARENT_CHANGED`: 親タスク変更（階層移動）
5. `TASK_REORDERED`: 表示順序変更
6. `TASK_DELETED`: タスク削除

### (2) 同期フロー (LAN P2P Event Reconciliation)
- 各ノードは起動時に UDP ピア発見を実行し、接続要求 (`SYNC_REQUEST`) を送信。
- 受信側ノードは自身が保持する `events.jsonl` の最新ハッシュ値を照合し、未所有の差分イベントデータ (`SYNC_RESPONSE`) を返却。
- 差分イベントを適用後、`data/state.json` のスナップショットを更新。

---

[次へ: 拡張性およびプラグイン設計](./04_extension_spec.md)
