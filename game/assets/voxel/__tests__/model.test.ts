import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { BLOCK, BLOCKS, CHUNK_SIZE, WORLD_SIZE, VoxelWorld, raycast } from '../model.ts';
import { legacyTreeCells } from '../trees.ts';

const smallWorld = (seed = '森屿-042') => new VoxelWorld(seed, { width: 48, height: 24, depth: 48 });

describe('deterministic terrain', () => {
  it('defaults to 250 by 250 with a central clearing and partial edge chunks', () => {
    const world = new VoxelWorld();
    expect(WORLD_SIZE).toEqual({ width: 250, height: 24, depth: 250 });
    expect(world.blocks.length).toBe(250 * 24 * 250);
    expect(world.terrainHeight(125, 125)).toBe(6);
    expect(world.terrainHeight(120, 120)).toBe(6);
    expect(world.generatorVersion).toBe(4);
    const chunks = world.consumeDirtyChunks();
    expect(chunks).toHaveLength(121);
    expect(chunks).toContainEqual({ x: 10, y: 0, z: 10 });
    expect(world.inBounds(249, 23, 249)).toBe(true);
    expect(world.inBounds(250, 23, 249)).toBe(false);
    world.set(249, 20, 249, BLOCK.Brick);
    expect(world.consumeDirtyChunks()).toEqual([{ x: 10, y: 0, z: 10 }]);
    const restored = VoxelWorld.deserialize(world.serialize());
    expect(restored.get(249, 20, 249)).toBe(BLOCK.Brick);
    expect([restored.width, restored.depth]).toEqual([250, 250]);
    expect(restored.count()).toBe(world.count());
  });
  it('rebuilds the same map from a seed and varies with another seed', () => {
    const a = smallWorld('valley-42'), b = smallWorld('valley-42'), c = smallWorld('valley-43');
    expect(a.blocks).toEqual(b.blocks);
    expect(a.blocks).not.toEqual(c.blocks);
    for (const block of [BLOCK.Grass, BLOCK.Dirt, BLOCK.Stone, BLOCK.Water, BLOCK.Sand]) {
      expect(a.count(block)).toBeGreaterThan(0);
    }
    expect(a.getTrees()).toEqual(b.getTrees());
    expect(a.getTrees().length).toBeGreaterThan(0);
    expect(a.surfaceHeight(27, 27)).toBe(5);
    expect(a.surfaceHeight(25, 25)).toBe(5);
    expect(a.count()).toBeLessThan(a.blocks.length);
    expect(a.count(BLOCK.Air) + a.count()).toBe(a.blocks.length);
  });
  it('uses finite block ids, immutable bedrock and all expected chunks', () => {
    const world = smallWorld();
    expect([...new Set(world.blocks)].every((id) => BLOCKS[id] !== undefined)).toBe(true);
    expect(world.get(0, 0, 0)).toBe(BLOCK.Stone);
    expect(world.get(-1, 2, 2)).toBe(BLOCK.Air);
    expect(world.get(0.5, 2, 2)).toBe(BLOCK.Air);
    expect(world.consumeDirtyChunks()).toHaveLength(4);
    expect(world.consumeDirtyChunks()).toHaveLength(0);
    expect(CHUNK_SIZE).toBe(24);
  });
});

