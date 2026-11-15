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
  const tapR = async () => {
    await play.page.keyboard.press('KeyR');
    await advance(0.4);
  };
  const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  const hotbarSlot = (slot) => play.page.locator(`#hotbar .hotbar-slot[data-index="${slot}"]`);
  const chestSlot = (slot) => play.page.locator(`.chest-cell[data-index="${slot}"]`);
  const followerSlot = play.page.locator('.fb-cell[data-index="0"]');
  const slider = play.page.locator('#item-amount');
  const getItem = play.page.locator('#item-menu [data-item-action="take"]');
  const chooseQuantity = async (amount) => {
    if (amount > 1) {
      await slider.press('Home');
      for (let value = 1; value < amount; value++) await slider.press('ArrowRight');
    }
    assert.equal(await slider.inputValue(), String(amount));
  };
  const pauseColony = async () => {
    await play.page.locator('[data-menu="sandbox"]').click();
    await play.page.locator('[data-menu="inspect"]').click();
    await advance(0.4);
    assert.equal((await read()).colony.speed, 0);
  };
  const resumeColony = async () => {
    const close = play.page.locator('#panel-close');
    if (await close.isVisible()) await close.click();
    await play.page.keyboard.press('Escape');
    await advance(0.35);
    assert.ok(await play.page.locator('#pause-menu').isVisible());
    await play.page.keyboard.press('Escape');
    await advance(0.4);
    assert.equal((await read()).colony.speed, 1);
  };
  const waitDelivery = async (id, observe = () => {}) => {
    let current = await read();
    for (let i = 0; i < 64; i++) {
      const order = current.colony.jobs.find(job => job.id === id);
      if (!order) return current;
      observe(order, current);
      current = await advance(0.75);
    }
    assert.fail(`随从未完成配送，当前状态：${JSON.stringify(current.colony.jobs.find(job => job.id === id))}`);
  };
  const drag = async (source, target) => {
    const from = await source.boundingBox(), to = await target.boundingBox();
    assert.ok(from && to, '拖放两端必须在屏幕上');
    await play.page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await play.page.mouse.down();
    await play.page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
    await play.page.mouse.up();
    await advance(0.6);
    return read();
  };

  // ---- 1. 开局：俯视视角，玩家站在地面上 ----
  const s0 = await read();
  assert.equal(s0.camera.mode, 'god', '开局应为俯视视角');
  assert.ok(s0.player, '投影里必须有玩家状态');
  assert.equal(s0.player.grounded, true, '开局玩家应站在地面上');
  const godTarget = [...s0.camera.target];
  const spawn = { x: s0.player.x, z: s0.player.z };

  // ---- 2. R 切到玩家视角 ----
  await tapR();
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

  // ---- 4b. 鼠标停在 HUD 上不该冻住角色 ----
  // 快捷栏在屏幕底部居中，把指针挪上去模拟"边走边划到 HUD"
  const beforeHover = { x: s2.player.x, z: s2.player.z };
  await play.page.mouse.move(640, 688);
  await advance(0.4);
  await play.page.keyboard.down('KeyW');
  await advance(1.0);
  await play.page.keyboard.up('KeyW');
  await advance(0.5);
  const sHover = await read();
  const movedWhileHover = flat(sHover.player, beforeHover);
  assert.ok(
    movedWhileHover > 1.0,
    `鼠标停在快捷栏上时角色仍应能走，实测位移 ${movedWhileHover.toFixed(2)}`,
  );
  // 挪回画面中央，避免影响后续步骤
  await play.page.mouse.move(640, 300);
  await advance(0.3);

  // ---- 4c. 走一圈不该嵌进方块 ----
  // 朝四个方向各走一段，每段结束检查是否被塞进实心方块
  const dirs = ['KeyW', 'KeyA', 'KeyS', 'KeyD'];
  const embeddedAt = [];
  for (const dir of dirs) {
    await play.page.keyboard.down(dir);
    await advance(0.8);
    await play.page.keyboard.up(dir);
    await advance(0.4);
    const st = await read();
    if (st.player.embedded) embeddedAt.push(dir);
  }
  assert.deepEqual(embeddedAt, [], `走完四个方向后不该嵌进方块，出问题的方向: ${embeddedAt.join(',') || '无'}`);

  // ---- 4d. 斜向走也不该穿模 ----
  // 同时按两个方向键，走的是对角；旧实现只探轴对齐四向，这里最容易漏
  const diagonals = [['KeyW', 'KeyD'], ['KeyS', 'KeyA'], ['KeyW', 'KeyA'], ['KeyS', 'KeyD']];
  const diagonalEmbedded = [];
  for (const [a, b] of diagonals) {
    await play.page.keyboard.down(a);
    await play.page.keyboard.down(b);
    await advance(0.9);
    await play.page.keyboard.up(a);
    await play.page.keyboard.up(b);
    await advance(0.4);
    const st = await read();
    if (st.player.embedded) diagonalEmbedded.push(`${a}+${b}`);
  }
  assert.deepEqual(diagonalEmbedded, [], `斜向走不该穿模，出问题的方向: ${diagonalEmbedded.join(',') || '无'}`);

  // ---- 4e. 转向是平滑的，不是瞬移 ----
  // 停下后朝向应该稳定不动
  await advance(0.4);
  const facingIdle1 = (await read()).player.facing;
  await advance(0.6);
  const facingIdle2 = (await read()).player.facing;
  assert.ok(
    Math.abs(facingIdle2 - facingIdle1) < 0.02,
    `停下时朝向不该自己变，实测变化 ${Math.abs(facingIdle2 - facingIdle1).toFixed(3)}`,
  );

  // 换个方向起步，朝向应该跟着变过来
  await play.page.keyboard.down('KeyA');
  await advance(1.2);
  await play.page.keyboard.up('KeyA');
  await advance(0.5);
  const facingEnd = (await read()).player.facing;

  const totalTurn = Math.abs(((facingEnd - facingIdle2 + Math.PI) % (Math.PI * 2)) - Math.PI);
  assert.ok(totalTurn > 0.4, `转身幅度应该够明显，实测 ${totalTurn.toFixed(2)} 弧度`);

  // ---- 5. 空格跳跃：离地后 y 会升起来，且不消耗体力 ----
  const groundY = s2.player.y;
  const staminaBeforeJump = s2.player.vitals?.stamina ?? 0;
  await play.page.keyboard.press('Space');
  await advance(0.18);
  const s3 = await read();
  assert.equal(s3.player.grounded, false, '起跳后应处于离地状态');
  // 跳跃不扣体力：只允许因为「站着回体力」而略微变多，不许变少
  const staminaAfterJump = s3.player.vitals?.stamina ?? 0;
  assert.ok(
    staminaAfterJump >= staminaBeforeJump - 0.01,
    `跳跃不该扣体力，跳前 ${staminaBeforeJump.toFixed(1)} → 跳后 ${staminaAfterJump.toFixed(1)}`,
  );
  assert.ok(s3.player.y > groundY + 0.15, `起跳后高度应上升，实测 Δ${(s3.player.y - groundY).toFixed(2)}`);
  // 玩家模型必须始终只有一套（曾经落地/起跳来回切换导致叠出两套人）
  assert.equal(s3.player.parts, 11, `空中时玩家部件数应为 11，实际 ${s3.player.parts}`);

  // ---- 6. 落地 ----
  await advance(1.5);
  const s4 = await read();
  assert.equal(s4.player.grounded, true, '应已落地');
  assert.equal(s4.player.parts, 11, `落地后玩家部件数仍应是 11，实际 ${s4.player.parts}`);

  // ---- 7. R 切回俯视，构图恢复 ----
  await tapR();
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
  await tapR();
  const shot = await play.screenshot('player-view');
  assert.equal(shot.rendered, true, '玩家视角必须是真实渲染像素');

  // 转个方向再拍一张，用来人工核对「整个身子跟着转」
  await play.page.keyboard.down('KeyA');
  await advance(1.2);
  await play.page.keyboard.up('KeyA');
  await advance(0.5);
  await play.screenshot('player-turned');

  // ---- 9. 底部指挥官菜单只在俯视视角出现 ----
  const toolbar = play.page.locator('.bottom-area');
  const hiddenInPlayer = await toolbar.isVisible();
  assert.equal(hiddenInPlayer, false, '玩家视角下底部菜单应隐藏');

  await tapR();
  await advance(0.3);
  const shownInGod = await toolbar.isVisible();
  assert.equal(shownInGod, true, '俯视视角下底部菜单应重新出现');

  // ---- 10. 快捷栏只在玩家视角出现 ----
  await tapR();
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

  await tapR();
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

  // 暂停 → 设置 是独立的一页，不是右上角那个「世界与存档」
  await play.page.keyboard.press('Escape');
  await advance(0.4);
  assert.equal(await pauseLayer.isVisible(), true, '再次 ESC 应弹暂停层');
  await play.page.locator('#pause-settings').click();
  await advance(0.4);
  const optionsLayer = play.page.locator('#game-options');
  assert.equal(await optionsLayer.isVisible(), true, '「设置」应打开独立设置页');
  assert.equal(await play.page.locator('#settings').isVisible(), false, '不该串到世界与存档');
  await play.screenshot('pause-options');

  // 三个控件都在
  assert.equal(await play.page.locator('#opt-invert-x').count(), 1, '应有「反转水平拖动」');
  assert.equal(await play.page.locator('#opt-invert-y').count(), 1, '应有「反转垂直拖动」');
  assert.equal(await play.page.locator('#opt-sensitivity').count(), 1, '应有「拖拽灵敏度」');

  // ESC 分层：设置页 -> 暂停层 -> 恢复游戏，一次退一级
  await play.page.keyboard.press('Escape');
  await advance(0.4);
  assert.equal(await optionsLayer.isVisible(), false, 'ESC 应先关掉设置页');
  assert.equal(await pauseLayer.isVisible(), true, '关掉设置页后应停在暂停层，而不是直接恢复游戏');

  await play.page.keyboard.press('Escape');
  await advance(0.4);
  assert.equal(await pauseLayer.isVisible(), false, '再按一次 ESC 才收起暂停层');

  // ---- 13. 右键不该弹出浏览器菜单 ----
  // 直接派发 contextmenu 到 canvas，检查是否被 preventDefault
  const menuBlocked = await play.page.locator('canvas').evaluateAll((els) => {
    const el = els[0];
    if (!el) return null;
    const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    el.dispatchEvent(ev);
    return ev.defaultPrevented;
  });
  assert.equal(menuBlocked, true, 'canvas 上的右键菜单应被拦截');

  // ---- 15. 上帝视角右键拖动平移镜头 ----
  const camBefore = (await read()).camera.target;
  await play.page.mouse.move(640, 340);
  await play.page.mouse.down({ button: 'right' });
  for (let i = 1; i <= 8; i++) {
    await play.page.mouse.move(640 + i * 18, 340 + i * 8);
    await advance(0.05);
  }
  await play.page.mouse.up({ button: 'right' });
  await advance(0.5);
  const camAfter = (await read()).camera.target;

  const panDist = Math.hypot(camAfter[0] - camBefore[0], camAfter[2] - camBefore[2]);
  assert.ok(panDist > 1.0, `右键拖动应平移镜头，实测位移 ${panDist.toFixed(2)}`);

  // ---- 16. 竖排面板能打开 ----
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

  // ---- 17. 仓库是格子面板，搜索/排序/分类都能用 ----
  // 沙盒入口会暂停居民。回到查看后，移动和物品交互仍可正常操作。
  await pauseColony();
  await play.page.locator('[data-menu="warehouse"]').click();
  await advance(0.5);
  const cells = await play.page.locator('#workspace .wh-cell').count();
  assert.ok(cells >= 28, `仓库应铺满格子，实际 ${cells} 个`);
  assert.equal(await play.page.locator('#workspace .wh-search').count(), 1, '仓库应有搜索框');
  assert.equal(await play.page.locator('#workspace .wh-order').count(), 1, '仓库应有升降序按钮');
  assert.equal(await play.page.locator('#workspace .wh-cat-trigger').count(), 1, '仓库应有分类下拉');

  // 搜索过滤：输入「木」应该只剩木材一类
  // 面板打开后点里面的控件、打字，都不该把面板关掉
  assert.equal(await play.page.locator('#workspace').isVisible(), true, '仓库打开后应保持显示');
  await play.page.locator('#workspace .wh-search').click();
  await advance(0.3);
  assert.equal(await play.page.locator('#workspace').isVisible(), true, '点搜索框不该关面板');
  await play.page.locator('#workspace .wh-search').fill('木');
  await advance(0.4);
  const filtered = await play.page.locator('#workspace .wh-cell:not(.empty)').count();
  assert.equal(filtered, 1, `搜索「木」应只剩 1 项，实际 ${filtered}`);

  // 升降序切换
  const orderBefore = (await play.page.locator('#workspace .wh-order').textContent()) ?? '';
  await play.page.locator('#workspace .wh-order').click();
  await advance(0.3);
  const orderAfter = (await play.page.locator('#workspace .wh-order').textContent()) ?? '';
  assert.notEqual(orderBefore, orderAfter, '点升降序按钮文案应切换');

  // 分类下拉：先清掉搜索词，再切到「方块」——应该只剩建材那几类
  // ---- 物品右键菜单 ----
  const itemMenu = play.page.locator('#item-menu');
  await play.page.locator('#workspace .wh-search').fill('');
  await advance(0.3);
  assert.equal(await itemMenu.isVisible(), false, '平时不该显示物品菜单');

  await play.page.locator('#workspace .wh-cell[data-item]').first().click({ button: 'right' });
  await advance(0.4);
  assert.equal(await itemMenu.isVisible(), true, '右键格子应弹出物品菜单');
  assert.equal(await play.page.locator('#item-menu [data-item-action="select"]').count(), 1, '菜单应有「选中」');
  assert.equal(await play.page.locator('#item-menu [data-item-action="take"]').count(), 1, '菜单应有「获取」');
  assert.equal(await play.page.locator('#item-menu [data-item-action="focus"]').count(), 1, '菜单应有「聚焦」');
  assert.equal(await itemMenu.locator('button').first().getAttribute('data-item-action'), 'take');
  await chooseQuantity(3);
  await play.screenshot('item-menu');

  // 暂停状态下精确核对仓库扣账。
  const poolBefore = (await read()).colony.resources;
  const takenResource = await play.page.locator('#workspace .wh-cell[data-item]').first().getAttribute('data-item');
  await getItem.click();
  await advance(0.6);
  const requested = await read();
  assert.equal(requested.colony.resources[takenResource], poolBefore[takenResource] - 3, '仓库应锁定滑条选择的数量');
  assert.ok(requested.player.bag.slice(1).every(stack => stack === null), '下单不应直接把物品放进快捷栏');
  const order = requested.colony.jobs.find(job => job.targetId === 'player-delivery');
  assert.ok(order && order.deliveryPhase === 'pickup' && order.reserved[takenResource] === 3);
  await play.screenshot('inventory-delivery-queued');
  await resumeColony();
  let sawCarrier = false;
  const delivered = await waitDelivery(order.id, (job, current) => {
    if (job.deliveryPhase === 'deliver') {
      assert.ok(current.colony.colonists.some(person => person.id === job.assignedTo));
      assert.ok(current.player.bag.slice(1).every(stack => stack === null));
      sawCarrier = true;
    }
  });
  assert.ok(sawCarrier, '应看见居民从储藏区取货后、送到玩家前的状态');
  assert.deepEqual(delivered.player.bag.slice(1).filter(Boolean), [{ resource: takenResource, count: 3 }]);
  await play.screenshot('inventory-delivery-arrived');
  await pauseColony();
  await play.page.locator('[data-menu="warehouse"]').click();
  await advance(0.4);

  // 选中：格子要留下高亮
  await play.page.locator('#workspace .wh-cell[data-item]').first().click({ button: 'right' });
  await advance(0.4);
  await play.page.locator('#item-menu [data-item-action="select"]').click();
  await advance(0.5);
  assert.equal(await itemMenu.isVisible(), false, '选完应收起菜单');
  assert.equal(await play.page.locator('#workspace .wh-cell.selected').count(), 1, '选中后应有一个格子高亮');

  await play.page.locator('#workspace .wh-search').fill('');
  await advance(0.3);
  await play.page.locator('#workspace .wh-cat-trigger').click();
  await advance(0.3);
  assert.equal(await play.page.locator('#workspace .wh-cat-menu').isVisible(), true, '点分类应展开下拉');
  await play.screenshot('warehouse-dropdown');
  // 展开后要一直挂着。之前面板的刷新戳里带了游戏时间，
  // 每秒变一次就把整个内容重建，展开的下拉跟着被销毁——看着像「自己关了」。
  await advance(2.5);
  assert.equal(
    await play.page.locator('#workspace .wh-cat-menu').isVisible(),
    true,
    '下拉展开两秒半后仍应保持展开',
  );
  await play.page.locator('#workspace .wh-cat-option[data-cat="block"]').click();
  await advance(0.4);
  assert.equal(await play.page.locator('#workspace .wh-cat-menu').isVisible(), false, '选完应自动收起');
  const blocks = await play.page.locator('#workspace .wh-cell:not(.empty)').count();
  assert.equal(blocks, 3, `「方块」分类应只剩 3 项，实际 ${blocks}`);
  await play.page.locator('#workspace .wh-cat-trigger').click();
  await advance(0.3);
  await play.page.locator('#workspace .wh-cat-option[data-cat="all"]').click();
  await advance(0.3);

  await advance(0.3);
  await play.screenshot('warehouse-grid');
  await play.page.locator('[data-menu="inspect"]').click();
  await advance(0.3);

  // 切到玩家视角：快捷栏应该显示刚才拿到手上的那件东西。
  // 先把可能挡着的浮层都关掉——暂停层是全屏的，开着会吃掉键盘事件，
  // 表现出来就是「没按 R」。
  for (let i = 0; i < 3; i++) {
    const blocking = (await play.page.locator('#game-options').isVisible())
      || (await play.page.locator('#pause-menu').isVisible());
    if (!blocking) break;
    await play.page.keyboard.press('Escape');
    await advance(0.35);
  }
  // 点一下画布把焦点从按钮上拿回来，再按 R
  await play.page.mouse.click(640, 300);
  await advance(0.3);
  await tapR();
  await advance(0.5);
  assert.equal((await read()).camera.mode, 'character', '按 R 应切到玩家视角');
  const hotbarSlots = await play.page.locator('#hotbar .hotbar-slot:not(.empty)').count();
  assert.ok(hotbarSlots >= 1, `玩家视角快捷栏应显示背包内容，实际 ${hotbarSlots} 格有东西`);
  const hotbarState = await read();
  const bagNow = hotbarState.player.bag ?? [];
  const selNow = hotbarState.player.bagSelected ?? 0;
  const selectedName = (await play.page.locator('#hotbar-name').textContent()) ?? '';
  assert.ok(
    bagNow[selNow],
    `选中格 ${selNow} 应该有东西；背包现状 ${JSON.stringify(bagNow.filter(Boolean))}，标题「${selectedName}」`,
  );
  // 右上角三条：血量 / 体力 / 金币
  assert.equal(await play.page.locator('#vitals').isVisible(), true, '玩家视角应显示血量 HUD');
  assert.equal(await play.page.locator('#vital-health').count(), 1, '应有血条');
  assert.equal(await play.page.locator('#vital-stamina').count(), 1, '应有体力条');
  const goldText = (await play.page.locator('#vital-gold').textContent()) ?? '';
  assert.ok(/^\d+$/.test(goldText.trim()), `金币应显示数字，实际「${goldText}」`);
  await play.screenshot('hotbar-bag');

  // ---- 木箱：位置在投影里，面板能打开 ----
  const chestState = await read();
  assert.ok(Array.isArray(chestState.player.chest), `投影里应有木箱位置，实际 ${JSON.stringify(chestState.player.chest)}`);

  await play.page.evaluate(() => window.__wbOpenChest());
  await advance(0.6);
  assert.equal(await play.page.locator('#workspace').isVisible(), true, '木箱面板应打开');
  assert.equal(await play.page.locator('#workspace .chest-grid').count(), 1, '木箱应渲染成格子');
  const chestCells = await play.page.locator('#workspace .chest-cell').count();
  assert.equal(chestCells, 20, `木箱应是 5×4 二十格，实际 ${chestCells}`);
  assert.equal(await play.page.locator('#workspace .chest-cell:not(.empty)').count(), 0, '初始箱独立于仓库，应该为空');
  const starterId = chestState.colony.chests[0].id;
  const starter = (s) => s.colony.chests.find(chest => chest.id === starterId);
  const item = chestState.player.bag[selNow];
  let inventoryState = await drag(hotbarSlot(selNow), chestSlot(3));
  // 箱格可能已经有同种物品，拖过去是叠加，不是替换
  const landed = starter(inventoryState).slots[3];
  assert.equal(landed?.resource, item.resource, '整叠物品应进入指向的箱格');
  assert.ok((landed?.count ?? 0) >= item.count, `箱格数量应不少于拖入的 ${item.count}，实际 ${landed?.count}`);
  assert.equal(inventoryState.player.bag[selNow], null);
  assert.deepEqual(inventoryState.colony.resources, chestState.colony.resources, '木箱转移不得改变仓库');
  await play.screenshot('inventory-hotbar-to-chest');
  // 分类和仓库用同一个下拉组件
  assert.equal(await play.page.locator('#workspace .chest-grid ~ * .wh-cat-trigger').count() + await play.page.locator('#workspace .wh-cat-trigger').count() > 0, true, '木箱应有分类下拉');
  await play.page.locator('#workspace .wh-cat-trigger').click();
  await advance(0.3);
  assert.equal(await play.page.locator('#workspace .wh-cat-menu').isVisible(), true, '木箱分类应能展开');
  await play.page.locator('#workspace .wh-cat-option[data-cat="block"]').click();
  await advance(0.4);
  const chestFiltered = await play.page.locator('#workspace .chest-cell:not(.empty)').count();
  assert.equal(chestFiltered, ['wood', 'stone', 'steel'].includes(item.resource) ? 1 : 0);
  await play.page.locator('#workspace .wh-cat-trigger').click();
  await advance(0.3);
  await play.page.locator('#workspace .wh-cat-option[data-cat="all"]').click();
  await advance(0.3);
  await play.screenshot('chest-panel');

  // 木箱格子右键也能弹物品菜单。
  await play.page.locator('#workspace .chest-cell[data-item]').first().click({ button: 'right' });
  await advance(0.4);
  assert.equal(await itemMenu.isVisible(), true, '木箱格子右键应弹物品菜单');
  // 木箱里那格的数量：物品是从背包整叠拖过来的，滑条上限应该等于它
  const boxSlotCount = Number(await play.page.locator('#workspace .chest-cell[data-item]').first()
    .evaluate((el) => el.querySelector('.wh-count')?.textContent ?? '1'));
  // 上限取「格子里的数量」和「背包剩余空间」的较小值——背包放不下时可以是 0
  const sliderMax = Number(await slider.getAttribute('max'));
  assert.ok(sliderMax <= boxSlotCount, `滑条上限不该超过格子数量，上限 ${sliderMax} / 格内 ${boxSlotCount}`);
  if (sliderMax > 0) await chooseQuantity(Math.min(2, sliderMax));
  await play.screenshot('inventory-chest-quantity');
  await getItem.click();
  await advance(0.5);
  // 取回多少个取决于滑条上限（可能受背包空间限制），只核对方向：箱子少了、背包多了
  const boxAfter = starter(await read()).slots[3]?.count ?? 0;
  const bagAfter = (await read()).player.bag.filter(Boolean);
  assert.ok(boxAfter <= boxSlotCount, `木箱那格不该变多，实际 ${boxAfter}`);
  assert.ok(bagAfter.some(stack => stack.resource === item.resource), '背包里应出现取回的物品');
  assert.equal(await play.page.locator('#hotbar').isVisible(), true, '打开面板时快捷栏应可见');
  await drag(chestSlot(3), hotbarSlot(1));
  inventoryState = await drag(hotbarSlot(1), hotbarSlot(6));
  assert.deepEqual(inventoryState.player.bag[6], item, '取回的整叠物品应进入指定快捷栏格');
  assert.equal(starter(inventoryState).slots[3], null);
  await play.screenshot('inventory-chest-to-hotbar');

  await play.page.locator('#panel-close').click();
  await play.page.mouse.click(640, 300);
  await tapR();

  // ---- 随从页：玩家单独一块，和随从列表分开 ----
  await play.page.locator('[data-menu="follower"]').click();
  await advance(0.5);
  assert.equal(await play.page.locator('#workspace .self-card').count(), 1, '随从页顶部应有玩家卡片');
  assert.ok(
    ((await play.page.locator('#workspace .self-tag').textContent()) ?? '').includes('玩家'),
    '玩家卡片应带「玩家」标签',
  );
  const followerRows = await play.page.locator('#workspace .row-list .production-row').count();
  assert.ok(followerRows >= 3, `下面应该是随从列表，实际 ${followerRows} 行`);
  await play.screenshot('follower-list');
  await play.page.locator('[data-menu="inspect"]').click();
  await advance(0.3);

  // ---- 随从面板：靠近右键打开，左数值右背包 ----
  // 顺带确认「靠近谁」这个判定跑通了（角色视角下才有值）
  assert.ok('nearColonist' in (await read()).player, '投影里应有 nearColonist 字段');
  assert.ok('nearHint' in (await read()).player, '投影里应有 nearHint 字段（靠近提示用）');
  assert.equal(await play.page.locator('#interact-hint').count(), 1, '应有靠近提示条');
  // 提示要跟着距离走：站在箱子旁边就必须出，走远了就必须收
  const hintState = await read();
  const chestCell = hintState.player.chest;
  const distToChest = Math.abs(Math.floor(hintState.player.x) - chestCell[0])
    + Math.abs(Math.floor(hintState.player.z) - chestCell[2]);
  const hintVisible = await play.page.locator('#interact-hint').isVisible();
  if (distToChest <= 1) {
    assert.equal(hintState.player.nearHint, 'chest', `贴着箱子时提示类型应为 chest，实际 ${hintState.player.nearHint}`);
    assert.equal(hintVisible, true, `距离 ${distToChest} 格时应显示提示`);
    await play.screenshot('near-hint');
  } else {
    assert.equal(hintState.player.nearHint, null, `距离 ${distToChest} 格时不该有提示`);
    assert.equal(hintVisible, false, `距离 ${distToChest} 格时提示应隐藏`);
  }
  await play.page.mouse.click(640, 300);
  await tapR();
  assert.equal((await read()).camera.mode, 'character');
  const cid = (await read()).colony.colonists[0].id;
  await play.page.evaluate((id) => window.__wbOpenFollower(id), cid);
  await advance(0.6);
  assert.equal(await play.page.locator('#workspace').isVisible(), true, '随从面板应打开');
  assert.equal(await play.page.locator('#workspace .fb-bar.health').count(), 1, '应有血条');
  assert.equal(await play.page.locator('#workspace .fb-bar.stamina').count(), 1, '应有体力条');
  const fbCells = await play.page.locator('#workspace .fb-cell').count();
  assert.equal(fbCells, 9, `随从背包应是九格，实际 ${fbCells}`);
  const fbText = (await play.page.locator('#workspace .fb-wrap').textContent()) ?? '';
  assert.ok(fbText.includes('状态'), '应显示状态');
  assert.ok(fbText.includes('任务'), '应显示任务');
  await play.screenshot('follower-panel');
  const follower = (s) => s.colony.colonists.find(person => person.id === cid);
  inventoryState = await drag(hotbarSlot(6), followerSlot);
  assert.equal(inventoryState.player.bag[6], null);
  assert.deepEqual(follower(inventoryState).bag[0], item, '物品应进入指定随从的随身背包');
  assert.ok(inventoryState.colony.colonists.filter(person => person.id !== cid).every(person => person.bag[0] === null));
  await play.screenshot('inventory-hotbar-to-follower');
  await followerSlot.click({ button: 'right' });
  const followerCountBefore = follower(await read()).bag[0]?.count ?? 0;
  await play.screenshot('inventory-follower-quantity');
  await getItem.click();
  await advance(0.5);
  // 同上：数量取决于背包空间，只验方向
  assert.ok((follower(await read()).bag[0]?.count ?? 0) <= followerCountBefore,
    `随从背包不该变多，实际 ${follower(await read()).bag[0]?.count}`);
  assert.ok((await read()).player.bag.filter(Boolean).some(stack => stack.resource === item.resource),
    '背包里应出现从随从取回的物品');
  await drag(followerSlot, hotbarSlot(1));
  inventoryState = await drag(hotbarSlot(1), hotbarSlot(7));
  assert.deepEqual(inventoryState.player.bag[7], item);
  assert.equal(follower(inventoryState).bag[0], null);
  await play.screenshot('inventory-follower-to-hotbar');

  // 同时给随从、木箱和玩家留下物品，验证存档及浏览器重载。
  inventoryState = await drag(hotbarSlot(7), followerSlot);
  await play.page.locator('#panel-close').click();
  await play.page.mouse.click(640, 300);
  await tapR();
  assert.equal((await read()).camera.mode, 'god');
  await play.page.locator('[data-menu="warehouse"]').click();
  const orderFromWarehouse = async (resource) => {
    await play.page.locator(`#workspace .wh-cell[data-item="${resource}"]`).click({ button: 'right' });
    await getItem.click();
    await advance(0.6);
  };
  await orderFromWarehouse('wood');
  await orderFromWarehouse('stone');
  const remainingOrders = (await read()).colony.jobs.filter(job => job.targetId === 'player-delivery');
  assert.equal(remainingOrders.length, 2);
  await resumeColony();
  for (const queued of remainingOrders) await waitDelivery(queued.id);
  await pauseColony();
  inventoryState = await read();
  const woodSlot = inventoryState.player.bag.findIndex(stack => stack?.resource === 'wood');
  const stoneSlot = inventoryState.player.bag.findIndex(stack => stack?.resource === 'stone');
  await play.page.evaluate(() => window.__wbOpenChest());
  await advance(0.5);
  inventoryState = await drag(hotbarSlot(woodSlot), chestSlot(4));
  assert.deepEqual(starter(inventoryState).slots[4], { resource: 'wood', count: 1 });
  assert.deepEqual(inventoryState.player.bag[stoneSlot], { resource: 'stone', count: 1 });

  await play.page.locator('[data-menu="build"]').click();
  await play.page.locator('[data-testid="build-chest"]').click();
  await play.page.locator('#panel-close').click();
  await advance(0.4);
  assert.equal((await read()).tool, 'place-chest');
  const beforeBuild = await read();
  let placed;
  for (const [x, y] of [[640, 360], [660, 360], [620, 360], [660, 375], [620, 375], [670, 310]]) {
    await play.page.mouse.click(x, y);
    await advance(0.45);
    placed = await read();
    if (placed.colony.chests.length === 2) break;
  }
  assert.equal(placed.colony.chests.length, 2, `应能通过建造菜单放置第二个木箱，实际状态 ${placed.status}`);
  const second = placed.colony.chests.find(chest => chest.id !== starterId);
  assert.ok(second.slots.every(stack => stack === null), '新木箱必须从空箱开始');
  assert.deepEqual(starter(placed).slots[4], { resource: 'wood', count: 1 }, '放置另一个木箱不改变旧箱库存');
  assert.equal(placed.colony.resources.wood, beforeBuild.colony.resources.wood - 4);
  await play.screenshot('inventory-independent-chests');

  await play.page.waitForFunction((id) => {
    const stored = JSON.parse(localStorage.getItem('homestead.colony.v2') ?? 'null');
    return stored?.colony.chests.some(chest => chest.id === id);
  }, second.id, { timeout: 8500 });
  await play.reload();
  const restored = await play.waitFor(s => s.colony?.chests.length === 2 && s.colony.speed === 0, { read: READ, timeoutMs: 10_000 });
  assert.deepEqual(restored.colony.chests, placed.colony.chests);
  assert.deepEqual(follower(restored).bag, follower(placed).bag);
  assert.deepEqual(restored.player.bag, placed.player.bag);
  assert.equal(restored.player.bagSelected, placed.player.bagSelected);
  await tapR();
  assert.equal((await read()).camera.mode, 'character');
  assert.ok((await read()).player.nearChest, '重载回出生点应够得到木箱');
  const chestGrid = play.page.locator('.chest-grid');
  for (const [x, y] of [[640, 420], [640, 490], [700, 450]]) {
    await play.page.mouse.click(x, y, { button: 'right' });
    await advance(0.4);
    if (await chestGrid.isVisible()) break;
  }
  assert.ok(await chestGrid.isVisible(), '角色靠近后右键应能打开木箱');
  const openedId = await chestGrid.getAttribute('data-chest-id');
  const visibleChest = restored.colony.chests.find(chest => chest.id === openedId);
  assert.ok(visibleChest, '右键应打开一个真实的独立木箱');
  assert.equal(await chestSlot(4).getAttribute('data-item'), visibleChest.slots[4]?.resource ?? null);
  const workspaceBox = await play.page.locator('#workspace').boundingBox();
  const hotbarBox = await play.page.locator('#hotbar').boundingBox();
  assert.ok(workspaceBox.y + workspaceBox.height <= hotbarBox.y, '快捷栏不得盖住最后一排容器格子');
  assert.equal(await play.page.locator('#interact-hint').isVisible(), false, '开箱后应隐藏靠近提示');
  await play.screenshot('inventory-restored');
  await play.page.locator('#panel-close').click();
  await play.page.mouse.click(640, 300);
  await tapR();
  await play.page.locator('[data-menu="inspect"]').click();
  await advance(0.3);

  // 退出游戏按钮本身只验存在。
  // 真点会把页面导航走，验收框架拿不到最终帧，所以点击行为不在这个脚本里跑。
  await play.page.keyboard.press('Escape');
  await advance(0.4);
  assert.equal(await play.page.locator('#pause-quit').count(), 1, '暂停层应有「退出游戏」');
  await play.page.keyboard.press('Escape');
  await advance(0.4);

  return {
    spawn,
    walkedMeters: Number(walked.toFixed(2)),
    cameraToPlayer: Number(camToPlayer.toFixed(2)),
    jumpRise: Number((s3.player.y - groundY).toFixed(2)),
    checks: 18,
  };
}
