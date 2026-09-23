# 02. システムアーキテクチャ抽象

[インデックスへ戻る](./index.md) | [前へ: 概念とユースケース](./01_concept.md)

---

## 1. レイヤー構造（Hexagonal / Clean Architecture）

開発方針 [`../DEV_POLICY_v1.0518.md`](../DEV_POLICY_v1.0518.md) に基づき、具象クラスへの直接依存を排除し、Core Domain（ビジネスロジック）を中心にポート＆アダプターパターンを採用します。

```
+-----------------------------------------------------------------------------------------+
|                                   Presentation Layer                                    |
| (Obsidian Canvas / Node Inspector / Gantt Drag Marker / Gantt Timeline / Theme Switcher)|
+-------------------------------------------+---------------------------------------------+
                                            | (Interfaces)
+-------------------------------------------v---------------------------------------------+
|                                   Application / Domain                                  |
| (Status Aggregator, Minimal Task Core, Sync Engine, Hash Log, Hierarchical Gravity Engine)|
+-------------------+---------------------------------------+-----------------------------+
                    | (Interfaces)                          | (Interfaces)
+-------------------v-------------+         +---------------+-----------------------------+
|       P2P Transport Layer       |         |   State Snapshot & Git-like Storage Layer   |
|    (Discovery, Socket, Mesh)    |         |  (data/state.json, data/events.jsonl, DB)   |
+---------------------------------+         +---------------------------------------------+
```

---

## 2. コンポーネントインターフェース定義（抽象ポート）

### (1) Obsidian Spring Physics & Hierarchical Gravity Canvas Port (前面グラフキャンバスポート)
- **役割**: 前面メインビューとして、タスクの親子ネットワークを Obsidian 風のノード・バネ物理 ＋ 階層型Y軸重力で描画するプレゼンテーションポート。
- **機能**:
  - **Retina/High-DPI ディスプレイ適合スケーリング (Crisp Retina Rendering)**: Device Pixel Ratio (`dpr`) に適合した物理ピクセル解像度の自動拡充と仮想座標系制御 (`ctx.scale(dpr, dpr)`) により、4K/Mac環境での描画ボケを追放。
  - **Sugiyama風レイヤード・ツリー自動配置 (Sugiyama Untangled Tree Layout)**: 末端タスク数の再帰採寸によりサブツリー同士のX座標領域を非交差計算し、線の絡まりや交差を幾何学的に防止。
  - **ネスト数による縦方向自動スケール (Dynamic Y Ratio Scaling)**: ツリーの最大深さ（ネスト数: 1〜N階層）に応じてキャンバスの縦領域を自動均等分割し、浅い階層から深い階層まで全てのノードが画面内に美しく収まるようダイナミック配置。
  - **階層型Y軸重力 ＆ 焦点サブツリー昇降 (Hierarchical Gravity & Focal Elevation)**: ノード選択時、対象要素と配下ツリー全体が画面最上部へ自動昇降し、配下タスク全体をスクロールフリーで可視化。
  - **サブツリー強調 ＆ 文字重なり防護 (Subtree Focus & Label Protection)**: ノード選択時、対象ノードおよび配下の子孫タスク群とリンクをハイライトし、無関係ノードを半透明化。
  - **文字サイズ選択＆画面端コントロール (Text Size Selector & Edge Controls)**: 画面端コントローラーからネスト表示切り替えに加え、文字サイズ（小/中/大）を即座に切り替え可能。
  - **画面空白クリックによるフォーカス解除**: ノード以外のキャンバス空白部クリックで選択状態をクリアし初期表示へ復帰。
  - **Obsidian Node Inspector Port**: ノードクリックによるツールバー表示（タイトル編集、完了予定日設定、1タップステータス切り替え、親切り離しルート化）。
  - **キーボードショートカット連携**: ノード結合ダイアログ等での Enter キー確定 / Esc キーキャンセル。

