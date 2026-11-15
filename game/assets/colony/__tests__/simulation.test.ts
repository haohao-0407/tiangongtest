import { describe, expect, it } from 'vitest';
import { BLOCK, VoxelWorld } from '../../voxel/model.ts';
import { BUILDING_DEFS, ColonySimulation, DAY_SECONDS, JOB_TYPES, RESOURCE_TYPES } from '../simulation.ts';

function setup(seed='colony-test') { const world=VoxelWorld.deserialize(JSON.stringify({version:1,generatorVersion:1,seed,size:[48,24,48],edits:[]}));return {world,sim:new ColonySimulation(world)}; }
function run(sim:ColonySimulation,seconds:number) { for(let i=0;i<seconds*4;i++)sim.tick(.25); }
function onlyJob(sim:ColonySimulation,job:string) {
  for(const c of sim.snapshot().colonists)for(const type of JOB_TYPES)sim.command({action:'priority',colonistId:c.id,job:type,value:type===job?1:0});
}
function freeCell(sim:ColonySimulation,world:VoxelWorld) {
  const snap=sim.snapshot();
  for(let z=20;z<34;z++)for(let x=20;x<34;x++){
    if(world.surfaceHeight(x,z)!==5||snap.buildings.some(b=>b.x===x&&b.z===z)||snap.crops.some(c=>c.x===x&&c.z===z))continue;
    return{x,z};
  }throw new Error('fixture lacks a free clearing cell');
}
const raw = (sim:ColonySimulation):any => sim.serialize();

describe('peaceful colony and fixed-step persistence',()=>{
  it('starts with real residents, facilities, stores and growing jobs',()=>{
    const{sim}=setup(),s=sim.snapshot();
    expect(s.colonists).toHaveLength(3);
    expect(s.buildings.filter(b=>b.kind==='bed'&&b.complete)).toHaveLength(3);
    for(const kind of ['stove','table','workbench','researchDesk'])expect(s.buildings.some(b=>b.kind===kind&&b.complete)).toBe(true);
    expect(s.resources.wood).toBeGreaterThan(0);expect(s.items.length).toBeGreaterThan(0);
    expect(s.zones.map(z=>z.kind)).toEqual(expect.arrayContaining(['farm','stockpile']));
    expect(s.jobs.some(j=>j.type==='grow')).toBe(true);
    expect(s.colonists.every(c=>Object.values(c.priorities).every(p=>p>=0&&p<=4))).toBe(true);
  });
  it('pauses every simulation quantity and saves an exact restartable state',()=>{
    const{sim,world}=setup();run(sim,12.5);sim.command({action:'speed',value:0});
    const before=sim.snapshot(),serialized=sim.serialize();sim.tick(30);
    expect(sim.snapshot()).toEqual(before);expect(sim.serialize()).toEqual(serialized);
    const restored=new ColonySimulation(world);restored.load(serialized);
    expect(restored.snapshot()).toEqual(before);expect(restored.serialize()).toEqual(serialized);
    sim.command({action:'speed',value:3});restored.command({action:'speed',value:3});
    run(sim,30);run(restored,30);
    expect(restored.serialize()).toEqual(sim.serialize());
  });
  it('keeps deterministic results across tick partitions and speed modes',()=>{
    const a=setup('step'),b=setup('step');
    for(let i=0;i<400;i++)a.sim.tick(.1);
    b.sim.command({action:'speed',value:3});b.sim.tick(10);b.sim.command({action:'speed',value:1});b.sim.tick(10);
    expect(a.sim.snapshot()).toEqual(b.sim.snapshot());
  });
  it('rejects corrupt loads atomically, including broken job references',()=>{
    const{sim}=setup();run(sim,5);const before=sim.serialize();
    const bads=[null,{}, {...raw(sim),version:9},{...raw(sim),worldSeed:'wrong'},{...raw(sim),resources:{...raw(sim).resources,wood:-5}}];
    const wrongRef=raw(sim);wrongRef.colonists[0].jobId='missing';bads.push(wrongRef);
    const badPath=raw(sim);badPath.colonists[0].path=[[1.5,6,1.5],[10.5,6,10.5]];bads.push(badPath);
    for(const bad of bads){expect(()=>sim.load(bad)).toThrow();expect(sim.serialize()).toEqual(before);}
  });
});

