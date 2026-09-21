# 02. システムアーキテクチャ抽象

[インデックスへ戻る](./index.md) | [前へ: 概念とユースケース](./01_concept.md)

---

## 1. レイヤー構造（Hexagonal / Clean Architecture）

開発方針 [`../DEV_POLICY_v1.0518.md`](../DEV_POLICY_v1.0518.md) に基づき、具象クラスへの直接依存を排除し、Core Domain（ビジネスロジック）を中心にポート＆アダプターパターンを採用します。

```
+-----------------------------------------------------------------------------------------+
|                                   Presentation Layer                                    |
|   (Pure Tree View / Obsidian Graph Canvas / Kanban Board / Bottom ChatGPT Prompt Bar)   |
+-------------------------------------------+---------------------------------------------+
                                            | (Interfaces)
+-------------------------------------------v---------------------------------------------+
|                                   Application / Domain                                  |
| (Status Aggregator, Minimal Task Core, Sync Engine, Hash Log, Node Spring Physics Engine)|
+-------------------+---------------------------------------+-----------------------------+
                    | (Interfaces)                          | (Interfaces)
+-------------------v-------------+         +---------------+-----------------------------+
|       P2P Transport Layer       |         |   State Snapshot & Git-like Storage Layer   |
|    (Discovery, Socket, Mesh)    |         |  (data/state.json, data/events.jsonl, DB)   |
+---------------------------------+         +---------------------------------------------+
```

## 2. コンポーネントインターフェース定義（抽象ポート）

### (1) Pure Tree View & Multi-View Navigation Port (樹状ツリービュー ＆ 多視点操作ポート)
- **役割**: 全ルートタスクの統一樹状ツリー構造描画と、キーボード（↑↓←→）ナビゲーション制御。
- **機能**:
  - 親を指定せずに作成されたタスクはそのまま独立したルートタスク (`parentId: null`) として生成。
  - 親を持たない独立ルートタスクをツリーエリア (`pureTreeContainer`) 内に統一描画。
  - ドラッグ＆ドロップによる直感的な親子化・並べ替え。
  - 親タスクの背景グラデーション (`linear-gradient`) による省スペース進捗 fill 描画。
  - 全ビュー共通の統一キーボードナビゲーション (`ArrowUp` / `ArrowDown` / `ArrowLeft` / `ArrowRight`)。

### (2) State Snapshot & Event Storage Port (最新状態スナップショット＆イベントリポジトリポート)
- **役割**: 変更履歴 (`events.jsonl`) のバックグラウンド記録と、ディレクトリ直下への最新状態ファイル (`data/state.json`) のリアルタイム自動永続化。
- **機能**:
  - `data/state.json` に最新の全タスク状態（Materialized Snapshot）を常時出力し、アプリ起動速度 $O(1)$ および他ツール・手動参照の可視性を実現。
  - `data/events.jsonl` により P2P ネットワーク差分マージ (`SYNC_REQUEST` / `SYNC_RESPONSE`) と改ざん防止ハッシュチェーンを維持。

### (3) Obsidian Spring Physics Renderer Port (グラフレンダラーポート)
- **役割**: タスクの親子ネットワークを Obsidian 風のノードとバネ物理（Spring Elasticity）で描画するプレゼンテーションポート。
- **機能**:
  - ノードドラッグ時のバネ弾性連動（接続ノードが引きずられて滑らかに追従）。
  - ノードの円盤枠内（半径45px）へのドラッグ＆ドロップによる「親子化確認モーダルダイアログ」トリガー。
  - ノードクリックによるツリー/カンバン表示の対象タスクカードへのフォーカス連動。

### (4) Status Aggregator & Single-Parent Hierarchy Port (進捗算出・単一親構造ポート)
- **役割**:
  - 子タスクの状態から親タスクの進捗率（Completion Rate: 例 `33.3%`）を動的算出。
  - 1:Nの単一親ツリー構造 (`parentId?: string | null`) を厳守し、巡回（Cycle）参照の発生を防止。

### (5) Standalone Executable Packaging Adapter (環境依存ゼロ・単一バイナリパッケージング)
- **役割**: Node.js, Python, Docker, Rust 等が一切インストールされていない環境でも、単一バイナリ (`share-log-win.exe` / `share-log-macos-arm64`) をダブルクリックするだけでローカル Web サーバー (`http://localhost:3000`) が立ち上がり、規定のブラウザ画面を自動オープンするポータブルパッケージング構造。
- **特徴**: アドレス手入力不要で自端末上で `localhost:3000` を開くだけで、UDP P2P通信により同一LAN内の全ノードと全自動同期。

---

## 3. Dependency Injection (DI) 方針
- `StateSnapshotStorage` および `ObsidianPhysicsRenderer` もドメインコアから分離された独立ポートとして外部注入（DI）可能とします。

---

[次へ: データモデルと同期仕様](./03_data_sync.md)


