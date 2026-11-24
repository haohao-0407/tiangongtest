import { returnToMap } from './return-to-map.mjs';
// Official owner-browser acceptance. No runtime state injection or preplaced ores.
// Candidate locations are independently regenerated from the public world seed;
// the real camera, hover/inspect input and resident jobs must confirm every action.
import assert from 'node:assert/strict';
import { tsImport } from 'tsx/esm/api';

const { VoxelWorld, BLOCK } = await tsImport('../assets/voxel/model.ts', import.meta.url);
const READ = 'voxel.world';
const clone = value => JSON.parse(JSON.stringify(value));
const dot = (a, b) => a.reduce((sum, n, i) => sum + n * b[i], 0);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = a => a.map(n => n / Math.hypot(...a));
const oreCount = state => state.minerals.steelOre.cells;
const miningJobs = (state, ore) => state.colony.jobs.filter(job => job.type === 'mine' && job.x === ore.x && job.z === ore.z);
const steel = state => state.colony.resources.steel
  + state.colony.items.filter(item => item.resource === 'steel').reduce((sum, item) => sum + item.amount, 0)
  + state.colony.colonists.reduce((sum, pawn) => sum + (pawn.carrying.steel ?? 0), 0);

/** Find natural surface ore with a reachable adjacent working position. */
function candidatesFor(state) {
  const [width, height, depth] = state.worldSize;
  const source = new VoxelWorld(state.seed, { width, height, depth });
  assert.equal(source.generatorVersion, state.generatorVersion);
  assert.equal(source.count(BLOCK.SteelOre), oreCount(state), 'The runtime uses the same deterministic natural generator.');
  const ground = new Int16Array(width * depth), distances = new Int32Array(width * depth).fill(-1);
  const occupied = new Set();
  for (const tree of source.getTrees()) occupied.add(tree.x + tree.z * width);
  for (const building of state.colony.buildings) for (let z = building.z; z < building.z + building.d; z++)
    for (let x = building.x; x < building.x + building.w; x++) occupied.add(x + z * width);
  const valid = (x, z) => x >= 0 && z >= 0 && x < width && z < depth;
  for (let z = 0; z < depth; z++) for (let x = 0; x < width; x++) ground[x + z * width] = source.terrainHeight(x, z);
  const clear = (x, z) => {
    if (!valid(x, z) || occupied.has(x + z * width)) return false;
    const y = ground[x + z * width];
    return y > 0 && y + 1 < height && source.get(x, y, z) === BLOCK.Air && source.get(x, y + 1, z) === BLOCK.Air;
  };
  const queue = [];
  for (const pawn of state.colony.colonists) {
    const x = Math.floor(pawn.position[0]), z = Math.floor(pawn.position[2]), index = x + z * width;
    if (valid(x, z) && distances[index] < 0) { distances[index] = 0; queue.push(index); }
  }
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (let next = 0; next < queue.length; next++) {
    const index = queue[next], x = index % width, z = Math.floor(index / width);
    for (const [dx, dz] of dirs) {
      const xx = x + dx, zz = z + dz, other = xx + zz * width;
      if (!clear(xx, zz) || distances[other] >= 0 || Math.abs(ground[index] - ground[other]) > 1) continue;
      distances[other] = distances[index] + 1; queue.push(other);
    }
  }
  const result = [];
  for (let z = 0; z < depth; z++) for (let x = 0; x < width; x++) {
    const y = ground[x + z * width] - 1;
    if (source.get(x, y, z) !== BLOCK.SteelOre) continue;
    const approaches = dirs.filter(([dx, dz]) => valid(x + dx, z + dz))
      .map(([dx, dz]) => (x + dx) + (z + dz) * width)
      .filter(index => distances[index] >= 0 && Math.abs(ground[index] - y - 1) <= 1);
    if (approaches.length) result.push({ x, y, z, distance: Math.min(...approaches.map(index => distances[index])) });
  }
  return result.sort((a, b) => a.distance - b.distance || a.z - b.z || a.x - b.x);
}

