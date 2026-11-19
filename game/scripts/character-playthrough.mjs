import assert from 'node:assert/strict';

/** @param {import('@forgeax/engine/devkit').PlayContext} play */
export default async function characterPlaythrough(play) {
  const read = 'voxel.world';
  const advance = seconds => play.advance(seconds, {read, stepSeconds:0.05});
  const capture = async name => assert.equal((await play.screenshot(name)).rendered, true);
  const ready = () => play.waitFor(s => s.characters?.player && s.characters.residents.length >= 3, {read});
  const outfits = state => state.characters.residents.map(p => [p.id, p.outfit]);
  const initial = await ready();
  for (const model of [initial.characters.player, ...initial.characters.residents]) {
    assert.equal(model.meshes, 1);
    assert.equal(model.joints, 22);
  }
  assert.equal(new Set([initial.characters.player, ...initial.characters.residents].map(p => p.outfit)).size, 4);
  await capture('colony-characters');
  await play.page.keyboard.press('KeyR');
  await advance(.5);
  await play.mouse.move([.5,.42]);
  for (let i = 0; i < 4; i++) { await play.page.mouse.wheel(0, -300); await advance(.15); }
  await play.page.keyboard.down('KeyW');
  let walking;
  try {
    walking = await advance(.8);
    assert.equal(walking.characters.player.walk, 'Walk_Forward');
    assert.ok(walking.characters.player.time > 0);
    assert.ok(Math.hypot(walking.player.x - initial.player.x, walking.player.z - initial.player.z) > .5);
    await capture('character-walking');
  } finally { await play.page.keyboard.up('KeyW'); }
  const idle = await advance(.6);
  assert.equal(idle.characters.player.walk, null);
  await play.page.keyboard.down('KeyE');
  try { await advance(2.5); } finally { await play.page.keyboard.up('KeyE'); }
  await advance(.5);
  await capture('character-front');
  await play.page.keyboard.press('Space');
  const jumping = await advance(.15);
  assert.equal(jumping.player.grounded, false);
  assert.equal(jumping.player.parts, 3);
  assert.equal((await advance(1.5)).player.grounded, true);
  await play.reload();
  const restored = await ready();
  assert.deepEqual(outfits(restored), outfits(initial));
  assert.equal(restored.characters.player.joints, 22);
  return {outfits:outfits(restored), player:walking.characters.player};
}
