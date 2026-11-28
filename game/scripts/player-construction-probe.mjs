import { returnToMap } from './return-to-map.mjs';
import assert from 'node:assert/strict';
import { possessResident } from './select-resident.mjs';

const READ = 'voxel.world';
const dot = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (vector) => vector.map(value => value / Math.hypot(...vector));

export default async function playerConstruction(play) {
  const read = () => play.state(READ);
  const advance = (seconds = .4) => play.advance(seconds, { read: READ, stepSeconds: .05 });
  const project = (state, position) => {
    const { target, eye } = state.camera;
    const forward = unit(target.map((value, i) => value - eye[i]));
    const right = unit(cross(forward, [0, 1, 0])), up = cross(right, forward);
    const relative = position.map((value, i) => value - eye[i]);
    const depth = dot(relative, forward) * Math.tan(Math.PI / 8);
    const { width, height } = play.page.viewportSize();
    return [(.5 + dot(relative, right) / (2 * depth * width / height)) * width, (.5 - dot(relative, up) / (2 * depth)) * height];
  };
  const initial = await read();
  const builderId=initial.colony.colonists[0].id;
  assert.deepEqual(initial.colony.colonists[0].bag[0], { resource: 'hammer', count: 1 });
  const woodInColony = s => s.colony.resources.wood
    + s.colony.items.filter(item => item.resource === 'wood').reduce((sum, item) => sum + item.amount, 0)
    + s.colony.colonists.reduce((sum,resident)=>sum+(resident.carrying.wood??0)
      +resident.bag.reduce((bag,stack)=>bag+(stack?.resource==='wood'?stack.count:0),0),0);

  await play.page.locator('[data-menu="sandbox"]').click();
  await returnToMap(play);
  await play.page.locator('[data-menu="build"]').click();
  await play.page.locator('[data-testid="build-floor"]').click();
  await play.page.locator('#workspace').waitFor({ state: 'hidden' });
  const planning = await advance();
  assert.equal(planning.tool, 'build:floor');
  assert.equal(planning.colony.speed, 0);
  const originalIds = new Set(planning.colony.buildings.map(building => building.id));
  const [px,py,pz]=planning.colony.colonists.find(person=>person.id===builderId).position;
  const origin = [Math.floor(px),Math.floor(pz)];
  let blueprint;
  for (const [dx, dz] of [[0, 2], [1, 1], [-1, 1], [2, 1], [-2, 1], [1, -1], [-1, -1]]) {
    const x = origin[0] + dx, z = origin[1] + dz;
    const point = project(planning, [x + .5, py + .02, z + .5]);
    await play.page.mouse.move(...point);
    const hovered = await advance(.15);
    if (hovered.hoverCell?.[0] !== x || hovered.hoverCell?.[2] !== z || hovered.hoverBuildingId) continue;
    await play.page.mouse.click(...point);
    const placed = await advance();
    blueprint = placed.colony.buildings.find(building => !originalIds.has(building.id));
    if (blueprint) break;
  }
  assert.ok(blueprint && blueprint.phase === 'readyToBuild', '应通过建造菜单放置处于待施工状态的蓝图');
  assert.equal(blueprint.reserved.wood, 1);
  const target = (s) => s.colony.buildings.find(building => building.id === blueprint.id);
  await returnToMap(play);
  await possessResident(play,builderId);
  const character = await advance();
  assert.equal(character.camera.mode, 'character');
  const hammer = play.page.locator('#hotbar [data-item="hammer"]');
  assert.ok(await hammer.isVisible());
  await play.screenshot('player-hammer-in-hotbar');

  const aim = async () => {
    const current = await read();
    const point = project(current, [blueprint.x + .5, blueprint.y + .35, blueprint.z + .5]);
    await play.page.mouse.move(...point);
    assert.equal((await advance(.25)).hoverBuildingId, blueprint.id, '鼠标应能指向同一蓝图');
    return point;
  };
  await play.page.keyboard.press('Digit2');
  await advance();
  await play.page.mouse.click(...await aim());
  const unequipped = await advance();
  assert.equal(unequipped.player.constructionId, null);
  assert.equal(unequipped.player.bagSelected, 1);
  assert.equal(unequipped.colony.speed, 0, '角色快捷键不能更改殖民地速度');
  const inspectorClose = play.page.locator('#inspector-close');
  if (await inspectorClose.isVisible()) await inspectorClose.click();

  await hammer.click();
  await advance(.2);
  await play.page.mouse.click(...await aim());
  assert.equal((await advance(.2)).player.constructionId, blueprint.id);
  await play.page.keyboard.press('Escape');
  await advance(.2);
  assert.ok(await play.page.locator('#pause-menu').isVisible());
  await play.page.keyboard.press('Escape');
  const working = await advance(.65);
  assert.equal(working.player.constructionId, blueprint.id);
  assert.ok(target(working).progress > 0 && target(working).progress < 1);
  assert.match(await play.page.locator('#construction-progress').textContent(), /建造木地板/);
  await play.screenshot('player-hammer-building');

  const complete = await advance(2);
  assert.equal(target(complete).complete, true);
  assert.equal(complete.player.constructionId, null);
  assert.equal(woodInColony(complete), woodInColony(planning) - 1, '计入居民搬运的木材后，应只扣蓝图预留的 1 个');
  assert.deepEqual(complete.player.bag[0], { resource: 'hammer', count: 1 });
  await play.screenshot('player-hammer-completed');
  await play.page.waitForFunction(id => {
    const stored = JSON.parse(localStorage.getItem('homestead.colony.v2') ?? 'null');
    return stored?.colony.buildings.some(building => building.id === id && building.complete);
  }, blueprint.id, { timeout: 8500 });
  await play.reload();
  const restored = await play.waitFor(s => s.colony?.buildings.some(building => building.id === blueprint.id && building.complete),
    { read: READ, timeoutMs: 10000 });
  assert.deepEqual(restored.colony.colonists.find(person=>person.id===builderId).bag[0], { resource: 'hammer', count: 1 });
  return { blueprintId: blueprint.id, progressAfterFirstStep: target(working).progress };
}
