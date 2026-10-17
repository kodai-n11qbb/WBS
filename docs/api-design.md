# 3.4 API・通信設計 (api-design.md)

[ドキュメントインデックスへ戻る](./index.md) | [前へ: データモデル](./data-model.md) | [次へ: UIレイアウト](./ui-layout.md)

---

## 1. WebSocket 通信プロトコル仕様

WBSer のフロントエンド（ブラウザUI）とバックエンド（Node.js ローカルサーバー）、および各ノード間のリアルタイム通信は WebSocket を通じて行われます。

```
+-------------------+                          +-------------------+
|                   |  ── [WS: Action Message] ─>  |                   |
|  Browser Frontend |                              |  Node.js Server   |
|  (Canvas / Gantt) |  <── [WS: State / Error] ──  |  (NodeService)    |
|                   |                          +-------------------+
```

---

## 2. クライアントからサーバーへのアクションメッセージ (`ClientAction`)

クライアントから送信されるJSONメッセージは `action` プロパティによって識別されます。

### (1) `CREATE_TASK`
新しいタスクを作成します。
```json
{
  "action": "CREATE_TASK",
  "parentId": "86c31535-fbca-4083-85bb-4007efab4f08", // 省略またはnull時はルート
  "title": "新タスク名称",
  "priority": "MEDIUM", // "HIGH" | "MEDIUM" | "LOW"
  "status": "TODO",     // "TODO" | "IN_PROGRESS" | "DONE"
  "dueDate": 1792454400000 // IN_PROGRESS時は必須
}
```

### (2) `UPDATE_STATUS`
タスクのステータスおよび表示順序を更新します。
```json
{
  "action": "UPDATE_STATUS",
  "taskId": "86c31535-fbca-4083-85bb-4007efab4f08",
  "status": "IN_PROGRESS",
  "newOrderIndex": 1789980009938
}
```
> ※ `status` が `IN_PROGRESS` で、該当タスクの `dueDate` が未設定の場合はサーバーバリデーションエラーとなります。

### (3) `UPDATE_TITLE`
タスクのタイトル名を変更します。
```json
{
  "action": "UPDATE_TITLE",
  "taskId": "86c31535-fbca-4083-85bb-4007efab4f08",
  "title": "変更後のタスクタイトル"
}
```

### (4) `UPDATE_DUE_DATE`
タスクの完了予定日（ミリ秒タイムスタンプ）を更新します。
```json
{
  "action": "UPDATE_DUE_DATE",
  "taskId": "86c31535-fbca-4083-85bb-4007efab4f08",
  "dueDate": 1792454400000 // 削除時は null
}
```

### (5) `CHANGE_PARENT`
タスクの親要素を変更（ツリー構造の組み換え、またはルート化）します。
```json
{
  "action": "CHANGE_PARENT",
  "taskId": "86c31535-fbca-4083-85bb-4007efab4f08",
  "newParentId": null // ルート化の場合は null
}
```

### (6) `REORDER_TASK`
同一階層内での並び順を更新します。
```json
{
  "action": "REORDER_TASK",
  "taskId": "86c31535-fbca-4083-85bb-4007efab4f08",
  "newOrderIndex": 1789980009938
}
```

### (7) `DELETE_TASK`
タスクを削除します。
```json
{
  "action": "DELETE_TASK",
  "taskId": "86c31535-fbca-4083-85bb-4007efab4f08",
  "reason": "不要になったため（10文字以上の正当な理由文）"
}
```
> ※ 子要素が3つ以上存在する親タスクを削除する場合、`reason` が10文字未満であれば拒絶されます。

### (8) `UNDO_LAST_ACTION`
自端末（`authorNodeId`）が実行した直近のアクションを1つ取り消します。
```json
{
  "action": "UNDO_LAST_ACTION"
}
```

---

## 3. サーバーからクライアントへの通知メッセージ (`ServerNotification`)

### (1) `STATE_INIT` (初回接続時)
WebSocket接続確立時に送信され、クライアントの初期化を行います。
```json
{
  "type": "STATE_INIT",
  "nodeId": "dev-node-1",
  "projectId": "default-project",
  "dataFile": "/Users/abekoudai/Desktop/WBSer/data/events.jsonl",
  "events": [ /* 全SyncEvent配列 */ ],
  "state": {
    "project": { "id": "default-project", "name": "..." },
    "tasks": [ /* 全Taskオブジェクト配列 */ ]
  }
}
```

### (2) `STATE_UPDATED` (状態ブロードキャスト ＆ ホットリロード)
ローカルアクション実行後、または外部ファイル改変監視（File Watcher）による差分取り込み後に全クライアントへ配信されます。
```json
{
  "type": "STATE_UPDATED",
  "state": {
    "project": { "id": "default-project", "name": "..." },
    "tasks": [ /* 最新Taskオブジェクト配列 */ ]
  },
  "events": [ /* 最新SyncEvent配列 */ ]
}
```

### (3) `ERROR` (エラー通知)
バリデーション違反や例外発生時に送信されます。
```json
{
  "type": "ERROR",
  "message": "進行中ステータスには完了予定日が必要です。"
}
```
