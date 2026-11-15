// Official owner-browser acceptance: imported terrain contains no architectural source nodes.
// All walls, entrances, extensions and removals below are ordinary player mouse input.
// pnpm exec forgeax project play scripts/facade-playthrough.mjs --require-ui --headless true --backend auto --timeout-ms 300000 --json
import assert from 'node:assert/strict';

const READ = 'voxel.world', SAVE_KEY = 'homestead.colony.v2', SEED = '森屿-跨格立面验收-16';
const WALL_Z = 10, BASE = 5, ENTRY_MIN = 14, ENTRY_MAX = 16;
const dot = (a, b) => a.reduce((s, n, i) => s + n * b[i], 0);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = a => a.map(n => n / Math.hypot(...a));
const sameCell = (a, b) => Array.isArray(a) && a.length === 3 && a.every((n, i) => n === b[i]);
const groups = state => structuredClone(state.pcg.layout.groups).sort((a, b) => a.id.localeCompare(b.id));
const layout = state => JSON.stringify(groups(state));
const architecture = state => JSON.stringify((state.pcg.features ?? []).filter(f => f.kind === 'window' || f.kind === 'sill')
  .map(f => ({ id: f.id, kind: f.kind, min: f.min, max: f.max, groupId: f.groupId })).sort((a, b) => a.id.localeCompare(b.id)));
const noEntranceOverlap = state => {
  for (const feature of state.pcg.features.filter(f => f.kind === 'window' || f.kind === 'sill')) {
    if (feature.min[1] < BASE + 2 && feature.min[2] < WALL_Z + 1.5 && feature.max[2] > WALL_Z - .5)
      assert.ok(feature.max[0] <= ENTRY_MIN || feature.min[0] >= ENTRY_MAX, `Feature ${feature.id} crosses the reserved entrance.`);
  }
};

export function createFacadeTerrainFixture() {
  const width = 32, height = 24, depth = 32, edits = [];
  for (let y = 1; y < height; y++) for (let z = 0; z < depth; z++) for (let x = 0; x < width; x++)
    edits.push([x + width * (z + depth * y), y > 4 ? 0 : y === 4 ? 1 : y < 3 ? 3 : 2]);
  return JSON.stringify({ version: 1, generatorVersion: 2, seed: SEED, size: [width, height, depth], edits });
}

