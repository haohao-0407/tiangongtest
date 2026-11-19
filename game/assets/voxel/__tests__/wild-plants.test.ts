import { expect, it } from 'vitest';
import { BLOCK, VoxelWorld } from '../model.ts';
import { visibleWildPlants, WILD_PLANT_KINDS } from '../wild-plants.ts';

const size = { width: 96, height: 20, depth: 90 };
const land = { buildings: [], zones: [], crops: [] };

it('grows all seven species on exposed grass with deterministic, distinct seed layouts', () => {
  const world = new VoxelWorld('valley', size);
  const plants = world.getWildPlants();
  expect(new Set(plants.map(p => p.kind))).toEqual(new Set(WILD_PLANT_KINDS));
  expect(new Set(plants.map(p => p.x + world.width * p.z)).size).toBe(plants.length);
  expect(plants.every(p => world.supportsWildPlant(p) && p.y === world.surfaceHeight(p.x, p.z) + 1)).toBe(true);
  expect(new VoxelWorld('valley', size).getWildPlants()).toEqual(plants);
  expect(new VoxelWorld('upland', size).getWildPlants()).not.toEqual(plants);
});

it('respects land use, road edits, undo and restored world state', () => {
  const world = new VoxelWorld('woodland', size);
  const [a,b,c,d] = world.getWildPlants();
  const used = { buildings: [{ ...a, w: 1, d: 1 }], zones: [{ ...b, w: 1, d: 1 }], crops: [c] };
  const plants = visibleWildPlants(world, used);
  expect(plants.filter(p => [a,b,c].includes(p))).toEqual([]);
  world.set(d.x, d.y - 1, d.z, BLOCK.Road);
  expect(visibleWildPlants(world, land)).not.toContain(d);
  const restored = new VoxelWorld('other', size);
  restored.load(world.serialize());
  expect(visibleWildPlants(restored, used)).toEqual(visibleWildPlants(world, used));
  world.undo();
  expect(visibleWildPlants(world, land)).toContain(d);
});
