import assert from 'node:assert/strict';
import { tsImport } from 'tsx/esm/api';
import { createFacadeTerrainFixture } from './facade-playthrough.mjs';

const READ = 'voxel.world';
const SAVE = 'homestead.colony.v2';

export default async function craftingPlaythrough(play) {
  const { ColonySimulation } = await tsImport('../assets/colony/simulation.ts', import.meta.url);
  const { VoxelWorld } = await tsImport('../assets/voxel/model.ts', import.meta.url);
  const { buildingDimensions } = await tsImport('../assets/colony/buildings.ts', import.meta.url);
  const world = VoxelWorld.deserialize(createFacadeTerrainFixture());
  const sim = new ColonySimulation(world);
  const colony = sim.serialize();
  const stations = [
    ['carpenterBench', 17, 20],
    ['stoneCutter', 21, 20],
    ['forgery', 25, 20],
    ['stove', 25, 24],
  ];
  colony.speed = 0;
  colony.time = 120;
  colony.jobs = [];
  colony.items = [];
  colony.crops = [];
  colony.resources.pigIron = 8;
  colony.resources.wheat = 0;
  colony.zones = [{
    id: 'craft-stockpile', kind: 'stockpile', x: 18, y: world.terrainHeight(18, 25), z: 25, w: 3, d: 3, crop: 'cabbage',
  }];
  colony.buildings = stations.map(([kind, x, z]) => ({
    id: kind, kind, x, y: world.terrainHeight(x, z), z, ...buildingDimensions(kind, 0),
    rotation: 0, phase: 'completed', complete: true, progress: 1, reserved: {},
    powered: false, comfort: 0, roomId: null,
  }));
  colony.colonists.forEach((c, i) => {
    const x = 17 + i, z = 23;
    c.position = [x + .5, world.terrainHeight(x, z), z + .5];
    c.path = [];
    c.jobId = null;
    c.personal = null;
    c.destination = null;
    c.task = '等待工作';
    c.hunger = c.rest = 100;
    c.schedule = 'day';
    for (const job of Object.keys(c.priorities)) c.priorities[job] = ['construct', 'craft', 'cook'].includes(job) ? 1 : 0;
  });
  sim.load(colony);

  const { page } = play;
  const read = () => play.state(READ);
  const wait = predicate => play.waitFor(predicate, { read: READ, timeoutMs: 12_000 });
  const button = id => page.locator(`[data-testid="${id}"]`);
  const open = () => button('menu-production').click();
  const capture = async name => assert.equal((await play.screenshot(name)).rendered, true);
  const pressOnMap = async (key, speed) => {
    await play.mouse.move([.86, .8]);
    await play.keyboard.press(key);
    await wait(s => s.colony.speed === speed);
  };
  const until = async (predicate, maxSeconds) => {
    let state = await read();
    for (let elapsed = 0; elapsed < maxSeconds && !predicate(state); elapsed += .25) {
      state = await play.advance(.25, { read: READ, stepSeconds: .05 });
    }
    assert.ok(predicate(state), JSON.stringify({
      jobs: state.colony.jobs, residents: state.colony.colonists.map(c => c.task), items: state.colony.items,
    }));
    return state;
  };

  await wait(s => s.colony?.colonists.length > 0);
  await page.evaluate(({ key, fixture }) => localStorage.setItem(key, JSON.stringify(fixture)), {
    key: SAVE, fixture: { version: 2, voxel: world.serialize(), colony: sim.serialize() },
  });
  await play.reload();
  const initial = (await wait(s => s.colony?.buildings.some(b => b.id === 'carpenterBench') && s.colony.speed === 0)).colony;
  let woodOrder;

  await play.step('制作清单、配方与批次下单', async () => {
    await open();
    assert.match(await button('menu-production').textContent(), /制作清单/);
    assert.match(await page.locator('#panel-title').textContent(), /制作清单/);
    for (const recipe of ['sugar', 'flour', 'oil']) assert.ok(await button(`craft-order-${recipe}`).isDisabled());
    await capture('crafting-recipes');
    await page.locator('#craft-batch').selectOption('5');
    await button('craft-order-plank').click();
    await page.locator('#craft-batch').selectOption('1');
    for (const recipe of ['plank', 'stoneBrick', 'steel', 'bread']) await button(`craft-order-${recipe}`).click();
    const queued = (await wait(s => s.colony.jobs.filter(j => j.recipe).length === 5)).colony;
    assert.deepEqual(queued.resources, initial.resources);
    const bread = queued.jobs.find(j => j.recipe === 'bread');
    assert.match(bread.label, /缺少小麦/);
    woodOrder = queued.jobs.find(j => j.recipe === 'plank' && j.craftAmount === 5);
    assert.ok(woodOrder);
    await button(`craft-cancel-${bread.id}`).click();
    await wait(s => !s.colony.jobs.some(j => j.id === bread.id));
    await capture('crafting-queued-orders');
  });

  await play.step('村民到仓储区取料并前往工作站', async () => {
    await pressOnMap('Digit1', 1);
    const pickup = await until(s => s.colony.jobs.some(j => j.id === woodOrder.id && j.assignedTo && j.craftPhase === 'pickup'), 4);
    assert.equal(pickup.colony.resources.wood, initial.resources.wood);
    const crafting = await until(s => s.colony.jobs.some(j => j.id === woodOrder.id && j.progress > 0), 40);
    const order = crafting.colony.jobs.find(j => j.id === woodOrder.id);
    assert.equal(order.craftPhase, 'work');
    assert.equal(order.reserved.wood, 5);
    assert.equal(crafting.colony.resources.wood, initial.resources.wood - 5);
    assert.equal(crafting.colony.jobs.filter(j => j.targetId === 'carpenterBench' && j.assignedTo).length, 1);
    await capture('crafting-resident-progress');
  });

  await play.step('不同工作站产出成品，村民搬回仓储并保持存档', async () => {
    await pressOnMap('Digit3', 6);
    const completed = await until(s => !s.colony.jobs.some(j => j.recipe), 26);
    const totals = completed.colony.items.reduce((sum, item) => {
      sum[item.resource] = (sum[item.resource] ?? 0) + item.amount;
      return sum;
    }, {});
    assert.deepEqual(totals, { plank: 12, stoneBrick: 1, steel: 1 });
    assert.equal(completed.colony.resources.wood, initial.resources.wood - 6);
    assert.equal(completed.colony.resources.stone, initial.resources.stone - 2);
    assert.equal(completed.colony.resources.pigIron, initial.resources.pigIron - 2);
    const firstResident = completed.colony.colonists[0];
    await button('menu-work').click();
    await button(`priority-${firstResident.id}-haul`).click();
    await until(s => s.colony.resources.plank === 12 && s.colony.resources.stoneBrick === 1 &&
      s.colony.resources.steel === initial.resources.steel + 1, 30);
    await page.locator('#panel-close').click();
    await pressOnMap('Escape', 0);
    await page.waitForFunction(key => {
      const saved = JSON.parse(localStorage.getItem(key));
      return saved?.colony?.speed === 0 && saved.colony.resources.plank === 12;
    }, SAVE, { timeout: 12_000 });
    await play.reload();
    await wait(s => s.colony?.speed === 0 && s.colony.resources.plank === 12);
    await open();
    assert.ok(await button('craft-order-plank').isEnabled());
    await capture('crafting-after-reload');
  });
}
