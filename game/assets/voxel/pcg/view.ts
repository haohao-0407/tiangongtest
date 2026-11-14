import type { World, EntityHandle } from '@forgeax/engine/ecs';
import type { AssetRegistry } from '@forgeax/engine/assets-runtime';
import { createMeshBuilder } from '@forgeax/engine/geometry';
import { Materials, MeshFilter, MeshRenderer, ShadowParticipation } from '@forgeax/engine/render';
import { Name, Transform } from '@forgeax/engine/scene';
import type { AssetHandle } from '@forgeax/engine/types';
import type { VoxelWorld } from '../model.ts';
import { buildPcgTile, PCG_TILE_SIZE, type PcgBuilding, type PcgFeature, type PcgWalkSurface } from './rules.ts';

type Entry = {
  entity: EntityHandle; handle: AssetHandle<'mesh'>;
  features: PcgFeature[]; surfaces: PcgWalkSurface[]; triangles: number;
};
type Bounds = [number, number, number];
const intersects = (a: Bounds, b: Bounds, c: Bounds, d: Bounds) =>
  a[0] < d[0] - 1e-5 && b[0] > c[0] + 1e-5 && a[1] < d[1] - 1e-5 && b[1] > c[1] + 1e-5 && a[2] < d[2] - 1e-5 && b[2] > c[2] + 1e-5;

