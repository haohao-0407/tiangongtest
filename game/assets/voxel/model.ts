/** Engine-independent world state. Coordinates are integer cells, with Y pointing up. */
export type Vec3 = [number, number, number];
export interface WorldSize { width: number; height: number; depth: number }
export const WORLD_SIZE = { width: 250, height: 24, depth: 250 } as const;
export const LEGACY_WORLD_SIZE = { width: 48, height: 24, depth: 48 } as const;
// Larger chunks keep a 250 × 250 map to 121 terrain draw entities at the default height.
export const CHUNK_SIZE = 24;
/** Semantic detail tiles are independent of terrain draw chunks. */
export const DETAIL_TILE_SIZE = 8;
export const BLOCK = {
  Air: 0, Grass: 1, Dirt: 2, Stone: 3, Wood: 4,
  Planks: 5, Brick: 6, Leaves: 7, Water: 8, Sand: 9, Road: 10,
} as const;
export type BlockId = typeof BLOCK[keyof typeof BLOCK];
export interface BlockDefinition {
  id: BlockId;
  name: string;
  color: Vec3;
  solid: boolean;
  buildable: boolean;
}
export const BLOCKS: readonly BlockDefinition[] = [
  { id: 0, name: '空气', color: [0, 0, 0], solid: false, buildable: false },
  { id: 1, name: '草地', color: [0.38, 0.61, 0.25], solid: true, buildable: true },
  { id: 2, name: '泥土', color: [0.47, 0.30, 0.17], solid: true, buildable: true },
  { id: 3, name: '石块', color: [0.53, 0.57, 0.56], solid: true, buildable: true },
  { id: 4, name: '原木', color: [0.40, 0.24, 0.12], solid: true, buildable: true },
  { id: 5, name: '木板', color: [0.76, 0.54, 0.29], solid: true, buildable: true },
  { id: 6, name: '砖墙', color: [0.68, 0.35, 0.24], solid: true, buildable: true },
  { id: 7, name: '树叶', color: [0.23, 0.46, 0.20], solid: true, buildable: true },
  { id: 8, name: '河水', color: [0.22, 0.57, 0.66], solid: false, buildable: false },
  { id: 9, name: '沙土', color: [0.83, 0.74, 0.48], solid: true, buildable: true },
  { id: 10, name: '道路', color: [0.49, 0.51, 0.49], solid: true, buildable: true },
];
export interface BlockEdit { x: number; y: number; z: number; block: number }
export interface ChunkCoord { x: number; y: number; z: number }
export interface DetailTileCoord { x: number; z: number }
export interface PcgDirtyTiles { reset: boolean; tiles: DetailTileCoord[] }
export interface VoxelHit {
  cell: Vec3;
  normal: Vec3 | null;
  adjacent: Vec3 | null;
  block: BlockId;
  distance: number;
}
interface Change { index: number; before: number; after: number }
interface SavedWorld {
  version: 1;
  generatorVersion: 1 | 2;
  seed: string;
  size: [number, number, number];
  edits: [number, number][];
}
const HISTORY_LIMIT = 200;
const MAX_WORLD_VOLUME = 16_777_216;
const WATER_LEVEL = 4;

function seedHash(seed: string): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) hash = Math.imul(hash ^ seed.charCodeAt(i), 16777619);
  return hash >>> 0;
}
function hash01(x: number, z: number, seed: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263) ^ seed;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function smooth(t: number): number { return t * t * (3 - 2 * t); }
function mix(a: number, b: number, t: number): number { return a + (b - a) * t; }
function noise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x), iz = Math.floor(z), fx = smooth(x - ix), fz = smooth(z - iz);
  return mix(mix(hash01(ix, iz, seed), hash01(ix + 1, iz, seed), fx),
    mix(hash01(ix, iz + 1, seed), hash01(ix + 1, iz + 1, seed), fx), fz);
}
function validSeed(seed: unknown): asserts seed is string {
  if (typeof seed !== 'string' || seed.length === 0 || seed.length > 128) {
    throw new RangeError('地图种子必须为 1–128 个字符。');
  }
}
function validBlock(block: number): block is BlockId {
  return Number.isInteger(block) && block >= BLOCK.Air && block <= BLOCK.Road;
}
function validSize(size: WorldSize): void {
  if (!size || ![size.width, size.height, size.depth].every(Number.isInteger)
    || size.width < 8 || size.width > 512 || size.depth < 8 || size.depth > 512
    || size.height < 8 || size.height > 128 || size.width * size.height * size.depth > MAX_WORLD_VOLUME) {
    throw new RangeError('地图尺寸不正确或超出可支持范围。');
  }
}

