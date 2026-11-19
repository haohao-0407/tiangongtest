import {describe,expect,it} from 'vitest';
import {BLOCK,VoxelWorld} from '../../voxel/model.ts';
import {ColonySimulation,JOB_TYPES,type BuildingKind,type BuildingView,type BuildingRotation} from '../simulation.ts';
import {buildingDimensions,buildingParts} from '../buildings.ts';

function setup(){
  const world=VoxelWorld.deserialize(JSON.stringify({version:1,generatorVersion:1,seed:'multiblock-test',size:[48,24,48],edits:[]}));
  const edits=[];for(let z=0;z<48;z++)for(let x=0;x<48;x++)for(let y=1;y<24;y++)edits.push({x,y,z,block:y<5?BLOCK.Dirt:y===5?BLOCK.Grass:BLOCK.Air});world.edit(edits);
  const sim=new ColonySimulation(world),save:any=sim.serialize();
  save.buildings=[];save.jobs=[];save.zones=[];save.crops=[];save.items=[];save.terrainPlans=[];
  save.colonists.forEach((c:any,i:number)=>{c.position=[12.5+i,6,12.5];c.personal=null;c.path=[];c.destination=null;c.jobId=null;JOB_TYPES.forEach(j=>c.priorities[j]=0);});sim.load(save);
  return{world,sim};
}
function fixture(kind:BuildingKind,x:number,z:number,rotation:BuildingRotation=0,id=`fixture-${kind}-${x}-${z}`):BuildingView{
  return{id,kind,x,y:6,z,rotation,...buildingDimensions(kind,rotation),...(kind==='door'?{doorOpen:false}:{}),complete:true,phase:'completed',progress:1,reserved:{},powered:false,comfort:0,roomId:null};
}
function install(sim:ColonySimulation,...buildings:BuildingView[]){const save:any=sim.serialize();save.buildings.push(...buildings);sim.load(save);}

