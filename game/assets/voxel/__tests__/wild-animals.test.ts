import { expect, it } from 'vitest';
import { ColonySimulation } from '../../colony/simulation.ts';
import { BLOCK, VoxelWorld } from '../model.ts';
import { planWildAnimals, visibleWildAnimals, WILD_ANIMAL_KINDS, wildAnimalPose } from '../wild-animals.ts';

const size = { width: 96, depth: 90, height: 20 };
const empty = { buildings: [], zones: [], crops: [] };

it('seeds distinct herds with clear, non-overlapping grazing areas outside camp', () => {
  const world = new VoxelWorld('valley', size), animals = world.getWildAnimals();
  expect(new Set(animals.map(a => a.kind))).toEqual(new Set(WILD_ANIMAL_KINDS));
  expect(new VoxelWorld('valley', size).getWildAnimals()).toEqual(animals);
  expect(new VoxelWorld('upland', size).getWildAnimals()).not.toEqual(animals);
  const used = new Set<string>();
  for (const a of animals) {
    const pad = a.kind === 'chicken' ? 0 : 1;
    for (let z = a.z+Math.min(0,a.dz)-pad; z <= a.z+Math.max(0,a.dz)+pad; z++) {
      for (let x = a.x+Math.min(0,a.dx)-pad; x <= a.x+Math.max(0,a.dx)+pad; x++) {
        expect(world.wildAnimalGround(x,z)).toBe(a.y);
        expect(Math.hypot(x-size.width/2, z-size.depth/2)).toBeGreaterThanOrEqual(12);
        expect(used.has(`${x},${z}`)).toBe(false);
        used.add(`${x},${z}`);
      }
    }
  }
  expect(planWildAnimals(8, 8, () => .5, () => -1)).toEqual([]);
});

it('removes obstructed habitats and restores them on undo and save reload', () => {
  const world = new VoxelWorld('valley', size);
  const [a,b,c,d] = world.getWildAnimals();
  const end = (animal: typeof a) => ({ x:animal.x+animal.dx, z:animal.z+animal.dz, w:1, d:1 });
  const land = { buildings:[end(a)], zones:[end(b)], crops:[end(c)] };
  expect(visibleWildAnimals(world,land).filter(animal => [a,b,c].includes(animal))).toEqual([]);
  const tile = end(d);
  world.set(tile.x, d.y, tile.z, BLOCK.Water);
  expect(visibleWildAnimals(world,land)).not.toContain(d);
  const restored = new VoxelWorld('old', size);
  restored.load(world.serialize());
  expect(visibleWildAnimals(restored,land)).toEqual(visibleWildAnimals(world,land));
  world.undo();
  expect(visibleWildAnimals(world,empty)).toEqual(world.getWildAnimals());
});

it('uses the saved simulation clock for movement, pauses and reloads', () => {
  const world = new VoxelWorld('valley', size);
  const sim = new ColonySimulation(world);
  const poses = (clock: number) => world.getWildAnimals().map(a => wildAnimalPose(a,clock));
  const start = poses(sim.simulationTime);
  sim.tick(1.17);
  const moving = poses(sim.simulationTime);
  expect(moving).not.toEqual(start);
  sim.command({action:'speed',value:0});
  sim.tick(3);
  expect(poses(sim.simulationTime)).toEqual(moving);
  const restored = new ColonySimulation(world);
  restored.load(sim.serialize());
  expect(poses(restored.simulationTime)).toEqual(moving);
});
