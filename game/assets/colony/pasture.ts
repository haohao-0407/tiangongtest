import { footprintCells, type Footprint, type ZoneCell } from './zone-cells.ts';

export const STOCK_VOLUME = {cow:4, pig:3, sheep:2, chicken:1} as const;
export type StockKind = keyof typeof STOCK_VOLUME;
export const STOCK_NAMES: Record<StockKind,string> = {cow:'牛', pig:'猪', sheep:'羊', chicken:'鸡'};
export interface HerdAnimal {
  id:string; kind:StockKind; young:boolean; female:boolean; state:'ordered'|'leading'|'home';
  x:number; z:number; homeX:number; homeZ:number; readyAt:number;
}
export interface Pasture {
  capacity?:number; ready?:boolean; gate:ZoneCell; pendingGate?:ZoneCell; animals:HerdAnimal[];
}

const HARVEST = {
  cow: { station:'milker', output:'milk', yield:1, work:5, recoveryDays:1, label:'在挤奶器挤奶' },
  chicken: { station:'henNest', output:'egg', yield:1, work:1, recoveryDays:.5, label:'到鸡窝捡蛋' },
  sheep: { station:'shearingStand', output:'wool', yield:2, work:5, recoveryDays:1, label:'在剪毛台剪羊毛' },
} as const;

export function pastureHarvest(animal:HerdAnimal, time:number) {
  if(animal.state!=='home' || animal.young || animal.readyAt>time || animal.kind==='pig') return;
  if(animal.kind!=='sheep' && !animal.female) return;
  return HARVEST[animal.kind];
}
export const stockVolume=(a:Pick<HerdAnimal,'kind'|'young'>)=>STOCK_VOLUME[a.kind]*(a.young ? .5 : 1);
const shifts:ZoneCell[]=[[1,0],[-1,0],[0,1],[0,-1]];
const cellKey=([x,z]:ZoneCell)=>x+','+z;

function computeLayout(area:Footprint) {
  const cells=[...footprintCells(area)];
  const selected=new Set(cells.map(cellKey));
  const inside=(x:number,z:number)=>selected.has(x+','+z);
  const border:ZoneCell[]=[], interior:ZoneCell[]=[];
  for(const [x,z] of cells) {
    (shifts.some(([dx,dz])=>!inside(x+dx,z+dz)) ? border : interior).push([x,z]);
  }
  const inner=new Set(interior.map(cellKey));
  const gates=border.flatMap(([x,z])=>shifts.flatMap(([dx,dz])=>
    !inside(x+dx,z+dz) && inner.has((x-dx)+','+(z-dz))
      ? [{cell:[x,z] as ZoneCell, outside:[x+dx,z+dz] as ZoneCell, inside:[x-dx,z-dz] as ZoneCell}] : []));
  const connected = (group:Set<string>, first?:ZoneCell) => {
    if(!first) return false;
    const visited=new Set([cellKey(first)]), queue=[first];
    for(let i=0;i<queue.length;i++) for(const [dx,dz] of shifts){
      const p:ZoneCell=[queue[i]![0]+dx,queue[i]![1]+dz], k=cellKey(p);
      if(group.has(k)&&!visited.has(k)){visited.add(k);queue.push(p);}
    }
    return visited.size===group.size;
  };
  return {border,interior,gates,connected:connected(inner,interior[0])&&connected(selected,cells[0])};
}

const layouts=new WeakMap<Footprint,ReturnType<typeof computeLayout>>();
export function pastureLayout(area:Footprint){
  let layout=layouts.get(area);
  if(!layout){layout=computeLayout(area);layouts.set(area,layout);}
  return layout;
}

export function choosePastureGate(area:Footprint, gates:ReturnType<typeof pastureLayout>['gates'],
  pathLength:(outside:ZoneCell)=>number) {
  const centerX=area.x+(area.w-1)/2, centerZ=area.z+(area.d-1)/2;
  return gates.map(g=>({...g,length:pathLength(g.outside),center:Math.hypot(g.cell[0]-centerX,g.cell[1]-centerZ)}))
    .filter(g=>Number.isFinite(g.length))
    .sort((a,b)=>a.length-b.length || a.center-b.center || a.cell[1]-b.cell[1] || a.cell[0]-b.cell[0])[0];
}