describe('transactional editing', () => {
  it('places, removes, undoes and redoes byte-for-byte', () => {
    const world = smallWorld(), before = world.blocks.slice();
    expect(world.set(27, 6, 27, BLOCK.Planks)).toBe(true);
    const after = world.blocks.slice();
    expect(world.get(27, 6, 27)).toBe(BLOCK.Planks);
    expect(world.editCount).toBe(1);
    expect(world.undo()).toBe(true);
    expect(world.blocks).toEqual(before);
    expect(world.editCount).toBe(0);
    expect(world.redo()).toBe(true);
    expect(world.blocks).toEqual(after);
    world.set(27, 6, 27, BLOCK.Air);
    expect(world.editCount).toBe(0);
  });
  it('rejects a complete transaction if any edit is invalid', () => {
    const world = smallWorld(), before = world.blocks.slice();
    expect(() => world.edit([{ x: 27, y: 6, z: 27, block: BLOCK.Brick }, { x: 48, y: 6, z: 27, block: BLOCK.Brick }])).toThrow();
    expect(world.blocks).toEqual(before);
    expect(world.canUndo).toBe(false);
    expect(() => world.set(1, 0, 1, BLOCK.Air)).toThrow(/基岩/);
    expect(() => world.set(1, 2, 1, 222)).toThrow();
    expect(() => world.set(1.5, 2, 1, BLOCK.Stone)).toThrow();
  });
  it('coalesces duplicates and retains redo for no-op edits', () => {
    const world = smallWorld();
    world.edit([{ x: 27, y: 6, z: 27, block: BLOCK.Brick }, { x: 27, y: 6, z: 27, block: BLOCK.Planks }]);
    expect(world.undoCount).toBe(1);
    world.undo();
    expect(world.set(27, 6, 27, BLOCK.Air)).toBe(false);
    expect(world.canRedo).toBe(true);
    world.set(28, 6, 27, BLOCK.Stone);
    expect(world.canRedo).toBe(false);
    expect(world.undo()).toBe(true);
    expect(world.undo()).toBe(false);
  });
  it('invalidates adjacent chunks only on the affected boundary', () => {
    const world = new VoxelWorld('boundary', { width: 48, height: 48, depth: 48 });
    world.consumeDirtyChunks();
    world.set(24, 24, 24, BLOCK.Brick);
    expect(world.consumeDirtyChunks()).toEqual(expect.arrayContaining([
      { x: 1, y: 1, z: 1 }, { x: 0, y: 1, z: 1 }, { x: 1, y: 0, z: 1 }, { x: 1, y: 1, z: 0 },
    ]));
    world.set(25, 25, 25, BLOCK.Brick);
    expect(world.consumeDirtyChunks()).toEqual([{ x: 1, y: 1, z: 1 }]);
  });
  it('keeps counts correct across mixed transactions, undo, redo, load and reset', () => {
    const world = smallWorld();
    const assertCounts = () => {
      const counts = new Map<number, number>();
      for (const block of world.blocks) counts.set(block, (counts.get(block) ?? 0) + 1);
      for (const def of BLOCKS) expect(world.count(def.id)).toBe(counts.get(def.id) ?? 0);
      expect(world.count()).toBe(world.blocks.length - world.count(BLOCK.Air));
    };
    assertCounts();
    world.edit([{ x: 27, y: 5, z: 27, block: BLOCK.Air }, { x: 27, y: 7, z: 27, block: BLOCK.Brick }, { x: 27, y: 7, z: 27, block: BLOCK.Planks }]);
    assertCounts();
    world.undo(); assertCounts();
    world.redo(); assertCounts();
    world.load(world.serialize()); assertCounts();
    world.reset('reset-counts', { width: 31, height: 24, depth: 29 }); assertCounts();
  });
  it('separates terrain altitude from water, trunks and tree canopies', () => {
    const world = smallWorld();
    world.edit([{ x: 24, y: 6, z: 24, block: BLOCK.Water }, { x: 24, y: 8, z: 24, block: BLOCK.Wood }, { x: 24, y: 9, z: 24, block: BLOCK.Leaves }]);
    expect(world.surfaceHeight(24, 24)).toBe(9);
    expect(world.terrainHeight(24, 24)).toBe(6);
    expect(world.waterSurfaceHeight(24, 24)).toBe(7);
    expect(world.waterSurfaceHeight(25, 24)).toBe(-1);
    expect(world.terrainHeight(-1, 24)).toBe(-1);
    expect(world.terrainHeight(24.5, 24)).toBe(-1);
  });
  it('bounds history and resets the full map state', () => {
    const world = smallWorld();
    for (let i = 0; i < 220; i++) world.set(27, 6, 27, i % 2 ? BLOCK.Stone : BLOCK.Brick);
    expect(world.undoCount).toBe(200);
    world.reset('replacement', { width: 48, height: 24, depth: 48 });
    expect(world.seed).toBe('replacement');
    expect(world.editCount).toBe(0);
    expect(world.canUndo).toBe(false);
    expect(world.canRedo).toBe(false);
    expect(world.consumeDirtyChunks()).toHaveLength(4);
  });
});