describe('inventory reservation, work and walking',()=>{
  it('reserves construction once, cancels once and conserves materials',()=>{
    const{sim,world}=setup();sim.command({action:'speed',value:0});
    const pos=freeCell(sim,world),before=sim.snapshot().resources;
    const order=sim.command({action:'build',kind:'bed',...pos});expect(order.ok).toBe(true);
    const b=sim.snapshot().buildings.find(b=>b.id===order.id)!;
    expect(b.reserved).toEqual(BUILDING_DEFS.bed.cost);expect(b.progress).toBe(0);
    expect(sim.snapshot().resources.wood).toBe(before.wood-12);
    expect(sim.command({action:'build',kind:'bed',...pos}).ok).toBe(false);
    expect(sim.command({action:'cancel',id:order.id}).ok).toBe(true);
    expect(sim.snapshot().resources).toEqual(before);
    expect(sim.command({action:'cancel',id:order.id}).ok).toBe(false);
    expect(sim.snapshot().resources).toEqual(before);
  });
  it('walks to a blueprint, takes time and completes without a second debit',()=>{
    const{sim,world}=setup();onlyJob(sim,'construct');
    const pos=freeCell(sim,world),before=sim.snapshot();
    const result=sim.command({action:'build',kind:'bed',...pos});expect(result.ok).toBe(true);
    run(sim,.25);const first=sim.snapshot();
    expect(first.buildings.find(b=>b.id===result.id)!.complete).toBe(false);
    for(let i=0;i<3;i++)expect(Math.hypot(...first.colonists[i]!.position.map((v,k)=>v-before.colonists[i]!.position[k]!))).toBeLessThanOrEqual(.53);
    run(sim,80);const after=sim.snapshot(),building=after.buildings.find(b=>b.id===result.id)!;
    expect(building.complete).toBe(true);expect(building.progress).toBe(1);expect(building.reserved).toEqual({});
    expect(after.resources.wood).toBe(before.resources.wood-12);expect(after.metrics.distanceWalked).toBeGreaterThan(1);
    expect(after.jobs.some(j=>j.targetId===result.id)).toBe(false);
    expect(sim.command({action:'cancel',id:result.id}).ok).toBe(false);
  });
  it('keeps dropped material unavailable until it is carried into a stockpile',()=>{
    const{sim}=setup();onlyJob(sim,'haul');const before=sim.snapshot();
    expect(before.items.filter(i=>i.resource==='wood').reduce((sum,i)=>sum+i.amount,0)).toBe(12);
    const starts=before.resources.wood;
    run(sim,.5);expect(sim.snapshot().resources.wood).toBe(starts);
    run(sim,30);expect(sim.snapshot().resources.wood).toBe(starts+12);
    expect(sim.snapshot().metrics.hauled).toBe(22);expect(sim.snapshot().items).toHaveLength(0);
  });
  it('uses another reachable stockpile cell when the first cell is enclosed',()=>{
    const{sim}=setup();onlyJob(sim,'construct');
    for(const[x,z]of[[22,26],[24,26],[23,25],[23,27]])expect(sim.command({action:'build',kind:'wall',x,z}).ok).toBe(true);
    run(sim,65);expect(sim.snapshot().buildings.filter(b=>b.kind==='wall'&&b.complete)).toHaveLength(4);
    onlyJob(sim,'haul');run(sim,60);
    expect(sim.snapshot().metrics.hauled).toBe(22);expect(sim.snapshot().items).toHaveLength(0);
  });
  it('returns carried items to the ground when work is disabled without duplication',()=>{
    const{sim}=setup();onlyJob(sim,'haul');
    let carrier;
    for(let i=0;i<80;i++){sim.tick(.25);carrier=sim.snapshot().colonists.find(c=>Object.values(c.carrying).some(v=>v!>0));if(carrier)break;}
    expect(carrier).toBeDefined();
    const amount=()=>sim.snapshot().resources.wood+sim.snapshot().items.filter(i=>i.resource==='wood').reduce((n,i)=>n+i.amount,0)+sim.snapshot().colonists.reduce((n,c)=>n+(c.carrying.wood??0),0);
    const before=amount();sim.command({action:'priority',colonistId:carrier!.id,job:'haul',value:0});expect(amount()).toBe(before);
    run(sim,30);expect(amount()).toBe(before);
  });
  it('water and complete walls block routes rather than teleport residents',()=>{
    const{sim,world}=setup();onlyJob(sim,'construct');
    const pos=freeCell(sim,world);const save=raw(sim);
    const ground=[];for(let z=pos.z-1;z<=pos.z+1;z++)for(let x=pos.x-1;x<=pos.x+1;x++)for(let y=1;y<world.height;y++)ground.push({x,y,z,block:y<5?BLOCK.Dirt:y===5?BLOCK.Grass:BLOCK.Air});world.edit(ground);
    // This isolated fixture encloses the blueprint with actual completed walls.
    for(const[dx,dz]of[[1,0],[-1,0],[0,1],[0,-1]])save.buildings.push({id:`test-wall-${dx}-${dz}`,kind:'wall',x:pos.x+dx!,y:6,z:pos.z+dz!,complete:true,progress:1,reserved:{},powered:false,comfort:0,roomId:null});
    sim.load(save);const order=sim.command({action:'build',kind:'floor',...pos});expect(order.ok).toBe(true);
    run(sim,60);expect(sim.snapshot().buildings.find(b=>b.id===order.id)!.complete).toBe(false);
    expect(sim.snapshot().jobs.find(j=>j.targetId===order.id)!.state).toBe('blocked');
  });
});

