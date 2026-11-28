import {BUILDING_DEFS,type BuildingKind,type BuildingRotation,type BuildingView} from './contracts.ts';

const roomWalls = new Set<string>(['wall', 'woodWall', 'brickWall', 'greenhouseWall']);
export const isSwingDoor = (kind: string) => kind === 'door' || kind === 'stoneDoor';
export const isRoomDoor = (kind: string) => isSwingDoor(kind) || kind === 'autoDoor';
export const isRoomStructure = (kind: string) => roomWalls.has(kind) || isRoomDoor(kind);
export const CARDINALS = [[1,0],[0,1],[-1,0],[0,-1]] as const;
export const WALL_THICKNESS=6/16;
type Structure = Pick<BuildingView,'kind'|'x'|'y'|'z'|'rotation'>;
type Lookup = (x:number,z:number)=>Structure|undefined;

function neighbours(b:Structure, at:Lookup, accepts:(n:Structure,side:number)=>boolean):number {
  let mask=0;
  for(const [side,[dx,dz]] of CARDINALS.entries()){
    const x=b.x+dx,z=b.z+dz,n=at(x,z);
    if(n && n.x===x && n.z===z && n.y===b.y && isRoomStructure(n.kind) && accepts(n,side)) mask|=1<<side;
  }
  return mask;
}

function doorRotation(b:Structure,at:Lookup):BuildingRotation {
  const mask=neighbours(b,at,()=>true);
  const horizontal=(mask&1)+((mask>>2)&1), vertical=((mask>>1)&1)+((mask>>3)&1);
  if(horizontal===vertical) return b.rotation;
  return ((b.rotation&2)+(vertical>horizontal ? 1 : 0)) as BuildingRotation;
}

// Canonical end faces +X, elbow joins +X/+Z, tee joins +X/+Z/-X.
const wallRotations: readonly BuildingRotation[]=[0,0,1,0,2,0,1,0,3,3,1,3,2,2,1,0];
export function structureConnection(b:Structure,at:Lookup) {
  const rotation=isRoomDoor(b.kind) ? doorRotation(b,at) : b.rotation;
  const mask=neighbours(b,at,(n,side)=>
    (!isRoomDoor(b.kind) || (rotation%2===side%2)) &&
    (!isRoomDoor(n.kind) || (doorRotation(n,at)%2===side%2)));
  return {connections:mask, rotation:roomWalls.has(b.kind) && mask ? wallRotations[mask]! : rotation};
}
export function connectionLabel(kind:string,mask:number):string {
  if(isRoomDoor(kind)) return '单轴门';
  if(!mask) return '独立墙段';
  if(mask===15) return '十字连接';
  if((mask & (mask-1))===0) return '端头';
  if(mask===5 || mask===10) return '直线';
  return [3,6,9,12].includes(mask) ? 'L 形转角' : 'T 形连接';
}

// Non-overlapping rectangles. Keep a continuous face along the primary axis and butt
// perpendicular branches against it, including the outer return on a corner.
export function wallSpans(mask:number,rotation:number,thickness:number) {
  if(!mask) mask=rotation%2 ? 10 : 5;
  const half=thickness/2, spans:{axis:'x'|'z';offset:number;length:number}[]=[];
  const mainX=mask===5 || (mask!==10 && (mask&5)!==0 && (mask&10)!==10);
  function span(axis:'x'|'z',lo:number,hi:number) { spans.push({axis,offset:(lo+hi)/2,length:hi-lo}); }
  const positive=mainX ? 1 : 2, negative=mainX ? 4 : 8, axis=mainX?'x':'z';
  span(axis,mask&negative ? -.5 : -half,mask&positive ? .5 : half);
  const cross=mainX?'z':'x';
  if(mask&(mainX?2:1)) span(cross,half,.5);
  if(mask&(mainX?8:4)) span(cross,-.5,-half);
  return spans;
}
export function buildingSealsRoom(b: Pick<BuildingView, 'kind' | 'complete' | 'doorOpen'>): boolean {
  return b.complete && (roomWalls.has(b.kind) || (isSwingDoor(b.kind) && !b.doorOpen) || b.kind === 'autoDoor');
}

export type BuildingPart={x:number;y:number;z:number;role:string};
export function buildingDimensions(kind:BuildingKind,rotation:number=0):{w:number;h:number;d:number}{
  const def=BUILDING_DEFS[kind],[w,d]=def.footprint??[1,1];
  return rotation%2?{w:d,h:def.height??1,d:w}:{w,h:def.height??1,d};
}
/** Quarter turns around the object, translated into its positive anchor-relative bounds. */
export function rotateBuildingCell(x:number,z:number,w:number,d:number,rotation:BuildingRotation):[number,number]{
  if(rotation===1)return[d-1-z,x];
  if(rotation===2)return[w-1-x,d-1-z];
  if(rotation===3)return[z,w-1-x];
  return[x,z];
}
/** Every cell resolves to the same persistent building id, never an independently editable half. */
export function buildingParts(b:Pick<BuildingView,'kind'|'x'|'y'|'z'|'rotation'> & Partial<Pick<BuildingView,'w'|'h'|'d'>>):BuildingPart[]{
  const dimensions=buildingDimensions(b.kind);
  const w=(b.rotation%2 ? b.d : b.w)??dimensions.w, d=(b.rotation%2 ? b.w : b.d)??dimensions.d;
  const h=b.h??dimensions.h,result:BuildingPart[]=[];
  for(let y=0;y<h;y++)for(let z=0;z<d;z++)for(let x=0;x<w;x++){
    const [rx,rz]=rotateBuildingCell(x,z,w,d,b.rotation);
    const role=isSwingDoor(b.kind)?(y===0?'door-lower':'door-upper'):b.kind==='bed'||b.kind==='medicalBed'?(z===0?'bed-head':'bed-foot'):'body';
    result.push({x:b.x+rx,y:b.y+y,z:b.z+rz,role});
  }
  return result;
}
export function buildingBlocksMovement(b:Pick<BuildingView,'kind'|'complete'|'doorOpen'|'previousBoundary'>):boolean{
  if (b.previousBoundary) return BUILDING_DEFS[b.previousBoundary.kind].blocking;
  return b.complete&&(isSwingDoor(b.kind)?!b.doorOpen:BUILDING_DEFS[b.kind].blocking);
}
