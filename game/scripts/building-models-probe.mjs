import assert from 'node:assert/strict';
import { tsImport } from 'tsx/esm/api';
import { createFacadeTerrainFixture } from './facade-playthrough.mjs';

const groups = {
  structures: ['wall', 'wall', 'wall', 'wall', 'door', 'woodWall', 'brickWall', 'stoneDoor', 'autoDoor'],
  furniture: ['bed', 'medicalBed', 'doubleBed', 'bedroll', 'table', 'chair', 'stool', 'shelf', 'chest', 'painting'],
  production: ['workbench', 'researchDesk', 'advancedResearchDesk', 'artBench', 'stoneCutter', 'tailorBench',
    'forgery', 'fabricator', 'stove', 'campStove', 'pickleBarrel', 'brewBarrel', 'cheesePress'],
  agriculture: ['campfire', 'planter', 'sprinkler', 'hydroponics', 'greenhouseWall', 'scarecrow', 'compostBin'],
};

export default async function buildingModels(play) {
  const read = 'voxel.world';
  const advance = () => play.advance(.25, {read, stepSeconds:.05});
  const wait = predicate => play.waitFor(predicate, {read, timeoutMs:15000});
  const capture = async name => assert.equal((await play.screenshot(name)).rendered, true);
  const {VoxelWorld} = await tsImport('../assets/voxel/model.ts',import.meta.url);
  const {ColonySimulation} = await tsImport('../assets/colony/simulation.ts',import.meta.url);
  const {buildingDimensions} = await tsImport('../assets/colony/buildings.ts',import.meta.url);
  const voxel = createFacadeTerrainFixture();
  const world = VoxelWorld.deserialize(voxel);
  const base = new ColonySimulation(world).serialize();
  const chest = base.buildings.find(b => b.kind === 'chest');
  const verified = new Set();
  for (const [category,kinds] of Object.entries(groups)) {
    const colony = structuredClone(base);
    colony.speed = 0;
    colony.jobs = []; colony.items = []; colony.crops = []; colony.zones = [];
    colony.colonists.forEach((c,i) => { c.position = [16.5,5,16.5+i*2]; c.jobId = null; });
    colony.buildings = kinds.map((kind,index) => {
      const rotation = kind === 'bed' ? 1 : 0;
      const x = category === 'structures' ? 13+index%5 : 13+index%4*2.4;
      const z = category === 'structures' ? 15+Math.floor(index/5)*2 : 13+Math.floor(index/4)*2.5;
      return {id:`model-${category}-${index}`,kind,x:Math.round(x),y:5,z:Math.round(z),...buildingDimensions(kind,rotation),
        rotation,phase:'completed',complete:true,progress:1,reserved:{},powered:true,comfort:0,roomId:null,
        ...(kind === 'door' ? {doorOpen:false} : {}), ...(kind === 'chest' ? {storage:chest.storage} : {})};
    });
    // Let the production save loader validate the fixture before driving the game.
    new ColonySimulation(world).load(colony);
    await play.page.evaluate(data => window.__wbSend('load',{data}),JSON.stringify({version:2,voxel,colony}));
    await wait(s => s.colony.buildings[0]?.id === colony.buildings[0].id);
    await play.page.mouse.move(640,360);
    for (let turn=0; turn<4; turn++) { await play.page.mouse.wheel(0,-300); await advance(); }
    await play.mouse.move([.83,.72]); await advance();
    await capture(`building-models-${category}`);
    for (const kind of kinds) verified.add(kind);
    if (category === 'structures') {
      const state = await play.state(read);
      assert.ok(state.pcg.windowGroups > 0);
      const door = state.colony.buildings.find(b => b.kind === 'door');
      await play.page.evaluate(id => window.__wbSend('colony',{command:{action:'toggleDoor',id}}),door.id);
      await wait(s => s.colony.buildings.some(b => b.id === door.id && b.doorOpen));
      await capture('building-models-open-door');
    }
    if (category === 'furniture') {
      const bed = (await play.state(read)).colony.buildings.find(b => b.kind === 'bed');
      assert.deepEqual([bed.w,bed.d,bed.rotation],[2,1,1]);
      await play.page.locator('[data-menu="build"]').click();
      await play.page.locator('[data-testid="build-bed"]').click();
      await wait(s => s.tool === 'build:bed');
      await play.page.locator('#panel-close').click();
      await play.mouse.move([.66,.67]);
      await play.keyboard.press('KeyR');
      await wait(s => s.buildRotation === 1 && !!s.hoverCell);
      await advance();
      const preview = (await play.state(read)).placementPreview;
      assert.ok(preview);
      const {hoverCell:[x,y,z]} = await play.state(read);
      assert.deepEqual(preview.position,[x+1,y,z+.5]);
      assert.ok(Math.abs(preview.rotation[1]+Math.SQRT1_2)<.0001);
      await capture('building-models-rotated-preview');
      await play.page.mouse.down(); await play.page.mouse.up();
      await wait(s => s.colony.buildings.some(b => b.kind === 'bed' && b.rotation === 1 && !b.complete));
      await play.mouse.move([.81,.63]); await advance();
      await capture('building-models-placed-blueprint');
      await play.page.locator('[data-menu="inspect"]').click();
    }
  }
  await play.reload();
  await wait(s => s.colony.buildings[0]?.id === 'model-agriculture-0');
  assert.equal(verified.size,36);
  return {models:[...verified],restored:true};
}
