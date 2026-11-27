import { expect, it } from 'vitest';
import { BLOCK, VoxelWorld } from '../model.ts';
import { isMarqueeTool, selectZone, type ScreenPoint } from '../zone-selection.ts';

it('selects the same grid rectangle on all elevations in every drag direction', () => {
  const world=new VoxelWorld('俯视框选',{width:32,height:24,depth:32});
  world.set(16,18,16,BLOCK.Stone);
  const target:[number,number,number]=[16,5,16];
  const select=(start:ScreenPoint,end:ScreenPoint,dragged=true)=> selectZone(world,target,8,2,
    {start,end,dragged},(x,z)=>x===16 && z===16?'occupied':null);
  const expected=Array.from({length:4},(_,row)=>Array.from({length:8},(_,col)=>[12+col,14+row])).flat();
  for(const [a,b] of [[.375,.625],[.625,.375]]) for(const [u,v] of [[.375,.625],[.625,.375]]){
    const result=select([a!,u!],[b!,v!]);
    expect(result.cells).toEqual(expected);
    expect(result.invalid).toEqual([[16,16]]);
    expect(result.faces.filter(f=>f.blocked)).toHaveLength(1);
  }
  expect(select([0,0],[.5,.5],false).cells).toEqual([[16,16]]);
  expect(select([0,0],[1,1],false).cells).toEqual([]);
  expect(select([-.5,-1],[.07,.05]).cells.every(([x,z])=>world.inBounds(x,0,z))).toBe(true);
  expect(['zone:pasture','zone:stockpile','zone:farm','chop','mine','clear'].map(isMarqueeTool)).toEqual([true,true,true,true,false,false]);
});
