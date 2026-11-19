import { MicroVolume, meshMicroVolume, type PcgMeshData, type PcgPoint } from './geometry.ts';
import { planFacades, type FacadeGroup, type FacadeLayout, type FacadePlan } from './facade.ts';

export const PCG_TILE_SIZE = 8;
export const PCG_VERSION = 2;
const AIR = 0, BRICK = 6, ROAD = 10, WATER = 8, WOOD = 4, LEAVES = 7;
export const WALL_HEIGHT = 29 / 16;
export interface PcgCell { x: number; y: number; z: number; block: number }
export interface PcgSource {
  readonly width: number; readonly height: number; readonly depth: number;
  readonly revision?: number;
  get(x: number, y: number, z: number): number;
  treeAtVoxel?(x: number, y: number, z: number): unknown;
  terrainHeight?(x: number, z: number): number;
  getDetailTiles?(): { x: number; z: number }[];
  getDetailCellsForTile?(tileX: number, tileZ: number, padding?: number): PcgCell[];
  getFacadeLayout?(): FacadeLayout;
}
export interface PcgBuilding { id: string; kind: string; x: number; y: number; z: number; complete: boolean; w?: number; d?: number }
export type PcgFeatureKind = 'wall' | 'road' | 'window' | 'sill' | 'sidewalk' | 'stairs';
export interface PcgFeature {
  id: string; kind: PcgFeatureKind; anchor: PcgPoint;
  min: PcgPoint; max: PcgPoint; dependencies: PcgPoint[];
  groupId?: string; facadeId?: string; panes?: number;
}
export interface PcgWalkSurface {
  id: string; kind: 'road' | 'sidewalk' | 'stairs'; min: PcgPoint; max: PcgPoint; top: number;
}
export interface PcgStats { windows: number; sills: number; sidewalks: number; stairs: number; brickCells: number; roadCells: number; walls: number; triangles: number; vertices: number }
export interface PcgTileResult { mesh: PcgMeshData | null; features: PcgFeature[]; walkSurfaces: PcgWalkSurface[]; stats: PcgStats }
interface Stamp { min: PcgPoint; max: PcgPoint; material: number }
interface Recipe { bases: Stamp[]; cuts: Stamp[]; trim: Stamp[]; features: PcgFeature[]; walkSurfaces: PcgWalkSurface[] }
interface Column { y: number; block: number }
interface WallColumn { x: number; y: number; z: number; height: number; id: string; colony: boolean }
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
const columnCaches = new WeakMap<PcgSource, { revision: number; columns: Map<number, Column> }>();
const emptyStats = (): PcgStats => ({ windows: 0, sills: 0, sidewalks: 0, stairs: 0, brickCells: 0, roadCells: 0, walls: 0, triangles: 0, vertices: 0 });

/** Terrain meshes omit these source cubes completely; this module replaces their geometry. */
export function isDetailSource(block: number): boolean { return block === BRICK || block === ROAD; }
function inside(source: PcgSource, x: number, z: number): boolean { return x >= 0 && z >= 0 && x < source.width && z < source.depth; }
function column(source: PcgSource, x: number, z: number): Column {
  if (!inside(source, x, z)) return { y: -1, block: AIR };
  let cache: Map<number, Column> | undefined;
  if (typeof source.revision === 'number') {
    let record = columnCaches.get(source);
    if (!record || record.revision !== source.revision) {
      record = { revision: source.revision, columns: new Map() }; columnCaches.set(source, record);
    }
    cache = record.columns;
    const found = cache.get(x + z * source.width); if (found) return found;
  }
  let result: Column = { y: -1, block: AIR };
  for (let y = source.height - 1; y >= 0; y--) {
    const block = source.get(x, y, z); if (block !== AIR) { result = { y, block }; break; }
  }
  cache?.set(x + z * source.width, result); return result;
}
const occupiedByBuilding = (buildings: readonly PcgBuilding[], x: number, z: number) => buildings.some(b =>
  x >= b.x && x < b.x + (b.w ?? 1) && z >= b.z && z < b.z + (b.d ?? 1));
