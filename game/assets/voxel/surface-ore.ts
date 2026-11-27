export const MINING_RULES = Object.freeze({
  stoneEveryNVeins: 2,
  reserves: {stone: 24, pigIron: 18},
  batch: 3,
  workPerBatch: 8,
});

export interface SurfaceOreCell { x: number; y: number; z: number }
export interface SurfaceOreSettings {
  readonly veinsPer10kCells: number;
  readonly minVeinSize: number;
  readonly maxVeinSize: number;
  readonly edgeMargin: number;
}

/** Generation v3 defaults: 24 veins on a 250 × 250 map. Changing these requires a new generator version. */
export const SURFACE_STEEL_ORE_SETTINGS: SurfaceOreSettings = Object.freeze({
  veinsPer10kCells: 3.84,
  minVeinSize: 6,
  maxVeinSize: 16,
  edgeMargin: 2,
});

export interface SurfaceOreSource {
  readonly width: number;
  readonly depth: number;
  /** Exposed, dry, unoccupied ground's voxel Y, or -1 when the column is unsuitable. */
  candidateHeightAt(x: number, z: number): number;
}

/** Bounded, seeded growth on flat surface patches; every accepted vein is face-connected. */
export function planSurfaceOreVeins(
  source: SurfaceOreSource,
  seed: number,
  settings: SurfaceOreSettings = SURFACE_STEEL_ORE_SETTINGS,
): SurfaceOreCell[][] {
  const { width, depth } = source;
  const { veinsPer10kCells, minVeinSize, maxVeinSize, edgeMargin } = settings;
  if (!Number.isFinite(veinsPer10kCells) || veinsPer10kCells < 0
    || ![minVeinSize, maxVeinSize, edgeMargin].every(Number.isInteger)
    || minVeinSize < 2 || maxVeinSize < minVeinSize || edgeMargin < 0) {
    throw new RangeError('矿脉生成参数不正确。');
  }
  if (veinsPer10kCells === 0) return [];
  const target = Math.max(1, Math.round(width * depth * veinsPer10kCells / 10000));
  const heights = new Int16Array(width * depth).fill(-1), blocked = new Uint8Array(width * depth);
  const candidates: number[] = [];
  for (let z = edgeMargin; z < depth - edgeMargin; z++) for (let x = edgeMargin; x < width - edgeMargin; x++) {
    const y = source.candidateHeightAt(x, z);
    if (y > 0) { const index = x + z * width; heights[index] = y; candidates.push(index); }
  }
  // This stream is independent of terrain and vegetation RNG consumption.
  let state = (seed >>> 0) || 0x9e3779b9;
  const random = () => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j]!, candidates[i]!];
  }
  const veins: SurfaceOreCell[][] = [];
  for (const anchor of candidates) {
    if (veins.length >= target) break;
    if (blocked[anchor]) continue;
    const y = heights[anchor]!, requested = minVeinSize + Math.floor(random() * (maxVeinSize - minVeinSize + 1));
    const frontier = [anchor], seen = new Set<number>(frontier), cells: number[] = [];
    while (frontier.length && cells.length < requested) {
      const pick = Math.floor(random() * frontier.length), index = frontier[pick]!;
      frontier[pick] = frontier[frontier.length - 1]!; frontier.pop();
      cells.push(index);
      const x = index % width, z = Math.floor(index / width);
      for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const nx = x + dx!, nz = z + dz!;
        if (nx < 0 || nx >= width || nz < 0 || nz >= depth) continue;
        const next = nx + nz * width;
        if (!blocked[next] && heights[next] === y && !seen.has(next)) { seen.add(next); frontier.push(next); }
      }
    }
    if (cells.length < minVeinSize) {
      // Exhausted components cannot form a vein; don't repeatedly retry each cell.
      for (const index of cells) blocked[index] = 1;
      continue;
    }
    const vein = cells.map(index => ({ x: index % width, y, z: Math.floor(index / width) }));
    veins.push(vein);
    // Reserve a one-column halo at every elevation so adjacent veins cannot merge.
    for (const { x, z } of vein) for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, nz = z + dz;
      if (nx >= 0 && nx < width && nz >= 0 && nz < depth) blocked[nx + nz * width] = 1;
    }
  }
  return veins;
}
