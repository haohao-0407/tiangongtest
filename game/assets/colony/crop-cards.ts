import type { AssetRegistry } from '@forgeax/engine/assets-runtime';
import type { EntityHandle, World } from '@forgeax/engine/ecs';
import { MeshFilter, MeshRenderer, ShadowParticipation } from '@forgeax/engine/render';
import { Name, Transform } from '@forgeax/engine/scene';
import type { AssetHandle } from '@forgeax/engine/types';
import type { CropKind, CropType, CropView } from './contracts.ts';

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
};

const PRODUCE_MESHES: Record<CropType, string> = {
  blueberry: '01a1efdb-b959-71b1-8ad3-626e46b86571',
  cabbage: '01a1efdb-b95a-728a-a024-f379aab2575d',
  corn: '01a1efdb-b95a-728a-a024-f37ab37d2a39',
  leek: '01a1efdb-b95a-728a-a024-f37bb4b5d99b',
  potato: '01a1efdb-b95a-728a-a024-f37c1b678212',
  sugarcane: '01a1efdb-b95a-728a-a024-f37d509080e4',
  tomato: '01a1efdb-b95a-728a-a024-f37ef58dcc91',
  wheat: '01a1efdb-b95a-728a-a024-f37ffe23b2c3',
};

interface Entry {
  readonly entity: EntityHandle;
  mesh: AssetHandle<'mesh'>;
  x: number;
  y: number;
  z: number;
}

export class CropCards {
  private readonly meshes = new Map<CropKind, AssetHandle<'mesh'>[]>();
  private readonly itemMeshes = new Map<string, AssetHandle<'mesh'>>();
  private readonly entries = new Map<string, Entry>();

  private constructor(private readonly world: World, private readonly assets: AssetRegistry) {}

  static async create(world: World, assets: AssetRegistry): Promise<CropCards> {
    const cards = new CropCards(world, assets);
    await Promise.all([
      ...(Object.keys(CROP_MESHES) as CropKind[]).map(kind => cards.load(kind)),
      ...Object.entries(PRODUCE_MESHES).map(([kind, guid]) => cards.loadItem(kind, guid)),
    ]);
    return cards;
  }

  private async load(kind: CropKind): Promise<void> {
    const loaded: AssetHandle<'mesh'>[] = [];
    try {
      for (const guid of CROP_MESHES[kind]) loaded.push(await this.loadCutoutMesh(guid));
      this.meshes.set(kind, loaded);
    } catch (error) {
      for (const mesh of loaded) this.assets.release(mesh).unwrap();
      console.warn(`作物模型 ${kind} 加载失败，使用方块显示。`, error);
    }
  }

  private async loadItem(kind: string, guid: string): Promise<void> {
    try {
      this.itemMeshes.set(kind, await this.loadCutoutMesh(guid));
    } catch (error) {
      console.warn(`作物物品图 ${kind} 加载失败。`, error);
    }
  }

  private async loadCutoutMesh(guid: string): Promise<AssetHandle<'mesh'>> {
    const mesh = (await this.assets.load(guid, 'mesh')).unwrap();
    try {
      for (const { defaultMaterial } of this.assets.read(mesh).unwrap().materialSlots ?? []) {
        if (typeof defaultMaterial !== 'number') continue;
        // ForgeAX 0.5.0 的 glTF MASK 在裁剪后需要输出不透明像素，避免亮边。
        // 裁剪和阴影仍读取贴图 Alpha。
        this.assets.update(defaultMaterial, { values: { alphaMode: 1 } }).unwrap();
      }
      return mesh;
    } catch (error) {
      this.assets.release(mesh).unwrap();
      throw error;
    }
  }

  itemMesh(resource: string): AssetHandle<'mesh'> | undefined {
    return this.itemMeshes.get(resource);
  }

  hasModel(kind?: CropKind): boolean {
    return kind !== undefined && this.meshes.has(kind);
  }

  update(crops: readonly RenderCrop[]): void {
    const seen = new Set<string>();
    for (const crop of crops) {
      if (crop.planted === false || !crop.kind) continue;
      const stages = this.meshes.get(crop.kind);
      if (!stages) continue;
      const { x, y, z, growth } = crop;
      const id = crop.id ?? `${x},${z}`;
      seen.add(id);
      const mesh = stages[growth < 0.4 ? 0 : growth < 0.75 ? 1 : 2]!;
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
    for (const stages of this.meshes.values()) {
      for (const mesh of stages) this.assets.release(mesh).unwrap();
    }
    this.meshes.clear();
    for (const mesh of this.itemMeshes.values()) this.assets.release(mesh).unwrap();
    this.itemMeshes.clear();
  }
}