/** @param {import('@forgeax/engine/devkit').PlayContext} play */
export default async function orePlaythrough(play) {
  const read = () => play.state(READ);
  const wait = predicate => play.waitFor(predicate, { read: READ, timeoutMs: 10_000 });
  const control = id => play.page.locator(`[data-testid="${id}"]`);
  const click = id => control(id).click();
  const advance = seconds => play.advance(seconds, { read: READ, stepSeconds: .05 });
  const capture = async name => assert.equal((await play.screenshot(name)).rendered, true, `${name}: expected native rendered game`);
  const closePanel = async () => { if (await play.page.locator('#panel-close').isVisible()) await play.page.locator('#panel-close').click(); };
  const focusMap = async () => {
    await play.mouse.move([.5, .38]); await advance(.05);
    await play.mouse.click([.5, .38], { button: 'middle' }); await advance(.05);
  };
  const clearUi = async () => {
    for (let attempt = 0; attempt < 5 && (await play.page.locator('#game-options').isVisible() || await play.page.locator('#pause-menu').isVisible()); attempt++) {
      await play.page.keyboard.press('Escape'); await advance(.05);
    }
    await closePanel();
    for (const id of ['inspector-close', 'settings-close', 'help-close'])
      if (await play.page.locator(`#${id}`).isVisible()) await play.page.locator(`#${id}`).click();
  };
  const speed = async value => {
    if ((await read()).colony.speed === value) return read();
    if (value && (await read()).tool.startsWith('sandbox:')) {
      await returnToMap(play); await wait(state => state.tool === 'inspect');
    }
    await focusMap();
    await play.page.keyboard.press(value === 0 ? 'Space' : ({ 1: 'Digit1', 3: 'Digit2', 6: 'Digit3' })[value]);
    return wait(state => state.colony.speed === value);
  };
  const choose = async (menu, id, tool) => {
    await clearUi(); await click(`menu-${menu}`); await click(id);
    await wait(state => state.tool === tool); await closePanel();
  };
  const inspect = async () => { await clearUi(); await returnToMap(play); await wait(state => state.tool === 'inspect'); };
  const project = (state, position) => {
    const camera = state.camera, forward = unit(camera.target.map((n, i) => n - camera.eye[i]));
    const right = unit(cross(forward, [0, 1, 0])), up = cross(right, forward);
    const relative = position.map((n, i) => n - camera.eye[i]), depth = dot(relative, forward);
    if (depth <= 0) return [-1, -1];
    const viewport = play.page.viewportSize() ?? { width: 1280, height: 720 };
    const halfHeight = Math.tan(Math.PI / 8) * depth;
    return [.5 + dot(relative, right) / (2 * halfHeight * viewport.width / viewport.height), .5 - dot(relative, up) / (2 * halfHeight)];
  };
  const hover = async (ore, surfaceY = ore.y + 1) => {
    for (const [dx, dz] of [[.5, .5], [.3, .3], [.7, .3], [.3, .7], [.7, .7]]) {
      const point = project(await read(), [ore.x + dx, surfaceY + .005, ore.z + dz]);
      if (point[0] < .22 || point[0] > .76 || point[1] < .18 || point[1] > .78) continue;
      await play.mouse.move(point); const state = await advance(.05);
      if (state.hoverCell?.[0] === ore.x && state.hoverCell?.[2] === ore.z && !state.hoverTreeId && !state.hoverBuildingId)
        return { point, state };
    }
    return null;
  };
  const center = async ore => {
    await clearUi(); await focusMap();
    for (const axis of ['right', 'back']) {
      const initial = await read(), yaw = initial.camera.yaw;
      const direction = axis === 'right' ? [Math.cos(yaw), 0, -Math.sin(yaw)] : [Math.sin(yaw), 0, Math.cos(yaw)];
      const error = state => dot([ore.x + .5 - state.camera.target[0], 0, ore.z + .5 - state.camera.target[2]], direction);
      const delta = error(initial); if (Math.abs(delta) < .6) continue;
      const key = axis === 'right' ? delta > 0 ? 'KeyD' : 'KeyA' : delta > 0 ? 'KeyS' : 'KeyW';
      await play.keyboard.hold(key, state => Math.abs(error(state)) < .6 || error(state) * delta < 0, { read: READ });
    }
    await play.mouse.move([.5, .44]);
    for (let step = 0; step < 6 && (await read()).camera.distance > 23; step++) {
      const previous = (await read()).camera.distance;
      await play.page.mouse.wheel(0, -180); await wait(state => state.camera.distance < previous);
    }
    await advance(.1);
  };
  const inspectCell = async (ore, isOre = true) => {
    await inspect();
    // Inspect intentionally prefers a resident near the clicked cell. Let the
    // miner finish collecting/hauling and leave the hole through normal simulation
    // before requesting the terrain label; a valid voxel hover alone is insufficient.
    const nearby = state => state.colony.colonists.some(p => Math.hypot(p.position[0] - ore.x - .5, p.position[2] - ore.z - .5) < 2.5);
    if (nearby(await read())) {
      await speed(6); let state = await read();
      for (let elapsed = 0; elapsed < 30 && nearby(state); elapsed += .25) {
        play.signal.throwIfAborted(); state = await advance(.25);
      }
      await speed(0); await inspect();
      assert.equal(nearby(await read()), false, `Resident still obscures terrain inspection at ${ore.x},${ore.z}`);
    }
    if (!isOre) {
      // A freshly mined cell is one voxel below its neighbours. Orbit towards
      // overhead through the player's middle-drag control so the rim cannot hide
      // the actual bottom; do not replace the ground-label assertion with a count.
      await center(ore); await inspect();
      for (let attempt = 0; attempt < 2 && (await read()).camera.pitch < 1.16; attempt++) {
        await play.mouse.drag([.5, .32], [.5, .55], { button: 'middle' });
        await advance(.1);
      }
      assert.ok((await read()).camera.pitch >= 1.16, 'Middle-drag must give a clear overhead view of the mined cell.');
    }
    const hit = await hover(ore, isOre ? ore.y + 1 : ore.y); assert.ok(hit, `Cannot point at ${ore.x},${ore.z}`);
    await play.mouse.click(hit.point);
    const text = `[${ore.x}, ${ore.z}]`;
    const state = await wait(s => s.status.includes(text) && s.status.startsWith('钢矿 ') === isOre);
    assert.equal(state.status.startsWith('钢矿 '), isOre, state.status);
    return state;
  };
  const settings = async () => {
    await inspect(); await speed(0); await focusMap(); await play.page.keyboard.press('Escape');
    await play.page.locator('#pause-menu').waitFor({ state: 'visible' });
    await play.page.locator('#pause-settings').click();
    await play.page.locator('#game-options').waitFor({ state: 'visible' });
    await play.page.locator('#options-world').click();
    await play.page.locator('#settings').waitFor({ state: 'visible' });
    await wait(state => state.colony.speed === 1); await speed(0);
  };

  let candidates, initialCount;
  await play.step('new-world-generates-natural-surface-steel-veins', async () => {
    const ready = await wait(state => state.colony?.colonists.length === 3 && state.minerals?.steelOre.cells > 0);
    if (await play.page.locator('html').getAttribute('data-forgeax-input'))
      await play.page.locator('html[data-forgeax-input="open"]').waitFor({ state: 'attached' });
    await clearUi(); await speed(0);
    assert.equal(ready.generatorVersion, 3); initialCount = oreCount(await read());
    candidates = candidatesFor(await read()); assert.ok(candidates.length > 2, 'Natural ores have reachable work positions.');
    await click('menu-work');
    for (const pawn of ready.colony.colonists) {
      for (let attempt = 0; attempt < 5; attempt++) {
        const current = (await read()).colony.colonists.find(p => p.id === pawn.id).priorities.mine;
        if (current === 1) break;
        await click(`priority-${pawn.id}-mine`);
        await wait(state => state.colony.colonists.find(p => p.id === pawn.id).priorities.mine !== current);
      }
      assert.equal((await read()).colony.colonists.find(p => p.id === pawn.id).priorities.mine, 1);
    }
    await clearUi();
  });

  const mined = await play.step('inspect-connected-exposed-vein-through-real-camera', async () => {
    for (const ore of candidates.slice(0, 16)) {
      play.signal.throwIfAborted(); await center(ore); await inspect();
      const hit = await hover(ore); if (!hit) continue;
      await inspectCell(ore); await capture('ore-01-connected-surface-vein-and-mineral-inclusions');
      return ore;
    }
    assert.fail('No generated ore could be inspected with the camera and real mouse input.');
  });

  await play.step('resident-mines-ore-and-yields-steel-once', async () => {
    await choose('plan', 'tool-mine', 'mine');
    const hit = await hover(mined); assert.ok(hit);
    await play.mouse.click(hit.point); await wait(state => miningJobs(state, mined).length === 1);
    await play.mouse.click(hit.point); assert.equal(miningJobs(await read(), mined).length, 1);
    await capture('ore-02-existing-mining-tool-designates-steel-ore');
    const before = clone(await read()); let state = before, working = false, beside = false;
    await speed(6);
    for (let elapsed = 0; elapsed < 100 && oreCount(state) === initialCount; elapsed += .3) {
      play.signal.throwIfAborted(); state = await advance(.3);
      const job = miningJobs(state, mined)[0];
      if (job?.state === 'working' && job.assignedTo) {
        working = true; const pawn = state.colony.colonists.find(p => p.id === job.assignedTo);
        beside ||= Math.abs(Math.floor(pawn.position[0]) - mined.x) + Math.abs(Math.floor(pawn.position[2]) - mined.z) === 1;
      }
    }
    await speed(0); state = await read();
    assert.equal(oreCount(state), initialCount - 1, JSON.stringify({ jobs: miningJobs(state, mined), residents: state.colony.colonists.map(p => ({ task: p.task, position: p.position })) }));
    assert.ok(working && beside, 'A resident must reach a neighbouring work cell before extracting the ore.');
    assert.equal(steel(state), steel(before) + 12); assert.equal(miningJobs(state, mined).length, 0);
    await inspectCell(mined, false); await capture('ore-03-resident-depleted-one-cell-and-produced-steel');
  });

  const removed = await play.step('sandbox-removal-undo-redo-preserve-mined-ore-depletion', async () => {
    const ore = candidates.find(candidate => candidate.x !== mined.x || candidate.z !== mined.z); assert.ok(ore);
    await center(ore); await inspectCell(ore);
    await choose('sandbox', 'sandbox-remove', 'sandbox:remove');
    const hit = await hover(ore); assert.ok(hit); const before = clone(await read());
    await play.mouse.click(hit.point); await wait(state => oreCount(state) === initialCount - 2);
    assert.equal(steel(await read()), steel(before), 'Sandbox removal has no harvest yield.');
    await focusMap(); await play.keyboard.press('Control+KeyZ');
    await wait(state => oreCount(state) === initialCount - 1 && state.redo);
    await capture('ore-04-undo-restores-only-sandbox-removed-ore');
    await play.keyboard.press('Control+KeyY'); await wait(state => oreCount(state) === initialCount - 2 && !state.redo);
    await capture('ore-05-redo-removes-ore-without-duplicating-steel');
    return ore;
  });

  await play.step('save-load-and-browser-reload-preserve-veins-and-depletion', async () => {
    await settings(); await play.page.locator('#save').click();
    await play.page.locator('#save-status').filter({ hasText: '手动存档已保存到本机' }).waitFor({ state: 'visible' });
    const savedCount = oreCount(await read()), savedSteel = steel(await read());
    await choose('sandbox', 'sandbox-remove', 'sandbox:remove'); await focusMap();
    await play.keyboard.press('Control+KeyZ'); await wait(state => oreCount(state) === savedCount + 1);
    await settings(); await play.page.locator('#load').click();
    await wait(state => oreCount(state) === savedCount && state.colony.speed === 0);
    assert.equal(steel(await read()), savedSteel);
    await center(mined); await inspectCell(mined, false);
    await center(removed); await inspectCell(removed, false);
    await capture('ore-06-manual-load-keeps-mined-and-removed-cells-empty');
    await play.reload(); await wait(state => state.generatorVersion === 3 && oreCount(state) === savedCount && state.colony?.speed === 0);
    assert.equal(steel(await read()), savedSteel);
    await center(mined); await inspectCell(mined, false);
    await capture('ore-07-reload-keeps-veins-and-mined-resource-count');
  });

  await play.step('surface-vein-visible-at-1280-by-600', async () => {
    const remaining = candidates.find(ore => (ore.x !== mined.x || ore.z !== mined.z) && (ore.x !== removed.x || ore.z !== removed.z));
    assert.ok(remaining); await center(remaining);
    await play.page.setViewportSize({ width: 1280, height: 600 }); await advance(.1);
    await inspectCell(remaining); await capture('ore-08-surface-vein-and-inspection-1280x600');
    await play.page.setViewportSize({ width: 1280, height: 720 }); await advance(.1);
  });

  return { requirements: ['seeded-natural-surface-veins', 'visible-connected-mineral-cells', 'inspect-steel-ore',
    'resident-mines-adjacent-cell', 'one-time-steel-yield', 'sandbox-undo-redo', 'save-load-reload-depletion', '1280x600-layout'],
    initialOreCells: initialCount, remainingOreCells: oreCount(await read()), mined, sandboxRemoved: removed };
}
