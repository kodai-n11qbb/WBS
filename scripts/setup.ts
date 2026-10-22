import { execSync } from 'node:child_process';
import { JsonConfigAdapter } from '../src/adapters/config.js';

async function runZeroConfigSetup() {
  console.log('\n==================================================');
  console.log('       WBSer Zero-Config Setup & Build           ');
  console.log('==================================================\n');

  console.log('⚙️  設定を初期化中...');
  const configAdapter = new JsonConfigAdapter();
  await configAdapter.saveConfig({
    mode: 'P2P',
    dataDir: './WBS_data',
    port: 3000,
    autoOpen: true,
  });

  console.log('✅ config.json を生成しました:');
  console.log('   データ保存先: ./WBS_data (相対パス)');
  console.log('   ポート: 3000〜3050 (自動探索固定)');
  console.log('   ブラウザ自動オープン: 有効\n');

  console.log('🔨 単一バイナリを自動ビルド中 (npm run build:exe)...\n');
  try {
    execSync('npm run build:exe', { stdio: 'inherit' });
    console.log('\n🎉 bin/ に配布用単一バイナリを出力しました！');
    console.log('   Windows:               bin/wbser-win-x64.exe');
    console.log('   macOS (Apple Silicon): bin/wbser-macos-arm64');
    console.log('   macOS (Intel):         bin/wbser-macos-x64\n');
  } catch (e) {
    console.error('❌ ビルド中にエラーが発生しました:', e);
    process.exit(1);
  }
}

runZeroConfigSetup().catch(console.error);
