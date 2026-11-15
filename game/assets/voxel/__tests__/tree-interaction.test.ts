import { describe, it, expect } from 'vitest';
import { VoxelWorld } from '../model.ts';
import { raycastTree, treesBlockBox, treeSupportHeight, treeProtectingVoxel } from '../tree-interaction.ts';
import { treeParts, type TreeInstance } from '../trees.ts';

const tree: TreeInstance = { id: 'tree:test', x: 20, y: 7, z: 20, trunkHeight: 4, crownRadius: 2, variant: 0, rotation: 0 };
describe('single tree interaction', () => {
  it('selects the same object from trunk and crown while obeying foreground occlusion', () => {
    const trunk = raycastTree([tree], [20.5, 8, 25], [0, 0, -1]);
    const crown = raycastTree([tree], [21.5, 20, 20.5], [0, -1, 0]);
    expect(trunk?.part.role).toBe('trunk'); expect(crown?.part.role).toBe('crown');
    expect(trunk?.tree.id).toBe(crown?.tree.id);
    expect(raycastTree([tree], [20.5, 8, 25], [0, 0, -1], 2)).toBeNull();
    expect(raycastTree([tree], [25, 8, 25], [0, 0, -1])).toBeNull();
  });
  it('returns the nearest independent tree even when their crowns overlap', () => {
    const other = { ...tree, id: 'tree:other', z: 23 };
    expect(raycastTree([tree, other], [20.5, 11, 30], [0, 0, -1])?.tree.id).toBe(other.id);
    expect(raycastTree([other, tree], [20.5, 11, 15], [0, 0, 1])?.tree.id).toBe(tree.id);
  });
  it('uses the model surface for player collision and footing, without a full-cell invisible wall', () => {
    const world = VoxelWorld.deserialize(JSON.stringify({ version: 1, generatorVersion: 1, seed: 'tree-interaction', size: [48,24,48], edits: [], treeVersion: 1, trees: [tree] }));
    expect(treesBlockBox(world, [20.3,8,20.3], [20.7,9.8,20.7])).toBe(true);
    expect(treesBlockBox(world, [20,8,20], [20.2,9.8,20.2])).toBe(false);
    const top = Math.max(...treeParts(tree).map(p => p.max[1]));
    expect(treeSupportHeight(world,20.4,20.4,20.6,20.6,7,top)).toBe(top);
    expect(treeSupportHeight(world,20.4,20.4,20.6,20.6,7,9)).toBe(7.375);
    expect(treeProtectingVoxel(world,20,6,20)?.id).toBe(tree.id);
    expect(world.removeTree(tree.id)).toBe(true);
    expect(treesBlockBox(world, [20.3,8,20.3], [20.7,9.8,20.7])).toBe(false);
    expect(world.undo(undefined, () => false)).toBe(false);
    expect(world.getTree(tree.id)).toBeUndefined();
    expect(world.undo()).toBe(true);
    expect(treesBlockBox(world, [20.3,8,20.3], [20.7,9.8,20.7])).toBe(true);
  });
});
