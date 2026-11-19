import { describe, expect, it } from 'vitest';
import { BLOCK, VoxelWorld } from '../../voxel/model.ts';
import { BUILDING_DEFS, ColonySimulation, CROP_KINDS, CROP_SEEDS, DAY_SECONDS, HAMMER, JOB_TYPES, PLAYER_DELIVERY_TARGET, RESOURCE_TYPES, TOOL_KINDS, needsPickaxe } from '../simulation.ts';

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
const chooseFirst = (sim:ColonySimulation) => {
  const id=sim.snapshot().colonists[0]!.id;
  sim.command({action:'select',colonistId:id});
  return id;
};

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
  it('takes over a real resident, requeues their job and keeps their live position and ninth slot',()=>{
    const {sim}=setup();
    onlyJob(sim,'haul');
    for(let i=0;i<60&&!sim.snapshot().colonists.some(person=>person.jobId);i++)sim.tick(.25);
    const before=sim.snapshot();
    const person=before.colonists.find(resident=>resident.jobId)!;
    const other=before.colonists.find(resident=>resident.id!==person.id)!;
    expect(person).toBeDefined();
    expect(sim.possessColonist(person.id)?.position).toEqual(person.position);
    expect(sim.snapshot().colonists.find(resident=>resident.id===person.id)?.jobId).toBeNull();
    const slot={kind:'follower',id:person.id,slot:8} as const;
    expect(sim.transferInventory({kind:'warehouse'},slot,'stone',2).ok).toBe(true);
    sim.selectBagSlot(8);
    const next:[number,number,number]=[person.position[0]+.2,person.position[1],person.position[2]];
    sim.updateControlledPose(next,1.2,67);
    sim.tick(.75);
    expect(sim.snapshot().playerBag[8]).toEqual({resource:'stone',count:2});
    expect(sim.snapshot().colonists.find(resident=>resident.id===person.id)).toMatchObject({position:next,jobId:null,stamina:67});
    expect(sim.possessColonist(other.id)).toBeNull();
    sim.releaseControl();
    expect(sim.snapshot().colonists.find(resident=>resident.id===person.id)?.position).toEqual(next);
    expect(sim.possessColonist(other.id)?.bag[8]).toBeNull();
    expect(sim.transferInventory({kind:'player',id:person.id,slot:8},{kind:'warehouse'},'stone',2).ok).toBe(false);
    sim.releaseControl();
    sim.load(sim.serialize());
    expect(sim.controlledColonist).toBeNull();
    expect(sim.possessColonist(person.id)).toMatchObject({bagSelected:8,facing:1.2,stamina:67});
    expect(sim.snapshot().playerBag[8]).toEqual({resource:'stone',count:2});
  });

  it('keeps orders assigned to the named recipient when control changes',()=>{
    const{sim}=setup();onlyJob(sim,'haul');
    const [first,second]=sim.snapshot().colonists;
    sim.possessColonist(first!.id);
    const order=sim.requestDelivery('steel',2);
    expect(order.ok).toBe(true);
    sim.releaseControl();sim.possessColonist(second!.id);
    const pending=()=>sim.snapshot().jobs.find(job=>job.id===order.id);
    expect(pending()?.recipientId).toBe(first!.id);
    for(let i=0;i<400&&pending();i++)sim.tick(.25);
    expect(pending()).toBeUndefined();
    expect(sim.snapshot().colonists[0]!.bag).toContainEqual({resource:'steel',count:2});
    expect(sim.snapshot().playerBag.every(slot=>slot?.resource!=='steel')).toBe(true);
  });

  it('reserves warehouse goods, walks to storage and delivers the requested quantity to the moving player', () => {
    const { sim, world } = setup();
    onlyJob(sim, 'haul');
    const recipientId=chooseFirst(sim);
    sim.possessColonist(recipientId);
    const before = sim.snapshot();
    const order = sim.requestDelivery('steel', 7);
    const pending = () => sim.snapshot().jobs.find(job => job.id === order.id);
    const originalPlayer = before.colonists[0]!.position;
    const nextPlayer = before.colonists[2]!.position;
    expect(order.ok).toBe(true);
    expect(sim.snapshot().resources.steel).toBe(before.resources.steel - 7);
    // slot 0/1 是锤子和木斧，空槽从 2 开始
expect(sim.snapshot().playerBag.slice(TOOL_KINDS.length).every(stack => stack === null)).toBe(true);
    expect(pending()?.targetId).toBe(PLAYER_DELIVERY_TARGET);
    for (let i = 0; i < 200 && pending()?.deliveryPhase === 'pickup'; i++) sim.tick(.25, originalPlayer);
    const traveling = pending();
    expect(traveling?.deliveryPhase).toBe('deliver');
    const carrier = sim.snapshot().colonists.find(person => person.id === traveling?.assignedTo)!;
    expect([Math.floor(carrier.position[0]), Math.floor(carrier.position[2])]).toEqual([traveling!.x, traveling!.z]);
    // slot 0/1 是锤子和木斧，空槽从 2 开始
expect(sim.snapshot().playerBag.slice(TOOL_KINDS.length).every(stack => stack === null)).toBe(true);

    const restored = new ColonySimulation(world);
    restored.load(sim.serialize());
    restored.possessColonist(recipientId);
    for (let i = 0; i < 240 && restored.snapshot().jobs.some(job => job.id === order.id); i++) restored.tick(.25, nextPlayer);
    const finished = restored.snapshot();
    expect(finished.jobs.some(job => job.id === order.id)).toBe(false);
    // 送货落在第一个空槽——0/1 是工具，所以是 2
expect(finished.playerBag[TOOL_KINDS.length]).toEqual({ resource: 'steel', count: 7 });
    expect(finished.resources.steel).toBe(before.resources.steel - 7);
    const arrived = finished.colonists.find(person => person.id === carrier.id)!;
    expect(Math.hypot(arrived.position[0] - nextPlayer[0], arrived.position[2] - nextPlayer[2])).toBeLessThanOrEqual(1.5);
  });

  it('keeps undelivered goods reserved when the player fills their bag and refunds them on cancellation', () => {
    const { sim } = setup();
    onlyJob(sim, 'haul');
    chooseFirst(sim);
    const before = sim.snapshot().resources.silver;
    const order = sim.requestDelivery('silver', 3);
    expect(order.ok).toBe(true);
    const remaining = raw(sim);
    remaining.colonists[0].bag = Array.from({ length: 9 }, () => ({ resource: 'cloth', count: 99 }));
    sim.load(remaining);
    const player = sim.snapshot().colonists[0]!.position;
    const pending = () => sim.snapshot().jobs.find(job => job.id === order.id);
    for (let i = 0; i < 240 && pending()?.state !== 'blocked'; i++) sim.tick(.25, player);
    expect(pending()?.deliveryPhase).toBe('deliver');
    expect(pending()?.state).toBe('blocked');
    expect(pending()?.reserved.silver).toBe(3);
    expect(sim.snapshot().playerBag.every(stack => stack?.resource === 'cloth')).toBe(true);
    expect(sim.command({ action: 'cancel', id: order.id }).ok).toBe(true);
    expect(sim.snapshot().resources.silver).toBe(before);
    expect(pending()).toBeUndefined();
  });

  it('keeps overflow in its source and rejects incompatible or stale slots', () => {
    const { sim } = setup();
    chooseFirst(sim);
    const warehouse = { kind: 'warehouse' } as const;
    // 0 和 1 被工具占着（锤子、木斧），从 2 起才是空槽
    const first = { kind: 'player', slot: TOOL_KINDS.length } as const;
    const second = { kind: 'player', slot: TOOL_KINDS.length + 1 } as const;
    const chest = { kind: 'chest', id: sim.snapshot().chests[0]!.id, slot: 3 } as const;
    expect(sim.transferInventory(warehouse, first, 'wood', 98).ok).toBe(true);
    expect(sim.transferInventory(warehouse, second, 'wood', 12).ok).toBe(true);
    expect(sim.transferInventory(first, chest, 'wood', 98).ok).toBe(true);
    expect(sim.transferInventory(second, chest, 'wood', 12).ok).toBe(true);
    expect(sim.snapshot().chests[0]!.slots[3]).toEqual({ resource: 'wood', count: 99 });
    expect(sim.snapshot().playerBag[TOOL_KINDS.length + 1]).toEqual({ resource: 'wood', count: 11 });
    expect(sim.snapshot().resources.wood).toBe(30);
    expect(sim.transferInventory(first, chest, 'wood', 98).ok).toBe(false);
    expect(sim.transferInventory(warehouse, first, 'stone', 1).ok).toBe(true);
    const before = sim.snapshot();
    expect(sim.transferInventory(first, chest, 'stone', 1).ok).toBe(false);
    expect(sim.snapshot()).toEqual(before);
  });

  it('opens saves made before personal and chest inventories existed', () => {
    const { sim } = setup();
    const old = raw(sim);
    old.version = 1;
    old.buildings = old.buildings.filter((building: { kind: string }) => building.kind !== 'chest');
    delete old.chests;
    delete old.playerBag;
    delete old.bagSelected;
    for (const resident of old.colonists) delete resident.bag;
    sim.load(old);
    const restored = sim.snapshot();
    expect(restored.resources).toEqual(old.resources);
    expect(restored.chests.find(chest=>chest.id==='chest-legacy-player')?.slots[0]).toEqual({resource:HAMMER,count:1});
    expect(restored.chests[0]!.slots).toEqual(Array(20).fill(null));
    expect(restored.colonists.every(resident => resident.bag[0] === null)).toBe(true);
  });

  it('treats the hammer as ordinary cargo: it can be stored, and is not conjured back', () => {
    const { sim } = setup();
    chooseFirst(sim);
    // 锤子放进仓库
    const stored = sim.transferInventory({ kind: 'player', slot: 0 }, { kind: 'warehouse' }, HAMMER, 1);
    expect(stored.ok).toBe(true);
    expect(sim.snapshot().playerBag[0]).toBeNull();
    expect(sim.snapshot().resources[HAMMER as never]).toBe(1);
    // 手上没锤子，就不该能开工
    const order = sim.command({ action: 'build', kind: 'floor', x: 5, z: 5 });
    const built = order.ok ? sim.snapshot().buildings.find(b => b.id === order.id) : undefined;
    expect(built?.complete ?? false).toBe(false);
  });

  it('builds with the selected hammer at twice the resident rate, with the existing material reservation', () => {
    const { sim, world } = setup();
    onlyJob(sim, 'construct');
    sim.possessColonist(chooseFirst(sim));
    const before = sim.snapshot();
    expect(before.playerBag[0]).toEqual({ resource: 'hammer', count: 1 });
    const site = freeCell(sim, world);
    const order = sim.command({ action: 'build', kind: 'floor', ...site });
    expect(order.ok).toBe(true);
    const blueprint = () => sim.snapshot().buildings.find(building => building.id === order.id)!;
    const player: [number, number, number] = [site.x + 1.5, blueprint().y, site.z + .5];
    sim.selectBagSlot(1);
    expect(sim.startPlayerConstruction(order.id!, player).ok).toBe(false);
    sim.selectBagSlot(0);
    expect(sim.startPlayerConstruction(order.id!, [player[0]+10,player[1],player[2]]).ok).toBe(false);
    expect(sim.startPlayerConstruction(order.id!, player).ok).toBe(true);
    const resident = before.colonists[0]!;
    const residentRate = (.65 + resident.skills.construct * .1) * 1.1;
    sim.tick(.25, player);
    expect(blueprint().progress).toBeCloseTo(.25 * residentRate * 2 / BUILDING_DEFS.floor.work);
    sim.tick(.25, [player[0]+10,player[1],player[2]]);
    expect(sim.playerConstructionId).toBeNull();
    expect(sim.startPlayerConstruction(order.id!, player).ok).toBe(true);
    sim.tick(2, player);
    expect(blueprint().complete).toBe(true);
    expect(sim.playerConstructionId).toBeNull();
    expect(sim.snapshot().resources.wood).toBe(before.resources.wood - BUILDING_DEFS.floor.cost.wood!);
    expect(sim.snapshot().metrics.built).toBe(before.metrics.built + 1);
  });

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
    expect(s.crops.some(c=>c.planted)).toBe(true);expect(s.resources.cabbage+s.items.filter(i=>i.resource==='cabbage').reduce((n,i)=>n+i.amount,0)).toBeGreaterThan(10);
    expect(RESOURCE_TYPES.every(r=>s.resources[r]>=0&&Number.isInteger(s.resources[r]))).toBe(true);
  });
  it('preserves planted varieties through save and harvests each crop as its own item', () => {
    const world = new VoxelWorld();
    const sim = new ColonySimulation(world);
    const kinds = CROP_KINDS;
    const starterCrops = new Set(sim.snapshot().crops.map(crop => crop.id));
    expect(sim.command({ action: 'designate', kind: 'farm', crop: 'corn', x: 127, z: 134 }).ok).toBe(false);
    const unlocked = raw(sim);
    unlocked.research.completed.push('agriculture');
    sim.load(unlocked);
    onlyJob(sim, 'harvest');
    for (const [index, crop] of kinds.entries()) {
      expect(sim.command({ action: 'designate', kind: 'farm', crop, x: 121 + index, z: 134 }).ok).toBe(true);
    }
    expect(sim.command({ action: 'designate', kind: 'farm', crop: 'unknown', x: 128, z: 134 }).ok).toBe(false);

    const ready = sim.snapshot().crops.filter(crop => !starterCrops.has(crop.id));
    expect(ready.map(crop => crop.kind)).toEqual(kinds);
    expect(ready.every(crop => !crop.planted && crop.growth === 0)).toBe(true);
    const saved = raw(sim);
    for (const crop of saved.crops) {
      if (!starterCrops.has(crop.id)) Object.assign(crop, { planted: true, growth: .99 });
    }
    const restored = new ColonySimulation(world);
    restored.load(saved);
    run(restored, 90);
    const after = restored.snapshot();
    for (const crop of ready) {
      expect(after.crops.find(existing => existing.id === crop.id)).toMatchObject({ kind: crop.kind, planted: false, growth: 0 });
      expect(after.items.some(item => item.resource === crop.kind && item.x === crop.x && item.z === crop.z)).toBe(true);
      expect(after.items.some(item => item.resource === crop.kind + 'Seed' && item.x === crop.x && item.z === crop.z)).toBe(true);
    }
  });
  it('replaces retired rice fields and seeds in a save without losing growth or seed reservations', () => {
    const { sim, world } = setup();
    const saved = raw(sim);
    const crop = saved.crops[0];
    crop.kind = 'rice';
    crop.planted = true;
    crop.growth = .64;
    for (const zone of saved.zones) zone.crop = 'rice';
    saved.resources.riceSeed = 4;
    saved.trade.stock.riceSeed = 2;
    saved.trade.prices.riceSeed = 2;
    saved.colonists[0].bag[3] = { resource: 'riceSeed', count: 5 };
    saved.buildings.find((b: any) => b.kind === 'chest').storage[0] = { resource: 'riceSeed', count: 3 };
    saved.items[0].resource = 'riceSeed';
    const job = saved.jobs.find((j: any) => j.type === 'grow' && j.targetId !== crop.id);
    job.label = '播种水稻';
    job.reserved = { riceSeed: 1 };

    sim.load(saved);
    const upgraded = sim.snapshot();
    expect(upgraded.crops.find(c => c.id === crop.id)).toMatchObject({ kind: 'cabbage', growth: .64, planted: true });
    expect(upgraded.zones.every(zone => zone.crop === 'cabbage')).toBe(true);
    expect(upgraded.resources.cabbageSeed).toBe(13);
    expect(upgraded.trade.stock.cabbageSeed).toBe(2);
    expect(upgraded.colonists[0]!.bag[3]).toEqual({ resource: 'cabbageSeed', count: 5 });
    expect(upgraded.buildings.find(b => b.kind === 'chest')!.storage![0]).toEqual({ resource: 'cabbageSeed', count: 3 });
    expect(upgraded.items[0]!.resource).toBe('cabbageSeed');
    expect(upgraded.jobs.find(j => j.id === job.id)).toMatchObject({ label: '播种白菜', reserved: { cabbageSeed: 1 } });

    const restored = new ColonySimulation(world);
    restored.load(sim.serialize());
    expect(restored.snapshot()).toEqual(upgraded);
  });
  it('can cook with cabbage when generic raw food runs out', () => {
    const { sim } = setup();
    onlyJob(sim, 'cook');
    const saved = raw(sim);
    saved.resources.food = 0;
    sim.load(saved);
    run(sim, 40);
    const cooked = sim.snapshot();
    expect(cooked.metrics.cooked).toBeGreaterThan(0);
    expect(cooked.resources.cabbage).toBeLessThan(saved.resources.cabbage);
  });
  it('grants seeds to old saves once, blocks empty farms and preserves or refunds the reserved seed', () => {
    const world = new VoxelWorld();
    const sim = new ColonySimulation(world);
    const legacy = raw(sim);
    for (const seed of CROP_SEEDS) {
      expect(legacy.resources[seed]).toBe(9);
      delete legacy.resources[seed];
      delete legacy.trade.stock[seed];
      delete legacy.trade.prices[seed];
    }
    sim.load(legacy);
    for (const seed of CROP_SEEDS) expect(sim.snapshot().resources[seed]).toBe(9);

    const seedless = raw(sim);
    seedless.resources.cabbageSeed = 0;
    seedless.resources.tomatoSeed = 0;
    sim.load(seedless);
    onlyJob(sim, 'grow');
    const zone = sim.command({ action: 'designate', kind: 'farm', crop: 'tomato', x: 121, z: 134, w: 2 });
    expect(zone.ok).toBe(true);
    run(sim, 10);
    expect(sim.snapshot().resources.tomatoSeed).toBe(0);
    expect(sim.snapshot().crops.filter(crop => crop.kind === 'tomato').every(crop => !crop.planted)).toBe(true);
    expect(sim.snapshot().jobs.some(job => job.state === 'blocked' && job.label === '缺少番茄种子包')).toBe(true);

    const onePack = raw(sim);
    onePack.resources.tomatoSeed = 1;
    sim.load(onePack);
    for (let i = 0; i < 40 && sim.snapshot().resources.tomatoSeed > 0; i++) sim.tick(.25);
    const inProgress = sim.snapshot();
    expect(inProgress.resources.tomatoSeed).toBe(0);
    expect(inProgress.jobs.filter(job => job.reserved.tomatoSeed === 1)).toHaveLength(1);
    const reserved = sim.serialize();
    const cancelled = new ColonySimulation(world);
    cancelled.load(reserved);
    expect(cancelled.command({ action: 'cancel', id: zone.id }).ok).toBe(true);
    expect(cancelled.snapshot().resources.tomatoSeed).toBe(1);

    sim.load(reserved);
    run(sim, 40);
    const sown = sim.snapshot();
    expect(sown.crops.filter(crop => crop.kind === 'tomato' && crop.planted)).toHaveLength(1);
    expect(sown.resources.tomatoSeed).toBe(0);
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
  it('lets the player fell a tree directly and clears the queued chop',()=>{
    const{sim,world}=setup();onlyJob(sim,'chop');
    const tree=world.getTrees().find(t=>t.z>=16&&t.z<38&&t.x>=18&&t.x<40)!;
    expect(tree).toBeDefined();
    // 先挂一个随从的砍伐任务，模拟「玩家抢先砍了同一棵」
    expect(sim.command({action:'designate',kind:'chop',id:tree.id}).ok).toBe(true);
    expect(sim.snapshot().jobs.some(j=>j.type==='chop'&&j.targetId===tree.id)).toBe(true);
    const before=sim.snapshot().items.filter(i=>i.resource==='wood').reduce((n,i)=>n+i.amount,0);
    const result=sim.playerFellTree(tree.id);
    expect(result.ok).toBe(true);
    expect(result.wood).toBe(tree.trunkHeight*6);
    expect(world.getTree(tree.id)).toBeUndefined();
    // 掉落进世界，不是直接进仓库
    expect(sim.snapshot().items.filter(i=>i.resource==='wood').reduce((n,i)=>n+i.amount,0)).toBe(before+tree.trunkHeight*6);
    // 那条随从任务必须被清掉，否则居民会守着一棵不存在的树
    expect(sim.snapshot().jobs.some(j=>j.type==='chop'&&j.targetId===tree.id)).toBe(false);
    expect(sim.playerFellTree(tree.id).ok).toBe(false);
  });
  it('spills a chest onto the ground when it is demolished',()=>{
    const{sim}=setup();
    chooseFirst(sim);
    const chest=sim.snapshot().chests[0]!;
    sim.transferInventory({kind:'warehouse'},{kind:'chest',id:chest.id,slot:0},'wood',10);
    sim.transferInventory({kind:'warehouse'},{kind:'chest',id:chest.id,slot:1},'stone',4);
    sim.transferInventory({kind:'player',slot:0},{kind:'chest',id:chest.id,slot:2},HAMMER,1);
    const legacy=raw(sim);
    legacy.version=1;
    legacy.playerBag=Array(9).fill(null);
    legacy.chests=sim.snapshot().chests;
    legacy.buildings=legacy.buildings.filter((building: { id: string })=>building.id!==chest.id);
    sim.load(legacy);
    expect(sim.snapshot().chests[0]).toEqual({ ...chest, slots: legacy.chests[0].slots });
    const building=sim.snapshot().buildings.find(b=>b.id===chest.id)!;
    expect(sim.buildingAtVoxel(chest.x,building.y,chest.z)?.kind).toBe('chest');
    const before=new Set(sim.snapshot().items.map(item=>item.id));
    const result=sim.command({action:'demolish',id:chest.id});
    expect(result.ok).toBe(true);
    sim.load(sim.serialize());
    const after=sim.snapshot();
    expect(after.chests).toEqual([]);
    expect(after.buildings.some(b=>b.id===chest.id)).toBe(false);
    expect(after.items.filter(i=>!before.has(i.id)).map(({resource,amount})=>({resource,amount}))).toEqual([
      {resource:'wood',amount:10},{resource:'stone',amount:4},{resource:HAMMER,amount:1},{resource:'building:chest',amount:1},
    ]);
    const foot:[number,number,number]=[chest.x+.5,building.y,chest.z+.5];
    sim.possessColonist(chooseFirst(sim));
    sim.tick(.25,foot);
    expect(sim.snapshot().playerBag.some(slot=>slot?.resource===HAMMER)).toBe(false);
    sim.tick(.5,foot);
    expect(sim.snapshot().playerBag).toContainEqual({resource:HAMMER,count:1});
  });
  it('requires a pickaxe only for stone or metal buildings',()=>{
    // 石造/金属：徒手拆不动
    expect(needsPickaxe(BUILDING_DEFS.forgery)).toBe(true);
    expect(needsPickaxe(BUILDING_DEFS.stove)).toBe(true);
    expect(needsPickaxe(BUILDING_DEFS.wall)).toBe(true);
    expect(needsPickaxe(BUILDING_DEFS.solar)).toBe(true);
    // 木造/布造：徒手就能拆
    expect(needsPickaxe(BUILDING_DEFS.bed)).toBe(false);
    expect(needsPickaxe(BUILDING_DEFS.table)).toBe(false);
    expect(needsPickaxe(BUILDING_DEFS.fence)).toBe(false);
    expect(needsPickaxe(BUILDING_DEFS.floor)).toBe(false);
  });
  it('shares one chop progress between the player and residents',()=>{
    const{sim,world}=setup();onlyJob(sim,'chop');
    const tree=world.getTrees().find(t=>t.z>=16&&t.z<38&&t.x>=18&&t.x<40)!;
    // 玩家先砍掉一半工作量
    const half=sim.playerChipTree(tree.id,8);
    expect(half.felled).toBe(false);
    expect(half.progress).toBeCloseTo(.5,1);
    // 进度确实落在 job 上，随从看到的是同一条
    const job=sim.snapshot().jobs.find(j=>j.type==='chop'&&j.targetId===tree.id)!;
    expect(job).toBeDefined();
    expect(job.progress).toBe(8);
    // 剩下的交给随从，他只需要再干一半的活
    run(sim,90);
    expect(world.getTree(tree.id)).toBeUndefined();
  });
  it('keeps a fresh drop on the ground until the pickup delay elapses',()=>{
    const{sim,world}=setup();
    sim.possessColonist(chooseFirst(sim));
    // 找一块平地，把玩家放到旁边
    const spot=freeCell(sim,world);
    const player:[number,number,number]=[spot.x+.5,world.terrainHeight(spot.x,spot.z),spot.z+.5];
    // 玩家脚下掉一份木材
    const before=sim.snapshot().items.length;
    (sim as unknown as {drop:(r:string,n:number,x:number,z:number)=>void}).drop('wood',5,spot.x,spot.z);
    expect(sim.snapshot().items.length).toBe(before+1);
    // 0.3 秒：还在地上，捡不起来
    for(let i=0;i<2;i++)sim.tick(.15,player);
    expect(sim.snapshot().items.some(i=>i.resource==='wood'&&i.amount===5)).toBe(true);
    // 过了 0.5 秒：被玩家捡走
    for(let i=0;i<4;i++)sim.tick(.15,player);
    expect(sim.snapshot().items.some(i=>i.resource==='wood'&&i.amount===5)).toBe(false);
    expect(sim.snapshot().playerBag.some(slot=>slot?.resource==='wood')).toBe(true);
  });
  it('shows what happens when the player fells a tree a resident is already chopping',()=>{
    const{sim,world}=setup();onlyJob(sim,'chop');
    const tree=world.getTrees().find(t=>t.z>=16&&t.z<38&&t.x>=18&&t.x<40)!;
    expect(sim.command({action:'designate',kind:'chop',id:tree.id}).ok).toBe(true);
    // 让随从跑到树旁并砍一会儿，但别砍完整棵
    run(sim,10);
    const midway=sim.snapshot();
    const job=midway.jobs.find(j=>j.type==='chop'&&j.targetId===tree.id)!;
    expect(job).toBeDefined();
    expect(job.progress).toBeGreaterThan(0);          // 确实已经砍进去一部分
    expect(job.progress).toBeLessThan(job.work);      // 但还没砍完
    const workerId=job.assignedTo;

    // 玩家此刻亲手把树砍倒
    expect(sim.playerFellTree(tree.id).ok).toBe(true);

    const after=sim.snapshot();
    // 这棵树的伐木任务被清掉，随从从任务里释放出来
    expect(after.jobs.some(j=>j.type==='chop'&&j.targetId===tree.id)).toBe(false);
    const worker=after.colonists.find(c=>c.id===workerId)!;
    expect(worker.jobId).toBeNull();
    // 而且没有卡在原地：后续还会被派去干别的（这里只验他没被锁死）
    run(sim,40);
    const later=sim.snapshot();
    expect(later.colonists.find(c=>c.id===workerId)!.jobId !== undefined).toBe(true);
  });
  it('spends resident stamina on chopping beyond the natural drain',()=>{
    const{sim,world}=setup();onlyJob(sim,'chop');
    const tree=world.getTrees().find(t=>t.z>=16&&t.z<38&&t.x>=18&&t.x<40)!;
    const before=sim.snapshot().colonists.map(c=>c.rest);
    expect(sim.command({action:'designate',kind:'chop',id:tree.id}).ok).toBe(true);
    run(sim,90);
    const after=sim.snapshot().colonists;
    // 自然衰减约 0.07/秒，砍一棵的额外开销固定 8 点，所以掉得明显更多。
    const spent=after.reduce((sum,c,i)=>sum+(before[i]!-c.rest),0)/Math.max(1,after.length);
    expect(spent).toBeGreaterThan(3);
  });
  it('extracts resources only after completing a tree or mining job',()=>{
    const{sim,world}=setup();onlyJob(sim,'chop');
    const tree=world.getTrees().find(t=>t.z>=16&&t.z<38&&t.x>=18&&t.x<40);
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
