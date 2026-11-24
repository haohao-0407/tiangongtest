import { returnToMap } from './return-to-map.mjs';
import assert from 'node:assert/strict';

const READ = 'voxel.world';
const desktop = { width: 1280, height: 720 };
const wide = { width: 1920, height: 1080 };
const compact = { width: 390, height: 520 };

export default async function windowLayout(play) {
  const workspace = play.page.locator('#workspace');
  const advance = () => play.advance(0.2, { read: READ, stepSeconds: 0.05 });
  const close = () => play.page.locator('#panel-close').click();
  const resize = async (viewport) => { await play.page.setViewportSize(viewport); await advance(); };
  const open = async (name) => {
    if (name === 'chest') await play.page.evaluate(() => window.__wbOpenChest());
    else if (name === 'followerBag') {
      const resident = (await play.state(READ)).colony.colonists[0].id;
      await play.page.evaluate((id) => window.__wbOpenFollower(id), resident);
    } else await play.page.locator(`[data-menu="${name}"]`).click();
    await advance();
    assert.equal(await workspace.getAttribute('data-panel'), name);
  };
  const windowBounds = async (locator, viewport) => {
    const bounds = await locator.boundingBox();
    assert.ok(bounds, '窗口应可见');
    assert.ok(bounds.x >= 8 && bounds.y >= 8 && bounds.x + bounds.width <= viewport.width - 8
      && bounds.y + bounds.height <= viewport.height - 8, `窗口应在视口内：${JSON.stringify(bounds)}`);
    return bounds;
  };
  const dragWindow = async (dx, dy) => {
    const title = await workspace.locator('.panel-heading').boundingBox();
    assert.ok(title);
    const x = title.x + Math.min(200, title.width / 2);
    const y = title.y + title.height / 2;
    const { width, height } = play.page.viewportSize();
    await play.page.mouse.move(x, y);
    await play.page.mouse.down();
    await play.page.mouse.move(Math.min(width - 1, Math.max(1, x + dx)),
      Math.min(height - 1, Math.max(1, y + dy)), { steps: 5 });
    await play.page.mouse.up();
    await advance();
  };
  const fixedSizes = {};
  assert.equal(await play.page.locator('.tool-rail [data-menu="inspect"]').count(), 0);
  assert.equal(await play.page.locator('.tool-rail [data-menu="trade"]').count(), 0);
  // Pause resident updates so the same content is measured on both desktop sizes.
  await play.page.locator('[data-menu="sandbox"]').click();
  await returnToMap(play);
  await advance();
  assert.equal((await play.state(READ)).colony.speed, 0);
  assert.equal(await play.page.locator('.tool-rail [data-menu].active').count(), 0);
  await play.screenshot('menu-without-inspect-or-trade');
  const panels = ['plan', 'build', 'work', 'warehouse', 'chest', 'followerBag', 'follower',
    'production', 'research', 'logs', 'sandbox'];
  for (const name of panels) {
    await open(name);
    const before = await windowBounds(workspace, desktop);
    await resize(wide);
    const after = await windowBounds(workspace, wide);
    assert.ok(after.width <= 760);
    assert.ok(Math.abs(before.width - after.width) <= 1 && Math.abs(before.height - after.height) <= 1,
      `${name} 不应随浏览器放大：${JSON.stringify({ before, after })}`);
    fixedSizes[name] = [Math.round(after.width), Math.round(after.height)];
    if (['plan', 'chest', 'warehouse', 'followerBag'].includes(name)) await play.screenshot(`window-${name}-wide`);
    if (name === 'plan' || name === 'chest') {
      await resize(compact);
      const box = await windowBounds(workspace, compact);
      assert.ok(box.width < before.width, '窄视口应留出窗口边距');
      const content = play.page.locator('#panel-content');
      const scrolls = await content.evaluate(el => el.scrollHeight > el.clientHeight);
      assert.equal(await play.page.locator('.tool-rail').isVisible(), false, '窄屏下菜单栏不应和打开的窗口争抢空间');
      if (name === 'plan') {
        assert.ok(scrolls, '短视口下规划内容应在窗口内滚动');
        await content.hover();
        await play.page.mouse.wheel(0, 160);
        await advance();
        assert.ok(await content.evaluate(el => el.scrollTop > 0));
      } else {
        assert.equal(scrolls, false, '木箱的四排格子应完整显示');
      }
      await play.screenshot(`window-${name}-compact`);
    }
    await close();
    await resize(desktop);
  }

  await play.step('drag-menu-windows-and-use-exposed-map', async () => {
    await open('work');
    const original = await windowBounds(workspace, desktop);
    await dragWindow(160, -48);
    const moved = await windowBounds(workspace, desktop);
    assert.ok(moved.x >= original.x + 150 && moved.y <= original.y - 40);
    assert.equal(moved.width, original.width);
    assert.equal((await play.screenshot('window-work-dragged')).rendered, true);
    await close();
    await open('plan');
    const plan = await windowBounds(workspace, desktop);
    assert.ok(Math.abs(plan.x - (desktop.width - plan.width) / 2) <= 1);
    await dragWindow(900, 500);
    const movedPlan = await windowBounds(workspace, desktop);
    assert.ok(movedPlan.x > plan.x + 120);
    assert.ok(movedPlan.x + movedPlan.width >= desktop.width - 13);
    await play.page.locator('[data-testid="terrain-sample"]').click();
    await play.waitFor(s => s.terrain.sample, { read: READ });
    await workspace.waitFor({ state: 'hidden' });
    const mapPoint = [.34, .56];
    assert.ok(mapPoint[0] * desktop.width < movedPlan.x);
    await play.mouse.move(mapPoint);
    await play.waitFor(s => s.hoverCell !== null, { read: READ });
    await play.mouse.click(mapPoint);
    await play.waitFor(s => !s.terrain.sample && s.status.startsWith('已取样'), { read: READ });
    await workspace.waitFor({ state: 'visible' });
    assert.deepEqual(await windowBounds(workspace, desktop), movedPlan);
    await play.page.locator('[data-testid="crop-tomato"]').click();
    await play.waitFor(s => s.crop === 'tomato', { read: READ });
    assert.equal((await play.screenshot('window-plan-dragged-map-active')).rendered, true);
    await resize(compact);
    await windowBounds(workspace, compact);
    await close();
    await resize(desktop);
    await open('work');
    assert.deepEqual(await windowBounds(workspace, desktop), moved);
    await close();
  });

  await returnToMap(play);
  await play.page.locator('#colonists [data-resident]').first().click();
  const inspector = play.page.locator('#inspector');
  await advance();
  const inspectorSize = await windowBounds(inspector, desktop);
  await resize(wide);
  assert.equal((await windowBounds(inspector, wide)).width, inspectorSize.width);
  await play.page.locator('#inspector-close').click();
  await resize(desktop);
  await play.page.keyboard.press('Escape');
  await advance();
  const pause = play.page.locator('#pause-menu .pause-card');
  const pauseSize = await windowBounds(pause, desktop);
  await resize(wide);
  assert.equal((await windowBounds(pause, wide)).width, pauseSize.width);
  await play.page.locator('#pause-settings').click();
  const options = play.page.locator('#game-options .options-card');
  const optionsSize = await windowBounds(options, wide);
  await resize(compact);
  assert.equal((await windowBounds(options, compact)).width, optionsSize.width);
  await play.screenshot('window-options-compact');
  await resize(desktop);
  await play.page.keyboard.press('Escape');
  await play.page.keyboard.press('Escape');
  await advance();
  await play.reload();
  await open('build');
  const build = await windowBounds(workspace, desktop);
  await dragWindow(120, -45);
  const movedBuild = await windowBounds(workspace, desktop);
  assert.ok(movedBuild.x >= build.x + 110 && movedBuild.y <= build.y - 40);
  assert.equal((await play.screenshot('window-build-dragged-after-reload')).rendered, true);
  return { fixedSizes };
}
