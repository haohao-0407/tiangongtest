import assert from 'node:assert/strict';
import { tsImport } from 'tsx/esm/api';
import { possessResident } from './select-resident.mjs';

const { VoxelWorld } = await tsImport('../assets/voxel/model.ts', import.meta.url);
const { ColonySimulation } = await tsImport('../assets/colony/simulation.ts', import.meta.url);
const READ = 'voxel.world';
const SAVE = 'homestead.colony.v2';

/** @param {import('@forgeax/engine/devkit').PlayContext} play */
export default async function cropCardsProbe(play) {
  const { page } = play;
  const wait = predicate => play.waitFor(predicate, { read: READ, timeoutMs: 12_000 });
  const advance = seconds => play.advance(seconds, { read: READ, stepSeconds: .1 });
  const capture = async name => assert.equal((await play.screenshot(name)).rendered, true);

  const world = new VoxelWorld();
  const fixture = new ColonySimulation(world).serialize();
  fixture.speed = 0;
  fixture.time = 180;
  for (const person of fixture.colonists) {
    person.priorities.grow = 0;
    person.priorities.harvest = 0;
  }
  for (const [index, crop] of fixture.crops.entries()) {
    crop.planted = index !== 8;
    crop.growth = crop.planted ? [.33, .68, .84][index % 3] : 0;
  }
  const farmResident = fixture.colonists[2];
  farmResident.position = [127.5, 6, 134.25];
  const id = fixture.crops[0].id;
  const byId = (state, cropId = id) => state.colony.crops.find(crop => crop.id === cropId);
  const untouched = fixture.crops[8].id;
  await page.evaluate(({ key, value }) => localStorage.setItem(key, value), {
    key: SAVE, value: JSON.stringify({ version: 2, voxel: world.serialize(), colony: fixture }),
  });
  await play.reload();

  const lookAtFarm = async () => {
    await play.keyboard.press('KeyF');
    await play.keyboard.hold('KeyQ', s => s.camera.yaw < .04, { read: READ });
    const plotZ = fixture.crops.reduce((total, crop) => total + crop.z + .5, 0) / fixture.crops.length;
    await play.keyboard.hold('KeyS', s => s.camera.target[2] >= plotZ - 2.2, { read: READ });
    await play.mouse.move([.57, .54]);
    for (let i = 0; i < 5 && (await play.state(READ)).camera.distance > 15.1; i++) {
      await page.mouse.wheel(0, -240);
      await advance(.2);
    }
    await page.mouse.move(770, 385);
    await page.mouse.down({ button: 'middle' });
    await page.mouse.move(770, 310, { steps: 10 });
    await page.mouse.up({ button: 'middle' });
    await play.mouse.move([.92, .82]);
    await advance(.2);
  };

  await play.step('三个生长阶段和未播种的田格', async () => {
    const start = await wait(s => s.seed === world.seed && s.colony?.speed === 0 && byId(s)?.growth === .33);
    assert.equal(start.colony.crops.filter(crop => crop.planted).length, 8);
    assert.equal(byId(start, untouched).planted, false);
    for (const growth of [.33, .68, .84]) assert.ok(start.colony.crops.some(crop => crop.growth === growth));
    await lookAtFarm();
    await advance(24);
    await capture('cabbage-three-stages-and-shadows');
    await page.mouse.wheel(0, 240);
    await advance(.3);
    await capture('cabbage-distant-edges');
    await page.mouse.wheel(0, -240);
    await advance(.3);
  });

  await play.step('角色视角检查透明叶片边缘和阴影', async () => {
    await possessResident(play, farmResident.id);
    await play.keyboard.press('KeyF');
    await play.mouse.move([.62, .4]);
    await page.mouse.wheel(0, -240);
    await advance(.2);
    await page.mouse.move(760, 270);
    await page.mouse.down({ button: 'middle' });
    await page.mouse.move(760, 380, { steps: 10 });
    await page.mouse.up({ button: 'middle' });
    await play.mouse.move([.92, .82]);
    await advance(.3);
    await capture('cabbage-cutout-character-view');
    await play.keyboard.press('KeyR');
    await wait(state => state.camera.mode === 'god');
    await lookAtFarm();
  });

  await play.step('恢复时间后同一株换阶段', async () => {
    await play.keyboard.press('Digit1');
    await wait(s => s.colony.speed === 1);
    const grown = await advance(10);
    assert.ok(byId(grown).growth >= .4 && byId(grown).growth < .75);
    assert.ok(byId(grown, fixture.crops[1].id).growth >= .75);
    await capture('cabbage-growing-and-mature');
  });

  await play.step('重载后按存档进度恢复模型', async () => {
    await page.waitForFunction(({ key, id }) => {
      const save = JSON.parse(localStorage.getItem(key) ?? 'null');
      return save?.colony.crops.find(crop => crop.id === id)?.growth >= .4;
    }, { key: SAVE, id }, { timeout: 12_000 });
    await play.reload();
    const restored = await wait(s => s.seed === world.seed && byId(s)?.growth >= .4);
    assert.equal(byId(restored, untouched).planted, false);
    await lookAtFarm();
    await advance(24);
    await capture('cabbage-stages-restored');
  });
}
