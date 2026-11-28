import {describe,expect,it} from 'vitest';
import type {BuildingKind,BuildingRotation} from '../contracts.ts';
import {CARDINALS,isRoomDoor,structureConnection,WALL_THICKNESS,wallSpans} from '../buildings.ts';

describe('ordinary wall and door connections',()=>{
  it('resolves every neighbour mask for all seven structures and all four player rotations',()=>{
    const kinds:BuildingKind[]=['wall','brickWall','woodWall','greenhouseWall','door','stoneDoor','autoDoor'];
    for(const kind of kinds) for(const rotation of [0,1,2,3] as const) for(let mask=0;mask<16;mask++){
      const center={kind,x:3,y:5,z:3,rotation};
      const others=CARDINALS.flatMap(([dx,dz],i)=>mask&(1<<i) ? [{...center,kind:'woodWall' as const,x:3+dx,z:3+dz}] : []);
      const placed=[center,...others];
      for(const cells of [placed,[...placed].reverse()]){
        const at=(x:number,z:number)=>cells.find(b=>b.x===x && b.z===z);
        const result=structureConnection(center,at);
        if(isRoomDoor(kind)){
          const xCount=others.filter(b=>b.z===3).length,zCount=others.length-xCount;
          const axis=xCount===zCount ? rotation%2 : Number(zCount>xCount);
          expect(result.rotation).toBe((rotation&2)+axis);
          expect(result.connections).toBe(mask&(axis?10:5));
        }else{
          expect(result.connections).toBe(mask);
          if(!mask) expect(result.rotation).toBe(rotation);
          const spans=wallSpans(mask,result.rotation,WALL_THICKNESS);
          for(const [side,[dx,dz]] of CARDINALS.entries()){
            const reaches=spans.some(s=>s.axis===(dx?'x':'z') && Math.abs(s.offset+(dx+dz)*s.length/2-(dx+dz)*.5)<1e-6);
            expect(reaches).toBe(Boolean((mask||((rotation%2)?10:5))&(1<<side)));
          }
        }
      }
    }
  });
  it('joins every pair of wall materials at the same face in both axes',()=>{
    const walls:BuildingKind[]=['wall','woodWall','brickWall','greenhouseWall'];
    for(const kind of walls) for(const otherKind of walls) for(const [side,[dx,dz]] of CARDINALS.entries()){
      const a={kind,x:5,y:6,z:5,rotation:0 as const};
      const b={...a,kind:otherKind,x:a.x+dx,z:a.z+dz};
      const at=(x:number,z:number)=>[a,b].find(w=>w.x===x && w.z===z);
      for(const [wall,expected] of [[a,side],[b,(side+2)%4]] as const){
        const c=structureConnection(wall,at);
        expect(c.connections).toBe(1<<expected);
        const [span]=wallSpans(c.connections,c.rotation,WALL_THICKNESS);
        expect(span!.length).toBe(.5+3/16);
        expect(span!.axis).toBe(dx?'x':'z');
      }
    }
  });
  it('excludes the side of a door, other heights, diagonals, fences and pasture gates',()=>{
    const b={kind:'woodWall' as BuildingKind,x:0,y:5,z:0,rotation:0 as BuildingRotation};
    const cells=[b,{...b,kind:'door' as const,x:1,rotation:1 as const},{...b,x:1,z:1},{...b,x:1,z:-1},
      {...b,x:-1,y:6},{...b,kind:'pastureGate' as const,z:1},{...b,kind:'fence' as const,z:-1}];
    const at=(x:number,z:number)=>cells.find(c=>c.x===x && c.z===z);
    expect(structureConnection(b,at).connections).toBe(0);
    expect(structureConnection(cells[1]!,at)).toEqual({rotation:1,connections:10});
  });
});