describe('one authoritative object across rotated three-dimensional cells',()=>{
  it.each([0,1,2,3] as const)('places both bed halves at rotation %i and cancels the whole blueprint from either half',(rotation:BuildingRotation)=>{
    const{sim}=setup(),before=sim.snapshot().resources;
    const result=sim.command({action:'build',kind:'bed',x:20,z:20,rotation});expect(result.ok).toBe(true);
    const bed=sim.snapshot().buildings.find(b=>b.id===result.id)!;
    expect([bed.w,bed.h,bed.d]).toEqual(rotation%2?[2,1,1]:[1,1,2]);
    expect(bed.rotation).toBe(rotation);
    const parts=buildingParts(bed);expect(parts.map(p=>p.role)).toEqual(['bed-head','bed-foot']);
    for(const part of parts){expect(sim.buildingAtVoxel(part.x,part.y,part.z)?.id).toBe(bed.id);expect(sim.blocksVoxel(part.x,part.y,part.z)).toBe(false);}
    const plan=sim.snapshot().terrainPlans.find(p=>p.buildingId===bed.id)!;expect(plan.cells).toHaveLength(2);
    expect(sim.command({action:'build',kind:'floor',x:parts[1]!.x,z:parts[1]!.z}).ok).toBe(false);
    expect(sim.command({action:'demolish',...parts[rotation%2]!}).ok).toBe(true);
    expect(sim.snapshot().buildings).toHaveLength(0);expect(sim.snapshot().terrainPlans).toHaveLength(0);
    expect(sim.snapshot().resources).toEqual(before);expect(sim.snapshot().jobs.some(j=>j.targetId===bed.id)).toBe(false);
    for(const part of parts)expect(sim.buildingAtVoxel(part.x,part.y,part.z)).toBeUndefined();
  });
  it('distinguishes all four bed-head orientations, not only width/depth swaps',()=>{
    const heads=([0,1,2,3] as const).map(rotation=>buildingParts(fixture('bed',20,20,rotation))[0]);
    expect(heads.map(p=>[p!.x,p!.z])).toEqual([[20,20],[21,20],[20,21],[20,20]]);
    expect(buildingParts(fixture('bed',20,20,3))[1]).toMatchObject({x:21,z:20,role:'bed-foot'});
  });
  it.each(['bed','medicalBed','door'] as const)('can collect and place a completed %s dismantled from either cell',(kind:BuildingKind)=>{
    const{sim}=setup(),object=fixture(kind,20,20,1);install(sim,object);
    const before=sim.snapshot().resources,part=buildingParts(object)[1]!;
    expect(sim.blocksVoxel(part.x,part.y,part.z)).toBe(true);
    expect(sim.command({action:'demolish',x:part.x,y:part.y,z:part.z}).ok).toBe(true);
    expect(sim.command({action:'demolish',...part}).ok).toBe(false);
    expect(sim.snapshot().resources).toEqual(before);
    expect(sim.snapshot().items).toEqual([expect.objectContaining({resource:`building:${kind}`,amount:1})]);
    expect(sim.snapshot().buildings).toHaveLength(0);for(const p of buildingParts(object))expect(sim.blocksVoxel(p.x,p.y,p.z)).toBe(false);
    const residentId=sim.snapshot().colonists[0]!.id;
    sim.possessColonist(residentId);
    sim.tick(.75,[19.5,6,20.5]);
    sim.load(sim.serialize());
    sim.possessColonist(residentId);
    const slot=sim.snapshot().playerBag.findIndex(stack=>stack?.resource===`building:${kind}`);
    expect(slot).toBeGreaterThanOrEqual(0);
    sim.selectBagSlot(slot);
    expect(sim.placeCarriedBuilding(20,20,1,[7,6,7]).ok).toBe(false);
    expect(sim.snapshot().playerBag[slot]?.count).toBe(1);
    expect(sim.placeCarriedBuilding(20,20,1,[19.5,6,20.5]).ok).toBe(true);
    expect(sim.snapshot().playerBag[slot]).toBeNull();
    expect(sim.snapshot().buildings[0]).toMatchObject({kind,complete:true,rotation:1});
    expect(sim.snapshot().resources).toEqual(before);
  });
  it('rejects out-of-map rotations and upper-door obstructions without changing state or inventory',()=>{
    const{sim,world}=setup();
    for(const command of [{action:'build',kind:'bed',x:47,z:20,rotation:1},{action:'build',kind:'bed',x:20,z:47},{action:'build',kind:'door',x:20,z:20,rotation:4}]){
      const before=sim.serialize();expect(sim.command(command).ok).toBe(false);expect(sim.serialize()).toEqual(before);
    }
    world.set(20,7,20,BLOCK.Brick);const before=sim.serialize();
    expect(sim.command({action:'build',kind:'door',x:20,z:20,target:6}).ok).toBe(false);expect(sim.serialize()).toEqual(before);
  });
  it('reserves both vertical door parts even before construction and rejects interaction with a blueprint',()=>{
    const{sim}=setup(),order=sim.command({action:'build',kind:'door',x:20,z:20});expect(order.ok).toBe(true);
    expect(sim.buildingAtVoxel(20,6,20)?.id).toBe(order.id);expect(sim.buildingAtVoxel(20,7,20)?.id).toBe(order.id);
    expect(sim.buildingAtVoxel(20,8,20)).toBeUndefined();expect(sim.command({action:'toggleDoor',x:20,y:7,z:20}).ok).toBe(false);
    expect(sim.command({action:'build',kind:'bed',x:20,z:20,target:7}).ok).toBe(false);
  });
  it('uses full starter beds and workbenches without overlapping any voxel',()=>{
    const{world}=setup(),sim=new ColonySimulation(world),cells=new Set<string>();
    const initial=sim.snapshot();expect(initial.buildings.filter(b=>b.kind==='bed')).toHaveLength(3);
    for(const b of initial.buildings){expect({w:b.w,h:b.h,d:b.d}).toEqual(buildingDimensions(b.kind,b.rotation));for(const p of buildingParts(b)){const key=`${p.x},${p.y},${p.z}`;expect(cells.has(key)).toBe(false);cells.add(key);}}
  });
});

