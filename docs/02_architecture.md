# 02. システムアーキテクチャ抽象

[インデックスへ戻る](./index.md) | [前へ: 概念とユースケース](./01_concept.md)

---

## 1. レイヤー構造（Hexagonal / Clean Architecture）

開発方針 [`../DEV_POLICY_v1.0518.md`](../DEV_POLICY_v1.0518.md) に基づき、具象クラスへの直接依存を排除し、Core Domain（ビジネスロジック）を中心にポート＆アダプターパターンを採用します。

```
+-----------------------------------------------------------------------------------------+
|                                   Presentation Layer                                    |
| (Obsidian Canvas / Parent Nav Overlay / Gantt Red Delay Badge / Gantt Header Match / UI)|
+-------------------------------------------+---------------------------------------------+
                                            | (Interfaces)
+-------------------------------------------v---------------------------------------------+
|                                   Application / Domain                                  |
| (Node-Local Undo Engine, Task Validator, Minimal Task Core, Sync Engine, Hash Chain Log)|
+-------------------+---------------------------------------+-----------------------------+
| (Interfaces)      | (Interfaces)                          | (Interfaces)
+-------------------v-------------+         +---------------+-----------------------------+
|       P2P Transport Layer       |         | Hidden Directory State & Event Storage Layer|
|    (Discovery, Socket, Mesh)    |         | (.wbser_data/state.json, .wbser_data/events)|
+---------------------------------+         +---------------------------------------------+
```

---

## 2. コンポーネントインターフェース定義（抽象ポート）

### (1) Node-Local Undo Port (端末単位Undoポート)
- **役割**: 自端末 (`authorNodeId`) が生成した直前の有効イベントを探索し、その逆操作（Undo）イベントを発行して状態を1段階復元するアプリケーションポート。
- **機能**: `undoLastAction(nodeId: string)` メソッドを通じて、作成・編集・親変更・削除等の逆イベントを安全生成。

### (2) Task Validator Port (進行中予定日必須 ＆ 削除理由検証ポート)
- **役割**: タスク編集・ステータス更新・削除のビジネスルール（バリデーション）を集中管理するポート。
- **機能**:
  - `IN_PROGRESS` ステータス切り替え時の `dueDate` 必須チェック。
  - 3つ以上の子要素を持つ親タスク削除時の理由文言（10文字以上）検証。

### (3) Obsidian Spring Physics & Parent Nav Graph Port (前面グラフキャンバスポート)
- **役割**: 前面メインビューとして、タスクの親子ネットワークを Obsidian 風のノード・バネ物理 ＋ 階層型Y軸重力で描画するプレゼンテーションポート。
- **機能**:
  - **視覚的親接続表示 ＆ 焦点移動 ＆ 配下全展開**: ノードクリック時、親要素との接続（上方向発光リンク）を示し、対象ノードを最上部へ移動させ配下全子要素を展開表示。
  - **左上固定親ナビゲーションパネル (`.graph-parent-nav`)**: 画面左上に `position: absolute` で `← 親要素へ移動: [親タスク名]` ボタンを配置し、親・先祖ノードへの移動をサポート。
  - **Sugiyama風レイヤード・ツリー自動配置 (Sugiyama Untangled Tree Layout)**: 末端タスク数の再帰採寸によるX座標領域非交差計算。
  - **ネスト数による縦方向自動スケール (Dynamic Y Ratio Scaling)**: ツリーの最大深さに応じたキャンバス縦領域の自動均等分割。
  - **Retina/High-DPI ディスプレイ適合スケーリング (Crisp Retina Rendering)**: `window.devicePixelRatio` スケーリング。

### (4) Gantt Timeline View & Overdue Delay Detection Port (ガントチャート ＆ 遅延判定ポート)
- **役割**: イベント履歴から日付単位ガントチャートをレンダリングし、親完了予定日超過をリアルタイム描画するポート。
- **機能**:
  - **親完了予定日超過の赤表示・遅延日数表示 (Overdue Subtask Red Highlight & Delay Badge)**: 子タスクの完了予定日が親の完了予定日を超過した際、差分領域を赤色ハイライト描画し「`+N日遅延`」バッジを表示。
  - **ヘッダー幅の完全一致 (`gantt-ticks-header` Alignment)**: `gantt-ticks-header` のグリッドセル幅と `gantt-bar-cell` の幅を完全一致させ表示ズレを防止。
  - **完了予定日マーカードラッグ (Drag & Drop Due Date Marker)**: 🚩 マーカーの左右ドラッグ操作による直感的な `dueDate` 変更。

### (5) Terminal-Relative Absolute Path Storage Port (絶対パス指定永続化ストレージポート)
- **役割**: 変更履歴 (`events.jsonl`) とスナップショット (`state.json`) を、ターミナル目線で把握しやすい標準ディレクトリ `data/` および指定された絶対パスで確実に永続化・同期。
- **機能**:
  - `path.resolve(process.cwd(), ...)` による絶対パス自動変換・統一。
  - 複数端末・複数プロセス間での共有フォルダ絶対パス参照対応。
  - 単一バイナリ (pkg) 内の固定初期データ (VFS `/snapshot/`) と動的永続化ログの相互解離。
  - 既存 `./.wbser_data` ディレクトリの自動フォールバック対応。

---

## 3. Dependency Injection (DI) 方針
- `StateSnapshotStorage`, `ObsidianPhysicsRenderer`, `GanttTimelineRenderer`, `TaskValidator` もドメインコアから分離された独立ポートとして外部注入（DI）可能とします。

---

[次へ: データモデルと同期仕様](./03_data_sync.md)
