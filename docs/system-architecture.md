# 3.1 システムアーキテクチャ (system-architecture.md)

[ドキュメントインデックスへ戻る](./index.md) | [前へ: 非機能要件一覧](./nonfunctional-requirements.md) | [次へ: 技術スタック](./tech-stack.md)

---

## 1. レイヤー構造（Hexagonal / Clean Architecture）

WBSer は、開発方針 [`DEV_POLICY.md`](./DEV_POLICY.md) および [`CODING_RULES.md`](./CODING_RULES.md) に基づき、具象実装への直接依存を排除し、Core Domain（ビジネスロジック）を中心にポート＆アダプターパターン（Hexagonal Architecture）を採用しています。

```
+-----------------------------------------------------------------------------------------+
|                                   Presentation Layer                                    |
| (Obsidian Canvas / Parent Nav Overlay / Gantt Red Delay Badge / Gantt Header Match / UI)|
+-------------------------------------------+---------------------------------------------+
                                            | (Interfaces / Events)
+-------------------------------------------v---------------------------------------------+
|                                   Application / Domain                                  |
| (Node-Local Undo Engine, Task Validator, Minimal Task Core, Sync Engine, Hash Chain Log)|
+-------------------+---------------------------------------+-----------------------------+
| (Interfaces)      | (Interfaces)                          | (Interfaces)
+-------------------v-------------+         +---------------+-----------------------------+
|       P2P Transport Layer       |         | Data Storage & File Watcher Storage Layer       |
|    (Discovery, Socket, Mesh)    |         | (WBS_data/state.json, events.jsonl, FileWatcher)|
+---------------------------------+         +-------------------------------------------------+
```

---

## 2. レイヤーの責務

### (1) Presentation Layer (プレゼンテーション層)
- ユーザーからの入力を受け付け、ビューを描画する。
- **Obsidian型グラフキャンバス**: HTML Canvas でノードとリンクを描画し、Spring Physics 物理演算、Sugiyama レイヤードツリー配置、サブツリー絞り込みを実行。
- **GanttProjectスタイルガントチャート**: 日付軸のグリッド描画、親子完了予定日超過判定（赤ハイライト・遅延バッジ）、マーカードラッグ操作をハンドリング。
- **親ナビゲーションUI**: 選択ノードの親要素への瞬間移動リンクを提供。

### (2) Application / Domain Layer (ドメイン・アプリケーション層)
- プロジェクトの純粋なビジネスルールおよびユースケースを実装する。
- **Task Validator**: `IN_PROGRESS` ステータス切り替え時の完了予定日必須チェック、3子要素以上削除時の10文字以上理由バリデーション。
- **Sync Engine / Status Aggregator**: イベントログ（`events.jsonl`）の再生、タスクツリーの構築、ステート集約。
- **Node-Local Undo Engine**: 自端末（`authorNodeId`）のアクション履歴を探索し、打ち消しイベント（`UNDO_ACTION`）を生成。

### (3) Infrastructure / Adapter Layer (インフラストラクチャ層)
- OS、ファイルシステム、ネットワークとの具象的な入出力を担当する。
- **Transport Adapters**: UDPブロードキャスト自動発見、WebSocketクライアント接続、P2Pメッシュ通信。
- **Storage Adapters**: カレントディレクトリ基準の絶対パス（`data/`）への `state.json` および `events.jsonl` の読み書き。
- **File Watcher Adapters**: `fs.watch` やポーリングによる外部データ変更のリアルタイム検知。

---

## 3. コンポーネントポート定義（抽象インターフェース）

### 1. `NodeLocalUndoPort` (端末単位Undoポート)
- **役割**: 自端末（`authorNodeId`）が生成した直前の有効イベントを逆走探索し、打ち消しイベントを安全生成するポート。
- **主要メソッド**: `undoLastAction(nodeId: string): Promise<Event | null>`

### 2. `TaskValidatorPort` (タスク検証ポート)
- **役割**: タスクのステータス変更や削除に関するドメインルールを集中検証するポート。
- **主要メソッド**:
  - `validateStatusTransition(task: Task, newStatus: TaskStatus, dueDate?: number | null): ValidationResult`
  - `validateTaskDeletion(task: Task, childCount: number, reason?: string): ValidationResult`

### 3. `ObsidianPhysicsPort` (グラフキャンバスポート)
- **役割**: タスク親子構造を物理ノードグラフとしてキャンバス上に描画・計算するポート。
- **主要機能**:
  - Sugiyama Untangled Tree Layout（末端数に基づくX座標非交差計算）
  - Dynamic Y Ratio Scaling（階層深さに応じた自動縦スケール）
  - Subtree Horizontal Wide Spread（フォーカス時のサブツリー横幅自動ワイド展開）
  - Subtree Focus Isolation（ダブルクリックによる部分ツリー絞り込み）
  - Inspector Shielding（パネル周辺の反発・視覚遮蔽）

### 4. `GanttTimelinePort` (ガントチャートポート)
- **役割**: タスクの期間・予定日をタイムラインにプロットし、遅延を検出・描画するポート。
- **主要機能**:
  - 親完了予定日超過判定 ＆ 赤ハイライト・遅延日数バッジ描画
  - ヘッダー軸（`gantt-ticks-header`）とバーセル（`gantt-bar-cell`）のピクセル幅同期
  - 🚩マーカードラッグによる `dueDate` 変更ハンドリング

### 5. `ProjectRepositoryPort` / `StoragePort` (永続化ストレージポート)
- **役割**: イベントログおよびスナップショットを安全にディスクへ永続化・読み込みを行うポート。
- **主要機能**:
  - カレントディレクトリ基準の絶対パス（`path.resolve`）による統一管理
  - `state.json` のアトミック書き出し
  - 旧 `./.wbser_data/` への自動フォールバック

### 6. `FileWatcherPort` (外部ファイル改変監視ポート)
- **役割**: データ保存ディレクトリ内の `events.jsonl` や `state.json` に対する外部変更を検知するポート。
- **主要機能**:
  - `fs.watch` / Polling によるファイル変更イベントの検知
  - 100〜300ms デバウンス制御
  - `onEventsFileAppended` / `onStateFileReplaced` コールバック発火

---

## 4. 依存性注入 (Dependency Injection) 方針

- ドメイン層は具象クラスを直接 `new` せず、ポートインターフェースにのみ依存します。
- エントリーポイント（`src/core/container.ts` 等）で具象アダプターをインスタンス化し、ドメインサービスへ注入（DI）します。
- これにより、ユニットテスト時には容易にモックやインメモリアダプターへ差し替えが可能です。