describe('campfire finale',()=>{
  it('levels a rotated site from an empty warehouse, gathers every resident, resumes a saved show and releases their work',()=>{
    const {world,sim}=setup(), state=sim.serialize() as ReturnType<typeof JSON.parse>;
    for (const key of Object.keys(state.resources)) state.resources[key]=0;
    for (const c of state.colonists) {
      c.priorities.construct=c.priorities.terraform=1;
      c.skills.construct=18;c.hunger=c.rest=100;c.schedule='day';
    }
    sim.load(state);
    world.set(18,6,19,BLOCK.Dirt);
    const order=sim.command({action:'build',kind:'campfirePlaza',x:14,z:14,target:6,rotation:1});
    expect(order.ok).toBe(true);
    expect(sim.snapshot().buildings[0]).toMatchObject({w:22,d:26,phase:'preparingTerrain',progress:0});
    for(let i=0;i<400 && !sim.finale;i++)sim.tick(.25);
    expect(sim.finale?.phase).toBe('gathering');
    expect(world.terrainHeight(18,19)).toBe(6);
    const beforeShow=sim.serialize() as typeof state;
    expect(beforeShow.resources).toEqual(state.resources);
    sim.tick(5.5);
    expect(sim.snapshot().colonists.map(c=>c.position)).toEqual(beforeShow.colonists.map((c:{position:number[]})=>c.position));
    for(let i=0;i<400 && sim.finale?.phase!=='show';i++)sim.tick(.25);
    expect(sim.finale).toMatchObject({phase:'show',arrived:3,guests:3});
    expect(sim.snapshot().hour).toBeGreaterThanOrEqual(21);
    sim.tick(5);
    sim.load(sim.serialize());
    expect(sim.finale).toMatchObject({phase:'show',elapsed:5});
    sim.tick(9);expect(sim.finale?.phase).toBe('departing');
    for(let i=0;i<400 && sim.finale;i++)sim.tick(.25);
    expect(sim.finale).toBeUndefined();
    const restored=sim.serialize() as typeof state;
    for(const guest of beforeShow.finale.guests){
      const c=restored.colonists.find((p:{id:string})=>p.id===guest.id);
      expect(c.position).toEqual(guest.home);expect(c.task).toBe(guest.task);
    }
    sim.load(restored);sim.tick(2);expect(sim.finale).toBeUndefined();
  });
});

