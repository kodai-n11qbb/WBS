# 5.1 データベース・永続化仕様 (database-schema.md)

[ドキュメントインデックスへ戻る](./index.md) | [前へ: デザインシステム](./design-system.md) | [次へ: 同期メカニズム](./sync-mechanism.md)

---

## 1. 永続化方針の概要

WBSer は、RDBMSやクラウドDBを使用せず、ローカルファイルシステム上の **`events.jsonl`（追記型イベントログ）** と **`state.json`（最新状態スナップショット）** の2つの平文JSONファイルによってデータを完全管理します。

```
[実行ディレクトリ (CWD)]
  └── data/                           <-- デフォルト保存ディレクトリ
        ├── events.jsonl              <-- 不可変イベントログ (追加専用)
        └── state.json                <-- 最新状態スナップショット
```

---

## 2. ディレクトリ構造 ＆ 絶対パス解決仕様

1. **標準フォルダ `data/`**:
   - ターミナルからアクセスしやすく可視性の高い `data/` フォルダを標準の保存先とします。
2. **絶対パスによる統一解決 (`path.resolve`)**:
   - カレントワーキングディレクトリ（CWD）を基準に、`path.resolve(process.cwd(), config.dataDir || 'data')` を用いて内部的に完全な絶対パスへ変換して保持します。
   - これにより、単一バイナリ実行時や外部共有ドライブ指定時でもパス解決の曖昧さを排除します。
3. **既存隠しフォルダ (`./.wbser_data`) フォールバック互換性**:
   - 過去バージョン等で作成された `./.wbser_data` ディレクトリが存在する場合、システムはそれを自動検出し、データ読み書き先としてシームレスにフォールバック引き継ぎを行います。

---

## 3. ファイルフォーマット詳細

### (1) 不可変イベントログファイル (`data/events.jsonl`)
- **形式**: JSON Lines（各行が独立した有効なJSONオブジェクト）
- **書き込み規則**: 原則として追記専用（Append-Only）。
- **行スキーマ**:
  ```json
  {"id":"evt-1","projectId":"default-project","authorNodeId":"dev-1","timestamp":1789980000000,"sequence":1,"type":"PROJECT_CREATED","payload":{"name":"WBSer Project"}}
  {"id":"evt-2","projectId":"default-project","authorNodeId":"dev-1","timestamp":1789980010000,"sequence":2,"type":"TASK_CREATED","payload":{"task":{"id":"task-1","title":"コア設計","status":"TODO","priority":"MEDIUM","orderIndex":1789980010000,"parentId":null}}}
  ```

### (2) 状態スナップショットファイル (`data/state.json`)
- **形式**: 単一の整形済み JSON オブジェクト
- **書き込み規則**: アトミックな置換書き込み（一時ファイル生成後、アトミックリネーム）。
- **スキーマ**:
  ```json
  {
    "projectId": "default-project",
    "updatedAt": 1789980033297,
    "tasks": [
      {
        "id": "task-1",
        "projectId": "default-project",
        "title": "コア設計",
        "status": "IN_PROGRESS",
        "priority": "HIGH",
        "orderIndex": 1789980010000,
        "parentId": null,
        "dueDate": 1792454400000,
        "updatedAt": 1789980033297,
        "authorNodeId": "dev-1"
      }
    ]
  }
  ```

---

## 4. 単一バイナリ (pkg) 実行時の分離アーキテクチャ

`@yao-pkg/pkg` による単一実行バイナリ実行時、実行ファイル内部の仮想ファイルシステム（VFS: `/snapshot/...`）は読み取り専用（Read-Only）です。

- **静的資産 (HTML/CSS/JS)**: VFS 内部から高速に配信。
- **動的データ (`state.json`, `events.jsonl`)**: ホストPC側の絶対パス指定ストレージ（`data/`）へ安全に書き出し。
- これにより、単一バイナリでありながらデータの恒久的な永続化と外部バックアップ・Git管理を両立しています。
