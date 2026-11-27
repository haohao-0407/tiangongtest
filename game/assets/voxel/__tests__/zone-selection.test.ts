import { expect, it } from 'vitest';
import { BLOCK, VoxelWorld } from '../model.ts';
import { selectZone, type ScreenPoint } from '../zone-selection.ts';

it('selects identical visible centers in all four drag directions on terraced ground', () => {
  const world=new VoxelWorld('斜视框选',{width:32,height:24,depth:32});
  for(let x=0;x<32;x++) for(let z=0;z<32;z++) {
    const height=x>=14 && x<18 ? 12 : 5;
    for(let y=1;y<24;y++) world.set(x,y,z,y<height?BLOCK.Stone:BLOCK.Air);
  }
  const eye:[number,number,number]=[30,15,34], target:[number,number,number]=[16,4,16];
  const options=[world,eye,target,1.6,Math.tan(Math.PI/8)] as const;
  const rectangle=(a:ScreenPoint,b:ScreenPoint)=>selectZone(...options,{start:a,end:b,dragged:true},()=>null);
  const selected=rectangle([.36,.32],[.62,.66]).cells;
  expect(selected.length).toBeGreaterThan(4);
  for(const [ax,bx] of [[.36,.62],[.62,.36]]) for(const [ay,by] of [[.32,.66],[.66,.32]])
    expect(rectangle([ax,ay],[bx,by]).cells).toEqual(selected);
  const visible=new Set(selected.map(cell=>cell.join(',')));
  const forward=target.map((v,i)=>v-eye[i]);
  const length=Math.hypot(...forward);
  const [fx,fy,fz]=forward.map(v=>v/length);
  const h=Math.hypot(fx,fz), rx=-fz/h,rz=fx/h;
  for(let z=0;z<32;z++) for(let x=0;x<32;x++){
    const dx=x+.5-eye[0], dy=world.surfaceHeight(x,z)+1-eye[1], dz=z+.5-eye[2];
    const spread=2*options[4]*(dx*fx+dy*fy+dz*fz);
    const sx=.5+(rx*dx+rz*dz)/(options[3]*spread),sy=.5-(-rz*fy*dx+h*dy+rx*fy*dz)/spread;
    const hit=world.raycast(eye,[dx,dy,dz],1200);
    expect(visible.has([x,z].join(','))).toBe(spread>0 && sx>=.36 && sx<=.62 && sy>=.32 && sy<=.66 &&
      hit?.cell[0]===x && hit.cell[2]===z);
  }
});
