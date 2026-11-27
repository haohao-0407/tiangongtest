import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {tsImport} from 'tsx/esm/api';
import {createFacadeTerrainFixture} from './facade-playthrough.mjs';

export default async function pasture(play) {
  const {VoxelWorld}=await tsImport('../assets/voxel/model.ts',import.meta.url);
  const {ColonySimulation}=await tsImport('../assets/colony/simulation.ts',import.meta.url);
  const world=VoxelWorld.deserialize(createFacadeTerrainFixture());
  const sim=new ColonySimulation(world),save=sim.serialize();
  save.speed=0;save.time=120;save.jobs=[];save.items=[];save.crops=[];save.buildings=[];save.terrainPlans=[];save.warehouseStacks=[];
  save.zones=[{id:'store',kind:'stockpile',x:2,y:5,z:2,w:4,d:4,crop:'cabbage'}];
  save.resources.wood=240;
  for(const p of save.colonists) {p.health=p.hunger=p.rest=p.recreation=100;p.disease=0;}
  const {page}=play,read='voxel.world',out='artifacts/pasture',key='homestead.colony.v2';
  mkdirSync(out,{recursive:true});
  const wait=pred=>play.waitFor(pred,{read,timeoutMs:18000});
  const click=id=>page.locator('[data-testid="'+id+'"]').click();
  const shot=name=>page.screenshot({path:out+'/'+name+'.png'});
  await wait(s=>s.colony?.colonists.length);
  await page.evaluate(([k,file])=>localStorage.setItem(k,JSON.stringify(file)),[key,{version:2,voxel:world.serialize(),colony:save}]);
  await play.reload();await wait(s=>s.seed===world.seed&&s.colony.speed===0);
  await click('menu-plan');await click('tool-zone-pasture');
  await wait(s=>s.tool==='zone:pasture');await page.locator('#workspace').waitFor({state:'hidden'});
  const {width,height}=page.viewportSize();
  await page.mouse.move(width*.4,height*.48);await page.mouse.down();await page.mouse.move(width*.57,height*.62);
  const preview=await wait(s=>s.zonePreview?.cells.length>=16);
  assert.equal(preview.zonePreview.invalid.length,0);
  await shot('01-preview');await page.mouse.up();
  const s=await wait(s=>s.colony.zones.some(z=>z.kind==='pasture'));
  const pen=s.colony.zones.find(z=>z.kind==='pasture');
  assert.ok(pen.pasture.capacity>0);assert.equal(pen.pasture.ready,false);
  assert.equal(s.colony.buildings.filter(b=>b.kind==='pastureGate').length,1);
  assert.ok(s.colony.buildings.some(b=>b.kind==='fence'));
  await shot('02-fence-plans');
}
