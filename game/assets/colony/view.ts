import type { World, EntityHandle } from '@forgeax/engine/ecs';
import type { AssetRegistry } from '@forgeax/engine/assets-runtime';
import { createBoxGeometry } from '@forgeax/engine/geometry';
import { Materials, MeshFilter, MeshRenderer, ShadowParticipation } from '@forgeax/engine/render';
import { ChildOf, Name, Transform } from '@forgeax/engine/scene';
import { RenderQueue, type AssetHandle } from '@forgeax/engine/types';
import { CharacterView, residentOutfit, type CharacterAssets } from './character-view.ts';
import type { VoxelWorld } from '../voxel/model.ts';
import { BUILDING_DEFS, type BuildingKind } from './contracts.ts';

type V3=[number,number,number];
type Part={p:V3;s:V3;c:string;shadow?:boolean};
type RenderPawn={id:string;name:string;position:V3;health:number;task?:string;job?:string;carrying?:Partial<Record<string,number>>};
type RenderBuilding={id:string;kind:string;x:number;y:number;z:number;w?:number;d?:number;h?:number;rotation?:number;doorOpen?:boolean;complete:boolean;progress:number;powered?:boolean;phase?:string};
export type ColonyRenderState={
  colonists:RenderPawn[]; buildings:RenderBuilding[];
  zones:{id:string;kind:string;x:number;z:number;w:number;d:number}[];
  crops:{id?:string;x:number;y:number;z:number;growth:number;kind?:string;planted?:boolean}[];
  items:{id:string;resource:string;amount:number;x:number;y:number;z:number}[];
  selectedColonistId?:string|null;
  selectedBuildingId?:string|null;
  buildPreview?:RenderBuilding|null;
  /** 玩家角色。不属于殖民地模拟，只在这里画出来。 */
  player?:{x:number;y:number;z:number;facing:number;moving:boolean;grounded:boolean};
};
const COLORS:Record<string,string>={
  wood:'#a97943',stone:'#9ca9a5',steel:'#899fae',food:'#e4bc63',meal:'#d4834b',medicine:'#ecf4dd',cloth:'#c2b3d9',silver:'#e5d69b',components:'#d0ad45',
  dark:'#2e4247',cream:'#f0ddba',blanket:'#568b9b',white:'#fff3d5',green:'#63935e',gold:'#e5c66f',blue:'#4d7d96',black:'#233135',
  light:'#c5e4cd',soil:'#7e563b',
  blueprint:'#75cece',zoneFarm:'#90bd65',zoneStock:'#75baca',selected:'#ecd78c',health:'#9fc174',bad:'#c56b55',
  playerMark:'#ffd76e',
};
const rgba=(hex:string):[number,number,number,number]=>{
  const n=parseInt(hex.slice(1),16);const f=(v:number)=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4;
  return [f(((n>>16)&255)/255),f(((n>>8)&255)/255),f((n&255)/255),1];
};

