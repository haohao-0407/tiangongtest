import { describe, expect, it } from 'vitest';
import { BLOCK, VoxelWorld } from '../model.ts';
import { legacyTreeCells, treeBounds, treeCells, treeParts, type TreeInstance } from '../trees.ts';

function fixture(pair = false): VoxelWorld {
  const world = new VoxelWorld('tree-fixture', { width: 32, height: 16, depth: 32 });
  const first: TreeInstance = { id: 'oak-a', x: 14, y: 6, z: 16, trunkHeight: 3, crownRadius: 2, variant: 0, rotation: 0 };
  const trees = pair ? [first, { ...first, id: 'oak-b', x: 17, rotation: 1 }] : [first];
  return VoxelWorld.deserialize(JSON.stringify({ ...JSON.parse(world.serialize()), trees }));
}

describe('natural tree object model', () => {
  it('has stable identities and models while keeping natural wood out of raw terrain', () => {
    const a = new VoxelWorld('forest', { width: 48, height: 24, depth: 48 });
    const b = new VoxelWorld('forest', { width: 48, height: 24, depth: 48 });
    expect(a.getTrees()).toEqual(b.getTrees());
    expect(a.getTrees().length).toBeGreaterThan(0);
    expect(a.count(BLOCK.Wood)).toBe(0);
    expect(a.count(BLOCK.Leaves)).toBe(0);
    expect(Object.isFrozen(a.getTrees())).toBe(true);
    expect(Object.isFrozen(a.getTrees()[0])).toBe(true);
    for (const tree of a.getTrees()) {
      expect(a.treeAtColumn(tree.x, tree.z)?.id).toBe(tree.id);
      for (const part of treeParts(tree)) {
        const p = part.min.map((v, i) => Math.floor((v + part.max[i]!) / 2));
        expect(a.treesAtVoxel(p[0]!, p[1]!, p[2]!).some(t => t.id === tree.id)).toBe(true);
      }
    }
  });

  it('shares bounds, occupancy and quarter-turn rotation for all model parts', () => {
    const tree = fixture().getTrees()[0]!;
    const parts = treeParts(tree), bounds = treeBounds(tree);
    expect(new Set(parts.map(p => p.role))).toEqual(new Set(['trunk', 'branch', 'crown']));
    expect(bounds.min[1]).toBe(tree.y);
    expect(bounds.max[1]).toBe(tree.y + tree.trunkHeight + 2);
    const rotated = treeParts({ ...tree, rotation: 1 });
    expect(rotated[2]!.min[2]).toBe(tree.z + .5 + parts[2]!.min[0] - tree.x - .5);
    expect(rotated[2]!.max[0]).toBe(tree.x + .5 - (parts[2]!.min[2] - tree.z - .5));
    expect(new Set(treeCells(tree).map(c => `${c.x},${c.y},${c.z}`)).size).toBe(treeCells(tree).length);
    for (const part of parts) for (let axis = 0; axis < 3; axis++) {
      expect(part.min[axis]).toBeGreaterThanOrEqual(bounds.min[axis]!);
      expect(part.max[axis]).toBeLessThanOrEqual(bounds.max[axis]!);
      expect(Number.isInteger(part.min[axis]! * 16)).toBe(true);
      expect(Number.isInteger(part.max[axis]! * 16)).toBe(true);
    }
  });

  it.each([{ width: 48, height: 8, depth: 48 }, { width: 48, height: 12, depth: 48 }, { width: 250, height: 24, depth: 250 }])(
    'round-trips generated forests with size $width × $height × $depth, including native hillside branches', (size: { width: number; height: number; depth: number }) => {
      const world = new VoxelWorld('森屿-042', size);
      const restored = VoxelWorld.deserialize(world.serialize());
      expect(restored.getTrees()).toEqual(world.getTrees());
      expect(restored.blocks).toEqual(world.blocks);
      for (const tree of world.getTrees()) expect(treeBounds(tree).max[1]).toBeLessThanOrEqual(size.height);
    }, 20000);
});

