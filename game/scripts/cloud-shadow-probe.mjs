import { possessResident } from './select-resident.mjs';
// 云影：玩家视角下能看到贴地的暗斑，并且会随时间漂移。
const READ = 'voxel.world';

export default async function cloudShadow(play) {
  const advance = (s) => play.advance(s, { read: READ, stepSeconds: 0.05 });
  await advance(1.0);
  await possessResident(play);
  await advance(1.2);
  await play.screenshot('cloud-a');

  // 等一会儿再拍一张，比较漂移（人眼看得出来，脚本只能靠截图对比）
  await advance(6);
  await play.screenshot('cloud-b');

  return { view: (await play.state(READ)).camera.mode, note: '两张截图间隔 6 秒，暗斑位置应不同' };
}
