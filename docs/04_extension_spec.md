# 04. 拡張性およびプラグイン設計

[インデックスへ戻る](./index.md) | [前へ: データモデルと同期仕様](./03_data_sync.md)

---

## 1. 拡張設計の基本姿勢

本設計は [`../DEV_POLICY_v1.0518.md`](../DEV_POLICY_v1.0518.md) に掲げられた開発ポリシーに準拠します。
特に**「Rule of Three（過度な先行抽象化の回避）」**と**「Dependency Injection（変更耐性の確保）」**のバランスを意識し、具象実装を追加しやすい疎結合な構造を維持します。

---

## 2. プラグイン・アダプターの拡張ポイント

### (1) Standalone Desktop Executable Adapter (環境依存ゼロのバイナリ配布)
Node.js, Python, Cargo (Rust) 等が**一切インストールされていない端末**でも、ダブルクリック一発で動作させるためのパッケージング手法。

- **Node.js Single Executable Applications (SEA) / Bun compile**:
  - バックグラウンド HTTP/WebSocket サーバーとフロントエンド静的資産を1つの独立した実行ファイル (`share-log-mac` / `share-log-win.exe`) にパッケージング。
  - ダブルクリックするとローカルサーバーが起動し、標準ブラウザで Web アプリ UI が立ち上がる。
- **Electron / Tauri パッケージング**:
  - 専用のデスクトップウィンドウアプリ (`.app` / `.exe`) としての配布に対応。

### (2) Transport Adapter (通信基盤の差し替え)
インターフェース `PeerDiscoveryPort` および `PeerTransportPort` を実装することで、通信方式を自由に切り替え可能とします。

- **フェーズ1 (初期検証)**: LAN 内 UDP Broadcast / Multicast
- **フェーズ2 (LAN内高度化)**: mDNS (Bonjour) + TCP Direct Socket
- **フェーズ3 (NAT越え/クロスネットワーク)**: WebRTC / libp2p アダプターの追加

### (3) Storage Adapter (永続化基盤の差し替え)
`ProjectRepositoryPort` を実装することで、利用環境に応じたストレージを選択可能とします。

- **In-Memory Storage**: 単体テスト・デモ用
- **JSON File / LocalStorage**: 簡易デスクトップ・ブラウザ利用時
- **SQLite / RocksDB**: 大規模なイベントログ・オフラインキャッシュ管理用

---

## 3. 相対パスによる保守ルール

ドキュメント間およびソースコード・資産間の参照は、すべてリポジトリ基準またはファイル位置基準の**相対パス**で統一します。

- 良い例: `./02_architecture.md`, `../DEV_POLICY_v1.0518.md`
- 避ける例: `/Users/.../docs/02_architecture.md` (環境依存のため不可)

---

[インデックスへ戻る](./index.md)
