import assert from 'node:assert/strict';
import { tsImport } from 'tsx/esm/api';
import { possessResident, selectResident } from './select-resident.mjs';

const { ColonySimulation, SUPPLY_TYPES } = await tsImport('../assets/colony/simulation.ts', import.meta.url);
const { VoxelWorld } = await tsImport('../assets/voxel/model.ts', import.meta.url);
const READ = 'voxel.world';
const SAVE = 'homestead.colony.v2';
const TEXTURED = ['egg', 'milk', 'oil'];

export default async function supplyItems(play) {
  const { page } = play;
  const read = () => play.state(READ);
  const wait = predicate => play.waitFor(predicate, { read: READ, timeoutMs: 12000 });
  const advance = seconds => play.advance(seconds, { read: READ, stepSeconds: .1 });
  const tab = menu => page.locator(`[data-menu="${menu}"]`);
  const supplyCell = resource => page.locator(`#workspace .wh-cell[data-item="${resource}"]`);
  const assertIcon = async icon => assert.ok(await icon.evaluate(async image => {
    await image.decode();
    return image.naturalWidth > 0;
  }));

  await play.step('新家园和旧存档各有 11 种物品，每种 10 个', async () => {
    const fresh = await wait(state => state.colony?.colonists.length > 0);
    assert.equal(SUPPLY_TYPES.length, 11);
    for (const resource of SUPPLY_TYPES) assert.equal(fresh.colony.resources[resource], 10, resource);

    const world = new VoxelWorld(fresh.seed);
    const oldSave = new ColonySimulation(world).serialize();
    oldSave.speed = 0;
    for (const resource of SUPPLY_TYPES) {
      delete oldSave.resources[resource];
      delete oldSave.trade.stock[resource];
      delete oldSave.trade.prices[resource];
    }
    await page.evaluate(({ key, value }) => localStorage.setItem(key, value), {
      key: SAVE, value: JSON.stringify({ version: 2, voxel: world.serialize(), colony: oldSave }),
    });
    await play.reload();
    const upgraded = await wait(state => state.colony?.speed === 0);
    for (const resource of SUPPLY_TYPES) assert.equal(upgraded.colony.resources[resource], 10, resource);
  });

  const residentId = (await read()).colony.colonists[0].id;
  await play.step('仓库分类显示全部样品，并能按名称搜索', async () => {
    await selectResident(play, residentId);
    await tab('warehouse').click();
    await page.locator('#workspace .wh-cat-trigger').click();
    await page.locator('#workspace [data-cat="supply"]').click();
    assert.equal(await page.locator('#workspace .wh-cell[data-item]').count(), 11);
    for (const resource of SUPPLY_TYPES) {
      assert.equal(await supplyCell(resource).locator('.wh-count').textContent(), '10', resource);
      if (TEXTURED.includes(resource)) await assertIcon(supplyCell(resource).locator('img'));
      else assert.ok((await supplyCell(resource).locator('.wh-icon').textContent()).trim());
    }
    await play.screenshot('warehouse-supply-icons-and-counts');
    await page.locator('#workspace .wh-search').fill('牛奶');
    assert.equal(await page.locator('#workspace .wh-cell[data-item]').count(), 1);
  });

  await play.step('按数量领取牛奶，显示在快捷栏并随存档保留', async () => {
    await supplyCell('milk').click({ button: 'right' });
    const slider = page.locator('#item-amount');
    assert.equal(await slider.getAttribute('max'), '10');
    await slider.press('Home');
    await slider.press('ArrowRight');
    await slider.press('ArrowRight');
    await page.locator('#item-menu [data-item-action="take"]').click();
    const queued = await wait(state => state.colony.resources.milk === 7);
    assert.ok(queued.colony.jobs.some(job => job.targetId === 'player-delivery' && job.reserved.milk === 3));

    await page.locator('#panel-close').click();
    await page.keyboard.press('Escape');
    await page.locator('#pause-menu').waitFor({ state: 'visible' });
    await page.keyboard.press('Escape');
    const hasMilk = state => state.colony?.colonists.find(person => person.id === residentId)?.bag
      .some(item => item?.resource === 'milk' && item.count === 3);
    let delivered = await wait(state => state.colony.speed === 1);
    for (let i = 0; i < 8 && !hasMilk(delivered); i++) delivered = await advance(5);
    assert.ok(hasMilk(delivered), '村民应把牛奶交给指定收货人');
    await possessResident(play, residentId);
    await assertIcon(page.locator('#hotbar [data-item="milk"] img'));
    await play.screenshot('delivered-milk-in-hotbar');

    await page.waitForFunction(({ key, id }) => {
      const colony = JSON.parse(localStorage.getItem(key) ?? 'null')?.colony;
      return colony?.resources.milk === 7 && colony.colonists.find(person => person.id === id)?.bag
        .some(item => item?.resource === 'milk' && item.count === 3);
    }, { key: SAVE, id: residentId }, { timeout: 10000 });
    await play.reload();
    const restored = await wait(state => state.colony?.resources.milk === 7 && hasMilk(state));
    assert.equal(restored.colony.resources.milk, 7);
    await possessResident(play, residentId);
    await assertIcon(page.locator('#hotbar [data-item="milk"] img'));
    await play.screenshot('supply-inventory-restored');
  });

  return { addedItems: SUPPLY_TYPES.length, texturedItems: TEXTURED.length, delivered: 3 };
}
