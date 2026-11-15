import type { VoxelWorld } from './model.ts';
import { treeBounds, treeParts, type TreeInstance } from './trees.ts';

type Point = readonly [number, number, number];
const geometryCache = new WeakMap<TreeInstance, { parts: ReturnType<typeof treeParts>; bounds: ReturnType<typeof treeBounds> }>();
function geometry(tree: TreeInstance) {
  let value = geometryCache.get(tree);
  if (!value) { value = { parts: treeParts(tree), bounds: treeBounds(tree) }; geometryCache.set(tree, value); }
  return value;
}
export function overlaps(min: Point, max: Point, otherMin: Point, otherMax: Point): boolean {
  return min.every((n, i) => n < otherMax[i]! - 1e-6 && max[i]! > otherMin[i]! + 1e-6);
}
function rayBox(origin: Point, direction: Point, min: Point, max: Point, limit: number): number | null {
  let near = 0, far = limit;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(direction[i]!) < 1e-8) {
      if (origin[i]! < min[i]! || origin[i]! > max[i]!) return null;
    } else {
      const a = (min[i]! - origin[i]!) / direction[i]!, b = (max[i]! - origin[i]!) / direction[i]!;
      near = Math.max(near, Math.min(a, b)); far = Math.min(far, Math.max(a, b));
    }
  }
  return near <= far ? near : null;
}

/** A crown hit and a trunk hit retain the same identity; terrain occludes both. */
export function raycastTree(trees: readonly TreeInstance[], origin: Point, direction: Point, limit = Infinity) {
  let nearest: { tree: TreeInstance; part: ReturnType<typeof treeParts>[number]; distance: number } | null = null;
  for (const tree of trees) {
    const { bounds, parts } = geometry(tree), maxDistance = nearest?.distance ?? limit;
    if (rayBox(origin, direction, bounds.min, bounds.max, maxDistance) === null) continue;
    for (const part of parts) {
      const distance = rayBox(origin, direction, part.min, part.max, nearest?.distance ?? limit);
      if (distance !== null && (!nearest || distance < nearest.distance)) nearest = { tree, part, distance };
    }
  }
  return nearest;
}

/** Spatial lookup limits player collision to objects touching the character. */
export function treesInBox(world: VoxelWorld, min: Point, max: Point): TreeInstance[] {
  const result = new Map<string, TreeInstance>();
  for (let x = Math.floor(min[0]); x < Math.ceil(max[0]); x++)
    for (let y = Math.floor(min[1]); y < Math.ceil(max[1]); y++)
      for (let z = Math.floor(min[2]); z < Math.ceil(max[2]); z++)
        for (const tree of world.treesAtVoxel(x, y, z)) result.set(tree.id, tree);
  return [...result.values()];
}
export function treesBlockBox(world: VoxelWorld, min: Point, max: Point): boolean {
  return treesInBox(world, min, max).some(tree => geometry(tree).parts.some(part => overlaps(min, max, part.min, part.max)));
}
export function treeSupportHeight(world: VoxelWorld, minX: number, minZ: number, maxX: number, maxZ: number, fallback: number, maximum: number): number {
  let top = fallback;
  const ceiling = Math.min(world.height, Number.isFinite(maximum) ? maximum : world.height);
  for (const tree of treesInBox(world, [minX, Math.max(0, fallback - 1), minZ], [maxX, ceiling, maxZ]))
    for (const part of geometry(tree).parts)
      if (part.max[1] <= maximum + 1e-6 && part.max[1] > top &&
          minX < part.max[0] && maxX > part.min[0] && minZ < part.max[2] && maxZ > part.min[2]) top = part.max[1];
  return top;
}

/** A tree's supporting ground cannot be edited away while the tree stands. */
export function treeProtectingVoxel(world: VoxelWorld, x: number, y: number, z: number): TreeInstance | undefined {
  const root = world.treeAtColumn(x, z);
  return world.treeAtVoxel(x, y, z) ?? (root?.y === y + 1 ? root : undefined);
}
