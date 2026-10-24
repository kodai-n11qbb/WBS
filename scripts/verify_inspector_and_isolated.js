import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import http from 'http';

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
  console.log('🧪 検証スクリプト: UI重なり解消 & 単独要素常駐表示');
  console.log('========================================================\n');

  // 1. Dev サーバーの起動
  console.log('1. tsx src/ui/server.ts サーバーを起動中...');
  const serverProc = spawn('npx', ['-y', 'cross-env', 'AUTO_OPEN=false', 'tsx', 'src/ui/server.ts'], {
    cwd: PROJECT_ROOT,
    stdio: 'pipe',
    env: { ...process.env, AUTO_OPEN: 'false' },
  });

  serverProc.stdout.on('data', (d) => {
    console.log(`[Server] ${d.toString().trim()}`);
  });
  serverProc.stderr.on('data', (d) => {
    console.error(`[Server ERR] ${d.toString().trim()}`);
  });

  try {
    await waitForServer(3000);
    console.log('   ✅ サーバー起動確認 (http://localhost:3000)');

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();

    page.on('pageerror', (err) => console.error('  [Page Error]', err));
    page.on('console', (msg) => console.log('  [Page Console]', msg.type(), msg.text()));

    console.log('2. ページにアクセス中...');
    await page.goto('http://localhost:3000');
    await page.waitForTimeout(1500);

    const debugInfo = await page.evaluate(() => ({
      hasDebug: Boolean(window.__wbserDebug),
      nodesLen: window.__wbserDebug ? window.__wbserDebug.getGraphNodes().length : 0,
    }));
    console.log('   Debug Info:', debugInfo);

    await page.waitForFunction(() => {
      return Boolean(window.__wbserDebug && window.__wbserDebug.getGraphNodes().length > 0);
    }, { timeout: 10000 });
    console.log('   ✅ グラフノード描画完了');

    // -------------------------------------------------------------
    // 検証 1: input-section と obsidian-inspector の重なり解消検証
    // -------------------------------------------------------------
    console.log('\n--- [検証 1: input-section と obsidian-inspector の重なり検査] ---');
    
    // 全体グラフの適当なノードをクリックしてインスペクターを開く
    const initialNodes = await page.evaluate(() => window.__wbserDebug.getGraphNodes());
    const targetNode = initialNodes.find((n) => !n.parentId) || initialNodes[0];
    console.log(`  ノード「${targetNode.title}」をクリックしてインスペクターを展開...`);
    await page.evaluate((id) => window.__wbserDebug.clickNode(id), targetNode.id);
    await page.waitForTimeout(1000);

    const boxes = await page.evaluate(() => {
      const inspector = document.getElementById('obsidian-inspector');
      const inputSection = document.getElementById('input-section');
      const promptBar = document.getElementById('quick-task-form');

      const inspRect = inspector.getBoundingClientRect();
      const inputRect = inputSection.getBoundingClientRect();
      const promptRect = promptBar.getBoundingClientRect();

      // Check vertical overlap
      const hasVerticalOverlap = !(inspRect.bottom <= inputRect.top || inputRect.bottom <= inspRect.top);
      // Check horizontal overlap
      const hasHorizontalOverlap = !(inspRect.right <= inputRect.left || inputRect.right <= inspRect.left);
      const isOverlapping = hasVerticalOverlap && hasHorizontalOverlap;

      return {
        inspector: {
          top: inspRect.top,
          bottom: inspRect.bottom,
          height: inspRect.height,
          visible: !inspector.classList.contains('hidden') && inspRect.height > 0,
        },
        inputSection: {
          top: inputRect.top,
          bottom: inputRect.bottom,
          height: inputRect.height,
        },
        promptBar: {
          top: promptRect.top,
          bottom: promptRect.bottom,
          height: promptRect.height,
        },
        isOverlapping,
        gapY: inputRect.top - inspRect.bottom,
      };
    });

    console.log(`  インスペクター表示状態: ${boxes.inspector.visible ? '表示中 (OK)' : '非表示 (NG)'}`);
    console.log(`  インスペクター位置: Y=${boxes.inspector.top.toFixed(1)}px 〜 ${boxes.inspector.bottom.toFixed(1)}px (高さ ${boxes.inspector.height.toFixed(1)}px)`);
    console.log(`  タスク追加バー位置: Y=${boxes.inputSection.top.toFixed(1)}px 〜 ${boxes.inputSection.bottom.toFixed(1)}px (高さ ${boxes.inputSection.height.toFixed(1)}px)`);
    console.log(`  スタック間隔(gap): ${boxes.gapY.toFixed(1)}px`);
    console.log(`  要素同士の重なり(Overlap): ${boxes.isOverlapping ? '❌ 重なりあり' : '✅ 重なりなし (完全分離)'}`);

    if (boxes.isOverlapping) {
      throw new Error('インスペクターとタスク追加バーが重なっています！');
    }

    await page.screenshot({ path: path.join(PROJECT_ROOT, 'tests/inspector_overlap_fixed.png') });
    console.log('  📸 スクリーンショット保存: tests/inspector_overlap_fixed.png');

    // -------------------------------------------------------------
    // 検証 2: 単独要素（期日未設定 & 期日設定済み）の常駐表示検証
    // -------------------------------------------------------------
    console.log('\n--- [検証 2: 単独要素（期日有無問わず）の他要素クリック時常駐表示] ---');

    // 空白クリックで選択解除
    await page.evaluate(() => window.__wbserDebug.clearSelection());
    await page.waitForTimeout(800);

    const titleUnscheduled = `検証単独_期日未定_${Date.now()}`;
    const titleScheduled = `検証単独_期日あり_${Date.now()}`;

    console.log(`  1) 期日未設定の単独タスク「${titleUnscheduled}」を作成...`);
    await page.fill('#quick-title-input', titleUnscheduled);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(800);

    console.log(`  2) 期日設定済みの単独タスク「${titleScheduled}」を作成し、期日を設定...`);
    await page.fill('#quick-title-input', titleScheduled);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(800);

    // 作成されたタスクに期日を設定
    const scheduledTaskId = await page.evaluate((title) => {
      const nodes = window.__wbserDebug.getGraphNodes();
      const node = nodes.find((n) => n.title === title);
      return node ? node.id : null;
    }, titleScheduled);

    if (!scheduledTaskId) throw new Error('期日あり用単独タスクの作成に失敗しました');

    // インスペクターを開いて期日を設定
    await page.evaluate((id) => window.__wbserDebug.clickNode(id), scheduledTaskId);
    await page.waitForTimeout(500);

    // 完了予定日を設定 (2026-10-25)
    await page.fill('#inspector-due-date-input', '2026-10-25');
    await page.dispatchEvent('#inspector-due-date-input', 'change');
    await page.waitForTimeout(500);
    const btnConfirmDate = await page.$('#btn-modal-confirm');
    if (btnConfirmDate && await btnConfirmDate.isVisible()) {
      await btnConfirmDate.click();
      await page.waitForTimeout(800);
    }

    // 空白クリックで全体グラフに戻す
    await page.evaluate(() => window.__wbserDebug.clearSelection());
    await page.waitForTimeout(1000);

    // 全体グラフでの存在確認
    const wholeGraphNodes = await page.evaluate(() => window.__wbserDebug.getGraphNodes());
    const hasUnscheduledInWhole = wholeGraphNodes.some((n) => n.title === titleUnscheduled);
    const hasScheduledInWhole = wholeGraphNodes.some((n) => n.title === titleScheduled);
    console.log(`  全体グラフ: 期日未定=${hasUnscheduledInWhole ? '✅' : '❌'}, 期日あり=${hasScheduledInWhole ? '✅' : '❌'}`);

    // 他のルート要素をクリックしてタイムラインモードに入る
    const otherRoot = wholeGraphNodes.find((n) => !n.parentId && n.id !== scheduledTaskId && n.title !== titleUnscheduled);
    console.log(`  他のツリー「${otherRoot.title}」を選択（タイムラインモードへ移行）...`);
    await page.evaluate((id) => window.__wbserDebug.clickNode(id), otherRoot.id);
    await page.waitForTimeout(1200);

    // タイムラインモード下での両単独ノードの存在検査
    const timelineResult = await page.evaluate(({ unscheduledTitle, scheduledTitle }) => {
      const nodes = window.__wbserDebug.getGraphNodes();
      const nodeUnscheduled = nodes.find((n) => n.title === unscheduledTitle);
      const nodeScheduled = nodes.find((n) => n.title === scheduledTitle);

      return {
        unscheduledFound: Boolean(nodeUnscheduled),
        unscheduledDueDate: nodeUnscheduled ? nodeUnscheduled.dueDate : undefined,
        unscheduledX: nodeUnscheduled ? nodeUnscheduled.x : undefined,
        scheduledFound: Boolean(nodeScheduled),
        scheduledDueDate: nodeScheduled ? nodeScheduled.dueDate : undefined,
        scheduledX: nodeScheduled ? nodeScheduled.x : undefined,
        totalNodesVisible: nodes.length,
      };
    }, { unscheduledTitle: titleUnscheduled, scheduledTitle: titleScheduled });

    console.log(`  タイムライン表示数: ${timelineResult.totalNodesVisible}件`);
    console.log(`  単独タスク(期日未定)の常駐表示: ${timelineResult.unscheduledFound ? '✅ 成功 (Zone 1待機列 X=' + timelineResult.unscheduledX + ')' : '❌ 未検出'}`);
    console.log(`  単独タスク(期日あり)の常駐表示: ${timelineResult.scheduledFound ? '✅ 成功 (日付列 X=' + timelineResult.scheduledX + ', 期日=' + timelineResult.scheduledDueDate + ')' : '❌ 未検出'}`);

    await page.screenshot({ path: path.join(PROJECT_ROOT, 'tests/isolated_tasks_persistent.png') });
    console.log('  📸 スクリーンショット保存: tests/isolated_tasks_persistent.png');

    // クリーンアップ
    console.log('\n  検証タスクのクリーンアップ中...');
    async function cleanupTask(title) {
      await page.evaluate(() => window.__wbserDebug.clearSelection());
      await page.waitForTimeout(400);
      const targetId = await page.evaluate((t) => {
        const nodes = window.__wbserDebug.getGraphNodes();
        const found = nodes.find((item) => item.title === t);
        return found ? found.id : null;
      }, title);

      if (targetId) {
        await page.evaluate((id) => window.__wbserDebug.clickNode(id), targetId);
        await page.waitForTimeout(500);
        const btnDel = await page.$('#btn-inspector-delete');
        if (btnDel) {
          await btnDel.click();
          await page.waitForTimeout(500);
          const btnConfirm = await page.$('#btn-modal-confirm');
          if (btnConfirm && await btnConfirm.isVisible()) {
            await btnConfirm.click();
            await page.waitForTimeout(800);
          }
        }
      }
    }

    await cleanupTask(titleScheduled);
    await cleanupTask(titleUnscheduled);

    await browser.close();

    const allPassed = !boxes.isOverlapping && timelineResult.unscheduledFound && timelineResult.scheduledFound;
    console.log('\n========================================================');
    console.log(allPassed ? '🎉 すべての検証に合格しました！' : '❌ 検証に不合格の項目があります');
    console.log('========================================================');

    if (!allPassed) {
      process.exit(1);
    }
  } finally {
    serverProc.kill();
  }
}

runVerification().catch((err) => {
  console.error('検証中にエラーが発生しました:', err);
  process.exit(1);
});
