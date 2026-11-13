import { describe, expect, it } from 'vitest';
import { BLOCK, BLOCKS, CHUNK_SIZE, VoxelWorld, raycast } from '../model.ts';

describe('deterministic terrain', () => {
  it('rebuilds the same map from a seed and varies with another seed', () => {
    const a = new VoxelWorld('valley-42'), b = new VoxelWorld('valley-42'), c = new VoxelWorld('valley-43');
    expect(a.blocks).toEqual(b.blocks);
    expect(a.blocks).not.toEqual(c.blocks);
    for (const block of [BLOCK.Grass, BLOCK.Dirt, BLOCK.Stone, BLOCK.Water, BLOCK.Wood, BLOCK.Leaves, BLOCK.Sand]) {
      expect(a.count(block)).toBeGreaterThan(0);
    }
    expect(a.surfaceHeight(27, 27)).toBe(5);
    expect(a.surfaceHeight(25, 25)).toBe(5);
    expect(a.count()).toBeLessThan(a.blocks.length);
    expect(a.count(BLOCK.Air) + a.count()).toBe(a.blocks.length);
  });
  it('uses finite block ids, immutable bedrock and all expected chunks', () => {
    const world = new VoxelWorld();
    expect([...new Set(world.blocks)].every((id) => BLOCKS[id] !== undefined)).toBe(true);
    expect(world.get(0, 0, 0)).toBe(BLOCK.Stone);
    expect(world.get(-1, 2, 2)).toBe(BLOCK.Air);
    expect(world.get(0.5, 2, 2)).toBe(BLOCK.Air);
    expect(world.consumeDirtyChunks()).toHaveLength(32);
    expect(world.consumeDirtyChunks()).toHaveLength(0);
    expect(CHUNK_SIZE).toBe(12);
  });
});

describe('transactional editing', () => {
  it('places, removes, undoes and redoes byte-for-byte', () => {
    const world = new VoxelWorld(), before = world.blocks.slice();
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
    const world = new VoxelWorld(), before = world.blocks.slice();
    expect(() => world.edit([{ x: 27, y: 6, z: 27, block: BLOCK.Brick }, { x: 48, y: 6, z: 27, block: BLOCK.Brick }])).toThrow();
    expect(world.blocks).toEqual(before);
    expect(world.canUndo).toBe(false);
    expect(() => world.set(1, 0, 1, BLOCK.Air)).toThrow(/基岩/);
    expect(() => world.set(1, 2, 1, 222)).toThrow();
    expect(() => world.set(1.5, 2, 1, BLOCK.Stone)).toThrow();
  });
  it('coalesces duplicates and retains redo for no-op edits', () => {
    const world = new VoxelWorld();
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
    const world = new VoxelWorld();
    world.consumeDirtyChunks();
    world.set(12, 12, 12, BLOCK.Brick);
    expect(world.consumeDirtyChunks()).toEqual(expect.arrayContaining([
      { x: 1, y: 1, z: 1 }, { x: 0, y: 1, z: 1 }, { x: 1, y: 0, z: 1 }, { x: 1, y: 1, z: 0 },
    ]));
    world.set(13, 13, 13, BLOCK.Brick);
    expect(world.consumeDirtyChunks()).toEqual([{ x: 1, y: 1, z: 1 }]);
  });
  it('bounds history and resets the full map state', () => {
    const world = new VoxelWorld();
    for (let i = 0; i < 220; i++) world.set(27, 6, 27, i % 2 ? BLOCK.Stone : BLOCK.Brick);
    expect(world.undoCount).toBe(200);
    world.reset('replacement');
    expect(world.seed).toBe('replacement');
    expect(world.editCount).toBe(0);
    expect(world.canUndo).toBe(false);
    expect(world.canRedo).toBe(false);
    expect(world.consumeDirtyChunks()).toHaveLength(32);
  });
});

describe('save snapshots', () => {
  it('round-trips built blocks and explicit deletion of generated terrain', () => {
    const world = new VoxelWorld('save-me');
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
    const world = new VoxelWorld();
    world.set(27, 6, 27, BLOCK.Brick);
    const before = world.serialize(), snapshot = JSON.parse(before);
    for (const bad of [
      '{', 'null', JSON.stringify({ ...snapshot, version: 999 }),
      JSON.stringify({ ...snapshot, generatorVersion: 999 }),
      JSON.stringify({ ...snapshot, size: [48, 24, 49] }),
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
    world.load(new VoxelWorld('other').serialize());
    expect(world.seed).toBe('other');
    expect(world.editCount).toBe(0);
    expect(world.canUndo).toBe(false);
  });
});

describe('voxel DDA picking', () => {
  it('hits grass from above with a usable placement face', () => {
    const world = new VoxelWorld();
    const hit = world.raycast([27.5, 30, 27.5], [0, -10, 0]);
    expect(hit).toEqual({ cell: [27, 5, 27], normal: [0, 1, 0], adjacent: [27, 6, 27], block: BLOCK.Grass, distance: 24 });
    expect(world.raycast([27.5, 30, 27.5], [0, -1, 0], 23.9)).toBeNull();
    expect(world.raycast([27.5, 30, 27.5], [0, -1, 0], 24)?.cell).toEqual([27, 5, 27]);
  });
  it('supports every axis and non-normalized directions', () => {
    const world = new VoxelWorld();
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
    const world = new VoxelWorld();
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
