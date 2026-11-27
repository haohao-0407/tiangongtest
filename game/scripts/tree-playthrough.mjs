import { returnToMap } from './return-to-map.mjs';
// Official owner-browser acceptance; every mutation uses normal player input.
// node node_modules/@forgeax/engine/dist/bin/forgeax.mjs project play scripts/tree-playthrough.mjs --require-ui --json
import assert from 'node:assert/strict';

const READ = 'voxel.world';
const clone = value => JSON.parse(JSON.stringify(value));
const dot = (a, b) => a.reduce((sum, n, i) => sum + n * b[i], 0);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = a => a.map(n => n / Math.hypot(...a));
const treeBy = (state, id) => state.trees.find(tree => tree.id === id);
const jobsFor = (state, id) => state.colony.jobs.filter(job => job.type === 'chop' && job.targetId === id);
const wood = state => state.colony.resources.wood
  + state.colony.items.filter(item => item.resource === 'wood').reduce((sum, item) => sum + item.amount, 0)
  + state.colony.colonists.reduce((sum, pawn) => sum + (pawn.carrying.wood ?? 0), 0);

/** @param {import('@forgeax/engine/devkit').PlayContext} play */
export default async function treePlaythrough(play) {
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
    // The current UI uses two nested Escape layers for pause and game settings.
    for (let attempt = 0; attempt < 5 && (await play.page.locator('#game-options').isVisible() || await play.page.locator('#pause-menu').isVisible()); attempt++) {
      await play.page.keyboard.press('Escape'); await advance(.05);
    }
    assert.equal(await play.page.locator('#game-options').isVisible(), false);
    assert.equal(await play.page.locator('#pause-menu').isVisible(), false);
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
    // 空格只用于跳跃，速度一律点按钮（暂停也不再绑空格）
    await play.page.locator(`[data-testid="speed-${value}"]`).click();
    return wait(state => state.colony.speed === value);
  };
  const choose = async (menu, id, tool) => {
    await clearUi(); await click(`menu-${menu}`); await click(id);
    await wait(state => state.tool === tool); await closePanel();
  };
  const inspect = async () => { await clearUi(); await returnToMap(play); await wait(state => state.tool === 'inspect'); };
  const project = (state, position) => {
    if (state.camera.overhead) {
      const {target,distance}=state.camera,{width,height}=play.page.viewportSize();
      const span=2*distance*Math.tan(Math.PI/8);
      return [.5+(position[0]-target[0])/(span*width/height),.5+(position[2]-target[2])/span];
    }
    const camera = state.camera, forward = unit(camera.target.map((n, i) => n - camera.eye[i]));
    const right = unit(cross(forward, [0, 1, 0])), up = cross(right, forward);
    const relative = position.map((n, i) => n - camera.eye[i]), depth = dot(relative, forward);
    if (depth <= 0) return [-1, -1];
    const viewport = play.page.viewportSize() ?? { width: 1280, height: 720 };
    const halfHeight = Math.tan(Math.PI / 8) * depth;
    return [.5 + dot(relative, right) / (2 * halfHeight * viewport.width / viewport.height), .5 - dot(relative, up) / (2 * halfHeight)];
  };
  const visible = ([x, y]) => x > .22 && x < .72 && y > .18 && y < .77;
  const hoverPart = async (tree, role) => {
    const positions = role === 'trunk'
      ? [.35, .65, 1, 1.4, 1.75].flatMap(y => [[0, y, 0], [.2, y, 0], [-.2, y, 0], [0, y, .2]])
      : [tree.trunkHeight + 1.85, tree.trunkHeight + 1.25, tree.trunkHeight + .35].flatMap(y =>
        [[0, y, 0], [.8, y, .8], [-.8, y, .8], [.8, y, -.8], [-.8, y, -.8], [1.7, y, 0], [0, y, 1.7]]);
    for (const position of positions) {
      const point = project(await read(), [tree.x + .5 + position[0], tree.y + position[1], tree.z + .5 + position[2]]);
      if (!visible(point)) continue;
      await play.mouse.move(point); const state = await advance(.05);
      if (state.hoverTreeId === tree.id && state.hoverTreePart === role) return { point, state };
    }
    return null;
  };
  const centerTree = async tree => {
    await clearUi(); await focusMap();
    for (const axis of ['right', 'back']) {
      const initial = await read(), yaw = initial.camera.yaw;
      const direction = axis === 'right' ? [Math.cos(yaw), 0, -Math.sin(yaw)] : [Math.sin(yaw), 0, Math.cos(yaw)];
      const error = state => dot([tree.x + .5 - state.camera.target[0], 0, tree.z + .5 - state.camera.target[2]], direction);
      const delta = error(initial); if (Math.abs(delta) < .6) continue;
      const key = axis === 'right' ? delta > 0 ? 'KeyD' : 'KeyA' : delta > 0 ? 'KeyS' : 'KeyW';
      await play.keyboard.hold(key, state => Math.abs(error(state)) < .6 || error(state) * delta < 0, { read: READ });
    }
    await play.mouse.move([.5, .44]);
    for (let step = 0; step < 4 && (await read()).camera.distance > 27; step++) {
      const previous = (await read()).camera.distance;
      await play.page.mouse.wheel(0, -180); await wait(state => state.camera.distance < previous);
    }
    await advance(.1);
  };
  const findTree = async excluded => {
    await inspect(); const state = await read(), home = state.colony.colonists[0].position;
    const candidates = state.trees.filter(tree => !excluded.has(tree.id)).sort((a, b) =>
      Math.hypot(a.x - home[0], a.z - home[2]) + Math.abs(a.y - home[1]) * 6
      - Math.hypot(b.x - home[0], b.z - home[2]) - Math.abs(b.y - home[1]) * 6);
    for (const tree of candidates.slice(0, 12)) {
      play.signal.throwIfAborted(); await centerTree(tree);
      if (await hoverPart(tree, 'trunk') && await hoverPart(tree, 'crown')) return tree;
    }
    assert.fail('No natural tree with visible trunk and crown was found through real camera and hover input.');
  };
  const select = async (tree, role) => {
    await inspect(); const hit = await hoverPart(tree, role); assert.ok(hit, `Cannot point at ${role} of ${tree.id}`);
    await play.mouse.click(hit.point); await wait(state => state.selectedTreeId === tree.id);
    assert.ok(await control('tree-inspector').isVisible());
    assert.equal(await control('tree-inspector').getAttribute('data-tree-id'), tree.id);
    return hit;
  };
  const settings = async () => {
    await inspect(); await speed(0); await focusMap();
    await play.page.keyboard.press('Escape');
    await play.page.locator('#pause-menu').waitFor({ state: 'visible' });
    await play.page.locator('#pause-settings').click();
    await play.page.locator('#game-options').waitFor({ state: 'visible' });
    await play.page.locator('#options-world').click();
    await play.page.locator('#settings').waitFor({ state: 'visible' });
    // 空格不再绑暂停，暂停只能从速度按钮走（那会关掉面板，所以这里不再验证「开着面板暂停」）
    await wait(state => state.colony.speed === 1);
    assert.ok(await play.page.locator('#settings').isVisible());
  };

  await play.step('prepare-natural-trees-and-resident-woodcutters', async () => {
    const state = await wait(s => s.colony?.colonists.length === 3 && s.trees?.length > 3 && s.treeModel?.instances === s.trees.length);
    if (await play.page.locator('html').getAttribute('data-forgeax-input'))
      await play.page.locator('html[data-forgeax-input="open"]').waitFor({ state: 'attached' });
    await clearUi(); await speed(0);
    assert.ok(state.treeModel.meshes < state.treeModel.instances, 'Tree instances reuse their variant meshes.');
    assert.ok(state.treeModel.uniqueTriangles > 0 && state.treeModel.triangles > state.treeModel.uniqueTriangles);
    await click('menu-work');
    for (const pawn of state.colony.colonists) {
      for (let attempt = 0; attempt < 5; attempt++) {
        const current = (await read()).colony.colonists.find(p => p.id === pawn.id).priorities.chop;
        if (current === 1) break;
        await click(`priority-${pawn.id}-chop`);
        await wait(s => s.colony.colonists.find(p => p.id === pawn.id).priorities.chop !== current);
      }
      assert.equal((await read()).colony.colonists.find(p => p.id === pawn.id).priorities.chop, 1);
    }
    await clearUi();
  });

  const harvested = await play.step('one-model-trunk-and-crown-select-the-same-object', async () => {
    const tree = await findTree(new Set());
    await capture('tree-01-native-layered-canopy-and-branches');
    await select(tree, 'trunk'); await capture('tree-02-trunk-selects-whole-tree');
    await select(tree, 'crown'); await capture('tree-03-crown-selects-same-tree');
    return tree;
  });

  await play.step('mining-a-tree-cannot-remove-its-root-support', async () => {
    const before = clone(await read());
    await clearUi();await click('menu-plan');
    assert.equal(await control('tool-mine').count(),0);
    await closePanel();
    const after=await read();
    assert.deepEqual(clone(after.trees), before.trees);
    assert.equal(after.nonAirCount, before.nonAirCount);
    assert.equal(after.colony.jobs.filter(job => job.type === 'mine').length, before.colony.jobs.filter(job => job.type === 'mine').length);
    await capture('tree-mining-protects-root-and-whole-object');
    await select(harvested, 'crown');
  });

  await play.step('cancel-and-repeat-designations-still-own-one-job', async () => {
    await click('tree-chop'); await wait(state => jobsFor(state, harvested.id).length === 1);
    assert.ok(await control('tree-cancel-chop').isVisible());
    await click('tree-cancel-chop'); await wait(state => jobsFor(state, harvested.id).length === 0);
    assert.ok(treeBy(await read(), harvested.id), 'Cancel leaves the complete model alive.');
    for (const role of ['crown', 'crown']) {
      await choose('plan', 'tool-chop', 'chop');
      const hit = await hoverPart(harvested, role); assert.ok(hit);
      await play.mouse.click(hit.point); await wait(state => jobsFor(state, harvested.id).length === 1);
    }
    await select(harvested, 'crown'); await capture('tree-04-one-chop-job-for-trunk-and-crown');
  });

  await play.step('resident-reaches-trunk-and-harvests-entire-tree-once', async () => {
    const before = clone(await read()), otherTrees = before.trees.filter(tree => tree.id !== harvested.id);
    let sawWorking = false, sawStandingBesideTrunk = false;
    await clearUi(); await speed(6);
    let state = await read();
    for (let elapsed = 0; elapsed < 150 && treeBy(state, harvested.id); elapsed += .2) {
      play.signal.throwIfAborted(); state = await advance(.2);
      const job = jobsFor(state, harvested.id)[0];
      if (job?.state === 'working' && job.assignedTo) {
        sawWorking = true;
        const pawn = state.colony.colonists.find(person => person.id === job.assignedTo);
        sawStandingBesideTrunk ||= Math.abs(Math.floor(pawn.position[0]) - harvested.x) + Math.abs(Math.floor(pawn.position[2]) - harvested.z) === 1;
      }
    }
    await speed(0); state = await read();
    assert.ok(!treeBy(state, harvested.id), `Resident failed to chop ${harvested.id}: ${JSON.stringify({ jobs: jobsFor(state, harvested.id), residents: state.colony.colonists.map(p => ({ task: p.task, position: p.position })) })}`);
    assert.ok(sawWorking && sawStandingBesideTrunk, 'A resident must work next to the trunk before removal.');
    assert.equal(jobsFor(state, harvested.id).length, 0);
    assert.deepEqual(clone(state.trees), otherTrees, 'Every neighbouring tree remains independent.');
    assert.equal(wood(state), wood(before) + harvested.trunkHeight * 6, 'The complete tree yields wood exactly once.');
    await wait(s => s.treeModel.instances === s.trees.length);
    await capture('tree-05-resident-harvested-whole-tree-neighbours-preserved');
  });

  const removed = await play.step('sandbox-crown-removal-undo-and-redo-operate-on-whole-object', async () => {
    const tree = await findTree(new Set([harvested.id]));
    await choose('sandbox', 'sandbox-remove', 'sandbox:remove');
    const before = clone(await read()), hit = await hoverPart(tree, 'crown'); assert.ok(hit);
    await play.mouse.click(hit.point);
    const after = await wait(state => !treeBy(state, tree.id) && state.treeModel.instances === state.trees.length);
    assert.equal(after.lastEdit?.action, 'remove-tree'); assert.equal(after.lastEdit?.treeId, tree.id);
    assert.deepEqual(clone(after.trees), before.trees.filter(t => t.id !== tree.id));
    assert.equal(wood(after), wood(before), 'Sandbox removal does not duplicate harvested wood.');
    assert.equal(after.nonAirCount, before.nonAirCount, 'Natural-tree removal leaves terrain voxels intact.');
    await capture('tree-06-sandbox-crown-removes-whole-tree');
    await play.keyboard.press('Control+KeyZ');
    const undone = await wait(state => !!treeBy(state, tree.id) && state.redo && state.treeModel.instances === state.trees.length);
    assert.deepEqual(clone(undone.trees), before.trees);
    assert.ok(await hoverPart(tree, 'trunk')); assert.ok(await hoverPart(tree, 'crown'));
    await capture('tree-07-undo-restores-whole-tree');
    await play.keyboard.press('Control+KeyY');
    const redone = await wait(state => !treeBy(state, tree.id) && !state.redo && state.treeModel.instances === state.trees.length);
    assert.deepEqual(clone(redone.trees), clone(after.trees));
    assert.ok(!treeBy(redone, harvested.id), 'Undoing a sandbox edit cannot revive a harvested tree.');
    await capture('tree-08-redo-removes-whole-tree');
    return tree;
  });

  await play.step('manual-save-load-and-reload-preserve-whole-tree-removals', async () => {
    const baseline = clone((await read()).trees);
    await settings(); await play.page.locator('#save').click();
    await play.page.locator('#save-status').filter({ hasText: '手动存档已保存到本机' }).waitFor({ state: 'visible' });
    await choose('sandbox', 'sandbox-remove', 'sandbox:remove'); await focusMap();
    await play.keyboard.press('Control+KeyZ'); await wait(state => !!treeBy(state, removed.id));
    await settings(); await play.page.locator('#load').click();
    const loaded = await wait(state => !treeBy(state, removed.id) && !treeBy(state, harvested.id) && state.colony.speed === 0);
    assert.deepEqual(clone(loaded.trees), baseline);
    await clearUi(); await capture('tree-09-manual-load-keeps-removed-trees-absent');
    await play.reload();
    const restored = await wait(state => state.trees?.length === baseline.length && state.treeModel?.instances === baseline.length && state.colony?.speed === 0);
    assert.deepEqual(clone(restored.trees), baseline);
    assert.ok(!treeBy(restored, removed.id) && !treeBy(restored, harvested.id));
    await clearUi(); await capture('tree-10-reload-preserves-tree-identities-and-removals');
  });

  await play.step('tree-inspector-and-model-fit-1280-by-600', async () => {
    const tree = await findTree(new Set([harvested.id, removed.id]));
    await play.page.setViewportSize({ width: 1280, height: 600 }); await advance(.1);
    await select(tree, 'crown');
    assert.ok(await control('tree-chop').isVisible());
    await capture('tree-11-complete-model-and-inspector-1280x600');
    await play.page.setViewportSize({ width: 1280, height: 720 }); await advance(.1);
  });

  return { requirements: ['native-whole-tree-model', 'shared-variant-meshes', 'same-tree-from-trunk-and-crown', 'cancel-chop',
    'one-job-per-tree', 'resident-reaches-trunk', 'whole-tree-harvest-once', 'neighbours-preserved', 'sandbox-whole-tree-removal',
    'undo-redo-whole-tree', 'save-load-reload-trees', 'tree-inspector-1280x600', 'mining-protects-root'], harvested: harvested.id, removed: removed.id,
    models: (await read()).treeModel };
}
