# 03. データモデルと同期仕様

[インデックスへ戻る](./index.md) | [前へ: アーキテクチャ抽象](./02_architecture.md)

---

## 1. ドメインモデルエンティティ（Local-First 原則）

オフライン時の独立編集と接続時の自動マージを実現するため、直接上書き更新ではなく **「イベントログの集約（Event Sourcing）」** および **「CRDT (Conflict-free Replicated Data Type)」** の原則を採用します。

### 主要概念
- **Project**: 管理対象のプロジェクト枠組み（ID, Name, CreatedAt, OwnerNodeId）
- **Structured Task**: 構造化の強制ルールが適用された作業項目（下記参照）
- **Member / Node**: ネットワーク内の参加者ノード（NodeID, DisplayName, LastSeenAt）
- **Event**: 進行状態の変更・削除を表す不変 (Immutable) なレコード

---

## 2. 構造化タスク仕様 (Structured Task Spec)

タスクの曖昧さを排除するため、以下のフィールド構造および**入力バリデーションルールの強制**をドメイン層で適用します。

```typescript
export interface DefinitionOfDoneItem {
  id: string;
  text: string;
  completed: boolean;
}

export interface StructuredTask {
  id: string;
  projectId: string;
  title: string;                 // 必須: タスクの概要名
  intent: string;                // 必須: なぜこの作業を行うのか（目的・背景）
  definitionOfDone: DefinitionOfDoneItem[]; // 必須: 完了とみなす条件チェックリスト（最低1個）
  priority: 'HIGH' | 'MEDIUM' | 'LOW';     // 必須: 優先度
  status: 'TODO' | 'IN_PROGRESS' | 'DONE';  // 必須: ステータス
  orderIndex: number;            // 必須: カラム内表示順序（Drag & Drop移動用）
  assignedNodeId?: string;
  updatedAt: number;
  authorNodeId: string;
}
```

### 構造化強制バリデーションルール (Domain Rule)
1. `title`: 空白を除き 3 文字以上であること。
2. `intent`: 空白不可（なぜこの作業をするのかの背景を言語化させる）。
3. `definitionOfDone`: 最低 1 つ以上のチェックリスト項目を含んでいること。
4. **制約を満たさないイベントはドメインバリデータによって拒絶され、イベントログに追加されない。**

---

## 3. 操作イベントおよび分散削除仕様 (Tombstone Pattern)

P2P分散環境では、データを物理削除すると他ノードとの再同期時に削除事実が伝播せずタスクが復活する「ゴーストタスク問題」が発生します。そのため、本システムでは **Tombstone (墓標) パターン** を採用します。

1. **`TASK_CREATED`**: 構造化要件を満たしたタスク新規登録。
2. **`TASK_STATUS_UPDATED`**: ステータス変更またはDrag & Drop移動。
3. **`TASK_REORDERED`**: 同一カラム内での順序並び替え。
4. **`TASK_DELETED` (Tombstone Event)**:
   - Payload: `{ taskId, deletedAt, reason? }`
   - 不変イベントとしてログに追加・分散伝播され、ドメイン還元処理 (Reduce State) において最終状態から当該タスクを除外する。
   - 削除イベント発生後に遅れて到着した旧編集イベントは、タイムスタンプ比較により自動的に無視される。

---

## 4. オフライン編集と分散マージの仕組み

### (1) オフライン時のローカル保存
- 各端末は自身のローカルDB（SQLite / LevelDB / JSON）へ構造化イベントログを追加します。
- サーバー問い合わせを必要としないため、完全オフラインで即座にUIへ反映されます。

### (2) 再接続時の非同期差分交換 (P2P Delta Sync)

```
[端末 A (オフラインで削除 A_del)]               [端末 B (オフラインで編集 B_edit)]
              |                                                   |
              +-------------- LAN 接続確立 (P2P) ------------------+
              |                                                   |
              | --- 1. SYNC_VECTOR (保持イベントID一覧/時刻) ----> |
              | <-- 2. SYNC_VECTOR (保持イベントID一覧/時刻) ----- |
              |                                                   |
              | --- 3. MISSING_EVENTS (A_del を送信) ------------> |
              | <-- 4. MISSING_EVENTS (B_edit を送信) ------------ |
              |                                                   |
    (A_del によりタスク削除で合意)                      (A_del によりタスク削除で合意)
              |                                                   |
              v                                                   v
      [端末A: 削除状態で整合完了]                         [端末B: 削除状態で整合完了]
```

---

## 5. コンフリクト解決ルール

複数の端末がオフライン中に「同じタスクに対する編集」と「削除」を同時に行った場合の解決ルール：

1. **Logical Timestamp (Lamport/Vector Clock)**: 各イベントに付与されたタイムスタンプとノードIDの順序定義に基づき、全ノードで決定論的 (Deterministic) に同一の結果を算出する。
2. **Tombstone Win Rule (削除優先/タイムスタンプ判定)**: 削除イベント `TASK_DELETED` のタイムスタンプが編集イベントと同等以上の場合は削除が優先され、状態から削除される。

---

[次へ: 拡張性およびプラグイン設計](./04_extension_spec.md)