/** Finite, seeded, chunk-addressable voxel world with bounded transactional history. */
export class VoxelWorld {
  private size: WorldSize = { ...WORLD_SIZE };
  get width(): number { return this.size.width; }
  get height(): number { return this.size.height; }
  get depth(): number { return this.size.depth; }
  readonly chunkSize = CHUNK_SIZE;
  /** Read for rendering. Mutations must go through edit/set for history and dirty tracking. */
  private _blocks = new Uint8Array(0);
  get blocks(): Uint8Array { return this._blocks; }
  private baseline = new Uint8Array(0);
  private blockCounts = new Uint32Array(BLOCKS.length);
  private changes = new Map<number, number>();
  private past: Change[][] = [];
  private future: Change[][] = [];
  private dirty = new Set<string>();
  private detailCells = new Map<string, Set<number>>();
  private pcgDirty = new Set<string>();
  private pcgReset = true;
  private _seed = '';
  private _revision = 0;
  private _generatorVersion: 1 | 2 = 2;

  constructor(seed = '森屿-042', size: WorldSize = WORLD_SIZE) { this.regenerate(seed, size, 2); }
  get seed(): string { return this._seed; }
  get revision(): number { return this._revision; }
  get generatorVersion(): 1 | 2 { return this._generatorVersion; }
  /** Number of cells differing from the generated map; also suitable for save status. */
  get editCount(): number { return this.changes.size; }
  get canUndo(): boolean { return this.past.length > 0; }
  get canRedo(): boolean { return this.future.length > 0; }
  get undoCount(): number { return this.past.length; }
  get redoCount(): number { return this.future.length; }
  inBounds(x: number, y: number, z: number): boolean {
    return Number.isInteger(x) && Number.isInteger(y) && Number.isInteger(z)
      && x >= 0 && x < this.width && y >= 0 && y < this.height && z >= 0 && z < this.depth;
  }
  index(x: number, y: number, z: number): number { return x + this.width * (z + this.depth * y); }
  coordinates(index: number): Vec3 {
    return [index % this.width, Math.floor(index / (this.width * this.depth)), Math.floor(index / this.width) % this.depth];
  }
  get(x: number, y: number, z: number): BlockId {
    return this.inBounds(x, y, z) ? this.blocks[this.index(x, y, z)] as BlockId : BLOCK.Air;
  }
  surfaceHeight(x: number, z: number, includeWater = true): number {
    if (!Number.isInteger(x) || !Number.isInteger(z) || x < 0 || x >= this.width || z < 0 || z >= this.depth) return -1;
    for (let y = this.height - 1; y >= 0; y--) {
      const block = this.get(x, y, z);
      if (block !== BLOCK.Air && (includeWater || block !== BLOCK.Water)) return y;
    }
    return -1;
  }
  /** Ground's top face / foot height. Vegetation and water never become terrain. */
  terrainHeight(x: number, z: number): number {
    if (!this.inBounds(x, 0, z)) return -1;
    for (let y = this.height - 1; y >= 0; y--) {
      const block = this.blocks[this.index(x, y, z)]!;
      if (block !== BLOCK.Air && block !== BLOCK.Water && block !== BLOCK.Wood && block !== BLOCK.Leaves) return y + 1;
    }
    return -1;
  }
  /** Water's top face, or -1 for a column with no water. */
  waterSurfaceHeight(x: number, z: number): number {
    if (!this.inBounds(x, 0, z)) return -1;
    for (let y = this.height - 1; y >= 0; y--) if (this.blocks[this.index(x, y, z)] === BLOCK.Water) return y + 1;
    return -1;
  }
  count(block?: number): number {
    return block === undefined ? this.blocks.length - this.blockCounts[BLOCK.Air]! : this.blockCounts[block] ?? 0;
  }
  /** Sparse source nodes only: natural stone never becomes an architectural wall. */
  getDetailTiles(): DetailTileCoord[] {
    return this.detailTileCoordinates(this.detailCells.keys());
  }
  /** Query a detail tile and its dependency halo without scanning the terrain volume. */
  getDetailCellsForTile(tileX: number, tileZ: number, padding = 2): BlockEdit[] {
    if (![tileX, tileZ, padding].every(Number.isInteger) || padding < 0) throw new RangeError('细节区域参数不正确。');
    const minX = Math.max(0, tileX * DETAIL_TILE_SIZE - padding);
    const minZ = Math.max(0, tileZ * DETAIL_TILE_SIZE - padding);
    const maxX = Math.min(this.width, (tileX + 1) * DETAIL_TILE_SIZE + padding);
    const maxZ = Math.min(this.depth, (tileZ + 1) * DETAIL_TILE_SIZE + padding);
    const result: BlockEdit[] = [];
    for (let tz = Math.floor(minZ / DETAIL_TILE_SIZE); tz < Math.ceil(maxZ / DETAIL_TILE_SIZE); tz++) {
      for (let tx = Math.floor(minX / DETAIL_TILE_SIZE); tx < Math.ceil(maxX / DETAIL_TILE_SIZE); tx++) {
        const cells = this.detailCells.get(`${tx},${tz}`);
        if (!cells) continue;
        for (const index of cells) {
          const [x, y, z] = this.coordinates(index);
          if (x >= minX && x < maxX && z >= minZ && z < maxZ) result.push({ x, y, z, block: this.blocks[index]! });
        }
      }
    }
    return result.sort((a, b) => a.z - b.z || a.x - b.x || a.y - b.y);
  }
  /** Independent consumer: terrain rendering cannot swallow structural detail updates. */
  consumePcgDirtyTiles(): PcgDirtyTiles {
    const reset = this.pcgReset;
    const tiles = reset ? this.getDetailTiles() : this.detailTileCoordinates(this.pcgDirty);
    this.pcgDirty.clear();
    this.pcgReset = false;
    return { reset, tiles };
  }
  private detailTileCoordinates(keys: Iterable<string>): DetailTileCoord[] {
    return Array.from(keys, key => {
      const [x, z] = key.split(',').map(Number);
      return { x: x!, z: z! };
    }).sort((a, b) => a.z - b.z || a.x - b.x);
  }
  private indexDetailCell(index: number, block: number): void {
    const [x, , z] = this.coordinates(index);
    const key = `${Math.floor(x / DETAIL_TILE_SIZE)},${Math.floor(z / DETAIL_TILE_SIZE)}`;
    if (block === BLOCK.Brick || block === BLOCK.Road) {
      let bucket = this.detailCells.get(key);
      if (!bucket) { bucket = new Set<number>(); this.detailCells.set(key, bucket); }
      bucket.add(index);
    } else {
      const bucket = this.detailCells.get(key);
      if (bucket) { bucket.delete(index); if (bucket.size === 0) this.detailCells.delete(key); }
    }
  }
  private markPcgCellDirty(x: number, z: number): void {
    if (this.pcgReset) return;
    // Neighbouring natural cells may hide windows or change sidewalk support too.
    const radius = 2;
    for (let tz = Math.floor(Math.max(0, z - radius) / DETAIL_TILE_SIZE); tz <= Math.floor(Math.min(this.depth - 1, z + radius) / DETAIL_TILE_SIZE); tz++) {
      for (let tx = Math.floor(Math.max(0, x - radius) / DETAIL_TILE_SIZE); tx <= Math.floor(Math.min(this.width - 1, x + radius) / DETAIL_TILE_SIZE); tx++) {
        this.pcgDirty.add(`${tx},${tz}`);
      }
    }
  }
  set(x: number, y: number, z: number, block: number): boolean { return this.edit([{ x, y, z, block }]); }
  /** Validate every edit before applying any. Repeated cells coalesce into one change. */
  edit(edits: readonly BlockEdit[]): boolean {
    if (!Array.isArray(edits) || edits.length > this.blocks.length * 4) throw new RangeError('建造操作过大或格式不正确。');
    const final = new Map<number, number>();
    for (const edit of edits) {
      if (!edit || !this.inBounds(edit.x, edit.y, edit.z)) throw new RangeError('方块坐标超出地图范围。');
      if (edit.y === 0) throw new RangeError('基岩层不可修改。');
      if (!validBlock(edit.block)) throw new RangeError('未知的方块类型。');
      final.set(this.index(edit.x, edit.y, edit.z), edit.block);
    }
    const transaction: Change[] = [];
    for (const [index, after] of final) {
      const before = this.blocks[index];
      if (before !== after) transaction.push({ index, before, after });
    }
    if (transaction.length === 0) return false;
    this.apply(transaction, false);
    this.past.push(transaction);
    if (this.past.length > HISTORY_LIMIT) this.past.shift();
    this.future.length = 0;
    return true;
  }
  undo(allow?: (edits: readonly BlockEdit[]) => boolean): boolean {
    const pending = this.past.at(-1);
    if (pending && allow && !allow(pending.map(c => {const [x,y,z]=this.coordinates(c.index);return{x,y,z,block:c.before};}))) return false;
    const transaction = this.past.pop();
    if (!transaction) return false;
    this.apply(transaction, true);
    this.future.push(transaction);
    return true;
  }
  redo(allow?: (edits: readonly BlockEdit[]) => boolean): boolean {
    const pending = this.future.at(-1);
    if (pending && allow && !allow(pending.map(c => {const [x,y,z]=this.coordinates(c.index);return{x,y,z,block:c.after};}))) return false;
    const transaction = this.future.pop();
    if (!transaction) return false;
    this.apply(transaction, false);
    this.past.push(transaction);
    return true;
  }
  private apply(transaction: readonly Change[], reverse: boolean): void {
    for (const change of transaction) {
      const block = reverse ? change.before : change.after;
      this.blockCounts[this.blocks[change.index]!]!--;
      this.blockCounts[block]!++;
      this.blocks[change.index] = block;
      this.indexDetailCell(change.index, block);
      if (block === this.baseline[change.index]) this.changes.delete(change.index);
      else this.changes.set(change.index, block);
      const position = this.coordinates(change.index);
      this.markCellDirty(...position);
      this.markPcgCellDirty(position[0], position[2]);
    }
    this._revision++;
  }
  private markChunk(x: number, y: number, z: number): void {
    if (x >= 0 && x < this.width / CHUNK_SIZE && y >= 0 && y < this.height / CHUNK_SIZE && z >= 0 && z < this.depth / CHUNK_SIZE) {
      this.dirty.add(`${x},${y},${z}`);
    }
  }
  private markCellDirty(x: number, y: number, z: number): void {
    const cx = Math.floor(x / CHUNK_SIZE), cy = Math.floor(y / CHUNK_SIZE), cz = Math.floor(z / CHUNK_SIZE);
    this.markChunk(cx, cy, cz);
    if (x % CHUNK_SIZE === 0) this.markChunk(cx - 1, cy, cz);
    if (x % CHUNK_SIZE === CHUNK_SIZE - 1) this.markChunk(cx + 1, cy, cz);
    if (y % CHUNK_SIZE === 0) this.markChunk(cx, cy - 1, cz);
    if (y % CHUNK_SIZE === CHUNK_SIZE - 1) this.markChunk(cx, cy + 1, cz);
    if (z % CHUNK_SIZE === 0) this.markChunk(cx, cy, cz - 1);
    if (z % CHUNK_SIZE === CHUNK_SIZE - 1) this.markChunk(cx, cy, cz + 1);
  }
  markAllDirty(): void {
    this.pcgReset = true;
    this.pcgDirty.clear();
    for (let y = 0; y < this.height / CHUNK_SIZE; y++)
      for (let z = 0; z < this.depth / CHUNK_SIZE; z++)
        for (let x = 0; x < this.width / CHUNK_SIZE; x++) this.markChunk(x, y, z);
  }
  consumeDirtyChunks(): ChunkCoord[] {
    const chunks = [...this.dirty].map((key) => {
      const [x, y, z] = key.split(',').map(Number);
      return { x, y, z };
    });
    this.dirty.clear();
    return chunks;
  }
  /** A new map uses the current default; loading a legacy map does not pin new games to its size. */
  reset(seed = this.seed || '森屿-042', size: WorldSize = WORLD_SIZE): void {
    this.regenerate(seed, size, 2);
  }
  private regenerate(seed: string, size: WorldSize, generatorVersion: 1 | 2): void {
    validSeed(seed);
    validSize(size);
    this.size = { width: size.width, height: size.height, depth: size.depth };
    this._blocks = new Uint8Array(this.width * this.height * this.depth);
    this._seed = seed;
    this._generatorVersion = generatorVersion;
    if (generatorVersion === 1) this.generateLegacy();
    else this.generate();
    this.baseline = this.blocks.slice();
    this.recount();
    this.changes.clear();
    this.past.length = this.future.length = 0;
    this.dirty.clear();
    this.markAllDirty();
    this._revision++;
  }
  private recount(): void {
    this.blockCounts.fill(0);
    this.detailCells.clear();
    for (let index = 0; index < this.blocks.length; index++) {
      const block = this.blocks[index]!;
      this.blockCounts[block]!++;
      if (block === BLOCK.Brick || block === BLOCK.Road) this.indexDetailCell(index, block);
    }
  }
  /** Do not change: v1 saves reconstruct their baseline using these exact coordinates and rules. */
  private generateLegacy(): void {
    const seed = seedHash(this.seed), phase = hash01(0, 0, seed) * Math.PI * 2;
    const put = (x: number, y: number, z: number, value: number) => {
      if (this.inBounds(x, y, z)) this.blocks[this.index(x, y, z)] = value;
    };
    for (let z = 0; z < this.depth; z++) {
      const river = 10 + Math.sin(z / 8 + phase) * 2.7 + noise(z / 6, 9, seed) * 1.8;
      for (let x = 0; x < this.width; x++) {
        const riverDistance = Math.abs(x - river);
        const broad = noise(x / 14, z / 14, seed);
        const detail = noise(x / 5, z / 5, seed ^ 0x42f2a);
        let height = Math.floor(4 + broad * 5 + detail * 1.6);
        const hill = Math.max(0, 1 - Math.hypot(x - 39, z - 10) / 14);
        height += Math.floor(hill * 4);
        const clearing = Math.hypot(x - 27, z - 27);
        if (clearing < 7) height = 5;
        else if (clearing < 10) height = Math.round(mix(5, height, smooth((clearing - 7) / 3)));
        if (riverDistance < 2) height = 2;
        else if (riverDistance < 3.2) height = 3;
        else if (riverDistance < 4.1) height = 4;
        else if (riverDistance < 5.2) height = Math.min(height, 5);
        for (let y = 0; y <= height; y++) {
          const top = y === height;
          put(x, y, z, y === 0 || y < height - 2 ? BLOCK.Stone
            : top ? (height <= WATER_LEVEL || riverDistance < 4.6 ? BLOCK.Sand : BLOCK.Grass) : BLOCK.Dirt);
        }
        for (let y = height + 1; y <= WATER_LEVEL; y++) put(x, y, z, BLOCK.Water);
      }
    }
    // Spaced tree anchors keep the landscape readable and leave a clear building meadow.
    for (let z = 3; z < this.depth - 3; z += 4) {
      for (let x = 3; x < this.width - 3; x += 4) {
        if (hash01(x, z, seed ^ 0x63b59) > 0.49) continue;
        const tx = x + Math.floor(hash01(x + 1, z, seed) * 2), tz = z + Math.floor(hash01(x, z + 1, seed) * 2);
        if (Math.hypot(tx - 27, tz - 27) < 10) continue;
        const ground = this.surfaceHeight(tx, tz);
        if (this.get(tx, ground, tz) !== BLOCK.Grass || ground + 6 >= this.height) continue;
        const trunk = 3 + (hash01(tx, tz, seed ^ 0x34212) > 0.5 ? 1 : 0);
        for (let y = ground + 1; y <= ground + trunk; y++) put(tx, y, tz, BLOCK.Wood);
        for (let dy = -1; dy <= 2; dy++) {
          const radius = dy === 2 ? 1 : 2;
          for (let dz = -radius; dz <= radius; dz++) for (let dx = -radius; dx <= radius; dx++) {
            if (Math.abs(dx) + Math.abs(dz) > radius + 1) continue;
            const y = ground + trunk + dy;
            if (this.get(tx + dx, y, tz + dz) === BLOCK.Air) put(tx + dx, y, tz + dz, BLOCK.Leaves);
          }
        }
      }
    }
  }
  private generate(): void {
    const seed = seedHash(this.seed), phase = hash01(0, 0, seed) * Math.PI * 2;
    const cx = Math.floor(this.width / 2), cz = Math.floor(this.depth / 2);
    const scale = Math.max(0.5, Math.min(this.width, this.depth) / 100);
    const clearingRadius = Math.min(16, Math.min(this.width, this.depth) / 4);
    const maxGround = Math.max(1, this.height - 7), meadowHeight = Math.min(5, maxGround);
    const waterLevel = Math.min(WATER_LEVEL, meadowHeight - 1);
    const put = (x: number, y: number, z: number, value: number) => {
      if (this.inBounds(x, y, z)) this.blocks[this.index(x, y, z)] = value;
    };
    for (let z = 0; z < this.depth; z++) {
      const river = this.width * 0.27 + Math.sin(z / (12 * scale) + phase) * 3 * scale + noise(z / 18, 9, seed) * 2;
      for (let x = 0; x < this.width; x++) {
        const riverDistance = Math.abs(x - river);
        const broad = noise(x / (18 * scale), z / (18 * scale), seed);
        const detail = noise(x / 12, z / 12, seed ^ 0x42f2a);
        let height = Math.floor(4 + broad * 5 + detail * 1.6);
        const hill = Math.max(0, 1 - Math.hypot(x - this.width * 0.8, z - this.depth * 0.23) / (16 * scale));
        height += Math.floor(hill * 4);
        if (riverDistance < 2) height = 2;
        else if (riverDistance < 3.2) height = 3;
        else if (riverDistance < 4.1) height = 4;
        else if (riverDistance < 5.2) height = Math.min(height, 5);
        // The camp clearing wins over the river on small/custom maps too.
        const clearing = Math.hypot(x - cx, z - cz);
        if (clearing < clearingRadius) height = meadowHeight;
        else if (clearing < clearingRadius + 4) height = Math.round(mix(meadowHeight, height, smooth((clearing - clearingRadius) / 4)));
        height = Math.max(1, Math.min(maxGround, height));
        for (let y = 0; y <= height; y++) {
          const top = y === height;
          put(x, y, z, y === 0 || y < height - 2 ? BLOCK.Stone
            : top ? (height <= waterLevel ? BLOCK.Sand : BLOCK.Grass) : BLOCK.Dirt);
        }
        for (let y = height + 1; y <= waterLevel; y++) put(x, y, z, BLOCK.Water);
      }
    }
    for (let z = 3; z < this.depth - 3; z += 5) {
      for (let x = 3; x < this.width - 3; x += 5) {
        if (hash01(x, z, seed ^ 0x63b59) > 0.49) continue;
        const tx = x + Math.floor(hash01(x + 1, z, seed) * 2), tz = z + Math.floor(hash01(x, z + 1, seed) * 2);
        if (Math.hypot(tx - cx, tz - cz) < clearingRadius + 4) continue;
        const ground = this.surfaceHeight(tx, tz);
        if (this.get(tx, ground, tz) !== BLOCK.Grass || ground + 6 >= this.height) continue;
        const trunk = 3 + (hash01(tx, tz, seed ^ 0x34212) > 0.5 ? 1 : 0);
        for (let y = ground + 1; y <= ground + trunk; y++) put(tx, y, tz, BLOCK.Wood);
        for (let dy = -1; dy <= 2; dy++) {
          const radius = dy === 2 ? 1 : 2;
          for (let dz = -radius; dz <= radius; dz++) for (let dx = -radius; dx <= radius; dx++) {
            if (Math.abs(dx) + Math.abs(dz) > radius + 1) continue;
            const y = ground + trunk + dy;
            if (this.get(tx + dx, y, tz + dz) === BLOCK.Air) put(tx + dx, y, tz + dz, BLOCK.Leaves);
          }
        }
      }
    }
  }
  serialize(): string {
    const snapshot: SavedWorld = {
      version: 1, generatorVersion: this.generatorVersion, seed: this.seed,
      size: [this.width, this.height, this.depth],
      edits: [...this.changes].sort((a, b) => a[0] - b[0]),
    };
    return JSON.stringify(snapshot);
  }
  static deserialize(json: string): VoxelWorld {
    if (typeof json !== 'string' || json.length > MAX_WORLD_VOLUME * 24 + 1024) throw new RangeError('存档大小不正确。');
    const saved: unknown = JSON.parse(json);
    if (!saved || typeof saved !== 'object') throw new RangeError('存档格式不正确。');
    const data = saved as Partial<SavedWorld>;
    if (data.version !== 1 || (data.generatorVersion !== 1 && data.generatorVersion !== 2)) throw new RangeError('不支持此存档版本。');
    validSeed(data.seed);
    if (!Array.isArray(data.size) || data.size.length !== 3) throw new RangeError('存档地图尺寸不正确。');
    const size = { width: data.size[0], height: data.size[1], depth: data.size[2] };
    validSize(size);
    if (data.generatorVersion === 1 && (size.width !== 48 || size.height !== 24 || size.depth !== 48)) throw new RangeError('旧版地图尺寸不匹配。');
    const volume = size.width * size.height * size.depth;
    if (!Array.isArray(data.edits) || data.edits.length > volume) throw new RangeError('存档方块数据不正确。');
    const seen = new Set<number>();
    for (const row of data.edits) {
      if (!Array.isArray(row) || row.length !== 2 || !Number.isInteger(row[0]) || row[0] < size.width * size.depth
        || row[0] >= volume || !validBlock(row[1]) || seen.has(row[0])) throw new RangeError('存档包含非法或重复方块。');
      seen.add(row[0]);
    }
    const world = new VoxelWorld(data.seed, size);
    if (data.generatorVersion === 1) world.regenerate(data.seed, size, 1);
    for (const [index, block] of data.edits) {
      world.blocks[index] = block;
      if (block !== world.baseline[index]) world.changes.set(index, block);
    }
    world.recount();
    return world;
  }
  /** Parse and validate first, then replace; invalid saves never destroy the live map. */
  load(json: string): void {
    const other = VoxelWorld.deserialize(json);
    this._seed = other.seed;
    this.size = { ...other.size };
    this._generatorVersion = other.generatorVersion;
    this._blocks = other._blocks;
    this.baseline = other.baseline;
    this.blockCounts = other.blockCounts;
    this.detailCells = other.detailCells;
    this.changes = other.changes;
    this.past.length = this.future.length = 0;
    this.dirty.clear();
    this.markAllDirty();
    this._revision++;
  }
  raycast(origin: Vec3, direction: Vec3, maxDistance = 160): VoxelHit | null {
    return raycast(this, origin, direction, maxDistance);
  }
}

