import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OUTPUT_DIR = path.join(__dirname, '../data/display_audit');
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

async function runDisplayAudit() {
  console.log('====================================================');
  console.log('🔍 WBSer Canvas 描画・レイアウト破綻自動検知テスト');
  console.log('====================================================');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();

  console.log('▶ http://localhost:3000 へ接続中...');
  await page.goto('http://localhost:3000');

  // Wait for canvas and WebSocket state initialization
  await page.waitForTimeout(2500);

  const results = [];

  async function auditCurrentView(viewName, screenshotFilename) {
    console.log(`\n--- [検査: ${viewName}] ---`);

    // Let physics settle
    await page.waitForTimeout(1200);

    const auditData = await page.evaluate(() => {
      const dbg = window.__wbserDebug;
      if (!dbg) return { error: '__wbserDebug is not defined' };

      const nodes = dbg.getGraphNodes();
      const metrics = dbg.getCanvasMetrics();
      const selectedId = dbg.getSelectedTaskId();

      const issues = [];
      const overlaps = [];

      // Estimate label bounding box for collision detection
      function getLabelBox(node) {
        const textLen = (node.title || '').length;
        const w = Math.max(60, textLen * 9 + 16);
        const h = 20;
        let x = node.labelX;
        let y = node.labelY;
        // Bounding box: [left, top, right, bottom]
        return {
          left: x - w / 2,
          right: x + w / 2,
          top: y - h / 2,
          bottom: y + h / 2,
          w,
          h,
        };
      }

      // 1. Boundary Overflow Check
      nodes.forEach((n) => {
        // Node circle bounds
        const r = 16;
        if (n.x - r < 5) {
          issues.push({ type: 'OVERFLOW_LEFT', task: n.title, val: `X=${n.x} (画面左端突き抜け)` });
        }
        if (n.x + r > metrics.width - 5) {
          issues.push({ type: 'OVERFLOW_RIGHT', task: n.title, val: `X=${n.x} > ${metrics.width} (画面右端突き抜け)` });
        }
        if (n.y - r < metrics.effectiveTop) {
          issues.push({ type: 'OVERFLOW_TOP', task: n.title, val: `Y=${n.y} < ${metrics.effectiveTop} (上部バー被り)` });
        }
        if (n.y + r > metrics.effectiveBottom) {
          issues.push({ type: 'OVERFLOW_BOTTOM', task: n.title, val: `Y=${n.y} > ${metrics.effectiveBottom} (下部ドック被り)` });
        }

        // Label bounds
        const box = getLabelBox(n);
        if (box.bottom > metrics.effectiveBottom) {
          issues.push({ type: 'LABEL_OVERFLOW_BOTTOM', task: n.title, val: `Label Y=${Math.round(box.bottom)} > ${metrics.effectiveBottom} (下部バーへはみ出し)` });
        }
        if (box.left < 5) {
          issues.push({ type: 'LABEL_OVERFLOW_LEFT', task: n.title, val: `Label X=${Math.round(box.left)} < 0 (左画面外)` });
        }
        if (box.right > metrics.width - 5) {
          issues.push({ type: 'LABEL_OVERFLOW_RIGHT', task: n.title, val: `Label X=${Math.round(box.right)} > ${metrics.width} (右画面外)` });
        }
      });

      // 2. Node Circle Collisions
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i];
          const b = nodes[j];
          const dist = Math.hypot(a.x - b.x, a.y - b.y);
          if (dist < 28) {
            overlaps.push({
              type: 'NODE_COLLISION',
              taskA: a.title,
              taskB: b.title,
              dist: Math.round(dist),
              val: `ノード中心間距離 ${Math.round(dist)}px < 28px (円同士の重なり)`,
            });
          }
        }
      }

      // 3. Label Overlaps (AABB Intersection)
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i];
          const b = nodes[j];
          const boxA = getLabelBox(a);
          const boxB = getLabelBox(b);

          const intersectX = !(boxA.right < boxB.left || boxA.left > boxB.right);
          const intersectY = !(boxA.bottom < boxB.top || boxA.top > boxB.bottom);

          if (intersectX && intersectY) {
            overlaps.push({
              type: 'LABEL_COLLISION',
              taskA: a.title,
              taskB: b.title,
              val: `ラベル矩形が交差・重なり (${a.title} ✕ ${b.title})`,
            });
          }
        }
      }

      return {
        totalNodes: nodes.length,
        selectedId,
        metrics,
        issues,
        overlaps,
      };
    });

    const screenshotPath = path.join(OUTPUT_DIR, screenshotFilename);
    await page.screenshot({ path: screenshotPath });
    console.log(`📸 スクリーンショット保存: ${screenshotPath}`);

    if (auditData.error) {
      console.error(`❌ エラー: ${auditData.error}`);
      return;
    }

    console.log(`  総ノード数: ${auditData.totalNodes}`);
    console.log(`  画面はみ出し件数: ${auditData.issues.length} 件`);
    console.log(`  要素・文字衝突件数: ${auditData.overlaps.length} 件`);

    if (auditData.issues.length > 0) {
      console.log('  [⚠️ はみ出し詳細]:');
      auditData.issues.slice(0, 8).forEach((iss) => {
        console.log(`    - [${iss.type}] ${iss.task}: ${iss.val}`);
      });
      if (auditData.issues.length > 8) {
        console.log(`    ... 他 ${auditData.issues.length - 8} 件`);
      }
    }

    if (auditData.overlaps.length > 0) {
      console.log('  [❌ 衝突・重なり詳細]:');
      auditData.overlaps.slice(0, 8).forEach((ov) => {
        console.log(`    - [${ov.type}] ${ov.val}`);
      });
      if (auditData.overlaps.length > 8) {
        console.log(`    ... 他 ${auditData.overlaps.length - 8} 件`);
      }
    }

    if (auditData.issues.length === 0 && auditData.overlaps.length === 0) {
      console.log('  ✅ はみ出し・重なり ゼロ (正常)');
    }

    results.push({
      viewName,
      screenshotPath,
      auditData,
    });
  }

  // Test 1: Initial All-Tasks View
  await auditCurrentView('初期画面（全体グラフ）', 'view_1_initial.png');

  // Test 2: Select Root Project "リアルタイム・コラボレーション機能" (Timeline View)
  const clickedRoot = await page.evaluate(() => {
    const nodes = window.__wbserDebug.getGraphNodes();
    const root = nodes.find((n) => n.title.includes('リアルタイム・コラボレーション機能') && !n.parentId);
    if (root) {
      window.__wbserDebug.clickNode(root.id);
      return root.title;
    }
    return null;
  });

  if (clickedRoot) {
    await auditCurrentView(`ルート選択時タイムライン (${clickedRoot})`, 'view_2_root_timeline.png');
  }

  // Test 3: Select Branch "フロントエンド・UI実装" (Branch Timeline with Today stacks)
  const clickedBranch = await page.evaluate(() => {
    const nodes = window.__wbserDebug.getGraphNodes();
    const target = nodes.find((n) => n.title.includes('フロントエンド・UI実装'));
    if (target) {
      window.__wbserDebug.clickNode(target.id);
      return target.title;
    }
    return null;
  });

  if (clickedBranch) {
    await auditCurrentView(`ブランチ選択時タイムライン (${clickedBranch})`, 'view_3_frontend_timeline.png');
  }

  // Test 4: Hover over sibling task in Today (10/18)
  await page.evaluate(() => {
    const nodes = window.__wbserDebug.getGraphNodes();
    const sibling = nodes.find((n) => n.title.includes('直線エッジ'));
    if (sibling) {
      window.__wbserDebug.hoverNode(sibling.id);
    }
  });
  await auditCurrentView('本日タスクホバー時 (z軸優先描画)', 'view_4_hover_zorder.png');

  await browser.close();

  console.log('\n====================================================');
  console.log('📊 全検査完了サマリー');
  console.log('====================================================');
  results.forEach((r) => {
    console.log(`・${r.viewName}: はみ出し ${r.auditData.issues.length}件 / 衝突 ${r.auditData.overlaps.length}件 -> [${r.screenshotPath}]`);
  });
}

runDisplayAudit().catch((err) => {
  console.error('Audit failed with error:', err);
  process.exit(1);
});
