/**
 * 作物近景探针：切到角色视角看白菜，检查白边是否消失。
 *
 * pnpm exec forgeax project play scripts/crop-closeup.mjs --require-ui --json
 */
import { possessResident } from './select-resident.mjs';

const READ = 'voxel.world';

/** @param {import('@forgeax/engine/devkit').PlayContext} play */
export default async function cropCloseup(play) {
  const read = () => play.state(READ);
  const advance = (seconds) => play.advance(seconds, { read: READ, stepSeconds: 0.1 });

  await advance(2);
  const boot = await read();
  console.log('作物:', boot.colony.crops?.length ?? 0, 'growth:', boot.colony.crops?.slice(0, 5).map((c) => Number((c.growth ?? 0).toFixed(2))));

  // 快进到成熟（白菜 115 秒）
  await advance(120);
  const grown = await read();
  console.log('成熟 growth:', grown.colony.crops?.slice(0, 5).map((c) => Number((c.growth ?? 0).toFixed(2))));

  // 切到角色视角看近景
  const controllerId = grown.colony.colonists[0].id;
  await possessResident(play, controllerId);
  await advance(1);
  console.log('视角:', (await read()).camera.mode);
  await play.screenshot('01-player-view');

  // 滚轮拉近一点
  await play.page.mouse.move(640, 300);
  for (let i = 0; i < 4; i++) await play.page.mouse.wheel(0, -240);
  await advance(0.5);
  await play.screenshot('02-player-zoom');

  return { mode: (await read()).camera.mode, crops: grown.colony.crops.length };
}
