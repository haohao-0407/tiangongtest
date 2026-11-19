import { definePack, definePackageId } from '@forgeax/engine/pack/source';
import { ok } from '@forgeax/engine/types';
import { voxelGame } from './voxel/runtime.ts';
import { assetGuid, guidText, PACKAGE_IDS } from './shared/asset-refs.ts';
import villagers from './models/villagers.glb.meta.json';
import buildings from './models/buildings.glb.meta.json';
import flora from './models/wild-plants.glb.meta.json';
import { WALK_CLIPS } from './colony/character-view.ts';
export const game = voxelGame;
export default definePack({
  schemaVersion:'2.0.0', plugins:true,
  packageId:definePackageId('019fb7ce-3800-7000-8000-000000000000'),
  build:()=>ok({'plugin/engine':{kind:'plugin',module:{specifier:'./game.pack.ts',export:'game'},
    config:{
      environment:{$asset:guidText(assetGuid(PACKAGE_IDS.environment,'environment/daylight'))},
      wildPlants:Object.fromEntries(flora.subAssets.filter(asset => asset.kind === 'mesh')
        .map(asset => [asset.name, { $asset:asset.guid }])),
      buildings:Object.fromEntries(buildings.subAssets.filter(asset => asset.kind === 'mesh')
        .map(asset => [asset.name, { $asset:asset.guid }])),
      scene:{$asset:villagers.subAssets.find(asset => asset.kind === 'scene')!.guid},
      outfits:villagers.subAssets.filter(asset => asset.kind === 'mesh')
        .sort((a,b) => a.sourceIndex - b.sourceIndex).map(asset => ({ $asset:asset.guid })),
      walks:WALK_CLIPS.map(name => ({ $asset:villagers.subAssets.find(asset =>
        asset.kind === 'animation-clip' && asset.name === name)!.guid })),
    },
  }}),
});
