export type ZoneCell = [number, number];
export type Footprint = { x: number; z: number; w: number; d: number; cells?: ZoneCell[] };

export function* footprintCells(area: Footprint): Iterable<ZoneCell> {
  if (area.cells) yield* area.cells;
  else for (let z = area.z; z < area.z + area.d; z++)
    for (let x = area.x; x < area.x + area.w; x++) yield [x, z];
}

// Membership is immutable after a zone is created or loaded.
const membership = new WeakMap<ZoneCell[], Set<number>>();
export function containsCell(area: Footprint, x: number, z: number): boolean {
  if (x < area.x || x >= area.x + area.w || z < area.z || z >= area.z + area.d) return false;
  if (!area.cells) return true;
  let keys = membership.get(area.cells);
  if (!keys) {
    keys = new Set(area.cells.map(([cx, cz]) => cx - area.x + (cz - area.z) * area.w));
    membership.set(area.cells, keys);
  }
  return keys.has(x - area.x + (z - area.z) * area.w);
}
