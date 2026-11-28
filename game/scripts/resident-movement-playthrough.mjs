import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { crowdFixture, checkBodies } from './crowd-fixture.mjs';
import { tsImport } from 'tsx/esm/api';
import { createFacadeTerrainFixture } from './facade-playthrough.mjs';
import { possessResident } from './select-resident.mjs';

const READ = 'voxel.world';
const SAVE = 'homestead.colony.v2';
const distance = (a,b) => Math.hypot(a[0]-b[0],a[2]-b[2]);

export default async function residentMovement(play) {
  const { ColonySimulation, RESIDENT_RADIUS, RESIDENT_HEIGHT } =
    await tsImport('../assets/colony/simulation.ts', import.meta.url);
  const { VoxelWorld } = await tsImport('../assets/voxel/model.ts', import.meta.url);
  const world = VoxelWorld.deserialize(createFacadeTerrainFixture());
  for(const tree of world.getTrees())world.removeTree(tree.id,{recordHistory:false});
  const sim = new ColonySimulation(world);
  const colony = sim.serialize();
  for(const key of ['buildings','crops','items','jobs','zones'])colony[key]=[];
  colony.speed=0;
  const positions=[[18.5,5,18.5],[19.5,5,18.5],[18.5,5,20.5]];
  colony.colonists.forEach((c,i)=>{
    c.position=positions[i];c.facing=0;c.path=[];c.destination=null;c.jobId=null;c.personal=null;
    c.hunger=c.rest=c.recreation=100;c.schedule=i===2?'rest':'day';
  });
  sim.load(colony);

  const { page }=play;
  const wait=predicate=>play.waitFor(predicate,{read:READ,timeoutMs:12000});
  const read=()=>play.state(READ);
  const advance=seconds=>play.advance(seconds,{read:READ,stepSeconds:.05});
  const capture=async name=>assert.equal((await play.screenshot(name)).rendered,true);
  const point=player=>[player.x,player.y,player.z];
  const separation=({colony:{colonists}})=>{
    for(const [i,a] of colonists.entries())for(const b of colonists.slice(i+1)){
      if(Math.abs(a.position[1]-b.position[1])<RESIDENT_HEIGHT-1e-6){
        assert.ok(distance(a.position,b.position)>=RESIDENT_RADIUS*2-1e-6,`${a.name} 与 ${b.name} 相交`);
      }
    }
  };
  const hold=async (key,seconds)=>{
    await page.keyboard.down(key);
    try{return await advance(seconds);}finally{await page.keyboard.up(key);}
  };
  const focusMap=async()=>{
    const inspector=page.locator('#inspector-close');
    if(await inspector.isVisible())await inspector.click();
    await play.mouse.move([.73,.72]);
    await advance(.1);
  };

  await wait(s=>s.colony?.colonists.length===3);
  const readings=[];
  const record=(name,state)=>{
    readings.push({name,time:state.colony.time,player:state.player&&point(state.player),
      people:state.colony.colonists.map(({position,task,jobId})=>({position,task,jobId})),
      buildings:state.colony.buildings.filter(b=>b.kind==='floor').map(({id,complete})=>({id,complete}))});
    mkdirSync('artifacts/crowd-19',{recursive:true});
    writeFileSync('artifacts/crowd-19/readings.json',JSON.stringify(readings,null,2));
  };
  const load=async save=>{
    await page.evaluate(({key,value})=>localStorage.setItem(key,JSON.stringify(value)),{key:SAVE,value:save});
    await play.reload();
    return wait(s=>s.colony?.speed===0 && s.colony.colonists[0].position[0]===save.colony.colonists[0].position[0]
      && s.colony.buildings.length===save.colony.buildings.length);
  };
  const speed=async n=>{
    await page.locator('[data-testid="speed-'+n+'"]').evaluate(b=>b.click());
    await wait(s=>s.colony.speed===n);
  };
  for(const kind of ['open','wall']){
    await play.step(kind==='open'?'附身走过两个相贴的闲置居民':'在床与工作台之间推至墙边，松开后工人返回施工',async()=>{
      const {save,order}=await crowdFixture(kind);
      const initial=await load(save),[first]=initial.colony.colonists;
      await possessResident(play,first.id);
      // Raise the normal follow camera so the beds do not hide the two people.
      const {width,height}=page.viewportSize();
      await page.mouse.move(width*.53,height*.31);
      await page.mouse.down({button:'right'});
      await page.mouse.move(width*.53,height*.72,{steps:10});
      await page.mouse.up({button:'right'});
      await page.mouse.wheel(0,-160);
      await advance(.2);
      await capture(kind+'-before');
      record(kind+'-before',initial);
      await hold('KeyA',1.25);
      const after=await advance(.6);
      checkBodies(after.colony.colonists,after.colony.buildings);
      assert.ok(after.colony.colonists.slice(1).every((p,i)=>distance(p.position,initial.colony.colonists[i+1].position)>.1),JSON.stringify(after.player));
      if(kind==='open')assert.ok(after.player.x>26);
      else assert.ok(after.player.x>24 && after.player.x<25.6);
      const rested=await advance(.8);
      assert.deepEqual(rested.colony.colonists.map(p=>p.position),after.colony.colonists.map(p=>p.position));
      await capture(kind+'-released');record(kind+'-released',rested);
      if(order){
        assert.equal(rested.colony.colonists[1].jobId,order.id);
        await page.keyboard.press('KeyR');await wait(s=>!s.player);
        await speed(1);
        let state=await read();
        for(let i=0;i<80&&!state.colony.buildings.find(b=>b.id===order.targetId)?.complete;i++){
          state=await advance(.75);checkBodies(state.colony.colonists,state.colony.buildings);
          if(state.colony.jobs.some(j=>j.id===order.id))assert.equal(state.colony.colonists[1].jobId,order.id);
        }
        assert.ok(state.colony.buildings.find(b=>b.id===order.targetId)?.complete);
        await capture('original-job-finished');record('original-job-finished',state);
      }
    });
  }
  await play.step('居民从两端进入六格长的单格通道并抵达对侧',async()=>{
    const {save}=await crowdFixture('cross');
    await load(save);
    await speed(1);
    let state;
    for(let i=0;i<60;i++){
      state=await advance(.4);checkBodies([...state.colony.colonists,state.colony.guideHousing],state.colony.buildings);
      if(i===9)await capture('bottleneck-yield');
      if(state.colony.colonists[0].position[0]>27.3&&state.colony.colonists[1].position[0]<18.7)break;
    }
    assert.ok(state.colony.colonists[0].position[0]>27.3&&state.colony.colonists[1].position[0]<18.7);
    await capture('bottleneck-passed');record('bottleneck-passed',state);
  });
  const initial=await load({version:2,voxel:world.serialize(),colony:sim.serialize()});
  const [,second,resting]=initial.colony.colonists;
  await play.step('等待工作和休息的村民在附近走动',async()=>{
    await focusMap();
    const before=await read();
    await play.keyboard.press('Digit1');
    await wait(s=>s.colony.speed===1);
    const walked=new Set(),tasks=new Set();
    for(let i=0;i<20;i++){
      const state=await advance(.25);
      separation(state);
      for(const c of state.colony.colonists){
        if(distance(c.position,before.colony.colonists.find(p=>p.id===c.id).position)>.7)walked.add(c.id);
        if(c.task.includes('散步'))tasks.add(c.task);
      }
    }
    assert.ok(walked.has(second.id)&&walked.has(resting.id));
    assert.ok(tasks.has('等待工作 · 散步')&&tasks.has('休息 · 散步'));
    await capture('waiting-and-resting-residents-walk');
  });

  await play.step('重新读档后村民仍会继续走动并保持间距',async()=>{
    await focusMap();
    await play.keyboard.press('Escape');
    const paused=await wait(s=>s.colony.speed===0);
    await page.waitForFunction(({key,time})=>{
      const save=JSON.parse(localStorage.getItem(key));
      return save?.colony?.speed===0&&save.colony.time===time;
    },{key:SAVE,time:paused.colony.time},{timeout:12000});
    await play.reload();
    const loaded=await wait(s=>s.colony?.speed===0&&s.colony.time===paused.colony.time);
    assert.deepEqual(loaded.colony.colonists.map(c=>c.position),paused.colony.colonists.map(c=>c.position));
    await focusMap();
    await play.keyboard.press('Digit1');
    await wait(s=>s.colony.speed===1);
    const resumed=await advance(3);
    separation(resumed);
    assert.ok(resumed.colony.colonists.some((c,i)=>distance(c.position,loaded.colony.colonists[i].position)>.7));
    await capture('resident-walking-after-reload');
  });
}
