import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { BLOCK, BLOCKS, VoxelWorld } from '../model.ts';
import { planSurfaceOreVeins, SURFACE_STEEL_ORE_SETTINGS } from '../surface-ore.ts';

const digest = (world: VoxelWorld) => createHash('sha256').update(world.blocks).digest('hex');
function oreCells(world: VoxelWorld): number[] {
  const cells: number[] = [];
  world.blocks.forEach((block, index) => { if (block === BLOCK.SteelOre) cells.push(index); });
  return cells;
}
function veinComponents(world: VoxelWorld): number[][] {
  const remaining = new Set(oreCells(world)), components: number[][] = [];
  while (remaining.size) {
    const component = [remaining.values().next().value!]; remaining.delete(component[0]!);
    for (let head = 0; head < component.length; head++) {
      const [x, y, z] = world.coordinates(component[head]!);
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
        const nx = x + dx!, ny = y + dy!, nz = z + dz!;
        if (!world.inBounds(nx, ny, nz)) continue;
        const index = world.index(nx, ny, nz);
        if (remaining.delete(index)) component.push(index);
      }
    }
    components.push(component);
  }
  return components;
}

describe('surface steel ore generation', () => {
  it.each(['森屿-042', 'ore-2', 'ore-river', 'ore-ridge'])('places exposed connected separated veins for %s', (seed: string) => {
    const world = new VoxelWorld(seed), veins = veinComponents(world);
    expect(BLOCKS[BLOCK.SteelOre]).toMatchObject({ name: '钢矿', solid: true, buildable: false });
    expect(veins).toHaveLength(24);
    for (const vein of veins) {
      expect(vein.length).toBeGreaterThanOrEqual(SURFACE_STEEL_ORE_SETTINGS.minVeinSize);
      expect(vein.length).toBeLessThanOrEqual(SURFACE_STEEL_ORE_SETTINGS.maxVeinSize);
      expect(new Set(vein.map(index => world.coordinates(index)[1])).size).toBe(1);
      for (const index of vein) {
        const [x, y, z] = world.coordinates(index);
        expect(y).toBeGreaterThan(0);
        expect(world.surfaceHeight(x, z)).toBe(y);
        expect(world.get(x, y + 1, z)).toBe(BLOCK.Air);
        expect(world.waterSurfaceHeight(x, z)).toBe(-1);
        expect(world.treesInColumn(x, z)).toHaveLength(0);
        expect(Math.hypot(x - 125, z - 125)).toBeGreaterThanOrEqual(20);
      }
    }
  });

  it('uses a deterministic independent stream and varies with seed', () => {
    const a = new VoxelWorld('ore-seed'), b = new VoxelWorld('ore-seed'), c = new VoxelWorld('ore-other');
    expect(oreCells(a)).toEqual(oreCells(b));
    expect(digest(a)).toBe(digest(b));
    expect(oreCells(a)).not.toEqual(oreCells(c));
    const legacy = VoxelWorld.deserialize(JSON.stringify({ version: 1, generatorVersion: 2, seed: a.seed, size: [250, 24, 250], edits: [] }));
    const onlyOresChanged = a.blocks.every((block, index) => block === legacy.blocks[index] || block === BLOCK.SteelOre);
    expect(onlyOresChanged).toBe(true);
    expect(a.getTrees()).toEqual(legacy.getTrees());
  });

  it.each([[8, 8, 8], [31, 24, 29], [48, 24, 48], [64, 12, 32]])('handles custom size %j without partial singleton veins', (width: number, height: number, depth: number) => {
    const world = new VoxelWorld('small-ore', { width, height, depth });
    for (const vein of veinComponents(world)) {
      expect(vein.length).toBeGreaterThanOrEqual(6);
      expect(vein.length).toBeLessThanOrEqual(16);
      for (const index of vein) {
        const [x, y, z] = world.coordinates(index);
        expect(world.surfaceHeight(x, z)).toBe(y);
        expect(world.waterSurfaceHeight(x, z)).toBe(-1);
      }
    }
    expect(digest(VoxelWorld.deserialize(world.serialize()))).toBe(digest(world));
  });

  it('restores ore depletion, editor undo and reload without regrowing mined cells', () => {
    const world = new VoxelWorld('ore-save'), before = world.count(BLOCK.SteelOre);
    const [x, y, z] = world.coordinates(oreCells(world)[0]!);
    world.set(x, y, z, BLOCK.Air);
    expect(world.count(BLOCK.SteelOre)).toBe(before - 1);
    world.undo(); expect(world.get(x, y, z)).toBe(BLOCK.SteelOre);
    world.redo(); expect(world.get(x, y, z)).toBe(BLOCK.Air);
    const restored = VoxelWorld.deserialize(world.serialize());
    expect(restored.generatorVersion).toBe(3);
    expect(restored.get(x, y, z)).toBe(BLOCK.Air);
    expect(digest(restored)).toBe(digest(world));
    expect(restored.count(BLOCK.SteelOre)).toBe(before - 1);
  });

  it.each([1, 2])('keeps legacy generator %i free of newly generated ore after loading', (generatorVersion: number) => {
    const legacy = { version: 1, generatorVersion, seed: '森屿-042', size: [48, 24, 48], edits: [[27 + 48 * (27 + 48 * 6), BLOCK.Brick]] };
    const world = VoxelWorld.deserialize(JSON.stringify(legacy));
    expect(world.generatorVersion).toBe(generatorVersion);
    expect(world.count(BLOCK.SteelOre)).toBe(0);
    expect(world.get(27, 6, 27)).toBe(BLOCK.Brick);
    const restored = VoxelWorld.deserialize(world.serialize());
    expect(restored.generatorVersion).toBe(generatorVersion);
    expect(digest(restored)).toBe(digest(world));
    expect(restored.getTrees()).toEqual(world.getTrees());
  });

  it('cannot recover harvested ore through earlier sandbox undo or redo', () => {
    const world = new VoxelWorld('ore-consumed'), [x, y, z] = world.coordinates(oreCells(world)[0]!);
    world.set(125, 8, 125, BLOCK.Planks);
    world.set(x, y, z, BLOCK.Air);
    world.undo();
    expect(world.canRedo).toBe(true);
    world.set(x, y, z, BLOCK.Air, { recordHistory: false });
    expect(world.canRedo).toBe(false);
    expect(world.undo()).toBe(true);
    expect(world.get(125, 8, 125)).toBe(BLOCK.Air);
    expect(world.get(x, y, z)).toBe(BLOCK.Air);
    expect(world.undo()).toBe(false);
    expect(world.get(x, y, z)).toBe(BLOCK.Air);
  });
  it('invalidates old past edits that could restore consumed ore while retaining unrelated edits', () => {
    const world = new VoxelWorld('ore-past'), [x, y, z] = world.coordinates(oreCells(world)[0]!);
    world.set(x, y, z, BLOCK.Stone);
    world.set(x, y, z, BLOCK.SteelOre);
    world.set(125, 8, 125, BLOCK.Planks);
    world.set(x, y, z, BLOCK.Air, { recordHistory: false });
    expect(world.undoCount).toBe(1);
    expect(world.undo()).toBe(true);
    expect(world.undo()).toBe(false);
    expect(world.get(x, y, z)).toBe(BLOCK.Air);
    expect(world.redo()).toBe(true);
    expect(world.get(x, y, z)).toBe(BLOCK.Air);
    expect(VoxelWorld.deserialize(world.serialize()).get(x, y, z)).toBe(BLOCK.Air);
  });
});

describe('surface ore planner constraints', () => {
  it('rejects fragmented or diagonal-only patches instead of placing single ore cells', () => {
    const veins = planSurfaceOreVeins({ width: 20, depth: 20, candidateHeightAt: (x, z) => (x + z) % 2 === 0 ? 3 : -1 }, 123);
    expect(veins).toEqual([]);
  });
  it('honors explicit density and vein sizes with finite attempts on impossible terrain', () => {
    const source = { width: 100, depth: 100, candidateHeightAt: () => 3 };
    const settings = { ...SURFACE_STEEL_ORE_SETTINGS, veinsPer10kCells: 5, minVeinSize: 9, maxVeinSize: 9 };
    expect(planSurfaceOreVeins(source, 55, settings).map(vein => vein.length)).toEqual([9, 9, 9, 9, 9]);
    expect(planSurfaceOreVeins(source, 55, { ...settings, veinsPer10kCells: 0 })).toEqual([]);
    expect(planSurfaceOreVeins({ ...source, candidateHeightAt: () => -1 }, 55, settings)).toEqual([]);
    expect(() => planSurfaceOreVeins(source, 55, { ...settings, minVeinSize: 1 })).toThrow();
  });
});
