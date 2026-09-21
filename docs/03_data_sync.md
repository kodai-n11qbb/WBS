# 03. データモデルと同期仕様

[インデックスへ戻る](./index.md) | [前へ: アーキテクチャ抽象](./02_architecture.md)

---

## 1. ドメインモデルエンティティ（Local-First 原則）

オフライン時の独立編集と接続時の自動マージを実現するため、直接上書き更新ではなく **「イベントログの集約（Event Sourcing）」** および **「CRDT (Conflict-free Replicated Data Type)」** の原則を採用します。

### 主要概念
- **Project**: 管理対象のプロジェクト枠組み（ID, Name, CreatedAt, OwnerNodeId）
- **Task**: 個別の作業項目（ID, ProjectID, Title, Status, AssignedNodeId, UpdatedAt）
- **Member / Node**: ネットワーク内の参加者ノード（NodeID, DisplayName, LastSeenAt）
- **Event**: 進行状態の変更を表す不変 (Immutable) なレコード（オフライン時もローカルDBに直接追加される）

---

## 2. オフライン編集と分散マージの仕組み

### (1) オフライン時のローカル保存
- 各端末は自身のローカルDB（SQLite / LevelDB / JSON）へイベントログを追加します。
- サーバー問い合わせを必要としないため、完全オフラインで即座にUIへ反映されます。

### (2) 再接続時の非同期差分交換 (P2P Delta Sync)

```
[端末 A (オフラインで更新 A1, A2)]                [端末 B (オフラインで更新 B1, B2)]
              |                                                   |
              +-------------- LAN 接続確立 (P2P) ------------------+
              |                                                   |
              | --- 1. SYNC_VECTOR (保持イベントID一覧/時刻) ----> |
              | <-- 2. SYNC_VECTOR (保持イベントID一覧/時刻) ----- |
              |                                                   |
              | --- 3. MISSING_EVENTS (未所持の A1, A2 を送信) --> |
              | <-- 4. MISSING_EVENTS (未所持の B1, B2 を送信) --- |
              |                                                   |
    (A1, A2, B1, B2 を統合)                             (A1, A2, B1, B2 を統合)
              |                                                   |
              v                                                   v
      [端末A: 最新状態で同期完了]                         [端末B: 最新状態で同期完了]
```

---

## 3. コンフリクト解決ルール

複数の端末がオフライン中に「同じタスクのタイトルやステータス」を同時に変更した場合の解決ルール：

1. **Logical Timestamp (Lamport/Vector Clock)**: 各イベントに付与されたタイムスタンプとノードIDの順序定義に基づき、全ノードで決定論的 (Deterministic) に同一の結果を算出する。
2. **LWW (Last-Write-Wins) Set**: タスクの属性更新において、最も新しい論理タイムスタンプを持つ変更を最終値として採用する。
3. **Additive Operations (追加操作の無競合化)**: コメント追加や作業ログ追加などの操作は単なるログ追加（Append-Only）のため、競合せずそのまま全ノードに合成される。

---

[次へ: 拡張性およびプラグイン設計](./04_extension_spec.md)
