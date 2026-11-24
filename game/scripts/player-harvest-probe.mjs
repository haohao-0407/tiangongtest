import assert from 'node:assert/strict';
import { possessResident } from './select-resident.mjs';
import { tsImport } from 'tsx/esm/api';

const { VoxelWorld, BLOCK } = await tsImport('../assets/voxel/model.ts', import.meta.url);
const { ColonySimulation, workPercent } = await tsImport('../assets/colony/simulation.ts', import.meta.url);
const READ = 'voxel.world';
const SAVE = 'homestead.colony.v2';
const dot = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = vector => vector.map(value => value / Math.hypot(...vector));

export default async function playerHarvest(play) {
  const { page } = play;
  const read = () => play.state(READ);
  const advance = (seconds=.25) => play.advance(seconds, {read:READ,stepSeconds:.05});
  const meter = page.locator('#destruction-progress');
  const world = new VoxelWorld('采集验收');
  const dirt = [124,5,125], stone = [126,5,125], ore = [125,5,126];
  const seedNear = [125,5,124], seedDiagonal = [126,5,124];
  const tree = { id: 'harvest-probe-tree', x: 124, y: 6, z: 126, trunkHeight: 3, crownRadius: 1, variant: 0, rotation: 0 };
  world.edit([seedNear, seedDiagonal, [123,5,125], [tree.x, tree.y - 1, tree.z]].map(([x,y,z]) => ({ x, y, z, block: BLOCK.Grass })));
  world.edit([dirt,stone,ore].map(([x,y,z],i)=>({x,y,z,block:[BLOCK.Dirt,BLOCK.Stone,BLOCK.SteelOre][i]})));
  const colony = new ColonySimulation(world);
  const fixture=colony.serialize();
  const residentId = fixture.colonists[0].id;
  fixture.colonists[0].position=[125.5,6,125.5];
  fixture.colonists[0].bag[3] = { resource: 'tomatoSeed', count: 2 };
  fixture.buildings = [];
  fixture.zones = [];
  fixture.jobs = [];
  fixture.crops = [];
  fixture.items = [];
  for(const job of Object.keys(fixture.colonists[0].priorities))fixture.colonists[0].priorities[job]=0;
  for (const resident of fixture.colonists) {
    resident.priorities.grow = 0;
    resident.priorities.chop = 0;
  }
  const voxel = JSON.parse(world.serialize());
  voxel.trees.push(tree);
  const data = JSON.stringify({version:2,voxel:JSON.stringify(voxel),colony:fixture});
  await page.evaluate(({key,value})=>localStorage.setItem(key,value),{key:SAVE,value:data});
  await play.reload();
  const initial = await play.waitFor(s=>s.seed===world.seed && s.colony?.colonists.length, {read:READ,timeoutMs:10000});
  const project = ({camera:{target,eye}}, point) => {
    const forward = unit(target.map((value,i)=>value-eye[i]));
    const right = unit(cross(forward,[0,1,0]));
    const up = cross(right,forward);
    const relative = point.map((value,i)=>value-eye[i]);
    const depth = dot(relative,forward)*Math.tan(Math.PI/8);
    const {width,height}=page.viewportSize();
    return [width/2+dot(relative,right)*height/(2*depth),height/2-dot(relative,up)*height/(2*depth)];
  };
  const aim = async ([x,y,z],expected) => {
    const pixel=project(await read(),[x+.5,y+.01,z+.5]);
    await page.mouse.move(...pixel);
    const aimed = await advance();
    assert.match(aimed.player.demolitionHint ?? '',expected);
    return pixel;
  };
  const hold = async seconds => {
    await page.mouse.down();
    const state=await advance(seconds);
    await page.mouse.up();
    return state;
  };
  const dig = async (cell, hint, resource, amount, seconds, screenshot) => {
    await aim([cell[0],cell[1]+1,cell[2]],hint);
    const before = await read();
    await page.mouse.down();
    if (resource === 'stone') {
      const digging = await advance(.35);
      assert.ok(digging.player.destructionProgress > 0 && digging.player.destructionProgress < 100);
      assert.ok(await meter.isVisible());
      await play.screenshot('stone-destruction-progress');
    }
    const after = await advance(seconds);
    await page.mouse.up();
    assert.ok(after.revision > before.revision, '采集应移除世界里的方块');
    const loose = after.colony.items.filter(item=>item.playerOnly && item.resource===resource);
    assert.ok(loose.some(item=>item.amount===amount && item.x===cell[0] && item.z===cell[2]) || after.player.bag.some(item=>item?.resource===resource && item.count>=amount));
    await play.screenshot(screenshot);
  };

  await possessResident(play,residentId);
  assert.equal((await advance()).camera.mode,'character');
  await page.keyboard.press('Digit4');
  const diagonalPoint = await aim([seedDiagonal[0], seedDiagonal[1] + 1, seedDiagonal[2]], /靠近一格内再播种/);
  await page.mouse.click(...diagonalPoint, { button: 'right' });
  const rejected = await advance();
  assert.equal(rejected.player.bag[3]?.count, 2);
  assert.equal(rejected.colony.crops.length, 0);
  const seedPoint = await aim([seedNear[0], seedNear[1] + 1, seedNear[2]], /右键播种/);
  await page.mouse.click(...seedPoint, { button: 'right' });
  const planted = await advance();
  assert.equal(planted.player.bag[3]?.count, 1);
  assert.ok(planted.colony.crops.some(crop => crop.planted && crop.kind === 'tomato' && crop.x === seedNear[0] && crop.z === seedNear[2]));
  await play.screenshot('right-click-tomato-sown');
  await aim([seedNear[0], seedNear[1] + 1.17, seedNear[2]], /左键破坏番茄/);
  const broken = await hold(.2);
  assert.ok(broken.colony.crops.some(crop => !crop.planted && crop.x === seedNear[0] && crop.z === seedNear[2]));
  assert.ok(broken.colony.items.some(item => item.resource === 'tomatoSeed' && item.amount === 1 && item.x === seedNear[0] && item.z === seedNear[2]));
  assert.ok(!broken.colony.items.some(item => item.resource === 'tomato'));
  assert.equal(broken.revision, planted.revision);
  await play.screenshot('left-click-crop-broken');
  await page.waitForFunction(({ key, x, z }) => {
    const saved = JSON.parse(localStorage.getItem(key) ?? 'null')?.colony;
    return saved?.crops.some(crop => !crop.planted && crop.x === x && crop.z === z);
  }, { key: SAVE, x: seedNear[0], z: seedNear[2] }, { timeout: 10000 });
  const replantPoint = await aim([seedNear[0], seedNear[1] + 1, seedNear[2]], /右键播种/);
  await page.mouse.click(...replantPoint, { button: 'right' });
  assert.ok((await advance()).colony.crops.some(crop => crop.planted && crop.x === seedNear[0] && crop.z === seedNear[2]));

  await page.keyboard.press('Digit9');
  await advance();
  await page.mouse.move(...project(await read(), [123.5, 6.01, 125.5]));
  const distant = await advance();
  assert.equal((await hold(1)).revision, distant.revision, '圆形范围外的地面不应被挖掉');
  await aim([ore[0],ore[1]+1,ore[2]],/铁矿需要石镐/);
  assert.equal((await hold(1)).minerals.steelOre.cells,initial.minerals.steelOre.cells);
  await dig(dirt,/挖掘泥土/,'dirt',1,.73,'player-dug-dirt');
  await page.keyboard.press('Digit3');
  await advance();
  await dig(stone,/挖掘石块/,'stone',8,1.25,'player-mined-stone');
  await dig(ore,/挖掘铁矿/,'pigIron',12,1.65,'player-mined-iron-ore');
  assert.equal((await read()).minerals.steelOre.cells,initial.minerals.steelOre.cells-1);

  const collected = await advance(.8);
  for (const resource of ['dirt','stone','pigIron']) {
    assert.ok(collected.player.bag.some(item=>item?.resource===resource),`快捷栏应拾取${resource}`);
  }
  await play.screenshot('mined-materials-in-hotbar');

  const aimTree = async () => {
    const point = project(await read(), [tree.x + .5, tree.y + .95, tree.z + .5]);
    await page.mouse.move(...point);
    assert.deepEqual((await advance()).hoverCell, [tree.x, tree.y, tree.z]);
    return point;
  };
  await page.keyboard.press('Digit2');
  await aimTree();
  const distantTree = await hold(.85);
  assert.ok(distantTree.trees.some(candidate => candidate.id === tree.id));
  assert.ok(!distantTree.colony.jobs.some(job => job.type === 'chop' && job.targetId === tree.id));
  await play.keyboard.hold('KeyD', state => state.player.x <= 125.05, { read: READ });
  await play.keyboard.hold('KeyW', state => state.player.z >= 125.67, { read: READ });
  await advance(.35);
  await aimTree();
  assert.equal((await read()).player.demolitionHint, '按住左键砍树');
  await page.mouse.down();
  const cutting = await advance(.9);
  const activeJob = cutting.colony.jobs.find(job => job.type === 'chop' && job.targetId === tree.id);
  assert.ok(activeJob?.progress > 0);
  assert.equal(cutting.player.destructionProgress, workPercent(activeJob.progress, activeJob.work));
  assert.ok(await meter.isVisible());
  await play.screenshot('player-tree-destruction-progress');
  await page.mouse.up();
  const released = await advance(.25);
  const savedPercent = released.player.destructionProgress;
  assert.match(released.player.demolitionHint, /^按住左键继续砍树 /);
  assert.equal(await meter.getAttribute('aria-valuenow'), String(savedPercent));
  await play.screenshot('player-tree-progress-after-release');

  await page.keyboard.press('KeyR');
  assert.equal((await advance()).camera.mode, 'god');
  await page.mouse.click(...await aimTree());
  const inspector = page.locator('[data-testid="tree-inspector"]');
  await inspector.waitFor({ state: 'visible' });
  assert.equal(await inspector.locator('.resident-activity').textContent(), `已安排伐木 · ${savedPercent}%`);
  await play.screenshot('god-tree-matching-progress');

  await possessResident(play, residentId);
  await aimTree();
  assert.equal((await read()).player.destructionProgress, savedPercent);
  const chopped = await hold(4.3);
  assert.ok(!chopped.trees.some(candidate => candidate.id === tree.id));
  assert.equal((await advance()).player.destructionProgress, null);
  assert.equal(await meter.isVisible(), false);
  await play.screenshot('player-chopped-tree-within-reach');

  await page.waitForFunction(({key,count,id,treeId})=>{
    const data=JSON.parse(localStorage.getItem(key)??'null');
    const voxel=typeof data?.voxel==='string' ? JSON.parse(data.voxel) : data?.voxel;
    const resident=data?.colony.colonists.find(person=>person.id===id);
    return voxel?.edits?.length>=count && voxel.trees?.some(tree=>tree.id===treeId)===false
      && resident?.bag.some(item=>item?.resource==='pigIron');
  },{key:SAVE,count:(await read()).edits,id:residentId,treeId:tree.id},{timeout:10000});
  await play.reload();
  const restored=await play.waitFor(s=>s.seed===world.seed && s.colony.colonists.find(person=>person.id===residentId)?.bag.some(item=>item?.resource==='pigIron'),{read:READ,timeoutMs:10000});
  assert.equal(restored.minerals.steelOre.cells,initial.minerals.steelOre.cells-1);
  assert.ok(restored.colony.crops.some(crop => crop.planted && crop.kind === 'tomato' && crop.x === seedNear[0] && crop.z === seedNear[2]));
  assert.ok(!restored.trees.some(candidate => candidate.id === tree.id));
  await play.screenshot('mined-ground-and-inventory-restored');
  return {minedCells:3,remainingOre:restored.minerals.steelOre.cells};
}
