import assert from 'node:assert/strict';
import { tsImport } from 'tsx/esm/api';
import { createFacadeTerrainFixture } from './facade-playthrough.mjs';

export const radius=.28;
export const distance=(a,b)=>Math.hypot(a[0]-b[0],a[2]-b[2]);
const row=x=>[x,5,25.5];

export async function crowdFixture(kind){
  const {ColonySimulation}=await tsImport('../assets/colony/simulation.ts',import.meta.url);
  const {VoxelWorld}=await tsImport('../assets/voxel/model.ts',import.meta.url);
  const world=VoxelWorld.deserialize(createFacadeTerrainFixture());
  for(const tree of world.getTrees())world.removeTree(tree.id,{recordHistory:false});
  const sim=new ColonySimulation(world),save=sim.serialize();
  const template=save.buildings.find(b=>b.kind==='bed');
  save.buildings=[];
  const add=(kind,x,z,w,d)=>save.buildings.push({...template,id:'fixture-'+x+'-'+z,kind,x,y:5,z,w,d,h:kind==='wall'?2:1});
  if(kind!=='open'){
    for(let x=20;x<=25;x+=2){
      add('workbench',x,26,2,1);
      for(let dx=0;dx<2;dx++)add('bed',x+dx,23,1,2);
    }
    if(kind==='wall')add('wall',26,25,1,1);
  }
  save.crops=[];save.items=[];save.jobs=[];save.zones=save.zones.filter(z=>z.kind==='stockpile');
  save.speed=0;
  const xs=kind==='cross'?[19.5,26.5,17.5]:[23.5,24.1,24.66];
  for(const [i,c] of save.colonists.entries()){
    c.position=row(xs[i]);c.facing=0;c.path=[];c.destination=null;c.jobId=null;c.personal=null;
    c.hunger=c.rest=c.recreation=100;c.schedule='day';
    for(const job of Object.keys(c.priorities))c.priorities[job]=0;
  }
  const [,worker]=save.colonists;
  if(kind==='wall')worker.priorities.construct=1;
  if(kind==='cross')for(const [i,c] of save.colonists.entries()){
    const cells=i===0?[20,21,22,23,24,25,26,27]:i===1?[25,24,23,22,21,20,19,18]:[];
    c.path=cells.map(x=>row(x+.5));
    c.destination=c.path.at(-1)??null;
    c.personal={kind:'wander',elapsed:0,duration:60,reserved:{}};
  }
  sim.load(save);
  let order;
  if(kind==='wall'){
    const cmd=sim.command({action:'build',kind:'floor',x:24,z:25});
    assert.ok(cmd.ok,cmd.message);
    sim.command({action:'speed',value:1});
    // The worker has a real job and a real stand, assigned by the normal scheduler.
    for(let i=0;i<16;i++){
      sim.tick(.25);
      order=sim.snapshot().jobs.find(j=>j.targetId===cmd.id&&j.assignedTo===worker.id);
      if(order)break;
    }
    assert.ok(order);
    sim.command({action:'speed',value:0});
    const staged=sim.serialize();
    for(const [i,c] of staged.colonists.entries()){
      c.position=row(xs[i]);c.facing=0;
      if(c.id!==worker.id){c.personal=null;c.path=[];c.destination=null;}
    }
    sim.load(staged);
  }
  return {sim,world,order,save:{version:2,voxel:world.serialize(),colony:sim.serialize()}};
}

export function checkBodies(people,buildings){
  for(const [i,p] of people.entries()){
    const [x,y,z]=p.position;
    assert.ok(Math.abs(y-5)<.001,JSON.stringify(p.position));
    for(const b of buildings.filter(b=>b.complete&&b.kind!=='floor')){
      assert.ok(x+radius<=b.x+.00001||x-radius>=b.x+b.w-.00001||
        z+radius<=b.z+.00001||z-radius>=b.z+b.d-.00001,'body entered '+b.id+' '+p.position);
    }
    for(const other of people.slice(i+1))assert.ok(distance(p.position,other.position)>=2*radius-.000001,'overlap '+p.position+' '+other.position);
  }
}

