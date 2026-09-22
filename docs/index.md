# LAN-P2P Project Tracker ドキュメントインデックス

本ディレクトリ (`./docs`) は、同一ネットワーク (LAN) 内で動作する P2P 型プロジェクト進行管理ツールの抽象設計およびモジュール構造仕様を管理します。

## 開発方針・ポリシー参照
* ルールおよび設計原則: [`../DEV_POLICY_v1.0518.md`](../DEV_POLICY_v1.0518.md)

---

## ドキュメント一覧

1. [概念とユースケース (`./01_concept.md`)](./01_concept.md)
   - 2ビュー構成（Obsidian型前面ノードグラフ ＋ GanttProject風ガントチャート）、ノードクリック・クイックインスペクター（タイトル編集・ステータス切替・完了予定日・ルート化）、キャンバス内上部ルート化ドロップゾーン、日付単位ガントチャート表示（`YYYY/MM/DD`）、Linear/Raycast風モノトーンUI ＆ ダーク/ライトモード、3動作モード (HOST/CLIENT/P2P)、最新状態スナップショット (`data/state.json`)
2. [システムアーキテクチャ抽象 (`./02_architecture.md`)](./02_architecture.md)
   - ObsidianSpringPhysicsHierarchicalCanvasPort, ObsidianNodeInspectorPort, GanttTimelineViewPort, UnifiedParentElevationPort, ThemeManager, StatusAggregator, 単体バイナリ packaging アダプター, 対話型セットアップCLI, DI（依存注入）レイヤー設計
3. [データモデルと同期仕様 (`./03_data_sync.md`)](./03_data_sync.md)
   - ミニマルタスク仕様（`dueDate`完了予定日属性含む）、全8種イベントログ仕様 (`events.jsonl`)、HOST/CLIENT/P2P 3モード ＆ `config.json` 仕様、ノードクリック操作・キャンバス内ルート化・ガントチャートタイムラインビジュアル仕様
4. [拡張性およびプラグイン設計 (`./04_extension_spec.md`)](./04_extension_spec.md)
   - 単体デスクトップ実行ファイル化 (.exe / .app), 対話型CLIセットアップアダプター (`npm run setup`), プロトコル抽象化, ストレージ抽象化
---

## ドキュメントの保守方針
- すべての内部リンク・参照パスは**相対パス**で記述すること。
- モジュール間の依存は指示に従い疎結合な設計にとどめること。
