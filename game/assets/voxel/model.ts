import type { FacadeLayout, FacadeWindowState } from './pcg/facade.ts';
import {treeBounds,treeCells,type TreeInstance} from './trees.ts';
import { planSurfaceOreVeins } from './surface-ore.ts';

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
  Planks: 5, Brick: 6, Leaves: 7, Water: 8, Sand: 9, Road: 10, SteelOre: 11,
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
  { id: 11, name: '钢矿', color: [0.35, 0.39, 0.40], solid: true, buildable: false },
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
interface TreeChange { id:string; before:TreeInstance|null; after:TreeInstance|null }
interface EditTransaction { changes: Change[]; treeChanges:TreeChange[]; facadeBefore: FacadeLayout; facadeAfter: FacadeLayout }
interface SavedWorld {
  version: 1;
  generatorVersion: 1 | 2 | 3;
  seed: string;
  size: [number, number, number];
  edits: [number, number][];
  facadeLayout?: FacadeLayout;
  treeVersion?: 1;
  trees?: TreeInstance[];
}
const HISTORY_LIMIT = 200;
const MAX_WORLD_VOLUME = 16_777_216;
const WATER_LEVEL = 4;
const emptyFacadeLayout = (): FacadeLayout => ({ version: 2, groups: [] });
const copyFacadeLayout = (layout: FacadeLayout): FacadeLayout => ({ version: 2, groups: layout.groups.map(g => ({ ...g })) });

/** Revert only this edit's window changes, preserving later independent colony construction. */
function applyFacadeDelta(current: FacadeLayout, from: FacadeLayout, to: FacadeLayout): FacadeLayout {
  const before = new Map(from.groups.map(g => [g.id, g])), after = new Map(to.groups.map(g => [g.id, g]));
  const changed = new Set([...before.keys(), ...after.keys()].filter(id => JSON.stringify(before.get(id)) !== JSON.stringify(after.get(id))));
  return { version: 2, groups: [...current.groups.filter(g => !changed.has(g.id)), ...to.groups.filter(g => changed.has(g.id))]
    .sort((a, b) => a.id.localeCompare(b.id)) };
}