describe('whole-tree transactions', () => {
  it('removes a whole object from any crown cell and restores the same id atomically', () => {
    const world = fixture(), tree = world.getTrees()[0]!, before = world.blocks.slice();
    const crown = treeCells(tree).find(c => c.role === 'crown')!;
    const revision = world.treeRevision;
    world.consumePcgDirtyTiles();
    expect(world.set(crown.x, crown.y, crown.z, BLOCK.Air)).toBe(true);
    expect(world.getTrees()).toHaveLength(0);
    expect(world.blocks).toEqual(before);
    expect(world.undoCount).toBe(1);
    expect(world.treeRevision).toBeGreaterThan(revision);
    expect(world.consumePcgDirtyTiles().tiles.length).toBeGreaterThan(0);
    expect(world.undo()).toBe(true);
    expect(world.getTrees()).toEqual([tree]);
    expect(world.treeAtVoxel(crown.x, crown.y, crown.z)?.id).toBe(tree.id);
    expect(world.redo()).toBe(true);
    expect(world.getTrees()).toHaveLength(0);
    expect(VoxelWorld.deserialize(world.serialize()).getTrees()).toHaveLength(0);
  });

  it('keeps adjacent and overlapping crowns independent when removing by identity', () => {
    const world = fixture(true), [a, b] = world.getTrees();
    const overlap = treeCells(a!).find(c => world.treesAtVoxel(c.x, c.y, c.z).length === 2)!;
    expect(overlap).toBeDefined();
    expect(world.treesInColumn(overlap.x, overlap.z)).toHaveLength(2);
    world.removeTree(a!.id);
    expect(world.getTrees()).toEqual([b]);
    expect(world.treesAtVoxel(overlap.x, overlap.y, overlap.z)).toEqual([b]);
    expect(world.treeAtColumn(b!.x, b!.z)).toEqual(b);
    world.undo();
    expect(world.treesAtVoxel(overlap.x, overlap.y, overlap.z)).toHaveLength(2);
  });

  it('removes root support and the tree together, honoring restoration guards without partial changes', () => {
    const world = fixture(), tree = world.getTrees()[0]!, support = world.get(tree.x, tree.y - 1, tree.z);
    world.set(tree.x, tree.y - 1, tree.z, BLOCK.Air);
    const removed = world.serialize(), history = world.undoCount;
    expect(world.undo(undefined, trees => { expect(trees).toEqual([tree]); return false; })).toBe(false);
    expect(world.serialize()).toBe(removed);
    expect(world.undoCount).toBe(history);
    expect(world.undo(undefined, () => true)).toBe(true);
    expect(world.getTree(tree.id)).toEqual(tree);
    expect(world.get(tree.x, tree.y - 1, tree.z)).toBe(support);
    expect(world.redo()).toBe(true);
    expect(world.getTree(tree.id)).toBeUndefined();
  });

  it('rejects raw blocks inside a living tree and supports an explicit atomic clear-and-build batch', () => {
    const world = fixture(), tree = world.getTrees()[0]!, before = world.serialize();
    expect(() => world.edit([{ x: 16, y: 12, z: 16, block: BLOCK.Brick }, { x: tree.x, y: tree.y, z: tree.z, block: BLOCK.Planks }])).toThrow(/树木/);
    expect(world.serialize()).toBe(before);
    const crown = treeCells(tree).find(c => c.role === 'crown' && c.x !== tree.x)!;
    world.edit([{ ...crown, block: BLOCK.Air }, { x: tree.x, y: tree.y, z: tree.z, block: BLOCK.Planks }]);
    expect(world.getTrees()).toHaveLength(0);
    expect(world.get(tree.x, tree.y, tree.z)).toBe(BLOCK.Planks);
    expect(world.undo()).toBe(true);
    expect(world.getTree(tree.id)).toEqual(tree);
    expect(world.get(tree.x, tree.y, tree.z)).toBe(BLOCK.Air);
  });

  it('cannot resurrect harvested wood through old sandbox history', () => {
    const world = fixture(), tree = world.getTrees()[0]!;
    world.removeTree(tree.id);
    world.undo();
    expect(world.canRedo).toBe(true);
    expect(world.removeTree(tree.id, { recordHistory: false })).toBe(true);
    expect(world.canUndo).toBe(false);
    expect(world.canRedo).toBe(false);
    expect(world.undo()).toBe(false);
    expect(world.getTrees()).toHaveLength(0);
  });

  it('preserves independent facade placements when undoing a tree transaction', () => {
    const world = fixture(), tree = world.getTrees()[0]!;
    world.removeTree(tree.id);
    world.setFacadeLayout({ version: 2, groups: [] });
    const later = { version: 2 as const, groups: [{ id: 'later-window', axis: 'x' as const, plane: 7, base: 5, lower: 5.375, upper: 6.5625, u0: 4.5, u1: 6.5, panes: 2 }] };
    world.setFacadeLayout(later);
    world.undo();
    expect(world.getTree(tree.id)).toEqual(tree);
    expect(world.getFacadeLayout()).toEqual(later);
  });

  it('keeps hand-placed wood and leaves as ordinary independently editable materials', () => {
    const world = fixture();
    world.edit([{ x: 20, y: 6, z: 20, block: BLOCK.Wood }, { x: 20, y: 7, z: 20, block: BLOCK.Leaves }]);
    world.set(20, 6, 20, BLOCK.Air);
    expect(world.get(20, 7, 20)).toBe(BLOCK.Leaves);
    expect(world.getTrees()).toHaveLength(1);
    expect(VoxelWorld.deserialize(world.serialize()).get(20, 7, 20)).toBe(BLOCK.Leaves);
  });
});

