# 02. システムアーキテクチャ抽象

[インデックスへ戻る](./index.md) | [前へ: 概念とユースケース](./01_concept.md)

---

## 1. レイヤー構造（Hexagonal / Clean Architecture）

開発方針 [`../DEV_POLICY_v1.0518.md`](../DEV_POLICY_v1.0518.md) に基づき、具象クラスへの直接依存を排除し、Core Domain（ビジネスロジック）を中心にポート＆アダプターパターンを採用します。

```
+-----------------------------------------------------------------------------------------+
|                                   Presentation Layer                                    |
| (Pure Tree View / Obsidian Spring Physics Canvas / Bottom Fixed ChatGPT Prompt Bar)     |
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

### (1) Obsidian Spring Physics Renderer Port (グラフレンダラーポート)
- **役割**: タスクの親子ネットワークを Obsidian 風のノードとバネ物理（Spring Elasticity）で描画するプレゼンテーションポート。
- **機能**:
  - ノードドラッグ時のバネ弾性連動（接続ノードが引きずられて滑らかに追従）。
  - 親を持たないルートノードを他ノードへ重ね合わせた際の「親子化確認モーダルダイアログ」トリガー。
  - ノードクリックによるツリー/カンバン表示の対象タスクカードへのフォーカス連動。

### (2) Status Aggregator & Priority Sorting Port (ステータス算出・ソートポート)
- **役割**:
  - 子タスクの状態から親タスクの進捗率（Completion Rate: 例 `66.7%`）および自動ステータス変更を計算。
  - カンバンビューにおいて親タスクを各カラムの最上部に優先配置（Priority Sorting）。

### (3) Standalone Executable Packaging Adapter (単体実行バイナリ)
- **役割**: Node.js, Python, Cargo 等が入っていない環境でも、単一バイナリ (`.exe` / `.app`) をダブルクリックするだけでローカル Web サーバーが立ち上がり画面を自動オープンするアダプター構造。

---

## 3. Dependency Injection (DI) 方針
- `ObsidianPhysicsRenderer` および `StatusAggregator` もドメインコアから分離された独立ポートとして外部注入（DI）可能とします。

---

[次へ: データモデルと同期仕様](./03_data_sync.md)