/** Grid DDA with an AABB entry test. Distance is measured in world units. */
export function raycast(world: VoxelWorld, origin: Vec3, direction: Vec3, maxDistance = 160): VoxelHit | null {
  if (![...origin, ...direction, maxDistance].every(Number.isFinite) || maxDistance < 0) return null;
  const length = Math.hypot(...direction);
  if (length < 1e-12) return null;
  const d: Vec3 = direction.map((value) => value / length) as Vec3;
  const limits: Vec3 = [world.width, world.height, world.depth];
  let enter = 0, leave = maxDistance, entryAxis = -1;
  for (let axis = 0; axis < 3; axis++) {
    if (Math.abs(d[axis]) < 1e-12) {
      if (origin[axis] < 0 || origin[axis] >= limits[axis]) return null;
      continue;
    }
    const a = -origin[axis] / d[axis], b = (limits[axis] - origin[axis]) / d[axis];
    const near = Math.min(a, b), far = Math.max(a, b);
    if (near > enter) { enter = near; entryAxis = axis; }
    leave = Math.min(leave, far);
    if (enter > leave) return null;
  }
  const epsilon = 1e-8;
  const point: Vec3 = origin.map((value, axis) => value + d[axis] * enter) as Vec3;
  const cell: Vec3 = point.map((value, axis) => Math.floor(value + d[axis] * epsilon)) as Vec3;
  const step: Vec3 = d.map((value) => Math.sign(value)) as Vec3;
  const delta: Vec3 = d.map((value) => value === 0 ? Infinity : Math.abs(1 / value)) as Vec3;
  const next: Vec3 = d.map((value, axis) => value === 0 ? Infinity
    : ((cell[axis] + (value > 0 ? 1 : 0)) - origin[axis]) / value) as Vec3;
  let distance = enter;
  let normal: Vec3 | null = null;
  if (entryAxis >= 0) { normal = [0, 0, 0]; normal[entryAxis] = -step[entryAxis]; }
  // Origin exactly on the outer boundary has a well-defined entering face as well.
  if (normal === null) for (let axis = 0; axis < 3; axis++) {
    if ((origin[axis] === 0 && d[axis] > 0) || (origin[axis] === limits[axis] && d[axis] < 0)) {
      normal = [0, 0, 0]; normal[axis] = -step[axis]; break;
    }
  }
  while (distance <= leave + epsilon && world.inBounds(...cell)) {
    const block = world.get(...cell);
    if (block !== BLOCK.Air) {
      return { cell: [...cell], normal: normal && [...normal],
        adjacent: normal ? cell.map((value, axis) => value + normal![axis]) as Vec3 : null,
        block, distance: Math.max(0, distance) };
    }
    const crossing = Math.min(...next);
    if (!Number.isFinite(crossing) || crossing > leave + epsilon) break;
    normal = null;
    // Advance all tied axes: zero-area edge contacts do not count as solid hits.
    for (let axis = 0; axis < 3; axis++) {
      if (Math.abs(next[axis] - crossing) <= epsilon) {
        if (normal === null) { normal = [0, 0, 0]; normal[axis] = -step[axis]; }
        cell[axis] += step[axis];
        next[axis] += delta[axis];
      }
    }
    distance = crossing;
  }
  return null;
}
