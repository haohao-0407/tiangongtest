import { describe, expect, it, vi } from 'vitest';
import type { World } from '@forgeax/engine/ecs';
import type { AssetRegistry } from '@forgeax/engine/assets-runtime';
import type { VoxelWorld } from '../model.ts';
import type { TreeInstance } from '../trees.ts';

vi.mock('@forgeax/engine/geometry', () => ({ createMeshBuilder: (mesh: unknown) => ({ build: () => ({ unwrap: () => mesh }) }) }));
vi.mock('@forgeax/engine/render', () => ({ Materials: { standard: (data: unknown) => data }, MeshFilter: 'mesh', MeshRenderer: 'renderer', ShadowParticipation: 'shadow' }));
vi.mock('@forgeax/engine/scene', () => ({ Name: 'name', Transform: 'transform' }));
import { TreeView } from '../tree-view.ts';

const tree: TreeInstance = { id: 'oak', x: 3, y: 4, z: 5, trunkHeight: 4, crownRadius: 2, variant: 0, rotation: 0 };
function fixture(initial: TreeInstance[]) {
  let trees = initial, sequence = 0;
  const entities = new Map<number, Map<string, any>>(), assets = new Map<number, unknown>();
  const source = { getTrees: () => trees } as unknown as VoxelWorld;
  const world = {
    spawn: (...components: { component: string; data: unknown }[]) => ({ unwrap: () => {
      const id = ++sequence; entities.set(id, new Map(components.map(item => [item.component, item.data]))); return id;
    } }),
    set: (id: number, component: string, data: unknown) => ({ unwrap: () => { expect(entities.has(id)).toBe(true); entities.get(id)!.set(component, data); } }),
    despawn: (id: number) => ({ unwrap: () => { expect(entities.delete(id)).toBe(true); } }),
  } as unknown as World;
  const registry = {
    create: (value: unknown) => ({ unwrap: () => { const id = ++sequence; assets.set(id, value); return id; } }),
    release: (id: number) => ({ unwrap: () => { expect(assets.delete(id)).toBe(true); } }),
  } as unknown as AssetRegistry;
  return { source, view: new TreeView(world, registry), entities, assets, setTrees: (next: TreeInstance[]) => { trees = next; } };
}

describe('whole-tree renderer lifecycle', () => {
  it('shares a merged mesh across positions and rotations and highlights the entire selected tree', () => {
    const { source, view, entities, assets } = fixture([tree, { ...tree, id: 'second', x: 9, rotation: 1 }]);
    expect(view.update(source)).toBe(true);
    expect(view.read().instances).toBe(2); expect(view.read().meshes).toBe(1);
    expect(entities.size).toBe(2); expect(assets.size).toBe(3);
    expect(view.read().triangles).toBe(view.read().uniqueTriangles * 2);
    const [first, second] = [...entities.values()];
    expect(first!.get('mesh')).toEqual(second!.get('mesh'));
    expect(second!.get('transform').pos).toEqual([9.5, 4, 5.5]);
    expect(second!.get('transform').quat[1]).toBeCloseTo(-Math.SQRT1_2);
    const normalMaterial = first!.get('renderer').materials[0];
    expect(view.update(source, tree.id)).toBe(true);
    expect(first!.get('renderer').materials[0]).not.toBe(normalMaterial);
    expect(second!.get('renderer').materials[0]).toBe(normalMaterial);
    expect(view.read().selectedTreeId).toBe(tree.id);
    expect(view.update(source, tree.id)).toBe(false);
    expect(assets.size).toBe(3);
    view.dispose(); expect(entities.size).toBe(0); expect(assets.size).toBe(0);
  });

  it('releases unused variants after whole-tree removal and rebuilds on undo or world replacement', () => {
    const { source, view, entities, assets, setTrees } = fixture([tree, { ...tree, id: 'short', trunkHeight: 3 }]);
    view.update(source, tree.id); expect(view.read().meshes).toBe(2);
    setTrees([{ ...tree, id: 'short', trunkHeight: 3 }]); view.update(source, tree.id);
    expect(view.read().selectedTreeId).toBeNull(); expect(view.read().meshes).toBe(1); expect(assets.size).toBe(3);
    setTrees([]); view.update(source);
    expect(entities.size).toBe(0); expect(assets.size).toBe(2);
    setTrees([tree]); view.update(source); expect(entities.size).toBe(1);
    const oldEntity = [...entities.keys()][0];
    const replacement = { getTrees: () => [{ ...tree, variant: 2, y: 8 }] } as unknown as VoxelWorld;
    view.update(replacement);
    expect(entities.has(oldEntity!)).toBe(false); expect(entities.size).toBe(1); expect(assets.size).toBe(3);
    expect([...entities.values()][0]!.get('transform').pos).toEqual([3.5, 8, 5.5]);
    view.dispose(); view.dispose();
    expect(entities.size).toBe(0); expect(assets.size).toBe(0); expect(view.read().materials).toBe(0);
    expect(view.update(source)).toBe(false);
  });

  it('updates reused tree IDs and clears both entity and mesh ownership explicitly', () => {
    const { source, view, entities, assets, setTrees } = fixture([tree]);
    view.update(source);
    const entity = [...entities.keys()][0]!;
    setTrees([{ ...tree, x: 7, rotation: 2 }]); view.update(source);
    expect([...entities.keys()]).toEqual([entity]); expect(assets.size).toBe(3);
    expect(entities.get(entity)!.get('transform').pos).toEqual([7.5, 4, 5.5]);
    setTrees([{ ...tree, trunkHeight: 3 }]); view.update(source);
    expect(entities.has(entity)).toBe(false); expect(view.read().meshes).toBe(1); expect(assets.size).toBe(3);
    view.clear(); expect(entities.size).toBe(0); expect(assets.size).toBe(2);
    view.update(source); expect(entities.size).toBe(1);
    view.dispose(); expect(assets.size).toBe(0);
  });
});
