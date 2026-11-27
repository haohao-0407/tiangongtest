import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync} from 'node:fs';
import {tsImport} from 'tsx/esm/api';
import {createFacadeTerrainFixture} from './facade-playthrough.mjs';

export default async function guideHousingPlaythrough(play) {
  const {ColonySimulation}=await tsImport('../assets/colony/simulation.ts',import.meta.url);
  const {VoxelWorld}=await tsImport('../assets/voxel/model.ts',import.meta.url);
  const {buildingDimensions}=await tsImport('../assets/colony/buildings.ts',import.meta.url);
  const {quoteGuideTrade}=await tsImport('../assets/colony/guide-housing.ts',import.meta.url);
  const world=VoxelWorld.deserialize(createFacadeTerrainFixture()), sim=new ColonySimulation(world);
  const save=sim.serialize();
  Object.assign(save,{speed:0,buildings:[],items:[],jobs:[],terrainPlans:[],zones:[],crops:[],warehouseStacks:[]});
  delete save.guideBedId; // An existing game from before guide housing was introduced.
  const add=(kind,x,z,id=kind+'-'+x+'-'+z)=>save.buildings.push({
    id,kind,x,y:5,z,rotation:0,...buildingDimensions(kind),complete:true,phase:'completed',progress:1,
    reserved:{},powered:false,comfort:0,roomId:null,...(kind==='stoneDoor'?{doorOpen:true}:{}),
  });
  for(let z=13;z<=19;z++)for(let x=13;x<=19;x++) {
    if(x!==13 && x!==19 && z!==13 && z!==19)continue;
    if(x===16 && z===19)add('stoneDoor',x,z,'stone-door');
    else add(x===13?'woodWall':z===13?'greenhouseWall':'brickWall',x,z);
  }
  add('table',16,16,'guide-table');
  add('bed',15,14,'guide-bed');
  save.colonists.forEach((c,i)=>Object.assign(c,{position:[9.5+i,5,10.5],jobId:null,path:[],destination:null,personal:null}));
  const read='voxel.world', page=play.page, wait=predicate=>play.waitFor(predicate,{read,timeoutMs:15000});
  const out='artifacts/guide-housing', record=[];
  mkdirSync(out,{recursive:true});
  const confirm=async(name,status,buy,recycle)=>{
    const {colony}=await play.state(read);
    const housing=colony.guideHousing;
    assert.equal(housing.npcId,'guide');
    assert.equal(housing.status,status);
    assert.equal(housing.bedId,status==='housed'?'guide-bed':null);
    const order={baseBuy:96,baseRecycle:60,count:3,premiumCount:1,housing};
    const purchase=quoteGuideTrade({...order,side:'buy'}),sale=quoteGuideTrade({...order,side:'recycle'});
    assert.equal(purchase.total,buy);
    assert.equal(sale.total,recycle);
    assert.equal(sale.premiumCount,1);
    record.push({name,housing,roomCount:colony.rooms.length,breadBuy:purchase,breadRecycle:sale});
    writeFileSync(out+'/housing.json',JSON.stringify(record,null,2));
    await page.screenshot({path:out+'/'+name+'.png'});
    return housing;
  };
  const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
  const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const unit=a=>a.map(v=>v/Math.hypot(...a));
  const select=async id=>{
    const close=page.locator('#inspector-close');
    if(await close.isVisible())await close.click();
    const s=await play.state(read),{eye,target}=s.camera,b=s.colony.buildings.find(b=>b.id===id);
    const forward=unit(target.map((n,i)=>n-eye[i])),right=unit(cross(forward,[0,1,0])),up=cross(right,forward);
    const {width,height}=page.viewportSize();
    for(const dy of [.85,.45,.1]) {
      const relative=[b.x+.5,b.y+b.h*dy,b.z+.5].map((n,i)=>n-eye[i]);
      const half=Math.tan(Math.PI/8)*dot(relative,forward);
      const point=[.5+dot(relative,right)/(2*half*width/height),.5-dot(relative,up)/(2*half)];
      await play.mouse.move(point);
      if((await play.advance(.1,{read})).hoverBuildingId!==id)continue;
      await play.mouse.click(point);
      await wait(s=>s.selectedBuildingId===id);
      return;
    }
    assert.fail('地图上未点到设施 '+id);
  };
  await wait(s=>s.colony?.colonists.length);
  await page.evaluate(file=>localStorage.setItem('homestead.colony.v2',JSON.stringify(file)),
    {version:2,voxel:world.serialize(),colony:save});
  await play.reload();
  await wait(s=>s.colony?.buildings.some(b=>b.id==='stone-door' && b.doorOpen));
  const toggle=page.locator('[data-testid="building-toggle-door"]');
  await select('stone-door');
  await confirm('01-camp','camp',288,192);
  await toggle.click();
  await wait(s=>s.colony?.guideHousing.status==='housed');
  await select('guide-table');
  const inspector=page.locator('[data-testid="building-inspector"]');
  assert.match(await inspector.innerText(),/室内 · 25 格 · 舒适度 49/);
  const housed=await confirm('02-housed','housed',267,206);
  assert.equal(housed.quality,74.5);
  await select('stone-door');
  await toggle.click();
  await wait(s=>s.colony?.rooms.length===0 && s.colony.guideHousing.roomId===null);
  const opened=await confirm('03-open','housed',267,206);
  assert.deepEqual(opened,{...housed,roomId:null});
  await page.locator('#inspector-close').click();
  await play.keyboard.press('Escape');
  await page.locator('#pause-settings').click();
  await page.locator('#options-world').click();
  await page.locator('#save').click();
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('homestead.colony.v2.manual') || 'null')?.colony.guideBedId==='guide-bed');
  await play.reload();
  await wait(s=>s.colony?.buildings.some(b=>b.id==='stone-door' && b.doorOpen) && s.colony.guideHousing.bedId==='guide-bed');
  await select('stone-door');
  const restored=await confirm('04-reloaded','housed',267,206);
  assert.deepEqual(restored,opened);
  await toggle.click();
  await wait(s=>s.colony?.guideHousing.roomId===0);
  assert.deepEqual((await play.state(read)).colony.guideHousing,housed);
  return {savedBed:housed.bedId,quality:housed.quality,checkpoints:record.length};
}
