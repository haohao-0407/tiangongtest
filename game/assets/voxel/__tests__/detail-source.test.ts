import { describe, expect, it } from 'vitest';
import { BLOCK, BLOCKS, DETAIL_TILE_SIZE, VoxelWorld } from '../model.ts';

const makeWorld = () => new VoxelWorld('detail-source', { width: 48, height: 24, depth: 48 });

describe('semantic detail source persistence', () => {
  it('round-trips roads and wall nodes with their source altitude and transactional history', () => {
    const world = makeWorld();
    const original = world.get(27, 5, 27);
    expect(BLOCKS[BLOCK.Road]).toMatchObject({ name: '道路', solid: true, buildable: true });
    world.edit([
      { x: 27, y: 5, z: 27, block: BLOCK.Road },
      { x: 28, y: 6, z: 27, block: BLOCK.Brick },
      { x: 28, y: 7, z: 27, block: BLOCK.Brick },
    ]);
    expect(world.terrainHeight(27, 27)).toBe(6);
    expect(world.count(BLOCK.Road)).toBe(1);
    expect(world.getDetailCellsForTile(3, 3, 0)).toHaveLength(3);
    const restored = VoxelWorld.deserialize(world.serialize());
    expect(restored.blocks).toEqual(world.blocks);
    expect(restored.getDetailCellsForTile(3, 3, 0)).toEqual(world.getDetailCellsForTile(3, 3, 0));
    expect(restored.consumePcgDirtyTiles()).toEqual({ reset: true, tiles: [{ x: 3, z: 3 }] });
    expect(restored.canUndo).toBe(false);
    expect(world.undo()).toBe(true);
    expect(world.get(27, 5, 27)).toBe(original);
    expect(world.count(BLOCK.Road)).toBe(0);
    expect(world.getDetailTiles()).toEqual([]);
    expect(world.redo()).toBe(true);
    expect(world.getDetailCellsForTile(3, 3, 0)).toEqual(restored.getDetailCellsForTile(3, 3, 0));
  });

  it('loads new road edits over a legacy generator without changing its untouched terrain', () => {
    const legacy = { version: 1, generatorVersion: 1, seed: '森屿-042', size: [48, 24, 48], edits: [] as number[][] };
    const original = VoxelWorld.deserialize(JSON.stringify(legacy));
    legacy.edits.push([original.index(27, 5, 27), BLOCK.Road]);
    const loaded = VoxelWorld.deserialize(JSON.stringify(legacy));
    expect(loaded.generatorVersion).toBe(1);
    expect(loaded.get(27, 5, 27)).toBe(BLOCK.Road);
    expect(loaded.get(26, 5, 27)).toBe(original.get(26, 5, 27));
    expect(JSON.parse(loaded.serialize()).edits).toEqual(legacy.edits);
    expect(loaded.getDetailCellsForTile(3, 3, 0)).toEqual([{ x: 27, y: 5, z: 27, block: BLOCK.Road }]);
  });
});

describe('independent incremental detail invalidation', () => {
  it('tracks a halo across diagonal tile boundaries even after terrain dirty is consumed', () => {
    const world = makeWorld();
    expect(DETAIL_TILE_SIZE).toBe(8);
    expect(world.consumePcgDirtyTiles()).toEqual({ reset: true, tiles: [] });
    world.consumeDirtyChunks();
    world.set(8, 20, 8, BLOCK.Brick);
    expect(world.consumeDirtyChunks()).not.toHaveLength(0);
    expect(world.consumePcgDirtyTiles()).toEqual({ reset: false, tiles: [
      { x: 0, z: 0 }, { x: 1, z: 0 }, { x: 0, z: 1 }, { x: 1, z: 1 },
    ] });
    expect(world.consumePcgDirtyTiles()).toEqual({ reset: false, tiles: [] });
    expect(world.getDetailCellsForTile(0, 0, 0)).toEqual([]);
    expect(world.getDetailCellsForTile(0, 0, 2)).toEqual([{ x: 8, y: 20, z: 8, block: BLOCK.Brick }]);
    // Natural occluders participate in invalidation although they are never detail sources.
    world.set(9, 20, 8, BLOCK.Stone);
    expect(world.consumePcgDirtyTiles().tiles).toContainEqual({ x: 1, z: 1 });
    expect(world.getDetailCellsForTile(1, 1, 0)).toHaveLength(1);
    expect(world.consumeDirtyChunks()).not.toHaveLength(0);
  });

  it('keeps deleted source tiles dirty for renderer cleanup and removes stale sparse entries', () => {
    const world = makeWorld();
    world.consumePcgDirtyTiles();
    world.set(47, 20, 47, BLOCK.Road);
    expect(world.getDetailTiles()).toEqual([{ x: 5, z: 5 }]);
    expect(world.consumePcgDirtyTiles()).toEqual({ reset: false, tiles: [{ x: 5, z: 5 }] });
    world.set(47, 20, 47, BLOCK.Air);
    expect(world.getDetailTiles()).toEqual([]);
    expect(world.getDetailCellsForTile(5, 5)).toEqual([]);
    expect(world.consumePcgDirtyTiles()).toEqual({ reset: false, tiles: [{ x: 5, z: 5 }] });
    world.undo();
    expect(world.getDetailCellsForTile(5, 5)).toEqual([{ x: 47, y: 20, z: 47, block: BLOCK.Road }]);
    world.redo();
    expect(world.getDetailCellsForTile(5, 5)).toEqual([]);
  });

  it('atomically preserves the sparse index on rejected edits and clears it when replacing a world', () => {
    const world = makeWorld();
    world.set(27, 20, 27, BLOCK.Brick);
    world.consumePcgDirtyTiles();
    const before = world.getDetailCellsForTile(3, 3);
    expect(() => world.edit([
      { x: 27, y: 20, z: 27, block: BLOCK.Air },
      { x: 28, y: 20, z: 27, block: BLOCK.Road + 1 },
    ])).toThrow();
    expect(world.getDetailCellsForTile(3, 3)).toEqual(before);
    expect(world.consumePcgDirtyTiles()).toEqual({ reset: false, tiles: [] });
    expect(() => world.load('{')).toThrow();
    expect(world.getDetailCellsForTile(3, 3)).toEqual(before);
    const roadMap = makeWorld();
    roadMap.set(7, 20, 7, BLOCK.Road);
    world.load(roadMap.serialize());
    expect(world.getDetailTiles()).toEqual([{ x: 0, z: 0 }]);
    expect(world.consumePcgDirtyTiles()).toEqual({ reset: true, tiles: [{ x: 0, z: 0 }] });
    world.reset('fresh-detail', { width: 32, height: 24, depth: 32 });
    expect(world.getDetailTiles()).toEqual([]);
    expect(world.consumePcgDirtyTiles()).toEqual({ reset: true, tiles: [] });
  });
});
