// Official owner-browser acceptance. Mutations are ordinary player inputs only.
// Run from the game root:
// pnpm exec forgeax project play scripts/colony-playthrough.mjs --require-ui --json
import assert from 'node:assert/strict';

const READ = 'voxel.world';
const COSTS = { bed: { wood: 12, cloth: 3 }, floor: { wood: 3 } };
const clone = (value) => JSON.parse(JSON.stringify(value));
const pawnBy = (state, id) => state.colony.colonists.find((pawn) => pawn.id === id);
const buildingBy = (state, id) => state.colony.buildings.find((building) => building.id === id);
const pointDistance = (a, b) => Math.hypot(...a.map((n, index) => n - b[index]));

/** @param {import('@forgeax/engine/devkit').PlayContext} play */
export default async function colonyPlaythrough(play) {
  const read = () => play.state(READ);
  const wait = (predicate) => play.waitFor(predicate, { read: READ, timeoutMs: 10_000 });
  const control = (id) => play.page.locator(`[data-testid="${id}"]`);
  const click = (id) => control(id).click();
  const capture = async (name) => {
    const shot = await play.screenshot(name);
    assert.equal(shot.rendered, true, `${name}: native game pixels must be rendered`);
  };
  const closePanel = async () => {
    const close = play.page.locator('#panel-close');
    if (await close.isVisible()) await close.click();
  };
  const settings = async (open) => {
    const panel = play.page.locator('#settings');
    if (await panel.isVisible() !== open) await play.page.locator('#settings-toggle').click();
    assert.equal(await panel.isVisible(), open, 'Settings panel must follow its player toggle.');
  };
  const speed = async (value) => {
    await click(`speed-${value}`);
    return wait((state) => state.colony?.speed === value);
  };
  const advance = (seconds) => play.advance(seconds, { read: READ, stepSeconds: 0.05 });
  const advanceUntil = async (predicate, { seconds = 120, chunk = 2, onSample } = {}) => {
    let state = await read();
    for (let elapsed = 0; elapsed < seconds && !predicate(state); elapsed += chunk) {
      play.signal.throwIfAborted();
      state = await advance(Math.min(chunk, seconds - elapsed));
      if (onSample) await onSample(state);
    }
    assert.ok(predicate(state), `Simulation did not reach the required state within ${seconds} stepped seconds: ${JSON.stringify({ status: state.status, colony: state.colony })}`);
    return state;
  };
  const setPriority = async (id, job, target) => {
    if (!(await control(`priority-${id}-${job}`).isVisible())) await click('menu-work');
    for (let attempt = 0; attempt < 5; attempt++) {
      const current = pawnBy(await read(), id)?.priorities[job];
      assert.ok(Number.isInteger(current), `${id}/${job}: priority must exist`);
      if (current === target) return;
      await click(`priority-${id}-${job}`);
      await wait((state) => pawnBy(state, id)?.priorities[job] !== current);
    }
    assert.equal(pawnBy(await read(), id)?.priorities[job], target);
  };
  const chooseTool = async (menu, id, expected) => {
    await click(`menu-${menu}`);
    await click(id);
    await wait((state) => state.tool === expected);
    await closePanel();
  };
  // Choose normal visible terrain solely through the public player hover result.
  // No private voxel access, synthetic input events, injected commands or exposed test targets.
  const findPlot = async (footprint = 1) => {
    await play.mouse.move([0.50, 0.46]);
    await play.keyboard.press('KeyF');
    const candidates = [];
    for (const y of [0.46, 0.42, 0.50, 0.38, 0.54, 0.34, 0.58, 0.30, 0.62]) {
      for (const x of [0.50, 0.46, 0.54, 0.42, 0.58, 0.38, 0.62, 0.34, 0.66]) candidates.push([x, y]);
    }
    for (const point of candidates) {
      play.signal.throwIfAborted();
      await play.mouse.move(point);
      const state = await advance(0.1), cell = state.hoverCell;
      if (!Array.isArray(cell) || cell[1] !== 6) continue;
      const [x, , z] = cell, endX = x + footprint - 1, endZ = z + footprint - 1;
      if (x < 21 || z < 21 || endX > 33 || endZ > 33) continue;
      const occupied = state.colony.buildings.some((b) => b.x >= x && b.x <= endX && b.z >= z && b.z <= endZ);
      const zoned = state.colony.zones.some((zone) => x < zone.x + zone.w && endX >= zone.x && z < zone.z + zone.d && endZ >= zone.z);
      const pawnHere = state.colony.colonists.some((pawn) => pawn.position[0] >= x - 0.5 && pawn.position[0] <= endX + 1.5 && pawn.position[2] >= z - 0.5 && pawn.position[2] <= endZ + 1.5);
      if (!occupied && !zoned && !pawnHere) return { point, cell: [...cell], state };
    }
    throw new Error(`No visible unoccupied ${footprint}×${footprint} meadow plot found through real hover input.`);
  };
  const placeBuilding = async (kind) => {
    await chooseTool('build', `build-${kind}`, `build:${kind}`);
    const plot = await findPlot(), priorIds = new Set(plot.state.colony.buildings.map((b) => b.id));
    await play.mouse.click(plot.point);
    const state = await wait((s) => s.colony.buildings.some((b) => !priorIds.has(b.id)));
    const building = state.colony.buildings.find((b) => !priorIds.has(b.id));
    assert.equal(building.kind, kind);
    assert.deepEqual([building.x, building.y, building.z], plot.cell);
    assert.equal(building.complete, false, 'A paused order must remain a blueprint.');
    assert.equal(building.progress, 0);
    for (const [resource, amount] of Object.entries(COSTS[kind])) {
      assert.equal(building.reserved[resource], amount, `${kind}: material ${resource} must be reserved exactly once`);
    }
    const job = state.colony.jobs.find((j) => j.targetId === building.id && j.type === 'construct');
    assert.ok(job, `${kind}: blueprint must have a real construction job`);
    return { id: building.id, plot, state };
  };

  const initial = await play.step('colony-opens-with-three-residents-and-facilities', async () => {
    const state = await wait((s) => s.colony?.colonists.length === 3 && s.nonAirCount > 1000);
    assert.equal(state.colony.version, 1);
    assert.ok(state.colony.buildings.some((b) => b.complete), 'Initial facilities must exist in the simulation.');
    assert.ok(state.colony.buildings.some((b) => b.kind === 'bed' && b.complete));
    assert.ok(state.colony.buildings.some((b) => b.kind === 'stove' && b.complete));
    assert.ok(state.colony.buildings.some((b) => b.kind === 'researchDesk' && b.complete));
    assert.equal(new Set(state.colony.colonists.map((p) => p.id)).size, 3);
    for (const pawn of state.colony.colonists) {
      assert.ok(await control(`colonist-${pawn.id}`).isVisible(), `${pawn.name}: resident card is visible`);
      for (const value of [pawn.health, pawn.hunger, pawn.rest, pawn.recreation, pawn.mood]) assert.ok(Number.isFinite(value));
    }
    const help = play.page.locator('#help-close');
    if (await help.isVisible()) await help.click();
    await capture('colony-01-three-residents-and-starting-camp');
    return clone(state);
  });

  await play.step('pause-freezes-the-whole-simulation', async () => {
    const before = clone((await speed(0)).colony);
    const after = await advance(12);
    assert.deepEqual(after.colony, before, 'Paused simulation must not change time, needs, jobs, stocks or events.');
    await capture('colony-02-paused-simulation');
  });

  const speedEvidence = await play.step('one-three-six-times-speed-and-visible-work', async () => {
    const deltas = [];
    let observedWork = false;
    const start = clone((await read()).colony);
    for (const value of [1, 3, 6]) {
      const before = (await speed(value)).colony;
      const after = (await advance(8)).colony;
      const delta = after.time - before.time;
      assert.ok(delta > 0, `${value}× must advance simulation time`);
      deltas.push({ speed: value, seconds: delta });
      observedWork ||= after.jobs.some((j) => j.state === 'working' && j.assignedTo)
        || after.colonists.some((p) => p.jobId && p.task);
    }
    for (const sample of deltas.slice(1)) {
      assert.ok(Math.abs(sample.seconds / deltas[0].seconds - sample.speed) < sample.speed * 0.12,
        `Observed speed must scale by ${sample.speed}; deltas=${JSON.stringify(deltas)}`);
    }
    const current = (await speed(0)).colony;
    assert.ok(current.metrics.distanceWalked > start.metrics.distanceWalked, 'Residents must actually move.');
    assert.ok(observedWork || current.metrics.jobsCompleted > start.metrics.jobsCompleted, 'At least one real job must run.');
    assert.ok(current.colonists.some((p) => pointDistance(p.position, start.colonists.find((old) => old.id === p.id).position) > 0.1), 'Resident positions must visibly change.');
    await capture('colony-03-residents-working-and-moving');
    return deltas;
  });

  const [builderId, researcherId] = initial.colony.colonists.map((p) => p.id);
  await play.step('resident-selection-priorities-and-schedules', async () => {
    await click(`colonist-${builderId}`);
    await wait((s) => s.colony.selectedColonistId === builderId);
    await setPriority(builderId, 'construct', 1);
    await setPriority(builderId, 'research', 4);
    await click(`schedule-${builderId}-night`);
    await wait((s) => pawnBy(s, builderId).schedule === 'night');
    await capture('colony-04-resident-needs-priorities-and-night-shift');
    await click(`schedule-${builderId}-balanced`);
    await wait((s) => pawnBy(s, builderId).schedule === 'balanced');
    await setPriority(researcherId, 'research', 1);
    await setPriority(researcherId, 'construct', 2);
    await closePanel();
  });

  const built = await play.step('mouse-places-reserved-bed-and-floor-blueprints', async () => {
    const bed = await placeBuilding('bed');
    const floor = await placeBuilding('floor');
    await capture('colony-05-bed-and-floor-resource-reservations');
    return { bed, floor };
  });

  await play.step('cancel-blueprint-releases-resources', async () => {
    const before = clone((await read()).colony);
    const temporary = await placeBuilding('floor');
    await closePanel();
    await play.mouse.move(temporary.plot.point);
    await play.keyboard.press('KeyX');
    await wait((s) => s.tool === 'cancel');
    await play.mouse.click(temporary.plot.point);
    const after = await wait((s) => !buildingBy(s, temporary.id));
    assert.ok(!after.colony.jobs.some((j) => j.targetId === temporary.id));
    assert.deepEqual(after.colony.resources, before.resources, 'Cancelled construction must return all reserved resources.');
    await capture('colony-06-cancelled-blueprint-releases-resources');
  });

  await play.step('mouse-designates-farm-and-stockpile-zones', async () => {
    for (const kind of ['farm', 'stockpile']) {
      await chooseTool('plan', `tool-zone-${kind}`, `zone:${kind}`);
      const plot = await findPlot(3), before = plot.state.colony.zones.length;
      await play.mouse.click(plot.point);
      const state = await wait((s) => s.colony.zones.length === before + 1);
      const zone = state.colony.zones.find((z) => z.kind === kind && z.x === plot.cell[0] && z.z === plot.cell[2]);
      assert.ok(zone);
      assert.deepEqual([zone.w, zone.d], [3, 3]);
      await capture(`colony-07-${kind}-zone-on-terrain`);
    }
  });

  await play.step('production-target-and-research-selection', async () => {
    await click('menu-production');
    const previous = (await read()).colony.bills.meal;
    await click('bill-meal-plus');
    await wait((s) => s.colony.bills.meal === previous + 3);
    await capture('colony-08-production-target-changed');
    await click('menu-research');
    await click('research-electricity');
    await wait((s) => s.colony.research.active === 'electricity');
    await capture('colony-09-research-project-selected');
    await closePanel();
  });

  await play.step('residents-walk-to-and-complete-blueprints', async () => {
    await click('menu-inspect');
    await wait((state) => state.tool === 'inspect');
    await closePanel();
    const before = clone((await read()).colony);
    let sawConstruction = false;
    await speed(6);
    const result = await advanceUntil(
      (s) => [built.bed.id, built.floor.id].every((id) => buildingBy(s, id)?.complete),
      { seconds: 120, chunk: 1, onSample: (s) => {
        sawConstruction ||= s.colony.jobs.some((j) => j.type === 'construct'
          && [built.bed.id, built.floor.id].includes(j.targetId) && j.state === 'working' && j.assignedTo);
      } },
    );
    assert.ok(sawConstruction, 'Observe an assigned, working construction job before completion.');
    assert.ok(result.colony.metrics.built >= before.metrics.built + 2);
    assert.ok(result.colony.metrics.distanceWalked > before.metrics.distanceWalked, 'Construction requires residents to traverse the map.');
    for (const id of [built.bed.id, built.floor.id]) {
      const building = buildingBy(result, id);
      assert.ok(building.progress >= 1);
      assert.ok(Object.values(building.reserved).every((amount) => amount === 0), 'Completed buildings must not retain material reservations.');
      assert.ok(!result.colony.jobs.some((j) => j.targetId === id && j.type === 'construct'));
    }
    await speed(0);
    await capture('colony-10-new-bed-and-floor-completed-by-residents');
  });

  await play.step('research-advances-only-through-real-colonist-work', async () => {
    const before = clone((await read()).colony);
    assert.ok(before.research.active === 'electricity' || before.research.completed.includes('electricity'));
    await speed(6);
    const after = await advanceUntil((s) => s.colony.research.completed.includes('electricity'), { seconds: 180, chunk: 2 });
    assert.ok(after.colony.research.progress.electricity > 0, 'Research work must accumulate progress.');
    assert.ok(after.colony.metrics.researched > 0);
    await speed(0);
    await click('menu-research');
    await capture('colony-11-electricity-research-completed');
    await closePanel();
  });

  const saved = await play.step('manual-save-load-and-reload-restore-complete-colony', async () => {
    await speed(0);
    await closePanel();
    const baseline = clone(await read());
    await settings(true);
    await play.page.locator('#save').click();
    await settings(false);
    // A state-changing real UI interaction proves that Load performs restoration.
    await click('menu-production');
    await click('bill-meal-plus');
    await wait((s) => s.colony.bills.meal === baseline.colony.bills.meal + 3);
    await closePanel();
    await settings(true);
    await play.page.locator('#load').click();
    const loaded = await wait((s) => s.colony.bills.meal === baseline.colony.bills.meal);
    await settings(false);
    assert.deepEqual(loaded.colony, baseline.colony, 'Load must restore every public simulation field while paused.');
    assert.equal(loaded.seed, baseline.seed);
    assert.equal(loaded.nonAirCount, baseline.nonAirCount);
    assert.equal(loaded.edits, baseline.edits);
    await capture('colony-12-manual-save-restored-colony');
    await play.reload();
    const restored = await wait((s) => s.colony?.time === baseline.colony.time && s.colony?.speed === 0);
    assert.deepEqual(restored.colony, baseline.colony, 'Browser reload must retain the complete paused simulation.');
    assert.equal(restored.seed, baseline.seed);
    assert.equal(restored.nonAirCount, baseline.nonAirCount);
    assert.equal(restored.edits, baseline.edits);
    await capture('colony-13-reloaded-colony-and-map');
    return { seed: restored.seed, colonists: restored.colony.colonists.length, buildings: restored.colony.buildings.length,
      zones: restored.colony.zones.length, time: restored.colony.time, research: restored.colony.research.completed };
  });

  // Sandbox is deliberately exercised by its own independent browser/profile script.
  // This run never modifies terrain with infinite resources or overwrites the colony via reseeding.
  return { requirements: ['three-residents', 'initial-facilities', 'dynamic-work', 'pause', '1-3-6-speed',
    'selection-priorities-schedules', 'material-reservation-and-cancel', 'mouse-build-and-colonist-construction',
    'farm-stockpile-zones', 'production-target', 'research-work-and-unlock', 'full-save-load-reload'],
  speedEvidence, saved };
}