describe('door state owns collision, routing and shelter',()=>{
  it('toggles either door half and changes both collision cells immediately',()=>{
    const{sim}=setup(),door=fixture('door',20,20,2);install(sim,door);
    expect(sim.blocksVoxel(20,6,20)).toBe(true);expect(sim.blocksVoxel(20,7,20)).toBe(true);
    expect(sim.command({action:'toggleDoor',x:20,y:7,z:20}).ok).toBe(true);
    expect(sim.blocksVoxel(20,6,20)).toBe(false);expect(sim.blocksVoxel(20,7,20)).toBe(false);
    expect(sim.command({action:'toggleDoor',x:20,y:6,z:20}).ok).toBe(true);expect(sim.blocksVoxel(20,7,20)).toBe(true);
  });
  it('refuses to close on a resident or the external player body and preserves state',()=>{
    const{sim}=setup(),door=fixture('door',20,20);door.doorOpen=true;install(sim,door);
    sim.setExternalOccupancySampler(()=>true);const before=sim.serialize();
    expect(sim.command({action:'toggleDoor',id:door.id}).ok).toBe(false);expect(sim.serialize()).toEqual(before);
    sim.setExternalOccupancySampler(()=>false);
    const save:any=sim.serialize();save.colonists[0].position=[20.5,6,20.5];sim.load(save);
    expect(sim.command({action:'toggleDoor',id:door.id}).ok).toBe(false);expect(sim.snapshot().buildings[0]!.doorOpen).toBe(true);
  });
  it('cancels a stale route through a newly closed door before the next movement step',()=>{
    const{sim}=setup(),door=fixture('door',20,20);door.doorOpen=true;install(sim,door);
    const save:any=sim.serialize(),c=save.colonists[0];c.position=[19.5,6,20.5];c.destination=[21.5,6,20.5];c.path=[[20.5,6,20.5],[21.5,6,20.5]];c.personal={kind:'wander',elapsed:0,duration:10,reserved:{}};sim.load(save);
    expect(sim.command({action:'toggleDoor',id:door.id}).ok).toBe(true);
    expect((sim.serialize() as any).colonists[0]).toMatchObject({path:[],personal:null});sim.tick(.25);expect(sim.snapshot().colonists[0]!.position[0]).toBeLessThan(20);
  });
  it('opening a closed bottleneck makes blocked real construction reachable',()=>{
    const{sim}=setup();const wall=Array.from({length:48},(_,z)=>fixture(z===20?'door':'wall',24,z));install(sim,...wall);
    for(const c of sim.snapshot().colonists)sim.command({action:'priority',colonistId:c.id,job:'construct',value:1});
    const order=sim.command({action:'build',kind:'floor',x:27,z:20});expect(order.ok).toBe(true);
    for(let i=0;i<160;i++)sim.tick(.25);expect(sim.snapshot().buildings.find(b=>b.id===order.id)!.complete).toBe(false);
    expect(sim.snapshot().jobs.find(j=>j.targetId===order.id)!.state).toBe('blocked');
    expect(sim.command({action:'toggleDoor',id:wall[20]!.id}).ok).toBe(true);
    for(let i=0;i<300&&!sim.snapshot().buildings.find(b=>b.id===order.id)!.complete;i++)sim.tick(.25);
    expect(sim.snapshot().buildings.find(b=>b.id===order.id)!.complete).toBe(true);
  });
  it('updates enclosure immediately on open, close and complete demolition',()=>{
    const{sim}=setup(),walls:BuildingView[]=[];for(let z=20;z<=24;z++)for(let x=20;x<=24;x++)if(x===20||x===24||z===20||z===24)walls.push(fixture(x===22&&z===24?'door':'wall',x,z));install(sim,...walls);
    const door=walls.find(b=>b.kind==='door')!;expect(sim.snapshot().rooms).toHaveLength(1);
    sim.command({action:'toggleDoor',id:door.id});expect(sim.snapshot().rooms).toHaveLength(0);
    sim.command({action:'toggleDoor',id:door.id});expect(sim.snapshot().rooms).toHaveLength(1);
    sim.command({action:'demolish',x:door.x,y:door.y+1,z:door.z});expect(sim.snapshot().rooms).toHaveLength(0);
  });
  it('releases a sleeping resident when their entire bed is demolished',()=>{
    const{sim}=setup(),bed=fixture('bed',20,20);install(sim,bed);
    const save:any=sim.serialize(),c=save.colonists[0];c.position=[19.5,6,20.5];c.destination=[20.5,6,20.5];c.personal={kind:'sleep',elapsed:3,duration:20,reserved:{},buildingId:bed.id};sim.load(save);
    sim.command({action:'demolish',x:20,y:6,z:21});expect((sim.serialize() as any).colonists[0]).toMatchObject({personal:null,destination:null,path:[]});
  });
  it('recomputes electricity immediately when facilities are demolished while paused',()=>{
    const{sim}=setup();install(sim,fixture('solar',20,20),fixture('battery',22,20),fixture('cooler',24,20));
    const save:any=sim.serialize();save.time=180;sim.load(save);sim.tick(.25);sim.command({action:'speed',value:0});
    const before=sim.snapshot();expect(before.power.stored).toBeGreaterThan(0);expect(before.power.coldStorage).toBe(true);
    expect(sim.command({action:'demolish',id:'fixture-solar-20-20'}).ok).toBe(true);
    expect(sim.snapshot().power).toMatchObject({generation:0,coldStorage:true,stored:before.power.stored});
    expect(sim.command({action:'demolish',id:'fixture-battery-22-20'}).ok).toBe(true);
    expect(sim.snapshot().power).toMatchObject({generation:0,demand:45,capacity:0,stored:0,supplied:0,coldStorage:false});
    expect(sim.command({action:'demolish',id:'fixture-cooler-24-20'}).ok).toBe(true);
    expect(sim.snapshot().power).toMatchObject({demand:0,supplied:0,coldStorage:false});expect(sim.snapshot().time).toBe(before.time);
  });
});