describe('resident needs and civilian production',()=>{
  it('hungry residents walk to food and consume exactly one reserved meal',()=>{
    const{sim}=setup();for(const c of sim.snapshot().colonists)for(const j of JOB_TYPES)sim.command({action:'priority',colonistId:c.id,job:j,value:0});
    const data=raw(sim);data.colonists[0].hunger=10;sim.load(data);const meals=sim.snapshot().resources.meal;
    run(sim,25);const s=sim.snapshot();expect(s.colonists[0]!.hunger).toBeGreaterThan(65);expect(s.resources.meal).toBe(meals-1);
  });
  it('falls back to a reachable stockpile when the dining table is enclosed',()=>{
    const{sim}=setup();onlyJob(sim,'construct');
    // Full-size starter beds now extend into this enclosure's north wall.
    for(const[x,z]of[[27,26],[29,26],[28,25],[28,27]]){
      const existing=sim.snapshot().buildings.find(b=>x>=b.x&&x<b.x+b.w&&z>=b.z&&z<b.z+b.d);
      if(existing)expect(sim.command({action:'demolish',id:existing.id}).ok).toBe(true);
      expect(sim.command({action:'build',kind:'wall',x,z}).ok).toBe(true);
    }
    run(sim,65);expect(sim.snapshot().buildings.filter(b=>b.kind==='wall'&&b.complete)).toHaveLength(4);
    for(const c of sim.snapshot().colonists)for(const j of JOB_TYPES)sim.command({action:'priority',colonistId:c.id,job:j,value:0});
    const before=sim.snapshot().resources.meal;run(sim,500);
    expect(sim.snapshot().colonists.every(c=>c.hunger>10)).toBe(true);expect(sim.snapshot().resources.meal).toBeLessThan(before);
  });
  it('medical rest can be interrupted to eat rather than starving beside available food',()=>{
    const{sim}=setup();for(const c of sim.snapshot().colonists)sim.command({action:'priority',colonistId:c.id,job:'doctor',value:0});
    run(sim,700);const s=sim.snapshot();expect(s.colonists.some(c=>c.disease>15)).toBe(true);
    expect(s.colonists.every(c=>c.hunger>5)).toBe(true);expect(s.resources.food+s.resources.meal).toBeGreaterThan(0);
  });
  it('beds improve rest more than sleeping on the ground',()=>{
    const{sim,world}=setup(),data=raw(sim);data.time=DAY_SECONDS*23/24;
    data.jobs=[];data.colonists.forEach((c:any)=>{c.rest=10;c.hunger=90;JOB_TYPES.forEach(j=>c.priorities[j]=0);});sim.load(data);
    const without=copySave(data);without.buildings=without.buildings.filter((b:any)=>b.kind!=='bed');const ground=new ColonySimulation(world);ground.load(without);
    run(sim,40);run(ground,40);expect(sim.snapshot().colonists[0]!.rest).toBeGreaterThan(ground.snapshot().colonists[0]!.rest+8);
  });
  it('rest schedules suppress work while sleep and recreation recover needs',()=>{
    const{sim}=setup(),data=raw(sim);data.time=DAY_SECONDS*22/24;data.colonists[0].rest=12;data.colonists[0].recreation=12;data.colonists[0].schedule='rest';sim.load(data);
    run(sim,60);const s=sim.snapshot();expect(s.colonists[0]!.rest).toBeGreaterThan(45);expect(s.colonists[0]!.jobId).toBeNull();
    const day=raw(sim);day.time=DAY_SECONDS+DAY_SECONDS*10/24;day.lastDay=2;day.colonists[0].personal=null;day.colonists[0].path=[];day.colonists[0].rest=90;sim.load(day);
    run(sim,25);expect(sim.snapshot().colonists[0]!.recreation).toBeGreaterThan(30);
  });
  it('plants, grows, harvests, hauls and cooks through real work queues',()=>{
    const{sim}=setup();run(sim,220);const s=sim.snapshot();
    expect(s.metrics.harvested).toBeGreaterThan(0);expect(s.metrics.hauled).toBeGreaterThan(22);expect(s.metrics.cooked).toBeGreaterThan(0);
    expect(s.crops.some(c=>c.planted)).toBe(true);expect(s.resources.food+s.items.filter(i=>i.resource==='food').reduce((n,i)=>n+i.amount,0)).toBeGreaterThan(10);
    expect(RESOURCE_TYPES.every(r=>s.resources[r]>=0&&Number.isInteger(s.resources[r]))).toBe(true);
  });
  it('production targets include ground and carried products, so no hauling does not cause overproduction',()=>{
    const{sim}=setup();onlyJob(sim,'cook');run(sim,100);const s=sim.snapshot();
    const total=s.resources.meal+s.items.filter(i=>i.resource==='meal').reduce((n,i)=>n+i.amount,0)+s.colonists.reduce((n,c)=>n+(c.carrying.meal??0),0);
    expect(total).toBeGreaterThanOrEqual(s.bills.meal);expect(total).toBeLessThan(s.bills.meal+3);
    expect(s.metrics.cooked).toBe(3);expect(s.resources.food+s.metrics.spoiled).toBe(38);
  });
  it('doctors reserve medicine and treat disease at the patient location',()=>{
    const{sim}=setup();onlyJob(sim,'doctor');const data=raw(sim);data.colonists[0].disease=65;data.colonists[0].health=60;sim.load(data);const before=sim.snapshot();
    run(sim,50);const after=sim.snapshot();expect(after.metrics.treated).toBeGreaterThan(0);expect(after.colonists[0]!.disease).toBeLessThan(20);
    expect(after.resources.medicine).toBeLessThan(before.resources.medicine);expect(after.colonists[0]!.health).toBeGreaterThan(before.colonists[0]!.health);
  });
  it('extracts resources only after completing a tree or mining job',()=>{
    const{sim,world}=setup();onlyJob(sim,'chop');let tree:{x:number;z:number}|undefined;
    for(let z=16;z<38&&!tree;z++)for(let x=18;x<40;x++)if(Array.from({length:22},(_,y)=>world.get(x,y+1,z)).includes(BLOCK.Wood)){tree={x,z};break;}
    expect(tree).toBeDefined();const initialWood=sim.snapshot().resources.wood;
    expect(sim.command({action:'designate',kind:'chop',...tree}).ok).toBe(true);run(sim,90);
    expect(sim.snapshot().resources.wood).toBe(initialWood);expect(sim.snapshot().items.filter(i=>i.resource==='wood').reduce((n,i)=>n+i.amount,0)).toBeGreaterThan(12);
    onlyJob(sim,'mine');const pos=freeCell(sim,world),h=world.surfaceHeight(pos.x,pos.z);
    expect(sim.command({action:'designate',kind:'mine',...pos}).ok).toBe(true);run(sim,60);
    expect(world.surfaceHeight(pos.x,pos.z)).toBe(h-1);expect(sim.snapshot().items.some(i=>i.resource==='stone')).toBe(true);
  });
});

