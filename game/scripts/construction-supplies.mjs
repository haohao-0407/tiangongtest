const SAVE = 'homestead.colony.v2';

export async function stockConstructionFixture(play, resources) {
  await play.page.waitForFunction(key => {
    const save = JSON.parse(localStorage.getItem(key));
    return save?.colony?.speed === 0 && save.colony.resources;
  }, SAVE, { timeout: 12_000 });
  await play.page.evaluate(({ key, resources }) => {
    const save = JSON.parse(localStorage.getItem(key));
    Object.assign(save.colony.resources, resources);
    localStorage.setItem(key, JSON.stringify(save));
  }, { key: SAVE, resources });
  await play.reload();
  await play.waitFor(state => Object.entries(resources).every(([id, count]) => state.colony?.resources[id] === count),
    { read: 'voxel.world', timeoutMs: 12_000 });
}
