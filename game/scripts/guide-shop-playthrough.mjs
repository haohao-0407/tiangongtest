import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {tsImport} from 'tsx/esm/api';
import {createFacadeTerrainFixture} from './facade-playthrough.mjs';

export async function guideFixture(housed=false) {
  const {VoxelWorld}=await tsImport('../assets/voxel/model.ts',import.meta.url);
  const {ColonySimulation}=await tsImport('../assets/colony/simulation.ts',import.meta.url);
  const {buildingDimensions}=await tsImport('../assets/colony/buildings.ts',import.meta.url);
  const world=VoxelWorld.deserialize(createFacadeTerrainFixture()),sim=new ColonySimulation(world);
  const s=sim.serialize();
  Object.assign(s,{time:120,speed:0,jobs:[],items:[],terrainPlans:[],buildings:[],crops:[]});
  for(const item of Object.keys(s.resources)) s.resources[item]=0;
  Object.assign(s.resources,{silver:30,bread:14,cloth:1});
  s.zones=[{id:'store',kind:'stockpile',x:5,y:5,z:10,w:3,d:3,crop:'cabbage'}];
  s.warehouseStacks=[{x:5,z:10,slot:0,resource:'bread',count:14,premium:{day:1,count:2}}];
  s.colonists.forEach((c,i)=>{
    Object.assign(c,{position:[10.5+i,5,14.5],hunger:100,recreation:100,rest:100,personal:null,jobId:null,destination:null,path:[],schedule:'day'});
    for(const j of Object.keys(c.priorities)) c.priorities[j]=i===0&&j==='haul'?1:0;
  });
  if(housed) {
    const add=(kind,x,z)=>s.buildings.push({kind,id:kind+'-'+x+'-'+z,x,y:5,z,rotation:0,...buildingDimensions(kind),
      complete:true,phase:'completed',progress:1,reserved:{},powered:false,comfort:0,roomId:null,...(kind==='door'?{doorOpen:false}:{})});
    for(let z=16;z<=22;z++) for(let x=14;x<=20;x++) if(x===14||x===20||z===16||z===22)
      add(x===17&&z===16?'door':'woodWall',x,z);
    add('bed',15,18);add('table',18,19);
  }
  sim.load(s);
  assert.equal(sim.guideHousing.status,housed?'housed':'camp');
  return {world,sim,file:{version:2,voxel:world.serialize(),colony:sim.serialize()}};
}

