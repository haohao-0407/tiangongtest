import { raycastTree } from './tree-interaction.ts';
import type { ZoneCell } from '../colony/zone-cells.ts';
import type { VoxelWorld } from './model.ts';

type Point = [number, number, number];
export type ScreenPoint = [number, number];
export type ZoneGesture = { start: ScreenPoint; end: ScreenPoint; dragged: boolean };
export type ZoneSelection = {
  cells: ZoneCell[]; invalid: ZoneCell[]; faces: { corners: ScreenPoint[]; blocked: boolean; pasture?:'gate'|'fence' }[];
};

export function mapProjection(eye: Point, target: Point, aspect: number, tanHalfFov: number) {
  const unit = (x:number,y:number,z:number):Point => {
    const length=Math.hypot(x,y,z);
    return [x/length,y/length,z/length];
  };
  const f=unit(target[0]-eye[0],target[1]-eye[1],target[2]-eye[2]);
  const r=unit(-f[2],0,f[0]);
  const u:Point=[-r[2]*f[1],r[2]*f[0]-r[0]*f[2],r[0]*f[1]];
  const direction=(sx:number,sy:number):Point=>{
    const dx=(2*sx-1)*aspect*tanHalfFov, dy=(1-2*sy)*tanHalfFov;
    return [f[0]+dx*r[0]+dy*u[0], f[1]+dy*u[1], f[2]+dx*r[2]+dy*u[2]];
  };
  const project=(x:number,y:number,z:number):ScreenPoint=>{
    x-=eye[0]; y-=eye[1]; z-=eye[2];
    const h=2*tanHalfFov*(x*f[0]+y*f[1]+z*f[2]);
    if(h<=0) return [Infinity,Infinity];
    return [.5+(x*r[0]+z*r[2])/(h*aspect), .5-(x*u[0]+y*u[1]+z*u[2])/h];
  };
  return { direction, project };
}


export function isMarqueeTool(tool:string) {
  return tool==='zone:farm' || tool==='zone:stockpile' || tool==='zone:pasture' || tool==='chop';
}

/** The overhead camera shows +X to the right and +Z down. Height never shifts a tile. */
export function zoneFace(x:number,z:number,target:Point,halfHeight:number,aspect:number,blocked:boolean):ZoneSelection['faces'][number] {
  const project=(cx:number,cz:number):ScreenPoint=>[.5+(cx-target[0])/(2*halfHeight*aspect),.5+(cz-target[2])/(2*halfHeight)];
  return {blocked,corners:[project(x+.04,z+.04),project(x+.96,z+.04),project(x+.96,z+.96),project(x+.04,z+.96)]};
}

export function selectZone(world:VoxelWorld, target:Point, halfHeight:number, aspect:number,
  gesture:ZoneGesture, blocker:(x:number,z:number)=>string|null, treesOnly=false):ZoneSelection {
  const width=2*halfHeight*aspect, depth=2*halfHeight;
  const ground=([u,v]:ScreenPoint):ScreenPoint=>[target[0]+(u-.5)*width,target[2]+(v-.5)*depth];
  const result:ZoneSelection={cells:[],invalid:[],faces:[]};
  const add=(x:number,z:number)=>{
    const blocked=!treesOnly && !!blocker(x,z);
    result.cells.push([x,z]);
    if(blocked) result.invalid.push([x,z]);
    result.faces.push(zoneFace(x,z,target,halfHeight,aspect,blocked));
  };
  const [bx,bz]=ground(gesture.end);
  if(!gesture.dragged){
    const x=Math.floor(bx), z=Math.floor(bz);
    if(!world.inBounds(x,0,z)) return result;
    if(treesOnly){
      const hit=raycastTree(world.treesInColumn(x,z),[bx,world.height+1,bz],[0,-1,0]);
      if(hit) add(hit.tree.x,hit.tree.z);
    }else add(x,z);
    return result;
  }
  const [ax,az]=ground(gesture.start);
  const x0=Math.max(0,Math.ceil(Math.min(ax,bx)-.5)), x1=Math.min(world.width-1,Math.floor(Math.max(ax,bx)-.5));
  const z0=Math.max(0,Math.ceil(Math.min(az,bz)-.5)), z1=Math.min(world.depth-1,Math.floor(Math.max(az,bz)-.5));
  for(let z=z0;z<=z1;z++) for(let x=x0;x<=x1;x++){
    if(!treesOnly || world.treeAtColumn(x,z)) add(x,z);
  }
  return result;
}
