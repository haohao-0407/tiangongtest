import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tsImport } from 'tsx/esm/api';
import { createFacadeTerrainFixture } from './facade-playthrough.mjs';
import { returnToMap } from './return-to-map.mjs';

export default async function orePlaythrough(play) {
  const {VoxelWorld,BLOCK}=await tsImport('../assets/voxel/model.ts',import.meta.url);
  const {ColonySimulation}=await tsImport('../assets/colony/simulation.ts',import.meta.url);
  const world=VoxelWorld.deserialize(createFacadeTerrainFixture());
  const sites=[[16,20,BLOCK.StoneDeposit,'stone',24],[21,17,BLOCK.SteelOre,'pigIron',18]];
  for(const [x,z,block] of sites)world.set(x,4,z,block);
  const sim=new ColonySimulation(world),opening=sim.serialize();
  opening.speed=0;opening.time=325;opening.crops=[];opening.items=[];opening.jobs=[];
  opening.buildings=opening.buildings.filter(b=>b.kind==='chest');
  opening.zones=opening.zones.filter(z=>z.kind==='stockpile');
  opening.warehouseStacks=[];delete opening.warehouseLayout;
  for(const key of Object.keys(opening.resources))opening.resources[key]=0;
  opening.resources.wood=24;opening.resources.medicine=12;opening.resources.meal=14;
  for(const [i,c] of opening.colonists.entries()){
    c.schedule='night';c.hunger=c.rest=c.recreation=100;
    for(const key of Object.keys(c.priorities))c.priorities[key]=key==='construct'||(key==='mine'&&i!==0)||(key==='doctor'&&i===2)?1:0;
  }
  sim.load(opening);
  const read='voxel.world',saveKey='homestead.colony.v2',page=play.page;
  const state=()=>play.state(read), advance=t=>play.advance(t,{read,stepSeconds:.1});
  const wait=p=>play.waitFor(p,{read,timeoutMs:15000});
  const button=id=>page.locator('[data-testid="'+id+'"]');
  const speed=async n=>{await button('speed-'+n).evaluate(b=>b.click());await wait(s=>s.colony.speed===n);};
  const close=async()=>{for(const id of ['panel-close','inspector-close'])if(await page.locator('#'+id).isVisible())await page.locator('#'+id).click();};
  const stations=c=>c.buildings.filter(b=>b.kind==='extractionStation');
  const station=(c,r)=>stations(c).find(b=>b.mining?.resource===r);
  const out='docs/extraction-station-18-qa/',records=[];
  mkdirSync(out,{recursive:true});
  async function frame(name){
    const s=await state(),c=s.colony;
    records.push({name,day:c.day,time:c.time,wood:c.resources.wood,stone:c.resources.stone,pigIron:c.resources.pigIron,
      stations:stations(c).map(b=>({id:b.id,x:b.x,z:b.z,complete:b.complete,...b.mining})),
      jobs:c.jobs.filter(j=>j.type==='mine'||j.type==='haul'),items:c.items,
      people:c.colonists.map(({name,task,position,bag,carrying})=>({name,task,position,bag,carrying}))});
    writeFileSync(out+'inventory.json',JSON.stringify(records,null,2));
    await page.screenshot({path:out+name+'.png',timeout:20000});
  }
  async function reach(predicate,step=.6){
    await speed(1);
    for(let i=0;i<250;i++)if(predicate((await advance(step)).colony)){await speed(0);return;}
    const c=(await state()).colony;
    assert.fail(JSON.stringify({stations:stations(c),jobs:c.jobs,people:c.colonists.map(p=>[p.name,p.task,p.position]),items:c.items}));
  }
  const dot=(a,b)=>a.reduce((sum,v,i)=>sum+v*b[i],0);
  const unit=v=>v.map(n=>n/Math.hypot(...v));
  const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  async function hover(x,z,y,u=.5,w=.5){
    const {camera}=await state(),forward=unit(camera.target.map((v,i)=>v-camera.eye[i]));
    const right=unit(cross(forward,[0,1,0])),up=cross(right,forward);
    const v=[x+u,y,z+w].map((n,i)=>n-camera.eye[i]),h=Math.tan(Math.PI/8)*dot(v,forward);
    const {width,height}=page.viewportSize(),p=[.5+dot(v,right)/(2*h*width/height),.5-dot(v,up)/(2*h)];
    await play.mouse.move(p);const s=await advance(.12);
    assert.deepEqual([s.hoverCell?.[0],s.hoverCell?.[2]],[x,z],JSON.stringify({p,camera,hover:s.hoverCell,tool:s.tool}));
    return p;
  }
  async function build(site,mark){
    await returnToMap(play);await button('menu-build').click();
    await button('build-extractionStation').click();await wait(s=>s.tool==='build:extractionStation');
    const [x,z,,r,cap]=site,p=await hover(x,z,5.01);
    if(mark){assert.match((await state()).depositHint,new RegExp('剩余 '+cap));await frame(mark);}
    await play.mouse.click(p);await wait(s=>station(s.colony,r));await close();
  }
  async function inspect(site){
    await returnToMap(play);
    for(const [u,w] of [[.5,.5],[.22,.75],[.78,.22],[.23,.22],[.78,.78]]){
      await play.mouse.click(await hover(site[0],site[1],5.95,u,w));
      await advance(.1);
      if(await button('extraction-station-status').isVisible())return;
      await close();
    }
    assert.fail('点击站体后未打开采集站面板');
  }
  async function reload(){
    const expected=(await state()).colony;
    await page.locator('#save').evaluate(b=>b.click());
    await page.waitForFunction(({key,time,ids})=>{
      const saved=JSON.parse(localStorage.getItem(key))?.colony;
      return saved?.speed===0 && saved.time===time && ids.every(id=>saved.buildings.some(b=>b.id===id));
    },{key:saveKey,time:expected.time,ids:stations(expected).map(b=>b.id)},{timeout:15000});
    await play.reload();await wait(s=>s.colony?.speed===0 && stations(s.colony).length===2);
  }
  await wait(s=>s.colony?.colonists?.length);
  await page.evaluate(({key,file})=>localStorage.setItem(key,JSON.stringify(file)),{key:saveKey,file:{version:2,voxel:world.serialize(),colony:sim.serialize()}});
  await play.reload();await wait(s=>s.colony?.speed===0 && s.colony.resources.wood===24);
  await button('menu-plan').click();assert.equal(await button('tool-mine').count(),0);await frame('01-planning');await close();
  await build(sites[0],'02-stone-site');await build(sites[1],'03-iron-site');
  assert.equal((await state()).colony.jobs.filter(j=>j.type==='mine').length,0);await frame('04-blueprints');
  await reach(c=>stations(c).every(b=>b.complete));
  await inspect(sites[0]);assert.match(await button('extraction-station-status').textContent(),/等待可用石镐/);
  await frame('05-wait-for-tool');await close();
  await button('menu-work').click();const people=(await state()).colony.colonists;
  await button('priority-'+people[0].id+'-mine').click();await close();
  for(let n=0;n<2;n++){
    const tracked=new Set(records.filter(r=>r.name.startsWith('06-miner-')).map(r=>r.name.slice(9)));
    const working=c=>c.jobs.find(j=>j.type==='mine'&&j.progress>0 && !tracked.has(stationResource(c,j)));
    function stationResource(c,j){return stations(c).find(b=>b.id===j.targetId)?.mining.resource;}
    await reach(c=>!!working(c));
    const c=(await state()).colony,j=working(c),resource=stationResource(c,j),worker=c.colonists.find(p=>p.id===j.assignedTo);
    assert.ok(worker.bag.some(s=>s?.resource==='pickaxe'));assert.equal(Math.abs(Math.floor(worker.position[0])-j.x)+Math.abs(Math.floor(worker.position[2])-j.z),1);
    await frame('06-miner-'+resource);
    if(!n){
      await reach(c=>c.items.some(i=>i.resource===resource));
      const c=(await state()).colony;assert.equal(c.resources[resource],0);assert.equal(station(c,resource).mining.remaining,sites.find(s=>s[3]===resource)[4]-3);
      await frame('07-first-drop');
      await button('menu-work').click();await button('priority-'+people[1].id+'-haul').click();await close();
      await reach(c=>c.colonists.some(p=>p.carrying[resource]>0),.25);
      await frame('08-in-transit');await reload();await frame('09-reloaded-cargo');
      const restored=(await state()).colony;assert.ok(restored.colonists.some(p=>p.carrying[resource]>0));
    }
  }
  await reach(c=>c.resources.stone===24&&c.resources.pigIron===18,1.5);
  let c=(await state()).colony;assert.ok(c.day>=2);assert.equal(c.jobs.filter(j=>j.type==='mine').length,0);
  await inspect(sites[0]);assert.match(await button('extraction-station-status').textContent(),/剩余 0 · 已采尽/);
  await frame('10-exhausted-stock');const old=station(c,'stone').id;await button('building-demolish').click();await close();
  await reach(c=>!c.buildings.some(b=>b.id===old));await frame('11-dismantled');
  await build(sites[0]);await reach(c=>station(c,'stone')?.complete,3);
  await reload();await inspect(sites[0]);await frame('12-rebuilt-and-reloaded');
  c=(await state()).colony;
  assert.deepEqual(stations(c).map(b=>b.mining.remaining),[0,0]);assert.equal(c.jobs.some(j=>j.type==='mine'),false);
  assert.deepEqual([c.resources.stone,c.resources.pigIron],[24,18]);
}
