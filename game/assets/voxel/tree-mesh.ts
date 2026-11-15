import { treeParts, type TreeInstance, type TreePart } from './trees.ts';

export interface TreeMeshData {
  position: Float32Array; normal: Float32Array; uv: Float32Array;
  color: Float32Array; indices: Uint32Array;
}

/** sRGB art palette; mesh vertex colors are linear, matching the stock PBR material. */
export const TREE_COLORS = {
  trunk: [[.39, .23, .12], [.46, .29, .15], [.53, .35, .19]],
  branch: [[.43, .27, .14], [.49, .31, .17], [.55, .37, .21]],
  crown: [[.22, .40, .20], [.31, .51, .25], [.43, .61, .31]],
} as const;

const linear = (v: number) => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
const ROLES = ['trunk', 'branch', 'crown'] as const;
const COLORS = ROLES.flatMap(role => TREE_COLORS[role].map(rgb => rgb.map(linear)));
const material = (part: TreePart) => 1 + ROLES.indexOf(part.role) * 3 + ((part.tone % 3) + 3) % 3;

/**
 * Exact union of the authored boxes, using their boundary coordinates as a compact grid.
 * Greedy quads omit hidden faces, while keeping branches and tiered foliage one mesh.
 * The same boxes are authoritative for world collision and picking.
 */
export function meshTreeParts(parts: readonly TreePart[]): TreeMeshData {
  const axes = [0, 1, 2].map(axis => [...new Set(parts.flatMap(part => [part.min[axis]!, part.max[axis]!]))].sort((a, b) => a - b));
  const size = axes.map(axis => Math.max(0, axis.length - 1));
  const cells = new Uint8Array(size[0]! * size[1]! * size[2]!);
  const index = (x: number, y: number, z: number) => x + size[0]! * (z + size[2]! * y);
  const get = (p: readonly number[]) => p.some((v, axis) => v < 0 || v >= size[axis]!) ? 0 : cells[index(p[0]!, p[1]!, p[2]!)]!;
  for (const part of parts) {
    const lo = axes.map((axis, i) => axis.indexOf(part.min[i]!));
    const hi = axes.map((axis, i) => axis.indexOf(part.max[i]!));
    for (let y = lo[1]!; y < hi[1]!; y++) for (let z = lo[2]!; z < hi[2]!; z++)
      cells.fill(material(part), index(lo[0]!, y, z), index(hi[0]!, y, z));
  }
  const position: number[] = [], normal: number[] = [], uv: number[] = [], color: number[] = [], indices: number[] = [];
  for (let axis = 0; axis < 3; axis++) {
    const u = (axis + 1) % 3, v = (axis + 2) % 3, width = size[u]!, height = size[v]!;
    const mask = new Uint8Array(width * height);
    for (const sign of [-1, 1]) for (let d = 0; d < size[axis]!; d++) {
      mask.fill(0);
      for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) {
        const p = [0, 0, 0]; p[axis] = d; p[u] = i; p[v] = j;
        const mat = get(p); if (!mat) continue;
        p[axis] += sign;
        if (!get(p)) mask[i + j * width] = mat;
      }
      for (let j = 0; j < height; j++) for (let i = 0; i < width;) {
        const mat = mask[i + j * width]!; if (!mat) { i++; continue; }
        let w = 1; while (i + w < width && mask[i + w + j * width] === mat) w++;
        let h = 1;
        outer: while (j + h < height) {
          for (let k = 0; k < w; k++) if (mask[i + k + (j + h) * width] !== mat) break outer;
          h++;
        }
        const origin = [0, 0, 0]; origin[axis] = d + (sign > 0 ? 1 : 0); origin[u] = i; origin[v] = j;
        const corners = [[0, 0], [w, 0], [w, h], [0, h]];
        const order = sign > 0 ? [0, 1, 2, 3] : [0, 3, 2, 1];
        const offset = position.length / 3;
        const brightness = axis === 1 ? (sign > 0 ? 1 : .76) : (axis === 0 ? .92 : .96);
        const rgb = COLORS[mat - 1]!;
        for (const corner of order) {
          const p = [...origin]; p[u] += corners[corner]![0]!; p[v] += corners[corner]![1]!;
          position.push(axes[0]![p[0]!]!, axes[1]![p[1]!]!, axes[2]![p[2]!]!);
          normal.push(axis === 0 ? sign : 0, axis === 1 ? sign : 0, axis === 2 ? sign : 0);
          uv.push(axes[u]![p[u]!]! - axes[u]![i]!, axes[v]![p[v]!]! - axes[v]![j]!);
          color.push(rgb[0]! * brightness, rgb[1]! * brightness, rgb[2]! * brightness, 1);
        }
        indices.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3);
        for (let jj = 0; jj < h; jj++) mask.fill(0, i + (j + jj) * width, i + w + (j + jj) * width);
        i += w;
      }
    }
  }
  return { position: new Float32Array(position), normal: new Float32Array(normal), uv: new Float32Array(uv),
    color: new Float32Array(color), indices: new Uint32Array(indices) };
}

/** Local coordinates are rooted at the trunk center, on the ground plane. */
export function buildTreeMesh(tree: TreeInstance): TreeMeshData {
  return meshTreeParts(treeParts(tree).map(part => ({ ...part,
    min: [part.min[0] - tree.x - .5, part.min[1] - tree.y, part.min[2] - tree.z - .5],
    max: [part.max[0] - tree.x - .5, part.max[1] - tree.y, part.max[2] - tree.z - .5],
  })));
}