/** Layout hints are save data, never trusted geometry; the planner rechecks support and clearance. */
function readFacadeLayout(value: unknown, size: WorldSize): FacadeLayout {
  if (value === undefined) return emptyFacadeLayout();
  if (!value || typeof value !== 'object') throw new RangeError('窗组布局格式不正确。');
  const data = value as Partial<FacadeLayout>;
  if (data.version !== 2 || !Array.isArray(data.groups) || data.groups.length > Math.min(100000, size.width * size.height * size.depth))
    throw new RangeError('不支持此窗组布局版本或布局过大。');
  const seen = new Set<string>();
  const groups = data.groups.map((g: FacadeWindowState) => {
    if (!g || typeof g.id !== 'string' || g.id.length < 1 || g.id.length > 200 || seen.has(g.id)
      || (g.axis !== 'x' && g.axis !== 'z')) throw new RangeError('窗组标识不正确。');
    const values = [g.plane, g.base, g.lower, g.upper, g.u0, g.u1];
    const width = g.axis === 'x' ? size.width : size.depth, depth = g.axis === 'x' ? size.depth : size.width;
    if (!values.every(v => Number.isFinite(v) && Number.isInteger(v * 16))
      || !Number.isInteger(g.plane) || g.plane < 0 || g.plane >= depth || g.base < 0
      || g.lower < g.base || g.upper <= g.lower || g.upper > size.height + 1
      || g.u0 < 0 || g.u1 > width || g.u1 - g.u0 < 1.5
      || !Number.isInteger(g.panes) || g.panes < 1 || g.panes > 8) throw new RangeError('窗组尺寸不正确。');
    seen.add(g.id);
    return { id: g.id, axis: g.axis, plane: g.plane, base: g.base, lower: g.lower, upper: g.upper, u0: g.u0, u1: g.u1, panes: g.panes };
  });
  return { version: 2, groups };
}

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
  return Number.isInteger(block) && block >= BLOCK.Air && block <= BLOCK.SteelOre;
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
  private past: EditTransaction[] = [];
  private future: EditTransaction[] = [];
  private facadeLayout: FacadeLayout = emptyFacadeLayout();
  private pendingFacade: EditTransaction | null = null;
  private facadeResolver: (() => FacadeLayout) | null = null;
  private dirty = new Set<string>();
  private detailCells = new Map<string, Set<number>>();
  private pcgDirty = new Set<string>();
  private pcgReset = true;
  private _seed = '';
  private _revision = 0;
  private _generatorVersion: 1 | 2 | 3 = 3;
  private treeMap=new Map<string,TreeInstance>();
  private treeBaseline=new Map<string,TreeInstance>();
  private legacyVegetation=new Map<number,BlockId>();
  private treeVoxels=new Map<number,Set<string>>();
  private treeSolidVoxels=new Map<number,Set<string>>();
  private treeColumns=new Map<number,Set<string>>();
  private treeRoots=new Map<number,string>();
  private treeDiffs=new Set<string>();
  private treeList:readonly TreeInstance[]|null=null;
  private _treeRevision=0;

  constructor(seed = '森屿-042', size: WorldSize = WORLD_SIZE) { this.regenerate(seed, size, 3); }
  get seed(): string { return this._seed; }
  get revision(): number { return this._revision; }
  get generatorVersion(): 1 | 2 | 3 { return this._generatorVersion; }
  /** Number of changed raw cells and natural tree identities; also suitable for save status. */
  get editCount(): number { return this.changes.size+this.treeDiffs.size; }
  get treeRevision():number {return this._treeRevision;}
  getTrees():readonly TreeInstance[] {
    return this.treeList??=Object.freeze([...this.treeMap.values()].sort((a,b)=>a.id.localeCompare(b.id)));
  }
  getTree(id:string):TreeInstance|undefined {return this.treeMap.get(id);}
  treesAtVoxel(x:number,y:number,z:number):readonly TreeInstance[] {
    if(!this.inBounds(x,y,z))return[];
    return [...this.treeVoxels.get(this.index(x,y,z))??[]].map(id=>this.treeMap.get(id)!).sort((a,b)=>a.id.localeCompare(b.id));
  }
  treeAtVoxel(x:number,y:number,z:number):TreeInstance|undefined {return this.treesAtVoxel(x,y,z)[0];}
  treeAtColumn(x:number,z:number):TreeInstance|undefined {
    if(!this.inBounds(x,0,z))return undefined;const id=this.treeRoots.get(x+z*this.width);return id?this.treeMap.get(id):undefined;
  }
  treesInColumn(x:number,z:number):readonly TreeInstance[] {
    if(!this.inBounds(x,0,z))return[];
    return [...this.treeColumns.get(x+z*this.width)??[]].map(id=>this.treeMap.get(id)!).sort((a,b)=>a.id.localeCompare(b.id));
  }
  treeBlocksVoxel(x:number,y:number,z:number):boolean {return this.inBounds(x,y,z)&&!!this.treeSolidVoxels.get(this.index(x,y,z))?.size;}
  private indexTree(tree:TreeInstance,add:boolean):void {
    const change=(index:Map<number,Set<string>>,key:number)=>{
      if(add){let ids=index.get(key);if(!ids){ids=new Set();index.set(key,ids);}ids.add(tree.id);}
      else{const ids=index.get(key);ids?.delete(tree.id);if(ids?.size===0)index.delete(key);}
    };
    const columns=new Set<number>();
    for(const c of treeCells(tree))if(this.inBounds(c.x,c.y,c.z)){
      change(this.treeVoxels,this.index(c.x,c.y,c.z));if(c.role!=='crown')change(this.treeSolidVoxels,this.index(c.x,c.y,c.z));
      columns.add(c.x+c.z*this.width);this.markPcgCellDirty(c.x,c.z);
    }
    for(const key of columns)change(this.treeColumns,key);
    if(add){this.treeMap.set(tree.id,tree);this.treeRoots.set(tree.x+tree.z*this.width,tree.id);}
    else{this.treeMap.delete(tree.id);this.treeRoots.delete(tree.x+tree.z*this.width);}
    const initial=this.treeBaseline.get(tree.id),current=add?tree:undefined;
    if(JSON.stringify(initial)===JSON.stringify(current))this.treeDiffs.delete(tree.id);else this.treeDiffs.add(tree.id);
    this.treeList=null;
  }
  private replaceTrees(trees:readonly TreeInstance[]):void {
    this.treeMap.clear();this.treeVoxels.clear();this.treeSolidVoxels.clear();this.treeColumns.clear();this.treeRoots.clear();this.treeList=null;this.treeDiffs.clear();
    for(const tree of trees)this.indexTree(Object.freeze({...tree}),true);
    for(const id of this.treeBaseline.keys())if(!this.treeMap.has(id))this.treeDiffs.add(id);
    this._treeRevision++;
  }
  removeTree(id:string,options:{recordHistory?:boolean}={}):boolean {
    const tree=this.treeMap.get(id);if(!tree)return false;
    this.settleFacadeEdit();
    const transaction:EditTransaction={changes:[],treeChanges:[{id,before:tree,after:null}],facadeBefore:this.facadeLayout,facadeAfter:this.facadeLayout};
    this.applyTreeChanges(transaction.treeChanges,false);this._revision++;
    if(options.recordHistory===false){
      // A resident's harvested wood cannot be duplicated by undoing an earlier sandbox edit.
      this.past=this.past.filter(t=>!t.treeChanges.some(c=>c.id===id));this.future=this.future.filter(t=>!t.treeChanges.some(c=>c.id===id));
      this.pendingFacade=null;
    }else this.recordTransaction(transaction);
    return true;
  }
  get canUndo(): boolean { return this.past.length > 0; }
  get canRedo(): boolean { return this.future.length > 0; }
  get undoCount(): number { return this.past.length; }
  get redoCount(): number { return this.future.length; }
  getFacadeLayout(): FacadeLayout { return copyFacadeLayout(this.facadeLayout); }
  /** The view supplies pure planning, so batched edits can settle history without rebuilding meshes. */
  setFacadeResolver(resolver: (() => FacadeLayout) | null): void { this.facadeResolver = resolver; }
  private settleFacadeEdit(): void {
    if (this.pendingFacade && this.facadeResolver) this.setFacadeLayout(this.facadeResolver());
  }
  /** Commit the derived placement parameters into the same source edit, without adding an undo step. */
  setFacadeLayout(layout: FacadeLayout): void {
    this.facadeLayout = readFacadeLayout(layout, this.size);
    if (this.pendingFacade) {
      this.pendingFacade.facadeAfter = this.facadeLayout;
      this.pendingFacade = null;
    }
  }
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
  set(x: number, y: number, z: number, block: number, options: { recordHistory?: boolean } = {}): boolean {
    return this.edit([{ x, y, z, block }], options);
  }
  /** Validate every edit before applying any. Repeated cells coalesce into one change. */
  edit(edits: readonly BlockEdit[], options: { recordHistory?: boolean } = {}): boolean {
    if (!Array.isArray(edits) || edits.length > this.blocks.length * 4) throw new RangeError('建造操作过大或格式不正确。');
    const final = new Map<number, number>();
    for (const edit of edits) {
      if (!edit || !this.inBounds(edit.x, edit.y, edit.z)) throw new RangeError('方块坐标超出地图范围。');
      if (edit.y === 0) throw new RangeError('基岩层不可修改。');
      if (!validBlock(edit.block)) throw new RangeError('未知的方块类型。');
      final.set(this.index(edit.x, edit.y, edit.z), edit.block);
    }
    const removed=new Map<string,TreeInstance>();
    for(const[index,block]of final){
      const[x,y,z]=this.coordinates(index);
      if(block===BLOCK.Air)for(const tree of this.treesAtVoxel(x,y,z))removed.set(tree.id,tree);
      const root=this.treeAtColumn(x,z);
      if(root&&y===root.y-1&&(!BLOCKS[block]?.solid||block===BLOCK.Wood||block===BLOCK.Leaves))removed.set(root.id,root);
    }
    for(const[index,block]of final)if(block!==BLOCK.Air){
      const[x,y,z]=this.coordinates(index);
      if(this.treesAtVoxel(x,y,z).some(tree=>!removed.has(tree.id)))throw new RangeError('树木占用此处，请先整体移除树木。');
    }
    const changes: Change[] = [];
    for (const [index, after] of final) {
      const before = this.blocks[index];
      if (before !== after) changes.push({ index, before, after });
    }
    if (changes.length === 0&&removed.size===0) return false;
    this.settleFacadeEdit();
    const transaction: EditTransaction = { changes,treeChanges:[...removed.values()].map(tree=>({id:tree.id,before:tree,after:null})), facadeBefore: this.facadeLayout, facadeAfter: this.facadeLayout };
    this.apply(changes, false);
    this.applyTreeChanges(transaction.treeChanges,false);
    if (options.recordHistory === false) {
      // Gameplay consumption cannot be reversed through an older sandbox edit at this cell.
      const touched = new Set(changes.map(change => change.index));
      const independent = (entry: EditTransaction) => !entry.changes.some(change => touched.has(change.index))
        && !entry.treeChanges.some(change => removed.has(change.id));
      this.past = this.past.filter(independent); this.future = this.future.filter(independent);
      this.pendingFacade = null;
    } else this.recordTransaction(transaction);
    return true;
  }
  private recordTransaction(transaction:EditTransaction):void {
    this.pendingFacade = transaction;
    this.past.push(transaction);
    if (this.past.length > HISTORY_LIMIT) this.past.shift();
    this.future.length = 0;
  }
  private applyTreeChanges(changes:readonly TreeChange[],reverse:boolean):void {
    if(!changes.length)return;
    for(const change of changes){
      const current=this.treeMap.get(change.id);if(current)this.indexTree(current,false);
      const next=reverse?change.before:change.after;if(next)this.indexTree(next,true);
    }
    this._treeRevision++;
  }
  private restoredTrees(transaction:EditTransaction,reverse:boolean):TreeInstance[] {
    return transaction.treeChanges.flatMap(change=>{const tree=reverse?change.before:change.after;return tree?[tree]:[];});
  }
  private treeHasObstacle(tree:TreeInstance,get:(x:number,y:number,z:number)=>number=(x,y,z)=>this.get(x,y,z)):boolean {
    return treeCells(tree).some(c=>{
      if(c.role==='crown')return false;
      const block=get(c.x,c.y,c.z);
      // A native hillside may touch a branch. Subsequent construction must never be hidden in the model.
      return block!==BLOCK.Air&&(c.role==='trunk'||block!==this.baseline[this.index(c.x,c.y,c.z)]);
    });
  }
  private canRestoreTrees(transaction:EditTransaction,reverse:boolean):boolean {
    const changed=new Map(transaction.changes.map(c=>[c.index,reverse?c.before:c.after]));
    const get=(x:number,y:number,z:number)=>changed.get(this.index(x,y,z))??this.get(x,y,z);
    for(const tree of this.restoredTrees(transaction,reverse)){
      const under=get(tree.x,tree.y-1,tree.z);
      if(!BLOCKS[under]?.solid||under===BLOCK.Wood||under===BLOCK.Leaves)return false;
      if(this.treeHasObstacle(tree,get))return false;
    }
    return true;
  }
  undo(allow?: (edits: readonly BlockEdit[]) => boolean,allowTrees?:(trees:readonly TreeInstance[])=>boolean): boolean {
    const pending = this.past.at(-1);
    if (pending && allow && !allow(pending.changes.map(c => {const [x,y,z]=this.coordinates(c.index);return{x,y,z,block:c.before};}))) return false;
    if(pending&&(!this.canRestoreTrees(pending,true)||allowTrees&&!allowTrees(this.restoredTrees(pending,true))))return false;
    this.settleFacadeEdit();
    const transaction = this.past.pop();
    if (!transaction) return false;
    this.apply(transaction.changes, true);
    this.applyTreeChanges(transaction.treeChanges,true);
    this.facadeLayout = applyFacadeDelta(this.facadeLayout, transaction.facadeAfter, transaction.facadeBefore);
    this.pendingFacade = null;
    this.future.push(transaction);
    return true;
  }
  redo(allow?: (edits: readonly BlockEdit[]) => boolean,allowTrees?:(trees:readonly TreeInstance[])=>boolean): boolean {
    const pending = this.future.at(-1);
    if (pending && allow && !allow(pending.changes.map(c => {const [x,y,z]=this.coordinates(c.index);return{x,y,z,block:c.after};}))) return false;
    if(pending&&(!this.canRestoreTrees(pending,false)||allowTrees&&!allowTrees(this.restoredTrees(pending,false))))return false;
    this.settleFacadeEdit();
    const transaction = this.future.pop();
    if (!transaction) return false;
    this.apply(transaction.changes, false);
    this.applyTreeChanges(transaction.treeChanges,false);
    this.facadeLayout = applyFacadeDelta(this.facadeLayout, transaction.facadeBefore, transaction.facadeAfter);
    this.pendingFacade = null;
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
    this.regenerate(seed, size, 3);
  }
  private regenerate(seed: string, size: WorldSize, generatorVersion: 1 | 2 | 3): void {
    validSeed(seed);
    validSize(size);
    this.size = { width: size.width, height: size.height, depth: size.depth };
    this._blocks = new Uint8Array(this.width * this.height * this.depth);
    this._seed = seed;
    this._generatorVersion = generatorVersion;
    this.treeBaseline.clear();this.legacyVegetation.clear();
    if (generatorVersion === 1) this.generateLegacy();
    else this.generate();
    // Preserve the exact old generator's vegetation mask for legacy saves, but never mesh it as loose terrain voxels.
    for(let index=0;index<this.blocks.length;index++)if(this.blocks[index]===BLOCK.Wood||this.blocks[index]===BLOCK.Leaves){
      this.legacyVegetation.set(index,this.blocks[index] as BlockId);this.blocks[index]=BLOCK.Air;
    }
    this.replaceTrees([...this.treeBaseline.values()]);
    if (generatorVersion >= 3) this.generateSurfaceOre();
    this.baseline = this.blocks.slice();
    this.recount();
    this.changes.clear();
    this.past.length = this.future.length = 0;
    this.facadeLayout = emptyFacadeLayout(); this.pendingFacade = null;
    this.dirty.clear();
    this.markAllDirty();
    this._revision++;
  }
  private generatedTree(x:number,y:number,z:number,trunkHeight:number,seed:number):void {
    const tree:TreeInstance=Object.freeze({id:`tree:${x}:${z}`,x,y,z,trunkHeight,crownRadius:2,
      variant:Math.min(2,Math.floor(hash01(x,z,seed^0x781ab)*3)),rotation:Math.min(3,Math.floor(hash01(x,z,seed^0x4f3c2)*4)) as 0|1|2|3});
    this.treeBaseline.set(tree.id,tree);
  }
  private generateSurfaceOre(): void {
    const cx = Math.floor(this.width / 2), cz = Math.floor(this.depth / 2);
    const clearingRadius = Math.min(16, Math.min(this.width, this.depth) / 4) + 4;
    const veins = planSurfaceOreVeins({
      width: this.width, depth: this.depth,
      candidateHeightAt: (x, z) => {
        if (Math.hypot(x - cx, z - cz) < clearingRadius || this.treesInColumn(x, z).length) return -1;
        const y = this.surfaceHeight(x, z), block = this.get(x, y, z);
        if (y < 1 || y >= this.height - 1
          || ![BLOCK.Grass, BLOCK.Dirt, BLOCK.Stone, BLOCK.Sand].includes(block as never)) return -1;
        return y;
      },
    }, seedHash(this.seed) ^ 0x6f726533);
    for (const vein of veins) for (const { x, y, z } of vein) this.blocks[this.index(x, y, z)] = BLOCK.SteelOre;
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
        this.generatedTree(tx,ground+1,tz,trunk,seed);
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
        this.generatedTree(tx,ground+1,tz,trunk,seed);
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
    this.settleFacadeEdit();
    const snapshot: SavedWorld = {
      version: 1, generatorVersion: this.generatorVersion, seed: this.seed,
      size: [this.width, this.height, this.depth],
      edits: [...this.changes].sort((a, b) => a[0] - b[0]),
      facadeLayout: this.getFacadeLayout(),
      treeVersion:1,trees:this.getTrees().map(tree=>({...tree})),
    };
    return JSON.stringify(snapshot);
  }
  private readTrees(value:unknown):TreeInstance[] {
    if(!Array.isArray(value)||value.length>this.width*this.depth)throw new RangeError('树木物体列表不正确。');
    const ids=new Set<string>(),roots=new Set<number>();
    return value.map((row:unknown)=>{
      if(!row||typeof row!=='object')throw new RangeError('树木物体数据不正确。');
      const t=row as TreeInstance;
      if(typeof t.id!=='string'||t.id.length<1||t.id.length>120||ids.has(t.id)
        ||![t.x,t.y,t.z,t.trunkHeight,t.crownRadius,t.variant,t.rotation].every(Number.isInteger)
        ||!this.inBounds(t.x,t.y,t.z)||t.y<1||t.trunkHeight<3||t.trunkHeight>8
        ||t.crownRadius<1||t.crownRadius>3||t.variant<0||t.variant>2||t.rotation<0||t.rotation>3)
        throw new RangeError('树木标识、尺寸或朝向不正确。');
      const bounds=treeBounds(t),root=t.x+t.z*this.width;
      if(roots.has(root)||bounds.min.some(v=>v<0)||bounds.max[0]>this.width||bounds.max[1]>this.height||bounds.max[2]>this.depth)
        throw new RangeError('树木根部重叠或整体超出地图范围。');
      const support=this.get(t.x,t.y-1,t.z);
      if(!BLOCKS[support]?.solid||support===BLOCK.Wood||support===BLOCK.Leaves||this.treeHasObstacle(t))
        throw new RangeError('树木根部没有支撑或树干体积有障碍。');
      ids.add(t.id);roots.add(root);
      return Object.freeze({id:t.id,x:t.x,y:t.y,z:t.z,trunkHeight:t.trunkHeight,crownRadius:t.crownRadius,variant:t.variant,rotation:t.rotation});
    });
  }
  static deserialize(json: string): VoxelWorld {
    if (typeof json !== 'string' || json.length > MAX_WORLD_VOLUME * 24 + 1024) throw new RangeError('存档大小不正确。');
    const saved: unknown = JSON.parse(json);
    if (!saved || typeof saved !== 'object') throw new RangeError('存档格式不正确。');
    const data = saved as Partial<SavedWorld>;
    if (data.version !== 1 || (data.generatorVersion !== 1 && data.generatorVersion !== 2 && data.generatorVersion !== 3)) throw new RangeError('不支持此存档版本。');
    validSeed(data.seed);
    if (!Array.isArray(data.size) || data.size.length !== 3) throw new RangeError('存档地图尺寸不正确。');
    const size = { width: data.size[0], height: data.size[1], depth: data.size[2] };
    validSize(size);
    if (data.generatorVersion === 1 && (size.width !== 48 || size.height !== 24 || size.depth !== 48)) throw new RangeError('旧版地图尺寸不匹配。');
    const volume = size.width * size.height * size.depth;
    const facadeLayout = readFacadeLayout(data.facadeLayout, size);
    if (!Array.isArray(data.edits) || data.edits.length > volume) throw new RangeError('存档方块数据不正确。');
    const seen = new Set<number>();
    for (const row of data.edits) {
      if (!Array.isArray(row) || row.length !== 2 || !Number.isInteger(row[0]) || row[0] < size.width * size.depth
        || row[0] >= volume || !validBlock(row[1]) || seen.has(row[0])) throw new RangeError('存档包含非法或重复方块。');
      seen.add(row[0]);
    }
    const world = new VoxelWorld(data.seed, size);
    if (data.generatorVersion !== world.generatorVersion) world.regenerate(data.seed, size, data.generatorVersion);
    const legacy=data.treeVersion===undefined&&data.trees===undefined;
    if(!legacy&&(data.treeVersion!==1||!Array.isArray(data.trees)))throw new RangeError('树木物体存档版本或格式不正确。');
    // Old saves store sparse edits relative to terrain with generated trees still baked into its cells.
    if(legacy)for(const[index,block]of world.legacyVegetation)world.blocks[index]=block;
    for (const [index, block] of data.edits) {
      world.blocks[index] = block;
    }
    if(legacy){
      const alive=[...world.treeBaseline.values()].filter(tree=>{
        for(let y=tree.y;y<tree.y+tree.trunkHeight;y++)if(world.get(tree.x,y,tree.z)!==BLOCK.Wood)return false;
        const support=world.get(tree.x,tree.y-1,tree.z);return BLOCKS[support]?.solid&&support!==BLOCK.Wood&&support!==BLOCK.Leaves;
      });
      // Remove only generated vegetation; explicit edits to other materials and hand-placed wood outside it remain terrain.
      for(const[index,generated]of world.legacyVegetation)if(world.blocks[index]===generated)world.blocks[index]=BLOCK.Air;
      world.replaceTrees(alive.filter(tree=>!world.treeHasObstacle(tree)));
    }else world.replaceTrees(world.readTrees(data.trees));
    world.changes.clear();
    for(let index=0;index<world.blocks.length;index++)if(world.blocks[index]!==world.baseline[index])world.changes.set(index,world.blocks[index]!);
    world.recount();
    world.facadeLayout = facadeLayout;
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
    this.treeBaseline=other.treeBaseline;this.legacyVegetation=other.legacyVegetation;
    this.replaceTrees(other.getTrees());
    this.facadeLayout = other.facadeLayout; this.pendingFacade = null;
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
