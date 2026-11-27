import assert from 'node:assert/strict';
import {mkdirSync,readFileSync} from 'node:fs';

export default async function fenceCancel(play) {
  const file=JSON.parse(readFileSync(new URL('../docs/pasture-harvest-04-qa-2026-11-27/fixed-pasture/gate-save.json',import.meta.url),'utf8'));
  const pen=file.colony.zones.find(zone=>zone.kind==='pasture');
  pen.pasture.animals=[];
  const fence=file.colony.buildings.find(b=>b.kind==='fence');
  // One unbuilt adjacent bay and one freestanding section reproduce both screenshot cases.
  Object.assign(fence,{complete:false,phase:'readyToBuild',progress:0});
  file.colony.buildings.push({...fence,id:'single-fence',x:23,z:28,rotation:1,complete:true,phase:'completed',progress:1});
  const shape=c=>c.buildings.filter(b=>b.complete && ['fence','pastureGate'].includes(b.kind))
    .map(({id,kind,x,y,z,rotation})=>({id,kind,x,y,z,rotation})).sort((a,b)=>a.id.localeCompare(b.id));
  const expected=shape(file.colony);
  const {page}=play, read='voxel.world', key='homestead.colony.v2';
  const out='artifacts/fence-cancel';
  mkdirSync(out,{recursive:true});
  const wait=fn=>play.waitFor(s=>s.colony && fn(s.colony),{read,timeoutMs:25000});
  const click=id=>page.locator('[data-testid="'+id+'"]').click();
  const close=async()=>{if(await page.locator('#panel-close').isVisible())await page.locator('#panel-close').click();};
  const shot=name=>page.screenshot({path:out+'/'+name+'.png'});
  await wait(c=>c.colonists.length);
  await page.evaluate(([k,s])=>localStorage.setItem(k+'.manual',JSON.stringify(s)),[key,file]);
  await page.locator('#load').evaluate(b=>b.click());
  const start=await wait(c=>c.zones.some(z=>z.id===pen.id) && c.buildings.some(b=>b.id==='single-fence'));
  assert.deepEqual(shape(start.colony),expected);
  await close();await shot('01-planned');
  await click('menu-plan');await click('cancel-'+pen.id);
  const finished=c=>!c.zones.some(z=>z.id===pen.id) && !c.buildings.some(b=>b.id===fence.id);
  const cancelled=await wait(finished);
  assert.deepEqual(shape(cancelled.colony),expected);
  await close();await shot('02-cancelled');
  await page.locator('#save').evaluate(b=>b.click());
  await page.waitForFunction(({k,id})=>!JSON.parse(localStorage.getItem(k+'.manual')).colony.zones.some(z=>z.id===id),{k:key,id:pen.id});
  // Restore the original fixture first so the second load must actually change the scene.
  const saved=await page.evaluate(k=>localStorage.getItem(k+'.manual'),key);
  await page.evaluate(([k,s])=>localStorage.setItem(k+'.manual',JSON.stringify(s)),[key,file]);
  await page.locator('#load').evaluate(b=>b.click());await wait(c=>c.zones.some(z=>z.id===pen.id));
  await page.evaluate(([k,s])=>localStorage.setItem(k+'.manual',s),[key,saved]);
  await page.locator('#load').evaluate(b=>b.click());
  const loaded=await wait(finished);
  assert.deepEqual(shape(loaded.colony),expected);
  await close();await shot('03-reloaded');
}
