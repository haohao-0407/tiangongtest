import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync} from 'node:fs';
import {tsImport} from 'tsx/esm/api';
import {createFacadeTerrainFixture} from './facade-playthrough.mjs';

export async function textileFixture() {
  const {VoxelWorld}=await tsImport('../assets/voxel/model.ts',import.meta.url);
  const {ColonySimulation}=await tsImport('../assets/colony/simulation.ts',import.meta.url);
  const world=VoxelWorld.deserialize(createFacadeTerrainFixture());
  const sim=new ColonySimulation(world), save=sim.serialize();
  Object.assign(save,{speed:0,time:120,jobs:[],buildings:[],terrainPlans:[],items:[],crops:[],warehouseStacks:[]});
  delete save.warehouseLayout;
  for(const r of Object.keys(save.resources)) save.resources[r]=0;
  Object.assign(save.resources,{wood:18,plank:24});
  save.zones=[{id:'store',kind:'stockpile',x:18,y:5,z:18,w:4,d:3,crop:'cabbage'}];
  save.colonists=save.colonists.slice(0,1);
  const p=save.colonists[0];
  save.selectedColonistId=p.id;
  Object.assign(p,{position:[18.5,5,17.5],health:100,hunger:100,rest:100,recreation:100,disease:0,jobId:null,path:[],personal:null,destination:null,schedule:'day'});
  for(const task of Object.keys(p.priorities)) p.priorities[task]=['harvest','construct','craft','haul','terraform'].includes(task)?1:0;
  sim.load(save);
  for(const [x,z,w,d] of [[13,11,6,6],[7,11,5,5]]) {
    const result=sim.command({action:'designate',kind:'pasture',x,z,w,d});
    assert.ok(result.ok,result.message);
  }
  const setup=sim.serialize();
  setup.jobs=[];
  for(const b of setup.buildings) Object.assign(b,{complete:true,phase:'completed',progress:1,reserved:{}});
  const pen=setup.zones.find(z=>z.x===13).pasture;
  pen.animals=[[14,12,false,true],[15,12,false,false],[16,12,false,true],[17,12,true,false]].map(([x,z,young,female])=>
    ({id:'sheep-'+x+'-'+z,kind:'sheep',young,female,state:'home',x,z,homeX:x,homeZ:z,readyAt:0}));
  setup.buildings.push({id:'empty-pen-stand',kind:'shearingStand',x:9,y:5,z:13,w:1,h:1,d:1,rotation:0,complete:true,phase:'completed',progress:1,reserved:{},powered:false,comfort:0,roomId:null});
  // Fence plans only prepare this fixture. Each run starts with the same real warehouse balances.
  setup.warehouseStacks=[]; delete setup.warehouseLayout;
  setup.resources.wood=18;setup.resources.plank=24;
  sim.load(setup);
  return {world,sim};
}

const herd=c=>c.zones.find(z=>z.x===13&&z.kind==='pasture').pasture.animals;
const building=(c,kind)=>c.buildings.find(b=>b.kind===kind && b.id!=='empty-pen-stand');
const sum=(list,get)=>list.reduce((n,x)=>n+(get(x)??0),0);
function verify(c) {
  const animals=herd(c);
  assert.ok(animals.every(a=>!a.young||a.readyAt===0));
  const sheared=animals.filter(a=>a.readyAt>0).length;
  // Craft workers display their order's reserved inputs as carried cargo. Count that reservation once.
  const haulers=c.colonists.filter(p=>!c.jobs.some(j=>j.recipe&&j.assignedTo===p.id));
  const held=r=>c.resources[r]+sum(c.items,i=>i.resource===r?i.amount:0)+sum(haulers,p=>p.carrying[r])
    +sum(c.jobs,j=>j.reserved[r])+sum(c.buildings,b=>b.reserved[r]);
  const beds=c.buildings.filter(b=>b.kind==='bed'&&b.complete).length;
  assert.equal(held('wool')+2*(held('cloth')+3*beds),2*sheared,'wool equivalent across ground, transit, warehouse, work and beds');
  assert.equal(held('plank')+24*beds,24);
}

