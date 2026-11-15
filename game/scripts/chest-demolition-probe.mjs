import assert from 'node:assert/strict';

const READ = 'voxel.world';
const dot = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = vector => vector.map(value => value / Math.hypot(...vector));

export default async function chestDemolition(play) {
  const { page } = play;
  const advance = (seconds = .4) => play.advance(seconds, { read: READ, stepSeconds: .05 });
  const aim = async (state, building) => {
    const { target, eye } = state.camera;
    const forward = unit(target.map((value, i) => value - eye[i]));
    const right = unit(cross(forward, [0, 1, 0]));
    const up = cross(right, forward);
    const relative = [building.x + .5, building.y + .55, building.z + .5].map((value, i) => value - eye[i]);
    const depth = dot(relative, forward) * Math.tan(Math.PI / 8);
    const { width, height } = page.viewportSize();
    await page.mouse.move(width / 2 + dot(relative, right) * height / (2 * depth), height / 2 - dot(relative, up) * height / (2 * depth));
    assert.equal((await advance()).hoverBuildingId, building.id, '鼠标指向箱盖时应命中整座木箱');
  };

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

  await page.mouse.click(1000, 350);
  await page.keyboard.press('KeyR');
  const character = await advance();
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
  assert.ok(progressing.colony.buildings.some(building => building.id === chest.id));
  assert.ok(await hint.isVisible());
  assert.match(await hint.textContent(), /拆除木箱 [1-9]\d*%/);
  await play.screenshot('chest-demolition-progress');
  const demolished = await advance(3);
  await page.mouse.up();
  assert.equal(demolished.colony.buildings.some(building => building.id === chest.id), false);
  assert.equal(demolished.colony.chests.some(box => box.id === chest.id), false);
  assert.deepEqual(demolished.colony.items.filter(item => item.resource === 'hammer').map(item => [item.amount, item.x, item.z]), [[1, chest.x, chest.z]]);
  assert.match(await page.locator('#inventory-notice').textContent(), /木箱已拆.*1 件物品/);
  await play.screenshot('chest-contents-spilled');

  await page.waitForFunction((id) => {
    const saved = JSON.parse(localStorage.getItem('homestead.colony.v2') ?? 'null')?.colony;
    return saved && !saved.buildings.some(building => building.id === id) && saved.items.some(item => item.resource === 'hammer');
  }, chest.id, { timeout: 8500 });
  await play.reload();
  const restored = await play.waitFor(state => state.colony.speed === 0 && state.colony.items.some(item => item.resource === 'hammer'), { read: READ, timeoutMs: 10000 });
  assert.equal(restored.colony.buildings.some(building => building.id === chest.id), false);
  await play.screenshot('chest-demolition-restored');
  return { demolished: chest.id };
}
