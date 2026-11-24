// Official owner-browser acceptance. Construction supplies are loaded with the test save.
// pnpm exec forgeax project play scripts/terrain-playthrough.mjs --require-ui --json
// Keep the default 1280x720,1280x600 viewports: the final gate checks both layouts.
import assert from 'node:assert/strict';
import { stockConstructionFixture } from './construction-supplies.mjs';

const READ = 'voxel.world';
const clone = (value) => JSON.parse(JSON.stringify(value));
const planBy = (state, id) => state.colony.terrainPlans.find((plan) => plan.id === id);
const buildingBy = (state, id) => state.colony.buildings.find((building) => building.id === id);
const key = (x, z) => `${x},${z}`;
const dot = (a, b) => a.reduce((sum, n, i) => sum + n * b[i], 0);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => a.map((n) => n / Math.hypot(...a));

/** @param {import('@forgeax/engine/devkit').PlayContext} play */
export default async function terrainPlaythrough(play) {
  const read = () => play.state(READ);
  const wait = (predicate) => play.waitFor(predicate, { read: READ, timeoutMs: 10_000 });
  const control = (id) => play.page.locator(`[data-testid="${id}"]`);
  const click = (id) => control(id).click();
  const advance = (seconds) => play.advance(seconds, { read: READ, stepSeconds: 0.05 });
  const used = new Set();
  const capture = async (name) => {
    assert.equal((await play.screenshot(name)).rendered, true, `${name}: native game pixels must be visible`);
  };
  const closePanel = async () => {
    const button = play.page.locator('#panel-close');
    if (await button.isVisible()) await button.click();
  };
  const clearMapUi = async () => {
    await closePanel();
    for (const id of ['inspector-close', 'help-close', 'settings-close']) {
      const button = play.page.locator(`#${id}`);
      if (await button.isVisible()) await button.click();
    }
  };
  const openPanel = async (menu, probe) => {
    if (!(await control(probe).isVisible())) await click(`menu-${menu}`);
    assert.ok(await control(probe).isVisible(), `${menu}: expected player control ${probe}`);
  };
  const speed = async (value) => {
    await click(`speed-${value}`);
    return wait((state) => state.colony.speed === value);
  };
  const advanceUntil = async (predicate, { seconds = 60, chunk = 0.5, onSample } = {}) => {
    let state = await read();
    if (onSample) await onSample(state);
    for (let elapsed = 0; elapsed < seconds && !predicate(state); elapsed += chunk) {
      play.signal.throwIfAborted();
      state = await advance(Math.min(chunk, seconds - elapsed));
      if (onSample) await onSample(state);
    }
    assert.ok(predicate(state), `Simulation did not reach the requested state: ${JSON.stringify({ status: state.status,
      plans: state.colony.terrainPlans, buildings: state.colony.buildings.filter((b) => !b.complete),
      jobs: state.colony.jobs, residents: state.colony.colonists.map((p) => ({ name: p.name, task: p.task, position: p.position })) })}`);
    return state;
  };
  const setPriority = async (id, job, target) => {
    const testId = `priority-${id}-${job}`;
    await openPanel('work', testId);
    for (let attempt = 0; attempt < 5; attempt++) {
      const current = (await read()).colony.colonists.find((p) => p.id === id).priorities[job];
      if (current === target) return;
      await click(testId);
      await wait((s) => s.colony.colonists.find((p) => p.id === id).priorities[job] !== current);
    }
    assert.equal((await read()).colony.colonists.find((p) => p.id === id).priorities[job], target);
  };
  const number = async (id, value) => {
    await control(id).fill(String(value));
    await control(id).press('Tab');
  };
  const terrainSettings = async (target, shape = 'brush', size = 1) => {
    await openPanel('plan', 'tool-level');
    await control('terrain-shape').selectOption('brush');
    await wait((s) => s.terrain.shape === 'brush');
    await number('terrain-size', size);
    await number('terrain-target', target);
    await control('terrain-shape').selectOption(shape);
    await control('terrain-shape').press('Tab');
    await click('tool-level');
    await wait((s) => s.tool === 'level' && s.terrain.target === target && s.terrain.size === size && s.terrain.shape === shape);
    await play.page.locator('#workspace').waitFor({ state: 'hidden' });
  };
  const hoverAt = async (point) => {
    await play.mouse.move(point);
    return advance(0.05);
  };
  // Compute an input location from the public camera projection, then validate it
  // with normal hover. This is the same pi/4 perspective used by the player camera.
  // No voxel internals, injected commands, or test-only world targets are accessed.
  const project = async (state, position) => {
    const camera = state.camera, forward = unit(camera.target.map((n, i) => n - camera.eye[i]));
    const right = unit(cross(forward, [0, 1, 0])), up = cross(right, forward);
    const relative = position.map((n, i) => n - camera.eye[i]), depth = dot(relative, forward);
    const viewport = play.page.viewportSize() ?? { width: 1280, height: 720 };
    const halfHeight = Math.tan(Math.PI / 8) * depth;
    return [0.5 + dot(relative, right) / (2 * halfHeight * viewport.width / viewport.height),
      0.5 - dot(relative, up) / (2 * halfHeight)];
  };
  const hoverCell = async (x, z, height, required = true) => {
    const state = await read();
    // A pit's near rim can hide its center. Sample actual points across the
    // same cell's top face and accept only the public raycast's matching x/z.
    const samples = [[0.5, 0.5], [0.15, 0.15], [0.15, 0.5], [0.5, 0.15],
      [0.85, 0.15], [0.15, 0.85], [0.85, 0.5], [0.5, 0.85], [0.85, 0.85]];
    let visibleSamples = 0;
    for (const [u, v] of samples) {
      const point = await project(state, [x + u, height + 0.02, z + v]);
      // Keep inputs in the visible central map, clear of the HUD and tool palette.
      if (point[0] < 0.2 || point[0] > 0.73 || point[1] < 0.2 || point[1] > 0.78) continue;
      visibleSamples++;
      for (const [dx, dy] of [[0, 0], [-0.004, 0], [0.004, 0], [0, -0.004], [0, 0.004]]) {
        const input = [point[0] + dx, point[1] + dy], hovered = await hoverAt(input);
        if (hovered.hoverCell?.[0] === x && hovered.hoverCell?.[2] === z) return { point: input, cell: [...hovered.hoverCell], state: hovered };
      }
    }
    if (required) assert.fail(`Real hover did not resolve ${x},${z} at height ${height} from ${visibleSamples} visible face samples: ${JSON.stringify((await read()).hoverCell)}`);
    return null;
  };
  const footprintCells = (x, z, w, d) => Array.from({ length: w * d }, (_, i) => [x + i % w, z + Math.floor(i / w)]);
  const markUsed = (plot) => { for (const [x, z] of plot.cells) used.add(key(x, z)); };
  const free = (state, x, z, w, d) => {
    const cells = footprintCells(x, z, w, d), endX = x + w - 1, endZ = z + d - 1;
    if (x < 1 || z < 1 || endX >= state.worldSize[0] - 1 || endZ >= state.worldSize[2] - 1) return false;
    if (cells.some(([xx, zz]) => used.has(key(xx, zz)))) return false;
    if (state.colony.buildings.some((b) => x < b.x + b.w && endX >= b.x && z < b.z + b.d && endZ >= b.z)) return false;
    if (state.colony.zones.some((zone) => x < zone.x + zone.w && endX >= zone.x && z < zone.z + zone.d && endZ >= zone.z)) return false;
    if (state.colony.terrainPlans.some((plan) => plan.state !== 'completed' && plan.cells.some(([xx, zz]) => xx >= x && xx <= endX && zz >= z && zz <= endZ))) return false;
    return !state.colony.colonists.some((p) => p.position[0] >= x - 0.5 && p.position[0] <= endX + 1.5 && p.position[2] >= z - 0.5 && p.position[2] <= endZ + 1.5);
  };
  const findPlot = async (w = 1, d = 1) => {
    await clearMapUi();
    await play.mouse.move([0.5, 0.44]);
    await play.keyboard.press('KeyF');
    const initial = await advance(0.1), home = initial.colony.colonists[0].position;
    const seen = new Set();
    for (const y of [0.46, 0.42, 0.50, 0.38, 0.54, 0.34, 0.58, 0.30, 0.62]) {
      for (const x of [0.50, 0.46, 0.54, 0.42, 0.58, 0.38, 0.62, 0.34, 0.66]) {
        play.signal.throwIfAborted();
        const state = await hoverAt([x, y]), cell = state.hoverCell;
        if (!cell || seen.has(key(cell[0], cell[2]))) continue;
        seen.add(key(cell[0], cell[2]));
        if (cell[1] <= state.terrain.minHeight || cell[1] >= state.terrain.maxHeight) continue;
        if (Math.hypot(cell[0] - home[0], cell[2] - home[2]) > 13 || !free(state, cell[0], cell[2], w, d)) continue;
        const cells = footprintCells(cell[0], cell[2], w, d);
        let valid = true;
        for (const [xx, zz] of cells) {
          const hover = await hoverCell(xx, zz, cell[1], false);
          if (!hover || hover.cell[1] !== cell[1]) { valid = false; break; }
        }
        if (valid) return { x: cell[0], z: cell[2], height: cell[1], w, d, cells };
      }
    }
    assert.fail(`No visible, flat, unoccupied ${w}x${d} plot near the current camp was found through real hover.`);
  };
  const checkHeights = async (plot, height) => {
    await clearMapUi();
    for (const [x, z] of plot.cells) {
      const hover = await hoverCell(x, z, height);
      assert.equal(hover.cell[1], height, `${x},${z}: actual ground height must be ${height}`);
    }
  };
  const newTerrainPlan = async (plot, target, { shape = 'brush', size = 1, from = [plot.x, plot.z], to } = {}) => {
    await terrainSettings(target, shape, size);
    const priorIds = new Set((await read()).colony.terrainPlans.map((p) => p.id));
    const first = await hoverCell(from[0], from[1], plot.height);
    const end = to ?? (shape === 'rectangle' ? [plot.x + plot.w - 1, plot.z + plot.d - 1] : null);
    if (end) {
      const last = await hoverCell(end[0], end[1], plot.height);
      await play.mouse.drag(first.point, last.point, { button: 'left' });
    } else await play.mouse.click(first.point);
    const state = await wait((s) => s.colony.terrainPlans.some((p) => !priorIds.has(p.id)));
    const plan = state.colony.terrainPlans.find((p) => !priorIds.has(p.id));
    assert.equal(plan.target, target);
    assert.deepEqual(plan.cells.map(([x, z]) => key(x, z)).sort(), plot.cells.map(([x, z]) => key(x, z)).sort());
    assert.equal(plan.progress, 0);
    assert.notEqual(plan.state, 'completed');
    const before = clone(plan), blocks = state.nonAirCount;
    const paused = await advance(2);
    assert.deepEqual(clone(planBy(paused, plan.id)), before, 'Paused terrain plans must not progress.');
    assert.equal(paused.nonAirCount, blocks, 'Planning must not immediately fill or remove voxels.');
    await checkHeights(plot, plot.height);
    return plan.id;
  };

  const initial = await play.step('default-map-is-250-by-250', async () => {
    await wait((s) => s.colony?.colonists.length === 3 && s.terrain && s.nonAirCount > 1000);
    await clearMapUi();
    const state = await speed(0);
    await stockConstructionFixture(play, { plank: 40 });
    assert.deepEqual([state.worldSize[0], state.worldSize[2]], [250, 250]);
    assert.deepEqual(state.dimensions, state.worldSize);
    await play.page.locator('#settings-toggle').click();
    assert.match(await play.page.locator('#world-size').innerText(), /250\s*[×x]\s*250/);
    await capture('terrain-01-default-250x250-map');
    await clearMapUi();
    // One earthworker makes the intermediate foundation stage observable.
    for (const [index, pawn] of state.colony.colonists.entries()) {
      await setPriority(pawn.id, 'terraform', index === 0 ? 1 : 0);
      await setPriority(pawn.id, 'construct', index === 0 ? 1 : 0);
    }
    await clearMapUi();
    return clone(state);
  });

  const sampledPlot = await play.step('ground-height-sampling-changes-target-without-creating-blueprint', async () => {
    const plot = await findPlot();
    markUsed(plot);
    await terrainSettings(plot.height + 1);
    const priorIds = (await read()).colony.terrainPlans.map((plan) => plan.id);
    await click('terrain-sample');
    await wait((s) => s.terrain.sample === true);
    const hover = await hoverCell(plot.x, plot.z, plot.height);
    await play.mouse.click(hover.point);
    const sampled = await wait((s) => s.terrain.target === plot.height && !s.terrain.sample);
    assert.deepEqual(sampled.colony.terrainPlans.map((plan) => plan.id), priorIds, 'Sampling must not create an earthwork plan.');
    await checkHeights(plot, plot.height);
    await capture('terrain-02a-ground-height-sampling-without-blueprint');
    return plot;
  });
  const cut = await play.step('paused-point-brush-creates-cut-blueprint-without-editing', async () => {
    const plot = sampledPlot;
    const id = await newTerrainPlan(plot, plot.height - 1);
    assert.equal(planBy(await read(), id).remainingCut, 1);
    assert.equal(planBy(await read(), id).remainingFill, 0);
    await capture('terrain-02-paused-cut-blueprint');
    return { id, plot };
  });
  await play.step('residents-complete-cut-and-real-ground-lowers', async () => {
    await speed(6);
    await advanceUntil((s) => planBy(s, cut.id)?.state === 'completed');
    await speed(0);
    const plan = planBy(await read(), cut.id);
    assert.equal(plan.remainingCut + plan.remainingFill, 0);
    assert.equal(plan.progress, 1);
    await checkHeights(cut.plot, cut.plot.height - 1);
    await capture('terrain-03-resident-cut-completed');
  });
  await play.step('residents-complete-fill-and-real-ground-rises', async () => {
    const plot = { ...cut.plot, height: cut.plot.height - 1 };
    const id = await newTerrainPlan(plot, cut.plot.height);
    assert.equal(planBy(await read(), id).remainingFill, 1);
    await capture('terrain-04-paused-fill-blueprint');
    await speed(6);
    await advanceUntil((s) => planBy(s, id)?.state === 'completed');
    await speed(0);
    assert.equal(planBy(await read(), id).remainingCut + planBy(await read(), id).remainingFill, 0);
    await checkHeights(cut.plot, cut.plot.height);
    await capture('terrain-05-resident-fill-completed');
  });
  await play.step('paused-rectangle-blueprint-can-be-cancelled-without-terrain-changes', async () => {
    const plot = await findPlot(2, 2);
    markUsed(plot);
    const id = await newTerrainPlan(plot, plot.height + 1, { shape: 'rectangle' });
    assert.equal(planBy(await read(), id).remainingFill, 4);
    await capture('terrain-06-paused-rectangle-blueprint');
    await openPanel('plan', 'tool-level');
    await click(`terrain-cancel-${id}`);
    await wait((s) => !planBy(s, id));
    await checkHeights(plot, plot.height);
    await capture('terrain-07-cancelled-rectangle-ground-unchanged');
  });
  await play.step('multi-cell-brush-drag-covers-stroke-and-cancels-without-terrain-changes', async () => {
    const plot = await findPlot(3, 2);
    markUsed(plot);
    // A width-2 brush is centered with floor(size / 2); these adjacent centers
    // sweep exactly the 3x2 plot, including both ends of the real mouse drag.
    const id = await newTerrainPlan(plot, plot.height + 1, { size: 2,
      from: [plot.x + 1, plot.z + 1], to: [plot.x + 2, plot.z + 1] });
    assert.equal(planBy(await read(), id).remainingFill, 6);
    await capture('terrain-07a-paused-multi-cell-brush-stroke');
    await openPanel('plan', 'tool-level');
    await click(`terrain-cancel-${id}`);
    await wait((s) => !planBy(s, id));
    await checkHeights(plot, plot.height);
    await capture('terrain-07b-cancelled-brush-stroke-ground-unchanged');
  });

  const foundation = await play.step('multi-cell-building-automatically-plans-raised-foundation', async () => {
    const plot = await findPlot(2, 1), target = plot.height + 1;
    markUsed(plot);
    await openPanel('build', 'build-workbench');
    assert.ok(await control('build-height-auto').isChecked(), 'Buildings start with anchor-height sampling.');
    await control('build-height-auto').uncheck();
    await number('build-height', target);
    await wait((s) => s.buildHeight === target);
    await capture('terrain-08-multi-cell-building-foundation-controls');
    await click('build-workbench');
    await wait((s) => s.tool === 'build:workbench');
    await play.page.locator('#workspace').waitFor({ state: 'hidden' });
    const priorIds = new Set((await read()).colony.buildings.map((b) => b.id));
    const hover = await hoverCell(plot.x, plot.z, plot.height);
    await play.mouse.click(hover.point);
    const state = await wait((s) => s.colony.buildings.some((b) => !priorIds.has(b.id)));
    const building = state.colony.buildings.find((b) => !priorIds.has(b.id));
    assert.deepEqual([building.x, building.y, building.z, building.w, building.d], [plot.x, target, plot.z, 2, 1]);
    assert.equal(building.phase, 'preparingTerrain');
    assert.equal(building.progress, 0);
    assert.deepEqual(building.reserved, {}, 'Construction materials wait until the foundation is ready.');
    const plan = planBy(state, building.terrainPlanId);
    assert.equal(plan.buildingId, building.id);
    assert.equal(plan.target, target);
    assert.equal(plan.cells.length, 2);
    assert.equal(plan.remainingFill, 2);
    assert.ok(!state.colony.jobs.some((job) => job.type === 'construct' && job.targetId === building.id));
    await advance(2);
    await checkHeights(plot, plot.height);
    await capture('terrain-09-paused-building-auto-level-blueprint');
    return { id: building.id, planId: plan.id, plot, target };
  });
  let foundationSamples = 0;
  const checkFoundationOrder = (state) => {
    const building = buildingBy(state, foundation.id), plan = planBy(state, foundation.planId);
    assert.ok(building && plan, 'The building retains its linked leveling plan.');
    if (plan.state !== 'completed') {
      foundationSamples++;
      assert.equal(building.phase, 'preparingTerrain');
      assert.equal(building.progress, 0, 'Construction must not progress before all ground cells are level.');
      assert.ok(!state.colony.jobs.some((job) => job.type === 'construct' && job.targetId === building.id && job.progress > 0));
    }
  };
  await play.step('save-load-and-reload-restore-unfinished-groundwork', async () => {
    await speed(1);
    await advanceUntil((s) => {
      const plan = planBy(s, foundation.planId);
      return plan?.state === 'working' && plan.remainingFill > 0;
    }, { seconds: 30, chunk: 0.1, onSample: checkFoundationOrder });
    await speed(0);
    const baseline = clone(await read());
    assert.ok(planBy(baseline, foundation.planId).remainingFill > 0);
    checkFoundationOrder(baseline);
    await clearMapUi();
    await play.page.locator('#settings-toggle').click();
    await play.page.locator('#save').click();
    await play.page.locator('#save-status').filter({ hasText: '手动存档已保存到本机' }).waitFor({ state: 'visible' });
    await clearMapUi();
    await openPanel('build', 'build-workbench');
    await click(`building-cancel-${foundation.id}`);
    await wait((s) => !buildingBy(s, foundation.id) && !planBy(s, foundation.planId));
    await clearMapUi();
    await play.page.locator('#settings-toggle').click();
    await play.page.locator('#load').click();
    const loaded = await wait((s) => !!buildingBy(s, foundation.id) && s.colony.speed === 0);
    assert.deepEqual(clone(loaded.colony), baseline.colony, 'Manual load restores the in-flight residents, earthwork and building.');
    assert.equal(loaded.nonAirCount, baseline.nonAirCount);
    await clearMapUi();
    await openPanel('plan', 'tool-level');
    await capture('terrain-10-unfinished-foundation-restored-from-save');
    await play.reload();
    const restored = await wait((s) => s.colony?.time === baseline.colony.time && !!buildingBy(s, foundation.id) && s.colony.speed === 0);
    assert.deepEqual(clone(restored.colony), baseline.colony, 'Browser reload preserves the same unfinished groundwork.');
    assert.deepEqual(restored.worldSize, baseline.worldSize);
    await clearMapUi();
    checkFoundationOrder(restored);
    await capture('terrain-11-unfinished-foundation-survives-reload');
  });
  const completed = await play.step('groundwork-finishes-before-multi-cell-building-construction', async () => {
    await speed(6);
    const state = await advanceUntil((s) => buildingBy(s, foundation.id)?.complete, { seconds: 90, chunk: 0.25, onSample: checkFoundationOrder });
    await speed(0);
    const building = buildingBy(state, foundation.id), plan = planBy(state, foundation.planId);
    assert.equal(plan.state, 'completed');
    assert.equal(plan.remainingCut + plan.remainingFill, 0);
    assert.equal(building.phase, 'completed');
    assert.equal(building.progress, 1);
    assert.ok(foundationSamples > 0);
    await checkHeights(foundation.plot, foundation.target);
    await capture('terrain-12-built-workbench-on-level-multi-cell-foundation');
    return { buildingId: building.id, terrainPlanId: plan.id, target: building.y, footprint: [building.w, building.d], foundationSamples };
  });
  await play.step('completed-building-survives-save-and-browser-reload', async () => {
    await play.page.locator('#settings-toggle').click();
    await play.page.locator('#save').click();
    await play.page.locator('#save-status').filter({ hasText: '手动存档已保存到本机' }).waitFor({ state: 'visible' });
    await play.reload();
    await wait((s) => buildingBy(s, foundation.id)?.complete && s.colony.speed === 0);
    await clearMapUi();
    await checkHeights(foundation.plot, foundation.target);
    await terrainSettings(foundation.target, 'brush', 3);
    await hoverCell(cut.plot.x, cut.plot.z, cut.plot.height);
    assert.ok(await control('terrain-target').isVisible());
    await capture('terrain-13-final-terrain-toolbar-1280x720');
    await play.page.setViewportSize({ width: 1280, height: 600 });
    await advance(0.1);
    await capture('terrain-14-final-terrain-toolbar-1280x600');
    await play.page.setViewportSize({ width: 1280, height: 720 });
    await advance(0.1);
  });

  return { requirements: ['250x250-map', 'height-sampling-without-blueprint', 'paused-point-brush-blueprint', 'resident-cut', 'resident-fill',
    'paused-rectangle-blueprint', 'multi-cell-brush-drag', 'cancel-unexecuted-plan', 'multi-cell-building', 'automatic-foundation',
    'earthwork-before-construction', 'unfinished-save-load-reload', 'completed-save-reload', 'terrain-toolbar-two-viewports'],
    map: [initial.worldSize[0], initial.worldSize[2]], completed };
}
