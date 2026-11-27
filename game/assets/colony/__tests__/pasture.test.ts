import {expect,it,vi} from 'vitest';
import {VoxelWorld,BLOCK} from '../../voxel/model.ts';
import {ColonySimulation,JOB_TYPES} from '../simulation.ts';
import {pastureLayout,STOCK_VOLUME,stockVolume} from '../pasture.ts';
import type {WildAnimal} from '../../voxel/wild-animals.ts';
import {readFileSync} from 'node:fs';

it('fits mixed adult and young stock in the inner area and rejects disconnected pens',()=>{
  expect(Object.values(STOCK_VOLUME)).toEqual([4,3,2,1]);
  for(const kind of ['cow','pig','sheep','chicken'] as const)expect(stockVolume({kind,young:true})).toBe(STOCK_VOLUME[kind]/2);
  const pen=pastureLayout({x:1,z:1,w:5,d:4});
  expect(pen.interior.length).toBe(6);expect(pen.border.length).toBe(14);
  expect(pen.gates.some(g=>g.cell[0]===1&&g.cell[1]===1)).toBe(false);
  expect(pastureLayout({x:1,z:1,w:1,d:5}).connected).toBe(false);
});

it('builds an enclosure, changes its entrance, leads an animal, milks and hauls only with a completed station',()=>{
  const world=VoxelWorld.deserialize(JSON.stringify({version:1,generatorVersion:1,seed:'pen-1',size:[48,24,48],edits:[]}));
  const edits=[];
  for(let z=0;z<48;z++)for(let x=0;x<48;x++)for(let y=1;y<24;y++)edits.push({x,y,z,block:y<5?BLOCK.Dirt:y===5?BLOCK.Grass:BLOCK.Air});
  world.edit(edits);
  const wild:WildAnimal={kind:'cow',x:12,y:6,z:10,phase:.42,dx:0,dz:1,scale:1};
  const wildlife=vi.spyOn(world,'getWildAnimals').mockReturnValue([wild]);
  vi.spyOn(world,'wildAnimalGround').mockReturnValue(6);
  const sim=new ColonySimulation(world), save:any=sim.serialize();
  save.buildings=[];save.terrainPlans=[];save.jobs=[];save.items=[];save.crops=[];save.warehouseStacks=[];
  save.zones=[{id:'store',kind:'stockpile',x:12,y:6,z:14,w:8,d:3,crop:'cabbage'}];
  save.resources.wood=100;save.resources.steel=15;save.resources.milk=0;
  save.colonists=save.colonists.slice(0,1);save.selectedColonistId=save.colonists[0].id;
  save.colonists.forEach((p:any,i:number)=>{p.position=[14.5+i,6,12.5];p.jobId=null;p.path=[];p.personal=null;p.destination=null;
    p.skills.construct=20;p.disease=0;p.health=p.hunger=p.rest=p.recreation=100;JOB_TYPES.forEach(j=>p.priorities[j]=['haul','construct','harvest'].includes(j)?1:0);});
  sim.load(save);
  const result=sim.command({action:'designate',kind:'pasture',x:15,z:8,w:5,d:4});
  expect(result.ok,result.message).toBe(true);
  const pen=()=>sim.snapshot().zones.find(z=>z.id===result.id)!.pasture!;
  expect(pen().capacity).toBe(6);expect(pen().ready).toBe(false);
  expect(sim.snapshot().buildings.filter(b=>b.kind==='fence')).toHaveLength(13);
  expect(sim.command({action:'herdAnimal',kind:'cow',id:result.id}).ok).toBe(false);
  const until=(predicate:()=>boolean,limit=1600)=>{for(let i=0;i<limit&&!predicate();i++)sim.tick(.25);expect(predicate(),JSON.stringify({b:sim.snapshot().buildings.map(b=>[b.kind,b.x,b.z,b.phase,b.blockedReason]),jobs:sim.snapshot().jobs.map(j=>[j.label,j.state]),c:sim.snapshot().colonists.map(c=>[c.task,c.position]),t:sim.simulationTime})).toBe(true);};
  until(()=>!!pen().ready);sim.load(sim.serialize());
  const old=pen().gate;
  const next=pastureLayout({x:15,z:8,w:5,d:4}).gates.find(g=>g.cell.join()!==old.join())!.cell;
  expect(sim.command({action:'pastureGate',x:next[0],z:next[1]}).ok).toBe(true);
  expect(pen().gate).toEqual(old);
  // Cancelling a partially converted, saved gate must preserve the actual standing section.
  const cancelRenovation=(expectedGates:number)=>{
    const copy=new ColonySimulation(world);copy.load(sim.serialize());
    expect(copy.command({action:'cancel',id:result.id}).ok).toBe(true);
    copy.load(copy.serialize());
    const standing=copy.snapshot().buildings;
    expect(standing).toHaveLength(14);
    expect(standing.every(b=>b.complete && !b.previousBoundary)).toBe(true);
    expect(standing.filter(b=>b.kind==='pastureGate')).toHaveLength(expectedGates);
    expect(standing.find(b=>b.x===old[0] && b.z===old[1])?.kind).toBe('pastureGate');
  };
  cancelRenovation(1);
  until(()=>pen().gate.join()===next.join());
  cancelRenovation(2);
  until(()=>!!pen().ready&&pen().gate.join()===next.join());
  expect(sim.snapshot().buildings.filter(b=>b.kind==='pastureGate'&&b.complete)).toHaveLength(1);
  expect(sim.command({action:'herdAnimal',id:result.id,x:12,z:10}).ok).toBe(true);
  expect(sim.command({action:'herdAnimal',id:result.id,kind:'cow'}).ok).toBe(false);
  wildlife.mockReturnValue([wild,{...wild,x:9}]);
  expect(sim.command({action:'herdAnimal',id:result.id,kind:'cow'}).message).toContain('容量不足');
  expect(pen().animals.length).toBe(1);
  until(()=>pen().animals[0]?.state==='leading');
  const branch=new ColonySimulation(world);branch.load(sim.serialize());
  const active=branch.snapshot().jobs.find(j=>j.type==='herd')!;
  expect(branch.command({action:'designate',kind:'pasture',x:12,z:8,w:3,d:4}).ok).toBe(true);
  branch.load(branch.serialize());
  let arrived=false;
  for(let n=0;n<2000&&!arrived;n++){
    branch.tick(.25);
    const state=branch.snapshot(),animal=state.zones.find(z=>z.id===result.id)!.pasture!.animals[0]!;
    expect(animal.id).toBe(active.targetId);
    expect(state.buildings.some(b=>b.complete&&b.kind==='fence'&&b.x===animal.x&&b.z===animal.z)).toBe(false);
    const orders=state.jobs.filter(j=>j.type==='herd');
    arrived=animal.state==='home';
    expect(orders.map(j=>j.id)).toEqual(arrived?[]:[active.id]);
  }
  const stalled=branch.snapshot();
  expect(arrived,JSON.stringify({animals:stalled.zones.find(z=>z.id===result.id)?.pasture,wood:stalled.resources.wood,
    jobs:stalled.jobs.map(j=>[j.label,j.state]),worker:stalled.colonists[0]?.task})).toBe(true);
  until(()=>pen().animals[0]?.state==='home');sim.load(sim.serialize());
  expect(sim.snapshot().jobs.some(j=>j.type==='husbandry')).toBe(false);
  const machine=sim.command({action:'build',kind:'milker',x:18,z:10});
  expect(machine.ok,machine.message).toBe(true);
  expect(sim.snapshot().jobs.some(j=>j.type==='husbandry')).toBe(false);
  until(()=>sim.snapshot().resources.milk===1);
  expect(pen().capacity).toBe(5);
  expect(sim.snapshot().warehouseStacks.find(s=>s.resource==='milk')?.count).toBe(1);
  sim.load(sim.serialize());expect(pen().animals[0]?.state).toBe('home');
  const henSave:any=sim.serialize();
  const zone=henSave.zones.find((z:any)=>z.id===result.id),cow=zone.pasture.animals[0];
  const mother={...cow,id:'chicken-3-6',kind:'chicken',young:false,female:true,readyAt:0};
  const chick={...mother,id:'chicken-8-6',young:true};
  zone.pasture.animals=[mother,chick];henSave.resources.egg=0;
  const station=henSave.buildings.find((b:any)=>b.id===machine.id);station.kind='henNest';
  sim.load(henSave);
  // A hen may miss the first roll and try again three simulated minutes later.
  const before=sim.snapshot().resources.egg;
  until(()=>sim.snapshot().resources.egg>before,4800);
  expect(pen().animals.find(a=>a.young)?.readyAt).toBe(0);
  expect(pen().animals.find(a=>!a.young)!.readyAt).toBeGreaterThan(sim.simulationTime);
},60000);

