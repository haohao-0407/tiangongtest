import {BUILDING_DEFS,type BuildingKind,type BuildingRotation,type BuildingView} from './contracts.ts';

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
    const role=b.kind==='door'?(y===0?'door-lower':'door-upper'):b.kind==='bed'||b.kind==='medicalBed'?(z===0?'bed-head':'bed-foot'):'body';
    result.push({x:b.x+rx,y:b.y+y,z:b.z+rz,role});
  }
  return result;
}
export function buildingBlocksMovement(b:Pick<BuildingView,'kind'|'complete'|'doorOpen'>):boolean{
  return b.complete&&(b.kind==='door'?!b.doorOpen:BUILDING_DEFS[b.kind].blocking);
}
