import assert from 'node:assert/strict';
import { tsImport } from 'tsx/esm/api';
import { createFacadeTerrainFixture } from './facade-playthrough.mjs';
import { returnToMap } from './return-to-map.mjs';

export default async function resourceBalance(play) {
  const { VoxelWorld, BLOCK } = await tsImport('../assets/voxel/model.ts', import.meta.url);
  const { ColonySimulation } = await tsImport('../assets/colony/simulation.ts', import.meta.url);
  const terrain = JSON.parse(VoxelWorld.deserialize(createFacadeTerrainFixture()).serialize());
  terrain.trees = [{id:'balance-oak',x:19,y:5,z:17,trunkHeight:4,crownRadius:2,variant:0,rotation:0}];
  const world = VoxelWorld.deserialize(JSON.stringify(terrain));
  world.set(15,4,17,BLOCK.StoneDeposit);
  const sim = new ColonySimulation(world), old = sim.serialize();
  for (const key of ['buildings','items','crops','jobs','terrainPlans','warehouseStacks']) old[key] = [];
  old.zones = old.zones.filter(z=>z.kind==='stockpile');
  delete old.warehouseLayout;
  for (const key of Object.keys(old.resources)) old.resources[key]=0;
  old.resources.wood = 1;
  old.time = 120;
  old.speed = 0;
  old.colonists.forEach((c,i)=>{
    Object.assign(c,{position:[16.5+i,5,16.5],schedule:'day',jobId:null,personal:null,path:[],destination:null,hunger:100,rest:100,recreation:100});
    for(const job of Object.keys(c.priorities)) c.priorities[job] = job===['mine','chop','construct'][i] ? 1 : 0;
  });
  const b = (id,kind,x,z,complete,h,reserved)=>({id,kind,x,y:5,z,w:1,d:1,h,rotation:0,complete,
    phase:complete?'completed':'readyToBuild',progress:complete?1:0,powered:false,comfort:0,roomId:null,reserved});
  old.buildings = [b('old-wall','woodWall',14,16,false,2,{wood:5}), b('stone-station','extractionStation',15,17,true,1,{})];
  sim.load(old);
  const {page}=play, read='voxel.world', key='homestead.colony.v2.manual';
  const state=()=>play.state(read), wait=fn=>play.waitFor(fn,{read,timeoutMs:15000});
  const button=id=>page.locator('[data-testid="'+id+'"]');
  const step=t=>play.advance(t,{read,stepSeconds:.1});
  const capture=async name=>assert.ok((await play.screenshot(name)).rendered);
  const load=async()=>{await page.locator('#load').evaluate(el=>el.click());};
  const dots=(a,b)=>a.reduce((n,v,i)=>n+v*b[i],0);
  const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const unit=v=>v.map(n=>n/Math.hypot(...v));
  async function point(position) {
    const {camera}=await state(), {width,height}=page.viewportSize();
    const forward=unit(camera.target.map((v,i)=>v-camera.eye[i])),right=unit(cross(forward,[0,1,0])),up=cross(right,forward);
    const delta=position.map((v,i)=>v-camera.eye[i]), half=dots(delta,forward)*Math.tan(Math.PI/8);
    return [.5+dots(delta,right)*height/(2*half*width),.5-dots(delta,up)/(2*half)];
  }
  await wait(s=>s.colony?.colonists.length===3);
  await page.evaluate(([key,file])=>localStorage.setItem(key,JSON.stringify(file)),[key,{version:2,voxel:world.serialize(),colony:sim.serialize()}]);
  await load();
  await wait(s=>s.trees.some(t=>t.id==='balance-oak'));
  await play.step('旧墙退款、建造报价和缺料',async()=>{
    await returnToMap(play);
    await button('menu-build').click();
    for (const [id,text] of [['woodWall','木材 2'],['wall','石材 2'],['floor','木材 1'],['stoneDoor','石砖 3 · 石材 1']]) {
      assert.equal(await button('build-'+id).locator('.card-cost').innerText(),text);
    }
    await button('build-woodWall').scrollIntoViewIfNeeded();
    await capture('01-building-costs');
    await button('build-woodWall').click();
    await page.locator('#workspace').waitFor({state:'hidden'});
    const wallPoint=await point([16.5,5.01,19.5]);
    await play.mouse.move(wallPoint);
    await wait(s=>s.hoverCell?.[0]===16 && s.hoverCell[2]===19);
    await play.mouse.click(wallPoint);
    const wall = s=>s.colony.buildings.find(b=>b.x===16 && b.z===19);
    await wait(s=>wall(s)?.blockedReason==='等待建筑材料');
    await page.locator('#task-materials li[data-material="wood"] b').filter({hasText:'缺 1'}).waitFor();
    await capture('02-missing-one-wood');
    await returnToMap(play);await button('menu-build').click();
    await button('building-cancel-old-wall').click();
    await wait(s=>wall(s)?.reserved.wood===2 && s.colony.resources.wood===4);
    await returnToMap(play);
    await capture('03-legacy-refund-new-reservation');
  });
  const loose=(s,r)=>s.colony.items.filter(i=>i.resource===r).reduce((n,i)=>n+i.amount,0);
  const station=s=>s.colony.buildings.find(b=>b.id==='stone-station').mining;
  await play.step('居民伐木、采石和施工',async()=>{
    const p=await point([19.5,9.75,17.5]); await play.mouse.move(p);
    await wait(s=>s.hoverTreeId==='balance-oak');await play.mouse.click(p);
    await button('tree-chop').waitFor();
    assert.match(await button('tree-inspector').innerText(),/产出 12 木材/);
    await capture('04-tree-yield');
    await button('tree-chop').click();await returnToMap(play);
    assert.equal(station(await state()).remaining,12);
    await button('speed-1').evaluate(b=>b.click());await wait(s=>s.colony.speed===1);
    let s=await state();
    for(let i=0;i<120 && loose(s,'stone')===0;i++) s=await step(.5);
    assert.equal(loose(s,'stone'),2);assert.equal(station(s).remaining,10);
    await capture('05-first-stone-batch');
    for(let i=0;i<100 && (loose(s,'wood')!==12 || !s.colony.buildings.find(b=>b.x===16&&b.z===19)?.complete);i++) s=await step(.75);
    assert.equal(loose(s,'wood'),12);assert.equal(s.trees.length,0);assert.equal(s.colony.resources.wood,4);
    assert.ok(s.colony.buildings.find(b=>b.x===16&&b.z===19)?.complete);
    await button('speed-0').evaluate(b=>b.click());await wait(s=>s.colony.speed===0);
    await capture('06-completed-wall-and-harvest');
  });
  await play.step('存读档守恒',async()=>{
    const before=await state();
    await page.locator('#save').evaluate(b=>b.click());
    await page.waitForFunction(key=>JSON.parse(localStorage.getItem(key))?.colony?.buildings.some(b=>b.x===16 && b.z===19 && b.complete),key);
    await load();await wait(s=>s.colony.speed===0 && s.colony.resources.wood===4);
    const after=await state();
    assert.equal(after.trees.length,0);assert.equal(loose(after,'wood'),12);
    assert.equal(station(after).remaining,station(before).remaining);assert.equal(loose(after,'stone'),loose(before,'stone'));
    await capture('07-reloaded-materials');
  });
}