export async function checkCrowd(){
  for(const kind of ['open','wall']){
    const {sim,order}=await crowdFixture(kind),first=sim.snapshot().colonists[0];
    sim.possessColonist(first.id);
    const initial=sim.snapshot().colonists.map(p=>p.position);
    let pos=[...first.position],prior=initial,maximum=0,pinned;
    for(let i=0;i<92;i++){
      const next=[pos[0]+.04,pos[1],pos[2]];
      if(sim.tryPlayerCrowdStep(pos,next)){pos=next;sim.updateControlledPose(pos,0,100);}
      const state=sim.snapshot();checkBodies(state.colonists,state.buildings);
      for(const [j,p] of state.colonists.entries())maximum=Math.max(maximum,distance(prior[j],p.position));
      prior=state.colonists.map(p=>p.position);
      if(i===71)pinned=prior;
    }
    assert.ok(maximum<=.063);
    assert.ok(prior.slice(1).every((p,i)=>distance(p,initial[i+1])>.1));
    if(kind==='open')assert.ok(pos[0]>27.17,JSON.stringify(prior));
    if(kind==='wall'){
      assert.deepEqual(prior,pinned);
      assert.ok(prior[2][0]>25.65 && prior[2][0]+radius<=26);
    }
    sim.tick(2);assert.deepEqual(sim.snapshot().colonists.map(p=>p.position),prior);
    console.log(kind,{travel:pos[0]-first.position[0],maximum,positions:prior});
    if(order){
      assert.equal(sim.snapshot().colonists[1].jobId,order.id);
      sim.releaseControl();sim.command({action:'speed',value:1});sim.tick(60);
      assert.ok(sim.snapshot().buildings.find(b=>b.id===order.targetId)?.complete);
    }
  }
  await checkMerchantContact();
  await checkSharedTable();
  await checkSharedCell();
  await checkCliff();
  await checkLanding();
  const {sim}=await crowdFixture('cross');
  sim.command({action:'speed',value:1});
  for(let i=1;i<=120;i++){
    sim.tick(.25);const s=sim.snapshot();checkBodies([...s.colonists,s.guideHousing],s.buildings);
    if(s.colonists[0].position[0]>27.3&&s.colonists[1].position[0]<18.7){console.log('cross',i*.25);return;}
  }
  assert.fail(JSON.stringify(sim.snapshot().colonists.map(p=>p.position)));
}
async function checkMerchantContact(){
  const {sim}=await crowdFixture('open');
  const state=sim.serialize(),guide=state.specialistMarket.walks.guide;
  // A guide and an arrived tailor meet the player. Exercise both actual
  // merchant walk objects, including a saved route to resume afterwards.
  guide.position=row(24.1);
  state.specialistMarket.progress.tailor.arrivalDay=1;
  state.specialistMarket.progress.tailor.sold=6;
  state.specialistMarket.walks.tailor={position:row(24.66),path:[row(25.5),row(26.5)],retryAt:200};
  state.colonists[1].position=[20.5,5,19.5];state.colonists[2].position=[21.5,5,19.5];
  sim.load(state);
  const first=sim.snapshot().colonists[0];
  sim.possessColonist(first.id);
  let pos=first.position;
  for(let i=0;i<92;i++){
    const to=[pos[0]+.04,5,pos[2]];
    if(sim.tryPlayerCrowdStep(pos,to)){sim.updateControlledPose(to,0,100);pos=to;}
    const s=sim.snapshot(),tailor=s.specialistMarket.merchants.find(p=>p.id==='tailor').housing;
    checkBodies([...s.colonists,s.guideHousing,tailor],s.buildings);
  }
  assert.ok(pos[0]>27.17);
  const end=sim.serialize().specialistMarket.walks;
  assert.ok(distance(end.guide.position,guide.position)>.1);
  assert.ok(distance(end.tailor.position,state.specialistMarket.walks.tailor.position)>.1);
  sim.releaseControl();sim.command({action:'speed',value:1});
  let reached=false;
  for(let i=0;i<60;i++){
    sim.tick(.25);const next=sim.serialize().specialistMarket.walks.tailor;
    if(distance(next.position,row(26.5))<.02){reached=true;break;}
  }
  assert.ok(reached,'tailor must finish the original trip');
  console.log('guide + tailor passed, original merchant trip finished');
}

