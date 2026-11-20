import type { World } from '@forgeax/engine/ecs';
import type { AssetHandle } from '@forgeax/engine/types';
import { InstancedModels, appendModelPose } from './instanced-models.ts';
import type { VoxelWorld } from './model.ts';
import { WILD_PLANT_KINDS, visibleWildPlants, type PlantLandUse, type WildPlantKind } from './wild-plants.ts';

export class WildPlantView {
  private batches: InstancedModels<WildPlantKind>;
  private source?: VoxelWorld;
  private revision = -1;
  private footprint = '';

  constructor(world: World, models: ReadonlyMap<WildPlantKind, AssetHandle<'mesh'>>) {
    this.batches = new InstancedModels(world, models, '野生植被', false);
  }

  update(source: VoxelWorld, land: PlantLandUse, footprint: string) {
    if (source === this.source && source.revision === this.revision && footprint === this.footprint) return;
    const groups = new Map<WildPlantKind, number[]>(WILD_PLANT_KINDS.map(kind => [kind, []]));
    for (const p of visibleWildPlants(source, land)) {
      appendModelPose(groups.get(p.kind)!, p.x+.5, p.y, p.z+.5, p.turn*Math.PI/2, p.scale);
    }
    for (const [kind, rows] of groups) this.batches.update(kind, rows);
    this.source = source; this.revision = source.revision; this.footprint = footprint;
  }

  read() { return this.batches.read(); }
  dispose() { this.batches.dispose(); }
}
