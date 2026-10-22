# 8.1 パッケージング・配布仕様 (packaging-spec.md)

[ドキュメントインデックスへ戻る](./index.md) | [前へ: 同期メカニズム](./sync-mechanism.md) | [次へ: 変更履歴](./CHANGELOG.md)

---

## 1. 単一バイナリ配布仕様 (Standalone Desktop Executable)

WBSer は、Node.js, Python, npm, Docker 等の開発環境が一切インストールされていない一般的なビジネスPC環境でも、ファイルをダブルクリックするだけで即座に起動・運用できるように、ネイティブ実行バイナリとしてパッケージングされます。

---

## 2. パッケージング構造 (`@yao-pkg/pkg` ＋ `esbuild`)

```
[ソースコード (TypeScript)]
      │
      v (esbuild バンドル: CJS形式)
[dist/bundle.cjs] ＋ [public/ (HTML/CSS/JS)] ＋ [Node.js 18 ランタイム]
      │
      v (@yao-pkg/pkg パッケージング)
[独立ネイティブ実行バイナリ (bin/wbser-*)]
```

### ビルドコマンド
```bash
npm run build:exe
```
このコマンドにより、TypeScriptの型チェック、`esbuild` による `dist/bundle.cjs` 生成、および `pkg` によるマルチプラットフォームバイナリ生成が一括実行されます。

### 出力ターゲット (`bin/`)
| プラットフォーム | 出力ファイル名 | 対象環境 |
| :--- | :--- | :--- |
| **Windows** | `bin/wbser-win-x64.exe` | Windows 10 / 11 (64bit) |
| **macOS (Apple Silicon)** | `bin/wbser-macos-arm64` | Mac M1 / M2 / M3 / M4 |
| **macOS (Intel)** | `bin/wbser-macos-x64` | Intel Mac |

---

## 3. 実行メカニズム

1. **メモリ展開**: バイナリをダブルクリックすると、内部の VFS（Virtual File System: `/snapshot/...`）上にNode.jsおよび静的資産が展開されます。
2. **ポート自動探索＆サーバー起動**: ポート番号（デフォルト: `3000`）から探索を開始し、使用中（`EADDRINUSE`）の場合は `3001`〜`3050` の範囲で利用可能な空きポートを自動探索して HTTP/WebSocket サーバーを立ち上げます。
3. **ブラウザ自動オープン**: OSの既定のWebブラウザが起動し、自動検出されたポート（`http://localhost:<port>`）が全画面表示されます（`config.autoOpen: true` 時）。
4. **外部ストレージへの安全書き出し (`./WBS_data/`)**: バイナリ実行時、データの永続化（`events.jsonl` および `state.json`）のデフォルト保存先はバイナリ配置ディレクトリ直下の `./WBS_data/` となり、外部ストレージへ安全に書き込まれます（開発実行環境では従来の `./data/` を維持）。
5. **ブラウザ切断時の自動終了 (Auto-Exit)**: バイナリ実行時、ブラウザのタブまたはウィンドウが閉じられWebSocket接続数が 0 になったことを検知すると、誤終了（ページリロード）防止のための猶予時間（4秒間）を経て、プロセスを安全に自動終了します（開発実行時はプロセス維持）。

---

## 4. 対話型セットアップCLI (`scripts/setup.ts`)

初回導入時や設定カスタマイズのために、対話型セットアップウィザードが提供されています。

```bash
npm run setup
```

### ウィザードの対話フロー
1. **動作モードの選択**: `P2P` (分散) / `CLIENT` (クライアント) / `HOST` (ホスト)
2. **ポート番号の入力**: デフォルト `3000`
3. **データ保存先ディレクトリ**: デフォルト `data`（絶対パスとして自動解決）
4. **CLIENTモード時のホストIP**: `192.168.x.x:3000` 等
5. **設定の保存とバイナリビルド**: `config.json` を生成し、設定が組み込まれた単一バイナリを自動生成。
