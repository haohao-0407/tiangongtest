import {describe,expect,it} from 'vitest';
import {BLOCK,VoxelWorld} from '../../voxel/model.ts';
import {ColonySimulation,JOB_TYPES,STEEL_ORE_YIELD} from '../simulation.ts';

function setup(generatorVersion:1|2|3=3){
  const world=VoxelWorld.deserialize(JSON.stringify({version:1,generatorVersion,seed:'ore-colony',size:[48,24,48],edits:[]}));
  // Isolate the work loop from terrain randomization without changing runtime rules.
  const edits=[];
  for(let z=0;z<48;z++)for(let x=0;x<48;x++)for(let y=1;y<24;y++)edits.push({x,y,z,block:y<5?BLOCK.Dirt:y===5?BLOCK.Grass:BLOCK.Air});
  world.edit(edits);
  const sim=new ColonySimulation(world),state:any=sim.serialize();
  state.buildings=[];state.jobs=[];state.zones=[];state.crops=[];state.items=[];state.terrainPlans=[];state.chests=[];
  state.colonists.forEach((c:any,i:number)=>{
    c.position=[12.5+i,6,12.5];c.personal=null;c.path=[];c.destination=null;c.jobId=null;
    JOB_TYPES.forEach(job=>c.priorities[job]=0);
  });
  sim.load(state);return{world,sim};
}
function enable(sim:ColonySimulation,...types:string[]){
  for(const c of sim.snapshot().colonists)for(const job of JOB_TYPES)sim.command({action:'priority',colonistId:c.id,job,value:types.includes(job)?1:0});
}
function until(sim:ColonySimulation,predicate:()=>boolean,seconds=160){
  for(let n=0;n<seconds*4&&!predicate();n++)sim.tick(.25);
  expect(predicate()).toBe(true);
}
const loose=(sim:ColonySimulation,resource:string)=>sim.snapshot().items.filter(item=>item.resource===resource).reduce((n,item)=>n+item.amount,0);
const mining=(sim:ColonySimulation)=>sim.snapshot().jobs.filter(job=>job.type==='mine');

