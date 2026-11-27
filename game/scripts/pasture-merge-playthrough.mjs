import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {tsImport} from 'tsx/esm/api';

const read='voxel.world', key='homestead.colony.v2', out='artifacts/pasture-merge';
const pens=c=>c.zones.filter(z=>z.pasture);
const pen=c=>pens(c)[0];
const file=()=>JSON.parse(readFileSync(new URL('../docs/pasture-harvest-04-qa-2026-11-27/pasture-final-save.json',import.meta.url),'utf8'));

export default async function verify(play){
  const {page}=play,{width,height}=page.viewportSize();
  const {pastureLayout}=await tsImport('../assets/colony/pasture.ts',import.meta.url);
  const {mapProjection}=await tsImport('../assets/voxel/zone-selection.ts',import.meta.url);
  const start=file(),animals=pen(start.colony).pasture.animals,log=[];
  // Start the herd's next working day with rested builders and enough timber for the bridge.
  start.colony.resources.wood=240;
  for(const a of animals)a.readyAt=0;
  for(const p of start.colony.colonists){p.skills.construct=20;p.rest=p.hunger=p.recreation=p.health=100;p.disease=0;}
  const wait=p=>play.waitFor(p,{read,timeoutMs:20000});
  const state=()=>play.state(read), click=id=>page.locator('[data-testid="'+id+'"]').click();
  const speed=async n=>{await page.locator('[data-testid="speed-'+n+'"]').evaluate(b=>b.click());await wait(s=>s.colony.speed===n);};
  const owned=c=>pen(c).pasture.animals.map(a=>[a.id,a.x,a.z,a.homeX,a.homeZ,a.state]);
  const original=owned(start.colony);
  const stations=c=>c.buildings.filter(b=>['milker','henNest'].includes(b.kind)).map(b=>b.id);
  const close=async()=>{if(await page.locator('#panel-close').isVisible())await page.locator('#panel-close').click();};
  async function record(name){
    const s=await state(),c=s.colony;
    assert.deepEqual(owned(c),original);assert.deepEqual(stations(c),stations(start.colony));
    const jobs=c.jobs.filter(j=>j.type==='demolish');
    assert.equal(new Set(jobs.map(j=>j.targetId)).size,jobs.length);
    log.push({name,time:c.time,pens:pens(c).map(z=>({id:z.id,cells:z.cells?.length??z.w*z.d,capacity:z.pasture.capacity,
      gate:z.pasture.gate,ready:z.pasture.ready,seams:z.pasture.seamIds??[]})),wood:c.resources.wood,milk:c.resources.milk,
      animals:owned(c),stations:stations(c),demolition:jobs.map(j=>j.targetId),hint:await page.locator('#status').innerText()});
    writeFileSync(out+'/checkpoints.json',JSON.stringify(log,null,2));
    await page.screenshot({path:out+'/'+name+'.png',timeout:30000});
  }
  async function tool(id){
    await close();await click('menu-plan');await click(id);
    await page.locator('#workspace').waitFor({state:'hidden'});
  }
  async function drag(x,z,w,d,count,label){
    await tool('tool-zone-pasture');
    let {camera}=await wait(s=>s.tool==='zone:pasture'&&s.camera.overhead);
    await play.mouse.move([.52,.47]);
    for(const [axis,goal,minus,plus] of [[2,21,'w','s'],[0,21,'a','d']]){
      const delta=goal-camera.target[axis];
      if(Math.abs(delta)<2)continue;
      const key=delta>0?plus:minus;
      await page.keyboard.down(key);
      try{await play.advance(Math.abs(delta)/(.32*camera.distance),{read,stepSeconds:.05});}
      finally{await page.keyboard.up(key);}
      camera=(await state()).camera;
    }
    const scale=height/(2*camera.distance*Math.tan(Math.PI/8));
    const mouse=(cx,cz)=>page.mouse.move(width/2+(cx-camera.target[0])*scale,height/2+(cz-camera.target[2])*scale);
    await mouse(x+.12,z+.12);await page.mouse.down();await mouse(x+w-.12,z+d-.12);
    const s=await wait(s=>s.zonePreview?.cells.length===w*d);
    if(count===null){
      assert.ok(s.zonePreview.invalid.length);await record(label);await page.mouse.up();
      await wait(s=>!s.zonePreview);await page.keyboard.press('Escape');return;
    }
    assert.deepEqual(s.zonePreview.invalid,[]);
    if(count)await page.locator('#status').filter({hasText:'合并 '+count+' 片'}).waitFor();
    await record(label);await page.mouse.up();
    await wait(s=>s.tool==='inspect'&&!s.zonePreview);
  }
  async function reach(predicate){
    await speed(6);
    for(let i=0;i<120;i++){
      const {colony:c}=await play.advance(.8,{read,stepSeconds:.1});
      assert.deepEqual(owned(c),original);
      if(c.jobs.some(j=>j.type==='demolish')){
        const border=pastureLayout(pen(c)).border;
        assert.ok(border.every(([x,z])=>c.buildings.some(b=>b.x===x&&b.z===z&&b.complete)));
      }
      if(predicate(c)){await speed(0);return;}
    }
    throw Error('居民施工超时 '+JSON.stringify((await state()).colony.jobs.map(j=>[j.label,j.state,j.targetId])));
  }
  async function reload(name){
    const c=(await state()).colony;
    await page.evaluate(k=>localStorage.removeItem(k+'.manual'),key);
    await page.locator('#save').evaluate(b=>b.click());
    await page.waitForFunction(k=>!!localStorage.getItem(k+'.manual'),key);
    const raw=await page.evaluate(k=>localStorage.getItem(k+'.manual'),key);
    writeFileSync(out+'/'+name+'.json',raw);
    await page.evaluate(([k,r])=>localStorage.setItem(k,r),[key,raw]);
    await play.reload();
    const s=await wait(s=>s.colony?.time===c.time&&s.colony?.zones.some(z=>z.id===pen(c).id));
    assert.deepEqual(s.colony.zones,c.zones);
    assert.deepEqual(s.colony.jobs.map(j=>j.id),c.jobs.map(j=>j.id));
    assert.deepEqual(s.colony.resources,c.resources);
    await record(name);
  }
  mkdirSync(out,{recursive:true});
  await wait(s=>s.colony?.colonists.length);
  await page.evaluate(([k,f])=>localStorage.setItem(k,JSON.stringify(f)),[key,start]);
  await play.reload();await wait(s=>s.colony?.zones.some(z=>z.id===pen(start.colony).id));
  await drag(17,20,2,6,1,'01-edge-preview');
  let c=(await state()).colony;
  assert.equal(pens(c).length,1);assert.equal(pen(c).cells.length,60);
  assert.equal(pen(c).pasture.seamIds.length,4);
  assert.ok(!c.jobs.some(j=>j.type==='demolish'));assert.deepEqual(pen(c).pasture.gate,[22,20]);
  await reload('02-before-demolition');
  await drag(14,17,3,3,0,'03-corner-preview');
  assert.equal(pens((await state()).colony).length,2);
  await drag(21,16,3,3,0,'04-third-pasture');
  assert.equal(pens((await state()).colony).length,3);
  await drag(16,18,9,3,3,'05-overlap-three');
  c=(await state()).colony;assert.equal(pens(c).length,1);assert.ok(pen(c).cells.length<pen(c).w*pen(c).d);
  await drag(26,22,3,2,null,'06-protected-store');
  await reach(c=>c.jobs.some(j=>j.type==='demolish'));await close();await reload('07-demolition-orders');
  await reach(c=>pen(c).pasture.ready);await close();await reload('08-after-demolition');
  c=(await state()).colony;
  assert.equal(pen(c).pasture.capacity,pastureLayout(pen(c)).interior.length-2);
  const old=pen(c).pasture.gate,newGate=[23,25];
  await tool('gate-'+pen(c).id);
  const s=await wait(s=>s.tool==='pasture-gate');
  const point=mapProjection(s.camera.eye,s.camera.target,width/height,Math.tan(Math.PI/8)).project(newGate[0]+.5,7.01,newGate[1]+.5);
  await play.mouse.move(point);await play.advance(.2,{read});await play.mouse.click(point);
  await wait(s=>pen(s.colony)?.pasture.pendingGate?.join()===newGate.join());
  await reach(c=>pen(c).pasture.ready&&pen(c).pasture.gate.join()===newGate.join()&&c.resources.milk>0);
  c=(await state()).colony;assert.ok(c.buildings.some(b=>b.x===old[0]&&b.z===old[1]&&b.complete&&b.kind==='fence'));
  await close();await record('09-new-gate-and-milk');
}
