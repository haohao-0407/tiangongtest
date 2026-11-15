/** Natural vegetation has one identity; branches and crown are model parts, never loose blocks. */
export interface TreeInstance {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly trunkHeight: number;
  readonly crownRadius: number;
  readonly variant: number;
  readonly rotation: 0 | 1 | 2 | 3;
}
export type TreeRole = 'trunk' | 'branch' | 'crown';
export type TreePoint = [number, number, number];
export interface TreePart { min: TreePoint; max: TreePoint; role: TreeRole; tone: number }
export interface TreeCell { x: number; y: number; z: number; role: TreeRole }

/** Shared voxel-style model recipe. All positions are world-space and use 1/16-unit steps. */
export function treeParts(tree: TreeInstance): TreePart[] {
  const result: TreePart[] = [], h = tree.trunkHeight;
  const part = (x0:number,y0:number,z0:number,x1:number,y1:number,z1:number,role:TreeRole,tone=0) => {
    const rotate = (x:number,z:number):[number,number] => tree.rotation===1?[-z,x]:tree.rotation===2?[-x,-z]:tree.rotation===3?[z,-x]:[x,z];
    const a=rotate(x0,z0),b=rotate(x1,z1);
    result.push({min:[tree.x+.5+Math.min(a[0],b[0]),tree.y+y0,tree.z+.5+Math.min(a[1],b[1])],
      max:[tree.x+.5+Math.max(a[0],b[0]),tree.y+y1,tree.z+.5+Math.max(a[1],b[1])],role,tone});
  };
  part(-.375,0,-.3125,.375,.375,.3125,'trunk',0);
  part(-.25,.375,-.25,.25,h+.25,.25,'trunk',1);
  part(-1.0625,h-1.125,-.125,.125,h-.875,.125,'branch',0);
  part(-.125,h-.6875,-.125,1.125,h-.4375,.125,'branch',1);
  part(-.125,h-.375,-.125,.125,h-.125,.9375,'branch',0);
  // Three disjoint rectangles make a clipped square; neighbouring bands overlap vertically only at their faces.
  const scale=tree.crownRadius/2;
  for(const [index,[bottom,top,radius,cut]] of [
    [h-1,h-.25,1.5,.5], [h-.25,h+.75,2.125,.625],
    [h+.75,h+1.5,1.75,.5], [h+1.5,h+2,1.125,.375],
  ].entries()){
    const r=radius!*scale,c=cut!*scale,tone=(index+tree.variant)%3;
    part(-r+c,bottom!,-r,r-c,top!,r,'crown',tone);
    part(-r,bottom!,-r+c,-r+c,top!,r-c,'crown',(tone+1)%3);
    part(r-c,bottom!,-r+c,r,top!,r-c,'crown',(tone+2)%3);
  }
  return result;
}

export function treeBounds(tree: TreeInstance): {min:TreePoint;max:TreePoint} {
  const parts=treeParts(tree);
  return {min:[0,1,2].map(i=>Math.min(...parts.map(p=>p.min[i]!))) as TreePoint,
    max:[0,1,2].map(i=>Math.max(...parts.map(p=>p.max[i]!))) as TreePoint};
}

/** Conservative grid occupancy for navigation/building checks; the renderer and picking use exact part boxes. */
export function treeCells(tree: TreeInstance): TreeCell[] {
  const cells=new Map<string,TreeCell>();
  for(const part of treeParts(tree))for(let y=Math.floor(part.min[1]);y<Math.ceil(part.max[1]-1e-8);y++)
    for(let z=Math.floor(part.min[2]);z<Math.ceil(part.max[2]-1e-8);z++)for(let x=Math.floor(part.min[0]);x<Math.ceil(part.max[0]-1e-8);x++){
      const key=`${x},${y},${z}`,existing=cells.get(key);
      if(!existing||existing.role==='crown'&&part.role!=='crown')cells.set(key,{x,y,z,role:part.role});
    }
  return [...cells.values()].sort((a,b)=>a.y-b.y||a.z-b.z||a.x-b.x);
}

/** Exact original generated vegetation footprint, used only to migrate v1/v2 voxel saves. */
export function legacyTreeCells(tree: TreeInstance): TreeCell[] {
  const cells=new Map<string,TreeCell>(),put=(x:number,y:number,z:number,role:TreeRole)=>cells.set(`${x},${y},${z}`,{x,y,z,role});
  for(let y=tree.y;y<tree.y+tree.trunkHeight;y++)put(tree.x,y,tree.z,'trunk');
  for(let dy=-1;dy<=2;dy++){
    const radius=dy===2?1:2,y=tree.y+tree.trunkHeight-1+dy;
    for(let dz=-radius;dz<=radius;dz++)for(let dx=-radius;dx<=radius;dx++)if(Math.abs(dx)+Math.abs(dz)<=radius+1&&!cells.has(`${tree.x+dx},${y},${tree.z+dz}`))put(tree.x+dx,y,tree.z+dz,'crown');
  }
  return [...cells.values()];
}
