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
  // Keep one builder available and keep the player near the chest for the pickup check.
  for (const [index, person] of fixture.colonists.entries()) {
    for (const skill of Object.keys(person.priorities)) person.priorities[skill] = index === 1 && skill === 'construct' ? 1 : 0;
  }
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
  const order = state => state.colony.jobs.find(job => job.type === 'demolish' && job.targetId === chest.id);
  const publish = page.locator('[data-testid="building-demolish"]');
  const cancel = page.locator('[data-testid="building-cancel-demolition"]');
  const activity = page.locator('[data-testid="building-inspector"] .resident-activity');
  await page.locator('#inspector-close').click();
  await page.locator('[data-menu="plan"]').click();
  await page.locator('[data-testid="tool-demolish"]').click();
  await page.locator('#panel-close').click();
  const planning = await advance();
  assert.equal(planning.tool, 'demolish');
  await aim(planning, chest);
  await page.mouse.click(...project(planning,[chest.x+.5,chest.y+.55,chest.z+.5]));
  assert.equal(order(await advance()).state, 'queued');
  await cancel.click();
  assert.equal(order(await advance()), undefined);
  assert.ok(await publish.isVisible());
  await play.screenshot('chest-structure-inspector');
  await page.locator('#inspector-close').click();
  await page.locator('[data-menu="inspect"]').click();

  const character = await possessResident(play,residentId);
  assert.equal(character.camera.mode, 'character');
  await aim(character, chest);
  assert.equal((await advance()).status, '左键查看木箱 · 可管理拆除任务');
  const hint = page.locator('#demolition-hint');
  assert.ok(await hint.isVisible());
  assert.equal(await hint.textContent(), '左键查看木箱 · 可管理拆除任务');
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
  // Holding the old input opens details and leaves the building and its contents intact.
  await page.mouse.down();
  const held = await advance(3);
  await page.mouse.up();
  assert.equal(held.selectedBuildingId, chest.id);
  assert.equal(order(held), undefined);
  assert.ok(held.colony.chests.find(box => box.id === chest.id).slots[0]);
  await publish.click();
  const queued = await advance();
  assert.equal(order(queued).progress, 0);
  assert.equal(queued.colony.speed, 0);
  assert.match(await activity.textContent(), /等待居民拆除/);
  await play.screenshot('chest-demolition-queued');
  await page.waitForFunction(id => {
    const saved = JSON.parse(localStorage.getItem('homestead.colony.v2') ?? 'null')?.colony;
    return saved?.jobs.some(job => job.type === 'demolish' && job.targetId === id);
  }, chest.id, {timeout:10000});
  await play.reload();
  const restored = await play.waitFor(s => s.colony.speed === 0 && !!order(s), {read:READ,timeoutMs:10000});
  assert.equal(order(restored).id, order(queued).id);
  assert.equal(restored.colony.chests.find(box => box.id === chest.id).slots[0].resource, 'hammer');
  await aim(restored, chest);
  await page.mouse.click(...project(restored,[chest.x+.5,chest.y+.55,chest.z+.5]));
  await advance();
  await page.keyboard.press('Digit1');
  let working = await advance(.5);
  for (let i=0; i<40 && !(order(working)?.progress > 0); i++) working=await advance(.5);
  const job=order(working);
  assert.ok(job && job.progress > 0 && job.progress < job.work);
  assert.equal(job.assignedTo, fixture.colonists[1].id);
  assert.ok(working.colony.buildings.some(b => b.id === chest.id));
  assert.match(await activity.textContent(), /负责拆除/);
  await play.screenshot('chest-demolition-resident-working');
  let demolished=working;
  for (let i=0; i<30 && order(demolished); i++) demolished=await advance(.5);
  assert.equal(order(demolished), undefined);
  assert.equal(demolished.colony.buildings.some(building => building.id === chest.id), false);
  assert.equal(demolished.colony.chests.some(box => box.id === chest.id), false);
  assert.deepEqual(demolished.colony.items.filter(item => item.resource === 'hammer').map(item => [item.amount, item.x, item.z]), [[1, chest.x, chest.z]]);
  assert.deepEqual(demolished.colony.items.filter(item => item.resource === 'building:chest').map(item => [item.amount, item.x, item.z]), [[1, chest.x, chest.z]]);
  assert.ok(demolished.colony.events.some(event => event.text.includes(fixture.colonists[1].name+'拆除了木箱')));
  await play.screenshot('chest-contents-spilled');
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

  return { demolished:chest.id, worker:job.assignedTo };
}
