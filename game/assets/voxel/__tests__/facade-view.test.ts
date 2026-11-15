import { describe, expect, it, vi } from 'vitest';
import type { World } from '@forgeax/engine/ecs';
import type { AssetRegistry } from '@forgeax/engine/assets-runtime';
import { BLOCK, VoxelWorld, type BlockEdit } from '../model.ts';
import type { PcgBuilding } from '../pcg/rules.ts';

// Keep real layout, microvoxel meshing, spatial buckets and world history in this integration test.
vi.mock('@forgeax/engine/geometry', () => ({ createMeshBuilder: (mesh: unknown) => ({ build: () => ({ unwrap: () => mesh }) }) }));
vi.mock('@forgeax/engine/render', () => ({ Materials: { standard: (data: unknown) => data }, MeshFilter: 'mesh', MeshRenderer: 'renderer', ShadowParticipation: 'shadow' }));
vi.mock('@forgeax/engine/scene', () => ({ Name: 'name', Transform: 'transform' }));
import { PcgView } from '../pcg/view.ts';

function render(source: VoxelWorld) {
  let sequence = 0;
  const entities = new Set<number>(), assets = new Map<number, unknown>();
  const world = {
    spawn: () => ({ unwrap: () => { const id = ++sequence; entities.add(id); return id; } }),
    despawn: (id: number) => ({ unwrap: () => { expect(entities.delete(id)).toBe(true); } }),
  } as unknown as World;
  const registry = {
    create: (data: unknown) => ({ unwrap: () => { const id = ++sequence; assets.set(id, data); return id; } }),
    replace: (id: number, data: unknown) => ({ unwrap: () => { expect(assets.has(id)).toBe(true); assets.set(id, data); } }),
    release: (id: number) => ({ unwrap: () => { expect(assets.delete(id)).toBe(true); } }),
  } as unknown as AssetRegistry;
  return { source, view: new PcgView(world, registry), entities, assets };
}

function fixture() {
  const source = new VoxelWorld('facade-view', { width: 32, height: 8, depth: 32 });
  const edits: BlockEdit[] = [];
  for (let z = 0; z < 32; z++) for (let x = 0; x < 32; x++) for (let y = 1; y < 8; y++)
    edits.push({ x, y, z, block: y === 1 ? BLOCK.Dirt : y === 2 ? BLOCK.Grass : BLOCK.Air });
  source.edit(edits);
  return render(source);
}

const wall = (start = 4, end = 25, z = 10, skip: number[] = []): BlockEdit[] => {
  const edits: BlockEdit[] = [];
  for (let x = start; x <= end; x++) if (!skip.includes(x)) for (const y of [3, 4]) edits.push({ x, y, z, block: BLOCK.Brick });
  return edits;
};
const groups = (view: PcgView) => structuredClone(view.read().layout.groups).sort((a, b) => a.id.localeCompare(b.id));
const features = (view: PcgView) => structuredClone(view.read().features)
  .filter(f => f.kind === 'window' || f.kind === 'sill').sort((a, b) => a.id.localeCompare(b.id));

