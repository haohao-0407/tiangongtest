import { describe, expect, it } from 'vitest';
import { buildChunkMesh } from '../mesh.ts';
import { CHUNK_SIZE } from '../model.ts';

function fixture(cells: [number, number, number, number][], size = { width: 48, height: 24, depth: 48 }) {
  const data = new Map(cells.map(([x, y, z, block]) => [`${x},${y},${z}`, block]));
  return { ...size, get: (x: number, y: number, z: number) => x >= 0 && x < size.width && y >= 0 && y < size.height && z >= 0 && z < size.depth ? data.get(`${x},${y},${z}`) ?? 0 : 0 };
}
const origin = { x: 0, y: 0, z: 0 };

describe('exposed voxel geometry', () => {
  it('omits empty chunks and builds six outward-facing quads for an isolated block', () => {
    expect(buildChunkMesh(fixture([]), origin)).toBeNull();
    const mesh = buildChunkMesh(fixture([[1, 2, 3, 3]]), origin)!;
    expect(mesh.indices).toHaveLength(36);
    expect(Array.from(mesh.aabb!)).toEqual([1, 2, 3, 2, 3, 4]);
    const p = mesh.attributes.position as Float32Array, n = mesh.attributes.normal as Float32Array;
    for (let f = 0; f < 6; f++) {
      const start = f * 12;
      const u = [p[start + 3]! - p[start]!, p[start + 4]! - p[start + 1]!, p[start + 5]! - p[start + 2]!];
      const v = [p[start + 6]! - p[start]!, p[start + 7]! - p[start + 1]!, p[start + 8]! - p[start + 2]!];
      const cross = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
      expect(cross.reduce((sum, value, axis) => sum + value * n[start + axis]!, 0)).toBeGreaterThan(0);
    }
  });
  it('removes both faces between solid neighbors even across a chunk boundary', () => {
    const local = buildChunkMesh(fixture([[2, 2, 2, 3], [3, 2, 2, 4]]), origin)!;
    expect(local.indices).toHaveLength(60);
    const boundary = fixture([[CHUNK_SIZE - 1, 2, 2, 3], [CHUNK_SIZE, 2, 2, 3]]);
    expect(buildChunkMesh(boundary, origin)!.indices).toHaveLength(30);
    expect(buildChunkMesh(boundary, { x: 1, y: 0, z: 0 })!.indices).toHaveLength(30);
  });
  it('keeps the shoreline solid face and culls the hidden water face', () => {
    const mesh = buildChunkMesh(fixture([[2, 2, 2, 3], [3, 2, 2, 8]]), origin)!;
    expect(mesh.indices).toHaveLength(66);
    const colors = mesh.attributes.color!;
    expect(Array.from(colors).every(Number.isFinite)).toBe(true);
  });
  it('clips partial edge chunks to all three world dimensions', () => {
    const world = fixture([[249, 5, 249, 3], [250, 5, 249, 3]], { width: 250, height: 24, depth: 250 });
    const mesh = buildChunkMesh(world, { x: 10, y: 0, z: 10 })!;
    expect(mesh.indices).toHaveLength(36);
    expect(Array.from(mesh.aabb!)).toEqual([249, 5, 249, 250, 6, 250]);
    expect(buildChunkMesh(world, { x: 11, y: 0, z: 10 })).toBeNull();
    expect(buildChunkMesh(world, { x: -1, y: 0, z: 0 })).toBeNull();
    const corner = fixture([[49, 24, 48, 3]], { width: 50, height: 25, depth: 49 });
    const partial = buildChunkMesh(corner, { x: 2, y: 1, z: 2 })!;
    expect(Array.from(partial.aabb!)).toEqual([49, 24, 48, 50, 25, 49]);
  });
});
