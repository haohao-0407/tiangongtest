// 锤子放进木箱后，木箱面板必须还能正常显示。
// 之前的崩法：排序里 RESOURCE_NAMES['hammer'] 是 undefined，.localeCompare 抛异常，
// 整个 draw() 挂掉，面板只剩一条空条。
const READ = 'voxel.world';

export default async function chestWithHammer(play) {
  const advance = (s) => play.advance(s, { read: READ, stepSeconds: 0.05 });
  await advance(1.0);

  const state = await play.state(READ);
  const chestId = state.colony.chests[0].id;

  // 直接把锤子塞进木箱
  await play.page.evaluate((id) => {
    window.__wbSend?.('inventory', {
      from: { kind: 'player', slot: 0 },
      to: { kind: 'chest', id, slot: 0 },
      resource: 'hammer',
      amount: 1,
    });
  }, chestId);
  await advance(0.8);

  const afterMove = await play.state(READ);
  const chestSlots = afterMove.colony.chests[0].slots;
  const hammerInChest = chestSlots[0]?.resource === 'hammer';

  // 打开木箱面板
  await play.page.evaluate(() => window.__wbOpenChest());
  await advance(0.7);

  const cells = await play.page.locator('#workspace .chest-cell').count();
  const filled = await play.page.locator('#workspace .chest-cell:not(.empty)').count();
  const firstTitle = await play.page.locator('#workspace .chest-cell').first().getAttribute('title');
  await play.screenshot('chest-with-hammer');

  return {
    hammerInChest,
    playerSlot0: JSON.stringify(afterMove.colony.playerBag[0]),
    chestSlot0: JSON.stringify(chestSlots[0]),
    cells,
    filled,
    firstTitle,
  };
}
