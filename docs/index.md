# LAN-P2P Project Tracker ドキュメントインデックス

本ディレクトリ (`./docs`) は、同一ネットワーク (LAN) 内で動作する P2P 型プロジェクト進行管理ツールの抽象設計およびモジュール構造仕様を管理します。

## 開発方針・ポリシー参照
* ルールおよび設計原則: [`../DEV_POLICY_v1.0518.md`](../DEV_POLICY_v1.0518.md)

---

## ドキュメント一覧

1. [概念とユースケース (`./01_concept.md`)](./01_concept.md)
   - システム概念、柔軟なオプション属性、ツリー構造 (Parent-Child)、GitライクなJSONL追跡ログの定義
2. [システムアーキテクチャ抽象 (`./02_architecture.md`)](./02_architecture.md)
   - P2P ネットワーク、ノード発見、モジュール分割、DI（依存注入）レイヤー、JsonlFileRepository 設計
3. [データモデルと同期仕様 (`./03_data_sync.md`)](./03_data_sync.md)
   - タスクデータ仕様 (Parent-Child Spec)、Gitライクな JSONL 履歴追跡ログ、Tombstone 分散削除、コンフリクト解決
4. [拡張性およびプラグイン設計 (`./04_extension_spec.md`)](./04_extension_spec.md)
   - プロトコル抽象化、ストレージ抽象化、UI/インターフェース分離設計

---

## ドキュメントの保守方針
- すべての内部リンク・参照パスは**相対パス**で記述すること。
- モジュール間の依存はインターフェース定義（抽象）にとどめ、特定のトランスポート層（TCP/UDP/WebRTC等）やストレージ（SQLite/JSON等）に直接依存させないこと。
