import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {tsImport} from 'tsx/esm/api';
import {guideFixture} from './guide-shop-playthrough.mjs';

const {guideOrder,GUIDE_SHELF,GUIDE_RECYCLE_ITEMS}=await tsImport('../assets/colony/guide-shop.ts',import.meta.url);
const {CROP_SEEDS,premiumCount,RESOURCE_PRICES}=await tsImport('../assets/colony/contracts.ts',import.meta.url);
const results={};
const pending=sim=>sim.snapshot().jobs.find(j=>j.guideSale);
function trade(sim,side,item,count) {
  const quote=guideOrder(sim.snapshot(),side,item,count);
  return sim.command({action:'guide-trade',value:side,kind:item,amount:count,target:quote.total});
}
function advance(sim,predicate) {
  sim.command({action:'speed',value:1});
  for(let i=0;i<600;i++) {sim.tick(.25);if(predicate(sim.snapshot()))return;}
  assert.fail(JSON.stringify(pending(sim)));
}
{
  const {sim}=await guideFixture();
  const cancel=()=>sim.command({action:'cancel',id:pending(sim).id});
  assert.ok(trade(sim,'buy','cabbageSeed',13).ok);
  assert.equal(trade(sim,'buy','cloth',1).ok,false);
  advance(sim,()=>pending(sim)?.guideSale.inTransit===12);sim.load(sim.serialize());
  assert.ok(cancel().ok);
  const c=sim.snapshot(),ground=c.items.filter(i=>i.resource==='cabbageSeed').reduce((n,i)=>n+i.amount,0);
  assert.equal(c.resources.silver,6);assert.equal(ground,12);assert.equal(c.resources.cabbageSeed,0);
  advance(sim,c=>c.resources.cabbageSeed===12);
  results.cancelPaidPurchase={unpaidRefund:2,totalSilver:c.resources.silver,paidSeedsOnGround:ground,recoveredSeeds:12};
}
{
  const {sim}=await guideFixture();
  assert.ok(trade(sim,'recycle','bread',14).ok);
  assert.equal(trade(sim,'recycle','bread',1).ok,false);
  advance(sim,()=>pending(sim)?.guideSale.inTransit===12);sim.load(sim.serialize());
  assert.ok(sim.command({action:'cancel',id:pending(sim).id}).ok);
  const c=sim.snapshot();
  assert.equal(c.resources.bread,14);assert.equal(c.resources.silver,30);
  assert.equal(c.warehouseStacks.reduce((s,l)=>s+premiumCount(l,c.day),0),2);
  results.cancelFreshSale={bread:14,fresh:2,validDay:c.day,silver:30};
}
{
  const {sim}=await guideFixture();
  const s=sim.serialize();for(const c of s.colonists)c.priorities.haul=0;
  sim.load(s);assert.ok(trade(sim,'recycle','bread',14).ok);
  const overnight=sim.serialize();overnight.time=359;sim.load(overnight);
  sim.command({action:'speed',value:1});for(let i=0;i<28;i++)sim.tick(.25);
  assert.equal(sim.snapshot().day,2);assert.equal(sim.snapshot().resources.silver,30);
  assert.equal(pending(sim).guideSale.total,864);
  const morning=sim.serialize();morning.time=480;morning.colonists[0].priorities.haul=1;
  sim.load(morning);advance(sim,c=>!c.jobs.some(j=>j.guideSale));
  assert.equal(sim.snapshot().resources.silver,894);
  results.overnightOrder={orderedDay:1,deliveredDay:2,quote:864,received:864};
}
{
  const {sim}=await guideFixture();
  const s=sim.serialize();s.zones=[];s.warehouseStacks=[];sim.load(s);
  assert.ok(trade(sim,'buy','cloth',1).ok);
  advance(sim,c=>c.jobs.some(j=>j.guideSale?.inTransit===1 && j.state==='blocked'));
  assert.equal(sim.snapshot().resources.cloth,1);sim.load(sim.serialize());
  const blocked=sim.serialize();
  blocked.zones=[{id:'general',kind:'stockpile',x:18,y:5,z:18,w:1,d:1,crop:'cabbage'},
    {id:'materials',kind:'stockpile',x:7,y:5,z:10,w:1,d:1,crop:'cabbage',storageClass:'materials'}];
  sim.load(blocked);advance(sim,c=>!c.jobs.some(j=>j.guideSale));
  assert.equal(sim.snapshot().warehouseStacks.find(l=>l.resource==='cloth')?.x,7);
  results.blockedPurchase={paid:20,inTransit:1,beforeAvailable:1,afterAvailable:2,destination:'materials'};
}
{
  const {sim}=await guideFixture(),{sim:house}=await guideFixture(true);
  assert.equal(GUIDE_SHELF.length,10);assert.deepEqual(new Set(GUIDE_RECYCLE_ITEMS),new Set(Object.keys(RESOURCE_PRICES)));
  for(const item of CROP_SEEDS){assert.ok(trade(sim,'buy',item,1).ok);}
  results.catalog={seeds:CROP_SEEDS.length,items:GUIDE_SHELF.length,recyclable:GUIDE_RECYCLE_ITEMS.length};
  results.housing=[sim,house].map(s=>({housing:s.guideHousing,breadBuy:guideOrder(s.snapshot(),'buy','bread',1).total,
    breadSale:guideOrder(s.snapshot(),'recycle','bread',14).total}));
}
{
  const {sim}=await guideFixture(true);
  assert.ok(trade(sim,'recycle','bread',14).ok);
  advance(sim,()=>pending(sim)?.state==='blocked' && pending(sim).guideSale.inTransit>0);
  assert.equal(sim.snapshot().resources.silver,30);
  const door=sim.snapshot().buildings.find(b=>b.kind==='door');
  assert.ok(sim.command({action:'toggleDoor',id:door.id}).ok);
  advance(sim,c=>!c.jobs.some(j=>j.guideSale));
  assert.equal(sim.snapshot().resources.silver,958);
  results.blockedRoad={beforeOpeningDoor:30,afterDelivery:958,received:928};
}
const out='docs/guide-shop-qa-2026-11-27';mkdirSync(out,{recursive:true});
writeFileSync(out+'/simulation.json',JSON.stringify(results,null,2));console.log(results);
