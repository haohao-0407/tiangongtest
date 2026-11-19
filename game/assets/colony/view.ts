import type { World, EntityHandle } from '@forgeax/engine/ecs';
import type { AssetRegistry } from '@forgeax/engine/assets-runtime';
import { createBoxGeometry } from '@forgeax/engine/geometry';
import { Materials, MeshFilter, MeshRenderer, ShadowParticipation } from '@forgeax/engine/render';
import { Name, Transform } from '@forgeax/engine/scene';
import { RenderQueue, type AssetHandle } from '@forgeax/engine/types';
import { FARM_SOIL_HEIGHT, type CropCards } from './crop-cards.ts';
import type { VoxelWorld } from '../voxel/model.ts';
import { BUILDING_DEFS, buildingItemKind, isCropSeed, type BuildingKind, type CropKind, type PlayerInventorySlot } from './contracts.ts';
import { buildingDimensions } from './buildings.ts';

type V3=[number,number,number];
type Rotation=[number,number,number,number];
const IDENTITY:Rotation=[0,0,0,1];
type Part = { p: V3; s: V3; shadow?: boolean } & ({ c: string; mesh?: undefined } | { mesh: AssetHandle<'mesh'>; c?: undefined });
type RenderPawn={id:string;name:string;position:V3;health:number;facing?:number;task?:string;job?:string;bag?:readonly PlayerInventorySlot[];bagSelected?:number;carrying?:Partial<Record<string,number>>};
type RenderBuilding={id:string;kind:string;x:number;y:number;z:number;w?:number;d?:number;h?:number;rotation?:number;doorOpen?:boolean;complete:boolean;progress:number;powered?:boolean;phase?:string};
export type ColonyRenderState={
  colonists:RenderPawn[]; buildings:RenderBuilding[];
  zones:{id:string;kind:string;x:number;z:number;w:number;d:number}[];
  crops:{id?:string;x:number;y:number;z:number;growth:number;kind?:CropKind;planted?:boolean}[];
  items:{id:string;resource:string;amount:number;x:number;y:number;z:number;age?:number;scatter?:boolean}[];
  selectedColonistId?:string|null;
  selectedBuildingId?:string|null;
  buildPreview?:RenderBuilding|null;
  controlledColonistId?:string|null;
};
const COLORS:Record<string,string>={
  wood:'#a97943',dirt:'#845a3a',stone:'#9ca9a5',steel:'#899fae',food:'#e4bc63',meal:'#d4834b',medicine:'#ecf4dd',cloth:'#c2b3d9',silver:'#e5d69b',components:'#d0ad45',
  dark:'#2e4247',cream:'#f0ddba',blanket:'#568b9b',white:'#fff3d5',green:'#63935e',gold:'#e5c66f',blue:'#4d7d96',black:'#233135',
  shirt0:'#e0a160',shirt1:'#6b9ba5',shirt2:'#b17f91',shirt3:'#849d60',skin:'#e5b48a',hair:'#60483e',light:'#c5e4cd',soil:'#7e563b',
  blueprint:'#75cece',zoneFarm:'#90bd65',zoneStock:'#75baca',selected:'#ecd78c',health:'#9fc174',bad:'#c56b55',
  playerMark:'#ffd76e', seedPack:'#ba955c',
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
  constructor(private world:World,private assets:AssetRegistry,private terrain:()=>VoxelWorld,
    private readonly cropCards?:Pick<CropCards,'update'|'hasModel'|'itemMesh'>){
    this.cube=assets.create(createBoxGeometry(1,1,1).unwrap()).unwrap();
  }
  private material(key:string):AssetHandle<'material'>{
    const existing=this.materials.get(key);if(existing)return existing;
    const cloudKeys=['cloudHigh','cloudHigh2'];
    const translucent=['blueprint','zoneFarm','zoneStock','selected'].includes(key);
    const c=cloudKeys.includes(key)?[0.93,0.95,0.97,1] as [number,number,number,number]:rgba(COLORS[key]??key);
    if(translucent)c[3]=key==='blueprint'?.35:.28;
    const value=translucent?Materials.unlit(c,{queue:RenderQueue.Transparent,renderState:{depthWriteEnabled:false,cullMode:'none',blend:{color:{srcFactor:'src-alpha',dstFactor:'one-minus-src-alpha',operation:'add'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'}}}}):Materials.standard({baseColor:c,roughness:.86,metallic:key==='steel'?.3:0});
    const handle=this.assets.create(value).unwrap();this.materials.set(key,handle);return handle;
  }
  private put(key:string,parts:Part[],active?:Set<string>,signature='',rotation=IDENTITY){
    active?.add(key);let group=this.groups.get(key);
    const sig=signature||parts.map(p=>p.mesh??p.c).join('|');
    if(group&&(group.signature!==sig||group.entities.length!==parts.length)){for(const e of group.entities)this.world.despawn(e).unwrap();this.groups.delete(key);group=undefined;}
    if(!group){
      group={signature:sig,transforms:parts.map(p=>[...p.p,...p.s,...rotation]),entities:parts.map((p,i)=>this.world.spawn(
        {component:Name,data:{value:`${key}/${i}`}},{component:Transform,data:{pos:p.p,scale:p.s,quat:rotation}},
        {component:MeshFilter,data:{assetHandle:p.mesh??this.cube}},{component:MeshRenderer,data:{materials:p.mesh===undefined?[this.material(p.c)]:[]}},
        {component:ShadowParticipation,data:{cast:p.shadow!==false,receive:true}},
      ).unwrap())};this.groups.set(key,group);
    }else for(let i=0;i<parts.length;i++){
      const p=parts[i]!,next=[...p.p,...p.s,...rotation];
      if(next.some((n,j)=>n!==group!.transforms[i]![j])){this.world.set(group.entities[i]!,Transform,{pos:p.p,scale:p.s,quat:rotation}).unwrap();group.transforms[i]=next;}
    }
  }
  /**
   * 云影：在天空放一批扁平云片，让方向光把它们的影子投到地面。
   *
   * 为什么这么做：贴地的半透明平面看起来是「雾」，因为它不随光照角度变化、
   * 也不会被地形遮挡。真正的阴影是阴影贴图算出来的——所以只要把云放到天上，
   * 打开 cast，地面自然就有了严丝合缝的影子：跨台阶、绕建筑、随地形起伏都对。
   *
   * 云片本身故意做得很淡（薄云），玩家抬头能看到一点点，但不抢戏。
   */
  private renderClouds(time:number,active:Set<string>){
    const CLOUD_Y=18, DRIFT_X=1.1, DRIFT_Z=0.4;
    // 云片布局：错开的大块，别排成整齐的阵列
    // 阳光几乎垂直（[-0.32,-0.91,-0.24]），所以影子基本就在云正下方。
    // 云片要铺在**地图中间**——出生点和主要活动区都在 128 附近，
    // 之前围着原点摆，玩家在 125 格开外，头顶根本没云。
    const CX=128, CZ=128;
    // 每片之间留出比自身更大的空隙，地面才会出现「一块亮一块暗」，
    // 连成一片就只是一层均匀的灰，看不出是云。
    const SHAPES:[number,number,number,number][]=[
      // x, z, 宽, 深
      [0,0,26,20],
      [46,34,22,16],
      [-40,-32,24,18],
      [24,-50,20,15],
      [-52,40,22,17],
      [64,-8,18,14],
      [-8,54,20,15],
      [78,50,16,12],
      [-74,-10,18,14],
    ];
    // 每片云由几个错开的小块拼出来。
    // 单个矩形投出来的影子是规整的方块，一眼就看出是几何体；
    // 错开叠一叠，轮廓才有起伏，像真的云。
    const CLUSTER:[number,number,number,number][]=[
      // 相对偏移, 相对尺寸
      [0,0,1,1],
      [0.58,0.16,0.52,0.66],
      [-0.46,-0.26,0.46,0.6],
      [0.06,-0.52,0.42,0.46],
    ];
    const parts:Part[]=[];
    for(const [bx,bz,bw,bd]of SHAPES){
      // 云在世界里飘。用取模让它们绕地图循环，否则跑几个小时后全飘出地图。
      const wrap=(v:number)=>((v%256)+256)%256;
      const x=wrap(CX+bx+time*DRIFT_X);
      const z=wrap(CZ+bz+time*DRIFT_Z);
      for(const [ox,oz,sw,sd]of CLUSTER){
        parts.push({
          p:[x+ox*bw,CLOUD_Y+(ox+oz)*0.8,z+oz*bd],
          s:[bw*sw,0.6,bd*sd],
          c:'cloudHigh',
          shadow:true,
        });
      }
    }
    // signature 固定，靠 put 的 transform 分支移动（每帧重建 48 个实体会掉帧）
    this.put('云影',parts,active,'cloud');
  }

  private buildingGeometry(b: RenderBuilding, scale=1): Part[] {
    const w=b.w??1,d=b.d??1,h=b.h??1,x=b.x+w/2,y=b.y,z=b.z+d/2;
    const rotation=b.rotation??0,ghost=b.id==='placement-preview';
    const parts:Part[]=[];
    const part=(dx:number,dy:number,dz:number,sx:number,sy:number,sz:number,c:string,shadow=true)=>{
      const rx=rotation===1?-dz:rotation===2?-dx:rotation===3?dz:dx;
      const rz=rotation===1?dx:rotation===2?-dz:rotation===3?-dx:dz;
      parts.push({p:[x+rx*scale,y+dy*scale,z+rz*scale],
        s:rotation%2?[sz*scale,sy*scale,sx*scale]:[sx*scale,sy*scale,sz*scale],c:ghost?'blueprint':c,shadow:ghost?false:shadow});
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
      case 'chest':
        part(0,.28,0,.86,.56,.72,'wood');part(0,.60,0,.9,.12,.76,'dark');part(0,.30,.37,.18,.2,.06,'steel');break;
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
    return parts;
  }

  update(state:ColonyRenderState,time:number){
    const active=new Set<string>();
    // 云影：真云在天上，靠引擎的方向光阴影投到地面。
    // 不再画贴地的半透明平板——那样看起来是雾，不是影子。
    this.renderClouds(time,active);
    for(const [i,resident] of state.colonists.entries()){
      const key='居民/'+resident.id;
      active.add(key);
      if(resident.id===state.controlledColonistId)continue;
      const old=this.pawnPositions.get(resident.id);
      const moving=!!old&&Math.hypot(resident.position[0]-old[0],resident.position[2]-old[2])>.003;
      this.drawResident(resident,i,time,moving,resident.id===state.selectedColonistId,false);
    }
    for(const b of state.buildPreview?[...state.buildings,state.buildPreview]:state.buildings){
      // Completed walls are composed by the shared semantic voxel renderer.
      if(b.complete&&b.kind==='wall'&&b.id!=='placement-preview')continue;
      const w=b.w??1,d=b.d??1,h=b.h??1,x=b.x+w/2,y=b.y,z=b.z+d/2,rotation=b.rotation??0;
      const parts=this.buildingGeometry(b);
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
    // 2.5D 卡片接管之后，方块只画翻好的土，植株交给 CropCards
    this.cropCards?.update(state.crops);
    for(const p of state.crops){
      const x=p.x+.5,y=p.y,z=p.z+.5;
      const parts:Part[]=[{p:[x,y+FARM_SOIL_HEIGHT/2,z],s:[.84,FARM_SOIL_HEIGHT,.84],c:'soil',shadow:false}];
      if(!this.cropCards?.hasModel(p.kind)&&p.planted!==false){
        const g=Math.max(.01,Math.min(1,p.growth));
        for(const [dx,dz]of[[-.22,-.2],[.22,-.2],[-.22,.2],[.22,.2]]){
          parts.push({p:[x+dx,y+.12+g*.3,z+dz],s:[.08,.2+g*.6,.08],c:'green'});
          if(g>.2)parts.push({p:[x+dx,y+.25+g*.42,z+dz],s:[.22,.14+g*.13,.18],c:g>.8?'gold':'green'});
        }
      }
      this.put(`作物/${p.id??`${p.x},${p.z}`}`,parts,active);
    }
    for(const item of state.items){
      if(item.amount<=0)continue;const scale=.2+Math.min(.38,Math.cbrt(item.amount)*.07);
      // 掉落动画（我的世界那种）：掉出来的一瞬间往上弹一下再落回去。
      // age 就是「存在了多久」，0.45 秒后弹跳结束；正好和「0.5 秒后才能捡」对上，
      // 所以看得见它弹，而不是刚出现就没了。
      const age=item.age??99; const POP=0.45, t=Math.min(age,POP), k=t/POP;
      let hash = 0;
      for (let i = 0; i < item.id.length; i++) hash = (hash * 31 + item.id.charCodeAt(i)) | 0;
      const phase = ((hash >>> 0) * 2.399963229728653) % (2 * Math.PI);
      const spread = item.scatter ? .42 * k : .42 * (1 - k);
      const bounce = Math.sin(k * Math.PI) * .6;
      const bob = (.085 + Math.sin(time * 3.2 + phase) * .045) * k;
      const x = item.x + .5 + Math.cos(phase) * spread;
      const y = item.y + bounce + bob;
      const z = item.z + .5 + Math.sin(phase) * spread;
      const yaw = time * 1.5 + phase;
      const rotation: Rotation = [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];
      const key = `物资/${item.id}`;
      const buildingKind = buildingItemKind(item.resource);
      if (buildingKind) {
        const dimensions = buildingDimensions(buildingKind);
        const miniature = { id: item.id, kind: buildingKind, x: x - dimensions.w / 2, y: y + .02,
          z: z - dimensions.d / 2, ...dimensions, complete: true, progress: 1 };
        const parts = this.buildingGeometry(miniature, .56 / Math.max(dimensions.w, dimensions.h, dimensions.d));
        const cos = Math.cos(yaw), sin = Math.sin(yaw);
        for (const part of parts) {
          const dx = part.p[0] - x, dz = part.p[2] - z;
          part.p[0] = x + dx * cos + dz * sin;
          part.p[2] = z - dx * sin + dz * cos;
        }
        this.put(key, parts, active, '', rotation);
      } else {
        const mesh = this.cropCards?.itemMesh(item.resource);
        const p: V3 = [x, y + scale / 2, z], s: V3 = [scale, scale, scale];
        const part: Part = mesh ? { p, s, mesh } : { p, s, c: isCropSeed(item.resource) ? 'seedPack' : COLORS[item.resource] ? item.resource : 'gold' };
        this.put(key, [part], active, '', rotation);
      }
    }
    for(const [key,g]of this.groups)if(!active.has(key)){for(const e of g.entities)this.world.despawn(e).unwrap();this.groups.delete(key);}
  }
  dispose(){for(const g of this.groups.values())for(const e of g.entities)this.world.despawn(e).unwrap();this.groups.clear();for(const m of this.materials.values())this.assets.release(m).unwrap();this.materials.clear();this.assets.release(this.cube).unwrap();}

  drawResident(resident:RenderPawn,index:number,time:number,moving:boolean,selected:boolean,controlled:boolean){
    const [x,y,z]=resident.position, facing=resident.facing??0;
    this.pawnPositions.set(resident.id,resident.position);
    const swing=moving?Math.sin(time*11+index)*.09:0;
    const cos=Math.cos(facing),sin=Math.sin(facing);
    const at=(dx:number,dy:number,dz:number):V3=>[x+dx*cos+dz*sin,y+dy,z-dx*sin+dz*cos];
    const parts:Part[]=[
      {p:at(-.13,.22+swing,0),s:[.18,.44,.24],c:'dark'}, {p:at(.13,.22-swing,0),s:[.18,.44,.24],c:'dark'},
      {p:at(0,.69,0),s:[.5,.55,.3],c:'shirt'+index%4}, {p:at(0,1.12,0),s:[.4,.4,.37],c:'skin'},
      {p:at(0,1.34,-.02),s:[.43,.12,.4],c:'hair'},
      {p:at(-.1,1.14,.19),s:[.045,.055,.025],c:'black'}, {p:at(.1,1.14,.19),s:[.045,.055,.025],c:'black'},
      {p:at(-.32,.65-swing,0),s:[.13,.43,.19],c:'skin'}, {p:at(.32,.65+swing,0),s:[.13,.43,.19],c:'skin'},
    ];
    const held = controlled ? resident.bag?.[resident.bagSelected ?? 0]?.resource : undefined;
    const heldMesh = held && this.cropCards?.itemMesh(held);
    if (heldMesh) parts.push({ p: at(.48, .6 + swing, .12), s: [.43, .43, .43], mesh: heldMesh, shadow: false });

    const carried = Object.entries(resident.carrying ?? {}).find(([, amount]) => (amount ?? 0) > 0);
    if (carried && !heldMesh) {
      const mesh = this.cropCards?.itemMesh(carried[0]);
      const p = at(0, .7, .37);
      parts.push(mesh ? { p, s: [.42, .42, .42], mesh } : { p, s: [.42, .35, .3], c: COLORS[carried[0]] ? carried[0] : 'wood' });
    }
    if(selected)parts.push({p:at(0,.025,0),s:[.94,.045,.94],c:'selected',shadow:false});
    if(controlled)parts.push({p:at(0,1.9,0),s:[.19,.19,.19],c:'playerMark',shadow:false});
    if(resident.health<80)parts.push({p:at(0,1.65,0),s:[.65*Math.max(.05,resident.health/100),.07,.07],c:resident.health>35?'health':'bad',shadow:false});
    this.put('居民/'+resident.id,parts,undefined,'',[0,Math.sin(facing/2),0,Math.cos(facing/2)]);
  }
}
