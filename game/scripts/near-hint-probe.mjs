// 开局就够得着箱子：切进角色视角，提示必须自己冒出来。
const READ = 'voxel.world';

export default async function nearHint(play) {
  const advance = (s) => play.advance(s, { read: READ, stepSeconds: 0.05 });
  await advance(0.8);

  const beforeView = (await play.state(READ)).player.nearHint;
  await play.page.keyboard.press('KeyR');
  await advance(1.0);

  const st = (await play.state(READ)).player;
  const dist = Math.abs(Math.floor(st.x) - st.chest[0]) + Math.abs(Math.floor(st.z) - st.chest[2]);
  const visible = await play.page.locator('#interact-hint').isVisible();
  const label = (await play.page.locator('#interact-hint').textContent()) ?? '';
  await play.screenshot('near-hint-on');

  return { beforeView, dist, nearHint: st.nearHint, visible, label: label.trim() };
}
