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
  const fixedSizes = {};
  // Pause resident updates so the same content is measured on both desktop sizes.
  await play.page.locator('[data-menu="sandbox"]').click();
  await play.page.locator('[data-menu="inspect"]').click();
  await advance();
  const panels = ['plan', 'build', 'work', 'warehouse', 'chest', 'followerBag', 'follower',
    'production', 'research', 'trade', 'logs', 'sandbox'];
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

  await play.page.locator('[data-menu="inspect"]').click();
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
  return { fixedSizes };
}
