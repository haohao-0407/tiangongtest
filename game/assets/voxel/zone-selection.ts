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

/** Coordinates are fractions of the game viewport. A drag includes visible tile centers. */
export function selectZone(world: VoxelWorld, eye: Point, target: Point, aspect: number, tanHalfFov: number,
  gesture: ZoneGesture, blocker: (x:number,z:number) => string | null): ZoneSelection {
  const {direction, project} = mapProjection(eye, target, aspect, tanHalfFov);
  const result:ZoneSelection={cells:[],invalid:[],faces:[]};
  const add=(x:number,y:number,z:number)=>{
    const blocked=!!blocker(x,z);
    result.cells.push([x,z]);
    if(blocked) result.invalid.push([x,z]);
    result.faces.push({blocked,corners:[project(x+.04,y,z+.04),project(x+.96,y,z+.04),
      project(x+.96,y,z+.96),project(x+.04,y,z+.96)]});
  };
  const [ax,ay]=gesture.start, [bx,by]=gesture.end;
  if(!gesture.dragged){
    const hit=world.raycast(eye,direction(bx,by),1200);
    if(hit) add(hit.cell[0],world.surfaceHeight(hit.cell[0],hit.cell[2])+1,hit.cell[2]);
    return result;
  }
  const left=Math.min(ax,bx), right=Math.max(ax,bx), top=Math.min(ay,by), bottom=Math.max(ay,by);
  // Clip the selection frustum to the world's vertical extent before testing columns.
  const boundsX:number[]=[], boundsZ:number[]=[];
  for(const sx of [left,right]) for(const sy of [top,bottom]){
    const d=direction(sx,sy);
    for(const y of [0,world.height]){
      const t=Math.abs(d[1])<1e-8 ? 1200 : Math.max(0,Math.min(1200,(y-eye[1])/d[1]));
      boundsX.push(eye[0]+t*d[0]); boundsZ.push(eye[2]+t*d[2]);
    }
    if(d[1]>=0 && eye[1]<world.height){
      boundsX.push(eye[0]+1200*d[0]); boundsZ.push(eye[2]+1200*d[2]);
    }
  }
  // A rectangle crossing the horizon may reach the far map edge.
  const horizon = direction(left,top)[1]>=0 && direction(left,bottom)[1]<0;
  const minX=horizon?0:Math.max(0,Math.floor(Math.min(...boundsX)));
  const maxX=horizon?world.width-1:Math.min(world.width-1,Math.ceil(Math.max(...boundsX)));
  const minZ=horizon?0:Math.max(0,Math.floor(Math.min(...boundsZ)));
  const maxZ=horizon?world.depth-1:Math.min(world.depth-1,Math.ceil(Math.max(...boundsZ)));
  for(let z=minZ;z<=maxZ;z++) for(let x=minX;x<=maxX;x++){
    const y=world.surfaceHeight(x,z)+1;
    if(y<=0) continue;
    const [sx,sy]=project(x+.5,y,z+.5);
    if(sx<left || sx>right || sy<top || sy>bottom) continue;
    const hit=world.raycast(eye,[x+.5-eye[0],y-eye[1],z+.5-eye[2]],1200);
    if(hit?.cell[0]===x && hit.cell[2]===z) add(x,y,z);
  }
  return result;
}
