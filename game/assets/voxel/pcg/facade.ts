import type { PcgBuilding, PcgSource } from './rules.ts';
import type { PcgPoint } from './geometry.ts';

/** Layout is semantic save data; positions are world units on the 1/16 grid. */
export interface FacadeWindowState {
  id: string; axis: 'x' | 'z'; plane: number; base: number;
  lower: number; upper: number; u0: number; u1: number; panes: number;
}
export interface FacadeLayout { version: 2; groups: FacadeWindowState[] }
export interface FacadeGroup extends FacadeWindowState {
  facadeId: string; faces: (-1 | 1)[]; dependencies: PcgPoint[];
}
export interface FacadePatch {
  id: string; axis: 'x' | 'z'; plane: number; min: PcgPoint; max: PcgPoint; members: PcgPoint[];
}
export interface FacadePlan { layout: FacadeLayout; groups: FacadeGroup[]; patches: FacadePatch[] }

type Axis = FacadeWindowState['axis'];
interface Span { lo: number; hi: number }
interface WallColumn { x: number; z: number; spans: Span[] }
interface Band { axis: Axis; plane: number; base: number; columns: Map<number, number>; priority: number }
interface Run { patch: FacadePatch; band: Band; lo: number; hi: number }
const SCALE = 16, AIR = 0, BRICK = 6, TILE = 8;
const EDGE = 8, GAP = 12, MIN_WINDOW = 24, TARGET_WINDOW = 40, MAX_WINDOW = 48;
const LOWER = 6, UPPER = 25, WALL_SUPPORT = 29;
const quantized = (v: number) => Number.isFinite(v) && Math.abs(v * SCALE - Math.round(v * SCALE)) < 1e-6;
const key = (x: number, z: number) => `${x},${z}`;
const at = (axis: Axis, plane: number, u: number, y: number): PcgPoint => axis === 'x' ? [u, y, plane] : [plane, y, u];
const bandKey = (axis: Axis, plane: number, base: number) => `${axis}:${plane}:${base}`;
const overlaps = (a0: number, a1: number, b0: number, b1: number) => a0 < b1 && a1 > b0;

/** Collect structural columns only; natural terrain never participates in facade connectivity. */
function wallColumns(source: PcgSource, buildings: readonly PcgBuilding[]): Map<string, WallColumn> {
  const columns = new Map<string, WallColumn>();
  const add = (x: number, z: number, lo: number, hi: number) => {
    if (x < 0 || z < 0 || x >= source.width || z >= source.depth || hi <= lo) return;
    const id = key(x, z), column = columns.get(id) ?? { x, z, spans: [] };
    column.spans.push({ lo: Math.round(lo * SCALE), hi: Math.round(hi * SCALE) }); columns.set(id, column);
  };
  if (source.getDetailCellsForTile) {
    const tiles = source.getDetailTiles?.() ?? Array.from({ length: Math.ceil(source.width / TILE) * Math.ceil(source.depth / TILE) }, (_, index) =>
      ({ x: index % Math.ceil(source.width / TILE), z: Math.floor(index / Math.ceil(source.width / TILE)) }));
    for (const tile of tiles) for (const c of source.getDetailCellsForTile(tile.x, tile.z, 0))
      if (c.block === BRICK) add(c.x, c.z, c.y, c.y + 1);
  } else {
    for (let z = 0; z < source.depth; z++) for (let x = 0; x < source.width; x++) for (let y = 0; y < source.height; y++)
      if (source.get(x, y, z) === BRICK) add(x, z, y, y + 1);
  }
  for (const b of buildings) if (b.complete && b.kind === 'wall')
    for (let z = b.z; z < b.z + (b.d ?? 1); z++) for (let x = b.x; x < b.x + (b.w ?? 1); x++) add(x, z, b.y, b.y + WALL_SUPPORT / SCALE);
  for (const c of columns.values()) {
    const merged: Span[] = [];
    for (const span of c.spans.sort((a, b) => a.lo - b.lo || a.hi - b.hi)) {
      const previous = merged.at(-1);
      if (previous && span.lo <= previous.hi) previous.hi = Math.max(previous.hi, span.hi);
      else merged.push({ ...span });
    }
    c.spans = merged;
  }
  return columns;
}