describe('strict round-trip persistence and atomic legacy migration',()=>{
  it('round-trips all rotations, linked parts, open doors and pending foundations',()=>{
    const{sim,world}=setup();for(const rotation of [0,1,2,3] as const){install(sim,fixture('bed',18+rotation*3,20,rotation),fixture('door',18+rotation*3,24,rotation));}
    sim.command({action:'toggleDoor',id:'fixture-door-21-24'});sim.command({action:'build',kind:'bed',x:20,z:28,rotation:3,target:7});
    const restored=new ColonySimulation(world);restored.load(sim.serialize());expect(restored.serialize()).toEqual(sim.serialize());expect(restored.snapshot()).toEqual(sim.snapshot());
    for(const b of restored.snapshot().buildings)for(const p of buildingParts(b))expect(restored.buildingAtVoxel(p.x,p.y,p.z)?.id).toBe(b.id);
  });
  it('rejects malformed dimensions, rotations, door state and overlapping instances atomically',()=>{
    const{sim}=setup();install(sim,fixture('bed',20,20),fixture('door',24,20));const before=sim.serialize();
    for(const corrupt of [(s:any)=>s.buildings[0].w=2,(s:any)=>s.buildings[0].rotation=4,(s:any)=>s.buildings[1].h=1,(s:any)=>delete s.buildings[1].doorOpen,(s:any)=>delete s.buildings[0].rotation,(s:any)=>s.buildings.push({...s.buildings[0],id:'duplicate'})]){
      const bad=JSON.parse(JSON.stringify(before));corrupt(bad);expect(()=>sim.load(bad)).toThrow();expect(sim.serialize()).toEqual(before);
    }
  });
  it('rejects a completed object intersecting a solid voxel in the saved world atomically',()=>{
    const{sim,world}=setup();install(sim,fixture('door',20,20));const before=sim.serialize();world.set(20,7,20,BLOCK.Brick);
    expect(()=>sim.load(before)).toThrow(/存档数据/);expect(sim.serialize()).toEqual(before);
    world.set(20,7,20,BLOCK.Air);expect(()=>sim.load(before)).not.toThrow();expect(sim.buildingAtVoxel(20,7,20)?.id).toBe('fixture-door-20-20');
  });
  it('expands legacy beds without overwriting their neighbors and migrates doors closed',()=>{
    const{sim}=setup();install(sim,fixture('bed',20,20),fixture('door',24,20));const legacy:any=sim.serialize();
    for(const b of legacy.buildings){b.w=1;b.d=1;delete b.h;delete b.rotation;delete b.doorOpen;}
    legacy.buildings.push({...fixture('wall',20,21),id:'neighbor'});sim.load(legacy);
    const state=sim.snapshot(),bed=state.buildings.find(b=>b.kind==='bed')!,door=state.buildings.find(b=>b.kind==='door')!;
    expect(bed).toMatchObject({w:1,h:1,d:2,rotation:0});expect(bed.x!==20||bed.z!==20).toBe(true);expect(sim.buildingAtVoxel(20,6,21)?.id).toBe('neighbor');expect(door.doorOpen).toBe(false);
    expect(sim.buildingAtVoxel(door.x,door.y+1,door.z)?.id).toBe(door.id);
  });
  it('does not partially load a legacy bed when no safe full-size position exists',()=>{
    const{sim,world}=setup();install(sim,fixture('bed',20,20));const legacy:any=sim.serialize();legacy.buildings[0].w=1;legacy.buildings[0].d=1;delete legacy.buildings[0].h;delete legacy.buildings[0].rotation;
    const edits=[];for(let z=0;z<48;z++)for(let x=0;x<48;x++)edits.push({x,y:6,z,block:BLOCK.Planks});world.edit(edits);
    const before=sim.serialize();expect(()=>sim.load(legacy)).toThrow(/安全的完整占地/);expect(sim.serialize()).toEqual(before);
  });
});
