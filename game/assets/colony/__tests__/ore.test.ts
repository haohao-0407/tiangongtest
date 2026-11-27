import {describe,expect,it} from 'vitest';
import {BLOCK,VoxelWorld} from '../../voxel/model.ts';
import {ColonySimulation,JOB_TYPES} from '../simulation.ts';
import type { CropView } from '../contracts.ts';

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
  if(!predicate()){
    const {buildings,items,colonists,resources,jobs}=sim.snapshot();
    throw Error(JSON.stringify({buildings,items,stock:[resources.stone,resources.pigIron],jobs,colonists:colonists.map(c=>[c.name,c.task,c.position,c.carrying])}));
  }
}
const loose=(sim:ColonySimulation,resource:string)=>sim.snapshot().items.filter(item=>item.resource===resource).reduce((n,item)=>n+item.amount,0);
const mining=(sim:ColonySimulation)=>sim.snapshot().jobs.filter(job=>job.type==='mine');

describe('finite iron ore mining',()=>{
  it('lets the player collect dirt by hand and stone or ordinary terrain without ore yield',()=>{
    const{world,sim}=setup();
    world.set(21,5,20,BLOCK.Stone);
    world.set(22,5,20,BLOCK.SteelOre);
    sim.command({action:'designate',kind:'mine',x:22,z:20});
    const position:[number,number,number]=[21.5,6,19.5];
    const initial=sim.snapshot().resources;
    const id=sim.snapshot().colonists[0]!.id;
    sim.possessColonist(id);
    sim.selectBagSlot(8);
    expect(sim.playerHarvestTerrain([20,5,20],BLOCK.Grass,position).ok).toBe(false);
    expect(sim.playerHarvestTerrain([20,5,20],BLOCK.Grass,[20.5,6,19.5]).ok).toBe(true);
    expect(sim.playerHarvestTerrain([21,5,20],BLOCK.Stone,position).ok).toBe(false);
    expect(sim.playerHarvestTerrain([22,5,20],BLOCK.SteelOre,position).ok).toBe(false);
    sim.selectBagSlot(2);
    expect(sim.playerHarvestTerrain([21,5,20],BLOCK.Stone,position).ok).toBe(true);
    expect(sim.playerHarvestTerrain([22,5,20],BLOCK.SteelOre,position).ok).toBe(false);
    expect(sim.playerHarvestTerrain([22,5,20],BLOCK.SteelOre,[21.5,6,20.5]).ok).toBe(false);
    expect(sim.playerHarvestTerrain([22,5,20],BLOCK.SteelOre,position).ok).toBe(false);
    expect(mining(sim)).toHaveLength(0);
    expect(sim.snapshot().resources).toEqual(initial);
    const restoredWorld=VoxelWorld.deserialize(world.serialize()),restored=new ColonySimulation(restoredWorld);
    restored.load(sim.serialize());
    expect(restoredWorld.get(22,5,20)).toBe(BLOCK.SteelOre);
    restored.possessColonist(id);
    restored.tick(.75,[21.5,6,20.5]);
    expect(restored.snapshot().playerBag).toEqual(expect.arrayContaining([
      {resource:'dirt',count:1},
    ]));
    expect(restored.snapshot().bagSelected).toBe(2);
  });

  it('plants one nearby seed, saves it and refunds overlapping villager sowing work', () => {
    const { world, sim } = setup();
    const saved: any = sim.serialize();
    const resident = saved.colonists[0];
    resident.position = [20.5, 6, 20.5];
    resident.bag[3] = { resource: 'tomatoSeed', count: 2 };
    sim.load(saved);

    expect(sim.command({ action: 'designate', kind: 'farm', crop: 'cabbage', x: 21, z: 20 }).ok).toBe(true);
    const scheduled: any = sim.serialize();
    const grow = scheduled.jobs.find((job: any) => job.type === 'grow');
    grow.reserved.cabbageSeed = 1;
    scheduled.resources.cabbageSeed--;
    sim.load(scheduled);
    sim.possessColonist(resident.id);
    sim.selectBagSlot(3);

    expect(sim.playerPlantCrop([21, 5, 21]).ok).toBe(false);
    expect(sim.snapshot().playerBag[3]?.count).toBe(2);
    expect(sim.playerPlantCrop([21, 5, 20]).ok).toBe(true);
    expect(sim.playerPlantCrop([21, 5, 20]).ok).toBe(false);
    expect(sim.snapshot().playerBag[3]?.count).toBe(1);
    expect(sim.snapshot().jobs.some(job => job.id === grow.id)).toBe(false);
    expect(sim.snapshot().resources.cabbageSeed).toBe(saved.resources.cabbageSeed);

    expect(sim.playerPlantCrop([20, 5, 21]).ok).toBe(true);
    expect(sim.snapshot().playerBag[3]).toBeNull();
    expect(sim.snapshot().zones).toContainEqual(expect.objectContaining({
      kind: 'farm', crop: 'tomato', x: 20, z: 21, w: 1, d: 1,
    }));
    const restored = new ColonySimulation(world);
    restored.load(sim.serialize());
    expect(restored.snapshot().crops).toEqual(sim.snapshot().crops);

    const withMatureCrop = restored.serialize() as { crops: CropView[] };
    const mature = withMatureCrop.crops.find(crop => crop.x === 21 && crop.z === 20)!;
    const young = withMatureCrop.crops.find(crop => crop.x === 20 && crop.z === 21)!;
    mature.growth = 1;
    restored.load(withMatureCrop);
    restored.command({ action: 'designate', kind: 'harvest', x: mature.x, z: mature.z });
    expect(restored.snapshot().jobs.some(job => job.targetId === mature.id && job.type === 'harvest')).toBe(true);
    expect(restored.playerBreakCrop(mature.id).ok).toBe(false);
    restored.possessColonist(resident.id);
    restored.updateControlledPose([20.5, 6, 21.5], 0, 100);
    expect(restored.playerBreakCrop(mature.id).ok).toBe(false);
    expect(restored.playerBreakCrop(young.id).ok).toBe(true);
    expect(loose(restored, 'tomato')).toBe(0);
    expect(loose(restored, 'tomatoSeed')).toBe(1);
    restored.updateControlledPose([20.5, 6, 20.5], 0, 100);
    expect(restored.playerBreakCrop(mature.id).ok).toBe(true);
    expect(restored.playerBreakCrop(mature.id).ok).toBe(false);
    expect(loose(restored, 'tomato')).toBe(6);
    expect(loose(restored, 'tomatoSeed')).toBe(2);
    expect(restored.snapshot().crops.find(crop => crop.id === mature.id)).toMatchObject({ planted: false, growth: 0 });
    expect(restored.snapshot().jobs.some(job => job.targetId === mature.id && job.type === 'harvest')).toBe(false);
    expect(world.get(21, 5, 20)).toBe(BLOCK.Grass);
  });

  it.each([[BLOCK.StoneDeposit,'stone',24],[BLOCK.SteelOre,'pigIron',18]] as const)(
    'requires a finished station and its worker’s physical tool for block %i', (block,resource,capacity)=>{
      const {world,sim}=setup();
      const opening:any=sim.serialize();opening.items=[];opening.warehouseStacks=[];
      for(const r of Object.keys(opening.resources))opening.resources[r]=0;
      opening.resources.wood=16;
      sim.load(opening);world.set(20,5,20,block);enable(sim,'construct','mine');
      const initial=sim.snapshot().resources[resource];
      expect(sim.command({action:'build',kind:'extractionStation',x:21,z:20}).ok).toBe(false);
      expect(sim.command({action:'designate',kind:'mine',x:20,z:20}).ok).toBe(false);
      const station=sim.command({action:'build',kind:'extractionStation',x:20,z:20});
      expect(station.ok).toBe(true);
      expect(mining(sim)).toHaveLength(0);
      until(sim,()=>sim.snapshot().buildings.some(b=>b.id===station.id&&b.complete));
      until(sim,()=>mining(sim).some(j=>j.progress>0));
      const worker=sim.snapshot().colonists.find(c=>c.id===mining(sim)[0]!.assignedTo)!;
      expect(worker.bag.some(s=>s?.resource==='pickaxe')).toBe(true);
      expect(Math.abs(Math.floor(worker.position[0])-20)+Math.abs(Math.floor(worker.position[2])-20)).toBe(1);
      expect(sim.depositAt(20,20)?.remaining).toBe(capacity);
      until(sim,()=>loose(sim,resource)===3);
      expect(sim.snapshot().resources[resource]).toBe(initial);
      const second=new ColonySimulation(VoxelWorld.deserialize(world.serialize()));second.load(sim.serialize());
      expect(second.depositAt(20,20)?.remaining).toBe(capacity-3);
      expect(second.command({action:'designate',kind:'stockpile',x:16,z:16,w:2,d:2}).ok).toBe(true);
      enable(second,'haul','mine');until(second,()=>second.snapshot().resources[resource]===initial+capacity,360);
      expect(second.depositAt(20,20)?.remaining).toBe(0);
      expect(mining(second)).toHaveLength(0);
      expect(second.snapshot().buildings.find(b=>b.id===station.id)?.mining?.status).toBe('已采尽');
      enable(second,'construct');
      expect(second.command({action:'demolish',id:station.id}).ok).toBe(true);
      until(second,()=>!second.snapshot().buildings.some(b=>b.id===station.id));
      const rebuilt=second.command({action:'build',kind:'extractionStation',x:20,z:20});expect(rebuilt.ok).toBe(true);
      until(second,()=>second.snapshot().buildings.some(b=>b.id===rebuilt.id&&b.complete));
      expect(second.snapshot().buildings.find(b=>b.id===rebuilt.id)?.mining?.status).toBe('已采尽');
      expect(mining(second)).toHaveLength(0);
    });
  it('preserves a partially mined cell when its station is dismantled, saved and built again',()=>{
    const {world,sim}=setup();world.set(20,5,20,BLOCK.SteelOre);enable(sim,'construct','mine');
    const first=sim.command({action:'build',kind:'extractionStation',x:20,z:20});
    until(sim,()=>sim.depositAt(20,20)?.remaining===15);
    const balance=sim.snapshot().resources.pigIron;
    expect(sim.command({action:'demolish',id:first.id}).ok).toBe(true);
    until(sim,()=>!sim.snapshot().buildings.some(b=>b.id===first.id));
    const restored=new ColonySimulation(VoxelWorld.deserialize(world.serialize()));restored.load(sim.serialize());
    expect(restored.depositAt(20,20)?.remaining).toBe(15);expect(loose(restored,'pigIron')).toBe(3);
    enable(restored,'construct');
    const second=restored.command({action:'build',kind:'extractionStation',x:20,z:20});
    until(restored,()=>restored.snapshot().buildings.some(b=>b.id===second.id&&b.complete));
    expect(restored.depositAt(20,20)?.remaining).toBe(15);expect(restored.snapshot().resources.pigIron).toBe(balance);
  });
  it('waits for the real pickaxe, fetches it from storage and pauses if it leaves the miner’s bag',()=>{
    const {world,sim}=setup();
    world.set(20,5,20,BLOCK.StoneDeposit);
    const chest=sim.command({action:'place-chest',x:14,z:15});expect(chest.ok).toBe(true);
    const [owner,worker]=sim.snapshot().colonists;enable(sim,'construct');
    sim.command({action:'priority',colonistId:worker!.id,job:'mine',value:1});
    expect(sim.command({action:'build',kind:'extractionStation',x:20,z:20}).ok).toBe(true);
    const station=()=>sim.snapshot().buildings.find(b=>b.kind==='extractionStation')!;
    until(sim,()=>station().complete);sim.tick(5);
    expect(station().mining?.status).toContain('等待可用石镐');
    expect(station().mining?.remaining).toBe(24);
    const box={kind:'chest' as const,id:chest.id!,slot:0};
    expect(sim.transferInventory({kind:'follower',id:owner!.id,slot:2},box,'pickaxe',1).ok).toBe(true);
    until(sim,()=>mining(sim).some(j=>j.progress>0));
    const carrier=sim.snapshot().colonists.find(c=>c.id===worker!.id)!;
    const slot=carrier.bag.findIndex(s=>s?.resource==='pickaxe');expect(slot).toBeGreaterThanOrEqual(0);
    expect(sim.snapshot().chests.find(b=>b.id===chest.id)?.slots[0]).toBeNull();
    expect(sim.transferInventory({kind:'follower',id:worker!.id,slot},{kind:'follower',id:owner!.id,slot:2},'pickaxe',1).ok).toBe(true);
    sim.tick(10);expect(station().mining?.remaining).toBe(24);expect(loose(sim,'stone')).toBe(0);
  });
  it('retires a legacy ground order without paying it or touching its old loose stack',()=>{
    const {world,sim}=setup();world.set(20,5,20,BLOCK.Air);
    const s:any=sim.serialize(),owner=s.colonists[0];
    s.jobs.push({id:'old-job',type:'mine',targetId:'rock:20:20:5',x:20,y:5,z:20,progress:18,work:19,
      state:'working',assignedTo:owner.id,reserved:{},label:'开采铁矿',phase:'work',amount:0,destination:null});
    owner.jobId='old-job';
    s.items.push({id:'old-drop',resource:'pigIron',amount:12,x:20,y:5,z:20,age:1,reservedBy:null});
    sim.load(s);
    expect(mining(sim)).toHaveLength(0);expect(sim.depositAt(20,20)).toBeUndefined();
    expect(loose(sim,'pigIron')).toBe(12);expect(sim.snapshot().resources.pigIron).toBe(0);
  });
});