### (2) Subtask to Root Elevation Port (親変更・ルート昇格ポート)
- **役割**: Obsidianグラフおよびガントビューにおける子タスクのルート化 (`parentId: null`) インターフェース。
- **機能**:
  - ノードからのワンタップ `[ ルート化 ]` 操作。
  - グラフキャンバス内最上部エリア (`Y <= 60px`) へのドラッグ＆ドロップ処理。

### (3) Gantt Timeline View & Interactive Due Marker Port (ガントチャート ＆ 予定日マーカードラッグポート)
- **役割**: `events.jsonl` の不変イベント履歴（`TASK_CREATED`, `TASK_STATUS_UPDATED`, `TASK_DUE_DATE_UPDATED` 等）から、日付単位（日スケール）管理ガントチャートをレンダリングし、マーカー操作を受け付けるポート。
- **機能**:
  - **ミニマルヘッダー**: 不要なサブタイトル文言を配し、洗練されたクリーンなレイアウトを提供。
  - **完了予定日マーカードラッグ (Drag & Drop Due Date Marker)**: タイムライン上の完了予定日マーカー (`gantt-due-marker` 🚩) をマウスで掴んで左右ドラッグ移動し、直接 `dueDate` を変更・リアルタイム同期 (`TASK_DUE_DATE_UPDATED`)。
  - **日付単位管理 ＆ 最長完了予定日自動収容 (Date Management & Auto-Fit)**: 開始日、完了予定日 (`dueDate`)、所要日数を `YYYY/MM/DD` 形式で可視化。一番遠い完了予定日（最長3ヶ月後等）を判定してタイムライン右端内に完全に収まるよう範囲を自動調整。
  - **順序保持 (Order Preservation)**: ステータス切替時に `orderIndex` を保持し、勝手な並び順変更を防止。

### (4) Minimalist Header & Theme Port (最小限ヘッダー＆テーマ切替ポート)
- **役割**: タイトル、ネットワーク状態、2ビュー切替 (`[ グラフ | ガント ]`)、および Linear/Raycast スタイルの Dark/Light テーマ切り替え管理。

### (5) State Snapshot & Event Storage Port (最新状態スナップショット＆イベントリポジトリポート)
- **役割**: 変更履歴 (`events.jsonl`) のバックグラウンド記録と、ディレクトリ直下への最新状態ファイル (`data/state.json`) のリアルタイム自動永続化。
- **機能**:
  - `data/state.json` に最新の全タスク状態（Materialized Snapshot）を常時出力し、アプリ起動速度 $O(1)$ および他ツール・手動参照の可視性を実現。
  - `data/events.jsonl` により P2P ネットワーク差分マージ (`SYNC_REQUEST` / `SYNC_RESPONSE`) と改ざん防止ハッシュチェーンを維持。

### (6) Status Aggregator & Single-Parent Hierarchy Port (進捗算出・単一親構造ポート)
- **役割**:
  - 子タスクの状態から親タスクの進捗率を動的算出。
  - 1:Nの単一親ツリー構造 (`parentId?: string | null`) を厳守し、巡回（Cycle）参照の発生を防止。

### (7) Standalone Executable Packaging Adapter (環境依存ゼロ・単一バイナリパッケージング)
- **役割**: Node.js, Python, Docker, Rust 等が一切インストールされていない環境でも、単一バイナリ (`share-log-win.exe` / `share-log-macos-arm64`) をダブルクリックするだけでローカル Web サーバー (`http://localhost:3000`) が立ち上がり、規定のブラウザ画面を自動オープンするポータブルパッケージング構造。

---

## 3. Dependency Injection (DI) 方針
- `StateSnapshotStorage`, `ObsidianPhysicsRenderer`, `GanttTimelineRenderer` もドメインコアから分離された独立ポートとして外部注入（DI）可能とします。

---

[次へ: データモデルと同期仕様](./03_data_sync.md)
