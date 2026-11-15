// 新导入的 33 个建筑能不能放、能不能画出来。
const READ = 'voxel.world';

export default async function newBuildings(play) {
  const advance = (s) => play.advance(s, { read: READ, stepSeconds: 0.05 });
  await advance(1.0);

  // 打开建造面板，看分类是否齐全
  await play.page.locator('[data-menu="build"]').click();
  await advance(0.5);
  const titles = await play.page.locator('#workspace .build-group-title').allTextContents();
  const fenceCard = await play.page.locator('#workspace [data-testid="build-fence"]').count();
  const forgeCard = await play.page.locator('#workspace [data-testid="build-forgery"]').count();
  await play.screenshot('build-panel-groups');

  // 放一道栅栏。坐标得挑空地——被占用或不合法会被 orderBuild 挡回来。
  const beforeState = await play.state(READ);
  const before = beforeState.colony.buildings.length;
  const occupied = new Set(beforeState.colony.buildings.flatMap((b) => {
    const out = [];
    for (let dx = 0; dx < (b.w ?? 1); dx++) for (let dz = 0; dz < (b.d ?? 1); dz++) out.push(`${b.x + dx},${b.z + dz}`);
    return out;
  }));
  let placedAt = null;
  for (let x = 118; x < 134 && !placedAt; x++) {
    for (let z = 118; z < 132 && !placedAt; z++) {
      if (occupied.has(`${x},${z}`)) continue;
      await play.page.evaluate(([xx, zz]) => window.__wbSend('colony', { command: { action: 'build', kind: 'fence', x: xx, z: zz } }), [x, z]);
      await advance(0.35);
      const snap = await play.state(READ);
      if (snap.colony.buildings.some((b) => b.kind === 'fence' && b.x === x && b.z === z)) placedAt = [x, z];
    }
  }
  const after = await play.state(READ);
  const fence = after.colony.buildings.find((b) => b.kind === 'fence');

  return {
    groups: titles,
    fenceCard,
    forgeCard,
    buildingCountBefore: before,
    buildingCountAfter: after.colony.buildings.length,
    fencePlaced: !!fence,
    placedAt,
    fenceDir: fence ? `${fence.w}×${fence.d}` : null,
  };
}