describe('whole-facade layout integration', () => {
  it('makes cross-cell window groups with continuous sills and quantized native meshes', () => {
    const { source, view, assets } = fixture();
    source.edit(wall()); view.update(source, []);
    const layout = groups(view), output = view.read();
    expect(output.resolution).toBe(16);
    expect(layout.length).toBeGreaterThan(0);
    expect(layout.length).toBeLessThan(22);
    expect(layout.some(g => g.u1 - g.u0 >= 1.5 && Math.floor(g.u0) !== Math.floor(g.u1 - 1e-6))).toBe(true);
    for (const group of layout) {
      const opening = output.features.find(f => f.kind === 'window' && f.id === group.id);
      expect(opening).toBeDefined();
      const sills = output.features.filter(f => f.kind === 'sill' && f.groupId === group.id);
      expect(sills.length).toBeGreaterThan(0);
      expect(sills.length).toBeLessThanOrEqual(2); // One whole sill on each exposed side, never one per source cell.
      const axis = group.axis === 'x' ? 0 : 2;
      for (const sill of sills) expect(sill.max[axis]! - sill.min[axis]!).toBeGreaterThan(group.u1 - group.u0);
    }
    const meshes = [...assets.values()].filter((value): value is { attributes: { position: Float32Array } } =>
      !!value && typeof value === 'object' && 'attributes' in value);
    expect(meshes.length).toBeGreaterThan(1);
    for (const mesh of meshes) for (const coordinate of mesh.attributes.position)
      expect(coordinate * 16).toBe(Math.round(coordinate * 16));
    view.dispose(); expect(assets.size).toBe(0);
  });

  it('keeps existing window identities and bounds when an end grows or an unrelated wall changes', () => {
    const { source, view } = fixture();
    source.edit(wall()); view.update(source, []);
    const before = groups(view);
    source.edit(wall(26, 27)); view.update(source, []);
    for (const group of before) expect(groups(view).find(g => g.id === group.id)).toEqual(group);
    const extended = groups(view);
    source.edit(wall(4, 9, 24)); view.update(source, []);
    for (const group of extended) expect(groups(view).find(g => g.id === group.id)).toEqual(group);
    view.dispose();
  });

  it('retains real player edit ordering while adding another window group at the extended end', () => {
    const { source, view } = fixture();
    view.update(source, []);
    for (const y of [3, 4]) for (let x = 8; x <= 23; x++) if (x < 14 || x >= 16) {
      source.set(x, y, 10, BLOCK.Brick); view.update(source, []);
    }
    const before = groups(view);
    expect(before.length).toBeGreaterThan(0); expect(before.length).toBeLessThan(14);
    for (const y of [3, 4]) for (const x of [24, 25, 26]) {
      source.set(x, y, 10, BLOCK.Brick); view.update(source, []);
    }
    const after = groups(view);
    for (const group of before) expect(after.find(g => g.id === group.id)).toEqual(group);
    expect(after.length).toBeGreaterThan(before.length);
    view.dispose();
  });

  it('does not bridge an entrance under a lintel with a window or sill', () => {
    const { source, view } = fixture();
    source.edit([...wall(4, 25, 10, [14, 15]), ...Array.from({ length: 22 }, (_, i) => ({ x: i + 4, y: 5, z: 10, block: BLOCK.Brick }))]);
    const entrance: PcgBuilding = { id: 'entrance', kind: 'door', x: 14, y: 3, z: 10, w: 2, d: 1, complete: true };
    view.update(source, [entrance]);
    expect(groups(view).length).toBeGreaterThan(0);
    for (const feature of features(view)) if (feature.min[1] < 5)
      expect(feature.max[0] <= 14 || feature.min[0] >= 16).toBe(true);
    expect(view.blocks([14.3, 3.01, 10.2], [15.7, 4.79, 10.8])).toBe(false);
    expect(source.get(14, 3, 10)).toBe(BLOCK.Air);
    view.dispose();
  });

  it('cleans a broken group and restores the exact layout through undo, redo and load', () => {
    const { source, view } = fixture();
    source.edit(wall()); view.update(source, []);
    const before = groups(view), beforeFeatures = features(view);
    const target = before.find(g => g.axis === 'x' && g.u1 - g.u0 >= 1.5)!;
    expect(target).toBeDefined();
    const x = Math.floor((target.u0 + target.u1) / 2);
    source.set(x, 4, 10, BLOCK.Air); view.update(source, []);
    const removed = groups(view), removedFeatures = features(view);
    expect(removed.some(g => g.id === target.id)).toBe(false);
    for (const feature of removedFeatures) if (feature.min[1] < 5)
      expect(feature.max[0] <= x || feature.min[0] >= x + 1).toBe(true);
    expect(source.undo()).toBe(true); view.update(source, []);
    expect(groups(view)).toEqual(before); expect(features(view)).toEqual(beforeFeatures);
    expect(source.redo()).toBe(true); view.update(source, []);
    expect(groups(view)).toEqual(removed); expect(features(view)).toEqual(removedFeatures);
    expect(source.undo()).toBe(true); view.update(source, []);
    const serialized = source.serialize();
    const loaded = render(VoxelWorld.deserialize(serialized)); loaded.view.update(loaded.source, []);
    expect(groups(loaded.view)).toEqual(before); expect(features(loaded.view)).toEqual(beforeFeatures);
    expect(loaded.source.canUndo).toBe(false);
    source.load(serialized); view.update(source, []);
    expect(groups(view)).toEqual(before); expect(features(view)).toEqual(beforeFeatures);
    view.dispose(); loaded.view.dispose();
  });

  it('preserves later colony window placements when undoing an unrelated older voxel edit', () => {
    const { source, view } = fixture();
    view.update(source, []);
    source.set(1, 6, 1, BLOCK.Stone); view.update(source, []);
    const walls = (count: number): PcgBuilding[] => Array.from({ length: count }, (_, i) =>
      ({ id: `colony-wall-${i}`, kind: 'wall', x: 4 + i, y: 3, z: 8, complete: true }));
    view.update(source, walls(3));
    const originalGroup = groups(view)[0]!;
    expect(originalGroup).toBeDefined();
    view.update(source, walls(6));
    const before = groups(view), beforeFeatures = features(view);
    expect(before.find(g => g.id === originalGroup.id)).toEqual(originalGroup);
    expect(before.length).toBeGreaterThan(1);

    expect(source.undo()).toBe(true); view.update(source, walls(6));
    expect(source.get(1, 6, 1)).toBe(BLOCK.Air);
    expect(groups(view)).toEqual(before); expect(features(view)).toEqual(beforeFeatures);
    expect(source.redo()).toBe(true); view.update(source, walls(6));
    expect(source.get(1, 6, 1)).toBe(BLOCK.Stone);
    expect(groups(view)).toEqual(before); expect(features(view)).toEqual(beforeFeatures);
    expect(source.undo()).toBe(true); view.update(source, walls(6));
    expect(groups(view)).toEqual(before); expect(features(view)).toEqual(beforeFeatures);

    const loaded = render(VoxelWorld.deserialize(source.serialize())); loaded.view.update(loaded.source, walls(6));
    expect(groups(loaded.view)).toEqual(before); expect(features(loaded.view)).toEqual(beforeFeatures);
    view.dispose(); loaded.view.dispose();
  });

  it('settles each edit layout when several source transactions precede the next render', () => {
    const { source, view } = fixture();
    source.edit(wall(4, 7, 8)); view.update(source, []);
    const before = groups(view), beforeFeatures = features(view);
    expect(before).toHaveLength(1);
    expect(before[0]!.u1 - before[0]!.u0).toBe(3);

    source.set(4, 4, 8, BLOCK.Air);
    source.set(1, 6, 1, BLOCK.Stone); // A second transaction before any mesh update.
    view.update(source, []);
    const damaged = groups(view), damagedFeatures = features(view);
    expect(damaged).toHaveLength(1);
    expect(damaged[0]!.u1 - damaged[0]!.u0).toBe(2);

    expect(source.undo()).toBe(true); view.update(source, []);
    expect(source.get(1, 6, 1)).toBe(BLOCK.Air);
    expect(source.get(4, 4, 8)).toBe(BLOCK.Air);
    expect(groups(view)).toEqual(damaged); expect(features(view)).toEqual(damagedFeatures);
    expect(source.undo()).toBe(true); view.update(source, []);
    expect(source.get(4, 4, 8)).toBe(BLOCK.Brick);
    expect(groups(view)).toEqual(before); expect(features(view)).toEqual(beforeFeatures);

    expect(source.redo()).toBe(true); view.update(source, []);
    expect(source.get(1, 6, 1)).toBe(BLOCK.Air);
    expect(groups(view)).toEqual(damaged); expect(features(view)).toEqual(damagedFeatures);
    expect(source.redo()).toBe(true); view.update(source, []);
    expect(source.get(1, 6, 1)).toBe(BLOCK.Stone);
    expect(groups(view)).toEqual(damaged); expect(features(view)).toEqual(damagedFeatures);
    expect(source.undo()).toBe(true);
    expect(source.undo()).toBe(true); // History also remains correct when undo steps share a render.
    view.update(source, []);
    expect(groups(view)).toEqual(before); expect(features(view)).toEqual(beforeFeatures);
    view.dispose();
  });

  it('indexes a crossing sill in both mesh tiles and clears its far-side collision', () => {
    const { source, view, assets, entities } = fixture();
    source.edit(wall(1, 30)); view.update(source, []);
    const sill = features(view).find(f => f.kind === 'sill' && [8, 16, 24].some(boundary => f.min[0] < boundary && f.max[0] > boundary));
    expect(sill, 'At least one whole-facade sill must cross a rendering tile boundary').toBeDefined();
    const x = sill!.max[0] - .02, y = (sill!.min[1] + sill!.max[1]) / 2, z = (sill!.min[2] + sill!.max[2]) / 2;
    const min: [number, number, number] = [x - .01, y - .01, z - .01], max: [number, number, number] = [x + .01, y + .01, z + .01];
    expect(view.blocks(min, max)).toBe(true);
    source.edit(wall(1, 30).map(e => ({ ...e, block: BLOCK.Air }))); view.update(source, []);
    expect(groups(view)).toEqual([]); expect(features(view)).toEqual([]);
    expect(view.blocks(min, max)).toBe(false);
    expect(entities.size).toBe(0); expect(assets.size).toBe(1);
    view.dispose(); expect(assets.size).toBe(0);
  });
});