function extractRuns(source: PcgSource, buildings: readonly PcgBuilding[], previous: readonly FacadeWindowState[]): Run[] {
  const columns = wallColumns(source, buildings), bands = new Map<string, Band>();
  const hasWall = (x: number, z: number, lo: number, hi: number) => columns.get(key(x, z))?.spans.some(s => overlaps(lo, hi, s.lo, s.hi)) ?? false;
  const entranceAt = (axis: Axis, plane: number, u: number, base: number) => buildings.some(b => {
    if (b.kind !== 'door') return false; // A planned door already reserves its opening.
    const u0 = axis === 'x' ? b.x : b.z, u1 = u0 + (axis === 'x' ? b.w ?? 1 : b.d ?? 1);
    const depth = axis === 'x' ? b.z : b.x, thickness = axis === 'x' ? b.d ?? 1 : b.w ?? 1;
    return overlaps(u, u + 1, u0, u1) && overlaps(plane - 1, plane + 2, depth, depth + thickness)
      && overlaps(base / SCALE, (base + WALL_SUPPORT) / SCALE, b.y, b.y + 2);
  });
  const clearFace = (axis: Axis, plane: number, u: number, base: number, side: -1 | 1) => {
    const [x, , z] = at(axis, plane + side, u, base / SCALE);
    for (let y = Math.floor((base + LOWER - 2) / SCALE); y < Math.ceil((base + UPPER + 1) / SCALE); y++)
      if (source.get(x, y, z) !== AIR) return false;
    return !buildings.some(b => b.kind !== 'floor' && (b.complete || b.kind === 'door')
      && x >= b.x && x < b.x + (b.w ?? 1) && z >= b.z && z < b.z + (b.d ?? 1)
      && overlaps((base + LOWER - 2) / SCALE, (base + UPPER + 1) / SCALE, b.y, b.y + 2));
  };
  interface Support { span: Span; u: number }
  // A floor datum belongs to the connected wall, not each vertical source column. A hole in
  // the bottom row must not shift every opening above that column upward by one source cell.
  for (const axis of ['x', 'z'] as const) {
    const planes = new Map<number, Support[]>();
    for (const column of columns.values()) for (const span of column.spans) {
      const plane = axis === 'x' ? column.z : column.x, u = axis === 'x' ? column.x : column.z;
      const supports = planes.get(plane) ?? []; supports.push({ span, u }); planes.set(plane, supports);
    }
    for (const [plane, supports] of planes) {
      const byU = new Map<number, Support[]>();
      for (const support of supports) { const atU = byU.get(support.u) ?? []; atU.push(support); byU.set(support.u, atU); }
      const visited = new Set<Support>();
      for (const start of supports) {
        if (visited.has(start)) continue;
        const component = [start]; visited.add(start);
        for (let i = 0; i < component.length; i++) {
          const current = component[i]!;
          for (const u of [current.u - 1, current.u + 1]) for (const neighbor of byU.get(u) ?? [])
            if (!visited.has(neighbor) && overlaps(current.span.lo, current.span.hi, neighbor.span.lo, neighbor.span.hi)) {
              visited.add(neighbor); component.push(neighbor);
            }
        }
        const highest = Math.max(...component.map(c => c.span.hi));
        const bases = new Set<number>();
        for (const datum of new Set(component.map(c => c.span.lo)))
          for (let base = datum; base + WALL_SUPPORT <= highest; base += 2 * SCALE) bases.add(base);
        // Historical floor datums remain candidates even if all of a lower source row is removed.
        for (const old of previous) if (old.axis === axis && old.plane === plane && quantized(old.base)
          && component.some(c => overlaps(c.u, c.u + 1, old.u0, old.u1) && overlaps(c.span.lo, c.span.hi, old.base * SCALE, old.base * SCALE + WALL_SUPPORT)))
          bases.add(Math.round(old.base * SCALE));
        const priorities = new Map([...bases].map(base => [base, component.filter(c => c.span.lo <= base && c.span.hi >= base + WALL_SUPPORT).length]));
        for (const { span, u } of component) for (const base of bases) {
          if (base < span.lo || base + WALL_SUPPORT > span.hi) continue;
          const minus = at(axis, plane - 1, u, 0), plus = at(axis, plane + 1, u, 0);
          // Preserve full structural corner columns and thick walls, rather than intersecting perpendicular cuts.
          if (hasWall(minus[0], minus[2], base, base + WALL_SUPPORT) || hasWall(plus[0], plus[2], base, base + WALL_SUPPORT)
            || entranceAt(axis, plane, u, base)) continue;
          const faces = (clearFace(axis, plane, u, base, -1) ? 1 : 0) | (clearFace(axis, plane, u, base, 1) ? 2 : 0);
          if (!faces) continue;
          const id = bandKey(axis, plane, base), band = bands.get(id) ?? { axis, plane, base, columns: new Map<number, number>(), priority: 0 };
          band.priority = Math.max(band.priority, priorities.get(base)!);
          band.columns.set(u, faces); bands.set(id, band);
        }
      }
    }
  }
  const runs: Run[] = [];
  for (const band of [...bands.values()].sort((a, b) => a.axis.localeCompare(b.axis) || a.plane - b.plane || b.priority - a.priority || a.base - b.base)) {
    const positions = [...band.columns.keys()].sort((a, b) => a - b);
    for (let i = 0; i < positions.length;) {
      const start = positions[i]!; let end = start + 1; i++;
      while (i < positions.length && positions[i] === end) { end++; i++; }
      const members: PcgPoint[] = [];
      for (let u = start; u < end; u++) for (let y = Math.floor(band.base / SCALE); y < Math.ceil((band.base + WALL_SUPPORT) / SCALE); y++)
        members.push(at(band.axis, band.plane, u, y));
      const patch: FacadePatch = { id: `facade:${bandKey(band.axis, band.plane, band.base)}:${start}:${end}`, axis: band.axis, plane: band.plane,
        min: at(band.axis, band.plane, start, band.base / SCALE), max: at(band.axis, band.plane + 1, end, (band.base + WALL_SUPPORT) / SCALE), members };
      runs.push({ patch, band, lo: start * SCALE + EDGE, hi: end * SCALE - EDGE });
    }
  }
  return runs;
}

