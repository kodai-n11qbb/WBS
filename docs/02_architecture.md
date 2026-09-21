# 02. システムアーキテクチャ抽象

[インデックスへ戻る](./index.md) | [前へ: 概念とユースケース](./01_concept.md)

---

## 1. レイヤー構造（Hexagonal / Clean Architecture）

開発方針 [`../DEV_POLICY_v1.0518.md`](../DEV_POLICY_v1.0518.md) に基づき、具象クラスへの直接依存を排除し、Core Domain（ビジネスロジック）を中心にポート＆アダプターパターンを採用します。

```
+-------------------------------------------------------------+
|                     Presentation Layer                      |
| (Pure Tree View / Obsidian Graph Renderer / Idle Auto Sync) |
+------------------------------+------------------------------+
                               | (Interfaces)
+------------------------------v------------------------------+
|                     Application / Domain                    |
| (Status Aggregator, Minimal Task Core, Sync Engine, Hash Log)|
+--------------+------------------------------+---------------+
               | (Interfaces)                 | (Interfaces)
+--------------v--------------+ +-------------v---------------+
|     P2P Transport Layer     | |   Git-like Storage Layer    |
|  (Discovery, Socket, Mesh)  | | (JSONL File, InMemory, DB)  |
+-----------------------------+ +-----------------------------+
```

## 2. コンポーネントインターフェース定義（抽象ポート）

### (1) Obsidian Graph Renderer Port (グラフレンダラーポート)
- **役割**: タスクの親子ネットワークを Obsidian 風のノードと光るエッジ（線）でグラフィカルに描画するプレゼンテーションポート。

### (2) Idle Auto-Transition Port (無操作自動遷移ポート)
- **役割**: ユーザーの操作停止（タイマー判定）を検出し、スムーズに Obsidian グラフ表示へ自動イマーシブ移行させるポート。

### (3) Status Aggregator Port (自動ステータス算出ポート)
- **役割**: 子タスクの状態変更発生時、親タスクのステータスおよび進捗率（Completion Rate）を自動計算・連動させるドメインエンジン。

### (4) Project Repository Port (ストレージポート)
- **役割**: ローカルノードにおける `.jsonl` イベントログの永続化と読み込み。

---

## 3. Dependency Injection (DI) 方針
- `ObsidianGraphRenderer` や `IdleTimer` もドメインコアから分離された独立ポートとして外部注入（DI）可能とします。

---

[次へ: データモデルと同期仕様](./03_data_sync.md)
