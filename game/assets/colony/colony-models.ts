import type { AssetRegistry } from '@forgeax/engine/assets-runtime';
import type { AssetHandle } from '@forgeax/engine/types';
import type { SceneAssets } from '../shared/scene-assets.ts';
import { buildingDimensions, isRoomDoor, isRoomStructure, WALL_THICKNESS } from './buildings.ts';
import { residentOutfit, type CharacterAssets } from './character-view.ts';
import type { BuildingKind, ColonySnapshot, MerchantId } from './contracts.ts';
import { townMerchants } from './merchant-interaction.ts';

export interface ColonyModelConfig {
  characterMaterial: string;
  characters: { scene: string; walks: string[] }[];
  buildings: Record<string, string>;
  plaza: Record<string, string>;
}

type BuildingModel = { mesh: AssetHandle<'mesh'>; scale: [number, number, number] };
const MERCHANT_OUTFITS: Record<MerchantId, number> = { guide: 1, chef: 2, tailor: 3, cheesemaker: 4, blacksmith: 5 };

export class ColonyModels {
  private readonly outfits = new Map<number, CharacterAssets>();
  private readonly buildings = new Map<string, BuildingModel>();

  constructor(private readonly assets: AssetRegistry, private readonly loads: SceneAssets,
    private readonly config: ColonyModelConfig) {}

  residentOutfit(id: string) { return residentOutfit(id, this.config.characters.length); }
  merchantOutfit(id: MerchantId) { return (MERCHANT_OUTFITS[id] - 1) % this.config.characters.length + 1; }

  private buildingGuid(kind: string) {
    return this.config.buildings[kind === 'workbench' || kind === 'carpenterBench' ? 'fabricator' : kind];
  }

  async prepareOpening(colony: ColonySnapshot): Promise<void> {
    const outfits = new Set([1, ...colony.colonists.map(p => this.residentOutfit(p.id)),
      ...townMerchants(colony).map(m => this.merchantOutfit(m.npcId))]);
    const guids = new Set(colony.buildings.map(b => this.buildingGuid(b.kind)));
    const palette = this.loads.preload(this.config.characterMaterial, 'material');
    await Promise.all([
      ...[...outfits].map(async outfit => {
        const model = this.config.characters[outfit - 1]!;
        const [material, scene, walks] = await Promise.all([palette, this.loads.preload(model.scene, 'scene'),
          Promise.all(model.walks.map(guid => this.loads.preload(guid, 'animation-clip')))]);
        this.outfits.set(outfit, { outfit, scene, walks, material });
      }),
      ...[...guids].flatMap(guid => guid ? [this.loads.preload(guid, 'mesh')] : []),
    ]);
  }

  character(outfit: number): CharacterAssets {
    const cached = this.outfits.get(outfit);
    if (cached) return cached;
    const model = this.config.characters[outfit - 1]!;
    const scene = this.loads.get(model.scene, 'scene');
    const walks = model.walks.map(guid => this.loads.get(guid, 'animation-clip'));
    // The opening guide remains available while another resident's outfit streams in.
    const guide = this.outfits.get(1)!;
    if (scene === undefined || !walks.every(handle => handle !== undefined)) return guide;
    const result = { outfit, scene, walks, material: guide.material };
    this.outfits.set(outfit, result);
    return result;
  }

  building(kind: string): BuildingModel | undefined {
    const cached = this.buildings.get(kind);
    if (cached) return cached;
    const guid = this.buildingGuid(kind);
    if (!guid) return;
    const mesh = this.loads.get(guid, 'mesh');
    if (mesh === undefined) return;
    const bounds = this.assets.read(mesh).unwrap().aabb!;
    const { w, h, d } = buildingDimensions(kind === 'doorOpen' ? 'door' : kind as BuildingKind);
    const width = bounds[3]! - bounds[0]!, depth = bounds[5]! - bounds[2]!;
    const horizontal = Math.min(1, w / width, d / depth);
    const vertical = h / (bounds[4]! - bounds[1]!);
    const scale: BuildingModel['scale'] = isRoomStructure(kind) && !isRoomDoor(kind)
      ? [1 / width, vertical, WALL_THICKNESS / depth] : [horizontal, Math.min(horizontal, vertical), horizontal];
    const model = { mesh, scale };
    this.buildings.set(kind, model);
    return model;
  }

  plaza(layer: string) { return this.loads.get(this.config.plaza[layer]!, 'mesh'); }
}
