import type { AssetRegistry } from '@forgeax/engine/assets-runtime';
import type { EntityHandle, World } from '@forgeax/engine/ecs';
import { MeshFilter, MeshRenderer, ShadowParticipation } from '@forgeax/engine/render';
import { Name, Transform } from '@forgeax/engine/scene';
import type { AssetHandle } from '@forgeax/engine/types';
import type { SceneAssets } from '../shared/scene-assets.ts';
import type { CropKind, CropView } from './contracts.ts';
import { ITEM_CARD_MESHES } from './item-cards.ts';

type RenderCrop = Pick<CropView, 'x' | 'y' | 'z' | 'growth'> & Partial<Pick<CropView, 'id' | 'kind' | 'planted'>>;
export const FARM_SOIL_HEIGHT = 0.05;
const ROOT_EMBED_DEPTH = 0.018;

// 网格已按一格田地定好尺寸，顺序是幼芽、生长、成熟。
const CROP_MESHES: Record<CropKind, readonly [string, string, string]> = {
  cabbage: [
    '01a1ef5e-43fb-73a6-96e2-89c38a4f10a6',
    '01a1ef5e-5b6d-74c1-b200-4248d75d2d41',
    '01a1ef5e-72c5-7f18-ab02-d7a047d3c329',
  ],
  tomato: [
    '01a1efcb-9b4f-7df1-a36e-6564deb21faa',
    '01a1efcb-9b50-7041-bcd4-66c03a5b3ab3',
    '01a1efcb-9b50-7041-bcd4-66c17092bef9',
  ],
  sugarcane: [
    '01a1efcb-b062-700a-90cc-a9a8d3edff82',
    '01a1efcb-b062-700a-90cc-a9a991778e7f',
    '01a1efcb-b062-700a-90cc-a9aa1d397ccc',
  ],
  wheat: [
    '01a1efcb-c3cb-7911-ac1f-909234baf751',
    '01a1efcb-c3cc-7103-908e-0467e1370a3e',
    '01a1efcb-c3cc-7103-908e-04681ed8904e',
  ],
  potato: [
    '01a1efcb-d782-75ad-b80e-859df6b36747',
    '01a1efcb-d782-75ad-b80e-859e8bc59880',
    '01a1efcb-d782-75ad-b80e-859ff1b31f14',
  ],
  leek: [
    '01a1efcb-e930-7b8d-9078-aa228f81bd5d',
    '01a1efcb-e930-7b8d-9078-aa23966d85d9',
    '01a1efcb-e930-7b8d-9078-aa24cf1a9f58',
  ],
  corn: [
    '01a1efcb-fe4f-79f8-9615-e9cb82e0c2b2',
    '01a1efcb-fe50-713a-9a12-f86698743d1e',
    '01a1efcb-fe50-713a-9a12-f8676b152b61',
  ],
  blueberry: [
    '01a1fa01-bdbb-75fc-b80e-b1bd9f6f9c55',
    '01a1fa01-bdbb-75fc-b80e-b1befb66d361',
    '01a1fa01-bdbc-727b-8060-5142e5c4a166',
  ],
};

interface Entry {
  readonly entity: EntityHandle;
  mesh: AssetHandle<'mesh'>;
  x: number;
  y: number;
  z: number;
}

export class CropCards {
  private readonly models = new Map<string, { mesh:AssetHandle<'mesh'>; bottom:number } | null>();
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly world: World, private readonly assets: AssetRegistry, private readonly loads: SceneAssets) {}

  private cropModel(crop: Pick<RenderCrop,'kind'|'growth'>) {
    if (!crop.kind) return;
    const stage = crop.growth < 0.4 ? 0 : crop.growth < 0.75 ? 1 : 2;
    return this.cutout(CROP_MESHES[crop.kind][stage]);
  }

  private cutout(guid: string) {
    const cached = this.models.get(guid);
    if (cached !== undefined) return cached ?? undefined;
    const mesh = this.loads.get(guid, 'mesh');
    if (mesh === undefined) return;
    try {
      const geometry = this.assets.read(mesh).unwrap();
      for (const { defaultMaterial } of geometry.materialSlots ?? []) {
        if (typeof defaultMaterial !== 'number') continue;
        // 裁剪后输出不透明像素，保留贴图轮廓和阴影，避免 FXAA 亮边。
        this.assets.update(defaultMaterial, { values: { alphaMode: 1 } }).unwrap();
      }
      const model = { mesh, bottom: geometry.aabb?.[1] ?? -.5 };
      this.models.set(guid, model);
      return model;
    } catch (error) {
      this.models.set(guid, null);
      console.warn(`贴片模型 ${guid} 无法显示，使用方块。`, error);
    }
  }

  itemMesh(resource: string): AssetHandle<'mesh'> | undefined {
    return this.itemModel(resource)?.mesh;
  }

  itemModel(resource:string) {
    if (!Object.hasOwn(ITEM_CARD_MESHES, resource)) return;
    return this.cutout(ITEM_CARD_MESHES[resource as keyof typeof ITEM_CARD_MESHES]);
  }

  hasModel(crop: Pick<RenderCrop,'kind'|'growth'>): boolean {
    return this.cropModel(crop) !== undefined;
  }

  update(crops: readonly RenderCrop[]): void {
    const seen = new Set<string>();
    for (const crop of crops) {
      if (crop.planted === false || !crop.kind) continue;
      const model = this.cropModel(crop);
      if (!model) continue;
      const { x, y, z } = crop;
      const id = crop.id ?? `${x},${z}`;
      seen.add(id);
      const { mesh } = model;
      const pos: [number, number, number] = [x + 0.5, y + FARM_SOIL_HEIGHT - ROOT_EMBED_DEPTH, z + 0.5];
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
        { component: Transform, data: { pos } },
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
    this.models.clear();
  }
}
