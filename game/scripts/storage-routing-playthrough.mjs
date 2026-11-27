import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync} from 'node:fs';
import {tsImport} from 'tsx/esm/api';
import {createFacadeTerrainFixture} from './facade-playthrough.mjs';

export default async function storageRouting(play) {
  const {VoxelWorld}=await tsImport('../assets/voxel/model.ts', import.meta.url);
  const {ColonySimulation}=await tsImport('../assets/colony/simulation.ts', import.meta.url);
  const world=VoxelWorld.deserialize(createFacadeTerrainFixture());
  const sim=new ColonySimulation(world);
  const save=sim.serialize();
  save.speed=0;
  save.time=120;
  save.buildings=[]; save.items=[]; save.jobs=[]; save.crops=[]; save.terrainPlans=[];
  save.zones=[{id:'food-corner',kind:'stockpile',x:18,y:5,z:15,w:1,d:1,crop:'cabbage'},
    {id:'general-corner',kind:'stockpile',x:14,y:5,z:15,w:1,d:1,crop:'cabbage'}];
  save.warehouseStacks=[32,32,32,29].map((count,slot)=>({x:18,z:15,slot,resource:'milk',count}));
  for(const r of Object.keys(save.resources)) save.resources[r]=0;
  save.resources.milk=125;
  save.items=[{id:'loose-milk',resource:'milk',amount:8,x:14,y:5,z:16,age:2,reservedBy:null}];
  save.colonists.forEach((c,i)=>{
    c.position=[12.5+i,5,12.5]; c.personal=null; c.jobId=null; c.destination=null; c.path=[];
    c.hunger=c.rest=c.recreation=100; c.schedule='day';
    for(const j of Object.keys(c.priorities)) c.priorities[j]=(j==='haul'&&i===1)?1:0;
  });
  sim.load(save);
  const read='voxel.world', key='homestead.colony.v2', out='artifacts/storage-routing/';
  mkdirSync(out,{recursive:true});
  await play.waitFor(s=>s.colony?.colonists.length,{read});
  await play.page.evaluate(({key,data})=>localStorage.setItem(key,JSON.stringify(data)),{key,data:{version:2,voxel:world.serialize(),colony:sim.serialize()}});
  await play.reload();
  await play.waitFor(s=>s.colony?.speed===0 && s.colony.resources.milk===125,{read});
  const btn=id=>play.page.locator('[data-testid="'+id+'"]');
  await btn('menu-plan').click();
  const food=btn('storage-class-food-corner'), general=btn('storage-class-general-corner');
  assert.equal(await food.inputValue(),'general');
  await food.selectOption('food');
  await play.waitFor(s=>s.colony.zones.find(z=>z.id==='food-corner')?.storageClass==='food',{read});
  assert.equal(await general.inputValue(),'general');
  await food.scrollIntoViewIfNeeded();
  await play.page.screenshot({path:out+'01-classification.png',timeout:20000});
  await play.page.locator('#panel-close').click();
  await btn('speed-1').evaluate(b=>b.click());
  const record=[];
  for(let i=0;i<160;i++){
    const {colony:c}=await play.advance(.5,{read,stepSeconds:.1});
    const held=c.colonists.reduce((n,p)=>n+(p.carrying.milk??0),0);
    const ground=c.items.find(i=>i.id==='loose-milk')?.amount??0;
    const total=c.resources.milk;
    assert.equal(total+held+ground,133);
    if(record.at(-1)?.total!==total||record.at(-1)?.ground!==ground)
      record.push({total,held,ground,time:c.time});
    if(total===133) {
      assert.equal(c.warehouseStacks.filter(s=>s.x===18).reduce((n,s)=>n+s.count,0),128);
      assert.equal(c.warehouseStacks.filter(s=>s.x===14).reduce((n,s)=>n+s.count,0),5);
      break;
    }
  }
  assert.equal(record.at(-1)?.total,133);
  assert.ok(record.some(p=>p.total===125&&p.held===3)&&record.some(p=>p.total===128));
  await btn('speed-0').evaluate(b=>b.click());
  await btn('menu-warehouse').click();
  await play.page.screenshot({path:out+'02-warehouse.png',timeout:20000});
  writeFileSync(out+'inventory.json',JSON.stringify(record,null,2));
}
