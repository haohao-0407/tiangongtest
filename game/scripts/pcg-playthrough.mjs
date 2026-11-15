// Structural PCG acceptance in ForgeAX's owner browser.
// The fixture is an ordinary imported terrain save with NO Road/Brick nodes.
// Every PCG source node is then placed/removed with real player mouse input.
// pnpm exec forgeax project play scripts/pcg-playthrough.mjs --require-ui --json
import assert from 'node:assert/strict';

const READ = 'voxel.world';
const SAVE_KEY = 'homestead.colony.v2';
const SEED = '森屿-PCG结构验收-16';
// Keep the road on the same raised platform, clear of the initial beds at z=15..16.
const ROAD_Z = 14;
const dot = (a, b) => a.reduce((s, n, i) => s + n * b[i], 0);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = a => a.map(n => n / Math.hypot(...a));
const sameCell = (a, b) => Array.isArray(a) && a.length === 3 && a.every((n, i) => n === b[i]);
const counts = s => ({ windows: s.pcg.windows, sills: s.pcg.sills, sidewalks: s.pcg.sidewalks, stairs: s.pcg.stairs });
const features = s => JSON.stringify((s.pcg.features ?? []).map(f => ({ id: f.id, kind: f.kind, anchor: f.anchor, min: f.min, max: f.max })).sort((a, b) => String(a.id).localeCompare(String(b.id))));

export function createTerrainFixture() {
  const width = 32, height = 24, depth = 32, edits = [];
  for (let y = 1; y < height; y++) for (let z = 0; z < depth; z++) for (let x = 0; x < width; x++) {
    // A flat meadow at foot height 5, plus a supported one-cell-high platform.
    // Nothing is predecorated and no PCG node is embedded in this input save.
    const raised = x >= 18 && x <= 24 && z >= 14 && z <= 16;
    const top = raised ? 5 : 4;
    const block = y > top ? 0 : y === top ? 1 : y < top - 1 ? 3 : 2;
    edits.push([x + width * (z + depth * y), block]);
  }
  return JSON.stringify({ version: 1, generatorVersion: 2, seed: SEED, size: [width, height, depth], edits });
}