export default async function textile(play){
  const {sim,world}=await textileFixture();
  const {page}=play, read='voxel.world', dir='artifacts/textiles/', key='homestead.colony.v2';
  mkdirSync(dir,{recursive:true});
  const log=[];
  const state=async()=>(await play.state(read)).colony;
  const wait=pred=>play.waitFor(s=>s.colony&&pred(s.colony),{read,timeoutMs:15000});
  const ui=id=>page.locator('[data-testid="'+id+'"]');
  const click=id=>ui(id).click({timeout:8000});
  const close=async()=>{if(await page.locator('#panel-close').isVisible()) await page.locator('#panel-close').click();};
  const speed=async n=>{await ui('speed-'+n).evaluate(b=>b.click());await wait(c=>c.speed===n);};
  async function reach(pred,step=1) {
    await speed(1);
    for(let i=0;i<130;i++){
      const c=(await play.advance(step,{read,stepSeconds:.1})).colony;
      verify(c);
      if(pred(c)){await speed(0);return;}
    }
    const c=await state();
    assert.fail(JSON.stringify({time:c.time,jobs:c.jobs,residents:c.colonists.map(p=>[p.task,p.position]),sheep:herd(c),stock:c.resources}));
  }
  async function shot(name) {
    const c=await state();verify(c);
    log.push({name,time:c.time,stock:Object.fromEntries(['wood','wool','cloth','plank'].map(r=>[r,c.resources[r]])),
      sheep:herd(c),stacks:c.warehouseStacks,ground:c.items,jobs:c.jobs,residents:c.colonists.map(({name,position,task,carrying})=>({name,position,task,carrying})),
      buildings:c.buildings.filter(b=>['shearingStand','loom','bed'].includes(b.kind))});
    writeFileSync(dir+'inventory.json',JSON.stringify(log,null,2));
    await page.screenshot({path:dir+name+'.png',timeout:15000});
  }
  // Project a ground cell through the current god camera and confirm the footprint before clicking.
  async function place(kind,x,z){
    await close();
    await click('menu-build');await click('build-'+kind);
    const s=await play.waitFor(s=>s.tool==='build:'+kind,{read});
    const dot=(a,b)=>a.reduce((v,n,i)=>v+n*b[i],0);
    const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
    const unit=a=>a.map(n=>n/Math.hypot(...a));
    const f=unit(s.camera.target.map((v,i)=>v-s.camera.eye[i])), r=unit(cross(f,[0,1,0])), u=cross(r,f);
    const rel=[x+.5,5.001,z+.5].map((v,i)=>v-s.camera.eye[i]),h=Math.tan(Math.PI/8)*dot(rel,f);
    const {width,height}=page.viewportSize(),pt=[.5+dot(rel,r)/(2*h*width/height),.5-dot(rel,u)/(2*h)];
    await play.mouse.move(pt);
    const before=await play.advance(.15,{read});
    assert.ok(before.placementPreview,JSON.stringify({kind,x,z,pt,hover:before.hoverCell,camera:s.camera,status:before.status}));
    await play.mouse.click(pt);
    await wait(c=>building(c,kind)?.x===x&&building(c,kind)?.z===z);
    await close();
  }
  await wait(c=>c.colonists.length);
  await page.evaluate(([k,f])=>localStorage.setItem(k,JSON.stringify(f)),[key,{version:2,voxel:world.serialize(),colony:sim.serialize()}]);
  await play.reload();await wait(c=>c.speed===0&&c.resources.wood===18&&c.resources.cloth===0);
  await reach(c=>c.time>=128,2);
  let c=await state();
  assert.equal(c.jobs.filter(j=>j.type==='husbandry').length,0);
  assert.equal(c.resources.wool,0);
  await click('menu-plan');await shot('01-separate-pastures');await close();
  await place('shearingStand',16,15);
  assert.ok(!building(await state(),'shearingStand').complete);
  await shot('02-stand-blueprint');
  await reach(c=>building(c,'shearingStand').complete && c.jobs.some(j=>j.type==='husbandry'&&j.progress>0),.5);
  await shot('03-shearing');
  await reach(c=>c.items.some(i=>i.resource==='wool'),.5);
  await shot('04-wool-ground');
  await reach(c=>c.resources.wool===6);
  await click('menu-warehouse');await page.locator('#workspace .wh-search').fill('羊毛');await shot('05-wool-stock');await close();
  await place('loom',19,15);await reach(c=>building(c,'loom').complete);
  assert.equal((await state()).resources.wood,0);
  await shot('06-loom');
  await click('menu-production');
  for(let i=0;i<3;i++){await click('craft-order-cloth');await wait(c=>c.jobs.filter(j=>j.recipe==='cloth').length===i+1);}
  await reach(c=>c.jobs.some(j=>j.recipe==='cloth'&&j.progress>0),.25);
  c=await state();
  const job=c.jobs.find(j=>j.recipe==='cloth'&&j.progress>0);
  assert.equal(job.targetId,building(c,'loom').id);assert.equal(job.reserved.wool,2);
  await ui('craft-order-'+job.id).scrollIntoViewIfNeeded();
  await shot('07-weaving');await close();
  const clocks=herd(c).map(a=>a.readyAt);
  await page.waitForFunction(([k,id])=>JSON.parse(localStorage.getItem(k))?.colony?.jobs.some(j=>j.id===id&&j.progress>0),[key,job.id],{timeout:15000});
  await play.reload();await wait(c=>c.speed===0&&c.jobs.some(j=>j.id===job.id&&j.reserved.wool===2));
  assert.deepEqual(herd(await state()).map(a=>a.readyAt),clocks);
  await shot('08-reloaded-order');
  await reach(c=>c.items.some(i=>i.resource==='cloth'),.5);await shot('09-cloth-ground');
  await reach(c=>c.resources.cloth===3);
  c=await state();assert.deepEqual([c.resources.wool,c.resources.plank],[0,24]);
  await click('menu-warehouse');await page.locator('#workspace .wh-search').fill('布料');
  await page.locator('#workspace .wh-cell[data-item="cloth"]').waitFor();await shot('10-cloth-stock');await close();
  await place('bed',19,12);await reach(c=>building(c,'bed').complete);
  c=await state();assert.deepEqual([c.resources.wool,c.resources.cloth,c.resources.plank],[0,0,0]);
  await shot('11-bed');
  await page.waitForFunction(k=>JSON.parse(localStorage.getItem(k))?.colony?.buildings.some(b=>b.kind==='bed'&&b.complete),key,{timeout:15000});
  await play.reload();await wait(c=>building(c,'bed')?.complete);
  assert.deepEqual(herd(await state()).map(a=>a.readyAt),clocks);
  await shot('12-reloaded-bed');
}