function visibleSides(run: Run, lo: number, hi: number): (-1 | 1)[] {
  let mask = 3;
  // Include the sill shoulders; a frame must not bridge a missing or occluded support column.
  for (let u = Math.floor((lo - 2) / SCALE); u < Math.ceil((hi + 2) / SCALE); u++) mask &= run.band.columns.get(u) ?? 0;
  return [...(mask & 1 ? [-1 as const] : []), ...(mask & 2 ? [1 as const] : [])];
}

/** Choose complete window groups within one available span, using integer widths and fixed minimum piers. */
function packSpan(lo: number, hi: number): [number, number][] {
  const length = hi - lo;
  if (length < MIN_WINDOW) return [];
  let best: { count: number; width: number; used: number; score: number } | undefined;
  for (let count = 1; count <= Math.floor((length + GAP) / (MIN_WINDOW + GAP)); count++) {
    const width = Math.min(MAX_WINDOW, Math.floor((length - (count - 1) * GAP) / count));
    if (width < MIN_WINDOW) continue;
    const used = width * count + (count - 1) * GAP, leftover = length - used;
    const score = count * (width - TARGET_WINDOW) ** 2 + 2 * leftover ** 2;
    if (!best || score < best.score) best = { count, width, used, score };
  }
  if (!best) return [];
  const result: [number, number][] = []; let start = lo + Math.floor((length - best.used) / 2);
  for (let i = 0; i < best.count; i++) { result.push([start, start + best.width]); start += best.width + GAP; }
  return result;
}

function stateOf(group: FacadeWindowState): FacadeWindowState {
  return { id: group.id, axis: group.axis, plane: group.plane, base: group.base, lower: group.lower, upper: group.upper,
    u0: group.u0, u1: group.u1, panes: group.panes };
}