async function checkSharedTable(){
  const {sim}=await crowdFixture('cross');
  const state=sim.serialize();
  const template=state.buildings.find(b=>b.kind==='bed');
  state.buildings.push({...template,id:'shared-table',kind:'table',x:18,z:25,w:1,d:1});
  for(const [i,c] of state.colonists.entries()){
    c.position=[15.5,5,24.5+i];c.hunger=15;c.personal=null;c.path=[];c.destination=null;
  }
  sim.load(state);sim.command({action:'speed',value:1});sim.tick(.25);
  const stands=sim.serialize().colonists.map(c=>c.path.at(-1)??c.position);
  assert.equal(new Set(stands.map(p=>p.join(','))).size,3);
  for(let i=0;i<80;i++){
    sim.tick(.25);const s=sim.snapshot();
    checkBodies(s.colonists,s.buildings);
    if(s.colonists.every(c=>c.hunger>70)){console.log('three diners finished',stands);return;}
  }
  assert.fail('all diners must finish the same meal service');
}

async function checkSharedCell(){
  const {sim}=await crowdFixture('open'),state=sim.serialize();
  for(const [i,c] of state.colonists.entries()){
    c.position=[22.5,5,23.5+i];c.path=[];
    for(let z=23+i;z<25;z++)c.path.push([22.5,5,z+1.5]);
    c.path.push(row(23.5),row(24.5));c.destination=c.path.at(-1);
    c.personal={kind:'wander',elapsed:0,duration:90,reserved:{}};
  }
  sim.load(state);sim.command({action:'speed',value:1});
  for(let i=0;i<80;i++){
    sim.tick(.25);const s=sim.snapshot();checkBodies(s.colonists,s.buildings);
  }
  const end=sim.serialize();
  assert.ok(end.colonists.every(c=>!c.path.length && Math.floor(c.position[0])===24 && Math.floor(c.position[2])===25));
  const before=end.colonists.map(p=>p.position);
  sim.tick(2);assert.deepEqual(sim.snapshot().colonists.map(p=>p.position),before);
  console.log('three finished in one goal cell without overlap or drift');
}

async function checkCliff(){
  const {sim,world}=await crowdFixture('wall');
  const state=sim.serialize();
  state.buildings=state.buildings.filter(b=>b.kind!=='wall');
  for(let z=24;z<=26;z++)for(let y=5;y<8;y++)world.set(26,y,z,3);
  sim.load(state);
  const first=sim.snapshot().colonists[0];sim.possessColonist(first.id);
  let pos=first.position;
  for(let i=0;i<120;i++){
    const to=[pos[0]+.04,5,pos[2]];
    if(sim.tryPlayerCrowdStep(pos,to)){sim.updateControlledPose(to,0,100);pos=to;}
    const s=sim.snapshot();checkBodies(s.colonists,s.buildings);
    assert.ok(s.colonists.every(p=>p.position[0]+radius<=26));
  }
  assert.ok(pos[0]>24 && pos[0]<25.6);
  console.log('three-block terrain rise held',pos);
}
async function checkLanding(){
  const {sim}=await crowdFixture('open'),state=sim.serialize();
  state.colonists[1].position=row(25);
  state.colonists[2].position=row(27);
  sim.load(state);
  const first=sim.snapshot().colonists[0];sim.possessColonist(first.id);
  let y=7.2;
  for(let i=0;i<100;i++){
    const pos=[25,y,25.5],target=Math.max(5,y-.1);
    sim.updateControlledPose(pos,0,100);sim.clearLanding(pos,target,1/30);
    y=sim.residentVerticalLimit(pos,target,first.id);
  }
  assert.equal(y,5);assert.ok(distance(sim.snapshot().colonists[1].position,row(25))>=.56-1e-6);
  console.log('landing reached terrain without stacking');
}
if(process.argv.includes('--check-crowd'))await checkCrowd();
