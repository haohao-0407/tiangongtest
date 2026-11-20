import assert from 'node:assert/strict';
import { tsImport } from 'tsx/esm/api';

const { VoxelWorld } = await tsImport('../assets/voxel/model.ts', import.meta.url);
const { WILD_ANIMAL_KINDS, visibleWildAnimals, wildAnimalPose } = await tsImport('../assets/voxel/wild-animals.ts', import.meta.url);
const read = 'voxel.world';

export default async function wildAnimalsPlaythrough(play) {
  const ready = () => play.waitFor(s => WILD_ANIMAL_KINDS.every(k => s.wildAnimals?.[k] > 0), { read });
  const start = await ready();
  const [width,height,depth] = start.dimensions;
  const world = new VoxelWorld(start.seed, {width,height,depth});
  const animals = visibleWildAnimals(world, start.colony);
  const counts = Object.fromEntries(WILD_ANIMAL_KINDS.map(k => [k, animals.filter(a => a.kind === k).length]));
  assert.deepEqual(start.wildAnimals, counts);
  await play.mouse.move([.5,.4]);
  await play.mouse.click([.5,.4], {button:'middle'});
  for (let i = 0; i < 6 && (await play.state(read)).camera.distance > 15.1; i++) {
    await play.page.mouse.wheel(0,-320);
    await play.advance(.15, {read});
  }
  for (const kind of WILD_ANIMAL_KINDS) await play.step('wild-'+kind, async () => {
    const {camera, colony} = await play.state(read);
    const sx = Math.sin(camera.yaw), sz = Math.cos(camera.yaw);
    const subjects = animals.filter(a => a.kind === kind).map(a => ({
      x:a.x+.5+a.dx/2, y:a.y, z:a.z+.5+a.dz/2, yaw:wildAnimalPose(a,colony.time).yaw,
    }));
    const clear = p => !world.getTrees().some(t => {
      const dx = t.x+.5-p.x, dz = t.z+.5-p.z;
      const along = Math.min(9, Math.max(0, dx*sx + dz*sz));
      return Math.hypot(dx-along*sx, dz-along*sz) < 3.4;
    });
    const cost = p => Math.hypot(p.x-width/2,p.z-depth/2) + 4*Math.abs(p.y-camera.target[1])
      + 6*(1-Math.cos(p.yaw-camera.yaw));
    const p = subjects.filter(clear).sort((a,b) => cost(a)-cost(b))[0];
    assert.ok(p, 'An unobstructed natural animal is required');
    for (const sideways of [true,false]) {
      const [ax,az] = sideways ? [sz,-sx] : [sx,sz];
      const elevation = sideways ? 0 : (p.y+.6-camera.target[1])/Math.tan(camera.pitch);
      const error = target => (p.x-target[0])*ax + (p.z-target[2])*az - elevation;
      const delta = error((await play.state(read)).camera.target);
      if (Math.abs(delta) < .6) continue;
      const key = sideways ? (delta>0?'KeyD':'KeyA') : (delta>0?'KeyS':'KeyW');
      await play.keyboard.hold(key, s => Math.abs(error(s.camera.target)) < .6 || error(s.camera.target)*delta < 0, {read});
    }
    await play.advance(.15, {read});
    assert.equal((await play.screenshot('wild-'+kind)).rendered, true);
    return {count:counts[kind], x:p.x, z:p.z};
  });
  await play.reload();
  assert.deepEqual((await ready()).wildAnimals, counts);
  return {seed:start.seed, counts};
}