/** @param {import('@forgeax/engine/devkit').PlayContext} play */
export default async function pcgPlaythrough(play) {
  const read = () => play.state(READ);
  const wait = predicate => play.waitFor(predicate, { read: READ, timeoutMs: 15_000 });
  const advance = seconds => play.advance(seconds, { read: READ, stepSeconds: 0.05 });
  const control = id => play.page.locator(`[data-testid="${id}"]`);
  const capture = async name => assert.equal((await play.screenshot(name)).rendered, true, `${name}: native game pixels must be visible`);
  const settled = async () => wait(s => s.pcg && (s.pcg.pendingTiles === undefined || s.pcg.pendingTiles === 0));
  const closeUi = async () => {
    for (const id of ['panel-close', 'inspector-close', 'help-close', 'settings-close']) {
      const button = play.page.locator(`#${id}`);
      if (await button.isVisible()) await button.click();
    }
    await play.mouse.move([0.5, 0.46]);
  };
  const sandbox = async block => {
    if (!(await control('sandbox-build').isVisible())) await control('menu-sandbox').click();
    await control('sandbox-build').click();
    await control(`block-${block}`).click();
    await wait(s => s.tool === 'sandbox:build' && s.selected === block && s.colony.speed === 0);
    await closeUi();
  };
  const project = (s, position) => {
    const forward = unit(s.camera.target.map((n, i) => n - s.camera.eye[i]));
    const right = unit(cross(forward, [0, 1, 0])), up = cross(right, forward);
    const relative = position.map((n, i) => n - s.camera.eye[i]), depth = dot(relative, forward);
    const viewport = play.page.viewportSize() ?? { width: 1280, height: 720 };
    const halfHeight = Math.tan(Math.PI / 8) * depth;
    return [0.5 + dot(relative, right) / (2 * halfHeight * viewport.width / viewport.height),
      0.5 - dot(relative, up) / (2 * halfHeight)];
  };
  // All targeting is validated against the public cursor result before clicking.
  // `top` is the original coarse surface; decorations do not provide hidden aims.
  const aimTop = async (cell, top) => {
    const s = await read();
    const samples = [[.5, .5], [.25, .25], [.75, .25], [.25, .75], [.75, .75], [.5, .15], [.15, .5], [.85, .5], [.5, .85]];
    for (const [u, v] of samples) {
      const point = project(s, [cell[0] + u, top + .002, cell[2] + v]);
      if (point[0] < .08 || point[0] > .88 || point[1] < .18 || point[1] > .81) continue;
      for (const [dx, dy] of [[0, 0], [-.002, 0], [.002, 0], [0, -.002], [0, .002]]) {
        const input = [point[0] + dx, point[1] + dy];
        await play.mouse.move(input);
        const hovered = await advance(.05);
        if (sameCell(hovered.hoverCell, cell)) return input;
      }
    }
    assert.fail(`Cannot hover expected source cell ${cell} at top ${top}: ${JSON.stringify({ hover: (await read()).hoverCell, camera: (await read()).camera })}`);
  };
  const place = async (cell, top, block) => {
    const input = await aimTop(cell, top), before = await read();
    await play.mouse.click(input);
    const after = await wait(s => s.revision > before.revision && sameCell([s.lastEdit?.x, s.lastEdit?.y, s.lastEdit?.z], cell) && s.lastEdit?.block === block);
    await settled();
    return after;
  };
  const remove = async (cell, top) => {
    await play.keyboard.press('KeyX');
    await wait(s => s.tool === 'sandbox:remove');
    const input = await aimTop(cell, top), before = await read();
    await play.mouse.click(input);
    const after = await wait(s => s.revision > before.revision && s.lastEdit?.action === 'remove' && sameCell([s.lastEdit?.x, s.lastEdit?.y, s.lastEdit?.z], cell));
    await settled();
    return after;
  };
  const history = async (key, predicate) => {
    const before = await read();
    await play.keyboard.press(key);
    await wait(s => s.revision > before.revision && predicate(s));
    return settled();
  };

  await play.step('import-undecorated-terrain-through-player-ui', async () => {
    await wait(s => s.colony?.colonists?.length === 3 && s.pcg);
    await closeUi();
    await play.page.locator('#settings-toggle').click();
    await play.page.locator('#import').click();
    await play.page.locator('#import-json').fill(createTerrainFixture());
    await play.page.locator('#import-confirm').click();
    await wait(s => s.seed === SEED && s.dimensions[0] === 32);
    await closeUi();
    await sandbox(6);
    const state = await settled();
    assert.deepEqual(counts(state), { windows: 0, sills: 0, sidewalks: 0, stairs: 0 }, 'The imported fixture supplies terrain only; PCG features must come from subsequent real edits.');
    if (state.pcg.resolution !== undefined) assert.equal(state.pcg.resolution, 16);
    // Frame the editable meadow via ordinary camera keys and wheel.
    await play.keyboard.press('KeyF');
    await play.keyboard.hold('KeyW', s => s.camera.target[2] < 14.5, { read: READ });
    await play.keyboard.hold('KeyD', s => s.camera.target[0] > 17, { read: READ });
    await play.page.mouse.wheel(0, -240);
    await advance(.2);
    await capture('pcg-01-undecorated-source-terrain');
  });

  const wall = await play.step('mouse-build-two-high-wall-with-window-frames-and-sills', async () => {
    await play.keyboard.press('Digit4');
    await wait(s => s.selected === 6 && s.tool === 'sandbox:build');
    for (const y of [5, 6]) for (let x = 12; x <= 20; x++) await place([x, y, 11], y, 6);
    const state = await wait(s => s.pcg.windows > 0 && s.pcg.sills > 0);
    await settled();
    assert.ok(state.pcg.tiles >= 2, 'The wall crosses the x=16 detail tile boundary.');
    assert.ok(state.pcg.triangles > 0);
    await capture('pcg-02-automatic-window-frames');
    await capture('pcg-03-extruded-window-sills');
    return counts(await read());
  });

  await play.step('wall-source-removal-updates-across-tile-boundary-and-undo-redo', async () => {
    await remove([16, 6, 11], 7);
    const removed = await wait(s => s.pcg.windows < wall.windows && s.pcg.sills < wall.sills);
    await capture('pcg-04-wall-source-deletion-cleans-details');
    const afterRemoval = counts(removed);
    await history('Control+KeyZ', s => s.pcg.windows === wall.windows && s.pcg.sills === wall.sills);
    await capture('pcg-05-window-restored-by-undo');
    await history('Control+KeyY', s => s.pcg.windows === afterRemoval.windows && s.pcg.sills === afterRemoval.sills);
    await history('Control+KeyZ', s => s.pcg.windows === wall.windows && s.pcg.sills === wall.sills);
  });

  const roads = await play.step('mouse-pave-road-with-two-sidewalks-and-height-steps', async () => {
    await sandbox(10);
    await play.keyboard.press('Digit7');
    await wait(s => s.selected === 10);
    for (let x = 11; x <= 23; x++) {
      const y = x >= 18 ? 5 : 4;
      await place([x, y, ROAD_Z], y + 1, 10);
    }
    const state = await wait(s => s.pcg.sidewalks > 0 && s.pcg.stairs > 0);
    await settled();
    await capture('pcg-06-road-and-both-sidewalks');
    await capture('pcg-07-eight-riser-height-connection');
    const roadFeatures = state.pcg.features ?? [];
    assert.ok(roadFeatures.some(f => f.kind === 'sidewalk'), 'The projection must expose actual generated sidewalk features.');
    assert.ok(roadFeatures.some(f => f.kind === 'stairs' || f.kind === 'stair'), 'The projection must expose an actual generated step connection.');
    return counts(await read());
  });

  await play.step('road-junction-and-source-deletion-rebuild-boundaries', async () => {
    const original = features(await read());
    for (const z of [ROAD_Z + 1, ROAD_Z + 2]) await place([14, 4, z], 5, 10);
    const junction = await settled();
    assert.notEqual(features(junction), original, 'A new branch must rederive road boundaries.');
    await capture('pcg-08-t-junction-continuous-sidewalk');
    const intact = features(junction);
    await remove([16, 4, ROAD_Z], 5);
    const gap = await settled();
    assert.notEqual(features(gap), intact, 'Deleting the x=16 source node must invalidate road details on the tile boundary.');
    assert.equal(gap.pcg.windows, wall.windows, 'Road edits must preserve unrelated wall windows.');
    await capture('pcg-09-road-source-removal-updates-neighbors');
    await history('Control+KeyZ', s => features(s) === intact);
    assert.equal((await read()).pcg.stairs, roads.stairs);
  });

  // Move the real player without jumping, using the live camera's direction.
  const walkTo = async (x, z, maxSeconds = 6) => {
    let state = await read(), elapsed = 0;
    while (Math.hypot(state.player.x - x, state.player.z - z) > .16 && elapsed < maxSeconds) {
      const dx = x - state.player.x, dz = z - state.player.z, yaw = state.camera.yaw;
      const localRight = dx * Math.cos(yaw) - dz * Math.sin(yaw);
      const localForward = -dx * Math.sin(yaw) - dz * Math.cos(yaw);
      const keys = Math.abs(localRight) > Math.abs(localForward) ? [localRight > 0 ? 'KeyD' : 'KeyA'] : [localForward > 0 ? 'KeyW' : 'KeyS'];
      const seconds = Math.min(.08, Math.hypot(dx, dz) / 4.5);
      for (const key of keys) await play.page.keyboard.down(key);
      await advance(seconds);
      for (const key of keys) await play.page.keyboard.up(key);
      state = await advance(.025);
      assert.equal(state.player.embedded, false, 'Walking on generated geometry must not put the player inside a solid surface.');
      elapsed += seconds;
    }
    assert.ok(Math.hypot(state.player.x - x, state.player.z - z) <= .2, `Player could not walk to ${x},${z}; stopped at ${JSON.stringify(state.player)}`);
    return state;
  };

  await play.step('player-walks-up-generated-stairs-without-jumping', async () => {
    await closeUi();
    await play.keyboard.press('KeyR');
    await wait(s => s.camera.mode === 'character');
    const low = await walkTo(16.5, ROAD_Z + .5);
    const high = await walkTo(19.5, ROAD_Z + .5);
    assert.ok(high.player.y - low.player.y > .65, `Generated stairs must bridge the real height difference: ${low.player.y} -> ${high.player.y}`);
    assert.equal(high.player.grounded, true);
    await capture('pcg-10-player-on-upper-road-after-stairs');
    await play.keyboard.press('KeyR');
    await wait(s => s.camera.mode === 'god');
  });

  await play.step('unrelated-voxel-edit-preserves-player-on-detailed-road', async () => {
    const standing = await read();
    await sandbox(6);
    await place([11, 5, 18], 5, 6);
    const edited = await settled();
    assert.ok(Math.abs(edited.player.y - standing.player.y) < 1 / 32,
      'An unrelated coarse edit must not snap a player off the generated road surface to the coarse terrain height.');
    assert.equal(edited.player.embedded, false);
    assert.equal(edited.player.grounded, true);
    await history('Control+KeyZ', s => s.pcg.windows === standing.pcg.windows && s.pcg.stairs === standing.pcg.stairs);
    await play.keyboard.press('KeyR');
    await wait(s => s.camera.mode === 'character');
    await walkTo(20.5, ROAD_Z + .5);
    const returned = await walkTo(19.5, ROAD_Z + .5);
    assert.ok(Math.abs(returned.player.y - standing.player.y) < 1 / 32);
    await capture('pcg-10b-player-surface-survives-unrelated-edit');
    await play.keyboard.press('KeyR');
    await wait(s => s.camera.mode === 'god');
  });

  const saved = await play.step('save-reload-reconstructs-structural-details', async () => {
    const before = await settled(), expected = counts(before), expectedFeatures = features(before);
    await closeUi();
    await play.page.locator('#settings-toggle').click();
    await play.page.locator('#save').click();
    await play.page.waitForFunction(({ key, seed }) => {
      try {
        const save = JSON.parse(localStorage.getItem(key) ?? 'null');
        const voxel = JSON.parse(save.voxel);
        return save.version === 2 && voxel.seed === seed && voxel.edits.some(([, block]) => block === 10) && voxel.edits.some(([, block]) => block === 6);
      } catch { return false; }
    }, { key: SAVE_KEY, seed: SEED }, { timeout: 12_000 });
    const snapshot = await play.page.evaluate(key => localStorage.getItem(key), SAVE_KEY);
    assert.ok(snapshot);
    await play.reload();
    await wait(s => s.seed === SEED && s.edits === before.edits && s.pcg?.windows === expected.windows && s.pcg?.stairs === expected.stairs);
    await settled();
    const restored = await read();
    assert.deepEqual(counts(restored), expected);
    assert.equal(features(restored), expectedFeatures, 'The same source nodes must deterministically reconstruct the same features after loading.');
    await sandbox(10);
    assert.equal((await read()).undo, false, 'Restoring a save must start a fresh transaction history.');
    await play.keyboard.press('KeyF');
    await play.keyboard.hold('KeyW', s => s.camera.target[2] < 14.5, { read: READ });
    await play.keyboard.hold('KeyD', s => s.camera.target[0] > 17, { read: READ });
    await play.page.mouse.wheel(0, -240);
    await advance(.2);
    await capture('pcg-11-restored-wall-road-sidewalk-and-stairs');
    return { seed: SEED, dimensions: restored.dimensions, ...expected };
  });

  return { requirements: ['node-driven-window-frames', 'extruded-window-sills', 'road-sidewalk-boundaries', 'one-cell-height-stairs',
    'source-edit-add-remove', 'cross-tile-updates', 'undo-redo', 'real-player-stair-traversal', 'player-surface-after-unrelated-edit', 'save-reload-determinism'], saved };
}
