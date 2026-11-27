import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {tsImport} from 'tsx/esm/api';
import {possessResident} from './select-resident.mjs';
import {town, member, pending} from './specialist-settlement.mjs';

const {mapProjection}=await tsImport('../assets/voxel/zone-selection.ts',import.meta.url);
const {SPECIALISTS}=await tsImport('../assets/colony/specialist-catalog.ts',import.meta.url);
const read='voxel.world', key='homestead.colony.v2', out='docs/merchant-shops-qa';
const home=(c,id)=>id==='guide'?c.guideHousing:member(c,id).housing;
const distance=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));

export default async function merchantShops(play) {
  const {sim,world}=await town();
  const {page}=play, log=[];
  mkdirSync(out,{recursive:true});
  const state=()=>play.state(read);
  const wait=pred=>play.waitFor(s=>s.colony && pred(s.colony,s),{read,timeoutMs:15000});
  const btn=id=>page.locator('[data-testid="guide-'+id+'"]');
  const advance=t=>play.advance(t,{read,stepSeconds:.1});
  const close=async()=>{for (const id of ['panel-close','inspector-close']) if(await page.locator('#'+id).isVisible())await page.locator('#'+id).click();};
  async function frame(name) {
    const s=await state(), c=s.colony;
    log.push({name,day:c.day,time:c.time,silver:c.resources.silver,guide:c.guideHousing,market:c.specialistMarket,
      order:pending(c),actors:s.characters.merchants,workers:c.colonists.map(p=>({id:p.id,position:p.position,task:p.task})),
      ui:await page.locator('#workspace').isVisible()?await page.locator('#workspace').innerText():null});
    writeFileSync(out+'/readings.json',JSON.stringify(log,null,2));
    await page.screenshot({path:out+'/'+name+'.png'});
  }
  const speed=async n=>{await page.locator('[data-testid="speed-'+n+'"]').evaluate(b=>b.click());await wait(c=>c.speed===n);};
  async function until(pred) {
    await speed(1);
    for (let i=0;i<160;i++) {const s=await advance(.55); if(pred(s.colony)){await speed(0);return;}}
    assert.fail(JSON.stringify((await state()).colony.jobs));
  }
  async function load(file){
    await close();
    await page.evaluate(({file,key})=>localStorage.setItem(key+'.manual',JSON.stringify(file)),{file,key});
    await page.locator('#load').evaluate(b=>b.click());
    await wait((c,s)=>c.speed===0 && c.time===file.colony.time && s.camera.mode==='god' && c.colonists[1].position.every((n,i)=>n===file.colony.colonists[1].position[i]));
  }
  async function manual() {
    await page.evaluate(key=>localStorage.removeItem(key+'.manual'),key);
    await page.locator('#save').evaluate(b=>b.click());
    const t=(await state()).colony.time;
    await page.waitForFunction(({key,t})=>JSON.parse(localStorage.getItem(key+'.manual')||'null')?.colony.time===t,{key,t});
    return page.evaluate(key=>JSON.parse(localStorage.getItem(key+'.manual')),key);
  }
  async function possess(){
    const pawn=(await state()).colony.colonists[1];
    await possessResident(play,pawn.id);await close();await advance(.6);
  }
  async function rightClick(id) {
    const s=await state(), [x,y,z]=home(s.colony,id).position;
    const {width,height}=page.viewportSize();
    const projection=mapProjection(s.camera.eye,s.camera.target,width/height,Math.tan(Math.PI/8));
    for(const h of [1.45,1.78,1.05,.75]) {
      const [u,v]=projection.project(x,y+h,z);
      await page.mouse.move(u*width,v*height);
      await page.mouse.down({button:'right'});await advance(.15);await page.mouse.up({button:'right'});
      if(await page.locator('.workspace[data-panel="guide"]').isVisible())return;
    }
    assert.fail('右键未打开 '+id+' '+JSON.stringify({npc:[x,y,z],player:s.player,camera:s.camera}));
  }
  async function assign(id,bedId) {
    await btn('choose-room').click();
    assert.equal(await page.locator('.guide-sku').count(),0);
    await frame(id+'-choose-room');
    await btn('assign-'+bedId).click();
    await wait(c=>home(c,id).bedId===bedId);
    await page.locator('.guide-sku').first().waitFor();
  }
  async function order(item,count) {
    await btn('recycle-'+item).click();
    for(let i=1;i<count;i++)await btn('more').click();
    const quote=Number((await btn('confirm').innerText()).match(/\d+/)[0]);
    await btn('confirm').click();await wait(c=>pending(c)?.count===count);return quote;
  }
  // The town starts with five finished rooms, one hauler and separate cloth stacks.
  const initial=sim.serialize();
  initial.colonists[1].position=[20.5,5,18.5];initial.colonists[1].facing=0;
  initial.warehouseStacks=initial.warehouseStacks.filter(s=>s.resource!=='cloth');
  initial.resources.cloth=10;
  initial.warehouseStacks.push({x:6,z:10,slot:0,resource:'cloth',count:4},{x:7,z:11,slot:0,resource:'cloth',count:6});
  sim.load(initial);
  const file={version:2,voxel:world.serialize(),colony:sim.serialize()};
  await wait(c=>c.colonists.length);
  const noRooms=structuredClone(file);
  noRooms.colony.buildings=[];
  await load(noRooms);await possess();await rightClick('guide');
  await btn('choose-room').click();assert.match(await page.locator('#workspace').innerText(),/目前没有合格空房/);
  await frame('no-rooms');
  await load(file);
  const rooms=(await state()).colony.specialistMarket.availableRooms;
  assert.equal(rooms.length,5);
  await possess();await rightClick('guide');await assign('guide',rooms[0].bedId);
  await frame('guide-housed');
  await order('wool',6);await until(c=>!!pending(c)?.inTransit);
  assert.equal(member((await state()).colony,'tailor').sold,0);
  await frame('guide-in-transit');
  await until(c=>member(c,'tailor').status==='arrived');
  const arrived=home((await state()).colony,'tailor').position;
  await until(c=>distance(home(c,'tailor').position,arrived)>.4);
  await frame('tailor-walking');
  await close();
  // Stage the speaking resident beside the moving NPC when the saved route takes them far away.
  async function beside(save,id) {
    sim.load(save.colony);
    const s=sim.snapshot(),[x,y,z]=home(s,id).position;
    const p=save.colony.colonists[1];
    const offsets=[[0,-1],[1,0],[-1,0],[0,1]];
    const [dx,dz]=offsets.find(([dx,dz])=>!s.buildings.some(b=>Math.floor(x+dx)>=b.x && Math.floor(x+dx)<b.x+b.w && Math.floor(z+dz)>=b.z && Math.floor(z+dz)<b.z+b.d))??[0,0];
    Object.assign(p,{position:[x+dx,y,z+dz],facing:Math.atan2(-dx,-dz),personal:null,path:[],destination:null});
    await load(save);await possess();
  }
  const beforeRoom=await manual();
  await beside(beforeRoom,'tailor');await rightClick('tailor');
  await assign('tailor',rooms[1].bedId);await frame('tailor-housed');
  const calendar=page.locator('#date');
  await close();await calendar.click();await page.locator('.market-notice').first().waitFor();
  const event=(await state()).colony.specialistMarket.events.find(e=>e.merchantId==='tailor');
  assert.ok(event.startDay>=event.announcedDay+2);await frame('calendar-announcement');await close();
  // Skip the idle days in a copy of the just-saved game. Preserve event identity and all orders.
  const active=await manual();active.colony.time=(event.startDay-1)*360+120;
  await beside(active,'tailor');await rightClick('tailor');
  const before=(await state()).colony.resources.silver;
  await btn('recycle-cloth').click();await btn('ten').click();assert.ok(await btn('confirm').isDisabled());await frame('event-cap');
  await btn('cancel').click();
  const total=await order('cloth',10);
  await until(c=>pending(c)?.delivered>0 && pending(c).delivered<10);
  const partial=pending((await state()).colony), remaining=(await state()).colony.specialistMarket.events.find(e=>e.id===event.id).remaining;
  assert.equal(remaining,0);assert.equal((await state()).colony.resources.silver,before+partial.paid);
  await frame('event-first-payment');await manual();await page.locator('#load').evaluate(b=>b.click());
  await wait((c,s)=>pending(c)?.paid===partial.paid && c.speed===0 && s.camera.mode==='god');
  await frame('event-reloaded');await until(c=>!pending(c));
  assert.equal((await state()).colony.resources.silver,before+total);await frame('event-paid');
  for(const id of ['chef','cheesemaker','blacksmith']) {
    // Independent shelf fixtures use the real simulation to unlock each additional merchant.
    const {order:trade,until:deliver,assign:house}=await import('./specialist-settlement.mjs');
    const {sim:other,world:terrain}=await town();house(other,'guide');
    const def=SPECIALISTS[id], item={chef:'bread',cheesemaker:'milk',blacksmith:'steel'}[id];
    trade(other,'guide','recycle',item,def.unlockQuantity);deliver(other,c=>member(c,id).status==='arrived');
    const saved={version:2,voxel:terrain.serialize(),colony:other.serialize()};
    await beside(saved,id);await frame(id+'-actor');await rightClick(id);
    await assign(id,(await state()).colony.specialistMarket.availableRooms[0].bedId);
    assert.deepEqual(await page.locator('.guide-sku').evaluateAll(nodes=>nodes.map(n=>n.dataset.testid)),def.shelf.map(row=>'guide-buy-'+row.item));
    await frame(id+'-shelf');
  }
}
