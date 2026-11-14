import { describe, expect, it } from 'vitest';
import { MicroVolume, meshMicroVolume, type PcgMeshData } from '../geometry.ts';
import { buildPcgTile, isDetailSource, samplePcgSurfaceHeight, type PcgBuilding, type PcgSource } from '../rules.ts';

class Fixture implements PcgSource {
  width = 24; height = 12; depth = 24; revision = 0;
  data = new Uint8Array(this.width * this.height * this.depth);
  constructor() { for (let x = 0; x < this.width; x++) for (let z = 0; z < this.depth; z++) for (let y = 0; y < 4; y++) this.data[this.index(x, y, z)] = y === 3 ? 1 : 2; }
  index(x: number, y: number, z: number) { return x + this.width * (z + this.depth * y); }
  get(x: number, y: number, z: number) { return x < 0 || x >= this.width || y < 0 || y >= this.height || z < 0 || z >= this.depth ? 0 : this.data[this.index(x, y, z)]!; }
  set(x: number, y: number, z: number, block: number) { this.data[this.index(x, y, z)] = block; this.revision++; }
}

// Intersect an axis-aligned ray with the emitted triangle faces, independently of the recipes.
function nearestFrontZ(mesh: PcgMeshData, x: number, y: number): number {
  let hit = Infinity;
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const verts = [0, 1, 2].map(k => {
      const index = mesh.indices[t + k]! * 3; return Array.from(mesh.position.slice(index, index + 3));
    });
    const [a, b, c] = verts;
    if (Math.abs(a![2]! - b![2]!) > 1e-6 || Math.abs(a![2]! - c![2]!) > 1e-6) continue;
    const den = (b![1]! - c![1]!) * (a![0]! - c![0]!) + (c![0]! - b![0]!) * (a![1]! - c![1]!);
    if (Math.abs(den) < 1e-9) continue;
    const u = ((b![1]! - c![1]!) * (x - c![0]!) + (c![0]! - b![0]!) * (y - c![1]!)) / den;
    const v = ((c![1]! - a![1]!) * (x - c![0]!) + (a![0]! - c![0]!) * (y - c![1]!)) / den;
    if (u >= -1e-6 && v >= -1e-6 && u + v <= 1 + 1e-6) hit = Math.min(hit, a![2]!);
  }
  return hit;
}

describe('microvoxel geometry', () => {
  it('merges a solid 16³ cell into six faces with consistent outward winding', () => {
    const volume = new MicroVolume([0, 0, 0], [1, 1, 1]); volume.box([0, 0, 0], [1, 1, 1], 1);
    const mesh = meshMicroVolume(volume, [0, 0, 0], [1, 1, 1])!;
    expect(mesh.indices.length / 3).toBe(12);
    for (let i = 0; i < mesh.indices.length; i += 3) {
      const a = mesh.indices[i]! * 3, b = mesh.indices[i + 1]! * 3, c = mesh.indices[i + 2]! * 3;
      const ab = [0, 1, 2].map(j => mesh.position[b + j]! - mesh.position[a + j]!);
      const ac = [0, 1, 2].map(j => mesh.position[c + j]! - mesh.position[a + j]!);
      const cross = [ab[1]! * ac[2]! - ab[2]! * ac[1]!, ab[2]! * ac[0]! - ab[0]! * ac[2]!, ab[0]! * ac[1]! - ab[1]! * ac[0]!];
      expect(cross.reduce((sum, v, j) => sum + v * mesh.normal[a + j]!, 0)).toBeGreaterThan(0);
    }
  });
});

