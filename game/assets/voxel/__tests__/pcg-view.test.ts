import { describe, expect, it, vi } from 'vitest';
import type { World } from '@forgeax/engine/ecs';
import type { AssetRegistry } from '@forgeax/engine/assets-runtime';
import { BLOCK, VoxelWorld, type BlockEdit } from '../model.ts';

// Exercise the real recipes, cache and collision code without a graphics device.
vi.mock('@forgeax/engine/geometry', () => ({ createMeshBuilder: (mesh: unknown) => ({ build: () => ({ unwrap: () => mesh }) }) }));
vi.mock('@forgeax/engine/render', () => ({ Materials: { standard: (data: unknown) => data }, MeshFilter: 'mesh', MeshRenderer: 'renderer', ShadowParticipation: 'shadow' }));
vi.mock('@forgeax/engine/scene', () => ({ Name: 'name', Transform: 'transform' }));
import { PcgView } from '../pcg/view.ts';

function fixture() {
  const source = new VoxelWorld('pcg-view', { width: 16, height: 8, depth: 16 });
  const edits: BlockEdit[] = [];
  for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) for (let y = 1; y < 8; y++)
    edits.push({ x, y, z, block: y === 1 ? BLOCK.Dirt : y === 2 ? BLOCK.Grass : BLOCK.Air });
  source.edit(edits);
  let sequence = 0;
  const liveEntities = new Set<number>(), liveAssets = new Set<number>();
  const world = {
    spawn: () => ({ unwrap: () => { const id = ++sequence; liveEntities.add(id); return id; } }),
    despawn: (id: number) => ({ unwrap: () => { expect(liveEntities.delete(id)).toBe(true); } }),
  } as unknown as World;
  const assets = {
    create: () => ({ unwrap: () => { const id = ++sequence; liveAssets.add(id); return id; } }),
    replace: (id: number) => ({ unwrap: () => { expect(liveAssets.has(id)).toBe(true); } }),
    release: (id: number) => ({ unwrap: () => { expect(liveAssets.delete(id)).toBe(true); } }),
  } as unknown as AssetRegistry;
  return { source, view: new PcgView(world, assets), liveEntities, liveAssets };
}

describe('PCG renderer cache and derived collisions', () => {
  it('rebuilds cross-tile sidewalk geometry and removes its collision when the source disappears', () => {
    const { source, view, liveEntities, liveAssets } = fixture();
    source.set(7, 2, 7, BLOCK.Road);
    expect(view.update(source, [])).toBe(true);
    expect(view.read().sidewalks).toBe(4);
    expect(view.read().tiles).toBeGreaterThan(1);
    expect(view.walkHeight(8.125, 7.5, 3)).toBe(3.125);
    expect(view.blocks([8.1, 3.001, 7.4], [8.2, 4.8, 7.6])).toBe(true);
    expect(view.update(source, [])).toBe(false);
    source.set(7, 2, 7, BLOCK.Grass);
    expect(view.update(source, [])).toBe(true);
    expect(view.read().tiles).toBe(0);
    expect(view.walkHeight(8.125, 7.5, 3)).toBe(3);
    expect(view.blocks([8.1, 3.001, 7.4], [8.2, 4.8, 7.6])).toBe(false);
    expect(liveEntities.size).toBe(0);
    expect(liveAssets.size).toBe(1); // Shared material remains until disposal.
    view.dispose();
    expect(liveAssets.size).toBe(0);
  });

  it('provides eight climbable risers with matching collision across a tile boundary', () => {
    const { source, view } = fixture();
    source.edit([{ x: 7, y: 2, z: 6, block: BLOCK.Road }, { x: 8, y: 3, z: 6, block: BLOCK.Road }]);
    view.update(source, []);
    expect(view.read().stairs).toBe(1);
    let lastHeight = 3 + 1 / 16;
    for (let step = 0; step < 8; step++) {
      const x = 7 + (step + .5) / 8;
      const top = view.surfaceHeight(x, 6.5, 3, lastHeight + .25);
      expect(top - lastHeight).toBeCloseTo(1 / 8);
      expect(view.blocks([x - .01, top - .05, 6.49], [x + .01, top + 1.8, 6.51])).toBe(true);
      expect(view.blocks([x - .01, top + .0001, 6.49], [x + .01, top + 1.8, 6.51])).toBe(false);
      lastHeight = top;
    }
    expect(view.walkHeight(8.01, 6.5, 4)).toBe(lastHeight);
    view.dispose();
  });

  it('preserves full colony wall collision behind windows and clears it on demolition', () => {
    const { source, view, liveEntities } = fixture();
    const walls = [6, 7, 8].map(x => ({ id: `wall-${x}`, kind: 'wall', x, y: 3, z: 7, complete: true, w: 1, d: 1 }));
    view.update(source, walls);
    expect(view.read().windows).toBeGreaterThan(0);
    expect(view.blocks([7.3, 3.6, 7.3], [7.7, 4.7, 7.7])).toBe(true);
    expect(view.blocks([7.3, 3.3, 8.1], [7.7, 4.7, 8.2])).toBe(true); // Protruding sill.
    view.update(source, []);
    expect(view.blocks([7.3, 3.6, 7.3], [7.7, 4.7, 7.7])).toBe(false);
    expect(view.read().windows).toBe(0);
    expect(liveEntities.size).toBe(0);
    view.dispose();
  });

  it('supports the whole player footprint when a narrow curb lies between point probes', () => {
    const { source, view } = fixture();
    source.set(7, 2, 7, BLOCK.Road);
    view.update(source, []);
    const x = 7.5, z = 7.174, half = .28;
    const top = view.supportHeight(x - half, z - half, x + half, z + half, 3, 3.25);
    expect(top).toBe(3 + 3 / 16);
    expect(view.blocks([x - half, top + .0001, z - half], [x + half, top + 1.8, z + half])).toBe(false);
    expect(view.blocks([x - half, top - 1 / 16, z - half], [x + half, top + 1.8, z + half])).toBe(true);
    view.dispose();
  });

  it('replaces stale geometry and surface caches on load, including a reused source instance', () => {
    const { source, view, liveEntities, liveAssets } = fixture();
    source.set(7, 2, 7, BLOCK.Road);
    view.update(source, []);
    const replacement = fixture();
    replacement.source.set(12, 2, 12, BLOCK.Road);
    source.load(replacement.source.serialize());
    view.update(source, []);
    expect(view.walkHeight(8.125, 7.5, 3)).toBe(3);
    expect(view.walkHeight(12.5, 12.5, 3)).toBe(3 + 1 / 16);
    expect(liveEntities.size).toBe(view.read().tiles);
    expect(liveAssets.size).toBe(liveEntities.size + 1);
    view.clear();
    expect(liveEntities.size).toBe(0);
    expect(view.walkHeight(12.5, 12.5, 3)).toBe(3);
    view.update(source, []); // Identity change after clear must rebuild even with no dirty edits.
    expect(view.walkHeight(12.5, 12.5, 3)).toBe(3 + 1 / 16);
    view.dispose(); replacement.view.dispose();
  });
});
