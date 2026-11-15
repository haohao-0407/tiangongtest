import {describe,expect,it} from 'vitest';
import {BLOCK,VoxelWorld} from '../../voxel/model.ts';
import {ColonySimulation,JOB_TYPES,BUILDING_DEFS} from '../simulation.ts';

function setup(){
  const world=VoxelWorld.deserialize(JSON.stringify({version:1,generatorVersion:1,seed:'colony-test',size:[48,24,48],edits:[]}));
  // A deliberately level worksite, away from the settlement's existing facilities.
  const edits=[];for(let z=18;z<=24;z++)for(let x=18;x<=24;x++)for(let y=1;y<world.height;y++)edits.push({x,y,z,block:y<5?BLOCK.Dirt:y===5?BLOCK.Grass:BLOCK.Air});
  world.edit(edits);return{world,sim:new ColonySimulation(world)};
}
function jobs(sim:ColonySimulation,enabled:string[]){for(const p of sim.snapshot().colonists)for(const job of JOB_TYPES)sim.command({action:'priority',colonistId:p.id,job,value:enabled.includes(job)?1:0});}
function runUntil(sim:ColonySimulation,condition:()=>boolean,seconds=180){for(let i=0;i<seconds*4&&!condition();i++)sim.tick(.25);expect(condition()).toBe(true);}
const plan=(sim:ColonySimulation,id:string)=>sim.snapshot().terrainPlans.find(p=>p.id===id)!;

