import { returnToMap } from './return-to-map.mjs';
import { possessResident } from './select-resident.mjs';
// A real player, real resident-built door, and real movement inputs.
// pnpm exec forgeax project play scripts/multiblock-collision-playthrough.mjs --require-ui --json
import assert from 'node:assert/strict';

const READ = 'voxel.world';
const doorBy = (state, id) => state.colony.buildings.find((b) => b.id === id);
const dot = (a, b) => a.reduce((sum, n, i) => sum + n * b[i], 0);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => a.map((n) => n / Math.hypot(...a));

/** @param {import('@forgeax/engine/devkit').PlayContext} play */
export default async function multiblockCollisionPlaythrough(play) {
  const read = () => play.state(READ);
  const wait = (predicate) => play.waitFor(predicate, { read: READ, timeoutMs: 10_000 });
  const control = (id) => play.page.locator(`[data-testid="${id}"]`);
  const click = (id) => control(id).click();
  const advance = (seconds) => play.advance(seconds, { read: READ, stepSeconds: 0.025 });
  const capture = async (name) => assert.equal((await play.screenshot(name)).rendered, true, `${name}: actual game pixels must render`);
  const closeUi = async () => {
    for (const id of ['panel-close', 'inspector-close', 'help-close', 'settings-close']) {
      const button = play.page.locator(`#${id}`);
      if (await button.isVisible()) await button.click();
    }
    // The Engine input host owns keyboard shortcuts while the pointer is on the
    // map; leaving it on a just-clicked menu button keeps UI ownership instead.
    await play.mouse.move([0.5, 0.46]);
    await advance(0.05);
  };
  const inspect = async () => {
    await closeUi(); await returnToMap(play); await wait((s) => s.tool === 'inspect');
  };
  const speed = async (value) => { await click(`speed-${value}`); return wait((s) => s.colony.speed === value); };
  const project = (s, p) => {
    const forward = unit(s.camera.target.map((n, i) => n - s.camera.eye[i]));
    const right = unit(cross(forward, [0, 1, 0])), up = cross(right, forward);
    const relative = p.map((n, i) => n - s.camera.eye[i]), depth = dot(relative, forward);
    const viewport = play.page.viewportSize() ?? { width: 1280, height: 720 }, halfHeight = Math.tan(Math.PI / 8) * depth;
    return [0.5 + dot(relative, right) / (2 * halfHeight * viewport.width / viewport.height), 0.5 - dot(relative, up) / (2 * halfHeight)];
  };
  const hover = async (point) => { await play.mouse.move(point); return advance(0.05); };
  const ground = async (x, y, z) => {
    for (const [u, v] of [[0.5, 0.5], [0.2, 0.2], [0.8, 0.2], [0.2, 0.8], [0.8, 0.8]]) {
      const point = project(await read(), [x + u, y + .02, z + v]);
      if (point[0] < .2 || point[0] > .73 || point[1] < .2 || point[1] > .77) continue;
      const s = await hover(point);
      if (!s.hoverBuildingId && s.hoverCell?.[0] === x && s.hoverCell?.[1] === y && s.hoverCell?.[2] === z) return point;
    }
    return null;
  };
  const selectDoor = async (id) => {
    await inspect();
    const door = doorBy(await read(), id);
    for (const [u, v, w] of [[.5, 1.6, .5], [.2, 1.8, .2], [.8, 1.8, .8], [.5, 1.9, .5]]) {
      const point = project(await read(), [door.x + u, door.y + v, door.z + w]), s = await hover(point);
      if (s.hoverBuildingId !== id) continue;
      await play.mouse.click(point);
      await wait((state) => state.selectedBuildingId === id);
      assert.ok(await control('building-toggle-door').isVisible());
      return;
    }
    assert.fail('The door must be selectable through ordinary visible mouse targeting.');
  };
  const character = async (enabled) => {
    const expected = enabled ? 'character' : 'god';
    if ((await read()).camera.mode !== expected) {
      await closeUi();
      // A menu button retains DOM focus after pointer movement. A normal inspect
      // click on empty visible ground gives the game keyboard focus again.
      let focused = false;
      for (const point of [[.55, .65], [.45, .65], [.6, .58], [.4, .58]]) {
        const state = await hover(point), cell = state.hoverCell;
        if (!cell || state.hoverBuildingId || state.colony.colonists.some((p) => Math.hypot(p.position[0] - cell[0] - .5, p.position[2] - cell[2] - .5) < 1)) continue;
        await play.mouse.click(point); await advance(.05); focused = true; break;
      }
      assert.ok(focused, 'A visible empty map point must accept normal keyboard focus.');
      if(enabled)await possessResident(play);
      else await play.page.keyboard.press('KeyR');
      await advance(0.4);
      await wait((s) => s.camera.mode === expected);
    }
  };
  // Steer along the current camera's right/forward axes. Read-only position feedback
  // chooses the next ordinary movement key; no position or collision state is set.
  const walk = async (x, z, { seconds = 6, mustReach = true } = {}) => {
    let state = await read(), elapsed = 0, moving = false;
    while (Math.hypot(state.player.x - x, state.player.z - z) > .12 && elapsed < seconds) {
      const dx = x - state.player.x, dz = z - state.player.z, yaw = state.camera.yaw;
      const right = dx * Math.cos(yaw) - dz * Math.sin(yaw), forward = -dx * Math.sin(yaw) - dz * Math.cos(yaw);
      const key = Math.abs(right) > Math.abs(forward) ? (right > 0 ? 'KeyD' : 'KeyA') : (forward > 0 ? 'KeyW' : 'KeyS');
      const dt = Math.min(.08, Math.hypot(dx, dz) / 4.5);
      await play.page.keyboard.down(key);
      try { state = await advance(dt); moving ||= state.player.moving; }
      finally { await play.page.keyboard.up(key); }
      state = await advance(.025);
      assert.equal(state.player.embedded, false, 'The player must not be embedded in the door or terrain.');
      elapsed += dt;
    }
    if (mustReach) assert.ok(Math.hypot(state.player.x - x, state.player.z - z) <= .18,
      `The real player could not reach ${x},${z}: ${JSON.stringify(state.player)}`);
    return { state, moving, elapsed };
  };

  const initial = await play.step('prepare-nearby-flat-player-worksite', async () => {
    await wait((s) => s.colony?.colonists.length === 3 && s.nonAirCount > 1000);
    if (await play.page.locator('html').getAttribute('data-forgeax-input')) {
      await play.page.locator('html[data-forgeax-input="open"]').waitFor({ state: 'attached' });
    }
    await closeUi(); await speed(0);
    await click('menu-work');
    for (const pawn of (await read()).colony.colonists) {
      for (let i = 0; i < 5; i++) {
        const current = (await read()).colony.colonists.find((p) => p.id === pawn.id).priorities.construct;
        if (current === 1) break;
        await click(`priority-${pawn.id}-construct`);
        await wait((s) => s.colony.colonists.find((p) => p.id === pawn.id).priorities.construct !== current);
      }
    }
    await closeUi();
    const s = await read(), px = Math.floor(s.player.x), pz = Math.floor(s.player.z), y = s.player.y;
    // Confirm the whole approach and exit rectangle through actual terrain hover.
    // Keeping the initial player inside that empty rectangle gives a clear route.
    for (const [dx, dz] of [[-1, -2], [0, -2], [-1, -1], [-2, -2], [0, -1]]) {
      const x = px + dx, z = pz + dz;
      if (s.colony.buildings.some((b) => x - 1 < b.x + b.w && x + 2 > b.x && z - 1 < b.z + b.d && z + 3 > b.z)) continue;
      if (s.colony.zones.some((b) => x - 1 < b.x + b.w && x + 2 > b.x && z - 1 < b.z + b.d && z + 3 > b.z)) continue;
      let valid = true;
      for (let zz = z - 1; zz <= z + 2 && valid; zz++) {
        for (let xx = x - 1; xx <= x + 1; xx++) if (!(await ground(xx, y, zz))) { valid = false; break; }
      }
      if (valid) return { x, y, z };
    }
    assert.fail('No unobstructed, visibly flat door worksite beside the initial player.');
  });
  const id = await play.step('residents-build-the-collision-test-door', async () => {
    await click('menu-build'); await click('build-door'); await wait((s) => s.tool === 'build:door'); await closeUi();
    const point = await ground(initial.x, initial.y, initial.z);
    assert.ok(point);
    const ids = new Set((await read()).colony.buildings.map((b) => b.id));
    await play.mouse.click(point);
    const ordered = await wait((s) => s.colony.buildings.some((b) => !ids.has(b.id)));
    const door = ordered.colony.buildings.find((b) => !ids.has(b.id));
    assert.equal(door.kind, 'door'); assert.equal(door.h, 2);
    await inspect(); await speed(6);
    let state = await read();
    for (let t = 0; t < 90 && !doorBy(state, door.id).complete; t += .5) state = await advance(.5);
    assert.equal(doorBy(state, door.id).complete, true, 'Residents must build the door normally.');
    await speed(0);
    assert.equal(doorBy(await read(), door.id).doorOpen, false);
    await capture('door-collision-01-completed-closed-door');
    return door.id;
  });
  let blockedFront;
  await play.step('closed-door-blocks-real-player-movement', async () => {
    await inspect(); await character(true);
    await walk(initial.x + .5, initial.z + 1.65);
    const attempt = await walk(initial.x + .5, initial.z - .65, { seconds: 1.5, mustReach: false });
    assert.ok(attempt.moving, 'A movement input must actually reach the player controller.');
    assert.ok(attempt.state.player.z >= initial.z + 1.27, 'The closed door must stop the player before its near face.');
    assert.ok(Math.abs(attempt.state.player.x - initial.x - .5) < .2);
    const again = await walk(initial.x + .5, initial.z - .65, { seconds: .5, mustReach: false });
    assert.ok(Math.abs(again.state.player.z - attempt.state.player.z) < .06, 'Holding movement into the closed door must remain blocked.');
    blockedFront = [again.state.player.x, again.state.player.y, again.state.player.z];
    await capture('door-collision-02-player-stopped-at-closed-door');
  });
  await play.step('open-door-permits-entry-and-refuses-to-close-on-player', async () => {
    await character(false); await selectDoor(id); await click('building-toggle-door');
    await wait((s) => doorBy(s, id).doorOpen === true);
    await character(true);
    const inside = (await walk(initial.x + .5, initial.z + .5)).state;
    assert.ok(inside.player.z > initial.z && inside.player.z < initial.z + 1);
    assert.equal(inside.player.embedded, false);
    await capture('door-collision-03-player-inside-open-door');
    await character(false); await selectDoor(id); await click('building-toggle-door');
    const refused = await wait((s) => /门口有人/.test(s.status));
    assert.equal(doorBy(refused, id).doorOpen, true, 'An occupied door must remain open after a close attempt.');
    await capture('door-collision-04-closing-occupied-door-refused');
  });
  let crossed;
  await play.step('player-crosses-open-door-and-closed-door-blocks-return', async () => {
    await character(true);
    crossed = (await walk(initial.x + .5, initial.z - .65)).state.player;
    assert.ok(crossed.z < initial.z, 'The same opening must let the player cross to the other side.');
    assert.equal(crossed.embedded, false);
    await capture('door-collision-05-player-through-open-door');
    await character(false); await selectDoor(id); await click('building-toggle-door');
    await wait((s) => doorBy(s, id).doorOpen === false);
    await character(true);
    const back = await walk(initial.x + .5, initial.z + 1.65, { seconds: 1.5, mustReach: false });
    assert.ok(back.moving);
    assert.ok(back.state.player.z <= initial.z - .27, 'Reclosing the door must immediately block the return path.');
    await capture('door-collision-06-reclosed-door-blocks-return');
    await character(false); await inspect();
  });
  return { requirements: ['real-resident-door-construction', 'closed-door-player-collision', 'open-door-player-entry',
    'occupied-door-close-refused', 'open-door-player-crossing', 'reclosed-door-collision'], doorId: id, blockedFront,
  crossed: [crossed.x, crossed.y, crossed.z] };
}
