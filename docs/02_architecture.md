# 02. システムアーキテクチャ抽象

[インデックスへ戻る](./index.md) | [前へ: 概念とユースケース](./01_concept.md)

---

## 1. レイヤー構造（Hexagonal / Clean Architecture）

開発方針 [`../DEV_POLICY_v1.0518.md`](../DEV_POLICY_v1.0518.md) に基づき、具象クラスへの直接依存を排除し、Core Domain（ビジネスロジック）を中心にポート＆アダプターパターンを採用します。

```
+-------------------------------------------------------------+
|                     Presentation Layer                      |
|       (Tree & Kanban Drag-Drop Web UI / CLI / Desktop)      |
+------------------------------+------------------------------+
                               | (Interfaces)
+------------------------------v------------------------------+
|                     Application / Domain                    |
|    (Tree Validator, Sync Engine, Git-like Hash Logger)      |
+--------------+------------------------------+---------------+
               | (Interfaces)                 | (Interfaces)
+--------------v--------------+ +-------------v---------------+
|     P2P Transport Layer     | |   Git-like Storage Layer    |
|  (Discovery, Socket, Mesh)  | | (JSONL File, InMemory, DB)  |
+-----------------------------+ +-----------------------------+
```

## 2. コンポーネントインターフェース定義（抽象ポート）

### (1) Task Validator Port (ツリー検証ポート)
- **役割**: ドメインイベント発行前に入力データ（タイトル1文字以上）およびツリー構造制約（循環参照防止）を満たしているかを検証する。
- **抽象機能**:
  - `validate_task_creation(payload): ValidationResult`
  - `validate_tree_relationship(parentId, childId): ValidationResult`

### (2) Peer Discovery Port (ノード発見ポート)
- **役割**: LAN 内の他ノードを検出し、参加/離脱イベントをドメインへ通知する。
- **抽象機能**:
  - `start_discovery()`
  - `stop_discovery()`
  - `on_peer_found(callback)`
  - `on_peer_lost(callback)`

### (3) Peer Transport Port (P2P通信ポート)
- **役割**: ノード間のデータメッセージの送受信を担当。
- **抽象機能**:
  - `send_message(peer_id, payload)`
  - `broadcast_message(payload)`
  - `on_message_received(callback)`

### (4) Project Repository Port (ストレージポート)
- **役割**: ローカルノードにおける Git ライクな `.jsonl` イベントログの永続化と読み込み。
- **抽象機能**:
  - `save_event(event)`
  - `get_events_since(timestamp_or_seq)`
  - `get_project_state(project_id)`

---

## 3. Dependency Injection (DI) 方針
- ドメインコアは具象ファイル操作、ソケット通信、特定DBドライバを直接 `new` せず、すべてインターフェース経由で外部注入（DI）を受ける。
- テスト時には `InMemoryRepository` を用い、本番・ローカル保存時には `JsonlFileRepository` へ容易に切り替え可能な構造とする。

---

[次へ: データモデルと同期仕様](./03_data_sync.md)
