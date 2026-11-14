// 双视角验收探针。
// Run from the game root:
//   pnpm exec forgeax project play scripts/dual-view-probe.mjs --require-ui --json
//
// 只通过真实键盘输入驱动，不直接改内部状态。
// 断言的依据是 `voxel.world` 投影里的 camera.mode / followId / target。

import assert from 'node:assert/strict';

const READ = 'voxel.world';

/** @param {import('@forgeax/engine/devkit').PlayContext} play */
export default async function dualViewProbe(play) {
  const read = () => play.state(READ);
  const advance = (seconds) => play.advance(seconds, { read: READ, stepSeconds: 0.05 });
  const tapV = async () => {
    await play.page.keyboard.press('KeyV');
    await advance(0.4);
  };
  const horizontal = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);

  // ---- 1. 初始必须是俯视 ----
  const s0 = await read();
  assert.equal(s0.camera.mode, 'god', '开局应为俯视视角');
  const godTarget = [...s0.camera.target];
  const godDistance = s0.camera.distance;

  // ---- 2. V 切到角色视角 ----
  await tapV();
  const s1 = await read();
  assert.equal(s1.camera.mode, 'character', 'V 应切到角色视角');
  assert.ok(s1.camera.followId, '角色视角必须有跟随目标');

  // ---- 3. 镜头要真的贴上那个人 ----
  await advance(2.5);
  const s2 = await read();
  const pawn = s2.colony.colonists.find((p) => p.id === s2.camera.followId);
  assert.ok(pawn, '跟随目标必须还在居民列表里');
  const followGap = horizontal(s2.camera.target, pawn.position);
  assert.ok(followGap < 2.5, `镜头应贴近跟随目标，当前水平间距 ${followGap.toFixed(2)}`);

  // ---- 4. 角色视角下 WASD 不该带着镜头跑 ----
  // 居民自己会走动，所以允许小幅漂移；只要不是"玩家速度"量级就说明 WASD 被挡住了。
  const before = [...s2.camera.target];
  await play.page.keyboard.down('KeyW');
  await advance(1.5);
  await play.page.keyboard.up('KeyW');
  const s3 = await read();
  const drift = horizontal(s3.camera.target, before);
  assert.ok(drift < 8, `角色视角不应响应 WASD 平移，实测位移 ${drift.toFixed(2)}`);

  // ---- 5. V 切回俯视，构图原样恢复 ----
  await tapV();
  const s4 = await read();
  assert.equal(s4.camera.mode, 'god', 'V 应切回俯视视角');
  assert.equal(s4.camera.followId, null, '回到俯视后不应残留跟随目标');
  const restoreGap = horizontal(s4.camera.target, godTarget);
  assert.ok(restoreGap < 0.5, `俯视构图应恢复，实测偏差 ${restoreGap.toFixed(3)}`);
  assert.ok(
    Math.abs(s4.camera.distance - godDistance) < 0.5,
    `俯视距离应恢复，原 ${godDistance.toFixed(1)} / 现 ${s4.camera.distance.toFixed(1)}`,
  );

  // ---- 6. F 在角色视角下应贴回目标而不是回地图中心 ----
  await tapV();
  const s5 = await read();
  assert.equal(s5.camera.mode, 'character', '再次 V 应回到角色视角');
  const targetPawn = s5.colony.colonists.find((p) => p.id === s5.camera.followId);
  await play.page.keyboard.press('KeyF');
  await advance(0.6);
  const s6 = await read();
  const homeGap = horizontal(s6.camera.target, targetPawn.position);
  assert.ok(homeGap < 3, `角色视角按 F 应贴回本人，实测间距 ${homeGap.toFixed(2)}`);

  // ---- 截图存档 ----
  const shot = await play.screenshot('dual-view-character');
  assert.equal(shot.rendered, true, '角色视角画面必须是真实渲染像素');

  return {
    checks: [
      '开局为俯视',
      'V 切入角色视角并设定跟随目标',
      `镜头贴合跟随目标（间距 ${followGap.toFixed(2)}）`,
      `角色视角屏蔽 WASD 平移（位移 ${drift.toFixed(2)}）`,
      `V 切回俯视并恢复构图（偏差 ${restoreGap.toFixed(3)}）`,
      `角色视角 F 贴回本人（间距 ${homeGap.toFixed(2)}）`,
    ],
    followId: s6.camera.followId,
  };
}