describe('tree save migration and validation', () => {
  it.each([1, 2])('migrates generator %i without regrowing felled trunks or deleting surviving trees', (generatorVersion: number) => {
    const baseline = { version: 1, generatorVersion, seed: '森屿-042', size: [48, 24, 48], edits: [] as number[][] };
    const original = VoxelWorld.deserialize(JSON.stringify(baseline));
    const felled = original.getTrees()[0]!;
    // Old felling removed nearby leaves too; another intact trunk remains its own object.
    baseline.edits = legacyTreeCells(felled).map(c => [original.index(c.x, c.y, c.z), BLOCK.Air]);
    baseline.edits.push([original.index(27, 18, 27), BLOCK.Wood], [original.index(28, 18, 27), BLOCK.Leaves]);
    const migrated = VoxelWorld.deserialize(JSON.stringify(baseline));
    expect(migrated.getTree(felled.id)).toBeUndefined();
    expect(migrated.getTrees()).toEqual(original.getTrees().filter(t => t.id !== felled.id));
    expect(migrated.count(BLOCK.Wood)).toBe(1);
    expect(migrated.count(BLOCK.Leaves)).toBe(1);
    expect(VoxelWorld.deserialize(migrated.serialize()).getTrees()).toEqual(migrated.getTrees());
  });

  it('rejects corrupted tree records atomically, preserving map, trees and undo history', () => {
    const world = fixture(), tree = world.getTrees()[0]!;
    world.set(20, 7, 20, BLOCK.Brick);
    const before = world.serialize(), data = JSON.parse(before), history = world.undoCount;
    const corrupt = [
      { treeVersion: 999 }, { trees: null }, { trees: [tree, tree] },
      { trees: [{ ...tree, id: 'same-root' }, tree] }, { trees: [{ ...tree, x: 0 }] },
      { trees: [{ ...tree, trunkHeight: 2 }] }, { trees: [{ ...tree, rotation: 4 }] },
      { trees: [{ ...tree, y: tree.y + 1 }] }, { trees: [{ ...tree, crownRadius: Infinity }] },
      { edits: [...data.edits, [world.index(tree.x, tree.y, tree.z), BLOCK.Brick]] },
    ];
    for (const bad of corrupt) {
      expect(() => world.load(JSON.stringify({ ...data, ...bad }))).toThrow();
      expect(world.serialize()).toBe(before);
      expect(world.undoCount).toBe(history);
    }
  });
});
