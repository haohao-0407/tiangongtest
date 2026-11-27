import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {tsImport} from 'tsx/esm/api';
import {createFacadeTerrainFixture} from './facade-playthrough.mjs';

export default async function zones(play){
  const {VoxelWorld}=await tsImport('../assets/voxel/model.ts',import.meta.url);
  const {ColonySimulation}=await tsImport('../assets/colony/simulation.ts',import.meta.url);
  const world=VoxelWorld.deserialize(createFacadeTerrainFixture()), sim=new ColonySimulation(world);
  const save=sim.serialize();
  save.speed=0;save.time=120;save.jobs=[];save.crops=[];save.warehouseStacks=[];
  save.zones=save.zones.filter(z=>z.kind==='stockpile');
  Object.assign(save.zones[0],{x:2,z:2,w:2,d:2});
  save.buildings=save.buildings.filter(b=>b.kind==='stove');
  for(const k of Object.keys(save.resources)) save.resources[k]=0;
  save.resources.cabbageSeed=9;
  for(const person of save.colonists){
    person.hunger=person.rest=person.recreation=100;
    for(const k of Object.keys(person.priorities)) person.priorities[k]=['grow','haul'].includes(k)?1:0;
  }
  const {page}=play,read='voxel.world',dir='artifacts/zone-marquee';
  mkdirSync(dir,{recursive:true});
  const state=()=>play.state(read), wait=p=>play.waitFor(p,{read,timeoutMs:12000});
  const click=id=>page.locator('[data-testid="'+id+'"]').click();
  const snap=async name=>{await page.screenshot({path:dir+'/'+name+'.png'});};
  const choose=async kind=>{
    if(!await page.locator('#workspace').isVisible()) await click('menu-plan');
    await click('tool-zone-'+kind);
    await wait(s=>s.tool==='zone:'+kind);
    await page.locator('#workspace').waitFor({state:'hidden'});
  };
  const key='homestead.colony.v2';
  await wait(s=>s.colony?.colonists.length);
  await page.evaluate(([key,file])=>localStorage.setItem(key,JSON.stringify(file)),[key,{version:2,voxel:world.serialize(),colony:save}]);
  await play.reload();
  const initial=await wait(s=>s.seed===world.seed && s.colony.speed===0);
  assert.deepEqual(initial.colony.zones[0],save.zones[0]);
  await play.mouse.move([.5,.5]);await page.keyboard.down('e');
  await play.advance(.35,{read});await page.keyboard.up('e');
  const {camera}=await state();
  assert.ok(Math.abs(initial.camera.yaw-camera.yaw)>.1 && camera.pitch>.2);
  const drag=async(a,b)=>{
    const {width,height}=page.viewportSize();
    await page.mouse.move(a[0]*width,a[1]*height);await page.mouse.down();
    await page.mouse.move(b[0]*width,b[1]*height);
    return (await wait(s=>s.zonePreview?.cells.length>1 &&
      Math.abs(s.zonePreview.end[0]-b[0])*width<1.1 && Math.abs(s.zonePreview.end[1]-b[1])*height<1.1)).zonePreview;
  };
  const same=(a,b)=>assert.deepEqual(a.map(p=>p.join(',')).sort(),b.map(p=>p.join(',')).sort());
  const farmA=[.51,.66],farmB=[.42,.57],stockA=[.53,.53],stockB=[.62,.60];
  await choose('farm');
  const preview=await drag(farmA,farmB);
  assert.equal(preview.invalid.length,0);
  await snap('01-farm-reverse-preview');
  await page.mouse.up();
  const first=await wait(s=>s.colony.zones.some(z=>z.kind==='farm'));
  const farm=first.colony.zones.find(z=>z.kind==='farm');
  same(farm.cells,preview.cells);same(farm.cells,first.colony.crops.map(c=>[c.x,c.z]));
  assert.ok(farm.cells.length!==9 && farm.cells.length<farm.w*farm.d);
  await choose('stockpile');await snap('02-farm-committed');
  const invalid=await drag([farmB[0]-.025,farmB[1]-.025],farmA);
  assert.ok(invalid.invalid.length && invalid.invalid.length<invalid.cells.length);
  await snap('03-invalid-mixed');await page.mouse.up();
  await wait(s=>!s.zonePreview && s.status.includes('未提交'));
  assert.equal((await state()).colony.zones.length,2);
  const stockPreview=await drag(stockA,stockB);assert.equal(stockPreview.invalid.length,0);
  await snap('04-stockpile-preview');await page.mouse.up();
  const stored=await wait(s=>s.colony.zones.length===3);
  const stock=stored.colony.zones.at(-1);same(stock.cells,stockPreview.cells);
  await choose('farm');await snap('05-stockpile-committed');
  await drag(stockB,stockA);await page.keyboard.press('Escape');await page.mouse.up();
  await wait(s=>!s.zonePreview && s.tool==='inspect');assert.equal((await state()).colony.zones.length,3);
  await snap('escape-cancelled');
  await choose('farm');await drag(stockA,stockB);
  await page.mouse.down({button:'right'});await page.mouse.up({button:'right'});await page.mouse.up();
  await wait(s=>!s.zonePreview && s.tool==='inspect');assert.equal((await state()).colony.zones.length,3);
  await snap('right-click-cancelled');
  await choose('farm');await play.mouse.click([.42,.49]);
  const single=await wait(s=>s.colony.zones.length===4);assert.equal(single.colony.zones.at(-1).cells.length,1);
  await page.locator('#panel-close').click();
  await play.keyboard.press('Escape');await page.locator('#pause-settings').click();
  await page.locator('#options-world').click();
  await page.locator('#save').click();
  await page.waitForFunction(key=>JSON.parse(localStorage.getItem(key+'.manual')||'null')?.colony.zones.length===4,key);
  await play.reload();
  const restored=await wait(s=>s.colony.zones.length===4);
  assert.deepEqual(restored.colony.zones,single.colony.zones);
  await choose('farm');await snap('06-reloaded-zones');
  await page.keyboard.press('Escape');await page.locator('#panel-close').click();
  const file=await page.evaluate(key=>JSON.parse(localStorage.getItem(key+'.manual')),key);
  sim.load(file.colony);sim.command({action:'speed',value:1});
  let after=sim.snapshot();
  const farmKeys=new Set(farm.cells.map(p=>p.join(','))), stockKeys=new Set(stock.cells.map(p=>p.join(',')));
  const sown=c=>c.crops.filter(p=>p.planted && farmKeys.has([p.x,p.z].join(',')));
  const delivered=c=>c.warehouseStacks.filter(p=>['wood','stone'].includes(p.resource) && stockKeys.has([p.x,p.z].join(',')));
  for(let n=0;n<1600 && !(sown(after).length && delivered(after).length);n++){
    sim.tick(.25);if(n%4===0) after=sim.snapshot();
  }
  assert.ok(sown(after).length,'居民在框选农田内完成播种');
  assert.ok(delivered(after).length,'居民将地面物资搬入框选仓储');
  writeFileSync(dir+'/result.json',JSON.stringify({camera,farm,stock,single:single.colony.zones.at(-1),
    invalid:invalid.invalid.length,sown:sown(after),delivered:delivered(after)},null,2));
}
