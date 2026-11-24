import assert from 'node:assert/strict';
import { tsImport } from 'tsx/esm/api';

const { BUILDING_DEFS } = await tsImport('../assets/colony/contracts.ts', import.meta.url);

export default async function buildingIcons(play) {
  const read = 'voxel.world';
  const { page } = play;
  const control = id => page.locator(`[data-testid="${id}"]`);
  const cards = page.locator('#workspace .build-card');
  const capture = async name => assert.ok((await play.screenshot(name)).rendered);
  const openCatalog = async () => {
    await play.waitFor(s => s.colony?.colonists.length > 0, { read });
    await control('menu-build').click();
    await cards.first().waitFor({ state: 'visible' });
  };

  await openCatalog();
  const thumbnails = await cards.evaluateAll(async elements => {
    const positions = new Set();
    const missing = [];
    const atlas = new Image();
    const first = elements[0].querySelector('.building-thumbnail');
    atlas.src = first.style.backgroundImage.slice(5, -2);
    await atlas.decode();
    const tile = 128;
    const canvas = document.createElement('canvas');
    canvas.width = atlas.width;
    canvas.height = atlas.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(atlas, 0, 0);
    for (const card of elements) {
      const icon = card.querySelector('.building-thumbnail');
      if (!icon || icon.style.backgroundImage !== first.style.backgroundImage) {
        missing.push(card.dataset.testid);
        continue;
      }
      const [x, y] = icon.style.backgroundPosition.split(' ').map(parseFloat);
      const column = Math.round(x / 100 * (atlas.width / tile - 1));
      const row = Math.round(y / 100 * (atlas.height / tile - 1));
      const rgba = ctx.getImageData(column * tile, row * tile, tile, tile).data;
      const opaque = rgba.filter((value, i) => i % 4 === 3 && value > 0).length;
      if (opaque < tile * tile * .04 || opaque === tile * tile) missing.push(card.dataset.testid);
      positions.add(`${column},${row}`);
    }
    return { count: positions.size, missing };
  });
  assert.deepEqual(thumbnails, { count: Object.keys(BUILDING_DEFS).length, missing: [] });
  await capture('building-miniatures-core');
  for (const [kind, group] of [['woodWall', 'structure'], ['chest', 'furniture'],
    ['stoneCutter', 'production'], ['sprinkler', 'agriculture']]) {
    await control(`build-${kind}`).scrollIntoViewIfNeeded();
    await capture(`building-miniatures-${group}`);
  }
  const desktop = page.viewportSize();
  await page.setViewportSize({ width: 440, height: 600 });
  await control('build-bed').scrollIntoViewIfNeeded();
  await capture('building-miniatures-compact');
  await page.setViewportSize(desktop);
  await play.reload();
  await openCatalog();
  assert.match(await control('build-bed').locator('.building-thumbnail').evaluate(el => el.style.backgroundImage), /^url/);
  await control('build-bed').click();
  await play.waitFor(s => s.tool === 'build:bed', { read });
  await page.locator('#workspace').waitFor({ state: 'hidden' });
  await page.keyboard.press('Escape');
  await control('build-bed').waitFor({ state: 'visible' });
}
