import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {tsImport} from 'tsx/esm/api';
import {createFacadeTerrainFixture} from './facade-playthrough.mjs';
import {returnToMap} from './return-to-map.mjs';

const key='homestead.colony.v2', read='voxel.world', out='artifacts/wall-connections';
const dot=(a,b)=>a.reduce((n,v,i)=>n+v*b[i],0);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const unit=a=>a.map(v=>v/Math.hypot(...a));
const cell=(s,x,z)=>s.colony.buildings.find(b=>b.x===x && b.z===z);

export default async function wallConnections(play){
  const {VoxelWorld}=await tsImport('../assets/voxel/model.ts',import.meta.url);
  const {ColonySimulation}=await tsImport('../assets/colony/simulation.ts',import.meta.url);
  const {buildingDimensions,isSwingDoor}=await tsImport('../assets/colony/buildings.ts',import.meta.url);
  const world=VoxelWorld.deserialize(createFacadeTerrainFixture());
  for(const tree of world.getTrees()) world.removeTree(tree.id,{recordHistory:false});
  const sim=new ColonySimulation(world),source=sim.serialize();
  for(const k of ['jobs','buildings','items','zones','crops','terrainPlans','warehouseStacks']) source[k]=[];
  source.speed=0;
  source.colonists.forEach((c,i)=>{
    Object.assign(c,{position:i?[22.5+i,5,18.5]:[16.5,5,15.5],path:[],personal:null,destination:null,jobId:null,hunger:100,rest:100,recreation:100});
    for(const job of Object.keys(c.priorities)) c.priorities[job]=i && job==='construct'?1:0;
  });
  const fixture=complete=>{
    const colony=structuredClone(source);
    const add=(kind,x,z)=>colony.buildings.push({id:kind+'-'+x+'-'+z,kind,x,y:5,z,rotation:0,...buildingDimensions(kind),
      ...(isSwingDoor(kind)?{doorOpen:false}:{}),complete,phase:complete?'completed':'readyToBuild',progress:complete?1:0,
      reserved:{},powered:false,comfort:0,roomId:null});
    for(let x=13;x<=21;x++) for(let z=13;z<=20;z++){
      if(x!==13 && x!==21 && z!==13 && z!==20 || x===21 && z===17)continue;
      const kind=!complete?'woodWall':z===13?'wall':x===17 && z===20?'stoneDoor':
        x===13 && z===17?'autoDoor':x===13?'greenhouseWall':z===20?'brickWall':'woodWall';
      add(kind,x,z);
    }
    sim.load(colony);
    return {version:2,voxel:world.serialize(),colony:sim.serialize()};
  };
  const {page}=play, wait=fn=>play.waitFor(fn,{read,timeoutMs:15000}), advance=(t=.15)=>play.advance(t,{read,stepSeconds:.05});
  const button=id=>page.locator('[data-testid="'+id+'"]'), readings=[];
  mkdirSync(out,{recursive:true});
  const shot=async(name)=>{
    assert.ok((await play.screenshot(name)).rendered);
    const s=await play.state(read);
    readings.push({name,preview:s.previewConnection,rooms:s.colony.rooms.map(r=>r.cells.length),windows:s.pcg.windows,
      buildings:s.colony.buildings.map(({kind,x,z,rotation,connections,complete,doorOpen})=>({kind,x,z,rotation,connections,complete,doorOpen}))});
    writeFileSync(out+'/readings.json',JSON.stringify(readings,null,2));
  };
  const restore=async file=>{
    await page.evaluate(([k,file])=>localStorage.setItem(k+'.manual',JSON.stringify(file)),[key,file]);
    await page.locator('#load').evaluate(el=>el.click());
  };
  const load=async complete=>{
    await restore(fixture(complete));
    await wait(s=>cell(s,13,13)?.complete===complete && cell(s,21,16)?.connections===8);
    await play.mouse.move([.5,.46]);
    for(let i=0;i<12 && (await play.state(read)).camera.distance>22;i++){
      await page.mouse.wheel(0,-240);await advance();
    }
  };
  const project=(s,p)=>{
    const {eye,target}=s.camera,f=unit(target.map((n,i)=>n-eye[i])),r=unit(cross(f,[0,1,0])),u=cross(r,f);
    const rel=p.map((n,i)=>n-eye[i]),half=Math.tan(Math.PI/8)*dot(rel,f),{width,height}=page.viewportSize();
    return [.5+dot(rel,r)*height/(2*half*width),.5-dot(rel,u)/(2*half)];
  };
  const select=async(x,z)=>{
    await returnToMap(play);
    const s=await play.state(read),b=cell(s,x,z);
    for(const dy of [1.95,1.5,.9,.25]){
      const pt=project(s,[x+.5,b.y+dy,z+.5]);await play.mouse.move(pt);
      if((await advance()).hoverBuildingId!==b.id)continue;
      await play.mouse.click(pt);await wait(a=>a.selectedBuildingId===b.id);return;
    }
    assert.fail('未选到 '+b.id);
  };
  const fillDoor=async(capture)=>{
    await returnToMap(play);await button('menu-build').click();
    if(capture){
      for(const kind of ['wall','door','floor']) assert.equal(await button('build-'+kind).evaluate(b=>b.closest('.card-grid').previousElementSibling.textContent),'结构');
      await button('build-wall').scrollIntoViewIfNeeded();
      await shot('00-structure-catalog');
    }
    await button('build-door').click();
    await page.locator('#workspace').waitFor({state:'hidden'});
    const pt=project(await play.state(read),[21.5,5.01,17.5]);await play.mouse.move(pt);
    const s=await wait(a=>a.hoverCell?.[0]===21 && a.hoverCell[2]===17 && a.previewConnection?.rotation===1);
    assert.equal(s.buildRotation,0);assert.equal(s.previewConnection.connections,10);
    await button('build-orientation').filter({hasText:'90°'}).waitFor({state:'visible'});
    if(capture) await shot('02-door-preview');
    await play.mouse.click(pt);await wait(a=>cell(a,21,17)?.rotation===1 && cell(a,21,16)?.connections===10);
    await returnToMap(play);
  };
  const speed=async n=>{
    await button('speed-'+n).evaluate(el=>el.click());await wait(s=>s.colony.speed===n);
  };
  const runUntil=async predicate=>{
    await speed(3);
    let s=await advance();
    for(let i=0;i<90 && !predicate(s);i++) s=await advance(1);
    assert.ok(predicate(s),JSON.stringify({speed:s.colony.speed,jobs:s.colony.jobs,workers:s.colony.colonists.map(c=>c.task)}));
    await speed(0);
  };
  await wait(s=>s.colony?.colonists.length===3);
  await play.step('旧蓝图纵墙、四角、补门和撤销',async()=>{
    await load(false);await select(21,15);assert.match(await button('building-dimensions').innerText(),/90° · 直线/);
    await shot('01-before-door');await fillDoor(true);await select(21,17);
    let s=await play.state(read);
    for(const [x,z,mask] of [[13,13,3],[21,13,6],[21,20,12],[13,20,9]])assert.equal(cell(s,x,z).connections,mask);
    await shot('03-full-rectangle');
    await button('building-demolish').click();s=await wait(a=>!cell(a,21,17));
    assert.equal(cell(s,21,16).connections,8);assert.equal(cell(s,21,18).connections,2);
    await select(21,16);await shot('04-cancelled');
    for(const [x,mask,name] of [[20,14,'04b-tee'],[22,15,'04c-cross']]){
      await returnToMap(play);await button('menu-build').click();await button('build-woodWall').click();
      await page.locator('#workspace').waitFor({state:'hidden'});
      const pt=project(await play.state(read),[x+.5,5.01,15.5]);await play.mouse.move(pt);
      await wait(s=>s.hoverCell?.[0]===x && s.hoverCell[2]===15);
      await play.mouse.click(pt);await wait(s=>cell(s,21,15)?.connections===mask);
      await select(21,15);await shot(name);
    }
  });
  await play.step('混合旧实体、嵌窗、补建木门、石门和自动门',async()=>{
    await load(true);await fillDoor(false);
    await runUntil(s=>cell(s,21,17)?.complete);
    const doorways=[[17,20],[21,17]];
    const doorwaysClear=s=>doorways.every(([x,z])=>s.colony.colonists.every(({position:[px,,pz]})=>
      px<x-.45 || px>x+1.45 || pz<z-.45 || pz>z+1.45));
    // A builder can immediately use the new door. Let every resident clear the
    // threshold before pausing for the two manual open/close comparisons.
    for(let i=0;i<5 && !doorwaysClear(await play.state(read));i++)await runUntil(doorwaysClear);
    assert.ok(doorwaysClear(await play.state(read)));
    for(const [x,z] of doorways){
      if(cell(await play.state(read),x,z).doorOpen){
        await select(x,z);await button('building-toggle-door').click();await wait(s=>!cell(s,x,z).doorOpen);
      }
    }
    await wait(s=>s.colony.rooms.some(r=>r.cells.length===42));
    let s=await play.state(read);
    assert.ok(s.pcg.windows>0);
    const win=s.pcg.layout.groups.find(g=>g.axis==='x' && g.plane===13);
    await select(Math.floor((win.u0+win.u1)/2),13);await shot('05-window');
    await select(13,17);assert.match(await button('building-dimensions').innerText(),/90° · 单轴门/);
    await shot('06-auto-door');
    for(const [x,z,label] of [[17,20,'07-stone-door-open'],[21,17,'08-wood-door-open']]){
      await select(x,z);await button('building-toggle-door').click();await wait(a=>cell(a,x,z).doorOpen && !a.colony.rooms.length);
      await shot(label);
      await button('building-toggle-door').click();await wait(a=>!cell(a,x,z).doorOpen && a.colony.rooms.length===1);
    }
    await select(21,20);assert.match(await button('building-dimensions').innerText(),/L 形转角/);await shot('09-before-demolition');
    await button('building-demolish').click();await runUntil(a=>!cell(a,21,20));
    s=await play.state(read);assert.equal(cell(s,21,19).connections,8);assert.equal(cell(s,20,20).connections,4);
    await select(21,19);await shot('10-demolished');
    await page.locator('#save').evaluate(el=>el.click());
    await page.waitForFunction(k=>JSON.parse(localStorage.getItem(k+'.manual')||'null')?.colony.buildings.some(b=>b.kind==='door' && b.complete),key);
    const saved=await page.evaluate(k=>JSON.parse(localStorage.getItem(k+'.manual')),key);
    const door=saved.colony.buildings.find(b=>b.kind==='door');assert.equal(door.rotation,0);assert.ok(!('connections' in door));
    await load(false);await restore(saved);
    await wait(a=>!cell(a,21,20) && cell(a,21,17)?.complete && cell(a,21,17).rotation===1);
    await select(21,19);await shot('11-reloaded');
  });
}