describe('save snapshots', () => {
  it('restores the exact legacy generator baseline and edits before a new-game reset', () => {
    const legacy = { version: 1, generatorVersion: 1, seed: '森屿-042', size: [48, 24, 48], edits: [] as number[][] };
    const restored = VoxelWorld.deserialize(JSON.stringify(legacy));
    const originalVoxels = restored.blocks.slice(), terrainCount = restored.count();
    for (const tree of [...restored.getTrees()].sort((a, b) => a.z - b.z || a.x - b.x)) for (const cell of legacyTreeCells(tree)) {
      const index = restored.index(cell.x, cell.y, cell.z);
      if (cell.role === 'trunk' || originalVoxels[index] === BLOCK.Air) originalVoxels[index] = cell.role === 'trunk' ? BLOCK.Wood : BLOCK.Leaves;
    }
    expect(createHash('sha256').update(originalVoxels).digest('hex')).toBe('cbf17c27b09f3a075c26acec96191df81d74a0436a5507de61e7656966053103');
    expect(originalVoxels.filter(block => block !== BLOCK.Air)).toHaveLength(19757);
    expect(restored.generatorVersion).toBe(1);
    legacy.edits = [[27 + 48 * (27 + 48 * 6), BLOCK.Brick]];
    restored.load(JSON.stringify(legacy));
    expect(restored.get(27, 6, 27)).toBe(BLOCK.Brick);
    expect(restored.count()).toBe(terrainCount + 1);
    expect(JSON.parse(restored.serialize()).generatorVersion).toBe(1);
    const large = new VoxelWorld();
    large.load(restored.serialize());
    expect([large.width, large.height, large.depth]).toEqual([48, 24, 48]);
    expect(large.blocks).toEqual(restored.blocks);
    large.reset('new-game');
    expect([large.width, large.height, large.depth]).toEqual([250, 24, 250]);
    expect(large.generatorVersion).toBe(4);
  });
  it('round-trips built blocks and explicit deletion of generated terrain', () => {
    const world = smallWorld('save-me');
    world.set(27, 5, 27, BLOCK.Air);
    world.set(27, 7, 27, BLOCK.Brick);
    const restored = VoxelWorld.deserialize(world.serialize());
    expect(restored.blocks).toEqual(world.blocks);
    expect(restored.seed).toBe('save-me');
    expect(restored.editCount).toBe(2);
    expect(restored.canUndo).toBe(false);
    world.undo(); world.undo();
    expect(JSON.parse(world.serialize()).edits).toEqual([]);
  });
  it('rejects malformed, incompatible and out-of-range saves without touching the map', () => {
    const world = smallWorld();
    world.set(27, 6, 27, BLOCK.Brick);
    const before = world.serialize(), snapshot = JSON.parse(before);
    for (const bad of [
      '{', 'null', JSON.stringify({ ...snapshot, version: 999 }),
      JSON.stringify({ ...snapshot, generatorVersion: 999 }),
      JSON.stringify({ ...snapshot, size: [0, 24, 49] }),
      JSON.stringify({ ...snapshot, seed: '' }),
      JSON.stringify({ ...snapshot, edits: [[-1, 1]] }),
      JSON.stringify({ ...snapshot, edits: [[0, 1]] }),
      JSON.stringify({ ...snapshot, edits: [[world.blocks.length, 1]] }),
      JSON.stringify({ ...snapshot, edits: [[3000, 99]] }),
      JSON.stringify({ ...snapshot, edits: [[3000, 1], [3000, 2]] }),
    ]) {
      expect(() => world.load(bad)).toThrow();
      expect(world.serialize()).toBe(before);
      expect(world.canUndo).toBe(true);
    }
    world.load(smallWorld('other').serialize());
    expect(world.seed).toBe('other');
    expect(world.editCount).toBe(0);
    expect(world.canUndo).toBe(false);
  });
});

describe('voxel DDA picking', () => {
  it('hits grass from above with a usable placement face', () => {
    const world = smallWorld();
    const hit = world.raycast([27.5, 30, 27.5], [0, -10, 0]);
    expect(hit).toEqual({ cell: [27, 5, 27], normal: [0, 1, 0], adjacent: [27, 6, 27], block: BLOCK.Grass, distance: 24 });
    expect(world.raycast([27.5, 30, 27.5], [0, -1, 0], 23.9)).toBeNull();
    expect(world.raycast([27.5, 30, 27.5], [0, -1, 0], 24)?.cell).toEqual([27, 5, 27]);
  });
  it('supports every axis and non-normalized directions', () => {
    const world = smallWorld();
    world.set(25, 20, 25, BLOCK.Brick);
    const cases: [[number, number, number], [number, number, number], [number, number, number]][] = [
      [[20, 20.5, 25.5], [1, 0, 0], [-1, 0, 0]],
      [[30, 20.5, 25.5], [-1, 0, 0], [1, 0, 0]],
      [[25.5, 23, 25.5], [0, -1, 0], [0, 1, 0]],
      [[25.5, 19, 25.5], [0, 1, 0], [0, -1, 0]],
      [[25.5, 20.5, 20], [0, 0, 1], [0, 0, -1]],
      [[25.5, 20.5, 30], [0, 0, -1], [0, 0, 1]],
    ];
    for (const [origin, direction, normal] of cases) {
      const hit = raycast(world, origin, direction);
      expect(hit?.cell).toEqual([25, 20, 25]);
      expect(hit?.normal).toEqual(normal);
    }
  });
  it('handles internal origins, edge crossings, invalid rays and world boundaries', () => {
    const world = smallWorld();
    world.set(25, 20, 25, BLOCK.Brick);
    expect(world.raycast([25.5, 20.5, 25.5], [1, 0, 0])).toEqual({ cell: [25, 20, 25], normal: null, adjacent: null, block: BLOCK.Brick, distance: 0 });
    expect(world.raycast([23.5, 18.5, 23.5], [1, 1, 1])?.cell).toEqual([25, 20, 25]);
    expect(world.raycast([25, 20, 25], [0, 0, 0])).toBeNull();
    expect(world.raycast([-1, 20, -1], [0, 1, 0])).toBeNull();
    expect(world.raycast([25, 20, 25], [NaN, 0, 1])).toBeNull();
    expect(world.raycast([25, 20, 25], [1, 0, 0], -1)).toBeNull();
    expect(world.raycast([48, 0.5, 0.5], [-1, 0, 0])?.normal).toEqual([1, 0, 0]);
    expect(world.raycast([0, 0.5, 0.5], [1, 0, 0])?.normal).toEqual([-1, 0, 0]);
  });
});