it('restores a shared edge from a legacy save, preserves private fixtures, and resumes each demolition once',()=>{
  const file=JSON.parse(readFileSync(new URL('../../../docs/pasture-harvest-04-qa-2026-11-27/pasture-final-save.json',import.meta.url),'utf8'));
  const sim=new ColonySimulation(VoxelWorld.deserialize(file.voxel)), s=file.colony;
  const original=s.zones.find((z:any)=>z.pasture);
  const added={...original,id:'legacy-neighbour',z:16,w:8,d:4,pasture:{gate:[22,16],animals:[]}};
  s.zones.push(added);
  const template=s.buildings.find((b:any)=>b.kind==='fence');
  for(const [x,z] of pastureLayout(added).border)
    s.buildings.push({...template,id:'legacy-'+x+'-'+z,x,z,kind:x===22&&z===16?'pastureGate':'fence',rotation:0});
  const privateFence={...template,id:'player-fence',x:25,z:24};
  s.buildings.push(privateFence);
  const oldGate=s.buildings.find((b:any)=>b.x===22&&b.z===20).id;
  const interior=s.buildings.filter((b:any)=>b.x>19&&b.x<26&&(b.z===19||b.z===20));
  const before=s.resources.wood;
  const check=()=>{
    const c=sim.snapshot(),zones=c.zones.filter(z=>z.pasture),p=zones[0]!.pasture!;
    expect(zones).toHaveLength(1);
    expect(p.animals.map(({readyAt,...a})=>a)).toEqual(original.pasture.animals.map(({readyAt,...a}:typeof p.animals[number])=>a));
    expect(p.gate).toEqual([22,16]);
    expect(c.buildings.some(b=>b.id===privateFence.id)).toBe(true);
    expect(c.buildings.filter(b=>b.kind==='milker'||b.kind==='henNest')).toHaveLength(2);
    expect(c.resources.wood).toBe(before);
    return c;
  };
  sim.load(s);
  const pending=check().jobs.filter(j=>j.type==='demolish');
  expect(pending.map(j=>j.targetId).sort()).toEqual(interior.map((b:any)=>b.id).sort());
  expect(pending.some(j=>j.targetId===oldGate)).toBe(true);
  const empty:any=sim.serialize();empty.zones.find((z:any)=>z.pasture).pasture.animals=[];
  const cancelSim=new ColonySimulation(VoxelWorld.deserialize(file.voxel));cancelSim.load(empty);
  expect(cancelSim.command({action:'cancel',id:original.id}).ok).toBe(true);
  expect(cancelSim.snapshot().jobs.filter(j=>j.type==='demolish')).toEqual([]);
  expect(cancelSim.snapshot().buildings.map(b=>b.id)).toEqual(empty.buildings.map((b:any)=>b.id));
  sim.load(sim.serialize());expect(check().jobs.filter(j=>j.type==='demolish')).toEqual(pending);
  sim.command({action:'speed',value:1});
  for(let i=0;i<2400&&sim.snapshot().jobs.some(j=>j.type==='demolish');i++)sim.tick(.25);
  const done=check();
  expect(done.jobs.filter(j=>j.type==='demolish')).toHaveLength(0);
  expect(done.items.filter(i=>i.resource==='building:fence'||i.resource==='building:pastureGate').reduce((n,i)=>n+i.amount,0)
    -s.items.filter((i:any)=>i.resource==='building:fence'||i.resource==='building:pastureGate').reduce((n:number,i:any)=>n+i.amount,0)).toBe(interior.length);
  sim.load(sim.serialize());expect(check().zones.find(z=>z.pasture)?.pasture?.capacity).toBe(45);
});
