import assert from 'node:assert/strict';
import { tsImport } from 'tsx/esm/api';
import { createFacadeTerrainFixture } from './facade-playthrough.mjs';
import { possessResident } from './select-resident.mjs';
import wildAnimals from './wild-animals-playthrough.mjs';

const READ = 'voxel.world';
const SAVE = 'homestead.colony.v2';

export default async function newModels(play) {
  const { page } = play;
  await play.waitFor(s => !!s.camera, { read: READ });
  const { width, height } = page.viewportSize();
  await page.mouse.move(width * .55, height * .6);
  await page.mouse.down({ button: 'middle' });
  try {
    await page.mouse.move(width * .55, height * .6 - 110, { steps: 8 });
    await play.advance(.2, { read: READ, stepSeconds: .05 });
  } finally {
    await page.mouse.up({ button: 'middle' });
  }
  await wildAnimals(play);

  const { ColonySimulation } = await tsImport('../assets/colony/simulation.ts', import.meta.url);
  const { VoxelWorld } = await tsImport('../assets/voxel/model.ts', import.meta.url);
  const world = VoxelWorld.deserialize(createFacadeTerrainFixture());
  for (const tree of world.getTrees()) world.removeTree(tree.id, { recordHistory: false });
  const sim = new ColonySimulation(world);
  const colony = sim.serialize();
  const roles = [
    '样板村民', '家庭主妇', '农民', '果农', '锻造师', '木匠', '石匠', '机械师', '裁缝',
    '厨师', '奶酪师', '研究员', '雕塑家', '女村民', '男村民', '老奶奶', '小男孩',
  ];
  colony.colonists = roles.map((name, i) => ({
    ...structuredClone(colony.colonists[0]), id: `colonist-${(i + 16) % 17}`, name,
    position: [13.5 + i % 6 * 1.55, 5, 15.5 + Math.floor(i / 6) * 2.15], facing: 0,
    jobId: null, personal: null, path: [], destination: null, bag: Array(9).fill(null),
  }));
  for (const key of ['jobs', 'items', 'zones', 'crops', 'buildings']) colony[key] = [];
  colony.selectedColonistId = null;
  colony.speed = 0;
  sim.load(colony);

  const wait = predicate => play.waitFor(predicate, { read: READ, timeoutMs: 16_000 });
  const advance = seconds => play.advance(seconds, { read: READ, stepSeconds: .05 });
  const capture = async name => assert.equal((await play.screenshot(name)).rendered, true);
  const ready = () => wait(s => s.characters?.residents.length === 17);
  const expected = roles.map((_, i) => i + 1);
  const outfits = state => state.characters.residents.map(p => p.outfit).sort((a, b) => a - b);

  await play.step('17 位新版居民在游戏中各使用自己的模型', async () => {
    await page.evaluate(({ key, save }) => localStorage.setItem(key, JSON.stringify(save)), {
      key: SAVE, save: { version: 2, voxel: world.serialize(), colony: sim.serialize() },
    });
    await play.reload();
    const state = await ready();
    assert.deepEqual(outfits(state), expected);
    for (const actor of state.characters.residents) {
      assert.equal(actor.meshes, 1);
      assert.equal(actor.joints, 22);
    }
    await play.mouse.move([.53, .52]);
    for (let i = 0; i < 3; i++) {
      await page.mouse.wheel(0, -200);
      await advance(.18);
    }
    await capture('all-17-new-villagers');
  });

  const boy = colony.colonists.at(-1);
  await play.step('恢复版小男孩能附身并用原配动画行走', async () => {
    const start = await possessResident(play, boy.id);
    assert.equal(start.characters.player.outfit, 17);
    await play.mouse.move([.63, .46]);
    await page.keyboard.down('KeyW');
    try {
      const state = await advance(.65);
      assert.equal(state.characters.player.walk, 'Walk_Forward');
      assert.ok(state.characters.player.time > 0);
      assert.ok(state.player.z > start.player.z + .5);
      await capture('new-boy-walking');
    } finally {
      await page.keyboard.up('KeyW');
    }
    const stopped = await advance(.25);
    assert.equal(stopped.characters.player.walk, null);
    await page.keyboard.press('KeyR');
    await wait(s => !s.player);
  });

  await play.step('读档后保持新版居民映射', async () => {
    await play.reload();
    assert.deepEqual(outfits(await ready()), expected);
    await capture('new-villagers-after-reload');
  });
}
