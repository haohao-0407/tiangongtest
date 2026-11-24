import assert from 'node:assert/strict';
import { tsImport } from 'tsx/esm/api';
import { possessResident, selectResident } from './select-resident.mjs';

const { ColonySimulation, SUPPLY_TYPES } = await tsImport('../assets/colony/simulation.ts', import.meta.url);
const { VoxelWorld } = await tsImport('../assets/voxel/model.ts', import.meta.url);
const READ = 'voxel.world';
const SAVE = 'homestead.colony.v2';
const TEXTURED = SUPPLY_TYPES;

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

  await play.step('新家园备齐样品，旧存档补入生猪肉', async () => {
    const fresh = await wait(state => state.colony?.colonists.length > 0);
    assert.equal(SUPPLY_TYPES.length, 12);
    for (const resource of SUPPLY_TYPES) assert.equal(fresh.colony.resources[resource], 10, resource);

    const world = new VoxelWorld(fresh.seed);
    const oldSave = new ColonySimulation(world).serialize();
    oldSave.speed = 0;
    delete oldSave.resources.pork;
    oldSave.resources.flour = 4;
    oldSave.items.push({
      id: `item-${oldSave.nextId++}`, resource: 'flour', amount: 4, x: 128, y: 6, z: 130,
      age: 2, reservedBy: null, playerOnly: true,
    });
    await page.evaluate(({ key, value }) => localStorage.setItem(key, value), {
      key: SAVE, value: JSON.stringify({ version: 2, voxel: world.serialize(), colony: oldSave }),
    });
    await play.reload();
    const upgraded = await wait(state => state.colony?.speed === 0);
    for (const resource of SUPPLY_TYPES) assert.equal(upgraded.colony.resources[resource], resource === 'flour' ? 4 : 10, resource);
  });

  const residentId = (await read()).colony.colonists[0].id;
  await play.step('仓库分类显示全部样品，并能按名称搜索', async () => {
    await selectResident(play, residentId);
    await tab('warehouse').click();
    await page.locator('#workspace .wh-cat-trigger').click();
    await page.locator('#workspace [data-cat="supply"]').click();
    assert.equal(await page.locator('#workspace .wh-cell[data-item]').count(), 12);
    for (const resource of SUPPLY_TYPES) {
      assert.equal(await supplyCell(resource).locator('.wh-count').textContent(), resource === 'flour' ? '4' : '10', resource);
      if (TEXTURED.includes(resource)) await assertIcon(supplyCell(resource).locator('img'));
      else assert.ok((await supplyCell(resource).locator('.wh-icon').textContent()).trim());
    }
    await play.screenshot('warehouse-supply-icons-and-counts');
    await page.locator('#workspace .wh-search').fill('生猪肉');
    assert.equal(await page.locator('#workspace .wh-cell[data-item]').count(), 1);
  });

  await play.step('领取生猪肉并核对手持、掉落和读档显示', async () => {
    await supplyCell('pork').click({ button: 'right' });
    const slider = page.locator('#item-amount');
    assert.equal(await slider.getAttribute('max'), '10');
    await slider.press('Home');
    await slider.press('ArrowRight');
    await slider.press('ArrowRight');
    await page.locator('#item-menu [data-item-action="take"]').click();
    const queued = await wait(state => state.colony.resources.pork === 7);
    assert.ok(queued.colony.jobs.some(job => job.targetId === 'player-delivery' && job.reserved.pork === 3));

    await page.locator('#panel-close').click();
    await page.keyboard.press('Escape');
    await page.locator('#pause-menu').waitFor({ state: 'visible' });
    await page.keyboard.press('Escape');
    const porkSlot = state => state.colony.colonists.find(person => person.id === residentId)?.bag
      .findIndex(item => item?.resource === 'pork' && item.count === 3) ?? -1;
    let delivered = await wait(state => state.colony.speed === 1);
    for (let i = 0; i < 8 && porkSlot(delivered) < 0; i++) delivered = await advance(5);
    assert.ok(porkSlot(delivered) >= 0, '村民应把生猪肉交给指定收货人');
    await possessResident(play, residentId);
    await page.keyboard.press(`Digit${porkSlot(delivered) + 1}`);
    await wait(state => state.player?.bag[state.player.bagSelected]?.resource === 'pork' && state.camera.distance < 13);
    const holding = await advance(.6);
    assert.ok(holding.colony.items.some(item => item.resource === 'flour' && item.x === 128 && item.z === 130));
    await assertIcon(page.locator('#hotbar [data-item="pork"] img'));
    await play.screenshot('held-pork-and-dropped-flour');
    await advance(.7);
    await play.screenshot('flour-drop-rotated');

    await page.waitForFunction(({ key, id }) => {
      const colony = JSON.parse(localStorage.getItem(key) ?? 'null')?.colony;
      return colony?.resources.pork === 7 && colony.colonists.find(person => person.id === id)?.bag
        .some(item => item?.resource === 'pork' && item.count === 3);
    }, { key: SAVE, id: residentId }, { timeout: 10000 });
    await play.reload();
    const restored = await wait(state => state.colony?.resources.pork === 7 && porkSlot(state) >= 0);
    assert.equal(restored.colony.resources.flour, 4);
    await possessResident(play, residentId);
    await assertIcon(page.locator('#hotbar [data-item="pork"] img'));
    await play.screenshot('supply-inventory-restored');
  });

  return { addedItems: SUPPLY_TYPES.length, texturedItems: TEXTURED.length, delivered: 3 };
}
