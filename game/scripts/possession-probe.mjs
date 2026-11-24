import { returnToMap } from './return-to-map.mjs';
import assert from 'node:assert/strict';
import { tsImport } from 'tsx/esm/api';

const READ='voxel.world';
const SAVE='homestead.colony.v2';
const dot=(a,b)=>a.reduce((sum,n,i)=>sum+n*b[i],0);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const unit=a=>a.map(n=>n/Math.hypot(...a));

export default async function possessionProbe(play){
  const {page}=play;
  const read=()=>play.state(READ);
  const advance=(seconds=.35)=>play.advance(seconds,{read:READ,stepSeconds:.05});
  const wait=predicate=>play.waitFor(predicate,{read:READ,timeoutMs:10000});
  const at=async point=>{
    const {target,eye}=(await read()).camera;
    const forward=unit(target.map((n,i)=>n-eye[i]));
    const right=unit(cross(forward,[0,1,0])),up=cross(right,forward);
    const delta=point.map((n,i)=>n-eye[i]);
    const depth=dot(delta,forward)*Math.tan(Math.PI/8);
    const {width,height}=page.viewportSize();
    return [width/2+dot(delta,right)*height/(2*depth),height/2-dot(delta,up)*height/(2*depth)];
  };
  const resident=(state,id)=>state.colony.colonists.find(person=>person.id===id);
  const clickResident=async id=>{
    const [x,y,z]=resident(await read(),id).position;
    await page.mouse.click(...await at([x,y+.8,z]));
    assert.equal((await advance()).colony.selectedColonistId,id);
  };
  const pressR=async()=>{
    await page.keyboard.press('KeyR');
    return advance();
  };
  const drag=async (source,target)=>{
    const a=await source.boundingBox(),b=await target.boundingBox();
    assert.ok(a&&b);
    await page.mouse.move(a.x+a.width/2,a.y+a.height/2);
    await page.mouse.down();
    await page.mouse.move(b.x+b.width/2,b.y+b.height/2,{steps:12});
    await page.mouse.up();
    return advance();
  };

  assert.equal((await read()).player,null);
  await page.mouse.move(900,345);
  const unselected=await pressR();
  assert.equal(unselected.player,null);
  assert.match(unselected.status,/左键选中村民/);
  await page.locator('[data-menu="sandbox"]').click();
  await returnToMap(play);
  const paused=await advance();
  assert.equal(paused.colony.speed,0);
  const [first]=paused.colony.colonists;
  await clickResident(first.id);
  await play.screenshot('resident-selected-before-possession');
  const possessed=await pressR();
  assert.equal(possessed.camera.followId,first.id);
  assert.equal(possessed.colony.colonists.length,paused.colony.colonists.length);
  assert.deepEqual([possessed.player.x,possessed.player.y,possessed.player.z],first.position);
  assert.deepEqual(possessed.player.bag,resident(possessed,first.id).bag);
  assert.equal(possessed.player.vitals.health,resident(possessed,first.id).health);
  assert.equal(await page.locator('#controlled-resident').textContent(),first.name);
  await play.screenshot('possessed-resident-and-own-hotbar');

  const nearby=possessed.colony.colonists.filter(person=>person.id!==first.id).sort((a,b)=>
    Math.hypot(a.position[0]-possessed.player.x,a.position[2]-possessed.player.z)
    -Math.hypot(b.position[0]-possessed.player.x,b.position[2]-possessed.player.z))[0];
  for(let step=0;step<12&&!(await read()).player.nearColonist;step++){
    const {x,z}=(await read()).player;
    const dx=nearby.position[0]-x,dz=nearby.position[2]-z;
    const key=Math.abs(dx)>Math.abs(dz)?(dx>0?'KeyA':'KeyD'):(dz>0?'KeyW':'KeyS');
    await page.keyboard.down(key);
    await advance(.13);
    await page.keyboard.up(key);
    await advance(.1);
  }
  const second=resident(await read(),(await read()).player.nearColonist);
  assert.ok(second,'应走到另一位村民的交互范围内');
  const [x,y,z]=second.position;
  await page.mouse.click(...await at([x,y+.7,z]),{button:'right'});
  await advance();
  assert.equal(await page.locator('#panel-title').textContent(),second.name);
  assert.equal(await page.locator('.fb-grid .fb-cell[data-index]').count(),9);
  const transferred=await drag(page.locator('#hotbar [data-item="hammer"]'),page.locator('.fb-cell[data-index="8"]'));
  assert.equal(resident(transferred,first.id).bag[0],null);
  assert.deepEqual(resident(transferred,second.id).bag[8],{resource:'hammer',count:1});
  await play.screenshot('ninth-resident-slot-receives-hammer');
  await page.locator('#panel-close').click();
  await page.mouse.move(850,350);
  await advance();
  await page.keyboard.down('KeyD');
  await advance(.26);
  await page.keyboard.up('KeyD');
  const moved=await advance();
  assert.ok(Math.hypot(moved.player.x-transferred.player.x,moved.player.z-transferred.player.z)>.5);
  assert.equal(resident(moved,first.id).jobId,null);
  await page.keyboard.press('Space');
  const jumped=await advance(.18);
  assert.ok(jumped.player.y>moved.player.y+.3);
  await play.screenshot('attached-resident-jumps');
  await advance(.9);
  const released=await pressR();
  assert.equal(released.player,null);
  assert.equal(released.colony.controlledColonistId,null);
  const departed=resident(released,first.id);
  assert.ok(Math.hypot(departed.position[0]-first.position[0],departed.position[2]-first.position[2])>.5);
  assert.equal(departed.task,'等待工作');
  await play.screenshot('released-resident-stays-in-place');
  await clickResident(second.id);
  const changed=await pressR();
  assert.equal(changed.player.id,second.id);
  assert.equal(changed.player.bag[8]?.resource,'hammer');
  assert.equal(changed.player.bag[0],null);
  await page.keyboard.press('Digit9');
  const equipped=await advance();
  assert.equal(equipped.player.bagSelected,8);
  await play.screenshot('second-resident-uses-his-own-ninth-slot');

  await page.waitForFunction(({id,key})=>{
    const data=JSON.parse(localStorage.getItem(key)??'null')?.colony;
    return data?.version===3 && data.colonists.find(person=>person.id===id)?.bagSelected===8;
  },{id:second.id,key:SAVE},{timeout:12000});
  await play.reload();
  const restored=await wait(s=>resident(s,second.id)?.bag[8]?.resource==='hammer');
  assert.equal(restored.player,null);
  assert.deepEqual(resident(restored,first.id).position,departed.position);
  assert.equal(resident(restored,second.id).bagSelected,8);
  await play.screenshot('reload-restores-resident-position-and-inventory');

  const { VoxelWorld }=await tsImport('../assets/voxel/model.ts',import.meta.url);
  const { ColonySimulation }=await tsImport('../assets/colony/simulation.ts',import.meta.url);
  const oldWorld=new VoxelWorld('附身迁移验收');
  const old=new ColonySimulation(oldWorld).serialize();
  old.version=2;
  old.playerBag=[{resource:'hammer',count:1},{resource:'steel',count:7},...Array(7).fill(null)];
  old.bagSelected=1;
  for(const person of old.colonists){
    person.bag=[null];
    delete person.bagSelected;delete person.facing;delete person.stamina;
  }
  old.colonists[1].bag=[{resource:'stone',count:3}];
  await page.evaluate(({key,value})=>localStorage.setItem(key,value),{key:SAVE,value:JSON.stringify({version:2,voxel:oldWorld.serialize(),colony:old})});
  await play.reload();
  const migrated=await wait(s=>s.seed===oldWorld.seed&&s.colony.chests.some(chest=>chest.id==='chest-legacy-player'));
  const legacy=migrated.colony.chests.find(chest=>chest.id==='chest-legacy-player');
  assert.deepEqual(legacy.slots.slice(0,2),old.playerBag.slice(0,2));
  assert.deepEqual(migrated.colony.colonists[1].bag,[{resource:'stone',count:3},...Array(8).fill(null)]);
  assert.equal(migrated.player,null);
  await play.screenshot('legacy-items-migrated-to-camp-chest');
  return {possessed:[first.name,second.name],slot:9,migrated:legacy.id};
}
