import { possessResident } from './select-resident.mjs';
// 开局就够得着箱子：切进角色视角，提示必须自己冒出来。
const READ = 'voxel.world';

export default async function nearHint(play) {
  const advance = (s) => play.advance(s, { read: READ, stepSeconds: 0.05 });
  await advance(0.8);

  const beforeView = (await play.state(READ)).player?.nearHint??null;
  await possessResident(play);
  await advance(1.0);

  const st = (await play.state(READ)).player;
  // 实际中心距：木箱画在格子中心，判定也是按这个半径来的
  const dist = Number(Math.hypot(st.x - (st.chest[0] + 0.5), st.z - (st.chest[2] + 0.5)).toFixed(2));
  const visible = await play.page.locator('#interact-hint').isVisible();
  const label = (await play.page.locator('#interact-hint').textContent()) ?? '';
  await play.screenshot('near-hint-on');

  // 往左走三步，应该出圈、提示消失
  await play.page.keyboard.down('KeyA');
  await advance(1.4);
  await play.page.keyboard.up('KeyA');
  await advance(0.4);
  const far = (await play.state(READ)).player;
  const farDist = Number(Math.hypot(far.x - (far.chest[0] + 0.5), far.z - (far.chest[2] + 0.5)).toFixed(2));
  const farHint = far.nearHint;
  const farVisible = await play.page.locator('#interact-hint').isVisible();

  return {
    near: { dist, nearHint: st.nearHint, visible, label: label.trim() },
    far: { dist: farDist, nearHint: farHint, visible: farVisible },
    beforeView,
  };
}