describe('research, shelter, electricity and constrained trade',()=>{
  it('research unlocks an actual new building, without bypassing prerequisite checks',()=>{
    const{sim,world}=setup();onlyJob(sim,'research');const pos=freeCell(sim,world);
    expect(sim.command({action:'build',kind:'solar',...pos}).ok).toBe(false);
    expect(sim.command({action:'research',id:'refrigeration'}).ok).toBe(false);
    expect(sim.command({action:'research',id:'electricity'}).ok).toBe(true);run(sim,135);
    expect(sim.snapshot().research.completed).toContain('electricity');expect(sim.snapshot().research.progress.electricity).toBe(110);
    expect(sim.command({action:'build',kind:'solar',...pos}).ok).toBe(true);
  });
  it('enclosed walls and a closed door create a small comfortable room',()=>{
    const{sim,world}=setup(),data=raw(sim);data.buildings=[];
    const ground=[];for(let z=20;z<=24;z++)for(let x=20;x<=24;x++)for(let y=1;y<world.height;y++)ground.push({x,y,z,block:y<5?BLOCK.Dirt:y===5?BLOCK.Grass:BLOCK.Air});world.edit(ground);
    for(let z=20;z<=24;z++)for(let x=20;x<=24;x++)if(x===20||x===24||z===20||z===24)data.buildings.push({id:`wall-${x}-${z}`,kind:x===22&&z===24?'door':'wall',x,y:6,z,complete:true,progress:1,reserved:{},powered:false,comfort:0,roomId:null});
    data.jobs=data.jobs.filter((j:any)=>!['cook','craft'].includes(j.type));data.colonists.forEach((c:any)=>{c.jobId=null;c.path=[];});
    sim.load(data);const room=sim.snapshot().rooms[0]!;expect(room.enclosed).toBe(true);expect(room.cells).toHaveLength(9);expect(room.comfort).toBeGreaterThan(0);
  });
  it('solar generation charges batteries, powers cold storage and slows spoilage',()=>{
    const{sim}=setup(),data=raw(sim);data.time=DAY_SECONDS/2;data.resources.food=500;data.resources.meal=500;
    for(const[kind,x]of[['solar',33],['battery',34],['cooler',35]]as const)data.buildings.push({id:`power-${kind}`,kind,x,y:6,z:30,complete:true,progress:1,reserved:{},powered:false,comfort:0,roomId:null});
    data.research.completed=['electricity','refrigeration'];data.research.progress={electricity:110,refrigeration:130};data.colonists.forEach((c:any)=>JOB_TYPES.forEach(j=>c.priorities[j]=0));data.jobs=[];sim.load(data);
    const normal=setup().sim,unpowered=raw(sim);unpowered.buildings=unpowered.buildings.filter((b:any)=>!['solar','battery','cooler'].includes(b.kind));normal.load(unpowered);
    run(sim,100);run(normal,100);const p=sim.snapshot().power;
    expect(p.capacity).toBe(12000);expect(p.stored).toBeGreaterThan(0);expect(p.coldStorage).toBe(true);
    expect(sim.snapshot().metrics.spoiled).toBeLessThan(normal.snapshot().metrics.spoiled);
  });
  it('trades conserve currency and stock; purchased cargo is not instantly available',()=>{
    const{sim}=setup();sim.command({action:'speed',value:0});const before=sim.snapshot();
    expect(sim.command({action:'trade',resource:'wood',amount:3,buy:true}).ok).toBe(true);
    const bought=sim.snapshot();expect(bought.resources.wood).toBe(before.resources.wood);expect(bought.resources.silver).toBe(before.resources.silver-6);expect(bought.trade.stock.wood).toBe(before.trade.stock.wood-3);
    const expected=bought.resources.silver+bought.trade.stock.silver;expect(sim.command({action:'trade',resource:'wood',amount:2,buy:false}).ok).toBe(true);
    const sold=sim.snapshot();expect(sold.resources.wood).toBe(before.resources.wood-2);expect(sold.resources.silver+sold.trade.stock.silver).toBe(expected);
    const final=sim.serialize();expect(sim.command({action:'trade',resource:'components',amount:100,buy:true}).ok).toBe(false);expect(sim.serialize()).toEqual(final);
  });
  it('a purchase with no landing space rejects before debiting either party',()=>{
    const{sim,world}=setup();const edits=[];
    for(let z=0;z<48;z++)for(let x=0;x<48;x++)for(let y=1;y<24;y++)edits.push({x,y,z,block:BLOCK.Water});
    world.edit(edits);sim.tick(.25);sim.command({action:'speed',value:0});
    const before=sim.serialize();expect(sim.command({action:'trade',resource:'wood',amount:1,buy:true}).ok).toBe(false);expect(sim.serialize()).toEqual(before);
  });
  it('advances seasons, weather, illness and peaceful arrivals without combat events',()=>{
    const{sim}=setup();run(sim,DAY_SECONDS*4);const s=sim.snapshot();
    expect(s.day).toBeGreaterThanOrEqual(5);expect(s.colonists).toHaveLength(4);
    expect(s.events.some(e=>e.type==='arrival')).toBe(true);expect(s.events.some(e=>e.type==='health')).toBe(true);expect(s.events.some(e=>e.type==='weather')).toBe(true);
    expect(s.events.some(e=>/袭击|敌人|战斗|武器|击杀/.test(e.text))).toBe(false);
    expect(RESOURCE_TYPES.every(r=>s.resources[r]>=0)).toBe(true);
  });
});
function copySave<T>(value:T):T{return JSON.parse(JSON.stringify(value)) as T;}
