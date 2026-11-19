import type { World, EntityHandle } from '@forgeax/engine/ecs';
import { Instances, MeshFilter, MeshRenderer, ShadowParticipation } from '@forgeax/engine/render';
import { Name, Transform } from '@forgeax/engine/scene';
import type { AssetHandle } from '@forgeax/engine/types';
import type { VoxelWorld } from './model.ts';
import { WILD_PLANT_KINDS, visibleWildPlants, type PlantLandUse, type WildPlantKind } from './wild-plants.ts';

export class WildPlantView {
  private entities = new Map<WildPlantKind, EntityHandle>();
  private source?: VoxelWorld;
  private revision = -1;
  private footprint = '';
  private counts: Record<string, number> = {};

  constructor(private world: World, private models: ReadonlyMap<WildPlantKind, AssetHandle<'mesh'>>) {}

  update(source: VoxelWorld, land: PlantLandUse) {
    const footprint = [...land.buildings, ...land.zones].map(b => [b.x,b.z,b.w,b.d].join(',')).join(';') +
      '|' + land.crops.map(c => c.x + c.z * source.width).join(',');
    if (source === this.source && source.revision === this.revision && footprint === this.footprint) return;
    const groups = new Map<WildPlantKind, number[]>(WILD_PLANT_KINDS.map(kind => [kind, []]));
    for (const p of visibleWildPlants(source, land)) {
      const angle = p.turn * Math.PI / 2, c = Math.cos(angle) * p.scale, s = Math.sin(angle) * p.scale;
      groups.get(p.kind)!.push(c,0,-s,0, 0,p.scale,0,0, s,0,c,0, p.x+.5,p.y,p.z+.5,1);
    }
    for (const [kind, rows] of groups) {
      const entity = this.entities.get(kind);
      this.counts[kind] = rows.length / 16;
      if (!rows.length) {
        if (entity !== undefined) { this.world.despawn(entity).unwrap(); this.entities.delete(kind); }
        continue;
      }
      const transforms = new Float32Array(rows);
      if (entity !== undefined) this.world.set(entity, Instances, { transforms }).unwrap();
      else this.entities.set(kind, this.world.spawn(
        { component: Name, data: { value: `野生植被/${kind}` } },
        { component: Transform, data: {} }, { component: Instances, data: { transforms } },
        { component: MeshFilter, data: { assetHandle: this.models.get(kind)! } },
        { component: MeshRenderer, data: { materials: [] } },
        { component: ShadowParticipation, data: { cast: false, receive: true } },
      ).unwrap());
    }
    this.source = source; this.revision = source.revision; this.footprint = footprint;
  }

  read() { return { ...this.counts }; }
  dispose() {
    for (const entity of this.entities.values()) this.world.despawn(entity).unwrap();
    this.entities.clear();
  }
}
