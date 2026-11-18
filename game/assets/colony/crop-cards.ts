import type { AssetRegistry } from '@forgeax/engine/assets-runtime';
import type { EntityHandle, World } from '@forgeax/engine/ecs';
import { MeshFilter, MeshRenderer, ShadowParticipation } from '@forgeax/engine/render';
import { Name, Transform } from '@forgeax/engine/scene';
import type { AssetHandle } from '@forgeax/engine/types';
import type { CropView } from './contracts.ts';

type RenderCrop = Pick<CropView, 'x' | 'y' | 'z' | 'growth'> & Partial<Pick<CropView, 'id' | 'planted'>>;

// 三个网格保留 Blender 里的相对比例，统一缩小到田格大小。
const CROP_SCALE = 0.25;
const CABBAGE_MESHES = [
  '01a1ef5e-43fb-73a6-96e2-89c38a4f10a6', // 幼芽
  '01a1ef5e-5b6d-74c1-b200-4248d75d2d41', // 生长
  '01a1ef5e-72c5-7f18-ab02-d7a047d3c329', // 成熟，内叶 / 中叶 / 外叶
] as const;

interface Entry {
  readonly entity: EntityHandle;
  mesh: AssetHandle<'mesh'>;
  x: number;
  y: number;
  z: number;
}

export class CropCards {
  private readonly meshes: AssetHandle<'mesh'>[] = [];
  private readonly entries = new Map<string, Entry>();

  private constructor(private readonly world: World, private readonly assets: AssetRegistry) {}

  static async create(world: World, assets: AssetRegistry): Promise<CropCards | undefined> {
    const cards = new CropCards(world, assets);
    try {
      for (const guid of CABBAGE_MESHES) {
        const mesh = (await assets.load(guid, 'mesh')).unwrap();
        cards.meshes.push(mesh);
        for (const { defaultMaterial } of assets.read(mesh).unwrap().materialSlots ?? []) {
          if (typeof defaultMaterial !== 'number') continue;
          // ForgeAX 0.5.0 的 glTF MASK 材质在裁剪后仍保留采样的 Alpha。
          // 输出不透明的已通过像素，避免合成时漏出画布底色。裁剪和阴影仍读取贴图 Alpha。
          assets.update(defaultMaterial, { values: { alphaMode: 1 } }).unwrap();
        }
      }
      return cards;
    } catch (error) {
      cards.dispose();
      console.warn('无法加载白菜模型，使用方块作物显示。', error);
      return undefined;
    }
  }

  update(crops: readonly RenderCrop[]): void {
    const seen = new Set<string>();
    for (const crop of crops) {
      if (crop.planted === false) continue;
      const { x, y, z, growth } = crop;
      const id = crop.id ?? `${x},${z}`;
      seen.add(id);
      const mesh = this.meshes[growth < 0.4 ? 0 : growth < 0.75 ? 1 : 2]!;
      const pos: [number, number, number] = [x + 0.5, y, z + 0.5];
      const entry = this.entries.get(id);
      if (entry) {
        if (entry.mesh !== mesh) {
          this.world.set(entry.entity, MeshFilter, { assetHandle: mesh }).unwrap();
          entry.mesh = mesh;
        }
        if (entry.x !== x || entry.y !== y || entry.z !== z) {
          this.world.set(entry.entity, Transform, { pos }).unwrap();
          Object.assign(entry, { x, y, z });
        }
        continue;
      }
      const entity = this.world.spawn(
        { component: Name, data: { value: `crop-${id}` } },
        { component: Transform, data: { pos, scale: [CROP_SCALE, CROP_SCALE, CROP_SCALE] } },
        { component: MeshFilter, data: { assetHandle: mesh } },
        { component: MeshRenderer, data: { materials: [] } },
        { component: ShadowParticipation, data: { cast: true, receive: true } },
      ).unwrap();
      this.entries.set(id, { entity, mesh, x, y, z });
    }
    for (const [id, entry] of this.entries) {
      if (seen.has(id)) continue;
      this.world.despawn(entry.entity).unwrap();
      this.entries.delete(id);
    }
  }

  dispose(): void {
    for (const entry of this.entries.values()) this.world.despawn(entry.entity).unwrap();
    this.entries.clear();
    for (const mesh of this.meshes) this.assets.release(mesh).unwrap();
    this.meshes.length = 0;
  }
}
