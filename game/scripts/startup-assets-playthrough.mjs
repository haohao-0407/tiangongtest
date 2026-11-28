import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { tsImport } from 'tsx/esm/api';

async function checkDecoded({guids, expected}) {
  const timeline = await globalThis.__forgeaxLoadTimeline.collect({timeoutMs: 1200});
  const decoded = new Set(timeline.realms.flatMap(realm => realm.records
    .filter(r => r.kind === 'decode' && r.detail?.stage === 'asset' && r.detail.ok).map(r => r.name)));
  return guids.every(guid => decoded.has(guid) === expected);
}

async function restoreModels(play) {
  const read = 'voxel.world';
  const { VoxelWorld } = await tsImport('../assets/voxel/model.ts', import.meta.url);
  const { ColonySimulation } = await tsImport('../assets/colony/simulation.ts', import.meta.url);
  const world = new VoxelWorld('模型读档', { width: 48, height: 24, depth: 48 });
  const colony = new ColonySimulation(world).serialize();
  const current = await play.state(read);
  const used = new Set([...current.characters.residents, ...current.characters.merchants].map(actor => actor.outfit));
  const directory = new URL('../assets/models/villagers/', import.meta.url);
  const variants = (await readdir(directory)).filter(file => file.endsWith('.glb.meta.json')).sort();
  const count = variants.length + 1; // The guide's model is in the parent directory.
  const file = variants.find(file => !used.has(Number(file.match(/(\d+)\.glb/)[1])));
  assert.ok(file);
  const outfit = Number(file.match(/(\d+)\.glb/)[1]);
  const assetGuid = async (file, kind, name) => {
    const meta = JSON.parse(await readFile(new URL(file, directory), 'utf8'));
    return meta.subAssets.find(asset => asset.kind === kind && (!name || asset.name === name)).guid;
  };
  const guids = await Promise.all([assetGuid(file, 'scene'),
    assetGuid('../buildings.glb.meta.json', 'mesh', 'medicalBed'),
    assetGuid('../crops/tomato.glb.meta.json', 'mesh', 'tomato-mature')]);
  assert.equal(await play.page.evaluate(checkDecoded, {guids, expected: false}), true);

  const serial = count * Math.ceil((colony.nextId + 2) / count) + outfit - 2;
  const id = 'colonist-' + serial;
  colony.colonists[0].id = id;
  colony.nextId = serial + 1;
  colony.speed = 0;
  colony.buildings.find(b => b.kind === 'bed').kind = 'medicalBed';
  colony.zones.find(z => z.kind === 'farm').crop = 'tomato';
  Object.assign(colony.crops[0], {kind: 'tomato', planted: true, growth: .9});
  const save = JSON.stringify({version: 2, voxel: world.serialize(), colony});
  await play.page.evaluate(data => window.__wbSend('load', {data}), save);
  const restored = await play.waitFor(state => state.colony.speed === 0 &&
    state.characters.residents.some(actor => actor.id === id && actor.outfit === outfit && actor.joints > 0),
    {read, timeoutMs: 30_000});
  assert.equal(restored.characters.residents.length, colony.colonists.length);
  await play.page.waitForFunction(checkDecoded, {guids, expected: true}, {polling: 300, timeout: 30_000});
  assert.equal((await play.screenshot('restored-colony-models')).rendered, true);
  return outfit;
}

export default async function startupAssets(play) {
  const read = 'voxel.world';
  const samples = [];
  const browser = await play.page.context().newCDPSession(play.page);
  await browser.send('Network.enable');
  await browser.send('Network.setCacheDisabled', {cacheDisabled: true});
  await play.page.addInitScript(() => {
    const observer = new MutationObserver(() => {
      if (document.documentElement?.dataset.forgeaxInput !== 'open') return;
      performance.mark('colony-input-open');
      observer.disconnect();
    });
    observer.observe(document, {subtree: true, attributes: true, attributeFilter: ['data-forgeax-input']});
  });
  for (let run = 0; run < 3; run++) {
    await play.reload();
    const initial = await play.waitFor(state => state.colony.colonists.length > 0, {read});
    const speed = initial.colony.speed === 3 ? 1 : 3;
    await play.keyboard.press(speed === 3 ? 'Digit2' : 'Digit1');
    await play.waitFor(state => state.colony.speed === speed, {read});
    const sample = await play.page.evaluate(async () => {
      const timeline = await globalThis.__forgeaxLoadTimeline.collect({timeoutMs: 1200});
      const records = timeline.realms.flatMap(realm => realm.records);
      const hud = records.find(record => record.name === 'colony-hud-ready');
      const input = performance.getEntriesByName('colony-input-open')[0];
      if (!hud || !input) throw new Error('Missing first HUD or input-open milestone');
      const ready = Math.max(hud.end, performance.timeOrigin + input.startTime);
      return {
        hudMs: Math.round(hud.end - timeline.timeOrigin),
        inputMs: Math.round(input.startTime),
        readyMs: Math.round(ready - timeline.timeOrigin),
        decodedBeforeReady: records.filter(record => record.kind === 'decode' && record.end <= ready).length,
      };
    });
    samples.push(sample);
    if (run === 0) {
      await play.mouse.move([.5, .5]);
      for (let step = 0; step < 4; step++) {
        await play.page.mouse.wheel(0, -300);
        await play.advance(.12, {read});
      }
      assert.equal((await play.screenshot('playable-colony')).rendered, true);
    }
  }
  const restoredOutfit = await play.step('暂停存档按需恢复居民、医护床和成熟番茄', () => restoreModels(play));
  return { samples, restoredOutfit };
}