export default async function guidePlay(play) {
  const read='voxel.world', key='homestead.colony.v2', out='docs/guide-shop-qa-2026-11-27';
  mkdirSync(out,{recursive:true});
  const {page}=play, state=async()=>(await play.state(read)).colony;
  const btn=id=>page.locator('[data-testid="guide-'+id+'"]');
  const wait=pred=>play.waitFor(s=>s.colony && pred(s.colony),{read,timeoutMs:20000});
  const speed=async n=>{await page.locator('[data-testid="speed-'+n+'"]').evaluate(b=>b.click());await wait(c=>c.speed===n);};
  const order=c=>c.jobs.find(j=>j.guideSale)?.guideSale;
  const log=[];
  async function frame(name) {
    const c=await state();
    log.push({name,time:c.time,housing:c.guideHousing,inventory:{silver:c.resources.silver,seed:c.resources.cabbageSeed,bread:c.resources.bread,cloth:c.resources.cloth},
      jobs:c.jobs.filter(j=>j.guideSale),worker:c.colonists[0],stacks:c.warehouseStacks,
      text:await page.locator('#workspace').isVisible()?await page.locator('#workspace').innerText():null});
    writeFileSync(out+'/transactions.json',JSON.stringify(log,null,2));
    await page.screenshot({path:out+'/'+name+'.png',timeout:25000});
  }
  async function load(housed) {
    const {file}=await guideFixture(housed);
    await page.evaluate(({key,file})=>localStorage.setItem(key,JSON.stringify(file)),{key,file});
    await play.reload();await wait(c=>c.speed===0 && c.resources.bread===14 && c.guideHousing.status===(housed?'housed':'camp'));
  }
  const label=page.locator('#guide-map-label');
  const open=async()=>{await label.click({button:'right'});await btn('buy-cabbageSeed').waitFor();};
  async function until(predicate) {
    await speed(1);
    for(let i=0;i<160;i++){
      const {colony:c}=await play.advance(.4,{read,stepSeconds:.1});
      if(predicate(c)){await speed(0);return;}
    }
    assert.fail(JSON.stringify((await state()).jobs));
  }
  async function reloadOrder(side){
    // Save the actual current state through the game's manual save control.
    await page.locator('#save').evaluate(b=>b.click());
    await page.waitForFunction(({key,side})=>JSON.parse(localStorage.getItem(key+'.manual')||'null')?.colony.jobs
      .some(j=>j.guideSale?.side===side && j.guideSale.inTransit>0),{key,side});
    await play.reload();await wait(c=>c.speed===0 && order(c)?.side===side && order(c).inTransit>0);await open();
  }
  await wait(c=>c.colonists.length);await load(false);
  await label.waitFor();await frame('01-map');
  const p=await label.boundingBox();
  // Right click the actor under the nameplate. The label itself also supports a right click.
  await page.mouse.move(p.x+p.width/2,p.y+p.height+12);
  await page.mouse.down({button:'right'});await play.advance(.15,{read});await page.mouse.up({button:'right'});
  await btn('buy-cabbageSeed').waitFor({timeout:5000});await frame('02-shop');
  await btn('buy-cabbageSeed').click();await btn('ten').click();await btn('ten').click();
  assert.equal(await btn('confirm').isDisabled(),true);await btn('cancel').click();
  await btn('buy-cabbageSeed').click();await btn('ten').click();await btn('more').click();await btn('more').click();
  assert.match(await btn('confirm').innerText(),/26/);await btn('confirm').click();
  await wait(c=>order(c)?.count===13 && c.resources.silver===4 && c.resources.cabbageSeed===0);
  await frame('03-buy-reserved');
  await until(c=>order(c)?.inTransit===12);await reloadOrder('buy');
  assert.equal(order(await state()).paid,24);await frame('04-buy-transit-reloaded');
  await until(c=>c.resources.cabbageSeed===12);await frame('05-buy-first-deposit');
  await until(c=>!order(c));assert.equal((await state()).resources.cabbageSeed,13);await frame('06-buy-complete');
  await btn('recycle-bread').click();await btn('ten').click();await btn('more').click();await btn('more').click();await btn('more').click();
  assert.match(await btn('confirm').innerText(),/864/);await frame('07-sale-quote');await btn('confirm').click();
  await wait(c=>order(c)?.count===14 && c.resources.bread===0 && c.resources.silver===4);await frame('08-sale-reserved');
  await until(c=>order(c)?.inTransit===12);await reloadOrder('recycle');await frame('09-sale-transit-reloaded');
  await until(c=>order(c)?.delivered===12);assert.equal((await state()).resources.silver,744);await frame('10-sale-first-payment');
  await until(c=>!order(c));assert.equal((await state()).resources.silver,868);await frame('11-sale-complete');
  await btn('recycle-cloth').click();await btn('more').click();assert.equal(await btn('confirm').isDisabled(),true);
  await btn('less').click();await btn('confirm').click();await wait(c=>order(c)?.item==='cloth');
  await until(c=>!order(c));assert.equal((await state()).resources.silver,876);await frame('12-cloth-sale');
  await load(true);await open();
  await btn('recycle-bread').click();await btn('ten').click();await btn('more').click();await btn('more').click();await btn('more').click();
  assert.ok(Number((await btn('confirm').innerText()).match(/\d+/)[0])>864);await frame('13-housed-sale-quote');
  await btn('cancel').click();await btn('next').click();await btn('next').click();await btn('next').click();
  await btn('buy-bread').click();
  const price=Number((await btn('confirm').innerText()).match(/\d+/)[0]);assert.ok(price<96);await frame('14-housed-buy-quote');
}
