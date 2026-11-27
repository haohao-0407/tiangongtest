import {describe,expect,it} from 'vitest';
import {BLOCK,VoxelWorld} from '../../voxel/model.ts';
import {treeCells,type TreeInstance} from '../../voxel/trees.ts';
import {ColonySimulation,JOB_TYPES} from '../simulation.ts';

const tree=(id='tree-a',x=20,z=20,trunkHeight=4):TreeInstance=>({id,x,y:6,z,trunkHeight,crownRadius:2,variant:0,rotation:0});
function setup(trees:TreeInstance[]=[tree()]){
  const generated=VoxelWorld.deserialize(JSON.stringify({version:1,generatorVersion:1,seed:'tree-colony',size:[48,24,48],edits:[]}));
  const edits=[];for(let z=0;z<48;z++)for(let x=0;x<48;x++)for(let y=1;y<24;y++)edits.push({x,y,z,block:y<5?BLOCK.Dirt:y===5?BLOCK.Grass:BLOCK.Air});generated.edit(edits);
  const saved=JSON.parse(generated.serialize());saved.trees=trees;
  const world=VoxelWorld.deserialize(JSON.stringify(saved)),sim=new ColonySimulation(world),state:any=sim.serialize();
  state.buildings=[];state.jobs=[];state.zones=[];state.crops=[];state.items=[];state.terrainPlans=[];state.chests=[];
  state.colonists.forEach((c:any,i:number)=>{c.position=[12.5+i,6,12.5];c.personal=null;c.path=[];c.destination=null;c.jobId=null;JOB_TYPES.forEach(j=>c.priorities[j]=0);});
  sim.load(state);return{world,sim};
}
function enable(sim:ColonySimulation,...types:string[]){for(const c of sim.snapshot().colonists)for(const job of JOB_TYPES)sim.command({action:'priority',colonistId:c.id,job,value:types.includes(job)?1:0});}
function until(sim:ColonySimulation,predicate:()=>boolean,seconds=140){for(let n=0;n<seconds*4&&!predicate();n++)sim.tick(.25);expect(predicate()).toBe(true);}
const chopJobs=(sim:ColonySimulation)=>sim.snapshot().jobs.filter(j=>j.type==='chop');
const looseWood=(sim:ColonySimulation)=>sim.snapshot().items.filter(i=>i.resource==='wood').reduce((n,i)=>n+i.amount,0);

