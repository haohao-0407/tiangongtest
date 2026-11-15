import type { BuildingView, Position } from './contracts.ts';
import { buildingParts } from './buildings.ts';
import type { VoxelWorld } from '../voxel/model.ts';

/** Picking uses the same cells as placement and collision, including a door's upper half. */
export function raycastBuilding(buildings: readonly BuildingView[], origin: Position, direction: Position, limit = Infinity) {
  let nearest: { building: BuildingView; part: ReturnType<typeof buildingParts>[number]; distance: number } | null = null;
  for (const building of buildings) for (const part of buildingParts(building)) {
    const min = [part.x, part.y, part.z], max = [part.x + 1, part.y + 1, part.z + 1];
    let near = 0, far = limit;
    for (let axis = 0; axis < 3; axis++) {
      const o = origin[axis]!, d = direction[axis]!;
      if (Math.abs(d) < 1e-8) { if (o < min[axis]! || o > max[axis]!) { far = -1; break; } }
      else {
        const a = (min[axis]! - o) / d, b = (max[axis]! - o) / d;
        near = Math.max(near, Math.min(a, b)); far = Math.min(far, Math.max(a, b));
      }
    }
    if (near <= far && (!nearest || near < nearest.distance)) nearest = { building, part, distance: near };
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