describe('structural wall generation', () => {
  it('carves real recessed windows across a two-high brick facade while retaining blocked glass semantics', () => {
    const world = new Fixture();
    for (let x = 6; x <= 9; x++) for (let y = 4; y <= 5; y++) world.set(x, y, 8, 6);
    const left = buildPcgTile(world, [], 0, 1), right = buildPcgTile(world, [], 1, 1);
    expect(left.stats.windows).toBe(4); expect(right.stats.windows).toBe(4);
    expect(left.stats.sills).toBe(4);
    // A point in a pane sees the interior glass plane, not the original front cube face z=8.
    expect(nearestFrontZ(left.mesh!, 6.3125, 4.625)).toBeCloseTo(8 + 7 / 16);
    expect(world.get(6, 4, 8)).toBe(6); // A window remains a wall for coarse movement/raycast authority.
    expect(left.features.some(f => f.kind === 'sill' && f.min[2] < 8)).toBe(true);
    for (const value of left.mesh!.position) expect(value * 16).toBe(Math.round(value * 16));
    for (let i = 0; i < left.mesh!.position.length; i += 3) expect(left.mesh!.position[i]).toBeLessThanOrEqual(8);
    for (let i = 0; i < right.mesh!.position.length; i += 3) expect(right.mesh!.position[i]).toBeGreaterThanOrEqual(8);
  });
  it('removes the dependent window when an upper source voxel is deleted, restores deterministically, and clears removed walls', () => {
    const world = new Fixture();
    for (const x of [6, 7]) for (const y of [4, 5]) world.set(x, y, 6, 6);
    const before = buildPcgTile(world, [], 0, 0);
    world.set(6, 5, 6, 0);
    expect(buildPcgTile(world, [], 0, 0).stats.windows).toBe(before.stats.windows - 2);
    world.set(6, 5, 6, 6);
    expect(buildPcgTile(world, [], 0, 0).mesh).toEqual(before.mesh);
    for (const x of [6, 7]) for (const y of [4, 5]) world.set(x, y, 6, 0);
    expect(buildPcgTile(world, [], 0, 0).mesh).toBeNull();
  });
  it('keeps corners solid, suppresses occluded facade windows, and supports completed colony walls', () => {
    const world = new Fixture();
    const buildings: PcgBuilding[] = [{ id: 'a', kind: 'wall', x: 6, y: 4, z: 6, complete: true }, { id: 'b', kind: 'wall', x: 7, y: 4, z: 6, complete: true }];
    expect(buildPcgTile(world, buildings, 0, 0).stats.windows).toBe(4);
    world.set(6, 4, 5, 3); world.set(6, 5, 5, 3);
    expect(buildPcgTile(world, buildings, 0, 0).stats.windows).toBe(3);
    buildings.push({ id: 'c', kind: 'wall', x: 6, y: 4, z: 7, complete: true });
    expect(buildPcgTile(world, buildings, 0, 0).features.filter(f => f.kind === 'window' && f.anchor[0] === 6 && f.anchor[2] === 6)).toHaveLength(0);
  });
});

describe('road topology, sidewalk and step surfaces', () => {
  it('joins adjacent road interiors and rebuilds boundary sidewalks after addition/removal', () => {
    const world = new Fixture(); world.set(6, 3, 6, 10);
    const solo = buildPcgTile(world, [], 0, 0); expect(solo.stats.sidewalks).toBe(4);
    world.set(7, 3, 6, 10);
    const pair = buildPcgTile(world, [], 0, 0); expect(pair.stats.sidewalks).toBe(6);
    expect(pair.features.some(f => f.id === 'road:6,3,6:edge:1,0')).toBe(false);
    expect(pair.features.some(f => f.id === 'road:7,3,6:edge:-1,0')).toBe(false);
    expect(samplePcgSurfaceHeight(world, [], 6.5, 6.5, 4)).toBe(4 + 1 / 16);
    expect(samplePcgSurfaceHeight(world, [], 6.5, 5.875, 4)).toBe(4 + 2 / 16);
    world.set(7, 3, 6, 1);
    expect(buildPcgTile(world, [], 0, 0).mesh).toEqual(solo.mesh);
  });
  it('emits eight matching height samples for a one-cell road rise and updates after either end is removed', () => {
    const world = new Fixture(); world.set(7, 3, 6, 10); world.set(8, 4, 6, 10);
    const low = buildPcgTile(world, [], 0, 0), high = buildPcgTile(world, [], 1, 0);
    expect(low.stats.stairs).toBe(1); expect(high.stats.stairs).toBe(0);
    expect(low.walkSurfaces.filter(s => s.kind === 'stairs')).toHaveLength(8);
    for (let i = 0; i < 8; i++) expect(samplePcgSurfaceHeight(world, [], 7 + (i + .5) / 8, 6.5, 4)).toBe(4 + 1 / 16 + (i + 1) / 8);
    expect(samplePcgSurfaceHeight(world, [], 7.99, 6.5, 4)).toBe(samplePcgSurfaceHeight(world, [], 8.01, 6.5, 5));
    world.set(8, 4, 6, 0);
    expect(buildPcgTile(world, [], 0, 0).stats.stairs).toBe(0);
    world.set(7, 3, 6, 1);
    expect(buildPcgTile(world, [], 0, 0).mesh).toBeNull();
  });
  it('avoids water, vegetation and reserved buildings instead of filling them with pavement', () => {
    const world = new Fixture(); world.set(6, 3, 6, 10);
    world.set(7, 3, 6, 8); world.set(5, 4, 6, 4); world.set(6, 4, 7, 7);
    const buildings = [{ id: 'bed', kind: 'bed', x: 6, y: 4, z: 5, complete: false }];
    expect(buildPcgTile(world, buildings, 0, 0).stats.sidewalks).toBe(0);
    expect(isDetailSource(3)).toBe(false); expect(isDetailSource(6)).toBe(true); expect(isDetailSource(10)).toBe(true);
  });
});