/** Native meshes only. The simulation remains the authority; this layer never changes it. */
export class ColonyView {
  private cube:AssetHandle<'mesh'>;
  private materials=new Map<string,AssetHandle<'material'>>();
  private groups=new Map<string,{signature:string;entities:EntityHandle[];transforms:number[][]}>();
  private residents = new Map<string, CharacterView>();
  constructor(private world:World,private assets:AssetRegistry,private terrain:()=>VoxelWorld, private characters:CharacterAssets){
    this.cube=assets.create(createBoxGeometry(1,1,1).unwrap()).unwrap();
  }
  private material(key:string):AssetHandle<'material'>{
    const existing=this.materials.get(key);if(existing)return existing;
    const translucent=['blueprint','zoneFarm','zoneStock','selected'].includes(key);
    const c=rgba(COLORS[key]??key);if(translucent)c[3]=key==='blueprint'?.35:.28;
    const value=translucent?Materials.unlit(c,{queue:RenderQueue.Transparent,renderState:{depthWriteEnabled:false,cullMode:'none',blend:{color:{srcFactor:'src-alpha',dstFactor:'one-minus-src-alpha',operation:'add'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'}}}}):Materials.standard({baseColor:c,roughness:.86,metallic:key==='steel'?.3:0});
    const handle=this.assets.create(value).unwrap();this.materials.set(key,handle);return handle;
  }
  private put(key:string,parts:Part[],active:Set<string>,signature=''){
    active.add(key);let group=this.groups.get(key);
    const sig=signature||parts.map(p=>p.c).join('|');
    if(group&&(group.signature!==sig||group.entities.length!==parts.length)){for(const e of group.entities)this.world.despawn(e).unwrap();this.groups.delete(key);group=undefined;}
    if(!group){
      group={signature:sig,transforms:parts.map(p=>[...p.p,...p.s]),entities:parts.map((p,i)=>this.world.spawn(
        {component:Name,data:{value:`${key}/${i}`}},{component:Transform,data:{pos:p.p,scale:p.s}},
        {component:MeshFilter,data:{assetHandle:this.cube}},{component:MeshRenderer,data:{materials:[this.material(p.c)]}},
        {component:ShadowParticipation,data:{cast:p.shadow!==false,receive:true}},
      ).unwrap())};this.groups.set(key,group);
    }else for(let i=0;i<parts.length;i++){
      const p=parts[i]!,next=[...p.p,...p.s];
      if(next.some((n,j)=>n!==group!.transforms[i]![j])){this.world.set(group.entities[i]!,Transform,{pos:p.p,scale:p.s}).unwrap();group.transforms[i]=next;}
    }
  }
  update(state:ColonyRenderState,time:number){
    const active=new Set<string>();
    const present = new Set(state.colonists.map(p => p.id));
    for (const [id, actor] of this.residents) if (!present.has(id)) {
      actor.dispose();
      this.residents.delete(id);
    }
    for (const p of state.colonists) {
      let actor = this.residents.get(p.id);
      if (!actor) {
        actor = new CharacterView(this.world, this.assets, this.characters, residentOutfit(p.id));
        this.residents.set(p.id, actor);
      }
      actor.updateResident(p.position, time);
      const [x,y,z] = p.position, scale = actor.scale;
      const parts: Part[] = [];
      const carried = Object.entries(p.carrying ?? {}).find(([, amount]) => (amount ?? 0) > 0);
      if (carried) parts.push({p:[x+Math.sin(actor.facing)*.45*scale,y+.87*scale,z+Math.cos(actor.facing)*.45*scale],
        s:[.42*scale,.35*scale,.3*scale],c:COLORS[carried[0]]?carried[0]:'wood'});
      if(state.selectedColonistId===p.id)parts.push({p:[x,y+.025,z],s:[.94,.045,.94],c:'selected',shadow:false});
      if(p.health<80)parts.push({p:[x,y+1.8*scale+.15,z],s:[.65*Math.max(.05,p.health/100),.07,.07],c:p.health>35?'health':'bad',shadow:false});
      if (parts.length) this.put(`居民/${p.id}`, parts, active);
    }
    for(const b of state.buildPreview?[...state.buildings,state.buildPreview]:state.buildings){
      // Completed walls are composed by the shared semantic voxel renderer.
      if(b.complete&&b.kind==='wall'&&b.id!=='placement-preview')continue;
      const w=b.w??1,d=b.d??1,h=b.h??1,x=b.x+w/2,y=b.y,z=b.z+d/2;
      const rotation=b.rotation??0,ghost=b.id==='placement-preview';
      const parts:Part[]=[];
      const part=(dx:number,dy:number,dz:number,sx:number,sy:number,sz:number,c:string,shadow=true)=>{
        const rx=rotation===1?-dz:rotation===2?-dx:rotation===3?dz:dx;
        const rz=rotation===1?dx:rotation===2?-dz:rotation===3?-dx:dz;
        parts.push({p:[x+rx,y+dy,z+rz],s:rotation%2?[sz,sy,sx]:[sx,sy,sz],c:ghost?'blueprint':c,shadow:ghost?false:shadow});
      };
      if(!b.complete&&!ghost){
        // Blueprint bounds are already in world orientation.
        parts.push({p:[x,y+h/2,z],s:[w-.14,h-.1,d-.14],c:'blueprint',shadow:false});
        parts.push({p:[x,y+.02,z],s:[w-.02,.035,d-.02],c:b.phase==='preparingTerrain'?'selected':'zoneStock',shadow:false});
        parts.push({p:[x,y+h+.02,z],s:[w*.8*Math.max(.02,Math.min(1,b.progress)),.06,.07],c:'light',shadow:false});
      }
      else switch(b.kind){
        case 'wall':part(0,.9,0,1,1.8,1,'stone');part(0,1.84,0,1.03,.08,1.03,'cream');break;
        case 'door':
          part(-.44,.96,-.39,.12,1.92,.2,'wood');part(.44,.96,-.39,.12,1.92,.2,'wood');part(0,1.94,-.39,1,.12,.2,'wood');
          if(b.doorOpen){part(-.39,.93,0,.1,1.8,.78,'wood');part(-.46,.92,.26,.07,.1,.08,'gold');}
          else{part(0,.93,-.39,.78,1.8,.1,'wood');part(0,.5,-.455,.68,.08,.035,'dark');part(0,1.45,-.455,.68,.08,.035,'dark');part(.26,.92,-.49,.08,.1,.08,'gold');}
          break;
        case 'floor':part(0,.025,0,.98,.05,.98,'wood');break;
        case 'bed':case 'hospital':case 'hospitalBed':case 'medicalBed':
          part(0,.22,0,.86,.36,1.84,'wood');part(0,.44,.22,.82,.12,1.35,b.kind==='bed'?'blanket':'white');part(0,.49,-.62,.67,.17,.4,'white');part(0,.5,-.91,.94,.8,.1,'wood');part(0,.27,.91,.94,.48,.1,'wood');break;
        case 'table':case 'bench':case 'workbench':case 'research':case 'researchBench':case 'researchDesk':
          for(const dx of[-.35,.35])for(const dz of[-.3,.3])part(dx,.35,dz,.1,.7,.1,'wood');
          part(0,.75,0,1.15,.15,.9,'wood');
          if(b.kind.toLowerCase().includes('research')){part(0,1,-.1,.6,.4,.09,'dark');part(0,1,-.04,.52,.32,.03,'blue');part(.25,.86,.2,.25,.06,.2,'white');}
          else if(b.kind!=='table'){part(-.25,.9,0,.3,.18,.3,'steel');part(.25,.86,.05,.25,.06,.35,'gold');}break;
        case 'stove':case 'kitchen':part(0,.38,0,.9,.76,.85,'stone');part(0,.81,0,.95,.1,.9,'dark');part(-.2,.88,.1,.25,.04,.25,'gold');part(.21,.91,-.12,.3,.15,.3,'steel');part(0,.25,.44,.6,.3,.03,'black');break;
        case 'solar':case 'solarPanel':part(0,.4,0,.18,.8,.18,'steel');part(0,.88,0,1.45,.11,1.25,'dark');part(0,.96,0,1.33,.04,1.13,'blue');part(0,.99,0,.035,.015,1.13,'steel');part(0,.99,0,1.33,.015,.035,'steel');break;
        case 'battery':part(0,.45,0,.7,.9,.7,'dark');part(0,.5,.36,.45,.55,.035,'green');part(-.18,.95,0,.12,.1,.15,'gold');part(.18,.95,0,.12,.1,.15,'steel');break;
        case 'cooler':case 'fridge':case 'freezer':part(0,.65,0,.85,1.3,.85,'white');part(0,.75,.44,.71,.95,.04,'blanket');part(.26,.75,.49,.06,.35,.04,'steel');break;
        default:{
          // 占位符：飞书「模型」往下那批建筑还没建模，先按 BUILDING_DEFS 里的颜色画个方块。
          // 以后接真模型只需要在 switch 里补 case，这段不用动。
          const def=BUILDING_DEFS[b.kind as BuildingKind];
          const hex=def?`#${def.color.map(v=>Math.round(v*255).toString(16).padStart(2,'0')).join('')}`:'#8a8a8a';
          const hh=def?.height??0.9;
          part(0,hh/2,0,w*.82,hh,d*.82,hex);
          part(0,hh+.03,0,w*.88,.06,d*.88,'cream',false);
          break;
        }
      }
      if(b.complete&&['solar','battery','cooler'].includes(b.kind))part(.26,.7,.47,.08,.08,.025,b.powered?'green':'bad',false);
      if(state.selectedBuildingId===b.id)parts.push({p:[x,y+.025,z],s:[w+.04,.045,d+.04],c:'selected',shadow:false});
      this.put(`设施/${b.id}`,parts,active,`${b.kind}:${b.complete}:${b.powered}:${b.phase}:${w}:${d}:${h}:${rotation}:${b.doorOpen}:${state.selectedBuildingId===b.id}`);
    }
    for(const zone of state.zones){
      const parts:Part[]=[];
      for(let x=zone.x;x<zone.x+zone.w;x++)for(let z=zone.z;z<zone.z+zone.d;z++){
        const y=this.terrain().terrainHeight(x,z);
        parts.push({p:[x+.5,y+.026,z+.5],s:[.94,.045,.94],c:zone.kind==='farm'?'zoneFarm':'zoneStock',shadow:false});
      }
      this.put(`区域/${zone.id}`,parts,active);
    }
    for(const p of state.crops){
      const g=Math.max(.01,Math.min(1,p.growth)),x=p.x+.5,y=p.y,z=p.z+.5;
      const parts:Part[]=[{p:[x,y+.025,z],s:[.84,.05,.84],c:'soil',shadow:false}];
      if(p.planted===false){this.put(`作物/${p.id??`${p.x},${p.z}`}`,parts,active);continue;}
      for(const [dx,dz]of[[-.22,-.2],[.22,-.2],[-.22,.2],[.22,.2]]){
        parts.push({p:[x+dx,y+.12+g*.3,z+dz],s:[.08,.2+g*.6,.08],c:'green'});
        if(g>.2)parts.push({p:[x+dx,y+.25+g*.42,z+dz],s:[.22,.14+g*.13,.18],c:g>.8?'gold':'green'});
      }
      this.put(`作物/${p.id??`${p.x},${p.z}`}`,parts,active);
    }
    for(const item of state.items){
      if(item.amount<=0)continue;const scale=.2+Math.min(.38,Math.cbrt(item.amount)*.07);
      this.put(`物资/${item.id}`,[{p:[item.x+.5,item.y+scale/2,item.z+.5],s:[scale,scale,scale],c:COLORS[item.resource]?item.resource:'gold'}],active);
    }
    for(const [key,g]of this.groups)if(!active.has(key)){for(const e of g.entities)this.world.despawn(e).unwrap();this.groups.delete(key);}
  }
  dispose(){this.player?.actor.dispose();this.player=null;for(const actor of this.residents.values())actor.dispose();this.residents.clear();this.updateChests([]);for(const g of this.groups.values())for(const e of g.entities)this.world.despawn(e).unwrap();this.groups.clear();for(const m of this.materials.values())this.assets.release(m).unwrap();this.materials.clear();this.assets.release(this.cube).unwrap();}

  private player: {actor:CharacterView; ground:EntityHandle; grounded:boolean} | null = null;
  private chestEntities = new Map<string, { pos: V3; parts: EntityHandle[] }>();

  updatePlayer(p:{x:number;y:number;z:number;facing:number;moving:boolean;grounded:boolean}){
    if (!this.player) {
      const actor = new CharacterView(this.world, this.assets, this.characters, 1);
      const marker = (name:string, y:number, scale:V3) => this.world.spawn(
        {component:Name,data:{value:name}}, {component:ChildOf,data:{parent:actor.root}},
        {component:Transform,data:{pos:[0,y,0],scale}},
        {component:MeshFilter,data:{assetHandle:this.cube}},
        {component:MeshRenderer,data:{materials:[this.material('playerMark')]}},
        {component:ShadowParticipation,data:{cast:false,receive:true}},
      ).unwrap();
      marker('player/overhead', 2.08, [.22,.22,.22]);
      this.player = {actor, ground:marker('player/ground', .025, [.72,.03,.72]), grounded:true};
    }
    this.player.actor.updatePlayer([p.x,p.y,p.z], p.facing, p.moving && p.grounded);
    if (p.grounded !== this.player.grounded) {
      this.world.set(this.player.ground, Transform, {scale:p.grounded?[.72,.03,.72]:[0,0,0]}).unwrap();
      this.player.grounded = p.grounded;
    }
  }

  get playerEntityCount(){return this.player ? this.player.actor.meshCount + 2 : 0;}
  readCharacters() {
    return { player:this.player?.actor.read() ?? null,
      residents:[...this.residents].map(([id, actor]) => ({id, ...actor.read()})) };
  }

  updateChests(chests: readonly { id: string; pos: V3 }[]) {
    for (const [id, chest] of this.chestEntities) {
      const next = chests.find(candidate => candidate.id === id);
      if (next && chest.pos.every((coord, axis) => coord === next.pos[axis])) continue;
      for (const entity of chest.parts) this.world.despawn(entity).unwrap();
      this.chestEntities.delete(id);
    }
    for (const { id, pos } of chests) {
      if (!this.chestEntities.has(id)) this.chestEntities.set(id, { pos, parts: this.spawnChest(id, pos) });
    }
  }

  private spawnChest(id: string, pos: V3): EntityHandle[] {
    const [gx,gy,gz]=pos;
    // 画在格子中心，和判定用的圆心对齐
    const x=gx+0.5, y=gy, z=gz+0.5;
    // 箱体 + 盖子 + 正面的锁扣，凑成一个能认出来的箱子
    const parts:Part[]=[
      {p:[x,y+.28,z],s:[.86,.56,.72],c:'wood'},
      {p:[x,y+.60,z],s:[.9,.12,.76],c:'dark'},
      {p:[x,y+.30,z+.37],s:[.18,.2,.06],c:'steel'},
    ];
    return parts.map((part,i)=>this.world.spawn(
      {component:Name,data:{value:`chest/${id}/${i}`}},{component:Transform,data:{pos:part.p,scale:part.s}},
      {component:MeshFilter,data:{assetHandle:this.cube}},{component:MeshRenderer,data:{materials:[this.material(part.c)]}},
      {component:ShadowParticipation,data:{cast:true,receive:true}},
    ).unwrap());
  }

}
