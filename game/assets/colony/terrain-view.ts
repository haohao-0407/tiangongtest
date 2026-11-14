import type { World, EntityHandle } from '@forgeax/engine/ecs';
import type { AssetRegistry } from '@forgeax/engine/assets-runtime';
import { createMeshBuilder } from '@forgeax/engine/geometry';
import { Materials, MeshFilter, MeshRenderer, ShadowParticipation } from '@forgeax/engine/render';
import { Name, Transform } from '@forgeax/engine/scene';
import { RenderQueue, type AssetHandle } from '@forgeax/engine/types';
import { CHUNK_SIZE, type VoxelWorld } from '../voxel/model.ts';

type Plan = { id: string; target: number; cells: [number, number][]; state: string; progress: number };
type Layer = { entity: EntityHandle; mesh: AssetHandle<'mesh'>; signature: string };
type Cell = { x: number; z: number; index: number; target: number; actual: number };
type Selection = { target: number; coordinates: Int32Array };
type Group = { kind: 'plans' | 'preview'; chunks: Map<number, Cell[]>; revision: number };

/** Chunked overlays, independent of the real terrain and its collision. */
export class TerrainPlanView {
  private material: AssetHandle<'material'>;
  private layers = new Map<string, Layer>();
  private plans: Group = { kind: 'plans', chunks: new Map(), revision: -1 };
  private brush: Group = { kind: 'preview', chunks: new Map(), revision: -1 };
  private planSelections: Selection[] = [];
  private brushSelection?: Selection;
  private source?: VoxelWorld;
  private sourceBlocks?: Uint8Array;
  private heights = new Int16Array(0);
  private heightKnown = new Uint8Array(0);
  private heightRevision = -1;
  constructor(private world: World, private assets: AssetRegistry, private terrain: () => VoxelWorld) {
    this.material = assets.create(Materials.unlit([1, 1, 1, .48], {
      queue: RenderQueue.Transparent,
      renderState: { cullMode: 'none', depthWriteEnabled: false,
        blend: { color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } } },
    })).unwrap();
  }
  update(plans: Plan[]): void {
    const terrain = this.prepareTerrain();
    const active = plans.filter(p => p.state !== 'completed');
    const changed = active.length !== this.planSelections.length || active.some((plan, i) => !this.matches(this.planSelections[i], plan.cells, plan.target));
    if (changed) {
      this.planSelections = active.map(plan => this.selection(plan.cells, plan.target));
      this.setChunks(this.plans, this.groupCells(this.planSelections, terrain));
    }
    this.refresh(this.plans, terrain, changed);
  }
  preview(cells: readonly [number, number][], target: number, _signature: string): void {
    const terrain = this.prepareTerrain();
    // Inspect coordinates as well: equal-length selections and reused caller tokens can move.
    const changed = !this.matches(this.brushSelection, cells, target);
    if (changed) {
      this.brushSelection = this.selection(cells, target);
      this.setChunks(this.brush, this.groupCells([this.brushSelection], terrain));
    }
    this.refresh(this.brush, terrain, changed);
  }
  clearPreview(): void {
    this.clearGroup(this.brush);
    this.brushSelection = undefined;
  }
  clear(): void {
    this.clearGroup(this.plans);
    this.clearPreview();
    this.planSelections = [];
    this.source = undefined;
    this.sourceBlocks = undefined;
    this.heightRevision = -1;
  }
  private prepareTerrain(): VoxelWorld {
    const terrain = this.terrain();
    // load/reset can replace the voxel buffer without replacing its world object.
    if (terrain !== this.source || terrain.blocks !== this.sourceBlocks) {
      this.clear();
      this.source = terrain;
      this.sourceBlocks = terrain.blocks;
      this.heights = new Int16Array(terrain.width * terrain.depth);
      this.heightKnown = new Uint8Array(this.heights.length);
    }
    if (this.heightRevision !== terrain.revision) {
      this.heightKnown.fill(0);
      this.heightRevision = terrain.revision;
    }
    return terrain;
  }
  private matches(selection: Selection | undefined, cells: readonly [number, number][], target: number): boolean {
    if (!selection || selection.target !== target || selection.coordinates.length !== cells.length * 2) return false;
    for (let i = 0; i < cells.length; i++) {
      if (selection.coordinates[i * 2] !== cells[i][0] || selection.coordinates[i * 2 + 1] !== cells[i][1]) return false;
    }
    return true;
  }
  private selection(cells: readonly [number, number][], target: number): Selection {
    const coordinates = new Int32Array(cells.length * 2);
    for (let i = 0; i < cells.length; i++) {
      coordinates[i * 2] = cells[i][0]; coordinates[i * 2 + 1] = cells[i][1];
    }
    return { target, coordinates };
  }
  private groupCells(selections: Selection[], terrain: VoxelWorld): Map<number, Cell[]> {
    const cells = new Map<number, Cell>();
    for (const { target, coordinates } of selections) for (let i = 0; i < coordinates.length; i += 2) {
      const x = coordinates[i], z = coordinates[i + 1];
      if (x < 0 || z < 0 || x >= terrain.width || z >= terrain.depth) continue;
      const index = x + z * terrain.width;
      // Later plans retain the previous overlay's precedence on overlapping cells.
      cells.set(index, { x, z, index, target, actual: Number.NaN });
    }
    const chunks = new Map<number, Cell[]>(), columns = Math.ceil(terrain.width / CHUNK_SIZE);
    for (const cell of cells.values()) {
      const key = Math.floor(cell.x / CHUNK_SIZE) + Math.floor(cell.z / CHUNK_SIZE) * columns;
      let chunk = chunks.get(key);
      if (!chunk) chunks.set(key, chunk = []);
      chunk.push(cell);
    }
    for (const chunk of chunks.values()) chunk.sort((a, b) => a.index - b.index);
    return chunks;
  }
  private setChunks(group: Group, chunks: Map<number, Cell[]>): void {
    for (const key of group.chunks.keys()) if (!chunks.has(key)) this.remove(`${group.kind}:${key}`);
    group.chunks = chunks;
  }
  private refresh(group: Group, terrain: VoxelWorld, layoutChanged: boolean): void {
    if (!layoutChanged && group.revision === terrain.revision) return;
    for (const [chunk, cells] of group.chunks) {
      let changed = layoutChanged;
      for (const cell of cells) {
        if (!this.heightKnown[cell.index]) {
          this.heights[cell.index] = terrain.terrainHeight(cell.x, cell.z);
          this.heightKnown[cell.index] = 1;
        }
        const actual = this.heights[cell.index];
        if (cell.actual !== actual) { cell.actual = actual; changed = true; }
      }
      if (!changed) continue;
      const key = `${group.kind}:${chunk}`;
      // An exact signature avoids hash collisions and unchanged chunk geometry rebuilds.
      const signature = cells.map(cell => `${cell.index}:${cell.target}:${cell.actual}`).join(';');
      if (this.layers.get(key)?.signature !== signature) this.draw(key, group.kind, cells, signature);
    }
    group.revision = terrain.revision;
  }
  private clearGroup(group: Group): void {
    for (const key of group.chunks.keys()) this.remove(`${group.kind}:${key}`);
    group.chunks.clear();
    group.revision = -1;
  }
  private draw(key: string, kind: Group['kind'], cells: Cell[], signature: string): void {
    const position = new Float32Array(cells.length * 12), normal = new Float32Array(cells.length * 12);
    const color = new Float32Array(cells.length * 16), uv = new Float32Array(cells.length * 8), indices = new Uint32Array(cells.length * 6);
    for (let i = 0; i < cells.length; i++) {
      const { x, z, target, actual } = cells[i];
      // Cutting markers stay above the existing ground instead of being hidden under it.
      const y = Math.max(actual, target) + (kind === 'preview' ? .075 : .04), inset = .065;
      const red = actual > target ? 1 : actual < target ? .13 : .48;
      const green = actual > target ? .38 : actual < target ? .85 : .9;
      const blue = actual > target ? .12 : actual < target ? .94 : .4;
      for (let corner = 0; corner < 4; corner++) {
        const xx = corner < 2 ? inset : 1 - inset, zz = corner === 0 || corner === 3 ? inset : 1 - inset;
        const vertex = i * 4 + corner;
        position[vertex * 3] = x + xx; position[vertex * 3 + 1] = y; position[vertex * 3 + 2] = z + zz;
        normal[vertex * 3 + 1] = 1;
        color[vertex * 4] = red; color[vertex * 4 + 1] = green; color[vertex * 4 + 2] = blue; color[vertex * 4 + 3] = 1;
        uv[vertex * 2] = xx; uv[vertex * 2 + 1] = zz;
      }
      const offset = i * 4, at = i * 6;
      indices[at] = offset; indices[at + 1] = offset + 1; indices[at + 2] = offset + 2;
      indices[at + 3] = offset; indices[at + 4] = offset + 2; indices[at + 5] = offset + 3;
    }
    const mesh = createMeshBuilder({ attributes: { position, normal, color, uv }, indices }).build().unwrap();
    const old = this.layers.get(key);
    if (old) { this.assets.replace(old.mesh, mesh).unwrap(); old.signature = signature; }
    else {
      const handle = this.assets.create(mesh).unwrap();
      const entity = this.world.spawn(
        { component: Name, data: { value: kind === 'preview' ? '等高笔刷预览' : '整地蓝图' } },
        { component: Transform, data: {} }, { component: MeshFilter, data: { assetHandle: handle } },
        { component: MeshRenderer, data: { materials: [this.material] } },
        { component: ShadowParticipation, data: { cast: false, receive: false } },
      ).unwrap();
      this.layers.set(key, { entity, mesh: handle, signature });
    }
  }
  private remove(key: string): void {
    const layer = this.layers.get(key); if (!layer) return;
    this.world.despawn(layer.entity).unwrap(); this.assets.release(layer.mesh).unwrap(); this.layers.delete(key);
  }
  dispose(): void { this.clear(); this.assets.release(this.material).unwrap(); }
}