const intersects = (a: { min: PcgPoint; max: PcgPoint }, min: PcgPoint, max: PcgPoint) => a.max[0] > min[0] && a.min[0] < max[0] && a.max[1] > min[1] && a.min[1] < max[1] && a.max[2] > min[2] && a.min[2] < max[2];
function feature(recipe: Recipe, kind: PcgFeatureKind, id: string, anchor: PcgPoint, min: PcgPoint, max: PcgPoint, dependencies: PcgPoint[] = [anchor], detail?: Pick<PcgFeature, 'groupId' | 'facadeId' | 'panes'>): void {
  recipe.features.push({ kind, id, anchor, min, max, dependencies, ...detail });
}
function surface(recipe: Recipe, kind: PcgWalkSurface['kind'], id: string, min: PcgPoint, max: PcgPoint, material: number): void {
  recipe.trim.push({ min, max, material }); recipe.walkSurfaces.push({ id, kind, min, max, top: max[1] });
}

function roadRecipe(source: PcgSource, buildings: readonly PcgBuilding[], cell: PcgCell, recipe: Recipe): void {
  const { x, y, z } = cell, h = y + 1, id = `road:${x},${y},${z}`;
  recipe.bases.push({ min: [x, y, z], max: [x + 1, h, z + 1], material: 7 });
  if (column(source, x, z).y !== y || column(source, x, z).block !== ROAD) return;
  const min: PcgPoint = [x, h, z], max: PcgPoint = [x + 1, h + 1 / 16, z + 1];
  surface(recipe, 'road', id, min, max, 8);
  feature(recipe, 'road', id, [x, y, z], [x, y, z], max);
  // Coherent 1/2-cell slabs with one-microvoxel inset joints, never per-voxel noise.
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) recipe.trim.push({
    min: [x + i / 2 + 1 / 16, h, z + j / 2 + 1 / 16],
    max: [x + (i + 1) / 2, h + 1 / 16, z + (j + 1) / 2], material: 9 + ((x + z + i + j) & 1),
  });
  let stairDirection: readonly [number, number] | undefined;
  for (const dir of DIRS) {
    const [dx, dz] = dir, other = column(source, x + dx, z + dz);
    if (other.block === ROAD && other.y === y + 1 && !occupiedByBuilding(buildings, x, z)) {
      let clear = true;
      for (let yy = h; yy < h + 2; yy++) if (source.get(x, yy, z) !== AIR || source.treeAtVoxel?.(x, yy, z)) clear = false;
      if (clear && !stairDirection) stairDirection = dir;
    }
    // Shared Road–Road boundaries never receive an internal curb, including junctions.
    if (other.block === ROAD || !inside(source, x + dx, z + dz)) continue;
    if ([AIR, WATER, WOOD, LEAVES, BRICK].includes(other.block) || Math.abs(other.y - y) > 1
      || occupiedByBuilding(buildings, x + dx, z + dz) || source.treeAtVoxel?.(x + dx, other.y + 1, z + dz)) continue;
    const sh = Math.max(h, other.y + 1) + 2 / 16;
    let sm: PcgPoint, sx: PcgPoint, cm: PcgPoint, cx: PcgPoint;
    if (dx) {
      const edge = x + (dx > 0 ? 1 : 0);
      sm = [edge + (dx < 0 ? -4 / 16 : 0), other.y + 1, z];
      sx = [edge + (dx > 0 ? 4 / 16 : 0), sh, z + 1];
      cm = [edge - 1 / 16, h + 1 / 16, z]; cx = [edge + 1 / 16, sh + 1 / 16, z + 1];
    } else {
      const edge = z + (dz > 0 ? 1 : 0);
      sm = [x, other.y + 1, edge + (dz < 0 ? -4 / 16 : 0)];
      sx = [x + 1, sh, edge + (dz > 0 ? 4 / 16 : 0)];
      cm = [x, h + 1 / 16, edge - 1 / 16]; cx = [x + 1, sh + 1 / 16, edge + 1 / 16];
    }
    const sid = `${id}:edge:${dx},${dz}`;
    surface(recipe, 'sidewalk', sid, sm, sx, 11); surface(recipe, 'sidewalk', `${sid}:curb`, cm, cx, 3);
    feature(recipe, 'sidewalk', sid, [x, y, z], [Math.min(sm[0], cm[0]), Math.min(sm[1], cm[1]), Math.min(sm[2], cm[2])], [Math.max(sx[0], cx[0]), Math.max(sx[1], cx[1]), Math.max(sx[2], cx[2])], [[x, y, z], [x + dx, other.y, z + dz]]);
  }
  if (stairDirection) {
    const [dx, dz] = stairDirection, sid = `${id}:stairs:${dx},${dz}`;
    for (let k = 0; k < 8; k++) {
      const t0 = k / 8, t1 = (k + 1) / 8;
      const sm: PcgPoint = [x, h + 1 / 16, z], sx: PcgPoint = [x + 1, h + 1 / 16 + t1, z + 1];
      if (dx > 0) { sm[0] = x + t0; sx[0] = x + t1; }
      if (dx < 0) { sm[0] = x + 1 - t1; sx[0] = x + 1 - t0; }
      if (dz > 0) { sm[2] = z + t0; sx[2] = z + t1; }
      if (dz < 0) { sm[2] = z + 1 - t1; sx[2] = z + 1 - t0; }
      surface(recipe, 'stairs', `${sid}:${k}`, sm, sx, k & 1 ? 11 : 10);
    }
    feature(recipe, 'stairs', sid, [x, y, z], [x, h, z], [x + 1, h + 1 + 1 / 16, z + 1], [[x, y, z], [x + dx, y + 1, z + dz]]);
  }
}

