# 02. システムアーキテクチャ抽象

[インデックスへ戻る](./index.md) | [前へ: 概念とユースケース](./01_concept.md)

---

## 1. レイヤー構造（Hexagonal / Clean Architecture）

開発方針 [`../DEV_POLICY_v1.0518.md`](../DEV_POLICY_v1.0518.md) に基づき、具象クラスへの直接依存を排除し、Core Domain（ビジネスロジック）を中心にポート＆アダプターパターンを採用します。

```
+-------------------------------------------------------------+
|                     Presentation Layer                      |
|       (Tree View Mode / Kanban View Mode Switcher UI)       |
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

### (1) Status Aggregator Port (自動ステータス算出ポート)
- **役割**: 子タスクの状態変更発生時、親タスクのステータスおよび進捗率（Completion Rate）を自動計算・連動させるドメインエンジン。

### (2) View Mode Switcher Port (ビュー切り替えポート)
- **役割**: ツリーファーストビュー (`TREE_VIEW`) と カンバンビュー (`KANBAN_VIEW`) の表示モード切り替え抽象化。

### (3) Peer Discovery & Transport Port (P2P通信ポート)
- **役割**: LAN 内の他ノード探査およびメッセージ送受信。

### (4) Project Repository Port (ストレージポート)
- **役割**: ローカルノードにおける `.jsonl` イベントログの永続化と読み込み。

---

## 3. Dependency Injection (DI) 方針
- `StatusAggregator` および `ViewMode` はドメインコアから独立したポートとして定義され、コンストラクタ経由で注入（DI）されます。

---

[次へ: データモデルと同期仕様](./03_data_sync.md)
