# 02. システムアーキテクチャ抽象

[インデックスへ戻る](./index.md) | [前へ: 概念とユースケース](./01_concept.md)

---

## 1. レイヤー構造（Hexagonal / Clean Architecture）

開発方針 [`../DEV_POLICY_v1.0518.md`](../DEV_POLICY_v1.0518.md) に基づき、具象クラスへの直接依存を排除し、Core Domain（ビジネスロジック）を中心にポート＆アダプターパターンを採用します。

```
+-----------------------------------------------------------------------------------------+
|                                   Presentation Layer                                    |
| (Pure Tree View / Floating Cards Layer / Obsidian Canvas / Bottom ChatGPT Prompt Bar)   |
+-------------------------------------------+---------------------------------------------+
                                            | (Interfaces)
+-------------------------------------------v---------------------------------------------+
|                                   Application / Domain                                  |
| (Status Aggregator, Minimal Task Core, Sync Engine, Hash Log, Node Spring Physics Engine)|
+-------------------+---------------------------------------+-----------------------------+
                    | (Interfaces)                          | (Interfaces)
+-------------------v-------------+         +---------------+-----------------------------+
|       P2P Transport Layer       |         |       Git-like Storage Layer                |
|    (Discovery, Socket, Mesh)    |         |    (JSONL File, InMemory, DB)               |
+---------------------------------+         +---------------------------------------------+
```

## 2. コンポーネントインターフェース定義（抽象ポート）

### (1) Screen-Floating Layer & Pure Tree View Port (浮遊層＆樹状ツリービューポート)
- **役割**: 画面上を優しく漂う未分類フローズンカードと高度なツリー構造の描画・操作。
- **機能**:
  - 親を持たない未分類タスクを画面上の空きスペースに浮遊描画 (`.floating-unclassified-card`)。
  - ドラッグしてツリー内のタスク枠内へ重ね合わせることで、直感的に子要素化。
  - 親タスクの背景グラデーション (`linear-gradient`) による省スペース進捗 fill 描画。
  - 視覚的DOM描画順に従う統一キーボードナビゲーション (`ArrowUp` / `ArrowDown` / `ArrowLeft` / `ArrowRight`)。

### (2) Obsidian Spring Physics Renderer Port (グラフレンダラーポート)
- **役割**: タスクの親子ネットワークを Obsidian 風のノードとバネ物理（Spring Elasticity）で描画するプレゼンテーションポート。
- **機能**:
  - ノードドラッグ時のバネ弾性連動（接続ノードが引きずられて滑らかに追従）。
  - ノードの円盤枠内（半径45px）へのドラッグ＆ドロップによる「親子化確認モーダルダイアログ」トリガー。
  - ノードクリックによるツリー/カンバン表示の対象タスクカードへのフォーカス連動。

### (3) Status Aggregator & Single-Parent Hierarchy Port (進捗算出・単一親構造ポート)
- **役割**:
  - 子タスクの状態から親タスクの進捗率（Completion Rate: 例 `33.3%`）を動的算出。
  - 1:Nの単一親ツリー構造 (`parentId?: string | null`) を厳守し、巡回（Cycle）参照の発生を防止。

### (4) Standalone Executable Packaging Adapter (単体実行バイナリ)
- **役割**: Node.js, Python, Cargo 等が入っていない環境でも、単一バイナリ (`.exe` / `.app`) をダブルクリックするだけでローカル Web サーバーが立ち上がり画面を自動オープンするアダプター構造。

---

## 3. Dependency Injection (DI) 方針
- `ObsidianPhysicsRenderer` および `StatusAggregator` もドメインコアから分離された独立ポートとして外部注入（DI）可能とします。

---

[次へ: データモデルと同期仕様](./03_data_sync.md)

