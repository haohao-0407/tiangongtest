import assert from 'node:assert/strict';
import { tsImport } from 'tsx/esm/api';

const { VoxelWorld } = await tsImport('../assets/voxel/model.ts', import.meta.url);
const { WILD_PLANT_KINDS, visibleWildPlants } = await tsImport('../assets/voxel/wild-plants.ts', import.meta.url);
const read = 'voxel.world';

export default async function wildPlantsPlaythrough(play) {
  const ready = () => play.waitFor(s => WILD_PLANT_KINDS.every(k => s.wildPlants?.[k] > 0), { read });
  const state = await ready();
  const [width, height, depth] = state.dimensions;
  const world = new VoxelWorld(state.seed, { width, height, depth });
  const plants = visibleWildPlants(world, state.colony);
  const counts = Object.fromEntries(WILD_PLANT_KINDS.map(kind => [kind, plants.filter(p => p.kind === kind).length]));
  assert.deepEqual(state.wildPlants, counts);
  const advance = seconds => play.advance(seconds, { read, stepSeconds: .1 });
  await play.mouse.move([.5,.4]);
  await play.mouse.click([.5,.4], { button: 'middle' });
  for (let i = 0; i < 6 && (await play.state(read)).camera.distance > 15.1; i++) {
    await play.page.mouse.wheel(0,-320);
    await advance(.15);
  }
  for (const kind of WILD_PLANT_KINDS) {
    await play.step(kind, async () => {
      const start = await play.state(read);
      const cost = p => Math.hypot(p.x+.5-width/2,p.z+.5-depth/2) + 2*Math.abs(p.y-start.camera.target[1]);
      const sx = Math.sin(start.camera.yaw), sz = Math.cos(start.camera.yaw);
      // The orbit camera looks through tree crowns several columns in front of the subject.
      const clearView = p => !world.getTrees().some(t => {
        const dx = t.x-p.x, dz = t.z-p.z;
        const along = Math.min(10, Math.max(0, dx*sx + dz*sz));
        return Math.hypot(dx-along*sx, dz-along*sz) < 4.3;
      });
      const plant = plants.filter(p => p.kind === kind && clearView(p)).sort((a,b) => cost(a)-cost(b))[0];
      assert.ok(plant, `A clear sightline to ${kind} is required for visual inspection`);
      for (const sideways of [true,false]) {
        const camera = (await play.state(read)).camera, yaw = camera.yaw;
        const axis = sideways ? [Math.cos(yaw),-Math.sin(yaw)] : [Math.sin(yaw),Math.cos(yaw)];
        const elevation = (plant.y+.3-camera.target[1]) / Math.tan(camera.pitch);
        const error = target => (plant.x+.5-target[0])*axis[0] + (plant.z+.5-target[2])*axis[1] - (sideways ? 0 : elevation);
        const delta = error(camera.target);
        if (Math.abs(delta) < .6) continue;
        const key = sideways ? (delta > 0 ? 'KeyD' : 'KeyA') : (delta > 0 ? 'KeyS' : 'KeyW');
        await play.keyboard.hold(key, s => Math.abs(error(s.camera.target)) < .6 || error(s.camera.target)*delta <= 0, { read });
      }
      const camera = (await advance(.15)).camera;
      const [ex,ey,ez] = camera.eye, dx = plant.x+.5-ex, dy = plant.y+.3-ey, dz = plant.z+.5-ez;
      const back = dx*Math.sin(camera.yaw) + dz*Math.cos(camera.yaw);
      const cameraDepth = -back*Math.cos(camera.pitch) - dy*Math.sin(camera.pitch);
      const halfHeight = cameraDepth*Math.tan(Math.PI/8);
      const viewport = play.page.viewportSize();
      const screenX = .5 + (dx*Math.cos(camera.yaw)-dz*Math.sin(camera.yaw))/(2*halfHeight*viewport.width/viewport.height);
      const screenY = .5 - (dy*Math.cos(camera.pitch)-back*Math.sin(camera.pitch))/(2*halfHeight);
      assert.ok(cameraDepth > 0 && screenX > .2 && screenX < .85 && screenY > .12 && screenY < .88,
        `${kind} outside the unobstructed map viewport: ${screenX}, ${screenY}`);
      assert.equal((await play.screenshot('wild-'+kind)).rendered, true);
      return { x: plant.x, y: plant.y, z: plant.z, count: counts[kind] };
    });
  }
  await play.reload();
  assert.deepEqual((await ready()).wildPlants, counts);
  return { seed: state.seed, counts };
}
