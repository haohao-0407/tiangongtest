import assert from 'node:assert/strict';
import { tsImport } from 'tsx/esm/api';
import { possessResident } from './select-resident.mjs';

const READ = 'voxel.world';
const dot = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = vector => vector.map(value => value / Math.hypot(...vector));

export default async function chestDemolition(play) {
  const { page } = play;
  const read = () => play.state(READ);
  const advance = (seconds = .4) => play.advance(seconds, { read: READ, stepSeconds: .05 });
  const project = (state, point) => {
    const { target, eye } = state.camera;
    const forward = unit(target.map((value, i) => value - eye[i]));
    const right = unit(cross(forward, [0, 1, 0]));
    const up = cross(right, forward);
    const relative = point.map((value, i) => value - eye[i]);
    const depth = dot(relative, forward) * Math.tan(Math.PI / 8);
    const { width, height } = page.viewportSize();
    return [width / 2 + dot(relative, right) * height / (2 * depth), height / 2 - dot(relative, up) * height / (2 * depth)];
  };
  const aim = async (state, building) => {
    await page.mouse.move(...project(state,[building.x+.5,building.y+.55,building.z+.5]));
    assert.equal((await advance()).hoverBuildingId, building.id, '鼠标指向箱盖时应命中整座木箱');
  };

  const { VoxelWorld }=await tsImport('../assets/voxel/model.ts',import.meta.url);
  const { ColonySimulation }=await tsImport('../assets/colony/simulation.ts',import.meta.url);
  const world=new VoxelWorld((await read()).seed);
  const fixture=new ColonySimulation(world).serialize();
  const residentId=fixture.colonists[0].id;
  fixture.colonists[0].position=[125.5,6,125.5];
  fixture.speed=0;
  await page.evaluate(data=>localStorage.setItem('homestead.colony.v2',data),JSON.stringify({version:2,voxel:world.serialize(),colony:fixture}));
  await play.reload();
  await play.waitFor(s=>s.colony.speed===0&&s.colony.colonists[0].position[0]===125.5,{read:READ,timeoutMs:10000});

  await page.locator('[data-menu="sandbox"]').click();
  await page.locator('[data-menu="inspect"]').click();
  const god = await advance();
  assert.equal(god.colony.speed, 0);
  const chest = god.colony.buildings.find(building => building.kind === 'chest');
  assert.ok(chest);
  await aim(god, chest);
  await page.mouse.down();
  await page.mouse.up();
  assert.equal((await advance()).selectedBuildingId, chest.id);
  assert.ok(await page.locator('[data-testid="building-demolish"]').isVisible());
  await play.screenshot('chest-structure-inspector');
  await page.locator('#inspector-close').click();

  const character = await possessResident(play,residentId);
  assert.equal(character.camera.mode, 'character');
  await aim(character, chest);
  assert.equal((await advance()).status, '按住左键拆除木箱');
  const hint = page.locator('#demolition-hint');
  assert.ok(await hint.isVisible());
  assert.equal(await hint.textContent(), '按住左键拆除木箱');
  await play.screenshot('chest-highlight');
  await page.mouse.down({ button: 'right' });
  await page.mouse.up({ button: 'right' });
  await advance();
  const slot = page.locator('.chest-cell[data-index="0"]');
  const hammer = await page.locator('#hotbar [data-item="hammer"]').boundingBox();
  const boxSlot = await slot.boundingBox();
  assert.ok(hammer && boxSlot, '右键应打开木箱，快捷栏能拖入锤子');
  await page.mouse.move(hammer.x + hammer.width / 2, hammer.y + hammer.height / 2);
  await page.mouse.down();
  await page.mouse.move(boxSlot.x + boxSlot.width / 2, boxSlot.y + boxSlot.height / 2, { steps: 12 });
  await page.mouse.up();
  await advance();
  assert.equal(await slot.getAttribute('data-item'), 'hammer');
  await play.screenshot('chest-stored-hammer');
  await page.locator('#panel-close').click();
  await aim(await advance(), chest);
  await page.mouse.down();
  const progressing = await advance(.9);
  assert.match(progressing.status, /拆除木箱 [1-9]\d*%/);
  assert.ok(progressing.player.destructionProgress > 0 && progressing.player.destructionProgress < 100);
  assert.ok(progressing.colony.buildings.some(building => building.id === chest.id));
  assert.ok(await hint.isVisible());
  assert.ok(await page.locator('#destruction-progress').isVisible());
  assert.match(await hint.textContent(), /拆除木箱 [1-9]\d*%/);
  await play.screenshot('chest-demolition-progress');
  const demolished = await advance(3);
  await page.mouse.up();
  assert.equal(demolished.colony.buildings.some(building => building.id === chest.id), false);
  assert.equal(demolished.colony.chests.some(box => box.id === chest.id), false);
  assert.deepEqual(demolished.colony.items.filter(item => item.resource === 'hammer').map(item => [item.amount, item.x, item.z]), [[1, chest.x, chest.z]]);
  assert.deepEqual(demolished.colony.items.filter(item => item.resource === 'building:chest').map(item => [item.amount, item.x, item.z]), [[1, chest.x, chest.z]]);
  assert.match(await page.locator('#inventory-notice').textContent(), /木箱已拆.*箱体和 1 件物品/);
  await play.screenshot('chest-contents-spilled');

  await page.waitForFunction((id) => {
    const saved = JSON.parse(localStorage.getItem('homestead.colony.v2') ?? 'null')?.colony;
    return saved && !saved.buildings.some(building => building.id === id) && saved.items.some(item => item.resource === 'hammer');
  }, chest.id, { timeout: 8500 });
  await play.reload();
  const restored = await play.waitFor(state => state.colony.speed === 0 && state.colony.items.some(item => item.resource === 'hammer'), { read: READ, timeoutMs: 10000 });
  assert.equal(restored.colony.buildings.some(building => building.id === chest.id), false);
  assert.equal(restored.colony.items.filter(item => item.resource === 'building:chest').length, 1);
  await play.screenshot('chest-demolition-restored');
  if (await page.locator('#inspector-close').isVisible()) await page.locator('#inspector-close').click();
  await page.keyboard.press('Escape');
  await advance(.2);
  assert.ok(await page.locator('#pause-menu').isVisible());
  await page.keyboard.press('Escape');
  assert.equal((await advance(.6)).colony.speed,1);
  await possessResident(play,residentId);
  const collected = await advance(.9);
  const carried = collected.player.bag.findIndex(item => item?.resource === 'building:chest');
  assert.ok(carried >= 0, '拆下的箱体应能捡进快捷栏');
  await page.keyboard.press(`Digit${carried + 1}`);
  await advance();
  await play.screenshot('chest-item-in-hotbar');

  await page.mouse.click(...project(await read(),[chest.x+.5,chest.y+.005,chest.z+.5]));
  const placed = await advance(.6);
  assert.equal(placed.player.bag[carried], null);
  assert.ok(placed.colony.buildings.some(building => building.kind === 'chest' && building.complete && building.x === chest.x && building.z === chest.z));
  assert.ok(placed.colony.chests[0].slots.every(slot => slot === null));
  await play.screenshot('chest-placed-again-empty');

  const bed = placed.colony.buildings.find(building => building.kind === 'bed');
  await aim(placed,bed);
  await page.mouse.down();
  assert.ok((await advance(.9)).colony.buildings.some(building => building.id === bed.id));
  await page.mouse.up();
  assert.equal((await advance(.1)).player.demolitionHint, null);
  await play.screenshot('bed-outside-work-reach');

  await play.keyboard.hold('KeyS', state => state.player.z <= bed.z - .3, { read: READ });
  await play.keyboard.hold('KeyA', state => state.player.x >= bed.x + .1, { read: READ });
  await play.keyboard.hold('KeyW', state => state.player.z >= bed.z - .33, { read: READ });
  await aim(await advance(.65), bed);
  assert.equal((await read()).player.demolitionHint, '按住左键拆除木床');
  await page.mouse.down();
  const bedRemoved=await advance(7.5);
  await page.mouse.up();
  assert.equal(bedRemoved.colony.buildings.some(building=>building.id===bed.id),false);
  assert.ok(bedRemoved.colony.items.some(item=>item.resource==='building:bed')
    || bedRemoved.player.bag.some(item=>item?.resource==='building:bed'));
  const carriedBed=await advance(.65);
  assert.ok(carriedBed.player.bag.some(item=>item?.resource==='building:bed'));
  await play.screenshot('bed-item-in-hotbar');
  return { demolished: [chest.id,bed.id] };
}
