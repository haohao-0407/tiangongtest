import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {town,assign,order,until,member,pending,out} from './specialist-settlement.mjs';

export default async function merchantSettlement(play){
  const {sim,world}=await town();
  assign(sim,'guide');
  order(sim,'guide','recycle','bread',11);until(sim,c=>!pending(c));
  const quote=order(sim,'guide','recycle','bread',1);
  until(sim,c=>pending(c)?.inTransit===1);
  const {page}=play,read='voxel.world',key='homestead.colony.v2',records=[];
  mkdirSync(out,{recursive:true});
  const state=async()=>(await play.state(read)).colony;
  const wait=pred=>play.waitFor(s=>s.colony && pred(s.colony),{read,timeoutMs:30000});
  const panel=page.locator('#workspace[data-panel="calendar"]');
  const speed=async n=>{await page.locator('[data-testid="speed-'+n+'"]').evaluate(b=>b.click());await wait(c=>c.speed===n);};
  async function load(){
    const file={version:2,voxel:world.serialize(),colony:sim.serialize()};
    await page.evaluate(({key,file})=>localStorage.setItem(key,JSON.stringify(file)),{key,file});
    await play.reload();await wait(c=>c.speed===0 && c.time===file.colony.time);
  }
  async function frame(name){
    if(!await panel.isVisible())await page.locator('#date').click();
    await panel.waitFor();
    const c=await state(),worker=c.colonists[0];
    const row={name,day:c.day,time:c.time,silver:c.resources.silver,guide:c.guideHousing,
      chef:member(c,'chef'),event:c.specialistMarket.events[0],order:pending(c),worker:{position:worker.position,task:worker.task},text:await panel.innerText()};
    records.push(row);
    writeFileSync(out+'/live.json',JSON.stringify(records,null,2));
    await page.screenshot({path:out+'/'+name+'.png',timeout:30000});
    await page.locator('#panel-close').click();return row;
  }
  async function deliver(){
    await speed(1);
    for(let i=0;i<95;i++){
      const c=(await play.advance(.6,{read,stepSeconds:.1})).colony;
      if(!pending(c)){await speed(0);return;}
    }
    assert.fail(JSON.stringify((await state()).jobs));
  }
  await wait(c=>c.colonists.length>0);await load();
  const before=await frame('01-last-bread-in-transit');
  assert.equal(before.chef.sold,11);assert.equal(before.order.inTransit,1);
  await deliver();const arrived=await frame('02-chef-arrived');
  assert.equal(arrived.chef.sold,12);assert.equal(arrived.chef.housing.status,'camp');assert.equal(arrived.silver-before.silver,quote.total);
  await page.locator('#save').evaluate(b=>b.click());
  await page.waitForFunction(key=>JSON.parse(localStorage.getItem(key+'.manual')??'null')?.colony.specialistMarket.progress.chef.sold===12,key);
  await play.reload();await wait(c=>member(c,'chef')?.sold===12);
  const restored=await frame('03-arrival-reloaded');
  assert.deepEqual(restored.chef,arrived.chef);assert.equal(restored.silver,arrived.silver);
  until(sim,c=>!pending(c));assign(sim,'chef');
  const event=sim.snapshot().specialistMarket.events[0];
  const save=sim.serialize();save.time=(event.endDay-1)*360+120;save.lastDay=event.endDay;
  sim.load(save);
  const request=order(sim,'chef','recycle','blueberryPie',3);
  until(sim,c=>pending(c)?.inTransit===3);
  const overnight=sim.serialize();overnight.time=event.endDay*360+120;overnight.lastDay=event.endDay+1;
  sim.load(overnight);await load();
  const locked=await frame('04-expired-in-transit');
  assert.equal(locked.order.total,request.total);assert.equal(locked.event.remaining,2);
  await deliver();const paid=await frame('05-expired-paid');
  assert.equal(paid.event.remaining,2);assert.equal(paid.silver-locked.silver,request.total);
  assert.equal(paid.chef.sold,15);
  return {before:11,arrived:12,paid:request.total,settlementDay:paid.day,checkpoints:records.length};
}
