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
4. **外部ストレージへの安全書き出し (`./WBS_data/`)**: バイナリ実行時および開発実行時ともに、データの永続化（`events.jsonl` および `state.json`）のデフォルト保存先は相対パス `./WBS_data/` となり、外部ストレージへ安全に書き込まれます。
5. **ブラウザ切断時の自動終了 (Auto-Exit)**: バイナリ実行時、ブラウザのタブまたはウィンドウが閉じられWebSocket接続数が 0 になったことを検知すると、誤終了（ページリロード）防止のための猶予時間（4秒間）を経て、プロセスを安全に自動終了します（開発実行時はプロセス維持）。

---

## 4. ゼロコンフィグ・ビルド＆セットアップ (`npm run setup` / `npm run build:exe`)

WBSer は動作モードの選択や対話入力を一切必要とせず、ダブルクリックまたはワンコマンドで即座に完全自律動作します。

```bash
npm run setup
```

### ゼロコンフィグ仕様
- **対話入力ゼロ (No Interactive Prompts)**: 動作モードやデータ保存先ディレクトリ、ポート番号などの人間への質問を全廃。
- **全自動セットアップ**:
  1. 相対パス `./WBS_data` をデフォルトとした設定を即座に自動生成。
  2. 続けて単一バイナリ生成（`npm run build:exe`）を自動実行し、`bin/` 配下にマルチプラットフォームバイナリを一括出力。
- **実行時の完全自律動作**:
  - 生成されたバイナリは外部設定ファイルがなくても、自動的にバイナリ横の `./WBS_data/` をデータ保存先として認識し、空きポート（3000〜3050）を自動探索して即座に起動します。