/** Derived geometry owns no source edits. All meshes share a material and have bounded lifetimes. */
export class PcgView {
  private material: AssetHandle<'material'>;
  private entries = new Map<string, Entry>();
  private buildingKeys = new Map<string, { key: string; b: PcgBuilding }>();
  private buildings: PcgBuilding[] = [];
  private revision = 0;
  private lastSource: VoxelWorld | null = null;
  private lastRebuilt: string[] = [];
  constructor(private world: World, private assets: AssetRegistry) {
    this.material = assets.create(Materials.standard({ baseColor: [1, 1, 1, 1], roughness: .88, metallic: 0 })).unwrap();
  }
  private remove(key: string) {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.world.despawn(entry.entity).unwrap();
    this.assets.release(entry.handle).unwrap();
    this.entries.delete(key);
  }
  clear() {
    for (const key of this.entries.keys()) this.remove(key);
    this.buildingKeys.clear(); this.buildings = []; this.lastSource = null;
  }
  update(source: VoxelWorld, buildings: readonly PcgBuilding[]) {
    const changes = source.consumePcgDirtyTiles();
    const reset = changes.reset || source !== this.lastSource;
    if (reset) this.clear();
    this.lastSource = source;
    const dirty = new Set(changes.tiles.map(t => `${t.x},${t.z}`));
    const mark = (x: number, z: number, w = 1, d = 1) => {
      for (let tz = Math.floor((z - 2) / PCG_TILE_SIZE); tz <= Math.floor((z + d + 2) / PCG_TILE_SIZE); tz++)
        for (let tx = Math.floor((x - 2) / PCG_TILE_SIZE); tx <= Math.floor((x + w + 2) / PCG_TILE_SIZE); tx++)
          if (tx >= 0 && tz >= 0 && tx * PCG_TILE_SIZE < source.width && tz * PCG_TILE_SIZE < source.depth) dirty.add(`${tx},${tz}`);
    };
    if (reset) for (const t of source.getDetailTiles()) mark(t.x * PCG_TILE_SIZE, t.z * PCG_TILE_SIZE, PCG_TILE_SIZE, PCG_TILE_SIZE);
    const next = new Map<string, { key: string; b: PcgBuilding }>();
    for (const b of buildings) {
      const key = `${b.kind}:${b.x}:${b.y}:${b.z}:${b.complete}:${b.w ?? 1}:${b.d ?? 1}`;
      next.set(b.id, { key, b: { ...b } });
      const old = this.buildingKeys.get(b.id);
      if (key !== old?.key) {
        if (old) mark(old.b.x, old.b.z, old.b.w, old.b.d);
        mark(b.x, b.z, b.w, b.d);
      }
    }
    for (const [id, old] of this.buildingKeys) if (!next.has(id)) mark(old.b.x, old.b.z, old.b.w, old.b.d);
    this.buildingKeys = next; this.buildings = buildings.map(b => ({ ...b }));
    if (!dirty.size && !reset) return false;
    this.lastRebuilt = [...dirty];
    for (const key of dirty) {
      const [x, z] = key.split(',').map(Number);
      const result = buildPcgTile(source, this.buildings, x!, z!);
      if (!result.mesh || !result.mesh.indices.length) { this.remove(key); continue; }
      const m = result.mesh;
      const mesh = createMeshBuilder({ attributes: { position: m.position, normal: m.normal, uv: m.uv, color: m.color }, indices: m.indices }).build().unwrap();
      const old = this.entries.get(key);
      if (old) {
        this.assets.replace(old.handle, mesh).unwrap();
        old.features = result.features; old.surfaces = result.walkSurfaces; old.triangles = m.indices.length / 3;
      } else {
        const handle = this.assets.create(mesh).unwrap();
        const entity = this.world.spawn(
          { component: Name, data: { value: `街区细节 ${key}` } },
          { component: Transform, data: {} },
          { component: MeshFilter, data: { assetHandle: handle } },
          { component: MeshRenderer, data: { materials: [this.material] } },
          { component: ShadowParticipation, data: { cast: true, receive: true } },
        ).unwrap();
        this.entries.set(key, { entity, handle, features: result.features, surfaces: result.walkSurfaces, triangles: m.indices.length / 3 });
      }
    }
    this.revision++;
    return true;
  }
  private nearby(x: number, z: number) {
    const found: Entry[] = [], tx = Math.floor(x / PCG_TILE_SIZE), tz = Math.floor(z / PCG_TILE_SIZE);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const e = this.entries.get(`${tx + dx},${tz + dz}`); if (e) found.push(e);
    }
    return found;
  }
  /** Same step boxes used by meshing; maximum permits bounded auto-stepping, never teleporting up a cliff. */
  surfaceHeight(x: number, z: number, base: number, maximum = Infinity) {
    let top = base;
    for (const entry of this.nearby(x, z)) for (const s of entry.surfaces)
      if (x >= s.min[0] && x < s.max[0] && z >= s.min[2] && z < s.max[2] && s.top <= maximum + 1e-5) top = Math.max(top, s.top);
    return top;
  }
  /** A narrow curb can lie between point probes; support must cover the full character footprint. */
  supportHeight(minX: number, minZ: number, maxX: number, maxZ: number, base: number, maximum = Infinity) {
    let top = base;
    for (const entry of this.nearby((minX + maxX) / 2, (minZ + maxZ) / 2)) for (const s of entry.surfaces)
      if (minX < s.max[0] - 1e-5 && maxX > s.min[0] + 1e-5 && minZ < s.max[2] - 1e-5 && maxZ > s.min[2] + 1e-5
        && s.top <= maximum + 1e-5) top = Math.max(top, s.top);
    return top;
  }
  /** On a generated path, use the real tread rather than the coarse segment's interpolated height. */
  walkHeight(x: number, z: number, fallback: number) {
    let top: number | undefined;
    for (const entry of this.nearby(x, z)) for (const s of entry.surfaces)
      if (x >= s.min[0] && x < s.max[0] && z >= s.min[2] && z < s.max[2]) top = Math.max(top ?? -Infinity, s.top);
    return top ?? fallback;
  }
  blocks(min: Bounds, max: Bounds) {
    for (const entry of this.nearby((min[0] + max[0]) / 2, (min[2] + max[2]) / 2)) {
      for (const s of entry.surfaces) if (intersects(min, max, s.min, s.max)) return true;
      for (const f of entry.features) if (f.kind === 'sill' && intersects(min, max, f.min, f.max)) return true;
    }
    // Window glass stays impassable; completed colony walls use the same enclosing geometry.
    for (const b of this.buildings) if (b.complete && b.kind === 'wall' && intersects(min, max, [b.x, b.y, b.z], [b.x + (b.w ?? 1), b.y + 29 / 16, b.z + (b.d ?? 1)])) return true;
    return false;
  }
  read() {
    const features = [...new Map([...this.entries.values()].flatMap(e => e.features).map(f => [f.id, f])).values()];
    const count = (kind: PcgFeature['kind']) => features.filter(f => f.kind === kind).length;
    return { resolution: 16, version: 1, revision: this.revision, tiles: this.entries.size, pendingTiles: 0,
      windows: count('window'), sills: count('sill'), sidewalks: count('sidewalk'), stairs: count('stairs'),
      triangles: [...this.entries.values()].reduce((sum, e) => sum + e.triangles, 0),
      rebuiltTiles: this.lastRebuilt, features: features.slice(0, 256).map(f => ({ id: f.id, kind: f.kind, anchor: f.anchor, min: f.min, max: f.max })),
    };
  }
  dispose() { this.clear(); this.assets.release(this.material).unwrap(); }
}
