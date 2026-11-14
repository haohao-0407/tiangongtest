// 玩家角色 + 双视角验收探针。
// Run from the game root:
//   pnpm exec forgeax project play scripts/dual-view-probe.mjs --require-ui --json
//
// 全部通过真实键盘输入驱动，断言读的是 `voxel.world` 投影里的 camera / player 字段。

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
  const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

  // ---- 1. 开局：俯视视角，玩家站在地面上 ----
  const s0 = await read();
  assert.equal(s0.camera.mode, 'god', '开局应为俯视视角');
  assert.ok(s0.player, '投影里必须有玩家状态');
  assert.equal(s0.player.grounded, true, '开局玩家应站在地面上');
  const godTarget = [...s0.camera.target];
  const spawn = { x: s0.player.x, z: s0.player.z };

  // ---- 2. V 切到玩家视角 ----
  await tapV();
  const s1 = await read();
  assert.equal(s1.camera.mode, 'character', 'V 应切到玩家视角');
  assert.equal(s1.camera.followId, 'player', '玩家视角的跟随目标应是自己');

  // ---- 3. 按 W 前进，玩家应该真的移动 ----
  await play.page.keyboard.down('KeyW');
  await advance(1.2);
  await play.page.keyboard.up('KeyW');
  // 投影最长 0.4 秒才刷新一次，松键后要等一拍再读，否则拿到的是按下时的快照
  await advance(0.6);
  const s2 = await read();
  const walked = flat(s2.player, s1.player);
  assert.ok(walked > 1.5, `按 W 一秒多应走出至少 1.5 米，实测 ${walked.toFixed(2)}`);
  assert.equal(s2.player.moving, false, '松键后 moving 应为 false');

  // ---- 4. 相机应该跟着玩家 ----
  const camToPlayer = flat(
    { x: s2.camera.target[0], z: s2.camera.target[2] },
    s2.player,
  );
  assert.ok(camToPlayer < 2.5, `相机注视点应贴着玩家，实测间距 ${camToPlayer.toFixed(2)}`);

  // ---- 5. 空格跳跃：离地后 y 会升起来 ----
  const groundY = s2.player.y;
  await play.page.keyboard.press('Space');
  await advance(0.18);
  const s3 = await read();
  assert.equal(s3.player.grounded, false, '起跳后应处于离地状态');
  assert.ok(s3.player.y > groundY + 0.15, `起跳后高度应上升，实测 Δ${(s3.player.y - groundY).toFixed(2)}`);

  // ---- 6. 落地 ----
  await advance(1.5);
  const s4 = await read();
  assert.equal(s4.player.grounded, true, '应已落地');

  // ---- 7. V 切回俯视，构图恢复 ----
  await tapV();
  const s5 = await read();
  assert.equal(s5.camera.mode, 'god', 'V 应切回俯视');
  assert.equal(s5.camera.followId, null, '俯视视角不应残留跟随目标');
  const restore = Math.hypot(
    s5.camera.target[0] - godTarget[0],
    s5.camera.target[2] - godTarget[2],
  );
  assert.ok(restore < 0.5, `俯视构图应恢复，实测偏差 ${restore.toFixed(3)}`);

  // ---- 8. 俯视视角下 WASD 走的是相机，不是玩家 ----
  const playerBefore = { x: s5.player.x, z: s5.player.z };
  await play.page.keyboard.down('KeyW');
  await advance(0.8);
  await play.page.keyboard.up('KeyW');
  const s6 = await read();
  const playerDrift = flat(s6.player, playerBefore);
  assert.ok(playerDrift < 0.3, `俯视视角下玩家不该自己走，实测位移 ${playerDrift.toFixed(2)}`);

  // ---- 截图 ----
  await tapV();
  const shot = await play.screenshot('player-view');
  assert.equal(shot.rendered, true, '玩家视角必须是真实渲染像素');

  // ---- 9. 底部指挥官菜单只在俯视视角出现 ----
  const toolbar = play.page.locator('.bottom-area');
  const hiddenInPlayer = await toolbar.isVisible();
  assert.equal(hiddenInPlayer, false, '玩家视角下底部菜单应隐藏');

  await tapV();
  await advance(0.3);
  const shownInGod = await toolbar.isVisible();
  assert.equal(shownInGod, true, '俯视视角下底部菜单应重新出现');

  // ---- 10. 快捷栏只在玩家视角出现 ----
  await tapV();
  const hotbar = play.page.locator('#hotbar');
  assert.equal(await hotbar.isVisible(), true, '玩家视角下快捷栏应可见');
  const slotCount = await play.page.locator('#hotbar .hotbar-slot').count();
  assert.equal(slotCount, 9, `快捷栏应有 9 格，实际 ${slotCount}`);

  // 数字键切选中格（UI 在 Shadow DOM 里，只能用 locator 自带的求值，不能用 page.evaluate）
  await play.page.keyboard.press('Digit4');
  await advance(0.3);
  const activeIndex = await play.page
    .locator('#hotbar .hotbar-slot')
    .evaluateAll((slots) => slots.findIndex((slot) => slot.classList.contains('active')));
  assert.equal(activeIndex, 3, `按 4 应选中第 4 格，实际索引 ${activeIndex}`);

  await tapV();
  await advance(0.3);
  assert.equal(await hotbar.isVisible(), false, '俯视视角下快捷栏应隐藏');

  // ---- 12. ESC 暂停层 ----
  // 开局居民档案是自动打开的，所以 ESC 是分层的：第一次关面板，第二次才弹暂停
  const pauseLayer = play.page.locator('#pause-menu');
  assert.equal(await pauseLayer.isVisible(), false, '开局不该有暂停层');

  await play.page.keyboard.press('Escape');
  await advance(0.4);
  assert.equal(await pauseLayer.isVisible(), false, '第一次 ESC 应先关掉面板，不弹暂停');

  await play.page.keyboard.press('Escape');
  await advance(0.5);
  assert.equal(await pauseLayer.isVisible(), true, '第二次 ESC 应弹出暂停层');
  const paused = await read();
  assert.equal(paused.colony.speed, 0, `暂停时模拟速度应为 0，实际 ${paused.colony.speed}`);
  await play.screenshot('pause-menu');

  await play.page.keyboard.press('Escape');
  await advance(0.5);
  assert.equal(await pauseLayer.isVisible(), false, '再按 ESC 应收起暂停层');
  const resumed = await read();
  assert.ok(resumed.colony.speed > 0, `恢复后速度应大于 0，实际 ${resumed.colony.speed}`);

  // 暂停层里的「设置」复用右上角那块面板
  await play.page.keyboard.press('Escape');
  await advance(0.4);
  await play.page.locator('#pause-settings').click();
  await advance(0.4);
  assert.equal(await play.page.locator('#settings').isVisible(), true, '暂停层「设置」应打开世界与存档面板');
  assert.equal(await pauseLayer.isVisible(), false, '打开设置后暂停层应收起');
  await play.page.locator('#settings-close').click();
  await advance(0.3);

  // ---- 13. 竖排新面板能打开 ----
  for (const [menu, title] of [['warehouse', '仓库'], ['follower', '随从']]) {
    await play.page.locator(`[data-menu="${menu}"]`).click();
    await advance(0.5);
    const visible = await play.page.locator('#workspace').isVisible();
    assert.equal(visible, true, `点「${title}」应打开工作区面板`);
    const heading = (await play.page.locator('#panel-title').textContent()) ?? '';
    assert.ok(heading.length > 0, `「${title}」面板应有标题，实际为空`);
    await play.screenshot(`panel-${menu}`);
    await play.page.locator('[data-menu="inspect"]').click();
    await advance(0.3);
  }

  return {
    spawn,
    walkedMeters: Number(walked.toFixed(2)),
    cameraToPlayer: Number(camToPlayer.toFixed(2)),
    jumpRise: Number((s3.player.y - groundY).toFixed(2)),
    checks: 18,
  };
}
