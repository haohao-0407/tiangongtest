import { describe, expect, it } from 'vitest';
import { BLOCK, VoxelWorld } from '../../voxel/model.ts';
import { buildingDimensions } from '../buildings.ts';
import type { BuildingKind, BuildingView } from '../contracts.ts';
import { housingTerms, quoteGuideTrade } from '../guide-housing.ts';
import { ColonySimulation } from '../simulation.ts';

function fixture() {
  const world=VoxelWorld.deserialize(JSON.stringify({version:1,generatorVersion:2,seed:'guide-house',size:[32,24,32],edits:[]}));
  const edits=[];
  for(let z=0;z<32;z++)for(let x=0;x<32;x++)for(let y=1;y<24;y++)
    edits.push({x,y,z,block:y<5?BLOCK.Dirt:BLOCK.Air});
  world.edit(edits);
  const sim=new ColonySimulation(world);
  const save=sim.serialize() as Record<string,any>;
  Object.assign(save,{buildings:[],items:[],jobs:[],warehouseStacks:[],zones:[],crops:[],terrainPlans:[]});
  save.colonists.forEach((c:any,i:number)=>{c.position=[22.5+i,5,22.5];});
  return {sim,save};
}
function building(kind:BuildingKind,x:number,z:number):BuildingView {
  return {id:kind+'-'+x+'-'+z,kind,x,y:5,z,rotation:0,...buildingDimensions(kind),
    complete:true,phase:'completed',progress:1,powered:false,comfort:0,roomId:null,reserved:{},
    ...(kind==='door'?{doorOpen:false}:{})};
}
function house(x:number,z:number,w=3,d=2) {
  const rows=[];
  for(let i=0;i<w+2;i++)for(let j=0;j<d+2;j++){
    if(i===0 || j===0 || i===w+1 || j===d+1)rows.push(building(i===2 && j===d+1?'door':'wall',x+i,z+j));
  }
  return [...rows,building('bed',x+1,z+1),building('table',x+w,z+1)];
}

describe('向导住房',()=>{
  it('拒绝面积、家具、围合或入口不合格的房间，六格合格即可入住',()=>{
    const {sim,save}=fixture();
    const good=house(8,8);
    const door=good.find(b=>b.kind==='door')!;
    for(const rows of [house(8,8,2,2),good.filter(b=>b.kind!=='bed'),good.filter(b=>b.kind!=='table'),
      good.filter(b=>b!==door),good.map(b=>b===door?building('wall',b.x,b.z):b),
      good.map(b=>b.kind==='table'?{...b,complete:false,phase:'constructing'}:b),
      [...good,building('wall',door.x,door.z+1),building('wall',door.x-1,door.z+1),building('wall',door.x+1,door.z+1)]]){
      save.buildings=rows;sim.load(save);
      expect(sim.snapshot().specialistMarket.availableRooms).toEqual([]);
      expect(sim.command({action:'assign-merchant-room',id:'bed-9-9'}).ok).toBe(false);
      expect(sim.guideHousing).toMatchObject({npcId:'guide',status:'camp',bedId:null,buyFactor:1,recycleFactor:1});
    }
    delete save.guideBedId;save.buildings=good;sim.load(save);
    expect(sim.guideHousing.status).toBe('camp');
    expect(sim.command({action:'assign-merchant-room',id:'bed-9-9'}).ok).toBe(true);
    expect(sim.guideHousing).toMatchObject({npcId:'guide',status:'housed',roomId:0,bedId:'bed-9-9',comfort:49,cleanliness:100,quality:74.5});
  });
  it('跨开门、读档和房间编号变化保留原床，移走桌子后改住另一间，拆墙后回营',()=>{
    const {sim,save}=fixture();
    save.buildings=house(12,12);save.guideBedId='bed-13-13';delete save.specialistMarket;sim.load(save);
    const original=sim.guideHousing;
    expect(sim.command({action:'toggleDoor',id:'door-14-15'}).ok).toBe(true);
    const opened=sim.guideHousing;
    expect(opened).toEqual({...original,roomId:null});
    sim.load(sim.serialize());expect(sim.snapshot().guideHousing).toEqual(opened);
    const altered=sim.serialize() as typeof save;
    altered.buildings.unshift(...house(4,4));sim.load(altered);
    expect(sim.guideHousing.bedId).toBe(original.bedId);
    expect(sim.command({action:'toggleDoor',id:'door-14-15'}).ok).toBe(true);
    expect(sim.guideHousing).toEqual({...original,roomId:1});
    altered.buildings=altered.buildings.filter((b:BuildingView)=>b.id!=='table-15-13');
    sim.load(altered);
    expect(sim.guideHousing.status).toBe('camp');
    expect(sim.command({action:'assign-merchant-room',id:'bed-5-5'}).ok).toBe(true);
    altered.guideBedId='bed-5-5';
    altered.buildings=altered.buildings.filter((b:BuildingView)=>b.id!=='wall-4-5');
    sim.load(altered);
    expect(sim.guideHousing.status).toBe('camp');
  });
  it('房内杂物及地板改变环境，两种报价反向变化',()=>{
    const {sim,save}=fixture();
    save.buildings=house(8,8);save.guideBedId='bed-9-9';sim.load(save);
    save.items=[{id:'clutter',resource:'stone',amount:1,x:10,y:5,z:10,age:11,reservedBy:null}];
    sim.load(save);const dirty=sim.guideHousing;
    save.items=[];save.buildings.push(building('floor',10,10));sim.load(save);
    const clean=sim.guideHousing;
    expect(dirty.cleanliness).toBe(90);expect(clean.cleanliness).toBe(100);
    expect(clean.comfort).toBeGreaterThan(dirty.comfort);
    expect(clean.buyFactor).toBeLessThan(dirty.buyFactor);
    expect(clean.recycleFactor).toBeGreaterThan(dirty.recycleFactor);
  });
});

describe('向导报价',()=>{
  const basis={baseBuy:96,baseRecycle:60,count:3,premiumCount:1};
  it('先合计普通件和有效冷藏件再调价、整单取整',()=>{
    const camp=housingTerms(0,0),best=housingTerms(100,100);
    expect(quoteGuideTrade({...basis,side:'recycle',housing:camp})).toEqual({total:192,normalCount:2,premiumCount:1,factor:1});
    expect(quoteGuideTrade({...basis,side:'recycle',housing:best}).total).toBe(211);
    expect(quoteGuideTrade({...basis,side:'buy',housing:best})).toEqual({total:260,normalCount:3,premiumCount:0,factor:.9});
    expect(quoteGuideTrade({...basis,side:'recycle',baseBuy:null,premiumCount:0,housing:best}).total).toBe(198);
    expect(()=>quoteGuideTrade({...basis,side:'buy',baseBuy:null,housing:camp})).toThrow();
    expect(()=>quoteGuideTrade({...basis,side:'buy',count:0,housing:camp})).toThrow();
  });
  it('跨环境、配置价差不足与拆单回收仍不会赚取差价',()=>{
    for(const quality of [0,35,74.5,100])for(const count of [1,2,7,30]){
      const housing=housingTerms(quality,quality);
      const input={baseBuy:11,baseRecycle:12,count,premiumCount:count,housing};
      const buy=quoteGuideTrade({...input,side:'buy',housing:housingTerms(100,100)});
      const recycle=quoteGuideTrade({...input,side:'recycle'});
      expect(recycle.total).toBeLessThanOrEqual(buy.total);
      const one=quoteGuideTrade({...input,count:1,side:'recycle'});
      expect(one.total*count).toBeLessThanOrEqual(buy.total);
    }
  });
});