describe('earthwork blueprints and foundation dependencies',()=>{
  it('records one fixed target without changing terrain, coalesces duplicate brush cells and reports cut/fill separately',()=>{
    const{world,sim}=setup();world.set(20,6,20,BLOCK.Stone);world.set(21,5,20,BLOCK.Air);
    const before=world.serialize();const result=sim.command({action:'level',target:6,cells:[[20,20],[21,20],[20,20]]});
    expect(result.ok).toBe(true);expect(world.serialize()).toBe(before);
    expect(plan(sim,result.id!)).toMatchObject({target:6,cells:[[20,20],[21,20]],remainingCut:1,remainingFill:1,progress:0});
  });
  it('residents walk and physically finish both excavation and fill before the plan completes',()=>{
    const{world,sim}=setup();jobs(sim,['terraform']);world.set(20,6,20,BLOCK.Stone);world.set(21,5,20,BLOCK.Air);
    const order=sim.command({action:'level',target:6,x:20,z:20,w:2,d:1});expect(order.ok).toBe(true);
    const before=sim.snapshot().metrics.distanceWalked;
    runUntil(sim,()=>plan(sim,order.id!).state==='completed');
    expect(world.terrainHeight(20,20)).toBe(6);expect(world.terrainHeight(21,20)).toBe(6);
    expect(world.get(20,6,20)).toBe(BLOCK.Air);expect(world.get(21,5,20)).toBe(BLOCK.Grass);
    expect(sim.snapshot().metrics.distanceWalked).toBeGreaterThan(before);
    expect(plan(sim,order.id!)).toMatchObject({remainingCut:0,remainingFill:0,progress:1});
  });
  it('places a two-cell building on mixed heights and waits for real earthwork before construction and material reservation',()=>{
    const{world,sim}=setup();jobs(sim,['terraform','construct']);world.set(20,5,20,BLOCK.Air);world.set(20,6,21,BLOCK.Stone);
    const resources=sim.snapshot().resources;const order=sim.command({action:'build',kind:'bed',x:20,z:20,target:6});expect(order.ok).toBe(true);
    const building=()=>sim.snapshot().buildings.find(b=>b.id===order.id)!;
    expect(building()).toMatchObject({w:1,d:2,phase:'preparingTerrain',progress:0,reserved:{}});
    expect(sim.snapshot().resources).toEqual(resources);expect(sim.snapshot().jobs.some(j=>j.type==='construct'&&j.targetId===order.id)).toBe(false);
    let observedPreparation=false;
    for(let n=0;n<600&&!building().complete;n++){
      if(world.terrainHeight(20,20)!==6||world.terrainHeight(20,21)!==6){observedPreparation=true;expect(building().progress).toBe(0);expect(building().phase).toBe('preparingTerrain');}
      sim.tick(.25);
    }
    expect(observedPreparation).toBe(true);expect(building().complete).toBe(true);
    expect(building().phase).toBe('completed');expect(world.terrainHeight(20,20)).toBe(6);expect(world.terrainHeight(20,21)).toBe(6);
    expect(sim.snapshot().resources.wood).toBe(resources.wood-BUILDING_DEFS.bed.cost.wood!);
  });
  it('merges same-height manual and building work and rejects conflicting heights atomically',()=>{
    const{world,sim}=setup();world.set(20,5,20,BLOCK.Air);
    const a=sim.command({action:'level',target:6,x:20,z:20}),b=sim.command({action:'build',kind:'bed',target:6,x:20,z:20});
    expect(a.ok&&b.ok).toBe(true);expect(sim.snapshot().jobs.filter(j=>j.type==='terraform'&&j.x===20&&j.z===20)).toHaveLength(1);
    const before=sim.serialize();expect(sim.command({action:'level',target:7,x:20,z:20}).ok).toBe(false);expect(sim.serialize()).toEqual(before);
    expect(sim.command({action:'cancel',id:a.id}).ok).toBe(true);expect(sim.snapshot().jobs.filter(j=>j.type==='terraform'&&j.x===20&&j.z===20)).toHaveLength(1);
    jobs(sim,['terraform','construct']);runUntil(sim,()=>sim.snapshot().buildings.find(v=>v.id===b.id)!.complete);
  });
  it('cancelling a partially executed plan preserves completed terrain and stops further earthwork',()=>{
    const{world,sim}=setup();jobs(sim,['terraform']);const order=sim.command({action:'level',target:8,x:20,z:20});
    runUntil(sim,()=>world.terrainHeight(20,20)===7);
    expect(sim.command({action:'cancel',id:order.id}).ok).toBe(true);for(let i=0;i<240;i++)sim.tick(.25);
    expect(world.terrainHeight(20,20)).toBe(7);expect(sim.snapshot().jobs.some(j=>j.type==='terraform')).toBe(false);
  });
  it('cancelling a building retains separately requested matching earthwork and never refunds unreserved materials',()=>{
    const{world,sim}=setup();world.set(20,5,20,BLOCK.Air);const before=sim.snapshot().resources;
    const a=sim.command({action:'level',target:6,x:20,z:20}),b=sim.command({action:'build',kind:'bed',x:20,z:20,target:6});
    expect(sim.command({action:'cancel',id:b.id}).ok).toBe(true);expect(sim.snapshot().resources).toEqual(before);
    expect(sim.snapshot().terrainPlans.map(p=>p.id)).toContain(a.id);jobs(sim,['terraform']);runUntil(sim,()=>plan(sim,a.id!).state==='completed');
  });
  it('saves and resumes a partially filled foundation without duplicating work or material debits',()=>{
    const{world,sim}=setup();jobs(sim,['terraform','construct']);world.set(20,5,20,BLOCK.Air);const order=sim.command({action:'build',kind:'floor',target:7,x:20,z:20});
    runUntil(sim,()=>world.terrainHeight(20,20)===6);
    const restoredWorld=VoxelWorld.deserialize(world.serialize()),restored=new ColonySimulation(restoredWorld);restored.load(sim.serialize());
    expect(restored.snapshot()).toEqual(sim.snapshot());
    for(let i=0;i<320;i++){sim.tick(.25);restored.tick(.25);}
    expect(restored.serialize()).toEqual(sim.serialize());expect(restoredWorld.serialize()).toEqual(world.serialize());
    expect(sim.snapshot().buildings.find(b=>b.id===order.id)!.complete).toBe(true);
  });
  it('reports an unreachable deep cut instead of editing remotely through many vertical layers',()=>{
    const{world,sim}=setup();jobs(sim,['terraform']);const order=sim.command({action:'level',target:1,x:20,z:20});
    for(let i=0;i<400;i++)sim.tick(.25);
    expect(world.terrainHeight(20,20)).toBeGreaterThan(1);expect(plan(sim,order.id!).state).not.toBe('completed');
    expect(sim.snapshot().jobs.some(j=>j.type==='terraform'&&j.state==='blocked')).toBe(true);
  });
  it('keeps submerged low targets blocked while filling above water physically replaces each water layer',()=>{
    const{world,sim}=setup();jobs(sim,['terraform']);world.edit([{x:20,y:5,z:20,block:BLOCK.Water},{x:20,y:6,z:20,block:BLOCK.Water}]);
    const low=sim.command({action:'level',target:5,x:20,z:20});expect(low.ok).toBe(true);expect(plan(sim,low.id!).blockedReason).toContain('积水');
    expect(world.get(20,6,20)).toBe(BLOCK.Water);sim.command({action:'cancel',id:low.id});
    const high=sim.command({action:'level',target:7,x:20,z:20});runUntil(sim,()=>plan(sim,high.id!).state==='completed');
    expect(world.terrainHeight(20,20)).toBe(7);expect(world.waterSurfaceHeight(20,20)).toBe(-1);
  });
  it('supports default 250×250 coordinates and restores distant blueprint cells',()=>{
    const world=new VoxelWorld('large-earthwork'),sim=new ColonySimulation(world);expect(world.width).toBe(250);
    const h=world.terrainHeight(249,249),target=Math.min(world.height-2,h+1);
    const order=sim.command({action:'level',x:248,z:248,w:2,d:2,target});expect(order.ok).toBe(true);
    expect(plan(sim,order.id!).cells).toContainEqual([249,249]);const restored=new ColonySimulation(world);restored.load(sim.serialize());
    expect(restored.snapshot().terrainPlans).toEqual(sim.snapshot().terrainPlans);
    expect(sim.command({action:'level',x:249,z:249,w:2,d:1,target}).ok).toBe(false);
  });
  it('validates saved plan dependencies atomically and supplies legacy terraform defaults',()=>{
    const{sim}=setup();const legacy:any=sim.serialize();delete legacy.terrainPlans;
    for(const c of legacy.colonists){delete c.skills.terraform;delete c.priorities.terraform;}
    for(const b of legacy.buildings){delete b.w;delete b.d;delete b.h;delete b.rotation;delete b.doorOpen;delete b.phase;}
    sim.load(legacy);expect(sim.snapshot().colonists.every(c=>Number.isFinite(c.skills.terraform))).toBe(true);
    const order=sim.command({action:'build',kind:'bed',x:20,z:20,target:7});expect(order.ok).toBe(true);const before=sim.serialize(),bad:any=sim.serialize();
    bad.terrainPlans[0].buildingId='missing';expect(()=>sim.load(bad)).toThrow();expect(sim.serialize()).toEqual(before);
  });
  it('cancels automatic tree clearing with its last terrain consumer',()=>{
    const{world,sim}=setup();world.edit([{x:20,y:6,z:20,block:BLOCK.Wood},{x:20,y:7,z:20,block:BLOCK.Wood}]);
    const order=sim.command({action:'level',target:6,x:20,z:20});expect(order.ok).toBe(true);
    expect(sim.snapshot().jobs.some(j=>j.type==='chop'&&j.x===20&&j.z===20)).toBe(true);
    sim.command({action:'cancel',id:order.id});expect(sim.snapshot().jobs.some(j=>j.type==='chop'&&j.x===20&&j.z===20)).toBe(false);
    expect(world.get(20,6,20)).toBe(BLOCK.Wood);
  });
  it('reopens an unfinished building foundation when the real terrain changes after preparation',()=>{
    const{world,sim}=setup();jobs(sim,['terraform','construct']);const order=sim.command({action:'build',kind:'floor',target:6,x:20,z:20});
    expect(sim.snapshot().buildings.find(b=>b.id===order.id)!.phase).toBe('readyToBuild');
    world.set(20,6,20,BLOCK.Stone);sim.tick(1);
    expect(sim.snapshot().buildings.find(b=>b.id===order.id)!.phase).toBe('preparingTerrain');
    expect(sim.snapshot().jobs.some(j=>j.type==='construct'&&j.targetId===order.id)).toBe(false);
    runUntil(sim,()=>sim.snapshot().buildings.find(b=>b.id===order.id)!.complete);
    expect(world.terrainHeight(20,20)).toBe(6);
  });
  it('resumes a farm-blocked blueprint after the farm zone is cancelled',()=>{
    const{sim}=setup();jobs(sim,['terraform']);
    const farm=sim.command({action:'designate',kind:'farm',x:20,z:20,w:1,d:1});expect(farm.ok).toBe(true);
    const order=sim.command({action:'level',x:20,z:20,target:7});expect(plan(sim,order.id!).blockedReason).toContain('农田');
    expect(sim.command({action:'cancel',id:farm.id}).ok).toBe(true);
    runUntil(sim,()=>plan(sim,order.id!).state==='completed');
  });
  it('updates a completed layer locally for a full-map plan and reuses immutable snapshot cells',()=>{
    const world=new VoxelWorld('perf-terraform'),sim=new ColonySimulation(world);jobs(sim,['terraform']);
    const order=sim.command({action:'level',x:0,z:0,w:250,d:250,target:7});expect(order.ok).toBe(true);
    const cells=plan(sim,order.id!).cells;expect(plan(sim,order.id!).cells).toBe(cells);expect(Object.isFrozen(cells)).toBe(true);expect(Object.isFrozen(cells[0])).toBe(true);
    let heightReads=0;const terrainHeight=world.terrainHeight.bind(world);world.terrainHeight=(x,z)=>{heightReads++;return terrainHeight(x,z);};
    let observed=false;
    for(let i=0;i<120&&!observed;i++){const revision=world.revision;heightReads=0;sim.tick(.25);if(world.revision!==revision){observed=true;expect(heightReads).toBeLessThan(1000);}}
    expect(observed).toBe(true);expect(plan(sim,order.id!).remainingFill).toBeGreaterThan(0);
  });
});
