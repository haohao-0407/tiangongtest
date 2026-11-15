import assert from 'node:assert/strict';
import { tsImport } from 'tsx/esm/api';

const { VoxelWorld, BLOCK } = await tsImport('../assets/voxel/model.ts', import.meta.url);
const { ColonySimulation } = await tsImport('../assets/colony/simulation.ts', import.meta.url);
const READ = 'voxel.world';
const SAVE = 'homestead.colony.v2';
const dot = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = vector => vector.map(value => value / Math.hypot(...vector));

export default async function playerHarvest(play) {
  const { page } = play;
  const read = () => play.state(READ);
  const advance = (seconds=.25) => play.advance(seconds, {read:READ,stepSeconds:.05});
  const world = new VoxelWorld('采集验收');
  const dirt = [123,5,126], stone = [124,5,126], ore = [125,5,126];
  world.edit([dirt,stone,ore].map(([x,y,z],i)=>({x,y,z,block:[BLOCK.Dirt,BLOCK.Stone,BLOCK.SteelOre][i]})));
  const colony = new ColonySimulation(world);
  const data = JSON.stringify({version:2,voxel:world.serialize(),colony:colony.serialize()});
  await page.evaluate(({key,value})=>localStorage.setItem(key,value),{key:SAVE,value:data});
  await play.reload();
  const initial = await play.waitFor(s=>s.seed===world.seed && s.colony?.buildings.length, {read:READ,timeoutMs:10000});
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
    const after = await hold(seconds);
    assert.ok(after.revision > before.revision, '采集应移除世界里的方块');
    const loose = after.colony.items.filter(item=>item.playerOnly && item.resource===resource);
    assert.ok(loose.some(item=>item.amount===amount && item.x===cell[0] && item.z===cell[2]) || after.player.bag.some(item=>item?.resource===resource && item.count>=amount));
    await play.screenshot(screenshot);
  };

  await page.mouse.click(1000,350);
  await page.keyboard.press('KeyR');
  assert.equal((await advance()).camera.mode,'character');
  await page.keyboard.press('Digit9');
  await advance();
  await aim([ore[0],ore[1]+1,ore[2]],/钢矿需要石镐/);
  assert.equal((await hold(1)).minerals.steelOre.cells,initial.minerals.steelOre.cells);
  await dig(dirt,/挖掘泥土/,'dirt',1,.73,'player-dug-dirt');
  await page.keyboard.press('Digit3');
  await advance();
  await dig(stone,/挖掘石块/,'stone',8,1.25,'player-mined-stone');
  await dig(ore,/挖掘钢矿/,'steel',12,1.65,'player-mined-steel-ore');
  assert.equal((await read()).minerals.steelOre.cells,initial.minerals.steelOre.cells-1);

  // One short move brings the player over all three adjacent drops.
  await page.keyboard.down('KeyD');
  await advance(.23);
  await page.keyboard.up('KeyD');
  const collected = await advance(.8);
  for (const resource of ['dirt','stone','steel']) {
    assert.ok(collected.player.bag.some(item=>item?.resource===resource),`快捷栏应拾取${resource}`);
  }
  await play.screenshot('mined-materials-in-hotbar');
  await page.waitForFunction(({key,count})=>{
    const data=JSON.parse(localStorage.getItem(key)??'null');
    const voxel=typeof data?.voxel==='string' ? JSON.parse(data.voxel) : data?.voxel;
    return voxel?.edits?.length>=count && data?.colony.playerBag.some(item=>item?.resource==='steel');
  },{key:SAVE,count:(await read()).edits},{timeout:10000});
  await play.reload();
  const restored=await play.waitFor(s=>s.seed===world.seed && s.colony?.playerBag.some(item=>item?.resource==='steel'),{read:READ,timeoutMs:10000});
  assert.equal(restored.minerals.steelOre.cells,initial.minerals.steelOre.cells-1);
  await play.screenshot('mined-ground-and-inventory-restored');
  return {minedCells:3,remainingOre:restored.minerals.steelOre.cells};
}