describe('finite steel ore mining',()=>{
  it('lets the player collect dirt by hand and stone or steel with the pickaxe exactly once',()=>{
    const{world,sim}=setup();
    world.set(21,5,20,BLOCK.Stone);
    world.set(22,5,20,BLOCK.SteelOre);
    sim.command({action:'designate',kind:'mine',x:22,z:20});
    const position:[number,number,number]=[21.5,6,19.5];
    const initial=sim.snapshot().resources;
    sim.selectBagSlot(8);
    expect(sim.playerHarvestTerrain([20,5,20],BLOCK.Grass,position).ok).toBe(true);
    expect(sim.playerHarvestTerrain([21,5,20],BLOCK.Stone,position).ok).toBe(false);
    expect(sim.playerHarvestTerrain([22,5,20],BLOCK.SteelOre,position).ok).toBe(false);
    sim.selectBagSlot(2);
    expect(sim.playerHarvestTerrain([21,5,20],BLOCK.Stone,position).ok).toBe(true);
    expect(sim.playerHarvestTerrain([22,5,20],BLOCK.SteelOre,position).ok).toBe(true);
    expect(sim.playerHarvestTerrain([22,5,20],BLOCK.SteelOre,position).ok).toBe(false);
    expect(mining(sim)).toHaveLength(0);
    expect(sim.snapshot().resources).toEqual(initial);
    const restoredWorld=VoxelWorld.deserialize(world.serialize()),restored=new ColonySimulation(restoredWorld);
    restored.load(sim.serialize());
    expect(restoredWorld.get(22,5,20)).toBe(BLOCK.Air);
    restored.tick(.75,[21.5,6,20.5]);
    expect(restored.snapshot().playerBag).toEqual(expect.arrayContaining([
      {resource:'dirt',count:1},{resource:'stone',count:8},{resource:'steel',count:STEEL_ORE_YIELD},
    ]));
    expect(restored.snapshot().bagSelected).toBe(2);
  });

  it('walks beside ore, completes real work, drops steel and then hauls it into storage',()=>{
    const{world,sim}=setup();world.set(20,5,20,BLOCK.SteelOre);enable(sim,'mine');
    const steel=sim.snapshot().resources.steel,stone=sim.snapshot().resources.stone;
    expect(sim.command({action:'designate',kind:'mine',x:20,z:20}).ok).toBe(true);
    expect(mining(sim)[0]).toMatchObject({y:5,progress:0,label:'开采钢矿'});
    expect(world.get(20,5,20)).toBe(BLOCK.SteelOre);expect(loose(sim,'steel')).toBe(0);
    until(sim,()=>mining(sim).some(job=>job.progress>0));
    const job=mining(sim)[0]!,worker=sim.snapshot().colonists.find(c=>c.id===job.assignedTo)!;
    expect(Math.abs(Math.floor(worker.position[0])-20)+Math.abs(Math.floor(worker.position[2])-20)).toBe(1);
    expect(worker.position[1]).toBe(6);expect(sim.snapshot().metrics.distanceWalked).toBeGreaterThan(0);
    expect(sim.snapshot().resources.steel).toBe(steel);expect(loose(sim,'steel')).toBe(0);
    until(sim,()=>world.get(20,5,20)===BLOCK.Air);
    expect(loose(sim,'steel')).toBe(STEEL_ORE_YIELD);expect(loose(sim,'stone')).toBe(0);
    expect(sim.snapshot().resources.steel).toBe(steel);expect(sim.snapshot().resources.stone).toBe(stone);
    expect(sim.command({action:'designate',kind:'stockpile',x:16,z:16,w:2,d:2}).ok).toBe(true);enable(sim,'haul');
    until(sim,()=>sim.snapshot().resources.steel===steel+STEEL_ORE_YIELD);
    expect(loose(sim,'steel')).toBe(0);expect(sim.snapshot().metrics.hauled).toBe(STEEL_ORE_YIELD);
  });

  it.each([1,2,3] as const)('keeps ordinary stone yield compatible with generator version %s',(generatorVersion:1|2|3)=>{
    const{world,sim}=setup(generatorVersion);world.set(20,5,20,BLOCK.Stone);enable(sim,'mine');
    expect(sim.command({action:'designate',kind:'mine',x:20,z:20}).ok).toBe(true);
    until(sim,()=>world.get(20,5,20)===BLOCK.Air);
    expect(loose(sim,'stone')).toBe(8);expect(loose(sim,'steel')).toBe(generatorVersion<3?2:0);
  });

  it('resumes in-progress mining and persists depletion without regenerating ore or duplicating steel',()=>{
    const{world,sim}=setup();world.set(20,5,20,BLOCK.SteelOre);enable(sim,'mine');
    sim.command({action:'designate',kind:'mine',x:20,z:20});until(sim,()=>mining(sim).some(job=>job.progress>2));
    const restoredWorld=VoxelWorld.deserialize(world.serialize()),restored=new ColonySimulation(restoredWorld);restored.load(sim.serialize());
    for(let n=0;n<160;n++){sim.tick(.25);restored.tick(.25);}
    expect(restored.serialize()).toEqual(sim.serialize());expect(restoredWorld.serialize()).toEqual(world.serialize());
    expect(restoredWorld.get(20,5,20)).toBe(BLOCK.Air);expect(loose(restored,'steel')).toBe(STEEL_ORE_YIELD);
    const depletedWorld=VoxelWorld.deserialize(restoredWorld.serialize()),depleted=new ColonySimulation(depletedWorld);depleted.load(restored.serialize());
    depleted.tick(30);expect(depletedWorld.get(20,5,20)).toBe(BLOCK.Air);expect(loose(depleted,'steel')).toBe(STEEL_ORE_YIELD);
  });

  it('protects ore during earthwork and lets explicit mining unblock an unfinished foundation',()=>{
    const{world,sim}=setup();world.set(20,6,20,BLOCK.SteelOre);enable(sim,'terraform','construct');
    const overlap=sim.command({action:'build',kind:'floor',x:20,z:20,target:6});
    expect(overlap.ok).toBe(false);expect(overlap.message).toContain('先开采钢矿');
    const order=sim.command({action:'build',kind:'floor',x:20,z:20,target:5});expect(order.ok).toBe(true);
    const building=()=>sim.snapshot().buildings.find(b=>b.id===order.id)!;
    expect(building().phase).toBe('preparingTerrain');expect(building().blockedReason).toContain('先开采钢矿');
    sim.tick(15);expect(world.get(20,6,20)).toBe(BLOCK.SteelOre);expect(loose(sim,'steel')).toBe(0);
    expect(sim.command({action:'designate',kind:'mine',x:20,z:20}).ok).toBe(true);enable(sim,'mine','terraform','construct');
    until(sim,()=>building().complete);
    expect(world.get(20,6,20)).toBe(BLOCK.Air);expect(loose(sim,'steel')).toBe(STEEL_ORE_YIELD);
  });

  it('blocks a high ore target until an adjacent working level is reachable',()=>{
    const{world,sim}=setup();world.edit([{x:20,y:6,z:20,block:BLOCK.Stone},{x:20,y:7,z:20,block:BLOCK.SteelOre}]);enable(sim,'mine');
    expect(sim.command({action:'designate',kind:'mine',x:20,z:20}).ok).toBe(true);sim.tick(25);
    expect(mining(sim)[0]).toMatchObject({state:'blocked',progress:0});expect(loose(sim,'steel')).toBe(0);
    world.set(19,6,20,BLOCK.Stone);
    until(sim,()=>world.get(20,7,20)===BLOCK.Air);expect(loose(sim,'steel')).toBe(STEEL_ORE_YIELD);
  });

  it('does not pay ore for stale jobs or restore mined cells through sandbox undo',()=>{
    const stale=setup();stale.world.set(20,5,20,BLOCK.SteelOre);enable(stale.sim,'mine');
    stale.sim.command({action:'designate',kind:'mine',x:20,z:20});const queued=stale.sim.serialize();
    stale.world.set(20,5,20,BLOCK.Air);stale.sim.tick(0);expect(mining(stale.sim)).toHaveLength(0);
    stale.sim.load(queued);stale.sim.tick(30);expect(loose(stale.sim,'steel')).toBe(0);expect(stale.world.get(20,4,20)).toBe(BLOCK.Dirt);
    const mined=setup();mined.world.set(20,5,20,BLOCK.SteelOre);enable(mined.sim,'mine');
    mined.sim.command({action:'designate',kind:'mine',x:20,z:20});until(mined.sim,()=>mined.world.get(20,5,20)===BLOCK.Air);
    while(mined.world.undo()){/* unrelated sandbox edits may remain undoable */}
    expect(mined.world.get(20,5,20)).toBe(BLOCK.Air);expect(loose(mined.sim,'steel')).toBe(STEEL_ORE_YIELD);
  });
});
