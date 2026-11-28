import type { BuildingView, CropView, Position } from './contracts.ts';
import { buildingParts } from './buildings.ts';
import type { VoxelWorld } from '../voxel/model.ts';
import { rayBox } from '../voxel/tree-interaction.ts';

/** Picking uses the same cells as placement and collision, including a door's upper half. */
export function raycastBuilding(buildings: readonly BuildingView[], origin: Position, direction: Position, limit = Infinity) {
  let nearest: { building: BuildingView; part: ReturnType<typeof buildingParts>[number]; distance: number } | null = null;
  for (const building of buildings) {
    // Hanging hardware and the tall lamp can be selected above their saved ground cell.
    if (building.complete && (building.kind==='chandelier' || building.kind==='floorLamp')) {
      const {x,y,z}=building, hanging=building.kind==='chandelier';
      const inset=hanging ? .35 : 0;
      const distance=rayBox(origin,direction,[x+inset,y+(hanging?1.3:1),z+inset],
        [x+1-inset,y+(hanging?2:4),z+1-inset],nearest?.distance??limit);
      if(distance!==null && (!nearest || distance<nearest.distance))
        nearest={building,part:{x,y,z,role:'body'},distance};
    }
    if (building.kind==='campfirePlaza') {
      // The reserved air above the paths must not intercept clicks on villagers.
      const {x,y,z,w,d}=building;
      const lo:Position=[x,y,z], hi:Position=[x+w,y+.11,z+d];
      const distance=rayBox(origin,direction,lo,hi,nearest?.distance??limit);
      if (distance!==null && (!nearest || distance<nearest.distance)) {
        const cell=(axis:number,start:number,size:number)=>Math.max(start,Math.min(start+size-1,Math.floor(origin[axis]!+direction[axis]!*distance)));
        nearest={building,part:{x:cell(0,x,w),y,z:cell(2,z,d),role:'plaza'},distance};
      }
      continue;
    }
    for (const part of buildingParts(building)) {
      const {x,y,z}=part;
      const distance=rayBox(origin,direction,[x,y,z],[x+1,y+1,z+1],nearest?.distance??limit);
      if (distance!==null && (!nearest || distance<nearest.distance)) nearest={building,part,distance};
    }
  }
  return nearest;
}

/** The picking volume covers the planted tile and the visible stem above it. */
export function raycastCrop(crops: readonly CropView[], origin: Position, direction: Position, limit: number): CropView | null {
  let nearest: CropView | null = null;
  let nearestDistance = limit;
  for (const crop of crops) {
    if (!crop.planted) continue;
    const { x, y, z, growth } = crop;
    const height = growth < .4 ? .35 : growth < .75 ? .8 : 1.25;
    const distance = rayBox(origin, direction, [x + .02, y, z + .02], [x + .98, y + height, z + .98], nearestDistance);
    if (distance !== null && distance < nearestDistance) {
      nearest = crop;
      nearestDistance = distance;
    }
  }
  return nearest;
}

/** Terrain tools must not sever an object's cells or its supporting foundation. */
export function buildingProtectingVoxel(buildings: readonly BuildingView[], x: number, y: number, z: number) {
  return buildings.find(b => x >= b.x && x < b.x + b.w && z >= b.z && z < b.z + b.d && y >= b.y - 1 && y < b.y + b.h);
}

/** Loading a settlement may put furniture on the original player spawn. */
export function findPlayerSpawn(world: VoxelWorld, blocked: (x:number,y:number,z:number)=>boolean): Position | null {
  const cx=Math.floor(world.width/2),cz=Math.floor(world.depth/2);
  for(let radius=0;radius<Math.max(world.width,world.depth);radius++)
    for(let dz=-radius;dz<=radius;dz++)for(let dx=-radius;dx<=radius;dx++){
      if(Math.max(Math.abs(dx),Math.abs(dz))!==radius)continue;
      const x=cx+dx,z=cz+dz;
      if(x<0||z<0||x>=world.width||z>=world.depth)continue;
      const y=world.terrainHeight(x,z);
      if(y<1||y+2>world.height)continue;
      if([y,y+1].every(yy=>world.get(x,yy,z)===0&&!blocked(x,yy,z)))return[x+.5,y,z+.5];
    }
  return null;
}
