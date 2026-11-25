import assert from 'node:assert/strict';
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
  await page.evaluate(({key,value})=>localStorage.setItem(key,JSON.stringify(value)),{
    key:SAVE,value:{version:2,voxel:world.serialize(),colony:sim.serialize()},
  });
  await play.reload();
  const initial=await wait(s=>s.colony?.speed===0&&s.colony.buildings.length===0);
  const [first,second,resting]=initial.colony.colonists;

  await play.step('附身后正面被村民挡住，从旁边可以绕过',async()=>{
    const start=await possessResident(play,first.id);
    const blocked=await hold('KeyA',.9);
    assert.ok(blocked.player.x>start.player.x+.2);
    assert.ok(blocked.player.x<second.position[0]);
    const gap=distance(point(blocked.player),second.position);
    assert.ok(gap>=RESIDENT_RADIUS*2-1e-6&&gap<.65,JSON.stringify(blocked.player));
    const jumping=await page.keyboard.press('Space').then(()=>hold('KeyA',.2));
    assert.ok(jumping.player.y>blocked.player.y+.2);
    assert.ok(distance(point(jumping.player),second.position)>=RESIDENT_RADIUS*2-1e-6);
    await advance(.8);
    await capture('resident-collider');
    await hold('KeyS',.45);
    const passed=await hold('KeyA',.5);
    assert.ok(passed.player.x>second.position[0]+.25);
    separation(passed);
    await page.keyboard.press('KeyR');
    await wait(s=>!s.player);
  });

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
