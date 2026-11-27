import assert from 'node:assert/strict';
import { mkdirSync,writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { tsImport } from 'tsx/esm/api';
import { guideFixture } from './guide-shop-playthrough.mjs';
const {merchantOrder}=await tsImport('../assets/colony/guide-shop.ts',import.meta.url);
const {buildingDimensions}=await tsImport('../assets/colony/buildings.ts',import.meta.url);
export const out='docs/specialist-settlement-qa';
export const member=(c,id)=>c.specialistMarket.merchants.find(m=>m.id===id);
export const pending=c=>c.jobs.find(j=>j.guideSale)?.guideSale;

export async function town(){
  const {sim,world}=await guideFixture();
  const s=sim.serialize();
  Object.assign(s.resources,{wool:28,cloth:18,steel:30,tomato:26,milk:20,blueberryPie:7});
  const add=(kind,x,z)=>s.buildings.push({id:kind+'-'+x+'-'+z,kind,x,z,y:5,rotation:0,...buildingDimensions(kind),
    complete:true,phase:'completed',progress:1,powered:false,...(kind==='door'?{doorOpen:false}:{}),comfort:0,roomId:null,reserved:{}});
  for(const [left,top] of [[13,8],[21,8],[5,16],[13,20],[22,20]]){
    for(let x=left;x<=left+5;x++)for(let z=top;z<=top+5;z++){
      if(x===left || x===left+5 || z===top || z===top+5)add(x===left+3 && z===top+5?'door':'woodWall',x,z);
    }
    add('bed',left+1,top+1);add('table',left+3,top+2);
  }
  s.colonists[1].position=[19.5,5,18.5];
  sim.load(s);
  return {sim,world};
}
export function assign(sim,id,index=0){
  const room=sim.snapshot().specialistMarket.availableRooms[index];
  assert.ok(room,'available room for '+id);
  const result=sim.command({action:'assign-merchant-room',merchantId:id,id:room.bedId});
  assert.ok(result.ok,result.message);
  return room.bedId;
}
export function order(sim,id,side,item,count){
  const q=merchantOrder(sim.snapshot(),side,item,count,id);
  const r=sim.command({action:'guide-trade',merchantId:id,value:side,kind:item,amount:count,target:q.total});
  assert.ok(r.ok,r.message);return q;
}
export function until(sim,predicate){
  sim.command({action:'speed',value:1});
  for(let i=0;i<900;i++){
    sim.tick(.25);const c=sim.snapshot();
    if(predicate(c)){sim.command({action:'speed',value:0});return c;}
  }
  const c=sim.snapshot();assert.fail(JSON.stringify({jobs:c.jobs,worker:c.colonists[0],market:c.specialistMarket,guide:c.guideHousing}));
}
const done=c=>!pending(c);
export async function verify(){
  const {sim}=await town(),results={};
  const state=()=>sim.snapshot();
  const noTrade=(id,side,item)=>{const r=sim.command({action:'guide-trade',merchantId:id,value:side,kind:item,amount:1,target:1});assert.equal(r.ok,false);assert.match(r.message,/安排合格的空房/);};
  const camp=state().guideHousing.position;
  assert.equal(state().specialistMarket.availableRooms.length,5);
  assert.equal(state().guideHousing.status,'camp');noTrade('guide','buy','cloth');noTrade('guide','recycle','bread');
  const moved=until(sim,c=>Math.hypot(c.guideHousing.position[0]-camp[0],c.guideHousing.position[2]-camp[2])>=1);
  results.walk=[camp,moved.guideHousing.position];
  const guideBed=assign(sim,'guide');
  order(sim,'guide','recycle','bread',11);until(sim,done);
  assert.equal(member(state(),'chef').sold,11);assert.equal(member(state(),'chef').status,'locked');
  order(sim,'guide','recycle','bread',1);
  until(sim,c=>pending(c)?.inTransit===1);
  sim.load(sim.serialize());assert.equal(member(state(),'chef').sold,11);
  const arrival=until(sim,done);assert.equal(member(arrival,'chef').arrivalDay,arrival.day);
  noTrade('chef','buy','bread');noTrade('chef','recycle','tomato');
  assert.equal(arrival.specialistMarket.events.length,0);
  const chefBed=assign(sim,'chef');
  const purchase=order(sim,'chef','buy','bread',1);
  const collected=until(sim,c=>pending(c)?.inTransit===1);
  assert.equal(member(collected,'chef').sold,12);
  assert.ok(collected.colonists.some(p=>Math.hypot(p.position[0]-member(collected,'chef').housing.position[0],p.position[2]-member(collected,'chef').housing.position[2])<=1.5));
  until(sim,done);results.purchase={merchant:'chef',paid:purchase.total,soldAfterDeposit:member(state(),'chef').sold};

  assert.equal(sim.command({action:'assign-merchant-room',merchantId:'chef',id:guideBed}).ok,false);
  results.threshold={before:11,carrying:11,delivered:member(arrival,'chef'),guideBed,chefBed};
  for(const [id,item,count] of [['tailor','wool',6],['cheesemaker','milk',8],['blacksmith','steel',12]]){
    order(sim,'guide','recycle',item,count);const c=until(sim,done);
    assert.equal(member(c,id).arrivalDay,arrival.day);assign(sim,id);
  }
  const homes=state().specialistMarket.merchants.map(m=>m.housing.bedId);
  assert.equal(new Set([guideBed,...homes]).size,5);
  results.homes={guide:guideBed,specialists:homes};
  const resetShift=()=>{
    const s=sim.serialize();s.time=(Math.floor(s.time/360)+1)*360+120;
    s.lastDay=Math.floor(s.time/360)+1;
    for(const c of s.colonists)Object.assign(c,{disease:0,hunger:100,recreation:100,rest:100});
    sim.load(s);
  };
  results.partial=[];
  for(const [id,item] of [['chef','tomato'],['tailor','wool']]){
    resetShift();
    const before=state(),q=order(sim,id,'recycle',item,14);
    const c=until(sim,c=>pending(c)?.delivered===12);
    const job=c.jobs.find(j=>j.guideSale),paid=pending(c).paid;
    const merchant=member(c,id);
    assert.ok(c.colonists.some(p=>Math.hypot(p.position[0]-merchant.housing.position[0],p.position[2]-merchant.housing.position[2])<=1.45));
    assert.equal(merchant.sold,member(before,id).sold+12);
    assert.ok(sim.command({action:'cancel',id:job.id}).ok);
    assert.equal(state().resources[item],before.resources[item]-12);
    assert.equal(state().resources.silver,before.resources.silver+paid);
    results.partial.push({id,item,total:q.total,paid,delivered:12,returned:2,merchant:merchant.housing.position});
  }
  let event=state().specialistMarket.events.find(e=>e.merchantId==='chef' && e.endDay>=state().day);
  assert.ok(event,'expected chef forecast');
  const s=sim.serialize();s.time=(Math.max(event.startDay,state().day)-1)*360+120;
  s.lastDay=Math.floor(s.time/360)+1;
  for(const c of s.colonists){c.disease=0;c.hunger=100;c.rest=100;c.personal=null;c.path=[];c.destination=null;}
  sim.load(s);
  const stock=state().resources.silver;
  const quota=()=>state().specialistMarket.events.find(e=>e.id===event.id).remaining;
  assert.throws(()=>merchantOrder(state(),'recycle',event.item,event.limit+1,'chef'));
  const quote=order(sim,'chef','recycle',event.item,3);assert.equal(quote.marketFactor,1.5);
  assert.equal(quota(),event.limit-3);
  const job=state().jobs.find(j=>j.guideSale);
  assert.ok(sim.command({action:'cancel',id:job.id}).ok);assert.equal(quota(),event.limit);
  order(sim,'chef','recycle',event.item,3);until(sim,c=>pending(c)?.inTransit===3);
  const movedSave=sim.serialize(),bed=movedSave.buildings.find(b=>b.id===chefBed);
  movedSave.buildings=movedSave.buildings.filter(b=>b!==bed);
  movedSave.time=event.endDay*360+120;movedSave.lastDay=event.endDay+1;
  sim.load(movedSave);assert.equal(member(state(),'chef').housing.status,'camp');
  sim.command({action:'speed',value:1});sim.tick(8);
  assert.equal(state().resources.silver,stock);assert.equal(pending(state()).delivered,0);
  noTrade('chef','recycle','tomato');
  const repair=sim.serialize();repair.buildings.push(bed);repair.buildings.find(b=>b.id==='door-24-13').doorOpen=false;sim.load(repair);
  assert.equal(member(state(),'chef').housing.status,'camp');assign(sim,'chef');
  sim.load(sim.serialize());const settled=until(sim,done);
  assert.equal(settled.resources.silver,stock+quote.total);assert.equal(quota(),event.limit-3);
  results.expiry={event,quote,paid:quote.total,paidDay:settled.day,remaining:quota(),waitingSilver:stock};
  // Two real warehouse lots split this five-piece request into separate handoffs.
  const second=await town(), split=second.sim;
  assign(split,'guide');order(split,'guide','recycle','bread',12);until(split,done);
  assign(split,'chef');
  const splitSave=split.serialize(),splitEvent=split.snapshot().specialistMarket.events[0];
  splitSave.time=(splitEvent.startDay-1)*360+120;splitSave.lastDay=splitEvent.startDay;
  splitSave.zones.push({id:'pies',kind:'stockpile',x:8,y:5,z:10,w:2,d:1,crop:'cabbage'});
  splitSave.warehouseStacks.push({x:8,z:10,slot:0,resource:'blueberryPie',count:2},{x:9,z:10,slot:0,resource:'blueberryPie',count:3});
  split.load(splitSave);
  order(split,'chef','recycle','blueberryPie',5);
  const part=until(split,c=>pending(c)?.delivered>0);
  const partialJob=part.jobs.find(j=>j.guideSale), delivered=partialJob.guideSale.delivered;
  assert.ok(delivered<5);assert.equal(part.specialistMarket.events[0].remaining,0);
  const stopped=split.serialize();stopped.time=splitEvent.endDay*360+120;split.load(stopped);
  assert.ok(split.command({action:'cancel',id:partialJob.id}).ok);
  assert.equal(split.snapshot().specialistMarket.events[0].remaining,5-delivered);
  results.cancelExpiredPartial={delivered,returned:5-delivered,paid:partialJob.guideSale.paid};
  const ledger=sim.serialize();delete ledger.specialistMarket;
  ledger.events=[{id:'old',type:'info',time:120,day:1,hour:8,text:'向导回收已交付 · 面包 × 12 · 收到 800 银币'}];
  sim.load(ledger);sim.load(sim.serialize());assert.equal(member(state(),'chef').sold,12);
  assert.equal(state().guideHousing.bedId,guideBed);
  results.legacy={guideBed:state().guideHousing.bedId,chefAfterTwoLoads:member(state(),'chef').sold};
  mkdirSync(out,{recursive:true});writeFileSync(out+'/simulation.json',JSON.stringify(results,null,2));console.log(results);
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href)await verify();
