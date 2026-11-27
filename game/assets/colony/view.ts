import { sugarPressParts } from './sugar-press.ts';
import { containsCell, footprintCells, type Footprint } from './zone-cells.ts';
import type { World, EntityHandle } from '@forgeax/engine/ecs';
import type { AssetRegistry } from '@forgeax/engine/assets-runtime';
import { createBoxGeometry } from '@forgeax/engine/geometry';
import { Materials, MeshFilter, MeshRenderer, ShadowParticipation } from '@forgeax/engine/render';
import { Name, Transform } from '@forgeax/engine/scene';
import { RenderQueue, type AssetHandle } from '@forgeax/engine/types';
import { CharacterView, residentOutfit, type CharacterAssets } from './character-view.ts';
import { FARM_SOIL_HEIGHT, type CropCards } from './crop-cards.ts';
import type { VoxelWorld } from '../voxel/model.ts';
import type { WallPanel } from '../voxel/pcg/facade.ts';
import { WALL_HEIGHT } from '../voxel/pcg/rules.ts';
import { BUILDING_DEFS, STORAGE_QUARTERS, buildingItemKind, isCropSeed, type BuildingKind, type CropKind, type PlayerInventorySlot, type StoredStack } from './contracts.ts';
import { buildingDimensions } from './buildings.ts';
import textileModels from './textile-models.json';
import { cardLayers, isWarehouseCard, packageSize, warehouseSlotContents } from './warehouse.ts';
import { PLAZA_LAYERS, plazaPoint, smooth } from './plaza.ts';
import type { FinaleView, MerchantHousing, MerchantId } from './contracts.ts';
import { PointLight } from '@forgeax/engine/render';

type V3=[number,number,number];
type Rotation=[number,number,number,number];
const IDENTITY:Rotation=[0,0,0,1];
export type BuildingModel = { mesh: AssetHandle<'mesh'>; scale: V3 };
type Part = { p: V3; s: V3; shadow?: boolean; rotation?: Rotation } &
  ({ c: string; mesh?: undefined } | { mesh: AssetHandle<'mesh'>; c?: undefined });
type RenderPawn={id:string;name:string;position:V3;health:number;facing?:number;task?:string;job?:string;bag?:readonly PlayerInventorySlot[];bagSelected?:number;carrying?:Partial<Record<string,number>>};
type RenderBuilding={id:string;kind:string;x:number;y:number;z:number;w?:number;d?:number;h?:number;rotation?:number;doorOpen?:boolean;complete:boolean;progress:number;powered?:boolean;phase?:string};
export type ColonyRenderState={
  merchants?: readonly MerchantHousing[];
  colonists:RenderPawn[]; buildings:RenderBuilding[]; finale?:FinaleView;
  zones:({id:string;kind:string} & Footprint)[];
  crops:{id?:string;x:number;y:number;z:number;growth:number;kind?:CropKind;planted?:boolean}[];
  items:{id:string;resource:string;amount:number;x:number;y:number;z:number;age?:number;scatter?:boolean}[];
  warehouseStacks:StoredStack[];
  selectedColonistId?:string|null;
  selectedBuildingId?:string|null;
  buildPreview?:RenderBuilding|null;
  showPlanningGrid?:boolean;
  controlledColonistId?:string|null;
};
const COLORS:Record<string,string>={
  wood:'#a97943',plank:'#c6995c',stoneBrick:'#8c928b',pigIron:'#684f4b',dirt:'#845a3a',stone:'#9ca9a5',steel:'#899fae',food:'#e4bc63',meal:'#d4834b',medicine:'#ecf4dd',cloth:'#c2b3d9',silver:'#e5d69b',components:'#d0ad45',
  dark:'#2e4247',cream:'#f0ddba',blanket:'#568b9b',white:'#fff3d5',green:'#63935e',gold:'#e5c66f',blue:'#4d7d96',black:'#233135',
  light:'#c5e4cd',soil:'#7e563b',
  blueprint:'#75cece',zonePasture:'#d8ad69',zoneFarm:'#90bd65',zoneStock:'#75baca',selected:'#ecd78c',health:'#9fc174',bad:'#c56b55',
  playerMark:'#ffd76e', seedPack:'#ba955c', luggageStrap:'#473327', luggageTrim:'#987044',
};
const rgba=(hex:string):[number,number,number,number]=>{
  const n=parseInt(hex.slice(1),16);const f=(v:number)=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4;
  return [f(((n>>16)&255)/255),f(((n>>8)&255)/255),f((n&255)/255),1];
};
// Tops of the three shelf boards in the authored mesh, from bottom to top.
const SHELF_BOARD_HEIGHTS = [.25,.80,1.35] as const;
const shelfFit = (w:number,d:number) => Math.max(w,d) === 1 ? 1/1.8 : 1;

