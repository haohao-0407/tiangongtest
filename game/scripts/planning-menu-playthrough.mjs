import assert from 'node:assert/strict';
import { tsImport } from 'tsx/esm/api';

const { VoxelWorld } = await tsImport('../assets/voxel/model.ts', import.meta.url);
const { ColonySimulation } = await tsImport('../assets/colony/simulation.ts', import.meta.url);

export default async function planningMenu(play) {
  const read = 'voxel.world';
  const { page } = play;
  const workspace = page.locator('#workspace');
  const control = id => page.locator(`[data-testid="${id}"]`);
  const wait = predicate => play.waitFor(predicate, { read });
  const capture = async name => assert.ok((await play.screenshot(name)).rendered);
  const open = async () => {
    await control('menu-plan').click();
    await workspace.waitFor({ state: 'visible' });
    await wait(s => s.planningGridVisible);
  };
  const start = async (id, tool) => {
    await control(id).click();
    await workspace.waitFor({ state: 'hidden' });
    await wait(s => s.tool === tool && s.planningGridVisible);
  };
  const returned = async () => {
    await workspace.waitFor({ state: 'visible' });
    assert.equal(await workspace.getAttribute('data-panel'), 'plan');
    await wait(s => s.tool === 'inspect' && s.planningGridVisible);
  };

  // A compact save makes the actual ground and overlays visible under the same camera.
  const world = new VoxelWorld('planning-menu', { width: 48, height: 24, depth: 48 });
  const colony = new ColonySimulation(world);
  colony.command({ action: 'speed', value: 0 });
  const fixture = JSON.stringify({ version: 2, voxel: world.serialize(), colony: colony.serialize() });
  await wait(s => s.colony?.colonists.length > 0);
  await page.evaluate(data => localStorage.setItem('homestead.colony.v2', data), fixture);
  await play.reload();
  const initial = await wait(s => s.seed === 'planning-menu' && s.colony.speed === 0);
  assert.ok(initial.colony.zones.some(z => z.kind === 'stockpile'));
  assert.equal(initial.planningGridVisible, false);
  await capture('normal-view-no-planning-grid');

  await open();
  await capture('plan-panel-shows-planning-grid');
  await control('terrain-size').fill('1');
  await control('terrain-size').press('Tab');
  await wait(s => s.terrain.size === 1);
  await start('tool-level', 'level');
  await play.mouse.move([.51, .48]);
  const aimed = await wait(s => s.hoverCell && s.terrain.preview.cells === 1);
  await capture('planning-on-map-without-panel');
  await page.mouse.down();
  await play.advance(.1, { read });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await returned();
  assert.deepEqual((await play.state(read)).colony.terrainPlans, aimed.colony.terrainPlans);
  await capture('escape-returns-without-submitting');

  await start('tool-zone-stockpile', 'zone:stockpile');
  await play.mouse.click([.51, .48], { button: 'right' });
  await returned();
  assert.equal((await play.state(read)).colony.zones.length, initial.colony.zones.length);
  await capture('right-click-returns-to-plan-panel');

  await start('terrain-sample', 'level');
  await play.mouse.click([.51, .48]);
  await wait(s => !s.terrain.sample && s.status.startsWith('已取样'));
  await returned();
  const height = (await play.state(read)).terrain.target;
  await control('terrain-target').fill(String(height + 1));
  await control('terrain-target').press('Tab');
  await wait(s => s.terrain.target === height + 1);
  await start('tool-level', 'level');
  await play.mouse.drag([.51, .48], [.56, .52], { button: 'left' });
  const submitted = await wait(s => s.colony.terrainPlans.length > initial.colony.terrainPlans.length);
  assert.equal(submitted.colony.terrainPlans.at(-1).target, height + 1);
  assert.ok(submitted.colony.terrainPlans.at(-1).cells.length > 1);
  await returned();
  await capture('drag-submit-restores-plan-panel');

  await control('menu-warehouse').click();
  await wait(s => !s.planningGridVisible);
  assert.equal(await workspace.getAttribute('data-panel'), 'warehouse');
  await page.locator('#panel-close').click();
  const outside = await wait(s => !s.planningGridVisible);
  assert.deepEqual(outside.colony.terrainPlans, submitted.colony.terrainPlans);
  await capture('stored-plans-hidden-outside-planning');

  await play.reload();
  await wait(s => s.seed === 'planning-menu' && !s.planningGridVisible);
  await open();
  await page.locator('#panel-close').click();
  await wait(s => !s.planningGridVisible);
}
