import { AnimationPlayer, AnimationTargetId, bindAnimationTargets } from '@forgeax/engine/animation';
import type { AssetRegistry } from '@forgeax/engine/assets-runtime';
import { ENTITY_NULL_RAW, type EntityHandle, type World } from '@forgeax/engine/ecs';
import { MeshFilter, MeshRenderer, SceneInstance } from '@forgeax/engine/render';
import { Transform } from '@forgeax/engine/scene';
import { Skin } from '@forgeax/engine/skinning';
import type { AssetHandle } from '@forgeax/engine/types';

type Point = [number, number, number];
// The authored character faces +Z, so +X is its left.
export const WALK_CLIPS = ['Walk_Forward', 'Walk_Left', 'Walk_Backward', 'Walk_Right'] as const;
export interface CharacterAssets {
  outfit: number;
  scene: AssetHandle<'scene'>;
  walks: AssetHandle<'animation-clip'>[];
  material: AssetHandle<'material'>;
}

export function residentOutfit(id: string, count: number): number {
  const serial = Number(id.split('-').pop());
  return Number.isSafeInteger(serial) && serial >= 0 ? (serial + 1) % count + 1 : 1;
}

/** One scene instance owns the assembled mesh, the skeleton and its playback clock. */
export class CharacterView {
  readonly root: EntityHandle;
  readonly attachmentScale: number;
  readonly meshCount: number;
  private readonly jointCount: number;
  private readonly restPose;
  private walk = -1;
  facing = 0;
  position: Point | undefined;
  lastStep = -Infinity;

  constructor(private world: World, assets: AssetRegistry, readonly model: CharacterAssets) {
    this.root = assets.instantiate(model.scene, world).unwrap();
    try {
      const targets: EntityHandle[] = [];
      const meshes: EntityHandle[] = [];
      for (const raw of world.get(this.root, SceneInstance).unwrap().mapping) {
        if (raw === ENTITY_NULL_RAW) continue;
        const entity = raw as EntityHandle;
        const skin = world.get(entity, Skin);
        if (skin.ok) meshes.push(entity);
        if (world.get(entity, AnimationTargetId).ok) targets.push(entity);
      }
      if (meshes.length !== 1) throw new Error('人物场景需要一个绑定骨架的网格');
      this.meshCount = meshes.length;
      const body = meshes[0]!;
      this.jointCount = world.get(body, Skin).unwrap().joints.length;
      const mesh = world.get(body, MeshFilter).unwrap().assetHandle as AssetHandle<'mesh'>;
      const bounds = assets.read(mesh).unwrap().aabb!;
      this.attachmentScale = (bounds[4]! - bounds[1]!) / 1.77;
      const renderer = { materials: [model.material] };
      if (world.get(body, MeshRenderer).ok) world.set(body, MeshRenderer, renderer).unwrap();
      else world.addComponent(body, { component: MeshRenderer, data: renderer }).unwrap();
      this.restPose = targets.map(entity => {
        const { pos, quat, scale } = world.get(entity, Transform).unwrap();
        return { entity, transform: { pos: [...pos], quat: [...quat], scale: [...scale] } };
      });
      world.addComponent(this.root, { component: AnimationPlayer, data: {} }).unwrap();
      bindAnimationTargets(world, this.root, targets).unwrap();
    } catch (error) {
      this.dispose();
      throw error;
    }
  }

  update(pos: Point, facing: number, walk: number) {
    if (!this.position || pos.some((value, i) => value !== this.position![i]) || this.facing !== facing) {
      this.world.set(this.root, Transform, { pos, quat: [0, Math.sin(facing / 2), 0, Math.cos(facing / 2)] }).unwrap();
      this.position = [...pos];
      this.facing = facing;
    }
    if (this.walk === walk) return;
    this.walk = walk;
    if (walk < 0) {
      this.world.set(this.root, AnimationPlayer, { clips: [], times: [], weights: [], speeds: [] }).unwrap();
      for (const { entity, transform } of this.restPose) this.world.set(entity, Transform, transform).unwrap();
    } else {
      this.world.set(this.root, AnimationPlayer, { clips: [this.model.walks[walk]!],
        times: [0], weights: [1], speeds: [1] }).unwrap();
    }
  }

  updateResident(pos: Point, time: number, initialFacing: number) {
    let facing = this.position ? this.facing : initialFacing;
    if (this.position) {
      const dx = pos[0] - this.position[0], dz = pos[2] - this.position[2];
      if (Math.hypot(dx, dz) > 0.003) {
        facing = Math.atan2(dx, dz);
        this.lastStep = time;
      }
    }
    // Simulation positions change once per 0.25 s tick, between render updates.
    this.update(pos, facing, time - this.lastStep < 0.28 ? 0 : -1);
  }

  updatePlayer(pos: Point, facing: number, moving: boolean) {
    let walk = -1;
    if (moving && this.position) {
      const dx = pos[0] - this.position[0], dz = pos[2] - this.position[2];
      if (Math.hypot(dx, dz) > 1e-5) {
        walk = (Math.round((Math.atan2(dx, dz) - facing) / (Math.PI / 2)) % 4 + 4) % 4;
      }
    }
    this.update(pos, facing, walk);
  }

  read() {
    const animation = this.world.get(this.root, AnimationPlayer).unwrap();
    return {outfit:this.model.outfit, meshes:this.meshCount, joints:this.jointCount,
      walk:WALK_CLIPS[this.walk] ?? null, time:animation.times[0] ?? 0};
  }

  dispose() { this.world.despawn(this.root).unwrap(); }
}