/** Native meshes only. The simulation remains the authority; this layer never changes it. */
export class ColonyView {
  private cube:AssetHandle<'mesh'>;
  private materials=new Map<string,AssetHandle<'material'>>();
  private groups=new Map<string,{signature:string;entities:EntityHandle[];transforms:number[][]}>();
  private residents = new Map<string, CharacterView>();
  private merchants = new Map<MerchantId, CharacterView>();
  private plazaLights=new Map<string,EntityHandle[]>();
  constructor(private world:World, private assets:AssetRegistry, private terrain:()=>VoxelWorld,
    private characters:readonly CharacterAssets[], private readonly cropCards:Pick<CropCards,'update'|'hasModel'|'itemMesh'|'itemModel'>,
    private readonly buildingModels:ReadonlyMap<string,BuildingModel>, private readonly windowedWalls:ReadonlyMap<string,WallPanel[]>,
    private readonly plazaMeshes:ReadonlyMap<string,AssetHandle<'mesh'>>){
    this.cube=assets.create(createBoxGeometry(1,1,1).unwrap()).unwrap();
  }
  private material(key:string):AssetHandle<'material'>{
    const existing=this.materials.get(key);if(existing)return existing;
    const cloudKeys=['cloudHigh','cloudHigh2'];
    const translucent=['blueprint','zonePasture','zoneFarm','zoneStock','selected'].includes(key);
    const c=cloudKeys.includes(key)?[0.93,0.95,0.97,1] as [number,number,number,number]:rgba(COLORS[key]??key);
    if (key.startsWith('glow:')) {
      const glow=this.assets.create(Materials.unlit(rgba(key.slice(5)))).unwrap();
      this.materials.set(key,glow);return glow;
    }
    if(translucent)c[3]=key==='blueprint'?.35:.28;
    const value=translucent?Materials.unlit(c,{queue:RenderQueue.Transparent,renderState:{depthWriteEnabled:false,cullMode:'none',blend:{color:{srcFactor:'src-alpha',dstFactor:'one-minus-src-alpha',operation:'add'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'}}}}):Materials.standard({baseColor:c,roughness:.86,metallic:key==='steel'?.3:0});
    const handle=this.assets.create(value).unwrap();this.materials.set(key,handle);return handle;
  }
  private put(key:string,parts:Part[],active?:Set<string>,signature='',rotation=IDENTITY){
    active?.add(key);let group=this.groups.get(key);
    const sig=signature||parts.map(p=>p.mesh??p.c).join('|');
    if(group&&(group.signature!==sig||group.entities.length!==parts.length)){for(const e of group.entities)this.world.despawn(e).unwrap();this.groups.delete(key);group=undefined;}
    if(!group){
      group={signature:sig,transforms:parts.map(p=>[...p.p,...p.s,...(p.rotation??rotation)]),entities:parts.map((p,i)=>this.world.spawn(
        {component:Name,data:{value:`${key}/${i}`}},{component:Transform,data:{pos:p.p,scale:p.s,quat:p.rotation??rotation}},
        {component:MeshFilter,data:{assetHandle:p.mesh??this.cube}},{component:MeshRenderer,data:{materials:p.mesh===undefined?[this.material(p.c)]:[]}},
        {component:ShadowParticipation,data:{cast:p.shadow!==false,receive:true}},
      ).unwrap())};this.groups.set(key,group);
    }else for(let i=0;i<parts.length;i++){
      const p=parts[i]!,q=p.rotation??rotation,next=[...p.p,...p.s,...q];
      if(next.some((n,j)=>n!==group!.transforms[i]![j])){this.world.set(group.entities[i]!,Transform,{pos:p.p,scale:p.s,quat:q}).unwrap();group.transforms[i]=next;}
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
    if (b.kind==='campfirePlaza') {
      const q:Rotation=[0,Math.sin(-rotation*Math.PI/4),0,Math.cos(-rotation*Math.PI/4)];
      for (const [layer,at] of PLAZA_LAYERS) if (ghost || b.complete || b.progress>=at) {
        parts.push({mesh:this.plazaMeshes.get(layer)!,p:[x,y+.065*scale,z],s:[scale,scale,scale],rotation:rotation ? q : undefined,shadow:!ghost});
      }
      if (!b.complete && !ghost) {
        parts.push({p:[x,y+.031,z],s:[w,.055,d],c:'blueprint',shadow:false});
      }
      return parts;
    }
    const model=this.buildingModels.get(b.kind==='door'&&b.doorOpen?'doorOpen':b.kind);
    if(model && (b.complete || ghost) && !(b.kind==='stoneDoor' && b.doorOpen)){
      const angle=-rotation*Math.PI/4;
      const q:Rotation|undefined=rotation ? [0,Math.sin(angle),0,Math.cos(angle)] : undefined;
      const body={mesh:model.mesh,rotation:q,shadow:!ghost};
      if(b.kind==='wall'){
        const panels=this.windowedWalls.get(b.id) ?? [{min:[b.x,y,b.z],max:[b.x+w,y+WALL_HEIGHT,b.z+d]}];
        for(const {min,max} of panels){
          const width=(max[0]!-min[0]!)*scale,depth=(max[2]!-min[2]!)*scale;
          parts.push({...body,p:[x+((min[0]!+max[0]!)/2-x)*scale,y+(min[1]!-y)*scale,z+((min[2]!+max[2]!)/2-z)*scale],
            s:[rotation%2?depth:width,(max[1]!-min[1]!)*scale,rotation%2?width:depth]});
        }
      }else{
        const [sx,sy,sz]=model.scale;
        const fit=scale*(b.kind==='shelf' ? shelfFit(w,d) : 1);
        parts.push({...body,p:[x,y,z],s:[sx*fit,sy*fit,sz*fit]});
      }
      return parts;
    }
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
      case 'sugarPress':
        for (const box of sugarPressParts) part(...box);
        break;
      case 'stoneDoor':
        if(b.doorOpen) part(-.42,h/2,0,.14,h,.85,'stone');
        else part(0,h/2,0,.86,h,.16,'stone');
        break;
      case 'pastureGate':
        for(const dx of [-.43,.43]) part(dx,.4,0,.12,.8,.14,'wood');
        part(0,.85,0,.96,.1,.14,'wood'); break;
      case 'milker':
        part(0,.2,0,.7,.4,.65,'steel');part(-.18,.57,0,.2,.45,.25,'steel');part(.15,.53,0,.28,.25,.34,'white');break;
      case 'henNest':
        part(0,.12,0,.85,.24,.8,'gold');for(const dx of [-.38,.38])part(dx,.25,0,.1,.35,.8,'wood');
        part(0,.29,-.34,.8,.42,.1,'wood'); break;
      case 'shearingStand':
      case 'loom':
        for(const {center:[dx,dy,dz],size:[sx,sy,sz],color} of textileModels[b.kind]){
          part(dx,dy,dz,sx,sy,sz,color);
        }
        break;
      case 'flourMill':
        // Timber bed, two stepped millstones and an offset wooden crank.
        part(0,.19,0,1.66,.38,.76,'wood');
        for (const [dy,width,color] of [[.47,.85,'#746e61'],[.65,.79,'#aca697']] as const) {
          part(-.25,dy,0,width,.16,.55,color);
          for (const dz of [-.33,.33]) part(-.25,dy,dz,width*.68,.16,.11,color);
        }
        part(-.25,.77,0,.12,.12,.12,'dark');
        part(.02,.82,0,.66,.09,.10,'wood');
        part(.30,.92,0,.10,.19,.10,'wood');
        break;
      case 'floor':part(0,.025,0,.98,.05,.98,'wood');break;
      case 'solar':case 'solarPanel':part(0,.4,0,.18,.8,.18,'steel');part(0,.88,0,1.45,.11,1.25,'dark');part(0,.96,0,1.33,.04,1.13,'blue');part(0,.99,0,.035,.015,1.13,'steel');part(0,.99,0,1.33,.015,.035,'steel');break;
      case 'battery':part(0,.45,0,.7,.9,.7,'dark');part(0,.5,.36,.45,.55,.035,'green');part(-.18,.95,0,.12,.1,.15,'gold');part(.18,.95,0,.12,.1,.15,'steel');break;
      case 'cooler':case 'fridge':case 'freezer':part(0,.65,0,.85,1.3,.85,'white');part(0,.75,.44,.71,.95,.04,'blanket');part(.26,.75,.49,.06,.35,.04,'steel');break;
      default:{
        // 没有对应模型的设施继续使用建造目录中的颜色。
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
  private drawStoredStack(contents:StoredStack[],shelf:RenderBuilding|undefined,active:Set<string>):void {
    const stack=contents[0]!;
    const fit=shelf ? shelfFit(shelf.w??1,shelf.d??1) : 1;
    const yaw=-(shelf?.rotation??0)*Math.PI/2;
    const sin=Math.sin(yaw/2), cos=Math.cos(yaw/2);
    const rotation:Rotation=[0,sin,0,cos];
    const quarter=stack.slot%STORAGE_QUARTERS, size=packageSize(stack.resource);
    const bayWidth=(shelf ? .76 : 1)*fit, bayDepth=(shelf ? .68 : 1)*fit;
    const width=bayWidth*(size===1 ? .5 : 1);
    const depth=bayDepth*(size===4 ? 1 : .5);
    let offsetX=quarter%2===0 ? -bayWidth/2+width/2 : bayWidth/4;
    let offsetZ=quarter<2 ? -bayDepth/2+depth/2 : bayDepth/4;
    let x=stack.x+.5,z=stack.z+.5,y=this.terrain().terrainHeight(stack.x,stack.z);
    let key=`仓储地堆/${stack.x},${stack.z}/${stack.slot}`;
    if (shelf) {
      const bay=Math.floor(stack.slot/STORAGE_QUARTERS);
      offsetX+=(bay%2===0 ? -.42 : .42)*fit;
      x=shelf.x+(shelf.w??1)/2;
      z=shelf.z+(shelf.d??1)/2;
      y=shelf.y+SHELF_BOARD_HEIGHTS[Math.floor(bay/2)]!*fit;
      key=`货架物资/${shelf.id}/${stack.slot}`;
    }
    const at=(dx:number,dy:number,dz:number):V3 => [
      x+(offsetX+dx)*Math.cos(yaw)+(offsetZ+dz)*Math.sin(yaw),
      y+dy,
      z-(offsetX+dx)*Math.sin(yaw)+(offsetZ+dz)*Math.cos(yaw),
    ];
    const parts:Part[]=[];
    const box=(dx:number,dy:number,dz:number,w:number,h:number,d:number,c:string) =>
      parts.push({p:at(dx,dy,dz),s:[w,h,d],c});

    if (isWarehouseCard(stack.resource)) {
      const cards=[...contents].sort((a,b) => b.count-a.count);
      const layers=cardLayers(contents.reduce((total,item) => total+item.count,0));
      const cardSize=width*.91;
      for (let layer=0;layer<layers;layer++) {
        const model=this.cropCards.itemModel(cards[layer%cards.length]!.resource);
        const height=-(model?.bottom??-.5)*cardSize;
        const offset=layer-(layers-1)/2;
        const dx=offset*width*.025, dz=offset*depth*.155;
        if (model) parts.push({p:at(dx,height,dz),s:[cardSize,cardSize,cardSize],mesh:model.mesh});
        else box(dx,height,dz,cardSize,cardSize,.012*fit,'cream');
      }
    } else {
      const w=width*.90, d=depth*.90;
      const height=(size===4 ? shelf ? .37 : .55 : size===2 ? .31 : .22)*fit;
      const color=COLORS[stack.resource] ? stack.resource : 'gold';
      box(0,height/2,0,w,height,d,color);
      box(0,height*.73,0,w*1.025,.022*fit,d*1.025,'luggageTrim');
      for (const side of [-1,1]) {
        box(side*w*.29,height+.005*fit,0,w*.10,.018*fit,d*1.03,'luggageStrap');
        box(side*w*.29,height*.50,d*.515,w*.10,height,.02*fit,'luggageStrap');
      }
      box(0,height+.035*fit,0,w*.24,.032*fit,d*.15,'luggageStrap');
    }
    this.put(key,parts,active,`${stack.resource}:${parts.map(part=>part.mesh??part.c).join('|')}`,rotation);
  }

  private plazaEffects(b:RenderBuilding, clock:number, finale:FinaleView|undefined, active:Set<string>){
    const site={x:b.x,y:b.y+.065,z:b.z,w:b.w!,d:b.d!,rotation:(b.rotation??0) as 0|1|2|3};
    const turn=-site.rotation*Math.PI/4, rotation:Rotation=[0,Math.sin(turn),0,Math.cos(turn)];
    const at=(x:number,y:number,z:number)=>plazaPoint(site,x,y,z);
    const mesh=(layer:string,x=0,y=0,z=0,sy=1):Part=>({
      mesh:this.plazaMeshes.get(layer)!,p:at(x,y,z),rotation,s:[1,sy,1],shadow:false,
    });
    const parts:Part[]=[mesh('flames',0,0,0,1+.12*Math.sin(clock*6)+.055*Math.sin(clock*13))];
    const t=finale?.phase==='show' ? finale.elapsed : -1;
    if (finale && finale.phase!=='departing' && (finale.phase==='show' || finale.elapsed>=3)) {
      parts.push(mesh('sky'));
      if (t>=1.4) parts.push(mesh('title',0,-3.8*(1-smooth((t-1.4)/3.6)),0));
      if (t>=9.9 && t<11.2) {
        const travel=(t-10.5)/1.3;
        parts.push(mesh('meteor',-travel*24,-travel*6,0));
      }
    }
    this.put('晚会布景/'+b.id,parts,active);
    // Fixed-size emitter pools give each spark a repeatable lifetime without
    // allocating new entities on every respawn.
    const sparks:Part[]=[];
    for(let i=0;i<24;i++){
      const life=(clock*.69+i*.618034)%1, a=i*2.39996+life*.7, r=.2+life*(.28+(i%5)*.08);
      const size=.085*(1-life*.66);
      sparks.push({p:at(r*Math.cos(a),.9+2.6*life,r*Math.sin(a)),s:[size,size,size],
        c:i%3?'glow:#ffb649':'glow:#ffe59a',shadow:false});
    }
    this.put('篝火火星/'+b.id,sparks,active);
    if (t>=0 && t<12) {
      const ribbons:Part[]=[];
      const colors=['glow:#df7989','glow:#65c7ce','glow:#f1be72','glow:#ab90d6'];
      for(let i=0;i<96;i++){
        const age=t-(i%36)*.19, life=Math.max(0,age)%4.8/4.8;
        const size=.12;
        const visible=age>=0 && age-life*4.8+(i%36)*.19<7;
        const a=i*2.39996+life*4;
        ribbons.push({p:at(((i*47)%97)/97*23-11.5+Math.sin(a)*.46,8.4*(1-life)+.2,((i*37)%89)/89*18-9+Math.cos(a)*.36),
          s:[visible?size:0,visible?size*1.6:0,visible?size*.64:0],c:colors[i%4]!,shadow:false});
      }
      this.put('晚会彩带/'+b.id,ribbons,active);
    }
    let lights=this.plazaLights.get(b.id);
    if (!lights) {
      lights=[[0,2.6,0],[-7.7,2,0],[7.7,2,0]].map(([x,y,z],i)=>this.world.spawn(
        {component:Name,data:{value:'篝火晚会暖光/'+i}},{component:Transform,data:{pos:at(x,y,z)}},
        {component:PointLight,data:{color:[1,.48,.2],intensity:i?12:85,range:i?6:13}}).unwrap());
      this.plazaLights.set(b.id,lights);
    }
    this.world.set(lights[0]!,PointLight,{intensity:86+12*Math.sin(clock*5.7)}).unwrap();
  }

  update(state:ColonyRenderState,time:number){
    const active=new Set<string>();
    if (!state.finale) this.renderClouds(time, active);
    for (const [id,lights] of this.plazaLights) if (!state.buildings.some(b=>b.id===id && b.complete)) {
      for (const e of lights) this.world.despawn(e).unwrap();
      this.plazaLights.delete(id);
    }
    const present = new Set(state.colonists.map(resident => resident.id));
    for (const [id, actor] of this.merchants) if (!state.merchants?.some(m=>m.npcId===id)) {
      actor.dispose();
      this.merchants.delete(id);
    }
    for (const {npcId:id, position} of state.merchants ?? []) {
      let actor = this.merchants.get(id);
      if (!actor) {
        const outfit = {guide:0, chef:1, tailor:2, cheesemaker:3, blacksmith:4}[id] % this.characters.length;
        actor = new CharacterView(this.world, this.assets, this.characters[outfit]!, outfit+1);
        this.merchants.set(id, actor);
      }
      actor.updateResident(position, time, Math.PI/4);
      const [x,y,z]=position, a=actor.facing;
      const prop=(dx:number,dy:number,dz:number,s:V3,c:string):Part=>({
        p:[x+dx*Math.cos(a)+dz*Math.sin(a),y+dy,z-dx*Math.sin(a)+dz*Math.cos(a)],
        s,c,rotation:[0,Math.sin(a/2),0,Math.cos(a/2)],
      });
      const pieces:Part[]=[];
      if (id==='chef') pieces.push(prop(0,1.77,0,[.46,.23,.43],'white'),prop(0,1.94,0,[.61,.22,.51],'white'));
      if (id==='tailor') pieces.push(prop(.34,.94,.09,[.28,.47,.28],'#a15e92'),
        prop(.34,1.19,.09,[.36,.06,.36],'cream'),prop(.34,.69,.09,[.36,.06,.36],'cream'));
      if (id==='cheesemaker') pieces.push(prop(0,1.76,0,[.68,.09,.60],'gold'),prop(0,1.86,0,[.40,.16,.37],'cream'),
        prop(.36,.82,.1,[.32,.24,.32],'#f1b745'));
      if (id==='blacksmith') pieces.push(prop(.38,1,.08,[.10,.65,.11],'luggageTrim'),prop(.38,1.34,.08,[.49,.26,.26],'steel'));
      if (id==='guide') pieces.push(prop(0,1.04,-.22,[.49,.60,.30],'luggageTrim'),prop(0,1.29,-.24,[.52,.10,.33],'gold'));
      this.put('商人/'+id,pieces,active);
    }
    for (const [id, actor] of this.residents) if (!present.has(id)) {
      actor.dispose();
      this.residents.delete(id);
    }
    for (const resident of state.colonists) {
      active.add('居民/' + resident.id);
      if (resident.id !== state.controlledColonistId) {
        this.drawResident(resident, time, !state.finale && resident.id === state.selectedColonistId);
      }
    }
    const penBorders=new Set(state.buildings.filter(b=>b.kind==='fence'||b.kind==='pastureGate').map(b=>b.x+','+b.z));
    for(const b of state.buildPreview?[...state.buildings,state.buildPreview]:state.buildings){
      const w=b.w??1,d=b.d??1,h=b.h??1,x=b.x+w/2,y=b.y,z=b.z+d/2,rotation=b.rotation??0;
      let parts=this.buildingGeometry(b);
      let fenceNeighbors='';
      if(b.kind==='fence'&&b.complete&&state.zones.some(z=>z.kind==='pasture'&&containsCell(z,b.x,b.z))){
        parts=[{p:[x,y+.4,z],s:[.14,.8,.14],c:'wood'}];
        for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]){
          if(!penBorders.has((b.x+dx!)+','+(b.z+dz!)))continue;
          fenceNeighbors+=dx+','+dz+';';
          for(const dy of [.28,.60])parts.push({p:[x+dx!*.25,y+dy,z+dz!*.25],s:[dx ? .50:.095,.095,dz ? .50:.095],c:'wood'});
        }
      }
      if (b.kind==='campfirePlaza' && b.complete && b.id!=='placement-preview') {
        this.plazaEffects(b,time,state.finale?.buildingId===b.id ? state.finale : undefined,active);
      }
      if(state.selectedBuildingId===b.id)parts.push({p:[x,y+.025,z],s:[w+.04,.045,d+.04],c:'selected',shadow:false});
      this.put(`设施/${b.id}`,parts,active,`${b.kind}:${fenceNeighbors}:${b.complete}:${b.powered}:${b.phase}:${w}:${d}:${h}:${rotation}:${b.doorOpen}:${state.selectedBuildingId===b.id}`);
    }
    const plannedCells = new Set<string>();
    for(const zone of state.showPlanningGrid ? state.zones : []){
      const parts:Part[]=[];
      for(const [x,z] of footprintCells(zone)){
        const key=`${x},${z}`;
        if(plannedCells.has(key))continue;
        plannedCells.add(key);
        const y=this.terrain().terrainHeight(x,z);
        parts.push({p:[x+.5,y+.026,z+.5],s:[.94,.045,.94],c:zone.kind==='pasture'?'zonePasture':zone.kind==='farm'?'zoneFarm':'zoneStock',shadow:false});
      }
      this.put(`区域/${zone.id}`,parts,active);
    }
    // 2.5D 卡片接管之后，方块只画翻好的土，植株交给 CropCards
    this.cropCards.update(state.crops);
    for(const p of state.crops){
      const x=p.x+.5,y=p.y,z=p.z+.5;
      const parts:Part[]=[{p:[x,y+FARM_SOIL_HEIGHT/2,z],s:[.84,FARM_SOIL_HEIGHT,.84],c:'soil',shadow:false}];
      if(!this.cropCards.hasModel(p.kind)&&p.planted!==false){
        const g=Math.max(.01,Math.min(1,p.growth));
        for(const [dx,dz]of[[-.22,-.2],[.22,-.2],[-.22,.2],[.22,.2]]){
          parts.push({p:[x+dx,y+.12+g*.3,z+dz],s:[.08,.2+g*.6,.08],c:'green'});
          if(g>.2)parts.push({p:[x+dx,y+.25+g*.42,z+dz],s:[.22,.14+g*.13,.18],c:g>.8?'gold':'green'});
        }
      }
      this.put(`作物/${p.id??`${p.x},${p.z}`}`,parts,active);
    }
    const shelves=new Map(state.buildings.filter(b=>b.kind==='shelf'&&b.complete).map(b=>[b.id,b]));
    for (const contents of warehouseSlotContents(state.warehouseStacks).values()) {
      const stack=contents[0]!;
      const shelf=stack.shelfId ? shelves.get(stack.shelfId) : undefined;
      if (!stack.shelfId || shelf) this.drawStoredStack(contents,shelf,active);
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
        const mesh = this.cropCards.itemMesh(item.resource);
        const p: V3 = [x, y + scale / 2, z], s: V3 = [scale, scale, scale];
        const part: Part = mesh ? { p, s, mesh } : { p, s, c: isCropSeed(item.resource) ? 'seedPack' : COLORS[item.resource] ? item.resource : 'gold' };
        this.put(key, [part], active, '', rotation);
      }
    }
    for(const [key,g]of this.groups)if(!active.has(key)){for(const e of g.entities)this.world.despawn(e).unwrap();this.groups.delete(key);}
  }
  dispose(){
    for (const actor of this.merchants.values()) actor.dispose();
    this.merchants.clear();
    for (const lights of this.plazaLights.values()) for (const e of lights) this.world.despawn(e).unwrap();
    this.plazaLights.clear();
    for (const actor of this.residents.values()) actor.dispose();
    this.residents.clear();
    for (const group of this.groups.values()) for (const entity of group.entities) this.world.despawn(entity).unwrap();
    this.groups.clear();
    for (const material of this.materials.values()) this.assets.release(material).unwrap();
    this.materials.clear();
    this.assets.release(this.cube).unwrap();
  }

  drawResident(resident:RenderPawn, time:number, selected:boolean, control?:{ moving:boolean; grounded:boolean }) {
    let actor = this.residents.get(resident.id);
    if (!actor) {
      const outfit = residentOutfit(resident.id, this.characters.length);
      actor = new CharacterView(this.world, this.assets, this.characters[outfit - 1]!, outfit);
      this.residents.set(resident.id, actor);
    }
    if (control) actor.updatePlayer(resident.position, resident.facing ?? 0, control.moving && control.grounded);
    else actor.updateResident(resident.position, time, resident.facing ?? 0);

    if (!control && resident.task==='围坐篝火旁') actor.update(resident.position,resident.facing??0,-1);
    const [x,y,z] = resident.position, {facing, attachmentScale:scale} = actor;
    const cos = Math.cos(facing), sin = Math.sin(facing);
    const at = (dx:number, dy:number, dz:number):V3 =>
      [x+(dx*cos+dz*sin)*scale, y+dy*scale, z+(-dx*sin+dz*cos)*scale];
    const parts:Part[] = [];
    const held = control ? resident.bag?.[resident.bagSelected ?? 0]?.resource : undefined;
    const heldMesh = held && this.cropCards.itemMesh(held);
    if (heldMesh) parts.push({p:at(.48,.8,.12), s:[.43*scale,.43*scale,.43*scale], mesh:heldMesh, shadow:false});
    const carried = Object.entries(resident.carrying ?? {}).find(([, amount]) => (amount ?? 0) > 0);
    if (carried && !heldMesh) {
      const mesh = this.cropCards.itemMesh(carried[0]);
      const p = at(0,.87,.45);
      parts.push(mesh ? {p,s:[.42*scale,.42*scale,.42*scale],mesh} :
        {p,s:[.42*scale,.35*scale,.3*scale],c:COLORS[carried[0]] ? carried[0] : 'wood'});
    }
    if(selected)parts.push({p:at(0,.025,0),s:[.94,.045,.94],c:'selected',shadow:false});
    if(control)parts.push({p:at(0,2.08,0),s:[.19,.19,.19],c:'playerMark',shadow:false});
    if(resident.health<80)parts.push({p:at(0,1.95,0),s:[.65*Math.max(.05,resident.health/100),.07,.07],c:resident.health>35?'health':'bad',shadow:false});
    this.put('居民/'+resident.id,parts,undefined,'',[0,Math.sin(facing/2),0,Math.cos(facing/2)]);
  }
  readCharacters(controlledId:string|null) {
    const residents = [...this.residents].map(([id, actor]) => ({id, ...actor.read()}));
    const merchants = [...this.merchants].map(([id, actor])=>({id,position:actor.position,...actor.read()}));
    return { residents, merchants, player: residents.find(resident => resident.id === controlledId) ?? null };
  }
  readPlacementPreview() {
    const transform = this.groups.get('设施/placement-preview')?.transforms[0];
    return transform ? {position:transform.slice(0,3), scale:transform.slice(3,6), rotation:transform.slice(6)} : null;
  }
}
