# 04. 拡張性およびプラグイン設計

[インデックスへ戻る](./index.md) | [前へ: データモデルと同期仕様](./03_data_sync.md)

---

## 1. 拡張設計の基本姿勢

本設計は [`../DEV_POLICY_v1.0518.md`](../DEV_POLICY_v1.0518.md) に掲げられた開発ポリシーに準拠します。
特に**「Rule of Three（過度な先行抽象化の回避）」**と**「Dependency Injection（変更耐性の確保）」**のバランスを意識し、具象実装を追加しやすい疎結合な構造を維持します。

---

## 2. プラグイン・アダプターの拡張ポイント

### (1) Standalone Desktop Executable Adapter (環境依存ゼロ・単一バイナリ配布仕様)
Node.js, Python, Docker, Rust 等が**一切インストールされていない一般PC環境**でも、ダブルクリック一発で起動・P2P連携させるためのパッケージングアーキテクチャ。

- **`@yao-pkg/pkg` パッケージング構造**:
  - バックグラウンド Node.js 実行エンジン ＋ TypeScriptビルド済みJS (`dist/`) ＋ Webフロントエンド静的資産 (`public/`) を1つの独立したネイティブバイナリにパッケージング。
  - **出力ターゲット**:
    - Windows用: `bin/share-log-win.exe` (Windows 64bit用 `.exe`)
    - Mac用 (Apple Silicon): `bin/share-log-macos-arm64` (M1/M2/M3 Mac用)
    - Mac用 (Intel): `bin/share-log-macos-x64` (Intel Mac用)
  - **実行メカニズム**:
    - ダブルクリックするとバイナリ内部の VFS (Virtual File System) から Node.js がメモリ起動。
    - ローカルWebサーバー (`http://localhost:3000`) を即座に立ち上げ、既定のWebブラウザでアプリケーションUIを自動オープン。

### (2) Interactive CLI Setup & Configuration Adapter (対話型セットアップ ＆ 設定ファイルアダプター)
- **対話型スクリプト (`npm run setup`)**:
  - ターミナルで動作モード（`P2P` / `CLIENT` / `HOST`）やアドレス（端末IP / データ保存ディレクトリ `./data` のパス）に関する対話的質問に回答するだけで `config.json` を自動生成し、そのまま `bin/` へ設定済み単一バイナリを出力。
- **起動時ハイブリッド設定ロジック**:
  - `config.json` の設定値を自動ロード。CLI 引数（例: `--port 4000`, `--data-dir ./data`）がある場合は引数を優先オーバライド適用。

### (3) Transport Adapter (通信基盤の差し替え)
インターフェース `PeerDiscoveryPort` および `PeerTransportPort` を実装することで、通信方式を自由に切り替え可能とします。

- **フェーズ1 (実装済み)**: LAN 内 UDP Broadcast 自動発見 (`UdpPeerTransport`) ＋ WebSocket UI伝播
- **フェーズ2 (LAN内高度化)**: mDNS (Bonjour) 応答 ＋ TCP Direct Socket 接続
- **フェーズ3 (NAT越え/クロスネットワーク)**: WebRTC / libp2p アダプターの追加

### (4) Storage Adapter (永続化基盤の差し替え)
`ProjectRepositoryPort` を実装することで、利用環境に応じたストレージを選択可能とします。

- **JSON State Snapshot & Event Directory**: `./data` ディレクトリ管理 (`state.json` 状態ファイル ＆ `events.jsonl` イベントログ)
- **In-Memory Storage**: 単体テスト・デモ用
- **SQLite / RocksDB**: 大規模なイベントログ・オフラインキャッシュ管理用

---

## 3. 相対パスによる保守ルール

ドキュメント間およびソースコード・資産間の参照は、すべてリポジトリ基準またはファイル位置基準の**相対パス**で統一します。

- 良い例: `./02_architecture.md`, `../DEV_POLICY_v1.0518.md`
- 避ける例: `/Users/.../docs/02_architecture.md` (環境依存のため不可)

---

[インデックスへ戻る](./index.md)
