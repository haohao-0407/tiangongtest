import type { EntityHandle, World } from '@forgeax/engine/ecs';
import { Instances, MeshFilter, MeshRenderer, ShadowParticipation } from '@forgeax/engine/render';
import { Name, Transform } from '@forgeax/engine/scene';
import type { AssetHandle } from '@forgeax/engine/types';

/** One ECS entity and instance buffer per mesh. Empty batches remove their entity. */
export class InstancedModels<K extends string> {
  private entities = new Map<K, EntityHandle>();
  private counts: Record<string, number> = {};

  constructor(private world: World, private meshes: ReadonlyMap<K, AssetHandle<'mesh'>>,
    private name: string, private castShadow: boolean, private materials: AssetHandle<'material'>[] = []) {}

  update(kind: K, rows: number[]) {
    const entity = this.entities.get(kind);
    this.counts[kind] = rows.length / 16;
    if (!rows.length) {
      if (entity !== undefined) {
        this.world.despawn(entity).unwrap();
        this.entities.delete(kind);
      }
      return;
    }
    const transforms = new Float32Array(rows);
    if (entity !== undefined) this.world.set(entity, Instances, { transforms }).unwrap();
    else this.entities.set(kind, this.world.spawn(
      { component: Name, data: { value: `${this.name}/${kind}` } },
      { component: Transform, data: {} }, { component: Instances, data: { transforms } },
      { component: MeshFilter, data: { assetHandle: this.meshes.get(kind)! } },
      { component: MeshRenderer, data: { materials: this.materials } },
      { component: ShadowParticipation, data: { cast: this.castShadow, receive: true } },
    ).unwrap());
  }

  read() { return { ...this.counts }; }
  dispose() {
    for (const entity of this.entities.values()) this.world.despawn(entity).unwrap();
    this.entities.clear();
    this.counts = {};
  }
}

export function appendModelPose(rows: number[], x: number, y: number, z: number, yaw: number, scale: number) {
  const c = Math.cos(yaw) * scale, s = Math.sin(yaw) * scale;
  rows.push(c,0,-s,0, 0,scale,0,0, s,0,c,0, x,y,z,1);
}
