import type { World, EntityHandle } from '@forgeax/engine/ecs';
import type { AssetRegistry } from '@forgeax/engine/assets-runtime';
import { createBoxGeometry } from '@forgeax/engine/geometry';
import { Materials, MeshFilter, MeshRenderer, ShadowParticipation } from '@forgeax/engine/render';
import { Name, Transform } from '@forgeax/engine/scene';
import { RenderQueue, type AssetHandle } from '@forgeax/engine/types';
import type { VoxelWorld } from '../voxel/model.ts';

type V3=[number,number,number];
type Part={p:V3;s:V3;c:string;shadow?:boolean};
type RenderPawn={id:string;name:string;position:V3;health:number;task?:string;job?:string;carrying?:Partial<Record<string,number>>};
type RenderBuilding={id:string;kind:string;x:number;y:number;z:number;complete:boolean;progress:number;powered?:boolean};
export type ColonyRenderState={
  colonists:RenderPawn[]; buildings:RenderBuilding[];
  zones:{id:string;kind:string;x:number;z:number;w:number;d:number}[];
  crops:{id?:string;x:number;y:number;z:number;growth:number;kind?:string;planted?:boolean}[];
  items:{id:string;resource:string;amount:number;x:number;y:number;z:number}[];
  selectedColonistId?:string|null;
};
const COLORS:Record<string,string>={
  wood:'#a97943',stone:'#9ca9a5',steel:'#899fae',food:'#e4bc63',meal:'#d4834b',medicine:'#ecf4dd',cloth:'#c2b3d9',silver:'#e5d69b',components:'#d0ad45',
  dark:'#2e4247',cream:'#f0ddba',blanket:'#568b9b',white:'#fff3d5',green:'#63935e',gold:'#e5c66f',blue:'#4d7d96',black:'#233135',
  shirt0:'#e0a160',shirt1:'#6b9ba5',shirt2:'#b17f91',shirt3:'#849d60',skin:'#e5b48a',hair:'#60483e',light:'#c5e4cd',soil:'#7e563b',
  blueprint:'#75cece',zoneFarm:'#90bd65',zoneStock:'#75baca',selected:'#ecd78c',health:'#9fc174',bad:'#c56b55',
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
  private pawnPositions=new Map<string,V3>();
  constructor(private world:World,private assets:AssetRegistry,private terrain:()=>VoxelWorld){
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
    for(const [i,p]of state.colonists.entries()){
      const [x,y,z]=p.position;
      const old=this.pawnPositions.get(p.id);const moving=old&&Math.hypot(x-old[0],z-old[2])>.003;
      this.pawnPositions.set(p.id,[x,y,z]);const swing=moving?Math.sin(time*11+i)*.09:0;
      const parts:Part[]=[
        {p:[x-.13,y+.22+swing,z],s:[.18,.44,.24],c:'dark'}, {p:[x+.13,y+.22-swing,z],s:[.18,.44,.24],c:'dark'},
        {p:[x,y+.69,z],s:[.5,.55,.3],c:`shirt${i%4}`}, {p:[x,y+1.12,z],s:[.4,.4,.37],c:'skin'},
        {p:[x,y+1.34,z-.02],s:[.43,.12,.4],c:'hair'},
        {p:[x-.1,y+1.14,z+.19],s:[.045,.055,.025],c:'black'},{p:[x+.1,y+1.14,z+.19],s:[.045,.055,.025],c:'black'},
        {p:[x-.32,y+.65-swing,z],s:[.13,.43,.19],c:'skin'},{p:[x+.32,y+.65+swing,z],s:[.13,.43,.19],c:'skin'},
      ];
      const carried=Object.entries(p.carrying??{}).find(([,amount])=>(amount??0)>0);
      if(carried)parts.push({p:[x,y+.7,z+.37],s:[.42,.35,.3],c:COLORS[carried[0]]?carried[0]:'wood'});
      if(state.selectedColonistId===p.id)parts.push({p:[x,y+.025,z],s:[.94,.045,.94],c:'selected',shadow:false});
      if(p.health<80)parts.push({p:[x,y+1.65,z],s:[.65*Math.max(.05,p.health/100),.07,.07],c:p.health>35?'health':'bad',shadow:false});
      this.put(`居民/${p.id}`,parts,active);
    }
    for(const b of state.buildings){
      const x=b.x+.5,y=b.y,z=b.z+.5;
      const parts:Part[]=[];
      const part=(dx:number,dy:number,dz:number,sx:number,sy:number,sz:number,c:string,shadow=true)=>parts.push({p:[x+dx,y+dy,z+dz],s:[sx,sy,sz],c,shadow});
      if(!b.complete){part(0,.45,0,.86,.9,.86,'blueprint',false);part(0,.02,0,.98,.035,.98,'zoneStock',false);part(0,1.02,0,.8*Math.max(.02,Math.min(1,b.progress)),.06,.07,'light',false);}
      else switch(b.kind){
        case 'wall':part(0,.9,0,1,1.8,1,'stone');part(0,1.84,0,1.03,.08,1.03,'cream');break;
        case 'door':part(-.41,.9,0,.18,1.8,.35,'wood');part(.41,.9,0,.18,1.8,.35,'wood');part(0,1.72,0,1,.18,.35,'wood');break;
        case 'floor':part(0,.025,0,.98,.05,.98,'wood');break;
        case 'bed':case 'hospital':case 'hospitalBed':case 'medicalBed':
          part(0,.22,0,.8,.36,1.4,'wood');part(0,.44,.15,.76,.12,1.03,b.kind==='bed'?'blanket':'white');part(0,.49,-.49,.63,.17,.28,'white');part(0,.5,-.73,.88,.8,.1,'wood');break;
        case 'table':case 'bench':case 'workbench':case 'research':case 'researchBench':case 'researchDesk':
          for(const dx of[-.35,.35])for(const dz of[-.3,.3])part(dx,.35,dz,.1,.7,.1,'wood');
          part(0,.75,0,1.15,.15,.9,'wood');
          if(b.kind.toLowerCase().includes('research')){part(0,1,-.1,.6,.4,.09,'dark');part(0,1,-.04,.52,.32,.03,'blue');part(.25,.86,.2,.25,.06,.2,'white');}
          else if(b.kind!=='table'){part(-.25,.9,0,.3,.18,.3,'steel');part(.25,.86,.05,.25,.06,.35,'gold');}break;
        case 'stove':case 'kitchen':part(0,.38,0,.9,.76,.85,'stone');part(0,.81,0,.95,.1,.9,'dark');part(-.2,.88,.1,.25,.04,.25,'gold');part(.21,.91,-.12,.3,.15,.3,'steel');part(0,.25,.44,.6,.3,.03,'black');break;
        case 'solar':case 'solarPanel':part(0,.4,0,.18,.8,.18,'steel');part(0,.88,0,1.45,.11,1.25,'dark');part(0,.96,0,1.33,.04,1.13,'blue');part(0,.99,0,.035,.015,1.13,'steel');part(0,.99,0,1.33,.015,.035,'steel');break;
        case 'battery':part(0,.45,0,.7,.9,.7,'dark');part(0,.5,.36,.45,.55,.035,'green');part(-.18,.95,0,.12,.1,.15,'gold');part(.18,.95,0,.12,.1,.15,'steel');break;
        case 'cooler':case 'fridge':case 'freezer':part(0,.65,0,.85,1.3,.85,'white');part(0,.75,.44,.71,.95,.04,'blanket');part(.26,.75,.49,.06,.35,.04,'steel');break;
        default:part(0,.4,0,.8,.8,.8,'wood');break;
      }
      if(b.complete&&['solar','battery','cooler'].includes(b.kind))part(.26,.7,.47,.08,.08,.025,b.powered?'green':'bad',false);
      this.put(`设施/${b.id}`,parts,active,`${b.kind}:${b.complete}:${b.powered}`);
    }
    for(const zone of state.zones){
      const parts:Part[]=[];
      for(let x=zone.x;x<zone.x+zone.w;x++)for(let z=zone.z;z<zone.z+zone.d;z++){
        const y=this.terrain().surfaceHeight(x,z)+1;
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
  dispose(){for(const g of this.groups.values())for(const e of g.entities)this.world.despawn(e).unwrap();this.groups.clear();for(const m of this.materials.values())this.assets.release(m).unwrap();this.materials.clear();this.assets.release(this.cube).unwrap();}
}
