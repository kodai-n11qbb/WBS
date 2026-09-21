# 02. システムアーキテクチャ抽象

[インデックスへ戻る](./index.md) | [前へ: 概念とユースケース](./01_concept.md)

---

## 1. レイヤー構造（Hexagonal / Clean Architecture）

開発方針 [`../DEV_POLICY_v1.0518.md`](../DEV_POLICY_v1.0518.md) に基づき、具象クラスへの直接依存を排除し、Core Domain（ビジネスロジック）を中心にポート＆アダプターパターンを採用します。

```
+-----------------------------------------------------------------------+
|                         Presentation Layer                            |
| (Pure Tree View / Obsidian Interactive Canvas / ChatGPT Prompt Bar)   |
+----------------------------------+------------------------------------+
                                   | (Interfaces)
+----------------------------------v------------------------------------+
|                         Application / Domain                          |
| (Status Aggregator, Minimal Task Core, Sync Engine, Hash Log Engine)  |
+------------------+-------------------------------+--------------------+
                   | (Interfaces)                  | (Interfaces)
+------------------v--------------+ +--------------v--------------------+
|       P2P Transport Layer       | |     Git-like Storage Layer        |
|    (Discovery, Socket, Mesh)    | |  (JSONL File, InMemory, DB)       |
+---------------------------------+ +-----------------------------------+
```

## 2. コンポーネントインターフェース定義（抽象ポート）

### (1) Obsidian Interactive Graph Renderer Port (グラフレンダラーポート)
- **役割**: タスクの親子ネットワークを Obsidian 風のノードと光るエッジで描画するプレゼンテーションポート。
- **機能拡張**:
  - ノードの物理ドラッグ（マウスによる引き回し・跳ね返り物理計算）。
  - ノードクリックによるカンバン/ツリービューの対象タスクカードのフォーカス連動。

### (2) Idle Auto-Screensaver Port (背景自動イマーシブ移行ポート)
- **役割**: 4秒間の操作停止を検出し、Obsidian グラフを body 全面の背景スクリーンセーバーへ移行（手前 UI のフェードアウト）。画面クリックにより即座に編集画面へ復帰させる判定ロジック。

### (3) Status Aggregator Port (自動ステータス算出ポート)
- **役割**: 子タスクの状態変更発生時、親タスクのステータスおよび進捗率（Completion Rate: 例 `66.7%`）を自動計算し、親タスクのステータス変更操作をロック (`🔒 自動算出`) するドメインエンジン。

### (4) Standalone Executable Packaging Adapter (単体実行バイナリ)
- **役割**: Node.js, Python, Cargo 等が入っていない環境でも、単一バイナリ (`.exe` / `.app`) をダブルクリックするだけでローカル Web サーバーが立ち上がり画面を自動オープンするアダプター構造。

---

## 3. Dependency Injection (DI) 方針
- `ObsidianGraphRenderer`, `IdleTimer`, および `StatusAggregator` もドメインコアから分離された独立ポートとして外部注入（DI）可能とします。

---

[次へ: データモデルと同期仕様](./03_data_sync.md)
