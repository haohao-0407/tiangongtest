import { returnToMap } from './return-to-map.mjs';
import assert from 'node:assert/strict';

export default async function buildPlacement(play) {
  const read = 'voxel.world';
  const { page } = play;
  const workspace = page.locator('#workspace');
  const content = page.locator('#panel-content');
  const control = id => page.locator(`[data-testid="${id}"]`);
  const wait = predicate => play.waitFor(predicate, { read });
  const advance = () => play.advance(.15, { read, stepSeconds: .05 });
  const capture = async name => assert.ok((await play.screenshot(name)).rendered);
  const select = async kind => {
    await control(`build-${kind}`).click();
    await workspace.waitFor({ state: 'hidden' });
    await wait(s => s.tool === (kind === 'chest' ? 'place-chest' : `build:${kind}`));
  };
  const returned = async () => {
    await workspace.waitFor({ state: 'visible' });
    assert.equal(await workspace.getAttribute('data-panel'), 'build');
    await wait(s => s.tool === 'inspect');
    assert.equal(await page.locator('#pause-menu').isVisible(), false);
  };
  const findGround = async () => {
    for (const y of [.46, .42, .5, .38, .54, .58, .62]) {
      for (const x of [.5, .46, .54, .42, .58, .38, .62]) {
        await play.mouse.move([x, y]);
        const state = await advance();
        const cell = state.hoverCell;
        if (!cell || state.hoverBuildingId || state.hoverTreeId) continue;
        const [cx, height, cz] = cell;
        if (height !== state.colony.buildings.find(b => b.complete)?.y) continue;
        if (state.colony.buildings.some(b => cx >= b.x && cx < b.x + b.w && cz >= b.z && cz < b.z + b.d)) continue;
        if (state.colony.zones.some(z => cx >= z.x && cx < z.x + z.w && cz >= z.z && cz < z.z + z.d)) continue;
        return [x, y];
      }
    }
    assert.fail('Expected a free ground tile under the cursor');
  };

  await wait(s => s.colony?.colonists.length > 0);
  await control('menu-sandbox').click();
  await returnToMap(play);
  await wait(s => s.tool === 'inspect' && s.colony.speed === 0);
  await control('menu-build').click();
  await play.step('hide-build-menu-while-previewing-and-rotate', async () => {
    await select('floor');
    const terrain = await findGround();
    await control('build-rotate').click();
    await play.mouse.move(terrain);
    await wait(s => s.buildRotation === 1 && s.placementPreview);
    await capture('build-preview-with-menu-hidden');
  });

  await play.step('control-click-keeps-placement-and-plain-click-returns', async () => {
    const first = await findGround(), before = await play.state(read);
    await page.keyboard.down('Control');
    try {
      await play.mouse.click(first);
      const placed = await wait(s => s.colony.buildings.length === before.colony.buildings.length + 1);
      assert.equal(placed.tool, 'build:floor');
      assert.equal(await workspace.isVisible(), false);
    } finally {
      await page.keyboard.up('Control');
    }
    const firstBuilding = (await play.state(read)).colony.buildings.at(-1);
    await play.mouse.click(first);
    const rejected = await wait(s => s.status.includes('已有建筑或蓝图'));
    assert.equal(rejected.colony.buildings.at(-1).id, firstBuilding.id);
    assert.equal(rejected.tool, 'build:floor');
    assert.equal(await workspace.isVisible(), false);
    await capture('control-click-keeps-placing');
    const second = await findGround();
    await play.mouse.click(second);
    const placed = await wait(s => s.colony.buildings.length === before.colony.buildings.length + 2);
    assert.equal(placed.colony.buildings.at(-1).rotation, firstBuilding.rotation);
    await returned();
    await capture('single-click-restores-build-menu');
  });

  await play.step('escape-and-right-click-restore-the-build-menu', async () => {
    await control('build-chest').scrollIntoViewIfNeeded();
    const scrollTop = await content.evaluate(el => el.scrollTop);
    assert.ok(scrollTop > 0);
    await select('chest');
    await page.keyboard.press('Escape');
    await returned();
    assert.equal(await content.evaluate(el => el.scrollTop), scrollTop);
    await capture('escape-restores-menu-scroll');
    await select('floor');
    await play.mouse.click([.5, .48], { button: 'right' });
    await returned();
    await wait(s => s.status === '已取消摆放');
    await capture('right-click-restores-build-menu');
  });

  await play.reload();
  await wait(s => s.tool === 'inspect' && s.colony?.colonists.length > 0);
  await control('menu-build').click();
  await select('floor');
  await page.keyboard.press('Escape');
  await returned();
}
