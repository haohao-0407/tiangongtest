import { definePack, definePackageId } from '@forgeax/engine/pack/source';
import { ok } from '@forgeax/engine/types';
import { voxelGame } from './voxel/runtime.ts';
import { assetGuid, guidText, PACKAGE_IDS } from './shared/asset-refs.ts';
import villager01 from './models/villagers.glb.meta.json';
import villager02 from './models/villagers/villager-02.glb.meta.json';
import villager03 from './models/villagers/villager-03.glb.meta.json';
import villager04 from './models/villagers/villager-04.glb.meta.json';
import villager05 from './models/villagers/villager-05.glb.meta.json';
import villager06 from './models/villagers/villager-06.glb.meta.json';
import villager07 from './models/villagers/villager-07.glb.meta.json';
import villager08 from './models/villagers/villager-08.glb.meta.json';
import villager09 from './models/villagers/villager-09.glb.meta.json';
import villager10 from './models/villagers/villager-10.glb.meta.json';
import villager11 from './models/villagers/villager-11.glb.meta.json';
import villager12 from './models/villagers/villager-12.glb.meta.json';
import villager13 from './models/villagers/villager-13.glb.meta.json';
import villager14 from './models/villagers/villager-14.glb.meta.json';
import villager15 from './models/villagers/villager-15.glb.meta.json';
import villager16 from './models/villagers/villager-16.glb.meta.json';
import villager17 from './models/villagers/villager-17.glb.meta.json';
import buildings from './models/buildings.glb.meta.json';
import homestead from './models/homestead.glb.meta.json';
import guide from './models/guide-merchant.glb.meta.json';
import plaza from './models/campfire-plaza.glb.meta.json';
import flora from './models/wild-plants.glb.meta.json';
import wildlife from './models/wild-animals.glb.meta.json';
import { WALK_CLIPS } from './colony/character-view.ts';

const villagers = [
  villager01, villager02, villager03, villager04, villager05, villager06, villager07, villager08, villager09,
  villager10, villager11, villager12, villager13, villager14, villager15, villager16, villager17,
];

function characterConfig(model:{subAssets: {kind:string; name?:string; guid:string}[]}) {
  return {
    scene:{$asset:model.subAssets.find(asset => asset.kind==='scene')!.guid},
    walks:WALK_CLIPS.map(name => ({$asset:model.subAssets.find(asset =>
      asset.kind==='animation-clip' && asset.name===name)!.guid})),
  };
}

export const game = voxelGame;
export default definePack({
  schemaVersion:'2.0.0', plugins:true,
  packageId:definePackageId('019fb7ce-3800-7000-8000-000000000000'),
  build:()=>ok({'plugin/engine':{kind:'plugin',module:{specifier:'./game.pack.ts',export:'game'},
    config:{
      environment:{$asset:guidText(assetGuid(PACKAGE_IDS.environment,'environment/daylight'))},
      evening:{$asset:guidText(assetGuid(PACKAGE_IDS.environment,'environment/evening'))},
      plaza:Object.fromEntries(plaza.subAssets.filter(asset=>asset.kind==='mesh').map(asset=>[asset.name,{$asset:asset.guid}])),
      wildPlants:Object.fromEntries(flora.subAssets.filter(asset => asset.kind === 'mesh')
        .map(asset => [asset.name, { $asset:asset.guid }])),
      homestead:Object.fromEntries(homestead.subAssets.filter(asset=>asset.kind==='mesh' && asset.name!=='pig')
        .map(asset=>[asset.name,{$asset:asset.guid}])),
      wildAnimals:Object.fromEntries([...wildlife.subAssets, ...homestead.subAssets.filter(asset=>asset.name==='pig')].filter(asset => asset.kind === 'mesh')
        .map(asset => [asset.name, { $asset:asset.guid }])),
      buildings:Object.fromEntries(buildings.subAssets.filter(asset => asset.kind === 'mesh')
        .map(asset => [asset.name, { $asset:asset.guid }])),
      characterMaterial:{$asset:villager01.subAssets.find(asset => asset.kind === 'material')!.guid},
      characters:villagers.map(characterConfig),
      guide:characterConfig(guide),
    },
  }}),
});
