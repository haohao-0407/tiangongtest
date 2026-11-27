import { createMeshBuilder } from '@forgeax/engine/geometry';

/** Ground-centred, looking along +Z like the other livestock. */
export function pigMesh() {
  const position:number[]=[], normal:number[]=[], color:number[]=[], indices:number[]=[];
  const pink=[.83,.37,.32], rose=[.59,.19,.17], dark=[.06,.035,.027];
  function box(x:number,y:number,z:number,w:number,h:number,d:number,rgb:number[]) {
    const center=[x,y,z], dimensions=[w,h,d];
    for(let axis=0;axis<3;axis++)for(const sign of [-1,1]) {
      const u=(axis+1)%3,v=(axis+2)%3,start=position.length/3;
      for(const [i,j] of [[-1,-1],[1,-1],[1,1],[-1,1]]) {
        const p=[...center];p[axis]+=sign*dimensions[axis]!/2;
        p[u]+=i!*dimensions[u]!/2;p[v]+=j!*dimensions[v]!/2;
        position.push(...p);normal.push(axis===0?sign:0,axis===1?sign:0,axis===2?sign:0);color.push(...rgb,1);
      }
      for(const index of sign>0?[0,1,2,0,2,3]:[0,2,1,0,3,2])indices.push(start+index);
    }
  }
  box(0,.5,-.08,.65,.5,.87,pink);box(0,.62,.39,.5,.45,.4,pink);
  box(0,.55,.64,.31,.17,.12,rose);
  for(const sign of [-1,1]) {
    box(sign*.19,.88,.34,.13,.15,.12,rose);box(sign*.18,.68,.596,.065,.07,.023,dark);
    box(sign*.08,.56,.705,.04,.042,.019,dark);
    for(const z of [-.38,.19])box(sign*.19,.15,z,.16,.3,.16,rose);
  }
  box(0,.66,-.55,.1,.14,.13,rose);
  return createMeshBuilder({attributes:{position:new Float32Array(position),normal:new Float32Array(normal),color:new Float32Array(color)},indices:new Uint32Array(indices)}).build().unwrap();
}
