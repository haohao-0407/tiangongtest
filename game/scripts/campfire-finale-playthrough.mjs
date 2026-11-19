import assert from 'node:assert/strict';
import { tsImport } from 'tsx/esm/api';

const { ColonySimulation }=await tsImport('../assets/colony/simulation.ts',import.meta.url);
const { BLOCK,VoxelWorld }=await tsImport('../assets/voxel/model.ts',import.meta.url);
const READ='voxel.world', SAVE='homestead.colony.v2';

// A small empty settlement with one raised tile forces real earthwork before construction.
function settlement(){
  const world=VoxelWorld.deserialize(JSON.stringify({version:1,generatorVersion:1,seed:'plaza-acceptance',size:[48,24,48],edits:[]}));
  for (const tree of world.getTrees()) world.removeTree(tree.id,{recordHistory:false});
  const edits=[];
  for(let z=0;z<world.depth;z++) for(let x=0;x<world.width;x++) for(let y=1;y<world.height;y++){
    const block=y<5?BLOCK.Dirt:y===5?BLOCK.Grass:BLOCK.Air;
    if(world.get(x,y,z)!==block) edits.push({x,y,z,block});
  }
  world.edit(edits);world.set(20,6,20,BLOCK.Dirt);
  const sim=new ColonySimulation(world), s=sim.serialize();
  for(const key of ['zones','crops','buildings','terrainPlans','jobs','items'])s[key]=[];
  s.speed=0;s.time=120;
  for(const id of Object.keys(s.resources))s.resources[id]=0;
  s.colonists.forEach((c,i)=>{
    c.position=[16.5+i,6,15.5];c.path=[];c.jobId=null;c.personal=null;c.destination=null;
    c.task='等待工作';c.hunger=100;c.rest=100;c.schedule='day';
    for(const job of Object.keys(c.priorities))c.priorities[job]=['construct','terraform'].includes(job)?1:0;
    c.skills.construct=14;
  });
  sim.load(s);
  return {version:2,voxel:world.serialize(),colony:sim.serialize()};
}

export default async function finale(play){
  const {page}=play;
  const read=()=>play.state(READ);
  const wait=p=>play.waitFor(p,{read:READ,timeoutMs:12000});
  const button=id=>page.locator('[data-testid="'+id+'"]');
  const advance=s=>play.advance(s,{read:READ,stepSeconds:.1});
  const until=async(predicate,max,chunk=.45)=>{
    let s=await read();
    for(let t=0;t<max&&!predicate(s);t+=chunk)s=await advance(chunk);
    assert.ok(predicate(s),JSON.stringify({status:s.status,finale:s.colony.finale,buildings:s.colony.buildings,jobs:s.colony.jobs,people:s.colony.colonists.map(p=>p.task)}));
    return s;
  };
  const capture=async name=>assert.equal((await play.screenshot(name)).rendered,true);
  await wait(s=>s.colony?.colonists.length>0);
  await page.evaluate(({key,fixture})=>localStorage.setItem(key,JSON.stringify(fixture)),{key:SAVE,fixture:settlement()});
  await play.reload();
  await wait(s=>s.seed==='plaza-acceptance'&&s.colony.speed===0);
  await play.step('空仓从建造目录放置晚会广场',async()=>{
    await button('menu-build').click();
    const card=button('build-campfirePlaza');
    assert.match(await card.textContent(),/消耗 0/);
    assert.match(await card.getAttribute('title'),/燃灯 × 10/);
    await card.click();
    const close=page.locator('#panel-close');
    if(await close.isVisible())await close.click();
    await wait(s=>s.tool==='build:campfirePlaza');
    await play.mouse.move([.5,.5]);await advance(.3);
    const s=await read();assert.ok(s.hoverCell,JSON.stringify(s.camera));
    await play.mouse.click([.5,.5]);
    const plan=await wait(s=>s.colony.buildings.some(b=>b.kind==='campfirePlaza'));
    const b=plan.colony.buildings[0];
    assert.equal(b.w*b.d,572);assert.equal(b.phase,'preparingTerrain');
    assert.equal(plan.colony.terrainPlans[0].remainingCut,1);
    await capture('plaza-footprint-and-earthwork');
  });
  await play.step('村民整平并搭建实际场景',async()=>{
    await play.keyboard.press('Escape');
    await play.keyboard.press('Digit3');
    const midway=await until(s=>s.colony.buildings[0]?.progress>.47,65);
    assert.equal(midway.colony.terrainPlans[0].state,'completed');
    assert.deepEqual(midway.colony.buildings[0].reserved,{});
    await capture('plaza-path-stage-and-tables');
  });
  await play.step('渐入夜色、平移镜头、全体村民赴宴',async()=>{
    const state=await until(s=>s.colony.finale?.phase==='gathering'&&s.colony.finale.elapsed>=6.5,50,.25);
    assert.ok(state.colony.hour>=21);
    await capture('plaza-dusk-gathering');
    const show=await until(s=>s.colony.finale?.phase==='show',65,.25);
    assert.equal(show.colony.finale.arrived,show.colony.colonists.length);
    assert.ok(show.colony.colonists.every(c=>c.task==='围坐篝火旁'));
  });
  await play.step('火星、彩带、上升字幕和流星',async()=>{
    await until(s=>s.colony.finale?.phase==='show'&&s.colony.finale.elapsed>=5.25,10,.2);
    await capture('plaza-fire-title-and-confetti');
    await until(s=>s.colony.finale?.phase==='show'&&s.colony.finale.elapsed>=10.15,8,.15);
    await capture('plaza-meteor');
  });
  await play.step('散场、恢复工作并重新读档',async()=>{
    await until(s=>s.colony.finale?.phase==='departing',8,.25);
    await capture('plaza-residents-depart');
    const end=await until(s=>!s.colony.finale,80,.45);
    assert.ok(end.colony.buildings[0].complete);
    assert.ok(end.colony.colonists.every(c=>!c.task.includes('篝火')&&!c.task.includes('散场')));
    await page.waitForFunction(key=>{
      const saved=JSON.parse(localStorage.getItem(key));
      return saved?.colony?.buildings.some(b=>b.kind==='campfirePlaza'&&b.complete)&&!saved.colony.finale;
    },SAVE,{timeout:16000});
    await play.reload();
    const loaded=await wait(s=>s.seed==='plaza-acceptance'&&s.colony.buildings[0]?.complete);
    assert.equal(loaded.colony.finale,undefined);
    await capture('plaza-completed-after-reload');
  });
}

