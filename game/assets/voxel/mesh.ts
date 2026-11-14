import { createMeshBuilder } from '@forgeax/engine/geometry';
import type { MeshAsset } from '@forgeax/engine/types';
import { BLOCKS, CHUNK_SIZE } from './model.ts';

export interface ChunkCoordinate { x: number; y: number; z: number }
interface VoxelSource {
  readonly width: number; readonly height: number; readonly depth: number;
  get(x: number, y: number, z: number): number;
}

const FACES = [
  { n: [1, 0, 0], corners: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]], light: 0.9 },
  { n: [-1, 0, 0], corners: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]], light: 0.84 },
  { n: [0, 1, 0], corners: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], light: 1 },
  { n: [0, -1, 0], corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], light: 0.64 },
  { n: [0, 0, 1], corners: [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]], light: 0.94 },
  { n: [0, 0, -1], corners: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]], light: 0.86 },
] as const;
const linear = (v: number) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
const LINEAR_COLORS = BLOCKS.map(block => block.color.map(linear));

/** Only visible faces enter the mesh; adjacent chunks consult the same voxel data. */
export function buildChunkMesh(world: VoxelSource, chunk: ChunkCoordinate): MeshAsset | null {
  if (![chunk.x, chunk.y, chunk.z].every(value => Number.isInteger(value) && value >= 0)) return null;
  const position: number[] = [], normal: number[] = [], uv: number[] = [], color: number[] = [], indices: number[] = [];
  const x0 = chunk.x * CHUNK_SIZE, y0 = chunk.y * CHUNK_SIZE, z0 = chunk.z * CHUNK_SIZE;
  if (x0 >= world.width || y0 >= world.height || z0 >= world.depth) return null;
  for (let y = y0; y < Math.min(y0 + CHUNK_SIZE, world.height); y++) {
    for (let z = z0; z < Math.min(z0 + CHUNK_SIZE, world.depth); z++) {
      for (let x = x0; x < Math.min(x0 + CHUNK_SIZE, world.width); x++) {
        const block = world.get(x, y, z);
        if (block === 0) continue;
        const variant = 0.94 + (((x * 73856093) ^ (z * 19349663) ^ (y * 83492791)) >>> 0) % 11 / 100;
        for (const face of FACES) {
          const neighbor = world.get(x + face.n[0], y + face.n[1], z + face.n[2]);
          if (neighbor !== 0 && !(neighbor === 8 && block !== 8)) continue;
          const rgb = LINEAR_COLORS[block === 1 && face.n[1] !== 1 ? 2 : block]!;
          const brightness = face.light * variant;
          const red = rgb[0]! * brightness, green = rgb[1]! * brightness, blue = rgb[2]! * brightness;
          const offset = position.length / 3;
          for (let i = 0; i < 4; i++) {
            const corner = face.corners[i]!;
            position.push(x + corner[0], y + corner[1], z + corner[2]);
            normal.push(...face.n);
            uv.push(i === 1 || i === 2 ? 1 : 0, i >= 2 ? 1 : 0);
            color.push(red, green, blue, 1);
          }
          indices.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3);
        }
      }
    }
  }
  if (!position.length) return null;
  return createMeshBuilder({
    attributes: {
      position: new Float32Array(position), normal: new Float32Array(normal),
      uv: new Float32Array(uv), color: new Float32Array(color),
    },
    indices: new Uint32Array(indices),
  }).build().unwrap();
}
