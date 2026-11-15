// 锤子应该和普通物品一样能拖。之前它被特殊分支绕过：UI 没挂拖放、引擎也拒收。
const READ = 'voxel.world';

export default async function hammerDrag(play) {
  const advance = (s) => play.advance(s, { read: READ, stepSeconds: 0.05 });
  await advance(1.0);
  // 快捷栏只在角色视角显示
  await play.page.mouse.click(640, 300);
  await play.page.keyboard.press('KeyR');
  await advance(1.0);

  const before = (await play.state(READ)).colony.playerBag;
  const bag = () => play.state(READ).then((s) => s.colony.playerBag);

  // 第一格应该是锤子
  if (before[0]?.resource !== 'hammer') {
    return { error: '第 1 格不是锤子', before: JSON.stringify(before) };
  }

  // 把锤子从第 1 格拖到第 3 格
  const from = await play.page.locator('#hotbar .hotbar-slot[data-index="0"]').boundingBox();
  const to = await play.page.locator('#hotbar .hotbar-slot[data-index="2"]').boundingBox();
  if (!from || !to) return { error: '找不到快捷栏格子' };

  await play.page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await play.page.mouse.down();
  await play.page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 14 });
  await advance(0.3);
  const ghostVisible = await play.page.locator('.drag-ghost').count();
  await play.page.mouse.up();
  await advance(0.6);

  const after = await bag();
  return {
    ghostWhileDragging: ghostVisible,
    before: JSON.stringify(before.slice(0, 4)),
    after: JSON.stringify(after.slice(0, 4)),
    movedToThird: after[2]?.resource === 'hammer',
    firstEmptyNow: !after[0],
  };
}
