# 02. システムアーキテクチャ抽象

[インデックスへ戻る](./index.md) | [前へ: 概念とユースケース](./01_concept.md)

---

## 1. レイヤー構造（Hexagonal / Clean Architecture）

開発方針 [`../DEV_POLICY_v1.0518.md`](../DEV_POLICY_v1.0518.md) に基づき、具象クラスへの直接依存を排除し、Core Domain（ビジネスロジック）を中心にポート＆アダプターパターンを採用します。

```
+-------------------------------------------------------------+
|                     Presentation Layer                      |
| (Interactive Tree View, Arrow Keys Nav, Drag-Drop Parent)   |
+------------------------------+------------------------------+
                               | (Interfaces)
+------------------------------v------------------------------+
|                     Application / Domain                    |
| (Status Aggregator, Tree Validator, Sync Engine, Hash Log)  |
+--------------+------------------------------+---------------+
               | (Interfaces)                 | (Interfaces)
+--------------v--------------+ +-------------v---------------+
|     P2P Transport Layer     | |   Git-like Storage Layer    |
|  (Discovery, Socket, Mesh)  | | (JSONL File, InMemory, DB)  |
+-----------------------------+ +-----------------------------+
```

## 2. コンポーネントインターフェース定義（抽象ポート）

### (1) Status Aggregator Port (自動ステータス算出ポート)
- **役割**: 子タスクの状態変更発生時、親タスクのステータスを自動計算・連動させるドメインエンジン。
- **抽象機能**:
  - `recalculate_parent_status(parentId, state): TaskStatus`

### (2) Navigation & Interaction Port (UX操作ポート)
- **役割**: マウス Drag & Drop ペアレンティングおよびキーボード（十字キー）操作による状態・階層変更イベントの抽象化。
- **抽象機能**:
  - `on_parent_drop(sourceTaskId, targetParentId)`
  - `on_arrow_key_move(activeTaskId, direction: 'UP' | 'DOWN' | 'LEFT' | 'RIGHT')`

### (3) Peer Discovery & Transport Port (P2P通信ポート)
- **役割**: LAN 内の他ノード探査およびメッセージ送受信。

### (4) Project Repository Port (ストレージポート)
- **役割**: ローカルノードにおける `.jsonl` イベントログの永続化と読み込み。

---

## 3. Dependency Injection (DI) 方針
- `StatusAggregator` および `InteractionPort` は具象UIコードやファイル操作から分離され、ドメインサービスへコンストラクタ経由で外部注入（DI）されます。
- テスト時には UI なしでキーボード移動・ドラッグペアレンティング・親ステータス自動計算を単体テスト可能とします。

---

[次へ: データモデルと同期仕様](./03_data_sync.md)
