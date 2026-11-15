import {describe,expect,it} from 'vitest';
import {raycastBuilding,buildingProtectingVoxel,findPlayerSpawn} from '../interaction.ts';
import type {BuildingView} from '../contracts.ts';
import {buildingDimensions} from '../buildings.ts';
import {BLOCK,VoxelWorld} from '../../voxel/model.ts';

const object=(kind:BuildingView['kind'],rotation:BuildingView['rotation']=0):BuildingView=>({id:kind,kind,x:20,y:6,z:20,...buildingDimensions(kind,rotation),rotation,doorOpen:false,phase:'completed',complete:true,progress:1,reserved:{},powered:false,comfort:0,roomId:null});
describe('whole-object interaction',()=>{
  it('picks either vertical door half before terrain and obeys foreground occlusion',()=>{
    const door=object('door');
    expect(raycastBuilding([door],[20.5,7.5,25],[0,0,-1])?.part.role).toBe('door-upper');
    expect(raycastBuilding([door],[20.5,6.5,25],[0,0,-1])?.part.role).toBe('door-lower');
    expect(raycastBuilding([door],[20.5,7.5,25],[0,0,-1],3)).toBeNull();
  });
  it('picks the rotated foot as the same bed and preserves its foundation',()=>{
    const bed=object('bed',1);
    expect(raycastBuilding([bed],[20.5,10,20.5],[0,-1,0])?.part.role).toBe('bed-foot');
    expect(raycastBuilding([bed],[21.5,10,20.5],[0,-1,0])?.building.id).toBe(bed.id);
    expect(buildingProtectingVoxel([bed],21,5,20)?.id).toBe(bed.id);
    expect(buildingProtectingVoxel([bed],22,5,20)).toBeUndefined();
  });
  it('rejects an entire history operation without losing its undo/redo transaction',()=>{
    const world=VoxelWorld.deserialize(JSON.stringify({version:1,generatorVersion:1,seed:'interaction-test',size:[48,24,48],edits:[]}));
    world.edit([{x:20,y:15,z:20,block:BLOCK.Planks},{x:21,y:15,z:20,block:BLOCK.Planks}]);
    expect(world.undo(()=>false)).toBe(false);expect(world.undoCount).toBe(1);expect(world.redoCount).toBe(0);
    expect(world.get(21,15,20)).toBe(BLOCK.Planks);expect(world.undo()).toBe(true);
    expect(world.redo(()=>false)).toBe(false);expect(world.redoCount).toBe(1);expect(world.redo()).toBe(true);
    expect(world.get(20,15,20)).toBe(BLOCK.Planks);
  });
  it('loads the player beside an occupied original spawn instead of inside a bed or closed door',()=>{
    const world=VoxelWorld.deserialize(JSON.stringify({version:1,generatorVersion:1,seed:'spawn-test',size:[48,24,48],edits:[]}));
    const spawn=findPlayerSpawn(world,(x,_y,z)=>x===24&&z===24);
    expect(spawn).not.toBeNull();expect(Math.floor(spawn![0])===24&&Math.floor(spawn![2])===24).toBe(false);
    expect(world.get(Math.floor(spawn![0]),spawn![1],Math.floor(spawn![2]))).toBe(BLOCK.Air);
  });
});
