import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OUTPUT_DIR = path.join(__dirname, '../tests/display_audit');

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

async function verifyLeaderLines() {
  console.log('====================================================');
  console.log('🧪 タイムライン上下2層分離＆引き出し線検証');
  console.log('====================================================');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();

  console.log('▶ http://localhost:3000 に接続中...');
  await page.goto('http://localhost:3000');
  await page.waitForTimeout(2000);

  // Get nodes in normal mode
  const initialNodes = await page.evaluate(() => {
    return window.__wbserDebug.getGraphNodes();
  });
  console.log(`初期ノード数: ${initialNodes.length}`);

  // Find a task with children to click (e.g. root task or one with due date)
  const candidate = initialNodes.find((n) => n.parentId === null) || initialNodes[0];
  console.log(`フォーカス対象タスク: "${candidate.title}" (ID: ${candidate.id})`);

  await page.evaluate((id) => {
    window.__wbserDebug.clickNode(id);
  }, candidate.id);

  // Wait for timeline animation & slot assignment to settle
  await page.waitForTimeout(2000);

  const timelineState = await page.evaluate(() => {
    const dbg = window.__wbserDebug;
    const nodes = dbg.getGraphNodes();
    const slots = dbg.getTimelineSlots ? dbg.getTimelineSlots() : [];
    const metrics = dbg.getCanvasMetrics();
    const selId = dbg.getSelectedTaskId();
    return { nodes, slots, metrics, selId };
  });

  console.log(`選択中タスクID: ${timelineState.selId}`);
  console.log(`Zone 3スロット割り当て件数: ${timelineState.slots.length}`);
  console.log('スロット情報:');
  timelineState.slots.forEach((s) => {
    const node = timelineState.nodes.find((n) => n.id === s.taskId);
    console.log(` - [Slot ${s.slot}] Task "${node?.title}": Label(X=${Math.round(s.lx)}, Y=${Math.round(s.ly)}) Node(X=${Math.round(node?.x)}, Y=${Math.round(node?.y)})`);
  });

  // Verify Upper Tier / Lower Tier Separation for Zone 3 nodes
  let tierSeparationPassed = true;
  for (const s of timelineState.slots) {
    const node = timelineState.nodes.find((n) => n.id === s.taskId);
    if (!node) continue;

    // Label should be in upper tier: 70 <= Y <= 215
    if (s.ly > 215 || s.ly < 70) {
      console.error(`❌ ラベルY座標が上段スロット範囲外: ${s.ly} (期待値: 70〜215)`);
      tierSeparationPassed = false;
    }

    // Node circle should be in lower tier: Y >= 220
    if (node.y < 220) {
      console.error(`❌ ノードY座標が下段グラフ範囲外: ${node.y} (期待値: >= 220)`);
      tierSeparationPassed = false;
    }
  }

  // Verify Chronological Monotonicity: "上であるほど 過去の日程のものが固まる"
  let chronologicalOrderingPassed = true;
  for (let i = 0; i < timelineState.slots.length; i++) {
    for (let j = i + 1; j < timelineState.slots.length; j++) {
      const sA = timelineState.slots[i];
      const sB = timelineState.slots[j];
      const nodeA = timelineState.nodes.find((n) => n.id === sA.taskId);
      const nodeB = timelineState.nodes.find((n) => n.id === sB.taskId);
      if (!nodeA || !nodeB) continue;

      const halfWA = ((nodeA.titleWidth || 80) + 48) / 2 + 5;
      const halfWB = ((nodeB.titleWidth || 80) + 48) / 2 + 5;
      const leftA = sA.lx - halfWA;
      const rightA = sA.lx + halfWA;
      const leftB = sB.lx - halfWB;
      const rightB = sB.lx + halfWB;

      const overlaps = leftA < rightB && rightA > leftB;
      if (overlaps) {
        const dateA = new Date(nodeA.dueDate || 0).getTime();
        const dateB = new Date(nodeB.dueDate || 0).getTime();
        if (dateA < dateB && sA.slot >= sB.slot) {
          console.error(`❌ 時系列スロット逆転: "${nodeA.title}" (${sA.slot}) vs "${nodeB.title}" (${sB.slot})`);
          chronologicalOrderingPassed = false;
        }
      }
    }
  }

  if (chronologicalOrderingPassed) {
    console.log('✅ 時系列スロット順序 (重なるラベルは過去ほど上段スロット): 合格！');
  }

  if (tierSeparationPassed && timelineState.slots.length > 0) {
    console.log('✅ 上下2層分離 (ラベル Y: 70〜215 / ノード Y: >= 220): 合格！');
  }

  // Screenshot normal timeline with leader lines
  const screenshotPath1 = path.join(OUTPUT_DIR, 'leader_lines_timeline.png');
  await page.screenshot({ path: screenshotPath1 });
  console.log(`📸 タイムライン全景スクリーンショット保存: ${screenshotPath1}`);

  // Hover test on the first Zone 3 node
  if (timelineState.slots.length > 0) {
    const firstSlot = timelineState.slots[0];
    const targetNode = timelineState.nodes.find((n) => n.id === firstSlot.taskId);
    console.log(`\n▶ ノード "${targetNode.title}" へホバー中 (X=${targetNode.x}, Y=${targetNode.y})...`);

    await page.mouse.move(targetNode.x, targetNode.y);
    await page.waitForTimeout(600);

    const screenshotPath2 = path.join(OUTPUT_DIR, 'leader_lines_hover.png');
    await page.screenshot({ path: screenshotPath2 });
    console.log(`📸 ホバー発光スクリーンショット保存: ${screenshotPath2}`);
  }

  await browser.close();
  console.log('\n🎉 検証スクリプト完了！');
}

verifyLeaderLines().catch((err) => {
  console.error('検証エラー:', err);
  process.exit(1);
});
