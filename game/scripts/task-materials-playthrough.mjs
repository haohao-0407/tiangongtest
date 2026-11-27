import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tsImport } from 'tsx/esm/api';

export default async function checkTaskMaterials(play) {
  const { ColonySimulation } = await tsImport('../assets/colony/simulation.ts', import.meta.url);
  const { VoxelWorld, BLOCK } = await tsImport('../assets/voxel/model.ts', import.meta.url);
  const world = VoxelWorld.deserialize(JSON.stringify({ version:1, generatorVersion:2, seed:'森屿-缺料账目', size:[48,24,48], edits:[] }));
  const sim = new ColonySimulation(world);
  const file = sim.serialize();
  file.speed = 0;
  file.time = 120;
  file.jobs = [];
  file.crops = [];
  file.zones = file.zones.filter(z => z.kind === 'stockpile');
  file.buildings = file.buildings.filter(b => b.kind === 'stove');
  file.warehouseStacks = [];
  delete file.warehouseLayout;
  for (const item of Object.keys(file.resources)) file.resources[item] = 0;
  Object.assign(file.resources, {wood:1, flour:1, tomato:6});
  const [x,y,z] = file.colonists[0].position;
  file.items = [{id:'qa-floor-flour',resource:'flour',amount:1,x:Math.floor(x),y,z:Math.floor(z),age:10,reservedBy:null}];
  for (const c of file.colonists) {
    c.hunger = c.rest = c.recreation = 100;
    c.schedule = 'day';
    for (const type of Object.keys(c.priorities)) c.priorities[type] = type === 'cook' ? 1 : 0;
  }
  sim.load(file);
  let blueprint;
  for (let z=18;z<31 && !blueprint;z++) for (let x=18;x<31 && !blueprint;x++) {
    const result=sim.command({action:'build',kind:'torch',x,z});
    if(result.ok) blueprint=result.id;
  }
  assert.ok(blueprint);
  const {page} = play, read = 'voxel.world', key = 'homestead.colony.v2';
  const out = 'artifacts/task-materials/';
  mkdirSync(out,{recursive:true});
  const ledger = [];
  const button = id => page.locator('[data-testid="'+id+'"]');
  const click = id => button(id).click({timeout:10000});
  const cstate = async () => (await play.state(read)).colony;
  const wait = fn => play.waitFor(s=>s.colony && fn(s.colony),{read,timeoutMs:15000});
  const close = async () => { if(await page.locator('#panel-close').isVisible()) await page.locator('#panel-close').click(); };
  const row = item => page.locator('#task-materials li[data-material="'+item+'"]');
  const speed = async n => { await button('speed-'+n).evaluate(b=>b.click()); await wait(c=>c.speed===n); };
  const reach = async fn => {
    await speed(1);
    for(let i=0;i<160;i++) {
      const {colony}=await play.advance(.25,{read});
      if(fn(colony)){await speed(0);return;}
    }
    assert.fail('居民未到达验收节点 '+JSON.stringify((await cstate()).jobs));
  };
  const checkpoint = async (name, expected) => {
    // Give the HUD its normal state notification before comparing the DOM with the simulation.
    for (const [item,count] of Object.entries(expected)) {
      if(count) await row(item).locator('b').filter({hasText:new RegExp('^缺 '+count+'$')}).waitFor();
      else await row(item).waitFor({state:'detached'});
    }
    const c=await cstate(), hud=page.locator('#task-materials');
    const visible=Object.values(expected).some(Boolean);
    assert.equal(await hud.isVisible(),visible);
    if(visible){
      const bounds=await hud.boundingBox(), vp=page.viewportSize();
      assert.ok(bounds.x>vp.width*.66 && bounds.y<vp.height*.2);
    }
    assert.equal(c.resources.flour,c.warehouseStacks.filter(s=>s.resource==='flour').reduce((n,s)=>n+s.count,0));
    ledger.push({name,time:c.time,stock:{wood:c.resources.wood,flour:c.resources.flour,tomato:c.resources.tomato},
      flourOnGround:c.items.filter(i=>i.resource==='flour').reduce((n,i)=>n+i.amount,0),
      blueprints:c.buildings.filter(b=>!b.complete).map(({kind,reserved})=>({kind,reserved})),
      orders:c.jobs.filter(j=>j.recipe).map(({id,recipe,craftAmount,reserved})=>({id,recipe,craftAmount,reserved})),
      hud:await hud.locator('li').allTextContents()});
    writeFileSync(out+'ledger.json',JSON.stringify(ledger,null,2));
    await page.screenshot({path:out+name+'.png'});
  };
  await wait(c=>c.colonists.length);
  await page.evaluate(({key,data})=>localStorage.setItem(key,JSON.stringify(data)),{key,data:{version:2,voxel:world.serialize(),colony:sim.serialize()}});
  await play.reload();
  await wait(c=>c.speed===0 && c.resources.wood===1 && c.buildings.some(b=>b.id===blueprint));
  await click('menu-production');
  await click('craft-order-pasta');
  await wait(c=>c.jobs.filter(j=>j.recipe==='pasta').length===1);
  await page.locator('#craft-batch').selectOption('5');
  await click('craft-order-pasta');
  await wait(c=>c.jobs.filter(j=>j.recipe==='pasta').length===2);
  await close();
  await checkpoint('01-orders',{wood:1,flour:5});
  assert.match(await row('flour').textContent(),/地上 1 份.*另缺 4.*面粉机/);
  assert.match(await row('wood').textContent(),/规划 → 伐木/);
  await click('menu-plan');
  await click('tool-chop');
  await play.waitFor(s=>s.tool==='chop',{read});
  assert.equal((await cstate()).jobs.filter(j=>j.type==='chop').length,0);
  await checkpoint('02-chop-tool',{wood:1,flour:5});
  await reach(c=>c.jobs.some(j=>j.recipe==='pasta' && j.reserved.flour===1));
  await checkpoint('03-claimed',{wood:1,flour:5});
  assert.equal((await cstate()).resources.flour,0);
  const claimed=(await cstate()).jobs.find(j=>j.recipe==='pasta' && j.reserved.flour===1).id;
  await page.locator('#save').evaluate(b=>b.click());
  await page.waitForFunction(key=>JSON.parse(localStorage.getItem(key))?.colony?.jobs?.some(j=>j.reserved.flour===1),key);
  await play.reload();
  await wait(c=>c.speed===0 && c.jobs.some(j=>j.id===claimed && j.reserved.flour===1));
  await checkpoint('04-reload',{wood:1,flour:5});
  await click('menu-production');
  await click('craft-cancel-'+claimed);
  await wait(c=>c.resources.flour===1 && !c.jobs.some(j=>j.id===claimed));
  await close();
  await checkpoint('05-refund',{wood:1,flour:4});
  await click('menu-work');
  await click('priority-'+(await cstate()).colonists[0].id+'-haul');
  await close();
  await reach(c=>c.resources.flour===2);
  await checkpoint('06-restocked',{wood:1,flour:3});
  assert.doesNotMatch(await row('flour').textContent(),/地上/);
  await click('menu-production');
  await click('craft-cancel-'+(await cstate()).jobs.find(j=>j.recipe==='pasta').id);
  await close();
  await checkpoint('07-cancel',{wood:1,flour:0});
  await click('menu-build');
  await click('building-cancel-'+blueprint);
  await close();
  await checkpoint('08-clear',{wood:0,flour:0});

  // A stone station and a separate iron requirement exercise the real task-18 projection.
  // Prepare a second paused camp, then observe it through the same normal load entry point.
  const miningFile = structuredClone(file);
  miningFile.resources.wood = 30;
  miningFile.resources.stoneBrick = 10;
  miningFile.items = [];
  for (const resident of miningFile.colonists) {
    resident.bag = resident.bag.map(slot=>slot?.resource==='pickaxe' ? null : slot);
    resident.priorities.mine = 1;
    resident.priorities.construct = 1;
  }
  const mining = new ColonySimulation(world);
  mining.load(miningFile);
  const place = kind => {
    for (let z=19;z<30;z++) for (let x=19;x<30;x++) {
      const y=world.terrainHeight(x,z);
      if (kind==='extractionStation') {
        if (y<2 || mining.snapshot().buildings.some(b=>x>=b.x&&x<b.x+b.w&&z>=b.z&&z<b.z+b.d)) continue;
        world.set(x,y-1,z,BLOCK.StoneDeposit);
      }
      const result=mining.command({action:'build',kind,x,z});
      if (result.ok) return result.id;
    }
    assert.fail('找不到验收建筑位置 '+kind);
  };
  place('campfire');
  place('forgery');
  const loadMining = async () => {
    await page.evaluate(({key,data})=>localStorage.setItem(key,JSON.stringify(data)),{key,data:{version:2,voxel:world.serialize(),colony:mining.serialize()}});
    await play.reload();
    await wait(c=>c.speed===0 && c.buildings.some(b=>b.kind==='forgery'));
  };
  await loadMining();
  await checkpoint('09-deposit-sites',{stone:4,pigIron:12});
  assert.match(await row('stone').textContent(),/在石料点放置采集站/);
  assert.match(await row('pigIron').textContent(),/在铁矿点放置采集站/);
  const station=place('extractionStation');
  const withStation=mining.serialize();
  const b=withStation.buildings.find(b=>b.id===station);
  b.complete=true; b.progress=1; b.phase='completed'; b.reserved={};
  withStation.jobs=withStation.jobs.filter(j=>j.targetId!==station);
  withStation.items.push({id:'qa-loose-stone',resource:'stone',amount:2,x:Math.floor(x),y,z:Math.floor(z),age:10,reservedBy:null});
  mining.load(withStation);
  await loadMining();
  await checkpoint('10-pickaxe-haul',{stone:4,pigIron:12});
  assert.match(await row('stone').textContent(),/地上 2 份.*另缺 2.*石镐/);
  assert.match(await row('pigIron').textContent(),/铁矿点放置采集站/);
}
