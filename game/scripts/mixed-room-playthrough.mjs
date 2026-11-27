import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {tsImport} from 'tsx/esm/api';
import {createFacadeTerrainFixture} from './facade-playthrough.mjs';

export default async function mixedRoom(play) {
  const {VoxelWorld}=await tsImport('../assets/voxel/model.ts',import.meta.url);
  const {ColonySimulation}=await tsImport('../assets/colony/simulation.ts',import.meta.url);
  const {buildingDimensions}=await tsImport('../assets/colony/buildings.ts',import.meta.url);
  const world=VoxelWorld.deserialize(createFacadeTerrainFixture()), sim=new ColonySimulation(world);
  const save=sim.serialize();
  Object.assign(save,{speed:0,buildings:[],items:[],jobs:[],terrainPlans:[],zones:[],crops:[],warehouseStacks:[]});
  const add=(kind,x,z,id=kind+'-'+x+'-'+z)=>save.buildings.push({
    id,kind,x,y:5,z,rotation:0,...buildingDimensions(kind,0),complete:true,phase:'completed',progress:1,
    reserved:{},powered:false,comfort:0,roomId:null,
  });
  for(let z=13;z<=19;z++)for(let x=13;x<=19;x++) {
    if(x!==13 && x!==19 && z!==13 && z!==19)continue;
    if(x===16 && z===19)add('stoneDoor',x,z,'stone-door');
    else add(x===13?'woodWall':z===13?'greenhouseWall':'brickWall',x,z);
  }
  add('table',16,16,'room-table');
  save.colonists.forEach((c,i)=>Object.assign(c,{position:[9.5+i,5,10.5],jobId:null,path:[],destination:null,personal:null}));
  sim.load(save);
  const read='voxel.world', page=play.page, wait=predicate=>play.waitFor(predicate,{read,timeoutMs:12000});
  const inspector=page.locator('[data-testid="building-inspector"]');
  const capture=async(name)=>{
    const out='artifacts/mixed-room';
    mkdirSync(out,{recursive:true});
    await page.screenshot({path:out+'/'+name+'.png'});
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
    {version:2,voxel:world.serialize(),colony:sim.serialize()});
  await play.reload();
  await wait(s=>s.colony?.rooms[0]?.cells.length===25 && s.colony.speed===0);
  await select('room-table');
  assert.match(await inspector.innerText(),/室内 · 25 格 · 舒适度 42/);
  assert.match(await inspector.innerText(),/房间清洁度 100/);
  await capture('01-inside');
  await select('stone-door');
  await page.locator('[data-testid="building-toggle-door"]').click();
  await wait(s=>!s.colony.rooms.length);
  await capture('02-door-open');
  await select('room-table');
  assert.match(await inspector.innerText(),/室外/);
  await capture('03-outside');
  await select('stone-door');
  await page.locator('[data-testid="building-toggle-door"]').click();
  await wait(s=>s.colony.rooms[0]?.cells.length===25);
  await page.locator('#inspector-close').click();
  await play.keyboard.press('Escape');
  await page.locator('#pause-settings').click();
  await page.locator('#options-world').click();
  await page.locator('#save').click();
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('homestead.colony.v2.manual') || 'null')?.colony.buildings.some(b=>b.id==='stone-door' && b.doorOpen===false));
  await play.reload();
  await wait(s=>s.colony?.rooms[0]?.cells.length===25 && s.colony.buildings.some(b=>b.id==='stone-door' && b.doorOpen===false));
  await select('room-table');
  assert.match(await inspector.innerText(),/室内 · 25 格/);
  await capture('04-reloaded');
}
