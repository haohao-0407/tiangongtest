import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tsImport } from 'tsx/esm/api';
import { createFacadeTerrainFixture } from './facade-playthrough.mjs';

export default async function flourMillPlaythrough(play) {
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
  Object.assign(save.resources, { wood: 10, stone: 8, wheat: 2, tomato: 1 });
  for (const c of save.colonists) {
    c.hunger = c.rest = c.recreation = 100;
    c.schedule = 'day';
    for (const job of Object.keys(c.priorities)) c.priorities[job] = ['construct','craft','cook','terraform'].includes(job) ? 1 : 0;
  }
  sim.load(save);

  const out = 'artifacts/flour-mill/';
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
  const mill = c => c.buildings.find(b => b.kind === 'flourMill');
  async function reach(predicate, step = .5) {
    await speed(1);
    for (let i=0; i<160; i++) {
      const {colony} = await play.advance(step, {read,stepSeconds:.1});
      if (predicate(colony)) { await speed(0); return; }
    }
    const c = await state();
    assert.fail(JSON.stringify({jobs:c.jobs,people:c.colonists.map(p=>p.task),mill:mill(c)}));
  }
  async function frame(name) {
    const c = await state();
    assert.equal(c.power.generation, 0);
    assert.equal(c.power.stored, 0);
    assert.deepEqual(c.research.completed, []);
    const goods = ['wood','stone','wheat','flour','tomato','pasta'];
    record.push({name,time:c.time,power:c.power,inventory:Object.fromEntries(goods.map(k=>[k,c.resources[k]])),
      stacks:c.warehouseStacks.filter(x=>goods.includes(x.resource)),ground:c.items,orders:c.jobs.filter(j=>j.recipe || j.type==='construct'),
      residents:c.colonists.map(({name,task,position,carrying})=>({name,task,position,carrying})),mill:mill(c)});
    writeFileSync(out+'inventory.json', JSON.stringify(record,null,2));
    await page.screenshot({path:out+name+'.png',timeout:20000});
  }

  await play.waitFor(s=>s.colony?.colonists.length,{read});
  const key = 'homestead.colony.v2';
  await page.evaluate(({key,file})=>localStorage.setItem(key,JSON.stringify(file)),
    {key,file:{version:2,voxel:world.serialize(),colony:sim.serialize()}});
  await play.reload();
  await wait(c=>c?.speed===0 && c.resources.flour===0 && c.resources.wood===10);
  await click('menu-build');
  const card = button('build-flourMill');
  assert.match(await card.textContent(),/2 × 1/);
  await card.scrollIntoViewIfNeeded();
  await frame('01-menu');
  await card.click();
  await play.waitFor(s=>s.tool==='build:flourMill',{read});
  for (const point of [[.55,.50],[.54,.44],[.47,.43],[.58,.58],[.62,.45],[.63,.54]]) {
    await play.mouse.move(point);
    const s = await play.advance(.15,{read});
    if (!s.placementPreview || s.hoverBuildingId) continue;
    await play.mouse.click(point);
    await play.advance(.15,{read});
    if (mill(await state())) break;
  }
  await wait(c=>mill(c));
  assert.equal(mill(await state()).w,2);
  await close();
  await frame('02-blueprint');
  await reach(c=>mill(c).complete);
  let c = await state();
  assert.equal(c.resources.wood,0);
  assert.equal(c.resources.stone,0);
  await frame('03-built');
  await click('menu-production');
  await page.locator('#craft-batch').selectOption('5');
  await click('craft-order-flour');
  c = (await wait(c=>job(c,'flour')?.state==='blocked')).colony;
  assert.match(job(c,'flour').label,/缺少小麦 × 8/);
  const orderRow = id => button('craft-order-'+id);
  await orderRow(job(c,'flour').id).scrollIntoViewIfNeeded();
  assert.match(await orderRow(job(c,'flour').id).textContent(),/缺少小麦 × 8/);
  await frame('04-shortage');
  await click('craft-cancel-'+job(c,'flour').id);
  await wait(c=>!job(c,'flour') && c.resources.wheat===2);
  await page.locator('#craft-batch').selectOption('1');
  await click('craft-order-flour');
  await reach(c=>job(c,'flour')?.reserved.wheat===2,.25);
  c = await state();
  assert.equal(c.resources.wheat,0);
  const id = job(c,'flour').id;
  await orderRow(id).scrollIntoViewIfNeeded();
  await frame('05-reserved');
  await click('craft-cancel-'+id);
  await wait(c=>!job(c,'flour') && c.resources.wheat===2 && c.resources.flour===0);
  await button('craft-order-flour').scrollIntoViewIfNeeded();
  await frame('06-refunded');
  await click('craft-order-flour');
  await reach(c=>job(c,'flour')?.progress>0,.25);
  c = await state();
  assert.equal(job(c,'flour').work,5);
  assert.equal(job(c,'flour').targetId,mill(c).id);
  await orderRow(job(c,'flour').id).scrollIntoViewIfNeeded();
  await frame('07-grinding');
  await close();
  await reach(c=>c.items.some(i=>i.resource==='flour'));
  c = await state();
  const drop = c.items.find(i=>i.resource==='flour');
  const b = mill(c);
  assert.equal(drop.amount,1);
  assert.equal(Math.max(b.x-drop.x,0,drop.x-(b.x+b.w-1))+Math.max(b.z-drop.z,0,drop.z-(b.z+b.d-1)),1);
  assert.equal(c.resources.flour,0);
  await frame('08-flour-ground');
  await click('menu-work');
  await click('priority-'+c.colonists[0].id+'-haul');
  await close();
  await reach(c=>c.resources.flour===1);
  await click('menu-warehouse');
  await page.locator('#workspace .wh-search').fill('面粉');
  await page.locator('#workspace .wh-cell[data-item="flour"]').waitFor();
  await frame('09-flour-stock');
  await close();
  await click('menu-production');
  await click('craft-order-pasta');
  await reach(c=>job(c,'pasta')?.reserved.flour===1,.25);
  c = await state();
  assert.equal(job(c,'pasta').reserved.tomato,1);
  assert.equal(c.buildings.find(b=>b.id===job(c,'pasta').targetId).kind,'stove');
  await orderRow(job(c,'pasta').id).scrollIntoViewIfNeeded();
  await frame('10-stove');
  await close();
  await reach(c=>c.resources.pasta===1);
  await click('menu-warehouse');
  await page.locator('#workspace .wh-search').fill('意大利面');
  await page.locator('#workspace .wh-cell[data-item="pasta"]').waitFor();
  c = await state();
  assert.deepEqual([c.resources.wheat,c.resources.flour,c.resources.tomato,c.resources.pasta],[0,0,0,1]);
  await frame('11-pasta-stock');
  await close();
  await page.waitForFunction(key=>JSON.parse(localStorage.getItem(key))?.colony?.resources.pasta===1,key,{timeout:15000});
  await play.reload();
  await wait(c=>c?.resources.pasta===1 && mill(c)?.complete);
  await frame('12-reloaded');
}
