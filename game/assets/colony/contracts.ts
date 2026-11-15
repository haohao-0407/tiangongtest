export type Position = [number, number, number];
export const RESOURCE_TYPES = ['wood','stone','steel','food','meal','medicine','cloth','silver','components'] as const;
export type Resource = typeof RESOURCE_TYPES[number];
export type Resources = Record<Resource, number>;
export const PLAYER_SLOTS = 9, CHEST_SLOTS = 20, STACK_LIMIT = 99, CHEST_WOOD_COST = 4;
export const PLAYER_DELIVERY_TARGET = 'player-delivery';
export type ItemStack = { resource: Resource; count: number };
export type InventorySlot = ItemStack | null;
export const inventorySpace = (slots: readonly InventorySlot[], resource: Resource): number =>
  slots.reduce((total, slot) => total + (slot === null ? STACK_LIMIT : slot.resource === resource ? STACK_LIMIT - slot.count : 0), 0);
export type InventoryLocation =
  | { kind: 'warehouse' }
  | { kind: 'player'; slot?: number }
  | { kind: 'chest'; id: string; slot: number }
  | { kind: 'follower' | 'cargo'; id: string };
export interface ChestView { id: string; x: number; z: number; slots: InventorySlot[] }
export const RESOURCE_NAMES: Record<Resource,string> = {wood:'木材',stone:'石材',steel:'钢铁',food:'生食',meal:'熟食',medicine:'药品',cloth:'布料',silver:'银币',components:'零件'};
export const JOB_TYPES = ['terraform','construct','grow','harvest','haul','cook','chop','mine','research','doctor','craft'] as const;
export type JobType = typeof JOB_TYPES[number];
export const JOB_NAMES: Record<JobType,string> = {terraform:'整地',construct:'建造',grow:'种植',harvest:'收获',haul:'搬运',cook:'烹饪',chop:'伐木',mine:'采矿',research:'研究',doctor:'医疗',craft:'制作'};
export type BuildingKind = 'bed'|'table'|'stove'|'workbench'|'researchDesk'|'solar'|'battery'|'cooler'|'medicalBed'|'wall'|'door'|'floor';
export interface BuildingDefinition { id: BuildingKind; name: string; description: string; cost: Partial<Resources>; work: number; research?: string; power: number; blocking: boolean; color: [number,number,number]; footprint?:[number,number] }
export const BUILDING_DEFS: Record<BuildingKind,BuildingDefinition> = {
  bed:{id:'bed',name:'木床',description:'为居民提供安稳睡眠。',cost:{wood:12,cloth:3},work:18,power:0,blocking:true,color:[0.60,0.42,0.23],footprint:[1,2]},
  table:{id:'table',name:'餐桌',description:'就餐与休闲，改善心情。',cost:{wood:15},work:16,power:0,blocking:true,color:[0.64,0.44,0.23]},
  stove:{id:'stove',name:'炉灶',description:'将 2 份生食制成 3 份熟食。',cost:{stone:15,steel:6},work:24,power:0,blocking:true,color:[0.40,0.43,0.44]},
  workbench:{id:'workbench',name:'工作台',description:'制作药品，研究后可制作零件。',cost:{wood:20,steel:10},work:28,power:0,blocking:true,color:[0.58,0.40,0.23],footprint:[2,1]},
  researchDesk:{id:'researchDesk',name:'研究桌',description:'分配研究项目，由居民逐步研究。',cost:{wood:20,steel:8},work:25,power:0,blocking:true,color:[0.40,0.49,0.55]},
  solar:{id:'solar',name:'太阳能板',description:'晴天白昼发电，阴雨天减产。',cost:{steel:22,components:2},work:36,research:'electricity',power:-120,blocking:true,color:[0.19,0.35,0.55]},
  battery:{id:'battery',name:'蓄电池',description:'保存白天余电，在夜间供电。',cost:{steel:16,components:2},work:30,research:'electricity',power:0,blocking:true,color:[0.40,0.47,0.29]},
  cooler:{id:'cooler',name:'冷藏机',description:'消耗 45 W，减少仓储食品腐坏。',cost:{steel:18,components:3},work:35,research:'refrigeration',power:45,blocking:true,color:[0.59,0.72,0.73]},
  medicalBed:{id:'medicalBed',name:'医护床',description:'病人休养并接受医护治疗。',cost:{wood:18,cloth:8,steel:6},work:30,research:'medicine',power:0,blocking:true,color:[0.80,0.85,0.79]},
  wall:{id:'wall',name:'石墙',description:'阻挡通行，围合室内房间。',cost:{stone:5},work:9,power:0,blocking:true,color:[0.61,0.63,0.57]},
  door:{id:'door',name:'木门',description:'居民可以通行，也能围合房间。',cost:{wood:8},work:12,power:0,blocking:false,color:[0.54,0.36,0.20]},
  floor:{id:'floor',name:'木地板',description:'可通行，提升封闭房间舒适度。',cost:{wood:3},work:5,power:0,blocking:false,color:[0.70,0.52,0.31]},
};
export interface ResearchDefinition {id:string;name:string;description:string;work:number;requires?:string;unlocks:string[]}
export const RESEARCH_DEFS: Record<string,ResearchDefinition> = {
  agriculture:{id:'agriculture',name:'精耕农业',description:'解锁玉米和更高产的种植方式。',work:90,unlocks:['corn']},
  electricity:{id:'electricity',name:'基础电力',description:'解锁太阳能板与蓄电池。',work:110,unlocks:['solar','battery']},
  refrigeration:{id:'refrigeration',name:'食物冷藏',description:'解锁冷藏机，延长食物储存。',work:130,requires:'electricity',unlocks:['cooler']},
  medicine:{id:'medicine',name:'基础医学',description:'解锁医护床并改善治疗效果。',work:100,unlocks:['medicalBed']},
  fabrication:{id:'fabrication',name:'精密制作',description:'解锁工作台零件配方。',work:140,requires:'electricity',unlocks:['components']},
};
export const SCHEDULES = {balanced:'均衡作息',day:'日班',night:'夜班',rest:'休养'} as const;
export type Schedule = keyof typeof SCHEDULES;
export type CropKind = 'rice'|'corn';
export interface ColonyCommand {action:string;value?:unknown;kind?:string;x?:number;z?:number;w?:number;d?:number;cells?:[number,number][];id?:string;colonistId?:string;job?:string;resource?:string;amount?:number;buy?:boolean;target?:number;crop?:string}
export interface CommandResult {ok:boolean;message:string;id?:string}
export interface ColonistView {id:string;name:string;traits:string[];skills:Record<JobType,number>;priorities:Record<JobType,number>;schedule:Schedule;position:Position;health:number;hunger:number;rest:number;recreation:number;mood:number;disease:number;task:string;jobId:string|null;color:Position;carrying:Partial<Resources>;bag:InventorySlot[];comfort:number}
export interface BuildingView {id:string;kind:BuildingKind;x:number;y:number;z:number;w:number;d:number;phase:'preparingTerrain'|'readyToBuild'|'constructing'|'completed';terrainPlanId?:string;blockedReason?:string;complete:boolean;progress:number;reserved:Partial<Resources>;powered:boolean;comfort:number;roomId:number|null}
export interface TerrainPlanView {id:string;target:number;cells:[number,number][];remainingCut:number;remainingFill:number;progress:number;state:'queued'|'working'|'blocked'|'completed';blockedReason?:string;buildingId?:string}
export interface ZoneView {id:string;kind:'farm'|'stockpile';x:number;y:number;z:number;w:number;d:number;crop:CropKind}
export interface CropView {id:string;kind:CropKind;x:number;y:number;z:number;growth:number;planted:boolean}
export interface ItemView {id:string;resource:Resource;amount:number;x:number;y:number;z:number;age:number;reservedBy:string|null}
export interface JobView {id:string;type:JobType;targetId:string;x:number;y:number;z:number;progress:number;work:number;state:'queued'|'working'|'blocked';assignedTo:string|null;reserved:Partial<Resources>;label:string;deliveryPhase?:'pickup'|'deliver'}
export interface ColonyEvent {id:string;time:number;day:number;hour:number;type:'info'|'weather'|'health'|'trade'|'research'|'arrival';text:string}
export interface RoomView {id:number;cells:[number,number][];enclosed:boolean;comfort:number;temperature:number}
export interface ColonySnapshot {
  version:1;speed:number;day:number;hour:number;season:string;weather:string;temperature:number;time:number;
  resources:Resources;colonists:ColonistView[];buildings:BuildingView[];zones:ZoneView[];crops:CropView[];items:ItemView[];jobs:JobView[];rooms:RoomView[];terrainPlans:TerrainPlanView[];
  playerBag:InventorySlot[];bagSelected:number;chests:ChestView[];
  research:{active:string|null;progress:Record<string,number>;completed:string[]};
  power:{generation:number;demand:number;stored:number;capacity:number;supplied:number;coldStorage:boolean};
  trade:{available:boolean;leavesAt:number;stock:Resources;prices:Resources};
  bills:{meal:number;medicine:number;components:number};events:ColonyEvent[];selectedColonistId:string|null;
  metrics:{jobsCompleted:number;built:number;harvested:number;hauled:number;cooked:number;researched:number;treated:number;spoiled:number;distanceWalked:number};
}
