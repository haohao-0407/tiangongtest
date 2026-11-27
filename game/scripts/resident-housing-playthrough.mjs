import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {tsImport} from 'tsx/esm/api';
import {town,assign,order,until,member} from './specialist-settlement.mjs';
import {possessResident} from './select-resident.mjs';

const {mapProjection}=await tsImport('../assets/voxel/zone-selection.ts',import.meta.url);
const key='homestead.colony.v2',read='voxel.world',out='docs/resident-housing-qa';
export default async function residentHousing(play){
  const {sim,world}=await town(),{page}=play,frames=[];
  mkdirSync(out,{recursive:true});
  assign(sim,'guide');order(sim,'guide','recycle','wool',6);until(sim,c=>member(c,'tailor').status==='arrived');
  const initial=sim.serialize();
  initial.guideBedId=null;
  initial.buildings=initial.buildings.filter(b=>b.id!=='table-25-22');
  for(const b of initial.buildings)if(b.kind==='door')b.doorOpen=false;
  initial.colonists[0].position=[17.5,5,16.5];
  const tailor=member(sim.snapshot(),'tailor').housing.position;
  Object.assign(initial.colonists[1],{position:[tailor[0],tailor[1],tailor[2]-1],facing:0,path:[],personal:null,destination:null});
  const state=()=>play.state(read), wait=fn=>play.waitFor(s=>s.colony && fn(s),{read,timeoutMs:15000});
  const advance=t=>play.advance(t,{read,stepSeconds:.05});
  const menu=page.locator('[data-menu="residents"]'), row=id=>page.locator('[data-tenant="'+id+'"]');
  const workspace=page.locator('#workspace'),flag=id=>page.locator('[data-home-flag="'+id+'"]');
  const {width,height}=page.viewportSize(),tan=Math.tan(Math.PI/8);
  async function frame(name){
    const s=await state(),c=s.colony;
    frames.push({name,tool:s.tool,status:s.status,flags:c.specialistMarket.flags,guideBed:c.guideHousing.bedId,
      tailorBed:member(c,'tailor').housing.bedId,available:c.specialistMarket.availableRooms.map(r=>r.bedId),
      panel:await workspace.isVisible()?await workspace.innerText():null});
    await page.screenshot({path:out+'/'+name+'.png'});
    writeFileSync(out+'/readings.json',JSON.stringify(frames,null,2));
  }
  async function start(id){
    if(!await row(id).isVisible())await menu.click();
    await row(id).click();
    await workspace.getByRole('button',{name:'安排入住',exact:true}).click();
    await wait(s=>s.tool==='house:'+id && s.camera.overhead);
    assert.equal(await workspace.isVisible(),false);
  }
  async function move(x,z){
    const {camera}=await state();
    const scale=height/(2*camera.distance*tan);
    await page.mouse.move(width/2+(x+.5-camera.target[0])*scale,height/2+(z+.5-camera.target[2])*scale);
    await advance(.1);
  }
  async function press(button='left'){
    await page.mouse.down({button});await advance(.12);await page.mouse.up({button});await advance(.1);
  }
  const clickCell=async(x,z)=>{await move(x,z);await press();};
  async function faceTailor(){
    const pawn=(await state()).colony.colonists[1];
    await possessResident(play,pawn.id);
    if(await page.locator('#inspector-close').isVisible())await page.locator('#inspector-close').click();
    await advance(.6);
    const s=await state(),[x,y,z]=member(s.colony,'tailor').housing.position;
    const camera=mapProjection(s.camera.eye,s.camera.target,width/height,tan);
    for(const h of [1.45,1.78,1.05,.75]){
      const [u,v]=camera.project(x,y+h,z);
      await page.mouse.move(u*width,v*height);await press('right');
      if(await page.locator('.workspace[data-panel="guide"]').isVisible())return;
    }
    assert.fail('未能当面打开裁缝商店 '+JSON.stringify({player:s.player,tailor:[x,y,z]}));
  }
  await wait(s=>s.colony.colonists.length);
  await page.evaluate(({key,file})=>localStorage.setItem(key,JSON.stringify(file)),{key,file:{version:2,voxel:world.serialize(),colony:initial}});
  await play.reload();await wait(s=>s.colony.specialistMarket.availableRooms.length===4 && member(s.colony,'tailor').status==='arrived');
  await menu.click();
  assert.equal(await page.locator('[data-tenant]').count(),5);
  assert.equal(await row('chef').isDisabled(),true);
  assert.match(await row('guide').innerText(),/待安排/);await frame('01-residents');
  await start('guide');await move(15,11);
  const cursor=page.locator('.housing-pointer');
  assert.equal(await cursor.isVisible(),true);
  const first=(await cursor.boundingBox()).x;
  await move(16,11);assert.ok((await cursor.boundingBox()).x>first+2);
  await frame('02-preview');
  await clickCell(19,16);await wait(s=>s.tool==='house:guide' && /封闭房间/.test(s.status));await frame('03-outdoor');
  await clickCell(24,23);await wait(s=>s.tool==='house:guide' && /餐桌/.test(s.status));await frame('04-invalid');
  await clickCell(16,11);await wait(s=>s.colony.guideHousing.bedId==='bed-14-9' && s.tool==='inspect');
  await flag('guide').waitFor();await frame('05-guide');
  await start('tailor');await clickCell(16,11);
  await wait(s=>s.tool==='house:tailor' && /向导入住/.test(s.status));await frame('06-occupied');
  await clickCell(24,11);await wait(s=>member(s.colony,'tailor').housing.bedId==='bed-22-9');
  await flag('tailor').waitFor();await frame('07-tailor');
  for(const [event,filename] of [['right','08-cancel-right'],['Escape','09-cancel-esc']]){
    await start('guide');await move(16,23);
    if(event==='right')await press('right');else await page.keyboard.press(event);
    await wait(s=>s.tool==='inspect' && s.colony.guideHousing.bedId==='bed-14-9');
    await row('guide').waitFor();await frame(filename);
  }
  await start('guide');await clickCell(24,11);
  await wait(s=>s.tool==='house:guide' && /裁缝入住/.test(s.status) && s.colony.guideHousing.bedId==='bed-14-9');
  await clickCell(16,23);await wait(s=>s.colony.guideHousing.bedId==='bed-14-21' && s.colony.specialistMarket.availableRooms.some(r=>r.bedId==='bed-14-9'));
  const flags=(await state()).colony.specialistMarket.flags;
  assert.deepEqual(flags.guide,[16.5,5,23.5]);await frame('10-moved');
  await page.locator('#save').evaluate(b=>b.click());
  await page.waitForFunction(key=>JSON.parse(localStorage.getItem(key)||'null')?.colony.guideBedId==='bed-14-21',key+'.manual');
  await play.reload();
  await wait(s=>s.colony.guideHousing.bedId==='bed-14-21');
  assert.deepEqual((await state()).colony.specialistMarket.flags,flags);
  await menu.click();assert.match(await row('tailor').innerText(),/已入住/);await frame('11-reloaded');
  await page.locator('#panel-close').click();await faceTailor();
  const buy=page.locator('[data-testid="guide-buy-cloth"]');
  await buy.waitFor();await buy.click();
  await page.locator('[data-testid="guide-confirm"]').click();
  await wait(s=>s.colony.jobs.some(j=>j.guideSale?.merchantId==='tailor'));await frame('12-face-trade');
  // Load the same pending order with its table removed, then inspect the actual shop and map.
  await page.locator('#save').evaluate(b=>b.click());
  await page.waitForFunction(key=>JSON.parse(localStorage.getItem(key)||'null')?.colony.jobs.some(j=>j.guideSale?.merchantId==='tailor'),key+'.manual');
  await page.evaluate(key=>{
    const file=JSON.parse(localStorage.getItem(key+'.manual'));
    file.colony.buildings=file.colony.buildings.filter(b=>b.id!=='table-24-10');
    localStorage.setItem(key,JSON.stringify(file));
  },key);
  await play.reload();await wait(s=>member(s.colony,'tailor').housing.status==='camp' && s.colony.guideHousing.status==='housed');
  await menu.click();assert.match(await row('tailor').innerText(),/待安排/);
  assert.ok(!(await state()).colony.specialistMarket.flags.tailor);await frame('13-lost-home');
  await page.locator('#panel-close').click();await faceTailor();
  assert.equal(await buy.count(),0);
  assert.ok((await state()).colony.jobs.some(j=>j.guideSale?.merchantId==='tailor'));
  await frame('14-trade-locked');
  return {checkpoints:frames.length,flags};
}