function wallBodyRecipe(source: PcgSource, wall: WallColumn, recipe: Recipe, modelBodies: boolean): void {
  const { x, y, z, height, id, colony } = wall;
  if (colony) {
    if (!modelBodies) recipe.bases.push({ min: [x, y, z], max: [x + 1, y + height, z + 1], material: 12 });
    feature(recipe, 'wall', id, [x, y, z], [x, y, z], [x + 1, y + height, z + 1]);
  }
  // A restrained top band is shared across a connected row and disappears when it is extended upward.
  if (colony || source.get(x, y + height, z) !== BRICK) {
    const top = y + height;
    recipe.trim.push({ min: [x, top - 1 / 16, z], max: [x + 1, top + 1 / 16, z + 1], material: colony ? 4 : 3 });
  }
}

/** Geometry is subordinate to a whole-facade plan. A group may cross source cells and render tiles. */
function windowGroupRecipe(group: FacadeGroup, recipe: Recipe): void {
  const { id, axis, plane, base, lower, upper, u0, u1, panes, faces, dependencies, facadeId } = group;
  if (!faces.length) return;
  const orient = (umin: number, ymin: number, dmin: number, umax: number, ymax: number, dmax: number): Stamp => ({
    min: axis === 'x' ? [umin, ymin, dmin] : [dmin, ymin, umin],
    max: axis === 'x' ? [umax, ymax, dmax] : [dmax, ymax, umax], material: 4,
  });
  const anchor: PcgPoint = axis === 'x' ? [u0, base, plane] : [plane, base, u0];
  const detail = { groupId: id, facadeId, panes };
  const cut = orient(u0, lower, plane, u1, upper, plane + 1);
  recipe.cuts.push({ ...cut, material: 0 });
  // Front and back share one opening and one glass plane; the source wall remains impassable.
  recipe.trim.push({ ...orient(u0, lower, plane + 7 / 16, u1, upper, plane + 9 / 16), material: 5 });
  feature(recipe, 'window', id, anchor, cut.min, cut.max, dependencies, detail);
  for (const sign of faces) {
    const face = plane + (sign > 0 ? 1 : 0);
    const d0 = sign > 0 ? face - 1 / 16 : face - 2 / 16;
    const d1 = sign > 0 ? face + 2 / 16 : face + 1 / 16;
    recipe.trim.push(orient(u0 - 1 / 16, lower - 1 / 16, d0, u0 + 1 / 16, upper + 1 / 16, d1));
    recipe.trim.push(orient(u1 - 1 / 16, lower - 1 / 16, d0, u1 + 1 / 16, upper + 1 / 16, d1));
    recipe.trim.push(orient(u0, upper - 1 / 16, d0, u1, upper + 1 / 16, d1));
    recipe.trim.push(orient(u0, lower - 1 / 16, d0, u1, lower + 1 / 16, d1));
    for (let pane = 1; pane < panes; pane++) {
      const mullion = Math.round((u0 + (u1 - u0) * pane / panes) * 16) / 16;
      recipe.trim.push(orient(mullion - 1 / 16, lower, d0, mullion + 1 / 16, upper, d1));
    }
    const transom = Math.round((lower + (upper - lower) * .55) * 16) / 16;
    recipe.trim.push(orient(u0, transom, d0, u1, transom + 1 / 16, d1));
    // One continuous sill belongs to the whole group, with no end caps at source-cell boundaries.
    const sill = orient(u0 - 2 / 16, lower - 2 / 16, sign > 0 ? face - 1 / 16 : face - 4 / 16,
      u1 + 2 / 16, lower, sign > 0 ? face + 4 / 16 : face + 1 / 16);
    recipe.trim.push({ ...sill, material: 3 });
    feature(recipe, 'sill', `${id}:sill:${sign}`, anchor, sill.min, sill.max, dependencies, detail);
  }
}

