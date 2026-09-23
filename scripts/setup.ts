import readline from 'node:readline';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { JsonConfigAdapter } from '../src/adapters/config.js';
import { OperatingMode } from '../src/ports/config.js';

async function runWizard() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const question = (query: string): Promise<string> => {
    return new Promise((resolve) => rl.question(query, resolve));
  };

  console.log('\n==================================================');
  console.log('    WBSer Interactive Setup & Config Wizard    ');
  console.log('==================================================\n');

  console.log('Select Operating Mode:');
  console.log('  [1] P2P    (分散モード: 共有データアドレス state.json にアクセスし自律動作)');
  console.log('  [2] CLIENT (クライアントモード: ホスト端末アドレスを指定して接続)');
  console.log('  [3] HOST   (ホストモード: この端末を親機として起動し接続受付)\n');

  const modeAns = (await question('? 動作モードの番号を選択してください (1/2/3) [初期値: 1]: ')).trim();
  let mode: OperatingMode = 'P2P';
  if (modeAns === '2') mode = 'CLIENT';
  if (modeAns === '3') mode = 'HOST';

  let hostAddress = '';
  let dataDir = './.wbser_data';

  if (mode === 'CLIENT') {
    const hostAns = (await question('? 接続先ホストの端末アドレスを入力してください (例: 192.168.1.50:3000): ')).trim();
    hostAddress = hostAns || 'localhost:3000';
  } else {
    const dataAns = (await question(`? 共有データディレクトリのパス (state.json / events.jsonl の保存先) [初期値: ${dataDir}]: `)).trim();
    if (dataAns) dataDir = dataAns;
  }

  const portAns = (await question('? Web UIのポート番号を入力してください [初期値: 3000]: ')).trim();
  const port = portAns ? parseInt(portAns, 10) : 3000;

  const autoOpenAns = (await question('? 起動時に自動でブラウザを開きますか？ (Y/n) [初期値: Y]: ')).trim().toLowerCase();
  const autoOpen = autoOpenAns !== 'n';

  rl.close();

  const configAdapter = new JsonConfigAdapter();
  await configAdapter.saveConfig({
    mode,
    dataDir,
    hostAddress: mode === 'CLIENT' ? hostAddress : undefined,
    port,
    autoOpen,
  });

  console.log('\n✅ config.json が作成・保存されました！');
  console.log(`   モード: ${mode}`);
  if (mode === 'CLIENT') console.log(`   接続先ホスト端末: ${hostAddress}`);
  if (mode !== 'CLIENT') console.log(`   データ保存ディレクトリ: ${dataDir}`);
  console.log(`   ポート: ${port}`);
  console.log(`   ブラウザ自動オープン: ${autoOpen ? '有効' : '無効'}\n`);

  const rl2 = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const buildAns = await new Promise<string>((res) => rl2.question('? 設定済み単一バイナリ (bin/) のパッケージングを実行しますか？ (Y/n) [初期値: Y]: ', res));
  rl2.close();

  if (buildAns.trim().toLowerCase() !== 'n') {
    console.log('\n🔨 単一バイナリをビルド中 (npm run build:exe)...\n');
    try {
      execSync('npm run build:exe', { stdio: 'inherit' });
      console.log('\n🎉 bin/ に単一バイナリが出力されました！');
    } catch (e) {
      console.error('❌ ビルド中にエラーが発生しました:', e);
    }
  } else {
    console.log('\n💡 後から `npm run build:exe` でいつでもバイナリ化できます。');
  }
}

runWizard().catch(console.error);
