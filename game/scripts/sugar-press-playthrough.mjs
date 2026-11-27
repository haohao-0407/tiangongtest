import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tsImport } from 'tsx/esm/api';
import { createFacadeTerrainFixture } from './facade-playthrough.mjs';

export default async function sugarPressPlaythrough(play) {
  const { ColonySimulation } = await tsImport('../assets/colony/simulation.ts', import.meta.url);
  const { VoxelWorld } = await tsImport('../assets/voxel/model.ts', import.meta.url);
  const world = VoxelWorld.deserialize(createFacadeTerrainFixture());
  const sim = new ColonySimulation(world);
  const save = sim.serialize();
  save.speed = 0;
  save.time = 120;
  save.items = [];
  save.jobs = [];
  save.crops = [];
  save.zones = save.zones.filter(z => z.kind === 'stockpile');
  save.buildings = save.buildings.filter(b => b.kind === 'stove');
  save.warehouseStacks = [];
  delete save.warehouseLayout; // Repack the fixture's opening balances into real warehouse slots on load.
  for (const key of Object.keys(save.resources)) save.resources[key] = 0;
  Object.assign(save.resources, { wood: 12, stone: 8, sugarcane: 2, blueberry: 1, flour: 1, egg: 1 });
  for (const c of save.colonists) {
    c.hunger = c.rest = c.recreation = 100;
    c.schedule = 'day';
    for (const job of Object.keys(c.priorities)) c.priorities[job] = ['construct','craft','cook','terraform'].includes(job) ? 1 : 0;
  }
  sim.load(save);

  const out = 'artifacts/sugar-press/';
  mkdirSync(out, { recursive: true });
  const record = [];
  const read = 'voxel.world';
  const { page } = play;
  const state = async () => (await play.state(read)).colony;
  const wait = pred => play.waitFor(s => pred(s.colony), { read, timeoutMs: 15000 });
  const button = id => page.locator('[data-testid="' + id + '"]');
  const click = id => button(id).click({timeout:10000});
  const close = async () => { if (await page.locator('#panel-close').isVisible()) await page.locator('#panel-close').click(); };
  // The compact HUD hides the time bar. Its normal button handler controls the test clock.
  const speed = async n => {
    await button('speed-'+n).evaluate(b=>b.click());
    await wait(c=>c.speed===n);
  };
  const job = (c, recipe) => c.jobs.find(j => j.recipe === recipe);
  const press = c => c.buildings.find(b => b.kind === 'sugarPress');
  async function reach(predicate, step = .5) {
    await speed(1);
    for (let i=0; i<160; i++) {
      const {colony} = await play.advance(step, {read,stepSeconds:.1});
      if (predicate(colony)) { await speed(0); return; }
    }
    const c = await state();
    assert.fail(JSON.stringify({jobs:c.jobs,people:c.colonists.map(p=>p.task),press:press(c)}));
  }
  async function frame(name) {
    const c = await state();
    assert.equal(c.power.generation, 0);
    assert.equal(c.power.stored, 0);
    assert.deepEqual(c.research.completed, []);
    const goods = ['wood','stone','sugarcane','sugar','blueberry','flour','egg','blueberryPie'];
    record.push({name,time:c.time,power:c.power,inventory:Object.fromEntries(goods.map(k=>[k,c.resources[k]])),
      stacks:c.warehouseStacks.filter(x=>goods.includes(x.resource)),ground:c.items,orders:c.jobs.filter(j=>j.recipe || j.type==='construct'),
      residents:c.colonists.map(({name,task,position,carrying})=>({name,task,position,carrying})),press:press(c)});
    writeFileSync(out+'inventory.json', JSON.stringify(record,null,2));
    await page.screenshot({path:out+name+'.png',timeout:20000});
  }

  await play.waitFor(s=>s.colony?.colonists.length,{read});
  const key = 'homestead.colony.v2';
  await page.evaluate(({key,file})=>localStorage.setItem(key,JSON.stringify(file)),
    {key,file:{version:2,voxel:world.serialize(),colony:sim.serialize()}});
  await play.reload();
  await wait(c=>c?.speed===0 && c.resources.sugar===0 && c.resources.wood===12);
  await click('menu-build');
  const card = button('build-sugarPress');
  assert.match(await card.textContent(),/2 × 1/);
  await card.scrollIntoViewIfNeeded();
  await frame('01-menu');
  await card.click();
  await play.waitFor(s=>s.tool==='build:sugarPress',{read});
  for (const point of [[.55,.50],[.54,.44],[.47,.43],[.58,.58],[.62,.45],[.63,.54]]) {
    await play.mouse.move(point);
    const s = await play.advance(.15,{read});
    if (!s.placementPreview || s.hoverBuildingId) continue;
    await play.mouse.click(point);
    await play.advance(.15,{read});
    if (press(await state())) break;
  }
  await wait(c=>press(c));
  assert.equal(press(await state()).w,2);
  await close();
  await frame('02-blueprint');
  await reach(c=>press(c).complete);
  let c = await state();
  assert.equal(c.resources.wood,0);
  assert.equal(c.resources.stone,0);
  await frame('03-built');
  await click('menu-production');
  await page.locator('#craft-batch').selectOption('5');
  await click('craft-order-sugar');
  c = (await wait(c=>job(c,'sugar')?.state==='blocked')).colony;
  assert.match(job(c,'sugar').label,/缺少甘蔗 × 8/);
  const orderRow = id => button('craft-order-'+id);
  await orderRow(job(c,'sugar').id).scrollIntoViewIfNeeded();
  assert.match(await orderRow(job(c,'sugar').id).textContent(),/缺少甘蔗 × 8/);
  await frame('04-shortage');
  await click('craft-cancel-'+job(c,'sugar').id);
  await wait(c=>!job(c,'sugar') && c.resources.sugarcane===2);
  await page.locator('#craft-batch').selectOption('1');
  await click('craft-order-sugar');
  await reach(c=>job(c,'sugar')?.reserved.sugarcane===2,.25);
  c = await state();
  assert.equal(c.resources.sugarcane,0);
  const id = job(c,'sugar').id;
  await orderRow(id).scrollIntoViewIfNeeded();
  await frame('05-reserved');
  await click('craft-cancel-'+id);
  await wait(c=>!job(c,'sugar') && c.resources.sugarcane===2 && c.resources.sugar===0);
  await button('craft-order-sugar').scrollIntoViewIfNeeded();
  await frame('06-refunded');
  await click('craft-order-sugar');
  await reach(c=>job(c,'sugar')?.progress>0,.25);
  c = await state();
  assert.equal(job(c,'sugar').work,6);
  assert.equal(job(c,'sugar').targetId,press(c).id);
  await orderRow(job(c,'sugar').id).scrollIntoViewIfNeeded();
  await frame('07-pressing');
  await close();
  await reach(c=>c.items.some(i=>i.resource==='sugar'));
  c = await state();
  const drop = c.items.find(i=>i.resource==='sugar');
  const b = press(c);
  assert.equal(drop.amount,1);
  assert.equal(Math.max(b.x-drop.x,0,drop.x-(b.x+b.w-1))+Math.max(b.z-drop.z,0,drop.z-(b.z+b.d-1)),1);
  assert.equal(c.resources.sugar,0);
  await frame('08-sugar-ground');
  await click('menu-work');
  await click('priority-'+c.colonists[0].id+'-haul');
  await close();
  await reach(c=>c.resources.sugar===1);
  await click('menu-warehouse');
  await page.locator('#workspace .wh-search').fill('糖');
  await page.locator('#workspace .wh-cell[data-item="sugar"]').waitFor();
  await frame('09-sugar-stock');
  await close();
  await click('menu-production');
  await click('craft-order-blueberryPie');
  await reach(c=>job(c,'blueberryPie')?.reserved.sugar===1,.25);
  c = await state();
  assert.deepEqual(job(c,'blueberryPie').reserved,{blueberry:1, flour:1, sugar:1, egg:1});
  assert.equal(c.buildings.find(b=>b.id===job(c,'blueberryPie').targetId).kind,'stove');
  await orderRow(job(c,'blueberryPie').id).scrollIntoViewIfNeeded();
  await frame('10-stove');
  await close();
  await reach(c=>c.resources.blueberryPie===1);
  await click('menu-warehouse');
  await page.locator('#workspace .wh-search').fill('蓝莓千层酥');
  await page.locator('#workspace .wh-cell[data-item="blueberryPie"]').waitFor();
  c = await state();
  assert.deepEqual([c.resources.sugarcane,c.resources.sugar,c.resources.blueberry,c.resources.flour,c.resources.egg,c.resources.blueberryPie],[0,0,0,0,0,1]);
  await frame('11-blueberryPie-stock');
  await close();
  await page.waitForFunction(key=>JSON.parse(localStorage.getItem(key))?.colony?.resources.blueberryPie===1,key,{timeout:15000});
  await play.reload();
  await wait(c=>c?.resources.blueberryPie===1 && press(c)?.complete);
  const restored = await state();
  assert.deepEqual(restored.resources,c.resources);
  assert.deepEqual(restored.warehouseStacks,c.warehouseStacks);
  await click('menu-warehouse');
  await page.locator('#workspace .wh-search').fill('蓝莓千层酥');
  await page.locator('#workspace .wh-cell[data-item="blueberryPie"]').waitFor();
  await frame('12-reloaded');
}