function cellsForTile(source: PcgSource, tileX: number, tileZ: number): PcgCell[] {
  if (source.getDetailCellsForTile) return source.getDetailCellsForTile(tileX, tileZ, 2);
  const result: PcgCell[] = [];
  for (let z = Math.max(0, tileZ * 8 - 2); z < Math.min(source.depth, (tileZ + 1) * 8 + 2); z++) for (let x = Math.max(0, tileX * 8 - 2); x < Math.min(source.width, (tileX + 1) * 8 + 2); x++) for (let y = 0; y < source.height; y++) {
    const block = source.get(x, y, z); if (isDetailSource(block)) result.push({ x, y, z, block });
  }
  return result;
}

export function buildPcgTile(source: PcgSource, buildings: readonly PcgBuilding[], tileX: number, tileZ: number, facadePlan?: FacadePlan, modelBodies = false): PcgTileResult {
  const stats = emptyStats(), recipe: Recipe = { bases: [], cuts: [], trim: [], features: [], walkSurfaces: [] };
  const empty = (): PcgTileResult => ({ mesh: null, stats, features: [], walkSurfaces: [] });
  if (!Number.isInteger(tileX) || !Number.isInteger(tileZ) || tileX < 0 || tileZ < 0 || tileX * 8 >= source.width || tileZ * 8 >= source.depth) return empty();
  const cells = cellsForTile(source, tileX, tileZ);
  const min: PcgPoint = [tileX * 8, -1, tileZ * 8], max: PcgPoint = [Math.min(source.width, (tileX + 1) * 8), source.height + 3, Math.min(source.depth, (tileZ + 1) * 8)];
  const owns = (x: number, z: number) => x >= min[0] && x < max[0] && z >= min[2] && z < max[2];
  const wallColumns = new Map<string, WallColumn>();
  for (const c of cells) {
    if (owns(c.x, c.z)) { if (c.block === BRICK) stats.brickCells++; else if (c.block === ROAD) stats.roadCells++; }
    if (c.block === ROAD) roadRecipe(source, buildings, c, recipe);
    if (c.block === BRICK) {
      recipe.bases.push({ min: [c.x, c.y, c.z], max: [c.x + 1, c.y + 1, c.z + 1], material: 1 + ((c.x + c.z + c.y) & 1) });
      let base = c.y; while (base > 0 && source.get(c.x, base - 1, c.z) === BRICK) base--;
      const key = `${c.x},${base},${c.z}`;
      if (!wallColumns.has(key)) {
        let top = base + 1; while (top < source.height && source.get(c.x, top, c.z) === BRICK) top++;
        wallColumns.set(key, { x: c.x, y: base, z: c.z, height: top - base, id: `brick:${key}`, colony: false });
      }
    }
  }
  for (const b of buildings) if (b.complete && b.kind === 'wall' && b.x >= min[0] - 2 && b.x < max[0] + 2 && b.z >= min[2] - 2 && b.z < max[2] + 2) {
    wallColumns.set(`building:${b.id}`, { x: b.x, y: b.y, z: b.z, height: WALL_HEIGHT, id: `wall:${b.id}`, colony: true });
  }
  for (const wall of wallColumns.values()) wallBodyRecipe(source, wall, recipe, modelBodies);
  const plan = facadePlan ?? planFacades(source, buildings, source.getFacadeLayout?.());
  for (const group of plan.groups) {
    const bounds = group.axis === 'x'
      ? { min: [group.u0 - .125, group.lower - .125, group.plane - .25] as PcgPoint, max: [group.u1 + .125, group.upper + .125, group.plane + 1.25] as PcgPoint }
      : { min: [group.plane - .25, group.lower - .125, group.u0 - .125] as PcgPoint, max: [group.plane + 1.25, group.upper + .125, group.u1 + .125] as PcgPoint };
    if (intersects(bounds, [min[0] - 1, min[1], min[2] - 1], [max[0] + 1, max[1], max[2] + 1])) windowGroupRecipe(group, recipe);
  }
  const stamps = [...recipe.bases, ...recipe.cuts, ...recipe.trim];
  if (!stamps.length) return empty();
  // Trim empty space inside the render tile as well: an isolated node must not scan 8³ source cells.
  const workMin: PcgPoint = [min[0] - 1, -1, min[2] - 1], workMax: PcgPoint = [max[0] + 1, source.height + 3, max[2] + 1];
  const relevant = stamps.filter(s => intersects(s, workMin, workMax));
  if (!relevant.length) return empty();
  const volumeMin = [0, 1, 2].map(axis => Math.max(workMin[axis]!, Math.min(...relevant.map(s => s.min[axis]!)) - 1 / 16)) as PcgPoint;
  const volumeMax = [0, 1, 2].map(axis => Math.min(workMax[axis]!, Math.max(...relevant.map(s => s.max[axis]!)) + 1 / 16)) as PcgPoint;
  const volume = new MicroVolume(volumeMin, volumeMax);
  for (const stamp of stamps) volume.box(stamp.min, stamp.max, stamp.material);
  const mesh = meshMicroVolume(volume, min, max, (x, y, z) => {
    const block = source.get(Math.floor(x), Math.floor(y), Math.floor(z));
    return block !== AIR && block !== WATER && !isDetailSource(block);
  });
  // A long sill's far end needs its collision in that tile even if its anchor lies elsewhere.
  const features = recipe.features.filter(f => intersects(f, min, max));
  for (const f of features) {
    if (!owns(f.anchor[0], f.anchor[2])) continue;
    if (f.kind === 'window') stats.windows++;
    if (f.kind === 'sill') stats.sills++;
    if (f.kind === 'sidewalk') stats.sidewalks++;
    if (f.kind === 'stairs') stats.stairs++;
    if (f.kind === 'wall') stats.walls++;
  }
  stats.vertices = (mesh?.position.length ?? 0) / 3; stats.triangles = (mesh?.indices.length ?? 0) / 3;
  return { mesh, stats, features, walkSurfaces: recipe.walkSurfaces.filter(s => intersects(s, min, max)) };
}

/** The same recipe that emits road tread geometry supplies feet heights for navigation. */
export function samplePcgSurfaceHeight(source: PcgSource, buildings: readonly PcgBuilding[], x: number, z: number, baseHeight: number): number {
  const recipe: Recipe = { bases: [], cuts: [], trim: [], features: [], walkSurfaces: [] };
  const xx = Math.floor(x), zz = Math.floor(z);
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    const c = column(source, xx + dx, zz + dz);
    if (c.block === ROAD) roadRecipe(source, buildings, { x: xx + dx, y: c.y, z: zz + dz, block: ROAD }, recipe);
  }
  let height = baseHeight;
  for (const s of recipe.walkSurfaces) if (x >= s.min[0] && x < s.max[0] && z >= s.min[2] && z < s.max[2]) height = Math.max(height, s.top);
  return height;
}
