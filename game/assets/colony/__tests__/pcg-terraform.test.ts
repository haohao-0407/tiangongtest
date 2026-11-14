import { expect, it } from 'vitest';
import { BLOCK, VoxelWorld, type BlockEdit } from '../../voxel/model.ts';
import { samplePcgSurfaceHeight } from '../../voxel/pcg/rules.ts';
import { ColonySimulation, JOB_TYPES } from '../simulation.ts';

it('finishes reachable earthwork while residents stand on the raised road finish', () => {
  const world = VoxelWorld.deserialize(JSON.stringify({ version: 1, generatorVersion: 1, seed: 'colony-test', size: [48, 24, 48], edits: [] }));
  const edits: BlockEdit[] = [];
  for (let z = 18; z <= 24; z++) for (let x = 18; x <= 24; x++) for (let y = 1; y < world.height; y++)
    edits.push({ x, y, z, block: y < 5 ? BLOCK.Dirt : y === 5 ? BLOCK.Grass : BLOCK.Air });
  world.edit(edits);
  world.edit([
    { x: 20, y: 5, z: 20, block: BLOCK.Air },
    { x: 19, y: 5, z: 20, block: BLOCK.Road }, { x: 21, y: 5, z: 20, block: BLOCK.Road },
    { x: 20, y: 5, z: 19, block: BLOCK.Road }, { x: 20, y: 5, z: 21, block: BLOCK.Road },
  ]);
  const sim = new ColonySimulation(world);
  sim.setWalkSurfaceSampler((x, z, fallback) => samplePcgSurfaceHeight(world, sim.renderState().buildings, x, z, fallback));
  for (const c of sim.snapshot().colonists) for (const job of JOB_TYPES)
    sim.command({ action: 'priority', colonistId: c.id, job, value: job === 'terraform' ? 1 : 0 });
  const order = sim.command({ action: 'level', target: 6, x: 20, z: 20 });
  expect(order.ok).toBe(true);
  let sawRaisedWorker = false;
  for (let i = 0; i < 720 && world.terrainHeight(20, 20) !== 6; i++) {
    sim.tick(.25);
    sawRaisedWorker ||= sim.snapshot().colonists.some(c => c.position[1] > 6 && c.position[1] < 6.3
      && Math.abs(Math.floor(c.position[0]) - 20) + Math.abs(Math.floor(c.position[2]) - 20) === 1);
  }
  expect(sawRaisedWorker).toBe(true);
  expect(world.terrainHeight(20, 20)).toBe(6);
  expect(sim.snapshot().terrainPlans.find(p => p.id === order.id)?.state).toBe('completed');
});