/** @param {import('@forgeax/engine/devkit').PlayContext} play */
export default async function facadePlaythrough(play) {
  const read = () => play.state(READ);
  const wait = predicate => play.waitFor(predicate, { read: READ, timeoutMs: 15_000 });
  const advance = seconds => play.advance(seconds, { read: READ, stepSeconds: .05 });
  const control = id => play.page.locator(`[data-testid="${id}"]`);
  const capture = async name => assert.equal((await play.screenshot(name)).rendered, true, `${name}: native game pixels must be visible`);
  const settled = () => wait(s => s.pcg?.layout?.version === 2 && s.pcg.pendingTiles === 0);
  const closeUi = async () => {
    for (const id of ['panel-close', 'inspector-close', 'help-close', 'settings-close']) {
      const button = play.page.locator(`#${id}`); if (await button.isVisible()) await button.click();
    }
    await play.mouse.move([.55, .46]);
  };
  const openWorldSettings = async () => {
    await closeUi();
    if ((await read()).tool !== 'inspect') {
      await play.keyboard.press('Escape'); await wait(s => s.tool === 'inspect');
    }
    await play.keyboard.press('Escape');
    await play.page.locator('#pause-settings').click();
    await play.page.locator('#options-world').click();
    await play.page.locator('#settings').waitFor({ state: 'visible' });
  };
  const sandbox = async () => {
    if (!(await control('sandbox-build').isVisible())) await control('menu-sandbox').click();
    await control('sandbox-build').click(); await control('block-6').click();
    await wait(s => s.tool === 'sandbox:build' && s.selected === 6 && s.colony.speed === 0);
    await closeUi();
  };
  const overview = async () => {
    await play.keyboard.press('KeyF');
    await play.keyboard.hold('KeyW', s => s.camera.target[2] < 14.5, { read: READ });
    await play.keyboard.hold('KeyD', s => s.camera.target[0] > 17, { read: READ });
    await play.page.mouse.wheel(0, -240); await advance(.2);
  };
  const closeup = async name => {
    await closeUi();
    // Rotate and orbit using the same controls available to a player; no engine camera overrides.
    await play.keyboard.hold('KeyQ', s => s.camera.yaw < .04, { read: READ });
    await play.page.mouse.wheel(0, -240); await advance(.15);
    const viewport = play.page.viewportSize() ?? { width: 1280, height: 720 };
    await play.page.mouse.move(viewport.width * .74, viewport.height * .50);
    await play.page.mouse.down({ button: 'middle' });
    await play.page.mouse.move(viewport.width * .74, viewport.height * .50 - 70, { steps: 10 });
    await play.page.mouse.up({ button: 'middle' });
    await play.mouse.move([.92, .85]); await advance(.2); await capture(name);
  };
  const project = (s, position) => {
    const forward = unit(s.camera.target.map((n, i) => n - s.camera.eye[i]));
    const right = unit(cross(forward, [0, 1, 0])), up = cross(right, forward);
    const relative = position.map((n, i) => n - s.camera.eye[i]), depth = dot(relative, forward);
    const viewport = play.page.viewportSize() ?? { width: 1280, height: 720 };
    const halfHeight = Math.tan(Math.PI / 8) * depth;
    return [.5 + dot(relative, right) / (2 * halfHeight * viewport.width / viewport.height), .5 - dot(relative, up) / (2 * halfHeight)];
  };
  const aimTop = async (cell, top) => {
    const state = await read();
    for (const [u, v] of [[.5, .5], [.25, .25], [.75, .25], [.25, .75], [.75, .75], [.5, .15], [.15, .5], [.85, .5], [.5, .85]]) {
      const point = project(state, [cell[0] + u, top + .002, cell[2] + v]);
      if (point[0] < .08 || point[0] > .88 || point[1] < .18 || point[1] > .81) continue;
      for (const [dx, dy] of [[0, 0], [-.002, 0], [.002, 0], [0, -.002], [0, .002]]) {
        const input = [point[0] + dx, point[1] + dy]; await play.mouse.move(input);
        if (sameCell((await advance(.05)).hoverCell, cell)) return input;
      }
    }
    assert.fail(`Cannot hover source cell ${cell} at top ${top}: ${JSON.stringify({ hover: (await read()).hoverCell, camera: (await read()).camera })}`);
  };
  const place = async cell => {
    const input = await aimTop(cell, cell[1]), before = await read();
    await play.mouse.click(input);
    await wait(s => s.revision > before.revision && sameCell([s.lastEdit?.x, s.lastEdit?.y, s.lastEdit?.z], cell) && s.lastEdit?.block === 6);
    return settled();
  };
  const remove = async cell => {
    await play.keyboard.press('KeyX'); await wait(s => s.tool === 'sandbox:remove');
    const input = await aimTop(cell, cell[1] + 1), before = await read();
    await play.mouse.click(input);
    await wait(s => s.revision > before.revision && s.lastEdit?.action === 'remove' && sameCell([s.lastEdit?.x, s.lastEdit?.y, s.lastEdit?.z], cell));
    return settled();
  };
  const history = async (key, expected) => {
    const before = await read(); await play.keyboard.press(key);
    await wait(s => s.revision > before.revision && layout(s) === expected);
    return settled();
  };

  await play.step('import-plain-terrain-and-select-wall-material', async () => {
    await wait(s => s.colony?.colonists?.length === 3 && s.pcg?.layout);
    await openWorldSettings(); await play.page.locator('#import').click();
    await play.page.locator('#import-json').fill(createFacadeTerrainFixture()); await play.page.locator('#import-confirm').click();
    await wait(s => s.seed === SEED && s.dimensions[0] === 32);
    await closeUi(); await sandbox(); const state = await settled();
    assert.equal(state.pcg.resolution, 16); assert.equal(groups(state).length, 0);
    await overview(); await capture('facade-01-plain-input-terrain');
  });

  await play.step('mouse-build-whole-wall-with-two-cell-entrance', async () => {
    for (const y of [BASE, BASE + 1]) for (let x = 8; x <= 23; x++)
      if (x < ENTRY_MIN || x >= ENTRY_MAX) await place([x, y, WALL_Z]);
    const state = await settled(), layoutGroups = groups(state);
    assert.ok(layoutGroups.length > 0 && layoutGroups.length < 14, 'Window count must be decided by wider facade groups, not one per source column.');
    assert.ok(layoutGroups.some(g => g.axis === 'x' && g.u1 - g.u0 >= 1.5), 'At least one real window group spans multiple source voxels.');
    for (const group of layoutGroups) {
      for (const n of [group.plane, group.base, group.lower, group.upper, group.u0, group.u1]) assert.equal(n * 16, Math.round(n * 16));
      const sills = state.pcg.features.filter(f => f.kind === 'sill' && f.groupId === group.id);
      assert.ok(sills.length >= 1 && sills.length <= 2, 'Each group has at most one continuous sill on each exposed facade.');
      assert.ok(sills.every(f => f.max[0] - f.min[0] > group.u1 - group.u0));
    }
    noEntranceOverlap(state);
    await closeup('facade-02-cross-cell-window-groups-and-continuous-sills');
    await overview(); await capture('facade-03-clear-two-cell-entrance');
  });

  await play.step('end-extension-preserves-existing-window-positions', async () => {
    const before = groups(await read());
    for (const y of [BASE, BASE + 1]) for (const x of [24, 25, 26]) await place([x, y, WALL_Z]);
    const state = await settled(), after = groups(state);
    for (const group of before) assert.deepEqual(after.find(g => g.id === group.id), group, 'Extending a wall must retain valid existing groups.');
    assert.ok(after.length > before.length, 'The added wall span should make room for another whole window group.');
    noEntranceOverlap(state); await capture('facade-04-extension-retains-old-window-locations');
  });

  await play.step('broken-support-cleans-group-and-history-restores-exact-layout', async () => {
    const before = await read(), expected = layout(before), expectedFeatures = architecture(before);
    const target = groups(before).filter(g => g.axis === 'x' && g.plane === WALL_Z && g.u1 - g.u0 >= 1.5)
      .sort((a, b) => Math.abs((a.u0 + a.u1) / 2 - 18) - Math.abs((b.u0 + b.u1) / 2 - 18))[0];
    assert.ok(target, 'The public layout must contain a cross-cell group to exercise removal.');
    const x = Math.floor((target.u0 + target.u1) / 2);
    const removed = await remove([x, BASE + 1, WALL_Z]), removedLayout = layout(removed), removedFeatures = architecture(removed);
    assert.ok(!groups(removed).some(g => g.id === target.id), 'A window cannot remain where its wall support was removed.');
    assert.ok(!removed.pcg.features.some(f => f.kind === 'sill' && f.groupId === target.id), 'Both old sill ends must be removed with the broken group.');
    noEntranceOverlap(removed); await capture('facade-05-source-removal-clears-whole-window-group');
    assert.equal(architecture(await history('Control+KeyZ', expected)), expectedFeatures);
    await capture('facade-06-undo-restores-identical-groups');
    assert.equal(architecture(await history('Control+KeyY', removedLayout)), removedFeatures);
    assert.equal(architecture(await history('Control+KeyZ', expected)), expectedFeatures);
  });

  const walkTo = async (x, z, maxSeconds = 12) => {
    let state = await read(), elapsed = 0;
    while (Math.hypot(state.player.x - x, state.player.z - z) > .16 && elapsed < maxSeconds) {
      const dx = x - state.player.x, dz = z - state.player.z, yaw = state.camera.yaw;
      const right = dx * Math.cos(yaw) - dz * Math.sin(yaw), forward = -dx * Math.sin(yaw) - dz * Math.cos(yaw);
      const key = Math.abs(right) > Math.abs(forward) ? (right > 0 ? 'KeyD' : 'KeyA') : (forward > 0 ? 'KeyW' : 'KeyS');
      const seconds = Math.min(.07, Math.hypot(dx, dz) / 4.5);
      await play.page.keyboard.down(key); await advance(seconds); await play.page.keyboard.up(key);
      state = await advance(.025); assert.equal(state.player.embedded, false); elapsed += seconds;
    }
    assert.ok(Math.hypot(state.player.x - x, state.player.z - z) <= .2, `Entrance route blocked at ${JSON.stringify(state.player)}`);
    return state;
  };
  await play.step('player-walks-through-reserved-entrance', async () => {
    await closeUi(); await play.keyboard.press('KeyR'); await wait(s => s.camera.mode === 'character');
    const start = await read();
    await walkTo(start.player.x, 12.5); await walkTo(15, 12.5);
    const crossed = await walkTo(15, 8.5);
    assert.equal(crossed.player.grounded, true); assert.equal(crossed.player.embedded, false);
    noEntranceOverlap(crossed); await capture('facade-07-player-through-entrance');
    await play.keyboard.press('KeyR'); await wait(s => s.camera.mode === 'god');
  });

  const saved = await play.step('save-and-reload-preserve-facade-layout-and-geometry', async () => {
    const before = await settled(), expected = layout(before), expectedFeatures = architecture(before);
    await openWorldSettings(); await play.page.locator('#save').click();
    await play.page.waitForFunction(({ key, seed }) => {
      try {
        const data = JSON.parse(localStorage.getItem(key) ?? 'null'), voxel = JSON.parse(data.voxel);
        return data.version === 2 && voxel.seed === seed && voxel.facadeLayout?.version === 2 && voxel.facadeLayout.groups.length > 0;
      } catch { return false; }
    }, { key: SAVE_KEY, seed: SEED }, { timeout: 12_000 });
    await play.reload();
    await wait(s => s.seed === SEED && s.edits === before.edits && s.pcg?.layout && layout(s) === expected);
    const state = await settled(); assert.equal(architecture(state), expectedFeatures); noEntranceOverlap(state);
    await sandbox(); assert.equal((await read()).undo, false);
    await overview(); await closeup('facade-08-restored-layout-closeup');
    return { groups: groups(state).length, facades: state.pcg.facades, resolution: state.pcg.resolution, geometryIdentical: true };
  });
  return { requirements: ['whole-wall-layout', 'cross-cell-window-groups', 'continuous-group-sills', 'sixteenth-unit-geometry',
    'entrance-clearance', 'stable-existing-window-positions', 'source-removal', 'undo-redo-layout', 'save-reload-layout'], saved };
}
