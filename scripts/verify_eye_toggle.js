import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ARTIFACTS_DIR = path.join(__dirname, '../tests/display_audit');

async function testEyeToggle() {
  console.log('▶ Starting Eye Icon Toggle verification...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();

  await page.goto('http://localhost:3000');
  await page.waitForTimeout(2000);

  // 1. Click root to enter timeline mode
  const clickSuccess = await page.evaluate(() => {
    const dbg = window.__wbserDebug;
    const nodes = dbg.getGraphNodes();
    const root = nodes.find(n => n.title.includes('リアルタイム'));
    if (!root) return false;
    return dbg.clickNode(root.id);
  });
  console.log('Root click success:', clickSuccess);
  if (!clickSuccess) {
    throw new Error('Failed to click root node');
  }

  await page.waitForTimeout(1000);

  const canvasBox = await page.evaluate(() => {
    const r = document.getElementById('obsidian-canvas').getBoundingClientRect();
    return { left: r.left, top: r.top };
  });

  // Check initial visibility
  let vis = await page.evaluate(() => window.__wbserDebug.getZoneVisibility());
  console.log('Initial visibility:', vis);
  if (!vis.showPastLabels || !vis.showFutureLabels) {
    throw new Error(`Expected both true initially, got ${JSON.stringify(vis)}`);
  }

  // 2. Hover over Past Eye Icon (Zone 2 eye button)
  // zone2End is 202, button is x: 202 - 26 to 202 - 6 (176 to 196), y: 22 to 48 (center: 35)
  await page.mouse.move(canvasBox.left + 186, canvasBox.top + 35);
  await page.waitForTimeout(400);

  vis = await page.evaluate(() => window.__wbserDebug.getZoneVisibility());
  console.log('Hovered over past eye button:', vis);
  if (vis.hoveredEyeZone !== 'past') {
    throw new Error(`Expected hoveredEyeZone to be "past", got ${vis.hoveredEyeZone}`);
  }

  // Take screenshot with hover tooltip on past eye icon
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'eye_hover_past_tooltip.png') });
  console.log('Saved eye_hover_past_tooltip.png');

  // 3. Click past eye button
  await page.mouse.click(canvasBox.left + 186, canvasBox.top + 35);
  await page.waitForTimeout(600);

  vis = await page.evaluate(() => window.__wbserDebug.getZoneVisibility());
  console.log('After clicking past eye button:', vis);
  if (vis.showPastLabels !== false) {
    throw new Error(`Expected showPastLabels to be false, got ${vis.showPastLabels}`);
  }

  // Move mouse away to clear hover tooltip and take screenshot of past labels hidden
  await page.mouse.move(500, 300);
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'past_labels_hidden.png') });
  console.log('Saved past_labels_hidden.png');

  // 4. Hover over a past node to verify it still pops up temporarily
  const pastNode = await page.evaluate(() => {
    const nodes = window.__wbserDebug.getGraphNodes();
    // Zone 2 is between x: 112 and 202
    return nodes.find(n => n.x >= 112 && n.x <= 202 && n.parentId);
  });
  console.log('Found past node:', pastNode ? pastNode.title : 'none');

  if (pastNode) {
    await page.mouse.move(canvasBox.left + pastNode.x, canvasBox.top + pastNode.y);
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'past_node_hover_reveals_label.png') });
    console.log('Saved past_node_hover_reveals_label.png');
  }

  // 5. Test Future Eye Icon (Zone 4 eye button)
  // Zone 4 is width - 106 to width - 10 (1174 to 1270). Button is 1270 - 26 to 1270 - 6 (1244 to 1264), y: 35
  await page.mouse.move(canvasBox.left + 1254, canvasBox.top + 35);
  await page.waitForTimeout(400);

  vis = await page.evaluate(() => window.__wbserDebug.getZoneVisibility());
  console.log('Hovered over future eye button:', vis);
  if (vis.hoveredEyeZone !== 'future') {
    throw new Error(`Expected hoveredEyeZone to be "future", got ${vis.hoveredEyeZone}`);
  }
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'eye_hover_future_tooltip.png') });
  console.log('Saved eye_hover_future_tooltip.png');

  // Click future eye button
  await page.mouse.click(canvasBox.left + 1254, canvasBox.top + 35);
  await page.waitForTimeout(600);

  vis = await page.evaluate(() => window.__wbserDebug.getZoneVisibility());
  console.log('After clicking future eye button:', vis);
  if (vis.showFutureLabels !== false) {
    throw new Error(`Expected showFutureLabels to be false, got ${vis.showFutureLabels}`);
  }

  await page.mouse.move(canvasBox.left + 500, canvasBox.top + 300);
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'both_zones_labels_hidden.png') });
  console.log('Saved both_zones_labels_hidden.png');

  // 6. Test localStorage persistence: reload page
  console.log('Reloading page to test localStorage persistence...');
  await page.reload();
  await page.waitForTimeout(2000);

  vis = await page.evaluate(() => window.__wbserDebug.getZoneVisibility());
  console.log('Visibility after page reload:', vis);
  if (vis.showPastLabels !== false || vis.showFutureLabels !== false) {
    throw new Error(`localStorage persistence failed: expected both false, got ${JSON.stringify(vis)}`);
  }

  // 7. Toggle them back on
  // Click root again
  await page.evaluate(() => {
    const dbg = window.__wbserDebug;
    const root = dbg.getGraphNodes().find(n => n.title.includes('リアルタイム'));
    dbg.clickNode(root.id);
  });
  await page.waitForTimeout(600);

  // Click past eye to toggle on
  await page.mouse.click(canvasBox.left + 186, canvasBox.top + 35);
  await page.waitForTimeout(300);
  // Click future eye to toggle on
  await page.mouse.click(canvasBox.left + 1254, canvasBox.top + 35);
  await page.waitForTimeout(300);

  vis = await page.evaluate(() => window.__wbserDebug.getZoneVisibility());
  console.log('Visibility after toggling back ON:', vis);
  if (!vis.showPastLabels || !vis.showFutureLabels) {
    throw new Error(`Expected both true after toggling on, got ${JSON.stringify(vis)}`);
  }

  await page.mouse.move(500, 300);
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'both_zones_labels_restored.png') });
  console.log('Saved both_zones_labels_restored.png');

  await browser.close();
  console.log('✅ All Eye Icon Toggle tests passed successfully!');
}

testEyeToggle().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