/** Plan once per source edit, independently of render tiles. Existing legal openings keep their exact geometry and IDs. */
export function planFacades(source: PcgSource, buildings: readonly PcgBuilding[], previous?: FacadeLayout): FacadePlan {
  const previousGroups = previous?.version === 2 && Array.isArray(previous.groups) ? previous.groups : [];
  const runs = extractRuns(source, buildings, previousGroups), groups: FacadeGroup[] = [];
  const seen = new Set<string>(), kept = new Map<Run, FacadeWindowState[]>(), assigned: FacadeWindowState[] = [];
  const sameWall = (a: FacadeWindowState, b: FacadeWindowState) => a.axis === b.axis && a.plane === b.plane;
  const verticalOverlap = (a: Pick<FacadeWindowState, 'lower' | 'upper'>, b: Pick<FacadeWindowState, 'lower' | 'upper'>) =>
    overlaps(a.lower - 2 / SCALE, a.upper + 1 / SCALE, b.lower - 2 / SCALE, b.upper + 1 / SCALE);
  // Keep legal historical groups before filling any new floor band. Otherwise a new datum
  // created by foundation edits could steal space from a perfectly intact upper window.
  for (const run of runs) {
    if (run.hi - run.lo < 2 * SCALE) continue; // Three source columns before opening a new architectural bay.
    const { band } = run, retained: FacadeWindowState[] = [];
    const matching = previousGroups.filter(g => g.axis === band.axis && g.plane === band.plane && g.base * SCALE === band.base)
      .sort((a, b) => a.u0 - b.u0 || a.u1 - b.u1 || a.id.localeCompare(b.id));
    for (const old of matching) {
      const lo = Math.round(old.u0 * SCALE), hi = Math.round(old.u1 * SCALE);
      if (!old.id || seen.has(old.id) || ![old.u0, old.u1, old.lower, old.upper].every(quantized)
        || lo < run.lo || hi > run.hi || hi - lo < MIN_WINDOW || hi - lo > MAX_WINDOW
        || old.lower * SCALE !== band.base + LOWER || old.upper * SCALE !== band.base + UPPER
        || !Number.isInteger(old.panes) || old.panes < 1 || old.panes > 4 || !visibleSides(run, lo, hi).length
        || assigned.some(g => sameWall(g, old) && verticalOverlap(g, old) && lo < g.u1 * SCALE + GAP && hi > g.u0 * SCALE - GAP)) continue;
      const state = stateOf(old); retained.push(state); assigned.push(state); seen.add(old.id);
    }
    kept.set(run, retained);
  }
  for (const run of runs) {
    if (run.hi - run.lo < 2 * SCALE) continue;
    const { band } = run, candidates = [...(kept.get(run) ?? [])];
    const lower = (band.base + LOWER) / SCALE, upper = (band.base + UPPER) / SCALE;
    const reserved = assigned.filter(g => g.axis === band.axis && g.plane === band.plane && verticalOverlap(g, { lower, upper }))
      .map(g => ({ lo: Math.max(run.lo, g.u0 * SCALE - GAP), hi: Math.min(run.hi, g.u1 * SCALE + GAP) }))
      .filter(s => s.hi > s.lo).sort((a, b) => a.lo - b.lo || a.hi - b.hi);
    let cursor = run.lo;
    for (const occupied of [...reserved, { lo: run.hi, hi: run.hi }]) {
      const end = occupied.lo;
      for (const [lo, hi] of packSpan(cursor, end)) {
        if (!visibleSides(run, lo, hi).length) continue;
        const candidate: FacadeWindowState = { id: `window-group:${bandKey(band.axis, band.plane, band.base)}:${lo}:${hi}`,
          axis: band.axis, plane: band.plane, base: band.base / SCALE, lower, upper,
          u0: lo / SCALE, u1: hi / SCALE, panes: Math.max(2, Math.min(3, Math.round((hi - lo) / SCALE))) };
        if (!seen.has(candidate.id)) { candidates.push(candidate); assigned.push(candidate); seen.add(candidate.id); }
      }
      cursor = Math.max(cursor, occupied.hi);
    }
    for (const candidate of candidates.sort((a, b) => a.u0 - b.u0)) {
      const dependencies: PcgPoint[] = [];
      for (let u = Math.floor(candidate.u0 - 2 / SCALE); u < Math.ceil(candidate.u1 + 2 / SCALE); u++)
        for (let y = Math.floor(candidate.base); y < Math.ceil(candidate.base + WALL_SUPPORT / SCALE); y++)
          for (const offset of [-1, 0, 1]) dependencies.push(at(band.axis, band.plane + offset, u, y));
      groups.push({ ...candidate, facadeId: run.patch.id, faces: visibleSides(run, candidate.u0 * SCALE, candidate.u1 * SCALE), dependencies });
    }
  }
  groups.sort((a, b) => a.id.localeCompare(b.id));
  return { layout: { version: 2, groups: groups.map(stateOf) }, groups, patches: runs.map(r => r.patch) };
}
