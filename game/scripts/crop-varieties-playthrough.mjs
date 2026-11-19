import assert from 'node:assert/strict';
import { tsImport } from 'tsx/esm/api';
import { possessResident } from './select-resident.mjs';

const { VoxelWorld } = await tsImport('../assets/voxel/model.ts', import.meta.url);
const { ColonySimulation, CROP_KINDS, CROP_SEEDS, CROP_TYPES, DISH_TYPES, JOB_TYPES } = await tsImport('../assets/colony/simulation.ts', import.meta.url);
const READ = 'voxel.world';
const SAVE = 'homestead.colony.v2';
const GROWTH = [.22, .57, .93];
const dot = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = vector => vector.map(value => value / Math.hypot(...vector));

/** @param {import('@forgeax/engine/devkit').PlayContext} play */
export default async function cropVarieties(play) {
  const { page } = play;
  const read = () => play.state(READ);
  const wait = predicate => play.waitFor(predicate, { read: READ, timeoutMs: 12000 });
  const advance = seconds => play.advance(seconds, { read: READ, stepSeconds: .1 });
  const capture = async name => assert.equal((await play.screenshot(name)).rendered, true);
  const control = id => page.locator(`[data-testid="${id}"]`);

  const world = new VoxelWorld();
  const colony = new ColonySimulation(world);
  const unlocked = colony.serialize();
  const starterCrops = new Set(unlocked.crops.map(crop => crop.id));
  const starterZones = new Set(unlocked.zones.map(zone => zone.id));
  unlocked.research.completed.push('agriculture');
  colony.load(unlocked);
  for (const [i, kind] of CROP_KINDS.entries()) {
    const result = colony.command({ action: 'designate', kind: 'farm', crop: kind, x: 121 + i, z: 134, w: 1, d: 3 });
    assert.ok(result.ok, result.message);
  }
  const fixture = colony.serialize();
  fixture.speed = 0;
  fixture.time = 180;
  for (const person of fixture.colonists) {
    for (const job of JOB_TYPES) person.priorities[job] = 0;
    person.priorities.grow = 2;
    person.priorities.harvest = 1;
  }
  const inspecting = fixture.colonists[2];
  inspecting.position = [124.5, 6, 139.7];
  inspecting.bag[3] = { resource: 'tomato', count: 2 };
  inspecting.bag[4] = { resource: 'cabbage', count: 1 };
  inspecting.bag[5] = { resource: 'friedEgg', count: 1 };
  const displayDrops = ['wheat', 'building:bed', 'wood'].map((resource, i) => ({
    id: `item-${fixture.nextId++}`, resource, amount: 1, x: 122 + i * 2, y: 6, z: 137,
    age: 2, reservedBy: null, playerOnly: true,
  }));
  fixture.items.push(...displayDrops);
  for (const crop of fixture.crops) {
    if (starterCrops.has(crop.id)) crop.kind = 'rice';
    else {
      crop.planted = true;
      crop.growth = GROWTH[crop.z - 134];
    }
  }
  for (const zone of fixture.zones) if (starterZones.has(zone.id)) zone.crop = 'rice';
  fixture.resources.riceSeed = 2;
  await page.evaluate(({ key, value }) => localStorage.setItem(key, value), {
    key: SAVE, value: JSON.stringify({ version: 2, voxel: world.serialize(), colony: fixture }),
  });
  await play.reload();
  const viewCrops = async () => {
    await play.keyboard.press('KeyF');
    await play.keyboard.hold('KeyQ', s => s.camera.yaw < .04, { read: READ });
    await play.keyboard.hold('KeyA', s => s.camera.target[0] < 124.7, { read: READ });
    await play.keyboard.hold('KeyS', s => s.camera.target[2] >= 133.5, { read: READ });
    await play.mouse.move([.59, .59]);
    for (let i = 0; i < 5 && (await read()).camera.distance > 15.1; i++) {
      await page.mouse.wheel(0, -240);
      await advance(.2);
    }
    await play.mouse.move([.91, .83]);
    await advance(23);
  };

  await play.step('七种作物各显示三个阶段', async () => {
    const state = await wait(s => s.seed === world.seed && s.colony?.zones.length === fixture.zones.length && s.colony?.speed === 0);
    assert.equal(state.crop, 'cabbage');
    assert.ok(state.colony.crops.filter(crop => starterCrops.has(crop.id)).every(crop => crop.kind === 'cabbage'));
    assert.ok(state.colony.zones.filter(zone => starterZones.has(zone.id)).every(zone => zone.crop === 'cabbage'));
    assert.equal(Object.hasOwn(state.colony.resources, 'riceSeed'), false);
    for (const kind of CROP_KINDS) {
      const crops = state.colony.crops.filter(crop => crop.kind === kind && !starterCrops.has(crop.id));
      assert.equal(crops.length, 3);
      assert.ok(crops.every(crop => crop.planted));
      assert.deepEqual(crops.map(crop => crop.growth), GROWTH);
    }
    await viewCrops();
    await capture('seven-crops-three-stages');
    await page.mouse.move(940, 370);
    await page.mouse.down({ button: 'middle' });
    await page.mouse.move(940, 287, { steps: 8 });
    await page.mouse.up({ button: 'middle' });
    await advance(.2);
    await capture('crop-roots-meet-soil');
  });

  await play.step('仓库显示正式图标并保留已迁移的种子', async () => {
    const state = await read();
    for (const seed of CROP_SEEDS) assert.equal(state.colony.resources[seed], seed === 'cabbageSeed' ? 11 : 9);
    await control('menu-warehouse').click();
    const chooseCategory = async category => {
      await page.locator('#workspace .wh-cat-trigger').click();
      await page.locator(`#workspace [data-cat="${category}"]`).click();
    };
    await chooseCategory('crop');
    for (const crop of CROP_TYPES) {
      const icon = page.locator(`#workspace [data-item="${crop}"] img`);
      assert.ok(await icon.evaluate(async image => { await image.decode(); return image.naturalWidth > 0; }));
    }
    await capture('warehouse-official-crop-icons');
    await chooseCategory('dish');
    for (const dish of DISH_TYPES) {
      const icon = page.locator(`#workspace [data-item="${dish}"] img`);
      assert.ok(await icon.evaluate(async image => { await image.decode(); return image.naturalWidth > 0; }), dish);
    }
    await capture('warehouse-official-dish-icons');
    await chooseCategory('seed');
    for (const seed of CROP_SEEDS) {
      const slot = page.locator(`#workspace [data-item="${seed}"] .wh-count`);
      assert.equal(await slot.textContent(), seed === 'cabbageSeed' ? '11' : '9');
    }
    assert.equal(await page.locator('#workspace [data-item="riceSeed"]').count(), 0);
    await capture('warehouse-seeds-after-rice-migration');
    await page.locator('#panel-close').click();
  });

  await play.step('快捷栏切换手持图并观察三种掉落物旋转和漂浮', async () => {
    await possessResident(play, inspecting.id);
    await play.keyboard.press('KeyF');
    await play.mouse.move([.62, .4]);
    await page.mouse.wheel(0, -240);
    await advance(.2);
    await page.mouse.move(760, 270);
    await page.mouse.down({ button: 'middle' });
    await page.mouse.move(760, 370, { steps: 8 });
    await page.mouse.up({ button: 'middle' });
    await play.mouse.move([.91, .8]);
    await play.keyboard.press('Digit4');
    await wait(s => s.player?.bagSelected === 3 && s.player.bag[3]?.resource === 'tomato');
    assert.ok(await page.locator('#hotbar [data-item="tomato"] img').evaluate(async icon => {
      await icon.decode();
      return icon.naturalWidth > 0;
    }));
    await capture('held-tomato-and-floating-drops-a');
    await advance(.9);
    await capture('rotated-and-bobbing-drops-b');
    await play.keyboard.press('Digit5');
    const swapped = await wait(s => s.player?.bagSelected === 4 && s.player.bag[4]?.resource === 'cabbage');
    assert.ok(displayDrops.every(item => swapped.colony.items.some(saved => saved.id === item.id)));
    await capture('held-cabbage');
    await play.keyboard.press('Digit6');
    await wait(s => s.player?.bagSelected === 5 && s.player.bag[5]?.resource === 'friedEgg');
    assert.ok(await page.locator('#hotbar [data-item="friedEgg"] img').evaluate(async icon => {
      await icon.decode();
      return icon.naturalWidth > 0;
    }));
    await capture('hotbar-official-dish-icon');
    await play.keyboard.press('KeyR');
    await wait(s => s.camera.mode === 'god');
    await viewCrops();
  });

  await play.step('在规划中选择番茄并用鼠标划出农田', async () => {
    await control('menu-plan').click();
    for (const kind of CROP_KINDS) assert.ok(await control(`crop-${kind}`).isEnabled());
    assert.equal(await control('crop-rice').count(), 0);
    await capture('farm-planning-without-rice');
    await control('crop-tomato').click();
    await wait(s => s.crop === 'tomato');
    await control('tool-zone-farm').click();
    await wait(s => s.tool === 'zone:farm');
    const close = page.locator('#panel-close');
    if (await close.isVisible()) await close.click();

    const { camera: { eye, target } } = await read();
    const forward = unit(target.map((n, i) => n - eye[i]));
    const right = unit(cross(forward, [0, 1, 0])), up = cross(right, forward);
    const location = [128.5, 6.02, 134.5], relative = location.map((n, i) => n - eye[i]);
    const halfHeight = dot(relative, forward) * Math.tan(Math.PI / 8);
    const { width, height } = page.viewportSize();
    const aim = [.5 + dot(relative, right) * height / (2 * halfHeight * width), .5 - dot(relative, up) / (2 * halfHeight)];
    await play.mouse.move(aim);
    await wait(s => s.hoverCell?.[0] === 128 && s.hoverCell?.[2] === 134);
    await play.mouse.click(aim);
    const planted = await wait(s => s.colony.zones.some(zone => zone.kind === 'farm' && zone.x === 128 && zone.z === 134));
    const zone = planted.colony.zones.find(zone => zone.x === 128 && zone.z === 134);
    assert.deepEqual([zone.crop, zone.w, zone.d], ['tomato', 3, 3]);
    assert.equal(planted.colony.crops.filter(c => c.kind === 'tomato' && c.x >= 128 && c.z >= 134).length, 9);
    await play.keyboard.press('Escape');
    if (await close.isVisible()) await close.click();
    await capture('tomato-farm-planned');
  });

  await play.step('村民收获番茄且存档保留各田块作物', async () => {
    await play.keyboard.press('Digit1');
    await wait(s => s.colony.speed === 1);
    let state = await read();
    for (let i = 0; i < 8 && !state.colony.items.some(item => item.resource === 'tomato'); i++) state = await advance(12);
    assert.ok(state.colony.items.some(item => item.resource === 'tomato' && item.amount >= 6));
    assert.ok(state.colony.items.some(item => item.resource === 'tomatoSeed' && item.amount >= 1));
    for (let i = 0; i < 8 && state.colony.resources.tomatoSeed === 9; i++) state = await advance(10);
    assert.ok(state.colony.resources.tomatoSeed < 9, '村民开始播种时应预留仓库里的番茄种子');

    await capture('tomato-harvest');
    await page.waitForFunction(key => {
      const save = JSON.parse(localStorage.getItem(key) ?? 'null');
      return save?.colony.zones.some(zone => zone.x === 128 && zone.z === 134 && zone.crop === 'tomato')
        && save.colony.items.some(item => item.resource === 'tomato');
    }, SAVE, { timeout: 12000 });
    await play.reload();
    const restored = await wait(s => s.colony.zones.some(zone => zone.x === 128 && zone.z === 134 && zone.crop === 'tomato')
      && s.colony.items.some(item => item.resource === 'tomato'));
    assert.ok(CROP_KINDS.every(kind => restored.colony.crops.some(crop => crop.kind === kind)));
    await viewCrops();
    await capture('crop-varieties-restored');
  });
}
