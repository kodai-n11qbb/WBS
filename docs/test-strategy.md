# 7.1 テスト戦略仕様 (test-strategy.md)

[ドキュメントインデックスへ戻る](./index.md) | [前へ: 配布仕様](./packaging-spec.md) | [次へ: 単体テスト計画](./unit-test-plan.md)

---

## 1. テスト基本方針

WBSer の品質保証は、**「ロジックの正当性を担保するユニットテスト（Vitest）」** と **「Canvas描画の破綻・文字重なりを早期発見する自動検知テスト（Playwright）」** の二層構造で実施する。

```
+---------------------------------------------------------------+
|  UI描画・レイアウト破綻自動検知 (Playwright)                    |
|  - 画面外はみ出し検知 (Viewport Boundary Overflow)             |
|  - ノード・ラベル物理衝突検知 (Node/Label Collision)           |
|  - タイムライン縦積み過密検知 (Stack Height Threshold)         |
|  - 証拠スクリーンショット自動保存                             |
+---------------------------------------------------------------+
|  コア・ドメイン単体テスト (Vitest)                             |
|  - TaskValidator, SyncEngine, StatusAggregator                |
|  - JsonlRepository, SnapshotExporter, Config, NodeService     |
+---------------------------------------------------------------+
```

---

## 2. テスト種別と役割

### (1) コア・ドメイン単体テスト (Unit Tests - Vitest)
- **対象**: `src/domain/`, `src/core/`, `src/adapters/`
- **実行環境**: Vitest (`npm test`)
- **担保範囲**:
  - タスク生成・更新・循環参照防止バリデーション
  - イベント適用エンジン（SyncEngine）の整合性・追記順序保証
  - 完了状態の集計（StatusAggregator）
  - JSONL永続化および `state.json` スナップショット整合性
  - UDP P2P探索およびファイル変更監視（FsFileWatcher）

### (2) UI描画・レイアウト破綻自動検知 (Visual & Layout Tests - Playwright)
- **対象**: `public/app.js` による HTML5 Canvas レンダリング結果
- **実行環境**: Playwright CLI (`node scripts/check_display_issues.js`)
- **導入の目的**:
  - 要素数が増加した際に発生しやすい「文字の重なり」「画面端突き抜け」「タイムライン縦積み溢れ」を数値的かつ自動的に検知し、レイアウト破綻を未然に防ぐ。
- **検証メトリクスと判定基準**:
  1. **画面外はみ出し (Boundary Overflow)**:
     - 全ノードの円およびラベル矩形が、有効描画領域（幅: `0 ~ ViewportWidth`, 高さ: `TopBar(42px) ~ BottomDock(ViewportHeight - 65px)`）内に収まっているかを判定。
     - 領域外にはみ出した要素を警告（WARNING）またはエラー（ERROR）としてリスト化。
  2. **文字・要素の重なり (Label & Node Collision)**:
     - ノード円同士の中心間距離が互いの描画半径和未満になっていないか。
     - 近接するラベルプレート矩形（AABB: Axis-Aligned Bounding Box）が交差（Intersection）して文字が被っていないかを数学的に計算。
  3. **表示過密・縦積み限界 (Density & Vertical Overflow)**:
     - 同一完了予定日や期日未設定ゾーンにおいて、縦積みの高さがキャンバス有効高さを超過していないかをチェック。
  4. **証拠スクリーンショットの自動保存**:
     - 検査対象（全体グラフ、各主要タスク選択時のタイムライン、ホバー状態）ごとに画像を撮影し、破綻箇所を視覚的に特定可能とする。

---

## 3. 実行コマンドと運用

| 種別 | コマンド | タイミング | 判定基準 |
| :--- | :--- | :--- | :--- |
| **単体テスト** | `npm test` | コミット前・PR時 | 全件 PASS（ブロッカー） |
| **描画破綻検知** | `node scripts/check_display_issues.js` | UI/レイアウト変更時・デバッグ時 | はみ出し・重なり 0件 |

---

## 4. 継続的改善アプローチ
検知スクリプトによって検出された破綻パターン（例: 同一階層の過密、縦積み限界）に基づき、以下のUI/UX機能（子タスク折りたたみ、多列スタック、ズーム機能等）の導入優先度を客観的データから決定する。
