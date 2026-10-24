import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import http from 'http';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.join(__dirname, '..');

function waitForServer(port = 3000, timeoutMs = 15000) {
  const startTime = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      const req = http.get(`http://localhost:${port}`, (res) => {
        resolve();
      });
      req.on('error', () => {
        if (Date.now() - startTime > timeoutMs) {
          reject(new Error(`Server failed to start within ${timeoutMs}ms`));
        } else {
          setTimeout(check, 300);
        }
      });
    };
    check();
  });
}

async function runVerification() {
  console.log('========================================================');
  console.log('📊 検証スクリプト: Googleスプレッドシート一方通行連携');
  console.log('========================================================\n');

  const configPath = path.join(PROJECT_ROOT, 'config.json');
  let originalConfigRaw = null;
  if (fs.existsSync(configPath)) {
    originalConfigRaw = fs.readFileSync(configPath, 'utf-8');
  }

  // 1. Mock GAS Webhook Server
  let receivedPayloads = [];
  const mockGasServer = http.createServer((req, res) => {
    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const json = JSON.parse(body);
          receivedPayloads.push(json);
          console.log(`[Mock GAS] Received POST action: ${json.action}, rows: ${json.matrix ? json.matrix.length : 0}`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'OK', updatedRows: json.matrix ? json.matrix.length : 0 }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ERROR', message: e.message }));
        }
      });
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  await new Promise(resolve => mockGasServer.listen(4567, resolve));
  console.log('1. Mock GAS Webhook サーバー起動完了 (http://localhost:4567)');

  // 2. Start WBSer server
  console.log('2. WBSer サーバーを起動中...');
  const serverProc = spawn('npx', ['-y', 'cross-env', 'AUTO_OPEN=false', 'tsx', 'src/ui/server.ts', '--port', '3005', '--no-auto-open'], {
    cwd: PROJECT_ROOT,
    stdio: 'pipe',
    env: { ...process.env, AUTO_OPEN: 'false' },
  });

  serverProc.stdout.on('data', (d) => {
    const msg = d.toString().trim();
    if (msg) console.log(`[WBSer] ${msg}`);
  });
  serverProc.stderr.on('data', (d) => {
    const msg = d.toString().trim();
    if (msg) console.error(`[WBSer ERR] ${msg}`);
  });

  let browser;
  try {
    await waitForServer(3005);
    console.log('   ✅ WBSer サーバー起動確認 (http://localhost:3005)');

    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();

    console.log('3. ブラウザで WBSer にアクセス...');
    await page.goto('http://localhost:3005');
    await page.waitForSelector('#obsidian-canvas');
    await page.waitForFunction(() => window.__wbserDebug !== undefined);

    // Check spreadsheet button exists
    const syncBtn = await page.$('#btn-spreadsheet-sync-modal');
    if (!syncBtn) throw new Error('#btn-spreadsheet-sync-modal not found');
    console.log('   ✅ スプシ連携ボタンの表示を確認');

    // Open modal
    console.log('4. スプシ連携モーダルを開く...');
    await page.click('#btn-spreadsheet-sync-modal');
    await page.waitForSelector('#spreadsheet-sync-modal:not(.hidden)');
    console.log('   ✅ モーダルが開いたことを確認');

    // Input Mock GAS URL
    console.log('5. Webhook URLを入力して保存...');
    await page.fill('#spreadsheet-url-input', 'http://localhost:4567/sync');
    await page.click('#btn-spreadsheet-save');
    await page.waitForSelector('#spreadsheet-sync-modal', { state: 'hidden' });
    console.log('   ✅ モーダルが閉じ、設定が保存されたことを確認');

    // Wait for mock GAS server to receive SYNC_MATRIX
    console.log('6. Mock GAS へのプッシュ通知待機...');
    const startTime = Date.now();
    while (receivedPayloads.length === 0 && Date.now() - startTime < 8000) {
      await new Promise(r => setTimeout(r, 200));
    }

    if (receivedPayloads.length === 0) {
      throw new Error('GAS webhook did not receive sync payload within 8s');
    }

    const payload = receivedPayloads[0];
    console.log('   ✅ GASへガント行列データが正常プッシュされました！');
    console.log(`      - Action: ${payload.action}`);
    console.log(`      - 行数: ${payload.matrix.length} 行`);
    console.log(`      - 列数: ${payload.matrix[0].length} 列`);
    console.log(`      - ヘッダー例: [${payload.matrix[0].slice(0, 6).join(', ')}...]`);

    if (payload.sheetName !== 'WBS') {
      throw new Error(`Expected payload.sheetName to be 'WBS', got: ${payload.sheetName}`);
    }
    console.log('   ✅ 送信対象シート名 (WBS) 検証一致');

    // Verify header structure
    const headers = payload.matrix[0];
    if (headers[0] !== 'No' || headers[1] !== 'WBSタスク階層ツリー' || headers[2] !== 'ステータス' || headers[3] !== '完了予定日') {
      throw new Error(`Unexpected headers: ${JSON.stringify(headers.slice(0, 4))}`);
    }
    console.log('   ✅ 基本ヘッダー (No, WBSタスク階層ツリー, ステータス, 完了予定日) 検証一致');

    if (!headers.includes('📅 期日未設定') || !headers.includes('◀ 過去') || !headers.includes('未来 ▶')) {
      throw new Error('Missing timeline window columns');
    }
    console.log('   ✅ 横軸日程ウィンドウ (期日未設定, 過去, 日程列, 未来) 検証一致');

    // Check tree formatting in column 1 (WBS階層)
    console.log('7. 縦軸WBSツリー表示サンプル:');
    for (let r = 1; r < Math.min(payload.matrix.length, 6); r++) {
      console.log(`      Row ${r}: ${payload.matrix[r][0]} | ${payload.matrix[r][1]} | ${payload.matrix[r][2]} | ${payload.matrix[r][3]}`);
    }

    // Verify toolbar indicator
    await page.waitForFunction(() => {
      const dot = document.getElementById('sync-status-indicator');
      return dot && dot.classList.contains('success');
    }, { timeout: 5000 });
    console.log('   ✅ 画面上部ツールバーの連携ステータスが緑（success）に変化したことを確認');

    // Take screenshot
    const screenshotPath = path.join(PROJECT_ROOT, 'scripts', 'screenshot_spreadsheet_sync.png');
    await page.screenshot({ path: screenshotPath });
    console.log(`   📸 スクリーンショット保存完了: ${screenshotPath}`);

    // Reopen modal to verify status text
    await page.click('#btn-spreadsheet-sync-modal');
    await page.waitForSelector('#spreadsheet-sync-modal:not(.hidden)');
    const statusMsg = await page.innerText('#spreadsheet-status-msg');
    console.log(`   ✅ モーダル内ステータス文言: "${statusMsg}"`);

    console.log('\n🎉 すべてのGoogleスプレッドシート連携E2E検証項目をクリアしました！');

  } finally {
    if (browser) await browser.close();
    mockGasServer.close();
    serverProc.kill('SIGTERM');
    if (originalConfigRaw !== null) {
      fs.writeFileSync(configPath, originalConfigRaw, 'utf-8');
    }
  }
}

runVerification().catch((err) => {
  console.error('\n❌ 検証失敗:', err);
  process.exit(1);
});