describe('whole-tree colony work',()=>{
  it('resolves trunk, crown, object ID and rectangle selection to one anchored job per tree',()=>{
    const t=tree(),{sim}=setup([t]),crown=treeCells(t).find(p=>p.role==='crown'&&p.x<t.x)!;
    expect(sim.command({action:'designate',kind:'chop',...crown}).ok).toBe(true);
    expect(sim.command({action:'designate',kind:'chop',x:t.x,y:t.y,z:t.z}).ok).toBe(true);
    expect(sim.command({action:'designate',kind:'chop',id:t.id}).ok).toBe(true);
    expect(sim.command({action:'designate',kind:'chop',x:18,z:18,w:5,d:5}).ok).toBe(true);
    expect(chopJobs(sim)).toHaveLength(1);expect(chopJobs(sim)[0]).toMatchObject({targetId:t.id,x:t.x,y:t.y,z:t.z,progress:0});
    expect(looseWood(sim)).toBe(0);
  });
  it('walks beside the trunk, removes only the chosen overlapping tree and produces wood once',()=>{
    const a=tree(),b=tree('tree-b',23),{world,sim}=setup([a,b]);enable(sim,'chop');
    expect(treeCells(a).some(p=>world.treesAtVoxel(p.x,p.y,p.z).length===2)).toBe(true);
    sim.command({action:'designate',kind:'chop',id:a.id});
    until(sim,()=>chopJobs(sim).some(j=>j.progress>0));
    const active=chopJobs(sim)[0]!,worker=sim.snapshot().colonists.find(c=>c.id===active.assignedTo)!;
    expect(Math.abs(Math.floor(worker.position[0])-a.x)+Math.abs(Math.floor(worker.position[2])-a.z)).toBe(1);
    expect(worker.position[1]).toBe(a.y);expect(looseWood(sim)).toBe(0);
    until(sim,()=>!world.getTree(a.id));
    expect(world.getTree(b.id)).toEqual(b);expect(looseWood(sim)).toBe(a.trunkHeight*6);
    for(const p of treeCells(b))expect(world.treesAtVoxel(p.x,p.y,p.z).some(t=>t.id===b.id)).toBe(true);
    const completed=sim.snapshot().metrics.jobsCompleted;
    expect(sim.command({action:'designate',kind:'chop',id:a.id}).ok).toBe(false);sim.tick(15);
    expect(looseWood(sim)).toBe(a.trunkHeight*6);expect(sim.snapshot().metrics.jobsCompleted).toBe(completed);
  });
  it('saves an in-progress cut and resumes deterministically without duplicating its yield',()=>{
    const{world,sim}=setup();enable(sim,'chop');sim.command({action:'designate',kind:'chop',id:'tree-a'});
    until(sim,()=>chopJobs(sim).some(j=>j.progress>2));
    const restoredWorld=VoxelWorld.deserialize(world.serialize()),restored=new ColonySimulation(restoredWorld);restored.load(sim.serialize());
    expect(restored.serialize()).toEqual(sim.serialize());
    for(let n=0;n<240;n++){sim.tick(.25);restored.tick(.25);}
    expect(restored.serialize()).toEqual(sim.serialize());expect(restoredWorld.serialize()).toEqual(world.serialize());
    expect(world.getTrees()).toHaveLength(0);expect(looseWood(sim)).toBe(24);
  });
  it('migrates coordinate jobs, preserves their progress and releases duplicate or missing targets',()=>{
    const{sim}=setup();sim.command({action:'designate',kind:'chop',id:'tree-a'});const saved:any=sim.serialize(),job=saved.jobs[0];
    job.targetId='tree:20:20';job.progress=5;
    saved.jobs.push({...job,id:'duplicate-cut',targetId:'tree-a'}, {...job,id:'stale-cut',targetId:'tree:30:30'});
    saved.colonists[0].jobId='stale-cut';saved.jobs[2].assignedTo=saved.colonists[0].id;saved.jobs[2].state='working';
    sim.load(saved);expect(chopJobs(sim)).toHaveLength(1);expect(chopJobs(sim)[0]).toMatchObject({targetId:'tree-a',progress:5});
    expect(sim.snapshot().colonists[0]!.jobId).toBeNull();expect(looseWood(sim)).toBe(0);
  });
  it('cancels a sandbox-removed tree while paused without paying wood or leaving an assigned worker',()=>{
    const{world,sim}=setup();enable(sim,'chop');sim.command({action:'designate',kind:'chop',id:'tree-a'});
    until(sim,()=>chopJobs(sim).some(j=>j.progress>0));sim.command({action:'speed',value:0});
    world.removeTree('tree-a');sim.tick(0);
    expect(chopJobs(sim)).toHaveLength(0);expect(sim.snapshot().colonists.every(c=>c.jobId===null)).toBe(true);expect(looseWood(sim)).toBe(0);
  });
  it('refuses to mine a standing tree foundation without changing the tree, ground or resources',()=>{
    const{world,sim}=setup(),beforeWorld=world.serialize(),before=sim.serialize();
    const result=sim.command({action:'designate',kind:'mine',x:20,z:20});
    expect(result.ok).toBe(false);expect(result.message).toContain('采集站');
    expect(world.serialize()).toBe(beforeWorld);expect(sim.serialize()).toEqual(before);
    expect(world.get(20,5,20)).toBe(BLOCK.Grass);expect(looseWood(sim)).toBe(0);
  });
  it('cancels queued or restored mining when a sandbox undo restores the tree above its target',()=>{
    const{world,sim}=setup();world.removeTree('tree-a');
    expect(sim.command({action:'designate',kind:'mine',x:20,z:20}).ok).toBe(false);
    const queued=sim.serialize();expect(world.undo()).toBe(true);sim.tick(0);
    expect(sim.snapshot().jobs.some(j=>j.type==='mine')).toBe(false);
    sim.load(queued);expect(sim.snapshot().jobs.some(j=>j.type==='mine')).toBe(false);
    enable(sim,'mine');sim.tick(30);
    expect(world.getTree('tree-a')).toBeDefined();expect(world.get(20,5,20)).toBe(BLOCK.Grass);
    expect(sim.snapshot().items).toHaveLength(0);expect(sim.snapshot().metrics.jobsCompleted).toBe(0);
  });
  it('preserves completed legacy furniture by clearing only its conflicting whole tree after save validation',()=>{
    const{world,sim}=setup([tree('tree-a',20,20,3),tree('tree-b',27,20)]),state:any=sim.serialize();
    state.buildings.push({id:'old-door',kind:'door',x:18,y:7,z:20,w:1,h:2,d:1,rotation:0,doorOpen:false,phase:'completed',complete:true,progress:1,reserved:{},powered:false,comfort:0,roomId:null});
    const bad=structuredClone(state);bad.resources.wood=-1;
    expect(()=>sim.load(bad)).toThrow();expect(world.getTrees()).toHaveLength(2);
    sim.load(state);expect(world.getTree('tree-a')).toBeUndefined();expect(world.getTree('tree-b')).toBeDefined();
    expect(sim.snapshot().buildings[0]!.id).toBe('old-door');expect(looseWood(sim)).toBe(0);expect(sim.snapshot().resources.wood).toBe(state.resources.wood);
  });
  it('clears a crown over a raised building even when its trunk is outside the building footprint',()=>{
    const t=tree('tree-a',20,20,3),{world,sim}=setup([t]);enable(sim,'chop','terraform','construct');
    expect(world.treesAtVoxel(18,8,20).some(t=>t.id==='tree-a')).toBe(true);
    const order=sim.command({action:'build',kind:'door',x:18,z:20,target:7});expect(order.ok).toBe(true);
    expect(chopJobs(sim)).toHaveLength(1);expect(chopJobs(sim)[0]).toMatchObject({targetId:t.id,x:20,z:20,label:'清理整地树木'});
    expect(sim.snapshot().buildings.find(b=>b.id===order.id)!.phase).toBe('preparingTerrain');
    until(sim,()=>sim.snapshot().buildings.find(b=>b.id===order.id)!.complete);
    expect(world.getTree(t.id)).toBeUndefined();expect(looseWood(sim)).toBe(18);expect(world.terrainHeight(18,20)).toBe(7);
  });
  it('retains automatic clearing until the last plan is cancelled and retains an explicit chop order afterwards',()=>{
    const{world,sim}=setup(),a=sim.command({action:'level',x:20,z:20,target:6}),b=sim.command({action:'level',x:20,z:20,target:6});
    expect(chopJobs(sim)).toHaveLength(1);sim.command({action:'cancel',id:a.id});expect(chopJobs(sim)).toHaveLength(1);
    sim.command({action:'cancel',id:b.id});expect(chopJobs(sim)).toHaveLength(0);expect(world.getTree('tree-a')).toBeDefined();
    const c=sim.command({action:'level',x:20,z:20,target:6});sim.command({action:'designate',kind:'chop',id:'tree-a'});
    sim.command({action:'cancel',id:c.id});expect(chopJobs(sim)).toHaveLength(1);expect(chopJobs(sim)[0]!.label).toBe('砍伐树木');
  });
  it('blocks trunk navigation and zones, then makes the cell available after whole removal',()=>{
    const{world,sim}=setup();expect(sim.getGroundHeight(20,20)).toBe(-1);
    expect(sim.command({action:'designate',kind:'farm',x:20,z:20}).ok).toBe(false);
    expect(sim.command({action:'place-chest',x:20,z:20}).ok).toBe(false);
    const state:any=sim.serialize(),c=state.colonists[0];c.position=[19.5,6,20.5];c.path=[[20.5,6,20.5],[21.5,6,20.5]];c.destination=[21.5,6,20.5];c.personal={kind:'wander',elapsed:0,duration:10,reserved:{}};sim.load(state);
    sim.tick(.25);expect(sim.snapshot().colonists[0]!.position[0]).toBeLessThan(20);expect((sim.serialize() as any).colonists[0].path).toHaveLength(0);
    world.removeTree('tree-a');sim.tick(0);expect(sim.getGroundHeight(20,20)).toBe(6);
    expect(sim.command({action:'place-chest',x:20,z:20}).ok).toBe(true);
    expect(sim.snapshot().chests.some(chest=>chest.x===20&&chest.z===20)).toBe(true);
    const farm=setup();farm.world.removeTree('tree-a');farm.sim.tick(0);
    expect(farm.sim.command({action:'designate',kind:'farm',x:20,z:20}).ok).toBe(true);
  });
});
