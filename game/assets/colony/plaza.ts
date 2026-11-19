import type { BuildingView, Position } from './contracts.ts';

type Site = Pick<BuildingView, 'x'|'y'|'z'|'w'|'d'|'rotation'>;
// Food quantities were unspecified in the design. The testing recipe consumes
// zero of every entry (the active construction cost is empty in BUILDING_DEFS).
export const PLAZA_RECIPE = [
  {name:'面包'}, {name:'意大利面'}, {name:'蓝莓酒'}, {name:'烤猪排'}, {name:'奶酪'},
  {name:'篝火',quantity:1}, {name:'燃灯',quantity:10}, {name:'长桌',quantity:2},
  {name:'短桌',quantity:2}, {name:'长椅',quantity:8},
] satisfies {name:string;quantity?:number}[];
export const FINALE_SECONDS = 14;
export const DUSK_SECONDS = 3;
export const PAN_SECONDS = 3;
export const smooth = (v:number) => { const t=Math.max(0,Math.min(1,v)); return t*t*(3-2*t); };

// Local coordinates use glTF's Y-up axes, with the stage on the negative Z edge.
export function plazaPoint(site:Site, x:number, y:number, z:number):Position {
  const [dx,dz] = [[x,z],[-z,x],[-x,-z],[z,-x]][site.rotation]!;
  return [site.x+site.w/2+dx,site.y+y,site.z+site.d/2+dz];
}

export function plazaObstacle(site:Site,x:number,z:number):boolean {
  const dx=x+.5-site.x-site.w/2, dz=z+.5-site.z-site.d/2;
  const [lx,lz]=[[dx,dz],[dz,-dx],[-dx,-dz],[-dz,dx]][site.rotation]!;
  const side=Math.abs(lx);
  return Math.hypot(lx,lz)<1.3 || (side>=6.7 && side<=9.45 && Math.abs(lz)<3.2)
    || (side>=6.8 && side<=10 && lz< -5.7 && lz> -8.15)
    || (side<3.5 && lz< -6.3 && lz> -10);
}

// The first three marks are the actors' positions in the Blender reference.
const guestMarks=[
  [-2.2,2.5],[5.8,-1.3],[-7.1,-4.9],
  [2.5,1.5],[-1.5,-2.5],[1.5,-2.5],[-4.5,.5],[4.5,2.5],[-2.5,4.5],[2.5,4.5],
  [5.5,-4.5],[-5.5,-2.5],[.5,4.5],[-4.5,-4.5],[3.5,-4.5],[-5.5,4.5],
  [6.5,4.5],[-1.5,-5.5],[2.5,-5.5],[.5,6.5],
];
export function gatheringSpot(site:Site,index:number):Position {
  const [lx,lz]=guestMarks[index % guestMarks.length]!;
  return plazaPoint(site,lx!,0,lz!);
}

export const PLAZA_LAYERS = [
  ['ground',.01],['hearth',.14],['stage',.29],['banquet',.44],['seating',.59],
  ['decor',.73],['food',.86],['lanterns',.96],
] as const;

