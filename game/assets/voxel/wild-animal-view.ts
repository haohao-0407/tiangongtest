import type { World } from '@forgeax/engine/ecs';
import type { AssetHandle } from '@forgeax/engine/types';
import { appendModelPose, InstancedModels } from './instanced-models.ts';
import type { VoxelWorld } from './model.ts';
import { visibleWildAnimals, WILD_ANIMAL_KINDS, wildAnimalPose, type WildAnimal, type WildAnimalKind } from './wild-animals.ts';
import type { PlantLandUse } from './wild-plants.ts';

export class WildAnimalView {
  private batches: InstancedModels<WildAnimalKind>;
  private groups = new Map<WildAnimalKind, number[]>(WILD_ANIMAL_KINDS.map(kind => [kind, []]));
  private visible: WildAnimal[] = [];
  private source?: VoxelWorld;
  private revision = -1;
  private footprint = '';
  private lastTime = -1;

  constructor(world: World, models: ReadonlyMap<WildAnimalKind, AssetHandle<'mesh'>>, material: AssetHandle<'material'>) {
    this.batches = new InstancedModels(world, models, '野外动物', true, [material]);
  }

  updateHabitat(source: VoxelWorld, land: PlantLandUse, footprint: string) {
    if (source === this.source && source.revision === this.revision && footprint === this.footprint) return;
    this.visible = visibleWildAnimals(source, land);
    this.source = source; this.revision = source.revision; this.footprint = footprint;
    this.lastTime = -1;
  }

  animate(time: number) {
    if (time === this.lastTime) return;
    for (const rows of this.groups.values()) rows.length = 0;
    for (const animal of this.visible) {
      const {x, y, z, yaw} = wildAnimalPose(animal, time);
      appendModelPose(this.groups.get(animal.kind)!, x, y, z, yaw, animal.scale);
    }
    for (const [kind, rows] of this.groups) this.batches.update(kind, rows);
    this.lastTime = time;
  }

  read() { return this.batches.read(); }
  dispose() { this.batches.dispose(); }
}
