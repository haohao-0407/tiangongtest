// Official owner-browser acceptance. All mutations use normal player controls.
// pnpm exec forgeax project play scripts/multiblock-playthrough.mjs --require-ui --json
import assert from 'node:assert/strict';

const READ = 'voxel.world';
const clone = (value) => JSON.parse(JSON.stringify(value));
const buildingBy = (state, id) => state.colony.buildings.find((building) => building.id === id);
const dot = (a, b) => a.reduce((sum, n, i) => sum + n * b[i], 0);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => a.map((n) => n / Math.hypot(...a));

/** @param {import('@forgeax/engine/devkit').PlayContext} play */
export default async function multiblockPlaythrough(play) {
  const read = () => play.state(READ);
  const wait = (predicate) => play.waitFor(predicate, { read: READ, timeoutMs: 10_000 });
  const control = (id) => play.page.locator(`[data-testid="${id}"]`);
  const click = (id) => control(id).click();
  const advance = (seconds) => play.advance(seconds, { read: READ, stepSeconds: 0.05 });
  const capture = async (name) => {
    assert.equal((await play.screenshot(name)).rendered, true, `${name}: native game pixels must be rendered`);
  };
  const closePanel = async () => {
    const close = play.page.locator('#panel-close');
    if (await close.isVisible()) await close.click();
  };
  const clearMapUi = async () => {
    await closePanel();
    for (const id of ['inspector-close', 'help-close', 'settings-close']) {
      const close = play.page.locator(`#${id}`);
      if (await close.isVisible()) await close.click();
    }
  };
  const openPanel = async (menu, probe) => {
    if (!(await control(probe).isVisible())) await click(`menu-${menu}`);
    assert.ok(await control(probe).isVisible(), `${menu}: missing player control ${probe}`);
  };
  const speed = async (value) => {
    await click(`speed-${value}`);
    return wait((state) => state.colony.speed === value);
  };
  const chooseTool = async (menu, id, expected) => {
    await clearMapUi();
    await openPanel(menu, id);
    await click(id);
    await wait((state) => state.tool === expected);
    await closePanel();
  };
  const inspect = async () => {
    await clearMapUi();
    await click('menu-inspect');
    await wait((state) => state.tool === 'inspect');
  };
  const setPriority = async (id, job, target) => {
    const testId = `priority-${id}-${job}`;
    await openPanel('work', testId);
    for (let attempt = 0; attempt < 5; attempt++) {
      const current = (await read()).colony.colonists.find((p) => p.id === id).priorities[job];
      if (current === target) return;
      await click(testId);
      await wait((state) => state.colony.colonists.find((p) => p.id === id).priorities[job] !== current);
    }
    assert.equal((await read()).colony.colonists.find((p) => p.id === id).priorities[job], target);
  };
  const advanceUntil = async (predicate, { seconds = 120, chunk = 0.25, onSample } = {}) => {
    let state = await read();
    for (let elapsed = 0; elapsed < seconds && !predicate(state); elapsed += chunk) {
      play.signal.throwIfAborted();
      state = await advance(Math.min(chunk, seconds - elapsed));
      if (onSample) await onSample(state);
    }
    assert.ok(predicate(state), `Required state not reached: ${JSON.stringify({ status: state.status,
      buildings: state.colony.buildings, jobs: state.colony.jobs,
      residents: state.colony.colonists.map((p) => ({ task: p.task, position: p.position })) })}`);
    return state;
  };
  const hoverAt = async (point) => {
    await play.mouse.move(point);
    return advance(0.05);
  };
  // Only the public camera and real hover results are used to locate a visible part.
  const project = (state, position) => {
    const camera = state.camera, forward = unit(camera.target.map((n, i) => n - camera.eye[i]));
    const right = unit(cross(forward, [0, 1, 0])), up = cross(right, forward);
    const relative = position.map((n, i) => n - camera.eye[i]), depth = dot(relative, forward);
    const viewport = play.page.viewportSize() ?? { width: 1280, height: 720 };
    const halfHeight = Math.tan(Math.PI / 8) * depth;
    return [0.5 + dot(relative, right) / (2 * halfHeight * viewport.width / viewport.height),
      0.5 - dot(relative, up) / (2 * halfHeight)];
  };
  const visible = ([x, y]) => x > 0.2 && x < 0.75 && y > 0.2 && y < 0.77;
  const hoverGround = async (x, z, height) => {
    for (const [u, v] of [[0.5, 0.5], [0.2, 0.2], [0.8, 0.2], [0.2, 0.8], [0.8, 0.8]]) {
      const point = project(await read(), [x + u, height + 0.02, z + v]);
      if (!visible(point)) continue;
      const state = await hoverAt(point);
      if (state.hoverCell?.[0] === x && state.hoverCell?.[1] === height && state.hoverCell?.[2] === z
        && !state.hoverBuildingId) return { point, state };
    }
    return null;
  };
  const hoverPart = async (id, cell) => {
    for (const v of [0.75, 0.45, 0.95, 0.15]) {
      for (const [u, w] of [[0.5, 0.5], [0.2, 0.2], [0.8, 0.2], [0.2, 0.8], [0.8, 0.8]]) {
        const point = project(await read(), [cell[0] + u, cell[1] + v, cell[2] + w]);
        if (!visible(point)) continue;
        const state = await hoverAt(point), part = state.hoverBuildingPart;
        if (state.hoverBuildingId === id && part && part.x === cell[0] && part.y === cell[1] && part.z === cell[2]) {
          return { point, state };
        }
      }
    }
    assert.fail(`Could not point at visible part ${id}/${cell.join(',')}: ${JSON.stringify((await read()).hoverBuildingPart)}`);
  };
  const free = (state, x, z, w, d) => {
    const endX = x + w - 1, endZ = z + d - 1;
    if (x < 1 || z < 1 || endX >= state.worldSize[0] - 1 || endZ >= state.worldSize[2] - 1) return false;
    if (state.colony.buildings.some((b) => x < b.x + b.w && endX >= b.x && z < b.z + b.d && endZ >= b.z)) return false;
    if (state.colony.zones.some((zone) => x < zone.x + zone.w && endX >= zone.x && z < zone.z + zone.d && endZ >= zone.z)) return false;
    return !state.colony.colonists.some((p) => p.position[0] >= x - 0.5 && p.position[0] <= endX + 1.5
      && p.position[2] >= z - 0.5 && p.position[2] <= endZ + 1.5);
  };
  const findPlot = async (w, d) => {
    await clearMapUi();
    await play.mouse.move([0.5, 0.44]);
    await play.keyboard.press('KeyF');
    const seen = new Set(), home = (await advance(0.1)).colony.colonists[0].position;
    for (const y of [0.46, 0.42, 0.50, 0.38, 0.54, 0.34, 0.58, 0.30, 0.62]) {
      for (const x of [0.50, 0.46, 0.54, 0.42, 0.58, 0.38, 0.62, 0.34, 0.66]) {
        play.signal.throwIfAborted();
        const state = await hoverAt([x, y]), cell = state.hoverCell;
        if (!cell || state.hoverBuildingId || seen.has(`${cell[0]},${cell[2]}`)) continue;
        seen.add(`${cell[0]},${cell[2]}`);
        if (Math.hypot(cell[0] - home[0], cell[2] - home[2]) > 13 || !free(state, cell[0], cell[2], w, d)) continue;
        if (state.terrain.preview.cut || state.terrain.preview.fill) continue;
        let valid = true;
        for (let zz = cell[2]; zz < cell[2] + d && valid; zz++) {
          for (let xx = cell[0]; xx < cell[0] + w; xx++) {
            if (!(await hoverGround(xx, zz, cell[1]))) { valid = false; break; }
          }
        }
        if (valid) return { x: cell[0], y: cell[1], z: cell[2], w, d };
      }
    }
    assert.fail(`No visible, level, unoccupied ${w}x${d} construction plot found through normal input.`);
  };
  const rotation = async (target, useButton = false) => {
    for (let i = 0; i < 4 && (await read()).buildRotation !== target; i++) {
      const previous = (await read()).buildRotation;
      if (useButton) await click('build-rotate');
      else await play.keyboard.press('KeyR');
      await wait((state) => state.buildRotation === (previous + 1) % 4);
    }
    assert.equal((await read()).buildRotation, target);
  };
  const place = async (kind, turn, useButton = false) => {
    await chooseTool('build', `build-${kind}`, `build:${kind}`);
    await rotation(turn, useButton);
    const w = kind === 'bed' && turn % 2 ? 2 : 1, d = kind === 'bed' && !(turn % 2) ? 2 : 1;
    const plot = await findPlot(w, d), before = await read(), priorIds = new Set(before.colony.buildings.map((b) => b.id));
    const hovered = await hoverGround(plot.x, plot.z, plot.y);
    assert.ok(hovered, 'The construction anchor must remain visible.');
    await play.mouse.click(hovered.point);
    const state = await wait((s) => s.colony.buildings.some((b) => !priorIds.has(b.id)));
    const building = state.colony.buildings.find((b) => !priorIds.has(b.id));
    assert.deepEqual([building.kind, building.x, building.y, building.z, building.w, building.h, building.d, building.rotation],
      [kind, plot.x, plot.y, plot.z, w, kind === 'door' ? 2 : 1, d, turn]);
    assert.equal(building.complete, false);
    assert.equal(building.progress, 0);
    assert.equal(state.colony.terrainPlans.find((p) => p.id === building.terrainPlanId)?.cells.length, w * d);
    await advance(0.5);
    assert.equal(buildingBy(await read(), building.id).progress, 0, 'Paused multi-part blueprints cannot construct themselves.');
    return building.id;
  };
  const selectPart = async (id, cell) => {
    await inspect();
    const hover = await hoverPart(id, cell);
    await play.mouse.click(hover.point);
    await wait((state) => state.selectedBuildingId === id);
    assert.ok(await control('building-inspector').isVisible());
  };

  await play.step('prepare-paused-camp-and-real-construction-workers', async () => {
    const initial = await wait((state) => state.colony?.colonists.length === 3 && state.nonAirCount > 1000);
    if (await play.page.locator('html').getAttribute('data-forgeax-input')) {
      await play.page.locator('html[data-forgeax-input="open"]').waitFor({ state: 'attached' });
    }
    await clearMapUi();
    await speed(0);
    for (const pawn of initial.colony.colonists) {
      await setPriority(pawn.id, 'construct', 1);
      await setPriority(pawn.id, 'terraform', 1);
    }
    await clearMapUi();
  });

  const beds = [];
  for (const turn of [0, 1, 2, 3]) {
    beds.push(await play.step(`place-bed-with-rotation-${turn * 90}`, async () => {
      const id = await place('bed', turn, turn === 1);
      await capture(`multiblock-01-bed-blueprint-${turn * 90}-degrees`);
      return id;
    }));
  }
  const doorId = await play.step('place-rotated-two-block-high-door', async () => {
    const id = await place('door', 1);
    await capture('multiblock-02-door-two-block-blueprint-rotated');
    return id;
  });
  await play.step('residents-complete-all-multiblock-buildings', async () => {
    await inspect();
    const before = clone((await read()).colony.metrics), ids = [...beds, doorId];
    let sawWorking = false;
    await speed(6);
    const state = await advanceUntil((s) => ids.every((id) => buildingBy(s, id)?.complete), { onSample: (s) => {
      sawWorking ||= s.colony.jobs.some((j) => ids.includes(j.targetId) && j.type === 'construct' && j.state === 'working' && j.assignedTo);
    } });
    await speed(0);
    assert.ok(sawWorking, 'Construction must be performed by an assigned resident.');
    assert.ok(state.colony.metrics.built >= before.built + ids.length);
    assert.ok(state.colony.metrics.distanceWalked > before.distanceWalked);
    for (const id of ids) assert.deepEqual(buildingBy(state, id).reserved, {});
    await capture('multiblock-03-beds-and-door-built-by-residents');
  });
  await play.step('select-door-upper-half-and-operate-open-close', async () => {
    const door = buildingBy(await read(), doorId);
    assert.equal(door.doorOpen, false);
    await selectPart(door.id, [door.x, door.y + 1, door.z]);
    assert.match(await control('building-door-state').innerText(), /关闭.*阻挡通行/);
    await capture('multiblock-04-closed-door-selected-through-upper-half');
    await click('building-toggle-door');
    await wait((state) => buildingBy(state, doorId).doorOpen === true);
    assert.match(await control('building-door-state').innerText(), /打开.*可以通行/);
    await capture('multiblock-05-open-door');
    await click('building-toggle-door');
    await wait((state) => buildingBy(state, doorId).doorOpen === false);
    await capture('multiblock-06-closed-door');
    await chooseTool('plan', 'tool-interact', 'interact');
    const upper = await hoverPart(door.id, [door.x, door.y + 1, door.z]);
    await play.mouse.click(upper.point);
    await wait((state) => buildingBy(state, doorId).doorOpen === true);
    await capture('multiblock-07-door-opened-by-map-interaction');
  });
  await play.step('save-load-and-browser-reload-preserve-parts-rotation-and-door-state', async () => {
    await clearMapUi();
    const baseline = clone((await read()).colony);
    await play.page.locator('#settings-toggle').click();
    await play.page.locator('#save').click();
    await play.page.locator('#save-status').filter({ hasText: '手动存档已保存到本机' }).waitFor({ state: 'visible' });
    await clearMapUi();
    const door = buildingBy(await read(), doorId);
    await selectPart(doorId, [door.x, door.y + 1, door.z]);
    await click('building-toggle-door');
    await wait((state) => buildingBy(state, doorId).doorOpen === false);
    await clearMapUi();
    await play.page.locator('#settings-toggle').click();
    await play.page.locator('#load').click();
    const loaded = await wait((state) => buildingBy(state, doorId)?.doorOpen === true && state.colony.speed === 0);
    assert.deepEqual(clone(loaded.colony.buildings), baseline.buildings, 'Manual load restores every complete multi-part building.');
    await clearMapUi();
    await capture('multiblock-08-open-door-and-rotated-beds-restored');
    await play.reload();
    const restored = await wait((state) => state.colony?.time === baseline.time && buildingBy(state, doorId)?.doorOpen === true && state.colony.speed === 0);
    assert.deepEqual(clone(restored.colony.buildings), baseline.buildings, 'Browser reload preserves all building parts, rotations, and open state.');
    await clearMapUi();
    await capture('multiblock-09-multiblock-save-survives-reload');
  });
  await play.step('bed-second-cell-selects-whole-object-and-demolishes-once', async () => {
    const state = await read(), bed = buildingBy(state, beds[1]);
    assert.equal(bed.rotation, 1);
    const otherCell = [bed.x + 1, bed.y, bed.z];
    await selectPart(bed.id, otherCell);
    await capture('multiblock-10-bed-selected-through-second-cell');
    await click('building-demolish');
    await wait(s => buildingBy(s,bed.id) && s.colony.jobs.some(j => j.type === 'demolish' && j.targetId === bed.id));
    await speed(6);
    const after = await advanceUntil(s => !buildingBy(s, bed.id));
    await speed(0);
    assert.equal(after.colony.items.filter(item => item.resource === 'building:bed' && item.x === bed.x && item.z === bed.z).length, 1);
    assert.ok(!after.colony.jobs.some((j) => j.targetId === bed.id));
    await inspect();
    assert.ok(await hoverGround(bed.x, bed.z, bed.y));
    assert.ok(await hoverGround(otherCell[0], otherCell[2], bed.y));
    await capture('multiblock-11-whole-bed-demolished-both-cells-clear');
  });
  await play.step('door-upper-half-demolishes-both-parts-and-drops-one-door', async () => {
    const door = buildingBy(await read(), doorId);
    await chooseTool('plan', 'tool-demolish', 'demolish');
    const hover = await hoverPart(door.id, [door.x, door.y + 1, door.z]);
    await play.mouse.click(hover.point);
    await wait(s => buildingBy(s,door.id) && s.colony.jobs.some(j => j.type === 'demolish' && j.targetId === door.id));
    await speed(6);
    const after = await advanceUntil(s => !buildingBy(s, door.id));
    await speed(0);
    assert.equal(after.colony.items.filter(item => item.resource === 'building:door' && item.x === door.x && item.z === door.z).length, 1);
    assert.ok(!after.colony.jobs.some((job) => job.targetId === door.id));
    await inspect();
    assert.ok(await hoverGround(door.x, door.z, door.y), 'Removing the upper half must remove the entire door.');
    await capture('multiblock-12-whole-door-demolished-from-upper-half');
  });
  await play.step('rotation-toolbar-remains-usable-at-both-desktop-heights', async () => {
    await chooseTool('build', 'build-bed', 'build:bed');
    await rotation(3);
    assert.ok(await control('build-rotate').isVisible());
    assert.ok(await control('build-orientation').isVisible());
    assert.ok(await control('build-footprint').isVisible());
    await capture('multiblock-13-rotation-toolbar-1280x720');
    await play.page.setViewportSize({ width: 1280, height: 600 });
    await advance(0.1);
    await capture('multiblock-14-rotation-toolbar-1280x600');
    await play.page.setViewportSize({ width: 1280, height: 720 });
    await advance(0.1);
  });
  return { requirements: ['four-bed-rotations', 'button-and-keyboard-rotation', 'two-cell-bed-blueprints', 'two-high-door-blueprint',
    'resident-construction', 'upper-door-part-selection', 'door-open-close', 'map-door-interaction', 'save-load-reload-rotation-parts-open-state',
    'second-bed-cell-selection', 'whole-bed-demolition', 'whole-door-demolition-from-upper-half', 'single-facility-drop', 'rotation-toolbar-two-viewports'],
  beds, doorId, remainingBeds: (await read()).colony.buildings.filter((b) => beds.includes(b.id)).length };
}
