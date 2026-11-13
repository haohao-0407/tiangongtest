// Sandbox regression through the official owner browser and ordinary player input.
// Run: pnpm exec forgeax project play scripts/sandbox-playthrough.mjs --require-ui --json
import assert from 'node:assert/strict';

const READ = 'voxel.world';
const SAVE_KEY = 'homestead.colony.v2';
const PALETTE = [
  { block: 5, name: 'wood-planks' }, { block: 3, name: 'stone' },
  { block: 4, name: 'timber' }, { block: 6, name: 'brick' },
  { block: 1, name: 'grass' }, { block: 2, name: 'soil' },
];
const cellOf = edit => [edit.x, edit.y, edit.z];
const distance = (a, b) => Math.hypot(...a.map((value, index) => value - b[index]));

/** @param {import('@forgeax/engine/devkit').PlayContext} play */
export default async function sandboxPlaythrough(play) {
  const read = () => play.state(READ);
  const wait = predicate => play.waitFor(predicate, { read: READ, timeoutMs: 10_000 });
  const control = id => play.page.locator(`[data-testid="${id}"]`);
  const capture = async name => {
    const screenshot = await play.screenshot(name);
    assert.equal(screenshot.rendered, true, `${name}: Engine pixels must be non-flat`);
  };
  const closePanel = async () => {
    const close = play.page.locator('#panel-close');
    if (await close.isVisible()) await close.click();
    await play.mouse.move([0.5, 0.46]);
  };
  const sandbox = async (keepOpen = false) => {
    if (!(await control('sandbox-build').isVisible())) await control('menu-sandbox').click();
    await control('sandbox-build').click();
    await wait(s => s.tool === 'sandbox:build' && s.colony.speed === 0);
    if (!keepOpen) await closePanel();
  };
  const settings = async open => {
    const visible = await play.page.locator('#settings').isVisible();
    if (visible !== open) await play.page.locator('#settings-toggle').click();
    assert.equal(await play.page.locator('#settings').isVisible(), open);
  };
  const findBuildSpot = async (used = new Set()) => {
    const candidates = [];
    for (const y of [0.46, 0.42, 0.50, 0.38, 0.54, 0.34, 0.58, 0.30, 0.62]) {
      for (const x of [0.50, 0.54, 0.46, 0.58, 0.42, 0.62, 0.38, 0.66, 0.34]) candidates.push([x, y]);
    }
    for (const point of candidates) {
      play.signal.throwIfAborted();
      await play.mouse.move(point);
      await play.keyboard.press('KeyB');
      const state = await read(), cell = state.hoverCell;
      if (!Array.isArray(cell) || cell[1] !== 6 || cell[0] < 21 || cell[0] > 33 || cell[2] < 21 || cell[2] > 33 || used.has(cell.join(','))) continue;
      const building = state.colony.buildings.some(b => b.x === cell[0] && b.z === cell[2]);
      const pawn = state.colony.colonists.some(p => Math.abs(p.position[0] - cell[0] - 0.5) < 0.7 && Math.abs(p.position[2] - cell[2] - 0.5) < 0.7);
      if (!building && !pawn) return { point, cell: [...cell], state };
    }
    throw new Error('No visible unoccupied meadow cell was found through the player hover result.');
  };

  const initial = await play.step('terrain-and-sandbox-entry', async () => {
    await wait(s => s.colony?.colonists.length === 3 && s.nonAirCount > 1000 && s.chunks > 0);
    await sandbox(true);
    const state = await read();
    assert.deepEqual(state.dimensions, [48, 24, 48]);
    assert.equal(state.edits, 0, 'The isolated acceptance world starts without terrain edits.');
    assert.ok(state.nonAirCount < 48 * 24 * 48);
    assert.ok(state.chunks <= 32);
    assert.equal(await play.page.locator('[data-block]').count(), 6);
    assert.equal(state.colony.speed, 0, 'Sandbox entry pauses autonomous simulation.');
    await capture('sandbox-01-procedural-terrain-and-materials');
    await closePanel();
    return state;
  });

  const first = await play.step('preview-and-left-click-build', async () => {
    await play.mouse.move([0.5, 0.46]);
    await play.keyboard.press('Digit1');
    await wait(s => s.selected === 5 && s.tool === 'sandbox:build');
    const target = await findBuildSpot();
    await capture('sandbox-02-translucent-preview');
    await play.mouse.click(target.point);
    const built = await wait(s => s.edits === 1 && s.lastEdit?.action === 'build');
    assert.equal(built.lastEdit.block, 5);
    assert.deepEqual(cellOf(built.lastEdit), target.cell);
    assert.equal(built.nonAirCount, initial.nonAirCount + 1);
    assert.equal(built.undo, true);
    await capture('sandbox-03-left-click-placed-block');
    return { ...target, built };
  });

  await play.step('right-click-removal-undo-and-redo', async () => {
    await play.mouse.click(first.point, { button: 'right' });
    const removed = await wait(s => s.lastEdit?.action === 'remove' && s.edits === 0);
    assert.deepEqual(cellOf(removed.lastEdit), cellOf(first.built.lastEdit));
    assert.equal(removed.nonAirCount, initial.nonAirCount);
    await capture('sandbox-04-right-click-removal');
    await play.keyboard.press('Control+KeyZ');
    const undone = await wait(s => s.edits === 1 && s.redo);
    assert.equal(undone.nonAirCount, first.built.nonAirCount);
    await capture('sandbox-05-undo');
    await play.keyboard.press('Control+KeyY');
    const redone = await wait(s => s.edits === 0 && !s.redo);
    assert.equal(redone.nonAirCount, initial.nonAirCount);
    await capture('sandbox-06-redo');
  });

  const materials = [], occupied = new Set();
  for (const [index, material] of PALETTE.entries()) {
    const result = await play.step(`material-${material.name}`, async () => {
      if (index % 2 === 0) {
        await sandbox(true);
        await control(`block-${material.block}`).click();
        await closePanel();
      } else {
        await play.mouse.move([0.5, 0.46]);
        await play.keyboard.press(`Digit${index + 1}`);
      }
      await wait(s => s.selected === material.block && s.tool === 'sandbox:build');
      const target = await findBuildSpot(occupied), before = target.state;
      await play.mouse.click(target.point);
      const after = await wait(s => s.revision > before.revision && s.lastEdit?.action === 'build');
      assert.equal(after.lastEdit.block, material.block);
      assert.deepEqual(cellOf(after.lastEdit), target.cell);
      assert.equal(after.nonAirCount, before.nonAirCount + 1);
      occupied.add(target.cell.join(','));
      await capture(`sandbox-07-material-${index + 1}-${material.name}`);
      return { block: material.block, cell: target.cell };
    });
    materials.push(result);
  }

  await play.step('camera-pan-rotate-zoom-and-home', async () => {
    await play.mouse.move([0.5, 0.46]);
    const initialCamera = await read();
    await play.keyboard.hold('KeyW', s => distance(s.camera.target, initialCamera.camera.target) > 1, { read: READ });
    const moved = await read();
    assert.ok(distance(moved.camera.target, initialCamera.camera.target) > 1);
    await play.keyboard.hold('KeyE', s => Math.abs(s.camera.yaw - moved.camera.yaw) > 0.12, { read: READ });
    const rotated = await read();
    await capture('sandbox-08-camera-pan-and-rotation');
    await play.page.mouse.wheel(0, -180);
    await wait(s => s.camera.distance < rotated.camera.distance - 0.5);
    await capture('sandbox-09-camera-zoom');
    await play.keyboard.press('KeyF');
    const reset = await wait(s => Math.abs(s.camera.distance - 47) < 0.01);
    assert.deepEqual(reset.camera.target, [27, 5, 27]);
    assert.ok(Math.abs(reset.camera.yaw - Math.PI / 4) < 0.001);
  });

  const regenerated = await play.step('confirmed-seed-regeneration', async () => {
    const nextSeed = '森屿-沙盒验收-2036', before = await read();
    await settings(true);
    await play.page.locator('#seed').fill(nextSeed);
    await play.page.locator('#generate').click();
    assert.match(await play.page.locator('#generate-hint').innerText(), /再点一次|再次点击/);
    assert.equal((await read()).seed, before.seed, 'First click only requests confirmation.');
    await play.page.locator('#generate').click();
    await wait(s => s.seed === nextSeed && s.edits === 0);
    await settings(false);
    await sandbox();
    const state = await read();
    assert.notEqual(state.seed, before.seed);
    assert.ok(state.nonAirCount > 1000 && state.chunks > 0);
    assert.equal(state.undo, false);
    assert.equal(state.redo, false);
    await capture('sandbox-10-regenerated-world');
    return state;
  });

  const saved = await play.step('v2-autosave-and-reload', async () => {
    await play.mouse.move([0.5, 0.46]);
    await play.keyboard.press('Digit1');
    const target = await findBuildSpot();
    await play.mouse.click(target.point);
    const beforeReload = await wait(s => s.seed === regenerated.seed && s.edits === 1 && s.lastEdit?.block === 5);
    const index = target.cell[0] + 48 * (target.cell[2] + 48 * target.cell[1]);
    await play.page.waitForFunction(({ key, seed, index }) => {
      try {
        const value = JSON.parse(localStorage.getItem(key) ?? 'null');
        if (value?.version !== 2 || typeof value.voxel !== 'string') return false;
        const voxel = JSON.parse(value.voxel);
        return voxel.seed === seed && voxel.edits?.length === 1 && voxel.edits.some(([cell, block]) => cell === index && block === 5);
      } catch { return false; }
    }, { key: SAVE_KEY, seed: beforeReload.seed, index }, { timeout: 12_000 });
    const snapshot = await play.page.evaluate(key => localStorage.getItem(key), SAVE_KEY);
    assert.ok(snapshot);
    await capture('sandbox-11-autosaved-v2-world');
    await play.reload();
    const restored = await wait(s => s.seed === beforeReload.seed && s.edits === beforeReload.edits);
    assert.equal(restored.nonAirCount, beforeReload.nonAirCount);
    assert.equal(restored.colony.speed, 0);
    const afterSnapshot = await play.page.evaluate(key => localStorage.getItem(key), SAVE_KEY);
    assert.deepEqual(JSON.parse(JSON.parse(afterSnapshot).voxel), JSON.parse(JSON.parse(snapshot).voxel));
    await sandbox();
    const entered = await read();
    assert.equal(entered.undo, false, 'Restored terrain starts a fresh sandbox history.');
    assert.equal(entered.redo, false);
    await capture('sandbox-12-restored-world-and-block');
    return { seed: restored.seed, edits: restored.edits, blockCount: restored.nonAirCount };
  });

  return { requirements: ['procedural-terrain', 'sandbox-pauses-colony', 'build-preview', 'left-build', 'right-remove', 'undo-redo', 'six-materials', 'camera-pan-orbit-zoom', 'seed-regeneration', 'v2-autosave-reload'], materials: materials.map(m => m.block), saved };
}
