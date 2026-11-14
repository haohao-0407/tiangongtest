/** Engine-independent integer microvoxel geometry. One source cell is 16³ samples. */
export const MICRO_SCALE = 16;
export type PcgPoint = [number, number, number];
export interface PcgMeshData {
  position: Float32Array; normal: Float32Array; uv: Float32Array;
  color: Float32Array; indices: Uint32Array;
}
export const PCG_COLORS: readonly (readonly [number, number, number])[] = [
  [0, 0, 0], [.66, .38, .28], [.70, .42, .31], [.76, .72, .61],
  [.91, .86, .71], [.22, .41, .48], [.33, .56, .62], [.37, .39, .37],
  [.52, .53, .49], [.58, .59, .54], [.65, .66, .60], [.70, .71, .65],
  [.60, .63, .57], [.65, .68, .61],
];
const linear = (v: number) => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
const COLORS = PCG_COLORS.map(rgb => rgb.map(linear));

/** A small work buffer around active semantic nodes, never a full-world microgrid. */
export class MicroVolume {
  readonly min: PcgPoint;
  readonly max: PcgPoint;
  readonly size: PcgPoint;
  readonly cells: Uint8Array;
  constructor(min: PcgPoint, max: PcgPoint) {
    this.min = min.map(v => Math.floor(v * MICRO_SCALE)) as PcgPoint;
    this.max = max.map(v => Math.ceil(v * MICRO_SCALE)) as PcgPoint;
    this.size = this.max.map((v, i) => Math.max(1, v - this.min[i]!)) as PcgPoint;
    this.cells = new Uint8Array(this.size[0] * this.size[1] * this.size[2]);
  }
  index(x: number, y: number, z: number): number { return x + this.size[0] * (z + this.size[2] * y); }
  get(x: number, y: number, z: number): number {
    return x < 0 || y < 0 || z < 0 || x >= this.size[0] || y >= this.size[1] || z >= this.size[2]
      ? 0 : this.cells[this.index(x, y, z)]!;
  }
  sample(x: number, y: number, z: number): number {
    return this.get(Math.floor(x * 16) - this.min[0], Math.floor(y * 16) - this.min[1], Math.floor(z * 16) - this.min[2]);
  }
  box(min: PcgPoint, max: PcgPoint, material: number): void {
    const lo = min.map((v, i) => Math.max(0, Math.round(v * 16) - this.min[i]!));
    const hi = max.map((v, i) => Math.min(this.size[i]!, Math.round(v * 16) - this.min[i]!));
    for (let y = lo[1]!; y < hi[1]!; y++) for (let z = lo[2]!; z < hi[2]!; z++) {
      const start = this.index(lo[0]!, y, z), end = this.index(hi[0]!, y, z);
      if (end > start) this.cells.fill(material, start, end);
    }
  }
}

/** Greedy faces are emitted only for the owning tile; the buffer includes neighbour geometry. */
export function meshMicroVolume(
  volume: MicroVolume, clipMin: PcgPoint, clipMax: PcgPoint,
  externalSolid: (x: number, y: number, z: number) => boolean = () => false,
): PcgMeshData | null {
  const position: number[] = [], normal: number[] = [], uv: number[] = [], color: number[] = [], indices: number[] = [];
  const lo = clipMin.map((v, i) => Math.max(0, Math.round(v * 16) - volume.min[i]!));
  const hi = clipMax.map((v, i) => Math.min(volume.size[i]!, Math.round(v * 16) - volume.min[i]!));
  if (hi.some((v, i) => v <= lo[i]!)) return null;
  const sample = (p: number[]) => volume.get(p[0]!, p[1]!, p[2]!);
  const occludes = (p: number[]) => sample(p) !== 0 || externalSolid(
    (p[0]! + volume.min[0] + .5) / 16,
    (p[1]! + volume.min[1] + .5) / 16,
    (p[2]! + volume.min[2] + .5) / 16,
  );
  for (let axis = 0; axis < 3; axis++) {
    const u = (axis + 1) % 3, v = (axis + 2) % 3;
    const width = hi[u]! - lo[u]!, height = hi[v]! - lo[v]!;
    const mask = new Uint8Array(width * height);
    for (const sign of [-1, 1]) for (let d = lo[axis]!; d < hi[axis]!; d++) {
      mask.fill(0);
      for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) {
        const p = [0, 0, 0]; p[axis] = d; p[u] = lo[u]! + i; p[v] = lo[v]! + j;
        const mat = sample(p); if (!mat) continue;
        p[axis] += sign;
        if (!occludes(p)) mask[i + j * width] = mat;
      }
      for (let j = 0; j < height; j++) for (let i = 0; i < width;) {
        const mat = mask[i + j * width]!; if (!mat) { i++; continue; }
        let w = 1; while (i + w < width && mask[i + w + j * width] === mat) w++;
        let h = 1;
        outer: while (j + h < height) {
          for (let k = 0; k < w; k++) if (mask[i + k + (j + h) * width] !== mat) break outer;
          h++;
        }
        const base = [0, 0, 0]; base[axis] = d + (sign > 0 ? 1 : 0); base[u] = lo[u]! + i; base[v] = lo[v]! + j;
        const corners = [[0, 0], [w, 0], [w, h], [0, h]];
        const order = sign > 0 ? [0, 1, 2, 3] : [0, 3, 2, 1];
        const offset = position.length / 3;
        const brightness = axis === 1 ? (sign > 0 ? 1 : .67) : (axis === 0 ? .87 : .94);
        const rgb = COLORS[mat] ?? COLORS[1]!;
        for (const n of order) {
          const p = [...base]; p[u] += corners[n]![0]!; p[v] += corners[n]![1]!;
          position.push((p[0]! + volume.min[0]) / 16, (p[1]! + volume.min[1]) / 16, (p[2]! + volume.min[2]) / 16);
          normal.push(axis === 0 ? sign : 0, axis === 1 ? sign : 0, axis === 2 ? sign : 0);
          uv.push(corners[n]![0]! / 16, corners[n]![1]! / 16);
          color.push(rgb[0]! * brightness, rgb[1]! * brightness, rgb[2]! * brightness, 1);
        }
        indices.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3);
        for (let jj = 0; jj < h; jj++) mask.fill(0, i + (j + jj) * width, i + w + (j + jj) * width);
        i += w;
      }
    }
  }
  return position.length ? { position: new Float32Array(position), normal: new Float32Array(normal), uv: new Float32Array(uv), color: new Float32Array(color), indices: new Uint32Array(indices) } : null;
}
