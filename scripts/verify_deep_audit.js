import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const AUDIT_DIR = path.join(__dirname, '../tests/deep_audit');
if (!fs.existsSync(AUDIT_DIR)) {
  fs.mkdirSync(AUDIT_DIR, { recursive: true });
}

async function runDeepVerification() {
  console.log('========================================================');
  console.log('🔬 WBSer 徹底検証（表示バグ・レイアウト破綻・JS負荷・スリープ挙動）');
  console.log('========================================================\n');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();

  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') pageErrors.push(msg.text());
  });

  console.log('1. http://localhost:3000 へ接続中...');
  await page.goto('http://localhost:3000');
  await page.waitForTimeout(2500);

  const testResults = [];

  // -------------------------------------------------------------
  // Test A: 全体見るモード (初期描画 & 物理静止) の境界・衝突・配置検査
  // -------------------------------------------------------------
  console.log('\n--- [テストA: 全体見るモード (初期描画 & 物理静止)] ---');
  await page.waitForTimeout(1500);

  const auditInitial = await page.evaluate(() => {
    const dbg = window.__wbserDebug;
    const nodes = dbg.getGraphNodes();
    const metrics = dbg.getCanvasMetrics();
    const width = metrics.width;
    const effectiveBottom = metrics.effectiveBottom;

    const overflows = [];
    const collisions = [];

    nodes.forEach((n) => {
      // Circle boundaries
      if (n.x - 16 < 5) overflows.push({ task: n.title, issue: `Circle X=${n.x} < 5 (左端)` });
      if (n.x + 16 > width - 5) overflows.push({ task: n.title, issue: `Circle X=${n.x} > ${width} (右端)` });
      if (n.y - 16 < 42) overflows.push({ task: n.title, issue: `Circle Y=${n.y} < 42 (上部ツールバー)` });
      if (n.y + 16 > effectiveBottom - 10) overflows.push({ task: n.title, issue: `Circle Y=${n.y} > ${effectiveBottom} (下部ドック)` });

      // Label boundaries
      const textLen = (n.title || '').length;
      const w = Math.max(60, textLen * 9 + 16);
      const left = n.labelX - w / 2;
      const right = n.labelX + w / 2;
      if (left < 4) overflows.push({ task: n.title, issue: `Label Left=${left} < 4 (左画面外)` });
      if (right > width - 4) overflows.push({ task: n.title, issue: `Label Right=${right} > ${width} (右画面外)` });
    });

    // Pairwise Circle Collision (< 28px)
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const dist = Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y);
        if (dist < 28) {
          collisions.push({ taskA: nodes[i].title, taskB: nodes[j].title, dist });
        }
      }
    }

    return { totalNodes: nodes.length, overflows, collisions, nodes };
  });

  await page.screenshot({ path: path.join(AUDIT_DIR, '01_initial_whole_graph.png') });
  console.log(`  総ノード数: ${auditInitial.totalNodes}`);
  console.log(`  画面外はみ出し: ${auditInitial.overflows.length} 件`);
  console.log(`  円同士の衝突: ${auditInitial.collisions.length} 件`);
  testResults.push({
    test: '初期画面レイアウト正常性',
    passed: auditInitial.overflows.length === 0 && auditInitial.collisions.length === 0,
    details: `はみ出し: ${auditInitial.overflows.length}, 衝突: ${auditInitial.collisions.length}`,
  });

  // -------------------------------------------------------------
  // Test B: JSパフォーマンス ＆ 物理スリープ検証 (アイドル時CPU 0%)
  // -------------------------------------------------------------
  console.log('\n--- [テストB: JSパフォーマンス ＆ 物理スリープ検証] ---');
  const idleSleepData = await page.evaluate(async () => {
    // Wait for physics to settle completely
    await new Promise((r) => setTimeout(r, 1800));

    // Hook requestAnimationFrame to count frames in 800ms
    let rAFCount = 0;
    const originalRAF = window.requestAnimationFrame;
    let hookActive = true;
    window.requestAnimationFrame = function (cb) {
      if (hookActive) rAFCount++;
      return originalRAF.call(window, cb);
    };

    await new Promise((r) => setTimeout(r, 800));
    hookActive = false;
    window.requestAnimationFrame = originalRAF;

    const nodes = window.__wbserDebug.getGraphNodes();
    const maxVelocity = Math.max(...nodes.map((n) => Math.hypot(n.vx, n.vy)));

    return {
      rAFCallsIn800ms: rAFCount,
      maxVelocity,
    };
  });

  console.log(`  静止時800ms内の requestAnimationFrame 呼出回数: ${idleSleepData.rAFCallsIn800ms} 回 (期待値: 0回 = 完全スリープ)`);
  console.log(`  静止時最大ノード速度 (maxVelocity): ${idleSleepData.maxVelocity.toFixed(4)} px/f (期待値: < 0.05)`);
  testResults.push({
    test: '静止時アニメーション完全スリープ (CPU 0%)',
    passed: idleSleepData.rAFCallsIn800ms === 0 && idleSleepData.maxVelocity < 0.05,
    details: `rAF回数: ${idleSleepData.rAFCallsIn800ms}, 最大速度: ${idleSleepData.maxVelocity.toFixed(4)}`,
  });

  // -------------------------------------------------------------
  // Test C: マウス移動・ホバーによる wakeAnimation 復帰検証
  // -------------------------------------------------------------
  console.log('\n--- [テストC: マウス移動・ホバーによる wakeAnimation 復帰検証] ---');
  // First setup rAF counter on page
  await page.evaluate(() => {
    window.__wakeRAFCount = 0;
    const origRAF = window.requestAnimationFrame;
    window.requestAnimationFrame = function (cb) {
      window.__wakeRAFCount++;
      return origRAF.call(window, cb);
    };
  });

  // Get canvas element bounding rect in viewport to correctly translate node coordinates
  const canvasBox = await page.$eval('#obsidian-canvas', (el) => {
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  });

  // Move real browser mouse across canvas to trigger canvas mousemove
  const targetNode = auditInitial.nodes[1] || auditInitial.nodes[0];
  const screenX = canvasBox.left + Math.max(20, Math.min(canvasBox.width - 20, targetNode.x));
  const screenY = canvasBox.top + Math.max(20, Math.min(canvasBox.height - 20, targetNode.y));
  console.log(`  実ブラウザマウスをキャンバス上ノード「${targetNode.title}」へ移動 (ScreenX=${screenX.toFixed(1)}, ScreenY=${screenY.toFixed(1)})...`);
  
  // Perform mouse movement across the canvas
  await page.mouse.move(canvasBox.left + 100, canvasBox.top + 100);
  await page.mouse.move(screenX, screenY, { steps: 5 });
  await page.waitForTimeout(400);

  const wakeCount = await page.evaluate(() => window.__wakeRAFCount);
  console.log(`  マウス移動によるアニメーション再開呼出回数: ${wakeCount} 回 (期待値: >= 1回)`);
  testResults.push({
    test: 'マウス操作時のアニメーション即時復帰',
    passed: wakeCount >= 1,
    details: `再開rAF回数: ${wakeCount}`,
  });

  // -------------------------------------------------------------
  // Test D: ネスト階層切り替え（1階層, 2階層, 3階層, すべて）の全パターン検証
  // -------------------------------------------------------------
  console.log('\n--- [テストD: ネスト階層絞り込み (1階層/2階層/3階層/すべて) の表示検証] ---');
  const depthFilters = ['1', '2', '3', 'all'];
  for (const d of depthFilters) {
    const btn = await page.$(`button[data-depth="${d}"]`);
    if (btn) {
      await btn.click();
      await page.waitForTimeout(1000);
      const audit = await page.evaluate(() => {
        const nodes = window.__wbserDebug.getGraphNodes();
        const metrics = window.__wbserDebug.getCanvasMetrics();
        const overflows = nodes.filter((n) => n.x + 16 > metrics.width || n.x - 16 < 0);
        return { count: nodes.length, overflows: overflows.length };
      });
      await page.screenshot({ path: path.join(AUDIT_DIR, `02_depth_${d}.png`) });
      console.log(`  階層「${d}」: 表示タスク数 ${audit.count}件, はみ出し ${audit.overflows}件`);
      testResults.push({
        test: `ネスト階層切り替え [${d}]`,
        passed: audit.overflows === 0 && audit.count > 0,
        details: `表示数: ${audit.count}, はみ出し: ${audit.overflows}`,
      });
    }
  }

  // Restore to all
  const btnAll = await page.$('button[data-depth="all"]');
  if (btnAll) await btnAll.click();
  await page.waitForTimeout(1000);

  // -------------------------------------------------------------
  // Test E: 単独要素の新規追加 ＆ タイムライン常駐表示（案A仕様）検証
  // -------------------------------------------------------------
  console.log('\n--- [テストE: 単独要素追加 ＆ ルートタイムライン常駐表示検証] ---');
  const testIsolatedTitle = `検証用未定タスク_${Date.now()}`;
  console.log(`  クイック入力バーより単独タスク「${testIsolatedTitle}」を作成...`);
  await page.fill('#quick-title-input', testIsolatedTitle);
  await page.click('#quick-task-form button[type="submit"]');
  await page.waitForTimeout(1200);

  const afterCreateAudit = await page.evaluate((title) => {
    const nodes = window.__wbserDebug.getGraphNodes();
    const created = nodes.find((n) => n.title === title);
    return {
      found: Boolean(created),
      node: created,
    };
  }, testIsolatedTitle);

  console.log(`  全体グラフに追加された単独ノード: ${afterCreateAudit.found ? '確認成功' : '未検出'}`);

  // Now click a root tree to enter timeline mode
  const rootNode = auditInitial.nodes.find((n) => !n.parentId);
  console.log(`  ルートツリー「${rootNode.title}」を選択してタイムライン表示へ...`);
  await page.evaluate((id) => window.__wbserDebug.clickNode(id), rootNode.id);
  await page.waitForTimeout(1200);

  const timelineAudit = await page.evaluate((title) => {
    const dbg = window.__wbserDebug;
    const nodes = dbg.getGraphNodes();
    const metrics = dbg.getCanvasMetrics();
    const zone1Nodes = nodes.filter((n) => !n.dueDate);
    const isolatedInZone1 = zone1Nodes.find((n) => n.title === title);
    const overflows = nodes.filter((n) => n.x - 16 < 0 || n.x + 16 > metrics.width);

    return {
      total: nodes.length,
      zone1Count: zone1Nodes.length,
      isolatedInZone1: Boolean(isolatedInZone1),
      overflowCount: overflows.length,
    };
  }, testIsolatedTitle);

  await page.screenshot({ path: path.join(AUDIT_DIR, '03_timeline_with_resident_isolated.png') });
  console.log(`  タイムライン表示数: ${timelineAudit.total}件 (Zone 1期日未設定数: ${timelineAudit.zone1Count}件)`);
  console.log(`  単独タスクのZone 1常駐確認: ${timelineAudit.isolatedInZone1 ? '✅ 常駐確認成功' : '❌ 未検出'}`);
  console.log(`  画面外はみ出し: ${timelineAudit.overflowCount}件`);

  testResults.push({
    test: '単独要素のZone 1常駐表示',
    passed: timelineAudit.isolatedInZone1 && timelineAudit.overflowCount === 0,
    details: `Zone 1常駐: ${timelineAudit.isolatedInZone1}, はみ出し: ${timelineAudit.overflowCount}`,
  });

  // Clean up created task via inspector
  console.log('  検証用タスクのクリーンアップ（削除）...');
  await page.evaluate(() => window.__wbserDebug.clearSelection());
  await page.waitForTimeout(800);

  const targetToDeleteId = await page.evaluate((title) => {
    const nodes = window.__wbserDebug.getGraphNodes();
    const t = nodes.find((n) => n.title === title);
    return t ? t.id : null;
  }, testIsolatedTitle);

  if (targetToDeleteId) {
    await page.evaluate((id) => window.__wbserDebug.clickNode(id), targetToDeleteId);
    await page.waitForTimeout(500);
    const btnDel = await page.$('#btn-inspector-delete');
    if (btnDel) {
      await btnDel.click();
      await page.waitForTimeout(500);
      const btnConfirm = await page.$('#btn-modal-confirm');
      if (btnConfirm) await btnConfirm.click();
      await page.waitForTimeout(800);
    }
  }

  // -------------------------------------------------------------
  // Test F: ウィンドウリサイズ時の同期追従検証
  // -------------------------------------------------------------
  console.log('\n--- [テストF: ウィンドウリサイズ時の自動スケール追従] ---');
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.waitForTimeout(1200);

  const resizeAudit = await page.evaluate(() => {
    const nodes = window.__wbserDebug.getGraphNodes();
    const metrics = window.__wbserDebug.getCanvasMetrics();
    const overflows = nodes.filter((n) => n.x - 16 < 0 || n.x + 16 > metrics.width);
    return { width: metrics.width, overflows: overflows.length };
  });

  await page.screenshot({ path: path.join(AUDIT_DIR, '04_resize_1024x768.png') });
  console.log(`  幅1024pxへのリサイズ後: キャンバス幅 ${resizeAudit.width}px, はみ出し ${resizeAudit.overflows}件`);
  testResults.push({
    test: 'ウィンドウリサイズ (1024x768) 追従',
    passed: resizeAudit.overflows === 0 && resizeAudit.width > 500,
    details: `キャンバス幅: ${resizeAudit.width}, はみ出し: ${resizeAudit.overflows}`,
  });

  // Restore original viewport
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(800);

  // -------------------------------------------------------------
  // Test G: 日付モードでのホイールスクロール（過去・未来）表示整合性検証
  // -------------------------------------------------------------
  console.log('\n--- [テストG: 日付モードでのホイールスクロール動作検証] ---');
  // 再度ルートツリーを選択してタイムライン表示へ
  const testRootNode = auditInitial.nodes.find((n) => !n.parentId);
  await page.evaluate((id) => window.__wbserDebug.clickNode(id), testRootNode.id);
  await page.waitForTimeout(1000);

  // キャンバス中心へマウスを移動
  await page.mouse.move(640, 400);

  // 未来方向へホイールスクロール
  console.log('  未来方向へホイールスクロール (deltaY = 400)...');
  await page.mouse.wheel(0, 400);
  await page.waitForTimeout(1000);

  const scrollFutureAudit = await page.evaluate(() => {
    const dbg = window.__wbserDebug;
    const nodes = dbg.getGraphNodes();
    const metrics = dbg.getCanvasMetrics();
    // ゾーンごとのノード数を集計
    const zone2Nodes = nodes.filter((n) => n.dueDate && n.x < metrics.timelineStartX);
    const zone4Nodes = nodes.filter((n) => n.dueDate && n.x > metrics.timelineEndX);
    const timelineNodes = nodes.filter((n) => n.dueDate && n.x >= metrics.timelineStartX && n.x <= metrics.timelineEndX);
    
    // Y座標の重複（重なり不具合）を検査: 同一Zone内の同一X座標でY座標差が10px未満のペア
    let duplicateYCount = 0;
    for (let i = 0; i < zone2Nodes.length; i++) {
      for (let j = i + 1; j < zone2Nodes.length; j++) {
        if (Math.abs(zone2Nodes[i].y - zone2Nodes[j].y) < 10) duplicateYCount++;
      }
    }
    for (let i = 0; i < zone4Nodes.length; i++) {
      for (let j = i + 1; j < zone4Nodes.length; j++) {
        if (Math.abs(zone4Nodes[i].y - zone4Nodes[j].y) < 10) duplicateYCount++;
      }
    }

    return {
      panOffset: dbg.getPanOffset ? dbg.getPanOffset() : null,
      zone2Count: zone2Nodes.length,
      zone4Count: zone4Nodes.length,
      timelineCount: timelineNodes.length,
      duplicateYCount,
    };
  });

  await page.screenshot({ path: path.join(AUDIT_DIR, '05_scroll_future.png') });
  console.log(`  スクロール後: 過去ゾーン ${scrollFutureAudit.zone2Count}件, 未来ゾーン ${scrollFutureAudit.zone4Count}件, タイムライン ${scrollFutureAudit.timelineCount}件, 重複Y ${scrollFutureAudit.duplicateYCount}件`);

  // 過去方向へ大きくホイールスクロール
  console.log('  過去方向へ逆スクロール (deltaY = -800)...');
  await page.mouse.wheel(0, -800);
  await page.waitForTimeout(1000);

  const scrollPastAudit = await page.evaluate(() => {
    const dbg = window.__wbserDebug;
    const nodes = dbg.getGraphNodes();
    const metrics = dbg.getCanvasMetrics();
    const zone2Nodes = nodes.filter((n) => n.dueDate && n.x < metrics.timelineStartX);
    const zone4Nodes = nodes.filter((n) => n.dueDate && n.x > metrics.timelineEndX);
    const timelineNodes = nodes.filter((n) => n.dueDate && n.x >= metrics.timelineStartX && n.x <= metrics.timelineEndX);

    let duplicateYCount = 0;
    for (let i = 0; i < zone2Nodes.length; i++) {
      for (let j = i + 1; j < zone2Nodes.length; j++) {
        if (Math.abs(zone2Nodes[i].y - zone2Nodes[j].y) < 10) duplicateYCount++;
      }
    }
    for (let i = 0; i < zone4Nodes.length; i++) {
      for (let j = i + 1; j < zone4Nodes.length; j++) {
        if (Math.abs(zone4Nodes[i].y - zone4Nodes[j].y) < 10) duplicateYCount++;
      }
    }

    return {
      zone2Count: zone2Nodes.length,
      zone4Count: zone4Nodes.length,
      timelineCount: timelineNodes.length,
      duplicateYCount,
    };
  });

  await page.screenshot({ path: path.join(AUDIT_DIR, '06_scroll_past.png') });
  console.log(`  過去スクロール後: 過去ゾーン ${scrollPastAudit.zone2Count}件, 未来ゾーン ${scrollPastAudit.zone4Count}件, タイムライン ${scrollPastAudit.timelineCount}件, 重複Y ${scrollPastAudit.duplicateYCount}件`);

  const scrollPassed = scrollFutureAudit.duplicateYCount === 0 && scrollPastAudit.duplicateYCount === 0;
  testResults.push({
    test: '日付モードでのホイールスクロール動作・過去未来ゾーン整合性',
    passed: scrollPassed,
    details: `未来スクロール時重複Y: ${scrollFutureAudit.duplicateYCount}, 過去スクロール時重複Y: ${scrollPastAudit.duplicateYCount}`,
  });

  // -------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------
  console.log('\n========================================================');
  console.log('📊 検証結果総合サマリー');
  console.log('========================================================');
  let allPassed = true;
  testResults.forEach((r, idx) => {
    const mark = r.passed ? '✅ PASS' : '❌ FAIL';
    if (!r.passed) allPassed = false;
    console.log(`${idx + 1}. [${mark}] ${r.test} (${r.details})`);
  });

  if (pageErrors.length > 0) {
    console.log('\n⚠️ 検出されたコンソールエラー:', pageErrors);
  } else {
    console.log('\n✨ コンソールエラー・未捕捉例外: 0 件');
  }

  await browser.close();

  if (!allPassed) {
    process.exit(1);
  }
}

runDeepVerification().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
