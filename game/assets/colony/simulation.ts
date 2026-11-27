import { containsCell, footprintCells, type ZoneCell } from './zone-cells.ts';
import { merchantOrder, type TradeSide } from './guide-shop.ts';
import type { GuideSale, MerchantId, MerchantHousing, SpecialistMarketView } from './contracts.ts';
import { SPECIALISTS, SPECIALIST_MARKET_RULES, type SpecialistId } from './specialist-catalog.ts';
import { planMarketEvents, reserveMarketQuota, releaseMarketQuota, type MarketEvent } from './market-calendar.ts';
import { GUIDE_HOUSING_RULES, housingTerms, type GuideHousing } from './guide-housing.ts';
import { pastureLayout, pastureHarvest, choosePastureGate, stockVolume, STOCK_VOLUME, STOCK_NAMES, type StockKind, type HerdAnimal } from './pasture.ts';
import { visibleWildAnimals, stockAnimalId, wildAnimalPose } from '../voxel/wild-animals.ts';
import { BLOCK, BLOCKS, VoxelWorld } from '../voxel/model.ts';
import type { TreeInstance } from '../voxel/trees.ts';
import { treeProtectingVoxel } from '../voxel/tree-interaction.ts';
import {buildingDimensions,buildingParts,buildingBlocksMovement,buildingSealsRoom,isSwingDoor} from './buildings.ts';
import { DUSK_SECONDS, PAN_SECONDS, FINALE_SECONDS, gatheringSpot, plazaObstacle, smooth } from './plaza.ts';
import { coldEffect, premiumCount, type ColdMark } from './contracts.ts';
import { isStorageClass, storageClassFor, STORAGE_CLASSES, type StorageClass } from './contracts.ts';
import type { FinalePhase, FinaleView } from './contracts.ts';
import {buildingProtectingVoxel} from './interaction.ts';
import { recipeCost, recipeFor, type Recipe } from './recipes.ts';
import { isWarehouseCard, packageMask, warehouseBayContents, warehouseBayKey, warehouseSlotContents, warehouseSlotKey } from './warehouse.ts';
import {
  BUILDING_DEFS, CROP_DEFS, CROP_SEEDS, DEFAULT_CROP, RESEARCH_DEFS, cropPlantingItem, cropForPlantingItem, JOB_TYPES, JOB_NAMES, RESOURCE_TYPES, SCHEDULES, SUPPLY_TYPES, isCropKind, type CropKind,
  CHEST_SLOTS, CHEST_WOOD_COST, CHOP_WORK, HAMMER, PICKAXE, TOOL_KINDS, COLONIST_CHOP_STAMINA, ITEM_PICKUP_DELAY, ITEM_PICKUP_RANGE, PLAYER_BUILD_MULTIPLIER, PLAYER_BUILD_REACH, PLAYER_DELIVERY_TARGET, PLAYER_STAMINA_REGEN, PLAYER_WORK_REACH, RESIDENT_HEIGHT, RESIDENT_RADIUS, workPercent,
  PLAYER_SLOTS, RESOURCE_NAMES, STACK_LIMIT, inventorySpace, isToolKind, isResource, buildingItemKind, itemName,
  HAUL_LIMIT, SHELF_BAYS, STORAGE_QUARTERS, WAREHOUSE_STACK_LIMIT,
  type BuildingKind, type BuildingView, type BuildingRotation, type ColonyCommand, type ColonyEvent,
  type ColonySnapshot, type ColonistView, type CommandResult, type CropView,
  type ItemView, type InventoryItem, type JobType, type JobView, type OrderType, type Position, type Resource,
  type Resources, type RoomView, type Schedule, type StoredStack, type WarehouseSlot, type ZoneView, type TerrainPlanView,
  type ChestView, type InventoryLocation, type PlayerInventorySlot,
} from './contracts.ts';
export * from './contracts.ts';

const STEP = 0.25;
const CARDINAL_STEPS = [[1,0],[-1,0],[0,1],[0,-1]] as const;
export const DAY_SECONDS = 360;
export const IRON_ORE_YIELD = 12;
const SPEEDS = [0, 1, 3, 6];
const STARTER_SEED_PACKS = 9;
const STARTER_SUPPLIES = 10;
const SHELF_ZONE_PREFIX = 'shelf-zone/';
const WAREHOUSE_LAYOUT = 3;
const EMPTY_RESOURCES = (): Resources => Object.fromEntries(RESOURCE_TYPES.map((r) => [r, 0])) as Resources;
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));
const horizontalDistance = (a: Position, b: Position) => Math.hypot(a[0] - b[0], a[2] - b[2]);
const residentsTouchHorizontally = (a: Position, b: Position) => horizontalDistance(a,b) < RESIDENT_RADIUS * 2 - 1e-6;
const residentsOverlap = (a: Position, b: Position) =>
  Math.abs(a[1] - b[1]) < RESIDENT_HEIGHT - 1e-6 && residentsTouchHorizontally(a,b);
const workSkill = (type: OrderType): JobType => type === 'herd' ? 'haul' : type === 'husbandry' ? 'harvest' : type === 'demolish' ? 'construct' : type;
const emptySlots = (size: number): PlayerInventorySlot[] => Array.from({ length: size }, () => null);
const validSlot = (index: unknown, slots: readonly PlayerInventorySlot[]): index is number =>
  typeof index === 'number' && Number.isInteger(index) && index >= 0 && index < slots.length;
const mineableTerrain = (block:number):boolean =>
  [BLOCK.Stone,BLOCK.SteelOre,BLOCK.Dirt,BLOCK.Grass,BLOCK.Sand].includes(block as never);
const PLAYER_TERRAIN: Partial<Record<number, { resource: Resource; amount: number; seconds: number; tool: typeof PICKAXE | null }>> = {
  [BLOCK.Grass]: {resource:'dirt',amount:1,seconds:.7,tool:null},
  [BLOCK.Dirt]: {resource:'dirt',amount:1,seconds:.7,tool:null},
  [BLOCK.Stone]: {resource:'stone',amount:8,seconds:1.2,tool:PICKAXE},
  [BLOCK.SteelOre]: {resource:'pigIron',amount:IRON_ORE_YIELD,seconds:1.6,tool:PICKAXE},
};
export const playerTerrainRule = (block: number) => PLAYER_TERRAIN[block];
export const withinPlayerWorkReach = ([x, , z]: Position, cellX: number, cellZ: number): boolean =>
  Math.hypot(x - (cellX + .5), z - (cellZ + .5)) <= PLAYER_WORK_REACH;
export const withinTerrainReach = (position: Position, [x, y, z]: Position): boolean =>
  withinPlayerWorkReach(position, x, z) && Math.abs(position[1] + .6 - (y + .5)) <= 1.5;
type QualityMap = Partial<Record<Resource, ColdMark>>;
function addPremium(stock: ColdMark, count: number, day: number) {
  if (count > 0) stock.premium = { day, count: premiumCount(stock, day) + count };
}
function takePremium(stock: ColdMark | undefined, count: number, day: number): number {
  if (!stock) return 0;
  const active = premiumCount(stock, day);
  const taken = Math.min(active, count);
  if (active > taken) stock.premium = { day, count: active - taken };
  else delete stock.premium;
  return taken;
}
type Personal = { quality?: QualityMap; kind: 'eat'|'sleep'|'relax'|'wander'|'patient'; elapsed: number; duration: number; reserved: Partial<Resources>; buildingId?:string };
type Colonist = ColonistView & { cargoQuality?: QualityMap; path: Position[]; personal: Personal | null; destination: Position | null; retryAt: number };
type TerrainPlan = TerrainPlanView & {initialWork:number};
type Earthwork = {x:number;z:number;target:number;height:number;plans:string[];blockedReason?:string};
type Job = JobView & { quality?: QualityMap; phase: 'work'|'pickup'|'deliver'; resource?: Resource; amount: number; destination: Position | null };
type FinaleGuest = {id:string; home:Position; seat:Position; task:string; facing:number; arrived:boolean};
type Finale = {buildingId:string; phase:FinalePhase; elapsed:number; startTime:number; nightTime:number; guests:FinaleGuest[]};
type SavedState = {
  specialistMarket: MarketSave;
  guideBedId?: string | null;
  finale?:Finale;
  version: 3; type: 'peaceful-colony'; worldSeed: string; time: number; accumulator: number; rng: number;
  nextId: number; speed: number; decision: number; lastDay: number; spoilage: number;
  resources: Resources; warehouseLayout: typeof WAREHOUSE_LAYOUT; warehouseStacks: StoredStack[]; colonists: Colonist[]; buildings: BuildingView[]; zones: ZoneView[];
  crops: CropView[]; items: ItemView[]; jobs: Job[]; events: ColonyEvent[]; terrainPlans:TerrainPlan[];
  research: ColonySnapshot['research']; power: ColonySnapshot['power'];
  metrics: ColonySnapshot['metrics']; selectedColonistId: string|null;
  weather: string; temperature: number;
};

const specialistIds=Object.keys(SPECIALISTS) as SpecialistId[];
const merchantName=(id:MerchantId='guide')=>id==='guide'?'向导':SPECIALISTS[id].name;
type MerchantWalk={position:Position;path:Position[];retryAt:number};
type MarketSave={
  progress:Record<SpecialistId,{sold:number;arrivalDay:number|null;bedId:string|null}>;
  walks:Partial<Record<MerchantId,MerchantWalk>>;
  events:MarketEvent[];
};
type MerchantHome={bed:BuildingView;room:RoomView;position:Position};
function emptyMarket():MarketSave {
  const progress=Object.fromEntries(specialistIds.map(id=>[id,{sold:0,arrivalDay:null,bedId:null}])) as MarketSave['progress'];
  return {progress,walks:{},events:[]};
}
function recordGoods(market:MarketSave,item:Resource,count:number,day:number) {
  const arrivals:SpecialistId[]=[];
  for(const id of specialistIds) {
    if(!SPECIALISTS[id].unlockItems.includes(item))continue;
    const row=market.progress[id];
    row.sold+=count;
    if(row.arrivalDay===null && row.sold>=SPECIALISTS[id].unlockQuantity){row.arrivalDay=day;arrivals.push(id);}
  }
  return arrivals;
}

/** All quantities and work reservations have one owner; no runtime/browser API is needed. */
export class ColonySimulation {
  private readonly processionPaths = new Map<string,Position[]>();
  private controlled: Colonist | null = null;
  get simulationTime(): number { return this.s.time + this.s.accumulator; }
  get finale(): FinaleView | undefined {
    const f=this.s.finale;
    return f && {buildingId:f.buildingId,phase:f.phase,elapsed:f.elapsed+this.s.accumulator,guests:f.guests.length,
      arrived:f.guests.filter(g=>g.arrived).length};
  }

  private beginFinale(b:BuildingView):void {
    this.releaseControl();
    this.processionPaths.clear();
    const hour=this.hour(), start=this.s.time;
    const nightTime=start+(hour<5 || hour>=21.5 ? 0 : (21.5-hour)*DAY_SECONDS/24);
    const guests=this.s.colonists.map((c,i):FinaleGuest=>{
      const [x,,z]=c.position;
      const home=this.walkable(Math.floor(x),Math.floor(z)) ? c.position : this.closestOpen(x,z)??c.position;
      return {id:c.id,home:[...home],seat:gatheringSpot(b,i),task:c.task,facing:c.facing,arrived:false};
    });
    this.s.finale={buildingId:b.id, phase:'gathering',elapsed:0,startTime:start,nightTime,guests};
    this.event('info','篝火晚会广场落成，居民受邀赴宴。');
  }

  // Jobs and their reservations stay with their owners. The procession walks a
  // separate route so the worker can resume their original route after returning.
  private walkGuest(c:Colonist, goal:Position, dt:number):boolean {
    let route=this.processionPaths.get(c.id);
    if (!route) {
      const path=this.path(c.position,goal);
      // An isolated island can have no walkable connection to the venue.
      if (path===null) {
        if (this.residentAt(goal, c.id)) return false;
        c.position=[...goal]; return true;
      }
      route=[...path,goal];
      this.processionPaths.set(c.id,route);
    }
    return this.walkResidentPath(c, route, dt * 3.4, true);
  }

  private tickFinale(f:Finale,dt:number):void {
    f.elapsed+=dt;
    if (f.phase==='gathering') {
      this.s.time=f.startTime+(f.nightTime-f.startTime)*smooth(f.elapsed/DUSK_SECONDS);
      if (f.elapsed<DUSK_SECONDS+PAN_SECONDS) return;
    }
    for (const guest of f.guests) {
      const c=this.s.colonists.find(person=>person.id===guest.id)!;
      if (f.phase==='departing') {
        c.task='晚会散场';
        if (!guest.arrived) guest.arrived=this.walkGuest(c,guest.home,dt);
      } else {
        if (!guest.arrived) guest.arrived=this.walkGuest(c,guest.seat,dt);
        c.task=guest.arrived?'围坐篝火旁':'前往篝火晚会';
        if (guest.arrived) {
          const b=this.s.buildings.find(b=>b.id===f.buildingId)!;
          c.facing=Math.atan2(b.x+b.w/2-c.position[0],b.z+b.d/2-c.position[2]);
        }
      }
    }
    if (f.phase==='gathering' && f.guests.every(g=>g.arrived)) {
      f.phase='show'; f.elapsed=0;
    } else if (f.phase==='show' && f.elapsed>=FINALE_SECONDS) {
      f.phase='departing'; f.elapsed=0;
      for (const guest of f.guests) guest.arrived=false;
      this.processionPaths.clear();
      this.event('info','篝火晚会落幕，居民陆续返回。');
    } else if (f.phase==='departing' && f.elapsed>=2 && f.guests.every(g=>g.arrived)) {
      for (const guest of f.guests) {
        const c=this.s.colonists.find(person=>person.id===guest.id)!;
        c.task=guest.task; c.facing=guest.facing;
      }
      this.processionPaths.clear();
      delete this.s.finale;
    }
  }
  private deliveryMessage: string | undefined;
  private playerBuild: { id: string; rate: number } | null = null;
  private walkSurface: ((x:number,z:number,fallback:number)=>number) | undefined;
  /** Source graph/pathfinding stay coarse; derived treads determine actual motion height. */
  setWalkSurfaceSampler(sampler:(x:number,z:number,fallback:number)=>number):void {this.walkSurface=sampler;}
  private externalOccupancy:((x:number,y:number,z:number,w:number,h:number,d:number)=>boolean)|undefined;
  setExternalOccupancySampler(sampler:(x:number,y:number,z:number,w:number,h:number,d:number)=>boolean):void {this.externalOccupancy=sampler;}
  private s: SavedState;
  private ground:Float32Array;
  private earthwork=new Map<number,Earthwork>();
  private buildingAt=new Map<number,BuildingView>();
  private buildingVoxels=new Map<number,BuildingView>();
  private blockedCells=new Set<number>();
  private pathParents:Int32Array;
  private pathSeen:Uint32Array;
  private pathCost:Float64Array;
  private pathStamp=0;
  private terrainCellViews=new Map<string,[number,number][]>();
  private terrainIndexDirty=true;
  private terrainIndexedRevision=-1;
  private terrainPending=new Map<string,number>();
  private terrainReasons=new Map<string,Map<string,number>>();
  private terrainScheduleDirty=true;
  private terrainClearingTrees=new Map<string,TreeInstance>();
  private lastTerrainSchedule=-Infinity;
  private worldRevision = -1;
  private navigationDirty = true;
  private rooms: RoomView[] = [];
  private camp!:Position;
  private merchantHomes=new Map<MerchantId,MerchantHome>();
  private roomChoices:MerchantHome[]=[];
  private roomAt:Int16Array;

  constructor(readonly world: VoxelWorld) {
    const area=world.width*world.depth;
    this.ground=new Float32Array(area).fill(-1);this.roomAt=new Int16Array(area).fill(-1);
    this.pathParents=new Int32Array(area);this.pathSeen=new Uint32Array(area);this.pathCost=new Float64Array(area);
    let seed = 2166136261;
    for (const ch of world.seed) seed = Math.imul(seed ^ ch.charCodeAt(0), 16777619);
    this.s = {
      specialistMarket:emptyMarket(),
      version: 3, type: 'peaceful-colony', worldSeed: world.seed, time: DAY_SECONDS / 3, accumulator: 0,
      rng: seed >>> 0 || 1, nextId: 1, speed: 1, decision: 0, lastDay: 1, spoilage: 0,
      resources: {
        ...EMPTY_RESOURCES(), ...Object.fromEntries(CROP_SEEDS.map(seed => [seed, STARTER_SEED_PACKS])), wood: 140, stone: 110, steel: 60, food: 40, meal: 14, medicine: 12, cloth: 30, silver: 120, components: 8,
        // 新导入的农作物和料理，先各给 10 个，方便试拖动和分类
        wheat: 10, corn: 10, blueberry: 10, sugarcane: 10, cabbage: 10, leek: 10, potato: 10, tomato: 10,
        friedEgg: 10, bread: 10, salad: 10, pasta: 10, pancake: 10, blueberryPie: 10, pizza: 10, perfectBreakfast: 10, lambChopStew: 10,
        ...Object.fromEntries(SUPPLY_TYPES.map(resource => [resource, STARTER_SUPPLIES])),
      },
      warehouseLayout: WAREHOUSE_LAYOUT, warehouseStacks: [], colonists: [], buildings: [], zones: [], crops: [], items: [], jobs: [], events: [],terrainPlans:[],
      research: { active: null, progress: {}, completed: [] },
      power: { generation: 0, demand: 0, stored: 0, capacity: 0, supplied: 0, coldStorage: false },
      metrics: { jobsCompleted: 0, built: 0, harvested: 0, hauled: 0, cooked: 0, researched: 0, treated: 0, spoiled: 0, distanceWalked: 0 },
      selectedColonistId: null, weather: '晴朗', temperature: 22,
    };
    this.refreshGround();
    const chest = this.starterChest();
    const chestPosition = this.findBuildingPosition('chest', chest.x, chest.z, this.s.buildings, 0);
    if (chestPosition) this.s.buildings.push(this.chestBuilding(chest, chestPosition));
    const midX=Math.floor(world.width/2)+3,midZ=Math.floor(world.depth/2)+3;
    const centre = this.closestOpen(midX, midZ) ?? [midX+.5, 6, midZ+.5];
    const cx = Math.floor(centre[0]), cz = Math.floor(centre[2]);
    const west = Math.max(0, cx - 10), north = Math.max(0, cz - 6);
    const stockpile = this.addZone('stockpile', west, north, Math.max(1, cx - 1 - west),
      Math.min(world.depth, cz + 3) - north, DEFAULT_CROP);
    this.rebuildBuildings();
    this.addZone('farm', cx - 2, cz + 3, 3, 3, DEFAULT_CROP);
    for (const [kind, dx, dz] of [
      ['bed', 1, -3], ['bed', 2, -3], ['bed', 3, -3], ['table', 1, -1],
      ['stove', 3, -1], ['workbench', 4, -1], ['researchDesk', 4, 1],
    ] as [BuildingKind, number, number][]) {
      const p = this.findBuildingPosition(kind,cx+dx,cz+dz,this.s.buildings,0);
      if (p) this.s.buildings.push({ id: this.id('building'), kind, ...p,...buildingDimensions(kind,0),rotation:0,phase:'completed',complete: true, progress: 1, reserved: {}, powered: false, comfort: 0, roomId: null });
      this.rebuildBuildings();
    }
    this.addStarterShelves(stockpile);
    this.storeInitialSupplies();
    const names = ['林夏', '阿澈', '青禾'];
    names.forEach((name, index) => this.addColonist(name, cx - 1, cz + index - 1, index));
    this.s.selectedColonistId = null;
    this.s.colonists[0]!.bag.splice(0, TOOL_KINDS.length, ...TOOL_KINDS.map(resource=>({resource,count:1})));
    this.drop('wood', 12, cx, cz + 2);
    this.drop('stone', 10, cx + 2, cz + 2);
    this.event('info', '三位旅人抵达河谷。和平营地已建立：先种田、搬运物资，再安排研究与建设。');
    this.navigationDirty = true;
    this.updateRooms();
    this.refreshJobs();
  }

  private addStarterShelves(zone:ZoneView):void {
    const dimensions = buildingDimensions('shelf');
    const cells = this.footprint(zone);
    for (const offset of [1, 4]) {
      const preferredX = zone.x + offset, preferredZ = zone.z + 1;
      cells.sort(([ax,az],[bx,bz]) =>
        Math.abs(ax-preferredX) + Math.abs(az-preferredZ) - Math.abs(bx-preferredX) - Math.abs(bz-preferredZ));
      const cell = cells.find(([x,z]) => containsCell(zone, x + dimensions.w - 1, z + dimensions.d - 1)
        && this.completedBuildingFits('shelf', x, this.world.terrainHeight(x,z), z, 0, this.s.buildings, this.s.crops));
      const position = cell ? {x:cell[0],y:this.world.terrainHeight(...cell),z:cell[1]}
        : this.findBuildingPosition('shelf', preferredX, preferredZ, this.s.buildings, 0);
      if (!position) continue;
      this.s.buildings.push({id:this.id('building'),kind:'shelf',...position,...dimensions,rotation:0,
        phase:'completed',complete:true,progress:1,reserved:{},powered:false,comfort:0,roomId:null});
      this.rebuildBuildings();
    }
  }

  private id(prefix: string): string { return `${prefix}-${this.s.nextId++}`; }
  private random(): number {
    let x = this.s.rng; x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    this.s.rng = x >>> 0 || 1; return this.s.rng / 4294967296;
  }
  private day(): number { return Math.floor(this.s.time / DAY_SECONDS) + 1; }
  private hour(): number { return (this.s.time % DAY_SECONDS) / DAY_SECONDS * 24; }
  private season(): string { return ['春季', '夏季', '秋季', '冬季'][Math.floor((this.day() - 1) / 6) % 4]!; }
  private event(type: ColonyEvent['type'], text: string): void {
    this.s.events.push({ id: this.id('event'), time: this.s.time, day: this.day(), hour: this.hour(), type, text });
    if (this.s.events.length > 80) this.s.events.shift();
  }
  private addColonist(name: string, x: number, z: number, index: number): void {
    const priorities = Object.fromEntries(JOB_TYPES.map((j) => [j, 3])) as Record<JobType,number>;
    const skills = Object.fromEntries(JOB_TYPES.map((j) => [j, 2 + (index * 3 + j.length) % 6])) as Record<JobType,number>;
    if (index % 3 === 0) { priorities.terraform = 1; priorities.construct = 1; priorities.chop = 2; priorities.mine = 2; skills.construct = 9; }
    if (index % 3 === 1) { priorities.cook = 1; priorities.doctor = 1; priorities.haul = 2; skills.cook = 8; skills.doctor = 7; }
    if (index % 3 === 2) { priorities.grow = 1; priorities.harvest = 1; priorities.research = 2; skills.grow = 9; skills.research = 8; }
    this.s.colonists.push({ id: this.id('colonist'), name, traits: [['勤劳', '巧手'], ['体贴', '乐观'], ['园艺爱好者', '好学']][index % 3]!, skills, priorities, schedule: 'balanced',
      position: this.closestOpen(x, z, false, p => !this.residentAt(p)) ?? [this.world.width/2+.5, 6, this.world.depth/2+.5], health: 100, hunger: 72 + index * 5, rest: 88, recreation: 76, mood: 78, disease: 0,
      task: '观察新营地', jobId: null, color: [[0.78,0.44,0.25],[0.29,0.54,0.69],[0.55,0.66,0.32]][index % 3] as Position,
      carrying: {}, bag: emptySlots(PLAYER_SLOTS), bagSelected:0, stamina:100, facing:0, comfort: 0, path: [], personal: null, destination: null, retryAt: 0 });
  }

  private starterChest(): ChestView {
    return { id: 'chest-starter', x: Math.min(this.world.width - 1, Math.floor(this.world.width / 2) + 1),
      z: Math.floor(this.world.depth / 2), slots: emptySlots(CHEST_SLOTS) };
  }

  private chestBuilding(chest: ChestView, position: {x:number;y:number;z:number}): BuildingView {
    return { id: chest.id, kind: 'chest', ...position, ...buildingDimensions('chest'), rotation: 0,
      phase: 'completed', complete: true, progress: 1, reserved: {}, powered: false, comfort: 0, roomId: null, storage: chest.slots };
  }

  private placeChest(x: number | undefined, z: number | undefined): CommandResult {
    this.validCell(x, z);
    const zz = z!;
    const y = this.world.terrainHeight(x, zz);
    if (y < 1 || y >= this.world.height || this.world.get(x, y, zz) !== BLOCK.Air || !this.walkable(x, zz)
      || this.world.treesAtVoxel(x, y, zz).length || this.treeBase(x, zz) >= 1 || this.buildingAt.has(this.cellKey(x, zz))
      || this.s.crops.some(crop => crop.x === x && crop.z === zz)) {
      return { ok: false, message: '请选择一块空地放置木箱' };
    }
    if(this.s.zones.some(zone=>zone.pasture&&containsCell(zone,x,zz)))return {ok:false,message:'牧场内请使用畜产采集设施。'};
    if (this.s.resources.wood < CHEST_WOOD_COST) return { ok: false, message: '仓库里的木材不足' };
    const id = this.id('chest');
    this.s.buildings.push(this.chestBuilding({ id, x, z: zz, slots: emptySlots(CHEST_SLOTS) }, {x,y,z:zz}));
    this.withdrawStock('wood', CHEST_WOOD_COST);
    this.rebuildBuildings();
    return { ok: true, message: '已放置木箱', id };
  }

  get controlledColonist(): ColonistView | null { return this.controlled; }

  private get inventoryColonist(): Colonist | undefined {
    return this.controlled ?? this.s.colonists.find(person=>person.id===this.s.selectedColonistId);
  }

  possessColonist(id: string | null): ColonistView | null {
    const resident=this.s.colonists.find(person=>person.id===id);
    if(!resident || this.controlled || this.s.finale)return null;
    this.releasePerson(resident);
    this.controlled=resident;
    this.s.selectedColonistId=resident.id;
    resident.task='由玩家控制';
    return resident;
  }

  updateControlledPose(position: Position, facing: number, stamina: number): void {
    if(!this.controlled)return;
    const resident=this.controlled;
    if(position.some((value,i)=>value!==resident.position[i]))resident.position=position;
    resident.facing=facing;
    resident.stamina=stamina;
  }

  releaseControl(): void {
    const resident=this.controlled;
    if(!resident)return;
    if(this.residentAt(resident.position,resident.id)){
      const [x,,z]=resident.position;
      resident.position=this.closestOpen(x,z,false,p=>!this.residentAt(p,resident.id))??resident.position;
    }
    resident.task='等待工作';
    resident.retryAt=this.s.time;
    this.controlled=null;
    this.stopPlayerConstruction();
  }

  selectBagSlot(index: unknown): void {
    const resident=this.inventoryColonist;
    if (!resident || !validSlot(index,resident.bag)) return;
    resident.bagSelected=index;
    if (resident.bag[index]?.resource!==HAMMER) this.stopPlayerConstruction();
  }

  private inventorySlots(location: InventoryLocation): PlayerInventorySlot[] | undefined {
    if (location.kind === 'player') {
      const resident=this.inventoryColonist;
      return location.id===undefined||location.id===resident?.id ? resident?.bag : undefined;
    }
    if (location.kind === 'chest') return this.s.buildings.find(building=>building.id===location.id)?.storage;
    if (location.kind === 'follower') return this.s.colonists.find(resident=>resident.id===location.id)?.bag;
  }

  private addToBag(resident: Colonist, resource: InventoryItem, amount: number, select = false, source?:ColdMark): number {
    const bag=resident.bag;
    if (isToolKind(resource)) {
      const index = bag.indexOf(null);
      if (index < 0 || bag.some(slot => slot?.resource === resource)) return 0;
      bag[index] = { resource, count: 1 };
      if (select && !this.playerBuild) resident.bagSelected=index;
      return 1;
    }
    const slots = bag.flatMap((stack, index) => stack?.resource === resource && stack.count < STACK_LIMIT ? [index] : []);
    bag.forEach((stack, index) => { if (stack === null) slots.push(index); });
    let left = amount;
    for (const index of slots) {
      if (left <= 0) break;
      const count = bag[index]?.count ?? 0;
      const added = Math.min(STACK_LIMIT - count, left);
      bag[index] = { ...bag[index], resource, count: count + added };
      addPremium(bag[index]!,takePremium(source,added,this.day()),this.day());
      if (select && left === amount && !this.playerBuild) resident.bagSelected=index;
      left -= added;
    }
    return amount - left;
  }

  transferInventory(from: InventoryLocation, to: InventoryLocation, resource: InventoryItem, amount: number): CommandResult {
    const unavailable = { ok: false, message: '来源格子里的物品已变动' };
    const full = { ok: false, message: '目标格放不下，物品留在原处' };
    const isTool = isToolKind(resource);
    const isBuilding = typeof resource === 'string' && !!buildingItemKind(resource);
    if (!from || !to || (!isTool && !isBuilding && !isResource(resource)) || !Number.isSafeInteger(amount) || amount < 1) {
      return { ok: false, message: '无效的物品转移' };
    }
    if (isBuilding && (from.kind === 'warehouse' || to.kind === 'warehouse')) return {ok:false,message:'设施物品可放进木箱或随从背包'};
    if (from.kind === 'warehouse' && to.kind === 'warehouse') return unavailable;
    const sourceSlots = this.inventorySlots(from);
    const sourceIndex = from.kind === 'player' || from.kind === 'chest' ? from.slot : from.kind==='follower' ? from.slot??0 : 0;
    const cargo = from.kind === 'cargo' ? this.s.colonists.find(colonist => colonist.id === from.id)?.carrying : undefined;
    const sourceStack = sourceSlots && validSlot(sourceIndex, sourceSlots) ? sourceSlots[sourceIndex] : null;
    const stock = this.s.resources as Partial<Record<InventoryItem, number>>;
    const available = from.kind === 'warehouse' ? stock[resource] ?? 0
      : cargo ? (isResource(resource) ? cargo[resource] ?? 0 : 0) : sourceStack?.resource === resource ? sourceStack.count : 0;
    if (available < 1) return unavailable;

    const targetSlots = this.inventorySlots(to);
    const targetIndex = to.kind === 'player' || to.kind === 'chest' ? to.slot : to.kind==='follower' ? to.slot??0 : 0;
    let moved = Math.min(available, amount);
    const carrier = from.kind === 'cargo' ? this.s.colonists.find(c => c.id === from.id) : undefined;
    const sourceMark = sourceStack ?? (isResource(resource) ? carrier?.cargoQuality?.[resource] : undefined);
    const pull = (count: number) => from.kind === 'warehouse' && isResource(resource)
      ? this.withdrawStock(resource,count) : takePremium(sourceMark,count,this.day());
    if (to.kind === 'player' && targetIndex === undefined && sourceSlots !== targetSlots) {
      const receiver=this.inventoryColonist;
      if(!receiver || targetSlots!==receiver.bag)return full;
      moved = Math.min(moved,inventorySpace(receiver.bag,resource));
      if (!moved) return full;
      this.addToBag(receiver,resource,moved,true,{premium:{day:this.day(),count:pull(moved)}});
    } else if (to.kind !== 'warehouse') {
      if (!targetSlots) return full;
      if (!validSlot(targetIndex, targetSlots)) return full;
      if (sourceSlots === targetSlots && sourceIndex === targetIndex) return { ok: false, message: '' };
      const current = targetSlots[targetIndex];
      if (current && current.resource !== resource) return full;
      if (isTool && sourceSlots !== targetSlots && targetSlots.some(slot => slot?.resource === resource)) return full;
      moved = Math.min(moved, (isTool ? 1 : STACK_LIMIT) - (current?.count ?? 0));
      if (moved <= 0) return full;
      targetSlots[targetIndex] = { ...current, resource, count: (current?.count ?? 0) + moved };
      addPremium(targetSlots[targetIndex]!,pull(moved),this.day());
      if (to.kind === 'player') this.selectBagSlot(targetIndex);
    } else {
      if (isResource(resource)) {
        moved = this.putInAvailableStorage(resource,moved,sourceMark);
        if (!moved) return full;
      }
      stock[resource] = (stock[resource] ?? 0) + moved;
    }

    const left = available - moved;
    if (from.kind === 'warehouse') {
      if (!isResource(resource)) stock[resource] = left;
    }
    else if (cargo && isResource(resource)) {
      if (left) cargo[resource] = left;
      else delete cargo[resource];
    } else if (sourceSlots && validSlot(sourceIndex, sourceSlots)) {
      sourceSlots[sourceIndex] = left ? { ...sourceStack, resource, count: left } : null;
    }
    return { ok: true, message: moved < amount ? `已转移 ${moved} 个，剩余物品留在原处` : `已转移 ${moved} 个` };
  }

  requestDelivery(resource: Resource, amount: number): CommandResult {
    if (!RESOURCE_TYPES.includes(resource) || !Number.isSafeInteger(amount) || amount < 1) return { ok: false, message: '获取数量无效' };
    if (amount > this.s.resources[resource]) return { ok: false, message: '仓库现有数量不足，请重新选择数量' };
    const recipient=this.inventoryColonist;
    if (!recipient) return {ok:false,message:'请先选中收货的村民'};
    if (amount > inventorySpace(recipient.bag, resource)) return { ok: false, message: '快捷栏空间不足，请重新选择数量' };
    const source = this.storageTarget();
    if (!source) return { ok: false, message: '找不到可用的储藏区' };
    const job = this.addJob('haul', PLAYER_DELIVERY_TARGET, Math.floor(source[0]), source[1], Math.floor(source[2]), 1, `配送${RESOURCE_NAMES[resource]}`);
    job.resource = resource;
    job.recipientId=recipient.id;
    job.reserved[resource] = amount;
    job.quality = this.take({[resource]:amount});
    return { ok: true, id: job.id, message: `已安排随从配送 ${amount} 个${RESOURCE_NAMES[resource]}` };
  }

  takeDeliveryMessage(): string | undefined {
    const message = this.deliveryMessage;
    this.deliveryMessage = undefined;
    return message;
  }

  get playerConstructionId(): string | null { return this.playerBuild?.id ?? null; }

  stopPlayerConstruction(): void { this.playerBuild = null; }

  private withinBuildReach(position: Position, building: Pick<BuildingView,'x'|'y'|'z'|'w'|'d'>): boolean {
    const [x, y, z] = position;
    const dx = x - clamp(x, building.x, building.x + building.w);
    const dz = z - clamp(z, building.z, building.z + building.d);
    return Math.hypot(dx, dz) <= PLAYER_BUILD_REACH && Math.abs(y - building.y) <= 1.5;
  }

  startPlayerConstruction(id: string, position: Position): CommandResult {
    this.stopPlayerConstruction();
    if (this.controlled?.bag[this.controlled.bagSelected]?.resource !== HAMMER) return { ok: false, message: '请先选中锤子' };
    const building = this.s.buildings.find(candidate => candidate.id === id && !candidate.complete);
    if (!building) return { ok: false, message: '没有可施工的蓝图' };
    if (!this.withinBuildReach(position, building)) return { ok: false, message: '请靠近蓝图后施工' };
    const job = this.s.jobs.find(candidate => candidate.type === 'construct' && candidate.targetId === id);
    if (!job || !this.constructionReady(building)) {
      return { ok: false, message: building.blockedReason ?? '请等地基平整并备齐材料' };
    }
    const assigned = this.s.colonists.find(person => person.id === job.assignedTo);
    const available = this.s.colonists.filter(person => person.priorities.construct > 0);
    const reference = assigned ? this.workRate(assigned, 'construct')
      : Math.max(...(available.length ? available : this.s.colonists).map(person => this.workRate(person, 'construct')));
    this.playerBuild = { id, rate: PLAYER_BUILD_MULTIPLIER * reference };
    return { ok: true, message: `开始建造${BUILDING_DEFS[building.kind].name}` };
  }

  private updatePlayerConstruction(dt: number): void {
    const action = this.playerBuild;
    if (!action) return;
    const building = this.s.buildings.find(candidate => candidate.id === action.id && !candidate.complete);
    const job = this.s.jobs.find(candidate => candidate.type === 'construct' && candidate.targetId === action.id);
    if (!building || !job || !this.controlled || this.controlled.bag[this.controlled.bagSelected]?.resource!==HAMMER
      || !this.withinBuildReach(this.controlled.position, building)
      || !this.constructionReady(building)) { this.stopPlayerConstruction(); return; }
    const assigned = this.s.colonists.find(person => person.id === job.assignedTo);
    if (assigned) this.releasePerson(assigned);
    this.advanceConstruction(building, job, dt * action.rate);
    if (building.complete) this.stopPlayerConstruction();
  }

  tick(realSeconds: number, playerPosition?: Position): void {
    if (!Number.isFinite(realSeconds) || realSeconds < 0 || realSeconds > 600) throw new RangeError('模拟步长必须为 0–600 秒。');
    if(playerPosition && this.controlled)this.controlled.position=playerPosition;
    this.syncWorld();
    this.s.accumulator += realSeconds * (this.s.finale && this.s.speed ? 1 : this.s.speed);
    while (this.s.accumulator + 1e-9 >= STEP) {
      this.s.accumulator = Math.max(0, this.s.accumulator - STEP);
      this.step(STEP);
    }
  }
  private step(dt: number): void {
    if (this.s.finale) { this.tickFinale(this.s.finale,dt); return; }
    this.s.time += dt;
    this.syncWorld();
    if (this.day() !== this.s.lastDay) this.newDay();
    if(this.navigationDirty)this.updateRooms();
    this.walkMerchants(dt);
    this.updateClimate();
    this.updatePower(dt);
    for (const crop of this.s.crops) if (crop.planted && crop.growth < 1) {
      const ideal = this.s.temperature >= 8 && this.s.temperature <= 32;
      const light = this.hour() >= 5 && this.hour() < 21 ? 1 : 0.25;
      crop.growth = Math.min(1, crop.growth + dt / CROP_DEFS[crop.kind].growthSeconds * (ideal ? 1 : 0.2) * light * (this.s.weather === '细雨' ? 1.15 : 1));
    }
    this.updateColdStorage(dt);
    for (const item of this.s.items) item.age += dt;
    // 玩家踩过掉落物就顺手捡走。
    // 刚掉下来的半秒内捡不了——不然视觉上还没落地就没了，像凭空消失。
    if (this.controlled) {
      const player = this.controlled.position;
      for (const item of [...this.s.items]) {
        if (item.reservedBy) continue;                       // 被搬运任务预定着的不抢
        if (item.age < ITEM_PICKUP_DELAY) continue;
        if (Math.abs(item.x + 0.5 - player[0]) > ITEM_PICKUP_RANGE) continue;
        if (Math.abs(item.z + 0.5 - player[2]) > ITEM_PICKUP_RANGE) continue;
        if (Math.abs(item.y - player[1]) > 2) continue;
        const received = this.addToBag(this.controlled,item.resource,item.amount,!item.playerOnly,item);
        if (!received) continue;                             // 背包装不下就留在地上
        item.amount -= received;
        if (item.amount <= 0) this.s.items.splice(this.s.items.indexOf(item), 1);
        this.deliveryMessage = `拾取 ${received} 个${itemName(item.resource)}`;
      }
    }
    this.s.decision += dt;
    if (this.s.decision >= 1) {
      this.s.decision -= 1;
      if (this.navigationDirty) this.updateRooms();
      this.refreshJobs();
    }
    this.updatePlayerConstruction(dt);
    for (const c of this.s.colonists) {
      if (this.s.finale) break;
      this.updateColonist(c, dt);
    }
  }

  command(c: ColonyCommand): CommandResult {
    try {
      if (!c || typeof c.action !== 'string') throw new Error('无效的营地指令。');
      this.syncWorld();
      if (c.action === 'speed') {
        if (typeof c.value !== 'number' || !SPEEDS.includes(c.value)) throw new Error('速度仅支持暂停、1、3、6 倍。');
        this.s.speed = c.value; return { ok:true, message:c.value === 0 ? '营地已暂停' : `${c.value} 倍速` };
      }
      if (this.s.finale) return {ok:false,message:'篝火晚会进行中'};
      if (c.action === 'guide-trade' || c.action==='assign-merchant-room') {
        if(this.navigationDirty)this.updateRooms();
        if(c.merchantId!==undefined && c.merchantId!=='guide' && !specialistIds.includes(c.merchantId))throw new Error('商人无效');
        if(c.action==='assign-merchant-room')return this.assignMerchantRoom(c.merchantId??'guide',c.id);
        if (c.value !== 'buy' && c.value !== 'recycle' || !isResource(c.kind)) throw new Error('无效的交易');
        return this.tradeWithGuide(c.value, c.kind, c.amount, c.target,c.merchantId);
      }
      if (c.action === 'select') {
        const id = c.colonistId ?? null;
        if (id && !this.s.colonists.some((p) => p.id === id)) throw new Error('未找到这位居民。');
        this.s.selectedColonistId = id; return {ok:true,message:'已选择居民'};
      }
      if (c.action === 'priority' || c.action === 'schedule') {
        const person = this.s.colonists.find((p) => p.id === c.colonistId);
        if (!person) throw new Error('未找到这位居民。');
        if (c.action === 'priority') {
          if (!JOB_TYPES.includes(c.job as JobType) || !Number.isInteger(c.value) || Number(c.value) < 0 || Number(c.value) > 4) throw new Error('优先级为 0（禁用）到 4（最低）。');
          person.priorities[c.job as JobType] = Number(c.value);
          const current = person.jobId && this.s.jobs.find(j => j.id === person.jobId);
          if (current && workSkill(current.type) === c.job) this.releasePerson(person);
        } else {
          if (typeof c.value !== 'string' || !(c.value in SCHEDULES)) throw new Error('未知作息。');
          person.schedule = c.value as Schedule; this.releasePerson(person);
        }
        return {ok:true,message:'居民安排已更新'};
      }
      if (c.action === 'build') return this.orderBuild(c.kind, c.x, c.z,c.target,c.rotation);
      if (c.action === 'herdAnimal') return this.orderHerd(c);
      if (c.action === 'pastureGate') return this.changeGate(c);
      if (c.action === 'toggleDoor') return this.toggleDoor(c);
      if (c.action === 'demolish') return this.orderDemolition(c);
      if (c.action === 'place-chest') return this.placeChest(c.x, c.z);
      if (c.action === 'level') return this.orderLevel(c);
      if (c.action === 'designate') return this.designate(c);
      if (c.action === 'storageClass') {
        const zone = this.s.zones.find(z => z.id === c.id && z.kind === 'stockpile')
          ?? this.shelves().find(shelf => SHELF_ZONE_PREFIX + shelf.id === c.id);
        if (!zone || !isStorageClass(c.value)) throw new Error('请选择有效仓储区与类别。');
        zone.storageClass = c.value;
        return {ok:true,message:'已设为'+STORAGE_CLASSES[c.value]};
      }
      if (c.action === 'cancel') return this.cancel(c.id);
      if (c.action === 'research') {
        const def = RESEARCH_DEFS[c.id ?? ''];
        if (!def || this.s.research.completed.includes(def.id)) throw new Error('研究不存在或已经完成。');
        if (def.requires && !this.s.research.completed.includes(def.requires)) throw new Error('请先完成前置研究。');
        for (const job of [...this.s.jobs]) if (job.type === 'research') this.removeJob(job, true);
        this.s.research.active = def.id; this.s.research.progress[def.id] ??= 0;
        this.event('research', `开始研究：${def.name}。`); this.refreshJobs();
        return {ok:true,message:`已安排${def.name}`};
      }
      if (c.action === 'craft') return this.orderRecipe(c.recipe, c.amount ?? 1);
      throw new Error('未知营地指令。');
    } catch (error) { return {ok:false,message:error instanceof Error ? error.message : '无法执行指令'}; }
  }

  private orderRecipe(id: unknown, amount: number): CommandResult {
    const recipe = recipeFor(id);
    if (!recipe) throw new Error('这个制作配方不存在。');
    if (!Number.isInteger(amount) || amount < 1 || amount > 99) throw new Error('制作批次须为 1–99。');
    if (!recipe.station) throw new Error(`尚无${recipe.plannedStation}，暂不能安排制作。`);
    if (recipe.requires && !this.s.research.completed.includes(recipe.requires)) {
      throw new Error(`请先研究${RESEARCH_DEFS[recipe.requires]!.name}。`);
    }
    const queued = this.s.jobs.filter(job => job.recipe);
    const station = this.s.buildings.filter(b => b.complete && b.kind === recipe.station)
      .sort((a, b) => queued.filter(job => job.targetId === a.id).length - queued.filter(job => job.targetId === b.id).length)[0];
    if (!station) throw new Error(`请先建好${BUILDING_DEFS[recipe.station].name}。`);
    const name = RESOURCE_NAMES[recipe.output];
    const job = this.addJob(recipe.job, station.id, station.x, station.y, station.z, recipe.work * amount, `制作${name}`);
    job.recipe = recipe.output;
    job.amount = amount;
    job.phase = 'pickup';
    const missing = this.missingRecipeMaterials(recipeCost(recipe, amount));
    if (missing) {
      job.state = 'blocked';
      job.label = missing;
    }
    return { ok: true, id: job.id, message: missing ? `已安排制作${name} · ${missing}` : `已安排制作${name}` };
  }

  private missingRecipeMaterials(cost: Partial<Resources>): string | undefined {
    const missing = RESOURCE_TYPES.flatMap(resource => {
      const shortage = (cost[resource] ?? 0) - this.s.resources[resource];
      return shortage > 0 ? [`${RESOURCE_NAMES[resource]} × ${shortage}`] : [];
    });
    return missing.length ? `缺少${missing.join('、')}` : undefined;
  }

  private validCell(x: unknown,z: unknown): asserts x is number {
    if (!Number.isInteger(x) || !Number.isInteger(z) || Number(x) < 0 || Number(x) >= this.world.width || Number(z) < 0 || Number(z) >= this.world.depth) throw new Error('位置超出地图范围。');
  }
  private cellKey(x:number,z:number):number{return x+z*this.world.width;}
  private voxelKey(x:number,y:number,z:number):number{return x+this.world.width*(z+this.world.depth*y);}
  buildingAtVoxel(x:number,y:number,z:number):BuildingView|undefined {
    if(![x,y,z].every(Number.isInteger)||!this.world.inBounds(x,y,z))return undefined;
    return this.buildingVoxels.get(this.voxelKey(x,y,z));
  }
  blocksVoxel(x:number,y:number,z:number):boolean {
    const b=this.buildingAtVoxel(x,y,z);
    if (b?.kind==='campfirePlaza') return b.complete && y===b.y && plazaObstacle(b,x,z);
    return !!b&&buildingBlocksMovement(b);
  }
  private footprint(b:Pick<BuildingView,'x'|'z'|'w'|'d'>):[number,number][]{const cells:[number,number][]=[];for(let z=b.z;z<b.z+b.d;z++)for(let x=b.x;x<b.x+b.w;x++)cells.push([x,z]);return cells;}
  private rebuildBuildings():void {
    this.buildingAt.clear();this.buildingVoxels.clear();this.blockedCells.clear();
    for(const b of this.s.buildings){
      for(const part of buildingParts(b))this.buildingVoxels.set(this.voxelKey(part.x,part.y,part.z),b);
      for(const[x,z]of this.footprint(b)){
        this.buildingAt.set(this.cellKey(x,z),b);
        if(buildingBlocksMovement(b) || (b.complete && b.kind==='campfirePlaza' && plazaObstacle(b,x,z)))this.blockedCells.add(this.cellKey(x,z));
      }
    }
  }
  private findBuildingPosition(kind:BuildingKind,x:number,z:number,others:BuildingView[],rotation:BuildingRotation,target?:number,crops:CropView[]=this.s.crops):{x:number;y:number;z:number}|null {
    for(let radius=0;radius<12;radius++)for(let dz=-radius;dz<=radius;dz++)for(let dx=-radius;dx<=radius;dx++){
      if(Math.max(Math.abs(dx),Math.abs(dz))!==radius)continue;
      const xx=x+dx,zz=z+dz,y=target??this.world.terrainHeight(xx,zz);
      if(this.completedBuildingFits(kind,xx,y,zz,rotation,others,crops))return{x:xx,y,z:zz};
    }return null;
  }
  private completedBuildingFits(kind:BuildingKind,x:number,y:number,z:number,rotation:BuildingRotation,others:BuildingView[],crops:CropView[]):boolean {
    const {w,h,d}=buildingDimensions(kind,rotation);
    return x>=0&&z>=0&&x+w<=this.world.width&&z+d<=this.world.depth&&y>=1&&y+h<=this.world.height
      &&!others.some(b=>x<b.x+b.w&&x+w>b.x&&z<b.z+b.d&&z+d>b.z)
      &&this.footprint({x,z,w,d}).every(([cx,cz])=>this.world.terrainHeight(cx,cz)===y&&!crops.some(p=>p.x===cx&&p.z===cz))
      &&buildingParts({kind,x,y,z,rotation}).every(p=>this.world.get(p.x,p.y,p.z)===BLOCK.Air&&!this.world.treesAtVoxel(p.x,p.y,p.z).length);
  }

  placeCarriedBuilding(x:number,z:number,rotation:BuildingRotation,position:Position):CommandResult {
    const resident=this.controlled;
    if(!resident)return {ok:false,message:"请先附身村民"};
    const index=resident.bagSelected, stack=resident.bag[index];
    const kind=buildingItemKind(stack?.resource);
    if(!stack||!kind)return {ok:false,message:'请先选中要放置的设施'};
    const pastureReason=this.pastureBuildingBlocker(kind,x,z,rotation);
    if(pastureReason)return {ok:false,message:pastureReason};
    const y=this.world.terrainHeight(x,z);
    if(!this.completedBuildingFits(kind,x,y,z,rotation,this.s.buildings,this.s.crops))return {ok:false,message:'请选择一块足够大的平整空地'};
    const def=BUILDING_DEFS[kind];
    const building:BuildingView={id:'',kind,x,y,z,...buildingDimensions(kind,rotation),rotation,phase:'completed',complete:true,progress:1,
      reserved:{},powered:false,comfort:0,roomId:null,...(isSwingDoor(kind)?{doorOpen:false}:{}),...(def.storageSlots?{storage:emptySlots(def.storageSlots)}:{})};
    if(!this.withinBuildReach(position,building))return {ok:false,message:'请靠近空地后放置'};
    if(def.blocking&&this.occupiedByActor(building))return {ok:false,message:'放置位置有人，请换一格'};
    if(this.footprint(building).some(([cx,cz])=>this.earthwork.has(this.cellKey(cx,cz))))return {ok:false,message:'请先完成或取消此处的整地规划'};
    building.id=this.id('building');
    this.s.buildings.push(building);
    resident.bag[index]=stack.count>1?{resource:stack.resource,count:stack.count-1}:null;
    this.invalidateBuildingNavigation();this.moveObstructedGroundStorage();this.updatePower(0);this.refreshJobs();
    return {ok:true,id:building.id,message:kind==='shelf'?'已放置储物架并自动规划为仓储区':`已放置${def.name}`};
  }
  private validTarget(target:unknown):asserts target is number{if(!Number.isInteger(target)||Number(target)<1||Number(target)>this.world.height-2)throw new Error(`目标标高须为 1–${this.world.height-2} 的整数。`);}
  private orderLevel(c:ColonyCommand):CommandResult {
    this.validTarget(c.target);const cells:[number,number][]=[];
    if(c.cells!==undefined){
      if(!Array.isArray(c.cells)||c.cells.length>this.world.width*this.world.depth)throw new Error('整地选区无效。');
      const seen=new Set<number>();for(const p of c.cells){if(!Array.isArray(p)||p.length!==2)throw new Error('整地选区无效。');this.validCell(p[0],p[1]);const key=this.cellKey(p[0],p[1]);if(!seen.has(key)){seen.add(key);cells.push([p[0],p[1]]);}}
    }else{
      this.validCell(c.x,c.z);const w=c.w??1,d=c.d??1;
      if(!Number.isInteger(w)||!Number.isInteger(d)||w<1||d<1||c.x!+w>this.world.width||c.z!+d>this.world.depth)throw new Error('整地选区须位于地图内。');
      for(let z=c.z!;z<c.z!+d;z++)for(let x=c.x!;x<c.x!+w;x++)cells.push([x,z]);
    }
    if(!cells.length)throw new Error('请选择至少一格地形。');
    const plan=this.createLevelPlan(cells,c.target);
    this.refreshJobs();return{ok:true,id:plan.id,message:`已规划 ${cells.length} 格整地，目标标高 ${c.target}，等待居民填挖`};
  }
  private createLevelPlan(cells:[number,number][],target:number,buildingId?:string):TerrainPlan {
    for(const[x,z]of cells){const current=this.earthwork.get(this.cellKey(x,z));if(current&&current.target!==target)throw new Error('选区已有不同标高的整地蓝图，请先取消冲突计划。');
      const b=this.buildingAt.get(this.cellKey(x,z));if(b&&!b.complete&&b.id!==buildingId&&b.y!==target)throw new Error('目标标高与该处建筑地基冲突。');}
    const initialWork=cells.reduce((n,[x,z])=>n+Math.abs(this.world.terrainHeight(x,z)-target),0);
    const plan:TerrainPlan={id:this.id('terrain'),target,cells,initialWork,remainingCut:0,remainingFill:0,progress:0,state:'queued',...(buildingId?{buildingId}:{})};
    this.s.terrainPlans.push(plan);this.terrainIndexDirty=true;this.refreshTerrainPlans();return plan;
  }
  private orderBuild(kind: string|undefined, x: number|undefined, z: number|undefined,target?:number,rotation:number=0): CommandResult {
    this.validCell(x,z); const zz = z!;
    if (!kind || !(kind in BUILDING_DEFS)) throw new Error('未知建筑。');
    if(!Number.isInteger(rotation)||rotation<0||rotation>3)throw new Error('建筑朝向必须为 0、1、2、3。');
    const def = BUILDING_DEFS[kind as BuildingKind];
    if(def.id==='pastureGate') throw new Error('从牧场面板选择更改门位。');
    const pastureReason=this.pastureBuildingBlocker(def.id,x,zz,rotation);
    if(pastureReason)throw new Error(pastureReason);
    if (def.id === 'chest') return this.placeChest(x,z);
    if (def.research && !this.s.research.completed.includes(def.research)) throw new Error(`需要研究：${RESEARCH_DEFS[def.research]!.name}`);
    const {w,h,d}=buildingDimensions(def.id,rotation),y=target??this.world.terrainHeight(x,zz);this.validTarget(y);
    if(x+w>this.world.width||zz+d>this.world.depth||y+h>this.world.height)throw new Error('建筑整体超出地图范围。');
    const cells=this.footprint({x,z:zz,w,d});this.rebuildBuildings();
    if(cells.some(([xx,z])=>this.buildingAt.has(this.cellKey(xx,z))))throw new Error('建筑占地内已有建筑或蓝图。');
    if(cells.some(([xx,z])=>this.s.crops.some(p=>p.x===xx&&p.z===z)))throw new Error('请先取消建筑占地内的农田。');
    for(const[xx,z]of cells){const old=this.earthwork.get(this.cellKey(xx,z));if(old&&old.target!==y)throw new Error('建筑地基与已有整地目标冲突。');}
    const rotationValue=rotation as BuildingRotation;
    // Earthwork may cut natural soil/rock; authored voxels cannot disappear to make room for furniture.
    for(const p of buildingParts({kind:def.id,x,y,z:zz,rotation:rotationValue})){
      const block=this.world.get(p.x,p.y,p.z);
      if(block===BLOCK.SteelOre)throw new Error('物体体积内有铁矿，请先开采铁矿。');
      if(![BLOCK.Air,BLOCK.Water,BLOCK.Leaves,BLOCK.Grass,BLOCK.Dirt,BLOCK.Stone,BLOCK.Sand].includes(block as never))throw new Error('物体体积内有方块障碍，请先清理。');
    }
    const building: BuildingView = {id:this.id('building'),kind:def.id,x,y,z:zz,w,h,d,rotation:rotationValue,...(isSwingDoor(def.id)?{doorOpen:false}:{}),phase:'preparingTerrain',complete:false,progress:0,reserved:{},powered:false,comfort:0,roomId:null};
    this.s.buildings.push(building);this.rebuildBuildings();
    const plan=this.createLevelPlan(cells,y,building.id);building.terrainPlanId=plan.id;this.refreshJobs();
    this.event('info', `已规划${def.name}，地基整平后再施工。`);
    return {ok:true,message:`${def.name}蓝图已下达`,id:building.id};
  }
  private commandBuilding(c:ColonyCommand):BuildingView {
    const building=c.id?this.s.buildings.find(b=>b.id===c.id):Number.isInteger(c.y)?this.buildingAtVoxel(c.x!,c.y!,c.z!):undefined;
    if(!building)throw new Error('未找到该位置的完整物体。');return building;
  }
  private occupiedByActor(b:BuildingView):boolean {
    return !!this.externalOccupancy?.(b.x,b.y,b.z,b.w,b.h,b.d)||this.s.colonists.some(p=>p.position[0]+.23>b.x&&p.position[0]-.23<b.x+b.w&&p.position[2]+.23>b.z&&p.position[2]-.23<b.z+b.d&&p.position[1]+1.5>b.y&&p.position[1]<b.y+b.h);
  }
  private invalidateBuildingNavigation():void {
    this.rebuildBuildings();this.navigationDirty=true;this.updateRooms();
    for(const c of this.s.colonists){
      if(c.path.some(p=>!this.walkable(Math.floor(p[0]),Math.floor(p[2])))){this.releasePerson(c);c.retryAt=this.s.time;}
      else if(!c.jobId&&!c.personal)c.retryAt=this.s.time;
    }
  }
  private toggleDoor(c:ColonyCommand):CommandResult {
    const b=this.commandBuilding(c);
    if(!isSwingDoor(b.kind)||!b.complete)throw new Error('只能操作已建成的门。');
    if(b.doorOpen&&this.occupiedByActor(b))throw new Error('门口有人，请等离开后再关门。');
    b.doorOpen=!b.doorOpen;this.invalidateBuildingNavigation();this.refreshJobs();
    return{ok:true,id:b.id,message:b.doorOpen?'门已打开，可以通行':'门已关闭，阻挡通行并围合房间'};
  }
  private orderDemolition(command: ColonyCommand): CommandResult {
    const b = this.commandBuilding(command);
    if(this.isPastureBoundary(b))return {ok:false,message:'请使用牧场的更改门位，或取消空牧场后拆除围栏。'};
    if (!b.complete) return this.cancel(b.id);
    if (this.s.jobs.some(job => job.type === 'demolish' && job.targetId === b.id)) {
      return { ok: false, message: '这座设施已有拆除任务' };
    }
    const def = BUILDING_DEFS[b.kind];
    const job = this.addJob('demolish', b.id, b.x, b.y, b.z, def.work, `拆除${def.name}`);
    return { ok: true, id: job.id, message: `已发布${def.name}拆除任务，${this.s.speed ? '等待居民施工' : '恢复模拟后居民会前往施工'}` };
  }
  private dismantleBuilding(b: BuildingView, order: Job, worker: Colonist): void {
    for(const p of this.s.colonists)if(p.personal?.buildingId===b.id||p.personal&&p.destination?.[0]===b.x+.5&&p.destination?.[2]===b.z+.5)this.releasePerson(p);
    for(const job of [...this.s.jobs])if(job!==order&&(job.targetId===b.id||job.type==='research'&&job.x===b.x&&job.z===b.z))this.removeJob(job,true);
    this.s.buildings.splice(this.s.buildings.indexOf(b),1);
    for(const plan of this.s.terrainPlans)if(plan.buildingId===b.id)this.terrainCellViews.delete(plan.id);
    this.s.terrainPlans=this.s.terrainPlans.filter(p=>p.buildingId!==b.id);this.terrainIndexDirty=true;
    this.invalidateBuildingNavigation();
    let spilled = b.kind==='shelf' ? this.spillStorage(stack => stack.shelfId !== b.id) : 0;
    for (const slot of b.storage ?? []) {
      if (!slot) continue;
      this.drop(slot.resource, slot.count, b.x, b.z, {scatter:true,source:slot});
      spilled += slot.count;
    }
    this.drop(`building:${b.kind}`,1,b.x,b.z,{playerOnly:true});
    this.updatePower(0);this.refreshJobs();
    const message = `${worker.name}拆除了${BUILDING_DEFS[b.kind].name}，${spilled ? `箱体和 ${spilled} 件物品掉在地上` : '可在地上拾取'}`;
    this.event('info',message);
  }
  private terrainBlocker(x:number,z:number,target:number):string|undefined {
    const building=this.buildingAt.get(this.cellKey(x,z));
    if(building?.complete)return '等待拆除已完成建筑';
    if(this.s.crops.some(p=>p.x===x&&p.z===z))return '等待取消此处农田';
    if(this.terrainTrees(x,z,target).length)return '等待居民清理树木';
    if(this.world.waterSurfaceHeight(x,z)>target)return '目标地面仍有积水，请提高标高';
    // Ore must use the mining work/yield path, even above a low blueprint's immediate clearance.
    for(let y=target;y<Math.min(this.world.height,Math.max(target+2,this.world.terrainHeight(x,z)));y++)if(this.world.get(x,y,z)===BLOCK.SteelOre)return '请先开采铁矿，再继续整地';
    for(let y=target;y<Math.min(this.world.height,target+2);y++)if(![BLOCK.Air,BLOCK.Water,BLOCK.Leaves,BLOCK.Grass,BLOCK.Dirt,BLOCK.Stone,BLOCK.Sand].includes(this.world.get(x,y,z) as never))return '等待清理地面障碍';
    return undefined;
  }
  private buildingClearance(b:BuildingView):boolean {
    return buildingParts(b).every(p=>!this.world.treesAtVoxel(p.x,p.y,p.z).length&&(this.world.get(p.x,p.y,p.z)===BLOCK.Air||this.world.get(p.x,p.y,p.z)===BLOCK.Leaves));
  }
  /** Terrain edits and a pending building share the same whole-tree clearance dependencies. */
  private terrainTrees(x:number,z:number,target:number):TreeInstance[] {
    const trees=new Map<string,TreeInstance>(),trunk=this.world.treeAtColumn(x,z);
    if(trunk)trees.set(trunk.id,trunk);
    const building=this.buildingAt.get(this.cellKey(x,z));
    const ground=this.world.terrainHeight(x,z),top=Math.min(this.world.height,Math.max(ground,target+(building&&!building.complete?Math.max(2,building.h):2)));
    for(let y=Math.min(ground,target);y<top;y++)for(const tree of this.world.treesAtVoxel(x,y,z))trees.set(tree.id,tree);
    return [...trees.values()];
  }
  private planReason(id:string,reason:string|undefined,delta:number):void {
    if(!reason)return;let counts=this.terrainReasons.get(id);if(!counts){counts=new Map();this.terrainReasons.set(id,counts);}
    const value=(counts.get(reason)??0)+delta;if(value>0)counts.set(reason,value);else counts.delete(reason);
  }
  private refreshTerrainPlans():void {
    if(this.terrainIndexDirty||this.terrainIndexedRevision!==this.world.revision){
      this.earthwork.clear();this.terrainPending.clear();this.terrainReasons.clear();
      for(const plan of this.s.terrainPlans){
        if(plan.state==='completed'&&(!plan.buildingId||this.s.buildings.find(b=>b.id===plan.buildingId)?.complete))continue;
        plan.remainingCut=0;plan.remainingFill=0;let pending=0;
        for(const[x,z]of plan.cells){
          const key=this.cellKey(x,z),h=this.world.terrainHeight(x,z),delta=h-plan.target;
          plan.remainingCut+=Math.max(0,delta);plan.remainingFill+=Math.max(0,-delta);
          const blocker=this.terrainBlocker(x,z,plan.target);if(delta===0&&!blocker)continue;
          pending++;this.planReason(plan.id,blocker,1);
          let work=this.earthwork.get(key);if(!work){work={x,z,target:plan.target,height:h,plans:[],blockedReason:blocker};this.earthwork.set(key,work);}work.plans.push(plan.id);
        }
        this.terrainPending.set(plan.id,pending);
      }
      this.terrainIndexDirty=false;this.terrainIndexedRevision=this.world.revision;this.terrainScheduleDirty=true;
    }
    const active=new Set<string>(),waiting=new Set<string>();
    for(const job of this.s.jobs)if(job.type==='terraform')for(const id of this.earthwork.get(this.cellKey(job.x,job.z))?.plans??[]){if(job.assignedTo)active.add(id);if(job.state==='blocked')waiting.add(id);}
    for(const plan of this.s.terrainPlans){
      const pending=this.terrainPending.get(plan.id)??0;
      const reason=this.terrainReasons.get(plan.id)?.keys().next().value as string|undefined;
      plan.progress=pending?Math.min(.99,Math.max(0,1-(plan.remainingCut+plan.remainingFill)/Math.max(1,plan.initialWork))):1;
      plan.state=!pending?'completed':reason?'blocked':active.has(plan.id)?'working':waiting.has(plan.id)?'blocked':'queued';
      plan.blockedReason=reason??(waiting.has(plan.id)?'等待可达的相邻施工位置':undefined);
    }
  }
  /** A completed layer touches one column and its dependent counters, never the whole map. */
  private updateEarthworkCell(x:number,z:number):void {
    const key=this.cellKey(x,z),work=this.earthwork.get(key);if(!work)return;
    const h=this.world.terrainHeight(x,z),reason=this.terrainBlocker(x,z,work.target),complete=h===work.target&&!reason;
    for(const id of work.plans){const plan=this.s.terrainPlans.find(p=>p.id===id);if(!plan)continue;
      plan.remainingCut+=Math.max(0,h-work.target)-Math.max(0,work.height-work.target);
      plan.remainingFill+=Math.max(0,work.target-h)-Math.max(0,work.target-work.height);
      this.planReason(id,work.blockedReason,-1);this.planReason(id,reason,1);
      if(complete)this.terrainPending.set(id,Math.max(0,(this.terrainPending.get(id)??1)-1));
    }
    work.height=h;work.blockedReason=reason;if(complete)this.earthwork.delete(key);
    this.terrainIndexedRevision=this.world.revision;
  }
  private refreshTerraformJobs():void {
    this.rebuildBuildings();this.refreshTerrainPlans();
    const existing=new Set(this.s.jobs.filter(j=>j.type==='terraform').map(j=>j.targetId));
    const chopping=new Set(this.s.jobs.filter(j=>j.type==='chop').map(j=>j.targetId));
    const clearing=this.terrainClearingTrees;
    if(this.terrainScheduleDirty){
      clearing.clear();for(const work of this.earthwork.values())if(work.blockedReason==='等待居民清理树木')for(const tree of this.terrainTrees(work.x,work.z,work.target))clearing.set(tree.id,tree);
    }
    for(const job of [...this.s.jobs])if(job.type==='terraform'){
      const work=this.earthwork.get(this.cellKey(job.x,job.z));
      if(!work||work.blockedReason){this.removeJob(job,false);existing.delete(job.targetId);}
    }
    for(const job of [...this.s.jobs])if(job.type==='chop'&&(!this.world.getTree(job.targetId)||job.label==='清理整地树木'&&!clearing.has(job.targetId))){this.removeJob(job,false);chopping.delete(job.targetId);}
    for(const tree of clearing.values())if(chopping.size<96&&!chopping.has(tree.id)){this.queueChop(tree,'清理整地树木');chopping.add(tree.id);}
    if(this.terrainScheduleDirty||(existing.size<48&&this.s.time-this.lastTerrainSchedule>=1)){
    this.terrainScheduleDirty=false;this.lastTerrainSchedule=this.s.time;
    const buckets:Earthwork[][]=[];
    for(const work of this.earthwork.values()){
      const distance=Math.floor(Math.min(...this.s.colonists.map(c=>Math.abs(c.position[0]-work.x)+Math.abs(c.position[2]-work.z))));
      (buckets[distance]??=[]).push(work);
    }
    let count=existing.size;
    for(const bucket of buckets)for(const work of bucket??[]){
      if(count>=96)continue;
      const id=`earth:${work.x}:${work.z}`;
      if(!work.blockedReason&&!existing.has(id)){
        const h=this.world.terrainHeight(work.x,work.z);
        this.addJob('terraform',id,work.x,h,work.z,2,h>work.target?'挖低地形':'填高地形');existing.add(id);count++;
      }
    }
    }
    for(const b of this.s.buildings){
      if(b.complete){b.phase='completed';continue;}
      const plan=this.s.terrainPlans.find(p=>p.id===b.terrainPlanId);
      const ready=this.footprint(b).every(([x,z])=>this.world.terrainHeight(x,z)===b.y&&!this.terrainBlocker(x,z,b.y))&&this.buildingClearance(b);
      if(!ready||(plan&&plan.state!=='completed')){
        b.phase='preparingTerrain';b.blockedReason=plan?.blockedReason??(!this.buildingClearance(b)?'等待清理物体占用空间':undefined);
        for(const j of [...this.s.jobs])if(j.type==='construct'&&j.targetId===b.id)this.removeJob(j,false);
        continue;
      }
      b.blockedReason=undefined;
      if(!Object.keys(b.reserved).length){if(!this.afford(BUILDING_DEFS[b.kind].cost)){b.phase='readyToBuild';b.blockedReason='等待建筑材料';continue;}this.take(BUILDING_DEFS[b.kind].cost);b.reserved=copy(BUILDING_DEFS[b.kind].cost);}
      b.phase=b.progress>0?'constructing':'readyToBuild';
    }
  }
  private terraformStand(work:Earthwork,from:Position):Position[]|null {
    const h=this.world.terrainHeight(work.x,work.z);
    const options:Position[]=[];
    for(const[dx,dz]of [[1,0],[-1,0],[0,1],[0,-1]]){
      const x=work.x+dx!,z=work.z+dz!,y=this.groundY(x,z);
      if(this.walkable(x,z)&&Math.abs(y-h)<=1.01)options.push([x+.5,y,z+.5]);
    }
    options.sort((a,b)=>horizontalDistance(a,from)-horizontalDistance(b,from));
    for(const p of options){const route=this.path(from,p);if(route!==null)return route;}return null;
  }
  private canWorkBeside(b: BuildingView, x: number, z: number): boolean {
    const dx = Math.max(b.x - x, 0, x - (b.x + b.w - 1));
    const dz = Math.max(b.z - z, 0, z - (b.z + b.d - 1));
    return dx + dz === 1 && this.walkable(x, z) && Math.abs(this.groundY(x, z) - b.y) <= 1.01;
  }
  private buildingStands(b:BuildingView):Position[] {
    const options:Position[]=[];
    for(let z=b.z-1;z<=b.z+b.d;z++)for(let x=b.x-1;x<=b.x+b.w;x++){
      if(this.canWorkBeside(b,x,z))options.push([x+.5,this.groundY(x,z),z+.5]);
    }
    return options;
  }
  private buildingStand(b:BuildingView,from:Position):Position[]|null {
    const options=this.buildingStands(b);
    options.sort((a,b)=>horizontalDistance(a,from)-horizontalDistance(b,from));for(const p of options){const route=this.path(from,p);if(route!==null)return route;}return null;
  }
  private treeStand(tree:TreeInstance,from:Position):Position[]|null {
    const options:Position[]=[];
    for(const[dx,dz]of [[1,0],[-1,0],[0,1],[0,-1]]){
      const x=tree.x+dx!,z=tree.z+dz!,y=this.groundY(x,z);
      if(this.walkable(x,z)&&Math.abs(y-tree.y)<=1.01)options.push([x+.5,y,z+.5]);
    }
    options.sort((a,b)=>horizontalDistance(a,from)-horizontalDistance(b,from));
    for(const p of options){const route=this.path(from,p);if(route!==null)return route;}return null;
  }
  private mineStand(job:Job,from:Position):Position[]|null {
    const options:Position[]=[];
    for(const[dx,dz]of [[1,0],[-1,0],[0,1],[0,-1]]){
      const x=job.x+dx!,z=job.z+dz!,y=this.groundY(x,z);
      if(this.walkable(x,z)&&Math.abs(y-(job.y+1))<=1.01)options.push([x+.5,y,z+.5]);
    }
    options.sort((a,b)=>horizontalDistance(a,from)-horizontalDistance(b,from));
    for(const p of options){const route=this.path(from,p);if(route!==null)return route;}return null;
  }
  private miningTargetValid(job:Job):boolean {
    return job.y>0&&!this.buildingAt.get(this.cellKey(job.x,job.z))?.complete&&!this.world.treeAtColumn(job.x,job.z)
      &&this.world.surfaceHeight(job.x,job.z,false)===job.y&&mineableTerrain(this.world.get(job.x,job.y,job.z));
  }
  private finishTerraform(c:Colonist,job:Job):boolean {
    const work=this.earthwork.get(this.cellKey(job.x,job.z));
    if(!work||this.terrainBlocker(work.x,work.z,work.target)){this.removeJob(job,false);return false;}
    const h=this.world.terrainHeight(work.x,work.z);
    if(h===work.target){this.removeJob(job,false);return false;}
    const standX=Math.floor(c.position[0]),standZ=Math.floor(c.position[2]);
    // Work reach uses the same coarse ground as terraformStand; decorative treads only raise feet.
    if(Math.abs(this.groundY(standX,standZ)-h)>1.01||Math.abs(standX-work.x)+Math.abs(standZ-work.z)!==1){this.releasePerson(c);return false;}
    const occupiers=this.s.colonists.filter(p=>Math.floor(p.position[0])===work.x&&Math.floor(p.position[2])===work.z);
    if(occupiers.length){
      for(const p of occupiers){
        this.releasePerson(p);
        const destinations:[[number,number],[number,number],[number,number],[number,number]]=[[work.x+1,work.z],[work.x-1,work.z],[work.x,work.z+1],[work.x,work.z-1]];
        for(const[x,z]of destinations)if(this.walkable(x,z)&&this.route(p,[x+.5,this.groundY(x,z),z+.5])){p.personal={kind:'wander',elapsed:0,duration:1,reserved:{}};p.task='离开整地施工范围';break;}
      }
      job.progress=0;job.label='等待居民离开施工格';return false;
    }
    // Never remove the immutable bedrock; each atomic edit changes only one layer.
    if(h>work.target)this.world.set(work.x,h-1,work.z,BLOCK.Air);
    else this.world.set(work.x,h,work.z,h+1===work.target?BLOCK.Grass:BLOCK.Dirt);
    for(const item of this.s.items)if(item.x===work.x&&item.z===work.z)item.y=this.world.terrainHeight(work.x,work.z);
    this.refreshGroundCell(work.x,work.z);this.worldRevision=this.world.revision;this.navigationDirty=true;
    this.updateEarthworkCell(work.x,work.z);
    this.removeJob(job,false);this.refreshTerraformJobs();
    return true;
  }
  zoneCellBlocker(x:number,z:number):string | null {
    if (this.s.zones.some(zone => containsCell(zone,x,z))) return '区域不能相互重叠。';
    if (this.earthwork.has(this.cellKey(x,z))) return '选区包含整地施工格。';
    if (!this.walkable(x,z) || this.buildingAt.has(this.cellKey(x,z)) || this.world.treeAtColumn(x,z))
      return '区域包含水面、障碍或建筑，请选择空地。';
    return null;
  }
  private designate(c: ColonyCommand): CommandResult {
    if(c.kind==='chop')return this.designateChop(c);
    let x=c.x!, z=c.z!, w=c.w??1, d=c.d??1;
    if ((c.kind === 'farm' || c.kind === 'stockpile' || c.kind === 'pasture') && c.cells !== undefined) {
      if (!Array.isArray(c.cells) || !c.cells.length || c.cells.length>this.world.width*this.world.depth) throw new Error('请框选至少一格土地。');
      const seen=new Set<number>();
      let maxX=-1, maxZ=-1;
      x=this.world.width; z=this.world.depth;
      for (const cell of c.cells) {
        if (!Array.isArray(cell) || cell.length!==2) throw new Error('地格无效。');
        const [cx,cz]=cell;
        this.validCell(cx,cz);
        const key=this.cellKey(cx,cz);
        if (seen.has(key)) throw new Error('选区包含重复地格。');
        seen.add(key);
        x=Math.min(x,cx); z=Math.min(z,cz); maxX=Math.max(maxX,cx); maxZ=Math.max(maxZ,cz);
      }
      w=maxX-x+1; d=maxZ-z+1;
    } else this.validCell(x,z);
    if (!Number.isInteger(w)||!Number.isInteger(d)||w<1||d<1||w>this.world.width||d>this.world.depth||x+w>this.world.width||z+d>this.world.depth) throw new Error('区域必须位于地图内。');
    if (c.kind === 'farm' || c.kind === 'stockpile' || c.kind === 'pasture') {
      const crop = c.kind === 'farm' ? c.crop ?? DEFAULT_CROP : DEFAULT_CROP;
      if (!isCropKind(crop)) throw new Error('未知作物。');
      const { name, requires } = CROP_DEFS[crop];
      if (requires && !this.s.research.completed.includes(requires)) throw new Error(`${name}需要先完成${RESEARCH_DEFS[requires]!.name}研究。`);
      for (const [cx,cz] of c.cells ?? footprintCells({x,z,w,d})) {
        const reason=this.zoneCellBlocker(cx,cz);
        if (reason) throw new Error(reason);
      }
      if(c.kind==='pasture') return this.orderPasture({x,z,w,d,cells:c.cells});
      const zone=this.addZone(c.kind,x,z,w,d,crop,c.cells); this.refreshJobs();
      return {ok:true,message:c.kind==='farm'?'种植区已规划，居民会播种和收获':'仓储区已规划，居民会搬运落地物资',id:zone.id};
    }
    let added=0,treesBlockingMining=false;
    for(let zz=z;zz<z+d;zz++)for(let xx=x;xx<x+w;xx++) {
      if(c.kind==='mine') {
        if(this.world.treeAtColumn(xx,zz)){treesBlockingMining=true;continue;}
        if(this.buildingAt.get(this.cellKey(xx,zz))?.complete)continue;
        const y=this.world.surfaceHeight(xx,zz,false);
        const block=this.world.get(xx,y,zz);
        if(y>0 && mineableTerrain(block)
          && !this.s.jobs.some(j=>j.type==='mine'&&j.x===xx&&j.z===zz)) {this.addJob('mine',`rock:${xx}:${zz}:${y}`,xx,y,zz,19,block===BLOCK.SteelOre?'开采铁矿':'开采地表');added++;}
      } else if(c.kind==='harvest') {
        for(const crop of this.s.crops.filter(p=>p.x===xx&&p.z===zz&&p.planted&&p.growth>=0.95)) {
          if(!this.s.jobs.some(j=>j.type==='harvest'&&j.targetId===crop.id)){this.addJob('harvest',crop.id,xx,crop.y,zz,6,'收获'+CROP_DEFS[crop.kind].name);added++;}
        }
      } else throw new Error('未知区域或采集指令。');
    }
    if(!added)throw new Error(treesBlockingMining?'请先砍伐整棵树木，再开采树根下的地面。':'选区没有符合条件的树木、地表矿石或成熟作物。');
    return {ok:true,message:`已下达 ${added} 项工作`};
  }
  private designateChop(c:ColonyCommand):CommandResult {
    const trees=new Map<string,TreeInstance>();
    if(c.id){const tree=this.world.getTree(c.id);if(tree)trees.set(tree.id,tree);}
    else{
      this.validCell(c.x,c.z);const x=c.x!,z=c.z!,w=c.w??1,d=c.d??1;
      if(!Number.isInteger(w)||!Number.isInteger(d)||w<1||d<1||x+w>this.world.width||z+d>this.world.depth)throw new Error('区域必须位于地图内。');
      if(c.y!==undefined){
        if(!Number.isInteger(c.y)||c.y<0||c.y>=this.world.height)throw new Error('树木位置超出地图范围。');
        const tree=this.world.treeAtVoxel(x,c.y,z);if(tree)trees.set(tree.id,tree);
      }else if(w===1&&d===1){
        const tree=this.world.treeAtColumn(x,z)??this.world.treesInColumn(x,z)[0];if(tree)trees.set(tree.id,tree);
      }else for(let zz=z;zz<z+d;zz++)for(let xx=x;xx<x+w;xx++)for(const tree of this.world.treesInColumn(xx,zz))trees.set(tree.id,tree);
    }
    if(!trees.size)throw new Error('选区没有可砍伐的完整树木。');
    let added=0;for(const tree of trees.values())if(this.queueChop(tree,'砍伐树木'))added++;
    return{ok:true,message:added?`已下达 ${added} 项整树砍伐工作`:'整棵树已在砍伐队列中',...(trees.size===1?{id:trees.keys().next().value}:{} )};
  }
  private queueChop(tree:TreeInstance,label:string):boolean {
    const existing=this.treeChopJob(tree.id);
    if(existing){if(label==='砍伐树木')existing.label=label;return false;}
    this.addJob('chop',tree.id,tree.x,tree.y,tree.z,CHOP_WORK,label);return true;
  }
  private treeChopJob(treeId: string): Job | undefined {
    return this.s.jobs.find(job => job.type === 'chop' && job.targetId === treeId);
  }
  treeChopProgress(treeId: string): number | null {
    const job = this.treeChopJob(treeId);
    return job ? job.progress / job.work : null;
  }
  private pastureBuildingBlocker(kind:BuildingKind,x:number,z:number,rotation:number):string|null {
    const pen=this.s.zones.find(zone=>zone.kind==='pasture'&&containsCell(zone,x,z));
    if(kind==='milker'||kind==='henNest'||kind==='shearingStand'){
      if(!pen?.pasture)return '采集设施需要建在牧场内。';
      const free=this.pastureSpace(pen),animals=pen.pasture.animals;
      if(animals.some(a=>a.homeX===x&&a.homeZ===z)||!free.some(([cx,cz])=>cx===x&&cz===z)||
        free.length-1<animals.reduce((n,a)=>n+stockVolume(a),0))return '此处不能建造或会挤占动物所需容量。';
    }else{
      const dims=buildingDimensions(kind,rotation);
      if(this.footprint({x,z,...dims}).some(([cx,cz])=>this.s.zones.some(zone=>zone.pasture&&containsCell(zone,cx,cz))))return '牧场内请使用畜产采集设施。';
    }
    return null;
  }

  private isPastureBoundary(b:BuildingView):boolean {
    return (b.kind==='fence'||b.kind==='pastureGate')&&this.s.zones.some(z=>z.pasture&&containsCell(z,b.x,b.z));
  }

  private pastureSpace(zone:ZoneView):ZoneCell[] {
    return pastureLayout(zone).interior.filter(([x,z])=>this.walkable(x,z)&&!this.buildingAt.has(this.cellKey(x,z)));
  }

  private pastureReady(zone:ZoneView):boolean {
    return !!zone.pasture && pastureLayout(zone).border.every(([x,z])=>{
      const b=this.buildingAt.get(this.cellKey(x,z));
      return b?.complete && (b.kind==='fence'||b.kind==='pastureGate');
    });
  }

  private pastureGateFrom(area:ZoneView | {x:number;z:number;w:number;d:number;cells?:ZoneCell[]}, gates:ReturnType<typeof pastureLayout>['gates'], origin:Position) {
    // Reach the perimeter from outside, even before the first fence has been built.
    const sx=Math.floor(origin[0]),sz=Math.floor(origin[2]);
    const start=this.cellKey(sx,sz);
    if(!gates.length||containsCell(area,sx,sz))return undefined;
    const distances=new Map([[start,0]]),queue:ZoneCell[]=[[sx,sz]];
    const viable=gates.filter(g=>this.walkable(...g.outside)&&this.walkable(...g.inside)
      &&Math.abs(this.groundY(...g.cell)-this.groundY(...g.outside))<=1
      &&Math.abs(this.groundY(...g.cell)-this.groundY(...g.inside))<=1);
    if(!viable.length)return undefined;
    const targets=new Set(viable.map(g=>this.cellKey(...g.outside)));
    let shortest=Infinity;
    for(let i=0;i<queue.length;i++){
      const [x,z]=queue[i]!,distance=distances.get(this.cellKey(x,z))!;
      if(distance>shortest)break;
      if(targets.has(this.cellKey(x,z)))shortest=distance;
      if(distance>=shortest)continue;
      for(const [dx,dz] of [[0,1],[1,0],[0,-1],[-1,0]]){
        const xx=x+dx!,zz=z+dz!,key=this.cellKey(xx,zz);
        if(!this.walkable(xx,zz)||Math.abs(this.groundY(xx,zz)-this.groundY(x,z))>1||containsCell(area,xx,zz)||distances.has(key))continue;
        distances.set(key,distance+1);queue.push([xx,zz]);
      }
    }
    return choosePastureGate(area,viable,([x,z])=>distances.get(this.cellKey(x,z))??Infinity);
  }

  private plannedPastureGate(area:{x:number;z:number;w:number;d:number;cells?:ZoneCell[]},layout:ReturnType<typeof pastureLayout>){
    const storage=this.storageTarget(),candidates=[...(storage?[storage]:[]),...this.s.colonists.map(c=>c.position)];
    for(const from of candidates){const gate=this.pastureGateFrom(area,layout.gates,from);if(gate)return gate;}
    return undefined;
  }

  pasturePreview(cells:ZoneCell[]) {
    if(!cells.length)return undefined;
    const xs=cells.map(p=>p[0]),zs=cells.map(p=>p[1]),x=Math.min(...xs),z=Math.min(...zs);
    const area={x,z,w:Math.max(...xs)-x+1,d:Math.max(...zs)-z+1,cells},layout=pastureLayout(area);
    const gate=layout.connected?this.plannedPastureGate(area,layout)?.cell:undefined;
    return {capacity:layout.interior.length, border:layout.border,gate};
  }

  private orderPasture(area:{x:number;z:number;w:number;d:number;cells?:ZoneCell[]}):CommandResult {
    const layout=pastureLayout(area);
    if(!layout.connected||!layout.interior.length) throw new Error('牧场需要连通的内部和完整一圈围栏，请扩大或调整框选。');
    const gate=this.plannedPastureGate(area,layout);
    if(!gate) throw new Error('找不到通向营地的牧场入口。');
    const zone=this.addZone('pasture',area.x,area.z,area.w,area.d,DEFAULT_CROP,area.cells);
    zone.pasture={gate:gate.cell,animals:[]};
    for(const [x,z] of layout.border){
      const kind=x===gate.cell[0]&&z===gate.cell[1]?'pastureGate':'fence';
      this.s.buildings.push({id:this.id('building'),kind,x,z,y:this.world.terrainHeight(x,z),w:1,d:1,h:1,
        rotation:kind==='pastureGate'&&gate.outside[0]!==x?1:0,phase:'readyToBuild',complete:false,progress:0,reserved:{},powered:false,comfort:0,roomId:null});
    }
    this.invalidateBuildingNavigation();this.refreshJobs();
    return {ok:true,id:zone.id,message:'已规划牧场，居民将建造外围栏和牧场门'};
  }

  private changeGate(c:ColonyCommand):CommandResult {
    const zone=this.s.zones.find(p=>p.pasture&&containsCell(p,c.x!,c.z!)), pen=zone?.pasture;
    if(!zone||!pen||!this.pastureReady(zone)||pen.pendingGate)throw new Error('请选择围栏已完工的牧场。');
    const candidates=pastureLayout(zone).gates.filter(g=>g.cell[0]===c.x&&g.cell[1]===c.z&&this.walkable(...g.inside));
    const from=this.storageTarget()??this.s.colonists[0]!.position;
    const gate=this.pastureGateFrom(zone,candidates,from);
    if(!gate||this.buildingAt.get(this.cellKey(c.x!,c.z!))?.kind!=='fence')throw new Error('请选择内外均可通行的外围栏，不可用角格。');
    pen.pendingGate=gate.cell;
    const target=this.buildingAt.get(this.cellKey(...gate.cell))!;
    target.kind='pastureGate';target.rotation=gate.outside[0]!==target.x?1:0;target.complete=false;target.progress=0;target.phase='readyToBuild';
    this.invalidateBuildingNavigation();this.refreshJobs();
    return {ok:true,message:'已安排改门，新门建成后居民将补上旧门。'};
  }

  private orderHerd(c:ColonyCommand):CommandResult {
    const zone=this.s.zones.find(z=>z.id===c.id);
    if(!zone?.pasture||!this.pastureReady(zone)) throw new Error('请先完成牧场围栏和入口。');
    if(c.kind!==undefined&&!Object.hasOwn(STOCK_VOLUME,c.kind)) throw new Error('请选择牲畜。');
    const all=new Set(this.s.zones.flatMap(z=>z.pasture?.animals.map(a=>a.id)??[]));
    const [gx,gz]=zone.pasture.gate;
    const animals=visibleWildAnimals(this.world,this.s).filter(a=>{
      if(all.has(stockAnimalId(a))||(c.kind&&a.kind!==c.kind))return false;
      if(c.x===undefined||c.z===undefined)return !!c.kind;
      const pose=wildAnimalPose(a,this.s.time);
      return Math.hypot(pose.x-(c.x+.5),pose.z-(c.z+.5))<1.45;
    })
      .sort((a,b)=>Math.hypot(a.x-gx,a.z-gz)-Math.hypot(b.x-gx,b.z-gz));
    const wild=animals.find(a=>this.path([gx+.5,this.groundY(gx,gz),gz+.5],[a.x+.5,a.y,a.z+.5])!==null);
    if(!wild)throw new Error('找不到可到达的该种野生动物。');
    const space=this.pastureSpace(zone);
    const animal:HerdAnimal={id:stockAnimalId(wild),kind:wild.kind,young:wild.phase<.16,female:wild.phase<.82,
      state:'ordered',x:wild.x,z:wild.z,homeX:0,homeZ:0,readyAt:this.s.time};
    if(space.length<stockVolume(animal)+zone.pasture.animals.reduce((n,a)=>n+stockVolume(a),0))throw new Error('剩余容量不足。');
    const home=space.find(([x,z])=>!zone.pasture!.animals.some(a=>a.homeX===x&&a.homeZ===z))??space[0]!;
    [animal.homeX,animal.homeZ]=home;zone.pasture.animals.push(animal);
    this.addJob('herd',animal.id,wild.x,wild.y,wild.z,1,'领'+STOCK_NAMES[wild.kind]+'进牧场');
    return {ok:true,message:'已预留牧场容量，等待居民领入。'};
  }

  private refreshPastureJobs():void {
    for(const zone of this.s.zones){
      if(!zone.pasture||!this.pastureReady(zone))continue;
      for(const a of zone.pasture.animals){
        const harvest=pastureHarvest(a,this.s.time);
        if(!harvest||this.s.jobs.some(j=>j.targetId===a.id))continue;
        const station=this.s.buildings.find(b=>b.kind===harvest.station&&b.complete&&containsCell(zone,b.x,b.z)&&!this.s.jobs.some(j=>j.type==='husbandry'&&j.x===b.x&&j.z===b.z));
        if(!station)continue;
        if(harvest.station==='henNest'&&this.random()>=.5){a.readyAt=this.s.time+DAY_SECONDS*harvest.recoveryDays;continue;}
        this.addJob('husbandry',a.id,station.x,station.y,station.z,harvest.work,harvest.label);
      }
    }
  }

  private penFor(id:string) {
    const zone=this.s.zones.find(z=>z.pasture?.animals.some(a=>a.id===id));
    const animal=zone?.pasture?.animals.find(a=>a.id===id);
    return zone&&animal?{zone,animal}:null;
  }

  private assignPasture(c:Colonist,j:Job):boolean {
    const entry=this.penFor(j.targetId);
    if(!entry||!this.pastureReady(entry.zone))return false;
    const a=entry.animal;
    let path:Position[]|null=null;
    if(j.type==='herd'){
      const [x,z]=a.state==='leading'?[a.homeX,a.homeZ]:[a.x,a.z];
      path=this.path(c.position,[x+.5,this.groundY(x,z),z+.5]);
    }else{
      const b=this.buildingAt.get(this.cellKey(j.x,j.z));
      if(b?.complete&&containsCell(entry.zone,b.x,b.z)&&b.kind===pastureHarvest(a,this.s.time)?.station) path=this.buildingStand(b,c.position);
      else {this.removeJob(j,false);return false;}
    }
    if(!path){j.state='blocked';return false;}
    c.path=path;c.destination=path.at(-1)??c.position;c.jobId=j.id;j.assignedTo=c.id;j.state='working';return true;
  }

  private workPasture(c:Colonist,j:Job,dt:number):void {
    const entry=this.penFor(j.targetId);
    if(!entry){this.removeJob(j,false);return;}
    const {zone,animal:a}=entry;
    if(!this.pastureReady(zone)){this.releasePerson(c);return;}
    c.task=j.label;
    const arrived=this.move(c,dt);
    if(c.jobId!==j.id)return;
    if(j.type==='herd'&&a.state==='leading'){a.x=Math.floor(c.position[0]);a.z=Math.floor(c.position[2]);}
    if(!arrived)return;
    if(j.type==='herd'){
      if(a.state==='ordered'){
        a.state='leading';
        if(!this.route(c,[a.homeX+.5,this.groundY(a.homeX,a.homeZ),a.homeZ+.5])){a.state='ordered';this.releasePerson(c);}
        return;
      }
      a.state='home';a.x=a.homeX;a.z=a.homeZ;
      a.readyAt=this.s.time+(a.kind==='chicken'?180:0);
    }else{
      const b=this.buildingAt.get(this.cellKey(j.x,j.z));
      const harvest=pastureHarvest(a,this.s.time);
      if(!harvest||!b?.complete||!containsCell(zone,b.x,b.z)||b.kind!==harvest.station){this.removeJob(j,false);return;}
      if(!this.canWorkBeside(b,Math.floor(c.position[0]),Math.floor(c.position[2]))){this.releasePerson(c);return;}
      j.progress+=dt;
      if(j.progress<j.work)return;
      this.drop(harvest.output,harvest.yield,Math.floor(c.position[0]),Math.floor(c.position[2]));
      a.readyAt=this.s.time+DAY_SECONDS*harvest.recoveryDays;
    }
    this.s.metrics.jobsCompleted++;this.removeJob(j,false);
  }

  private addZone(kind:'farm'|'stockpile'|'pasture',x:number,z:number,w:number,d:number,crop:CropKind,cells?:ZoneCell[]):ZoneView {
    const zone:ZoneView={id:this.id('zone'),kind,x,y:Math.max(1,this.groundY(x,z)),z,w,d,crop,...(cells ? {cells:cells.map(([cx,cz]):ZoneCell=>[cx,cz])} : {})};this.s.zones.push(zone);
    if(kind==='farm')this.terrainIndexDirty=true;
    if(kind==='farm')for(const [xx,zz] of footprintCells(zone)) {
      const y=this.groundY(xx,zz); if(y<0||this.buildingAt.has(this.cellKey(xx,zz)))continue;
      this.s.crops.push({id:this.id('crop'),kind:crop,x:xx,y,z:zz,growth:0,planted:false});
    }
    return zone;
  }
  private cancel(id: string|undefined):CommandResult {
    if (id?.startsWith(SHELF_ZONE_PREFIX) && this.shelves().some(shelf => SHELF_ZONE_PREFIX + shelf.id === id)) {
      return {ok:false,message:'拆除储物架即可移除它的仓储规划'};
    }
    const building=this.s.buildings.find(b=>b.id===id);
    if(building) {
      if(this.isPastureBoundary(building))throw new Error('请在规划面板取消整个空牧场。');
      if(building.complete)throw new Error('已完工建筑不可作为蓝图取消。');
      this.give(building.reserved); building.reserved={};
      for(const job of [...this.s.jobs])if(job.targetId===building.id)this.removeJob(job,true);
      this.s.buildings.splice(this.s.buildings.indexOf(building),1);
      for(const p of this.s.terrainPlans)if(p.buildingId===building.id)this.terrainCellViews.delete(p.id);
      this.s.terrainPlans=this.s.terrainPlans.filter(p=>p.buildingId!==building.id);this.terrainIndexDirty=true;this.invalidateBuildingNavigation();this.refreshJobs();
      return {ok:true,message:'蓝图已取消，未消耗预约材料已退还'};
    }
    const plan=this.s.terrainPlans.find(p=>p.id===id);
    if(plan){
      if(plan.buildingId)return this.cancel(plan.buildingId);
      this.s.terrainPlans.splice(this.s.terrainPlans.indexOf(plan),1);this.terrainCellViews.delete(plan.id);this.terrainIndexDirty=true;this.refreshJobs();
      return{ok:true,message:'整地蓝图已取消，已经完成的地形保留'};
    }
    const terraform=this.s.jobs.find(j=>j.id===id&&j.type==='terraform');
    if(terraform){const work=this.earthwork.get(this.cellKey(terraform.x,terraform.z));if(work?.plans[0])return this.cancel(work.plans[0]);}
    const job=this.s.jobs.find(j=>j.id===id);if(job){if(job.type==='herd'){const p=this.penFor(job.targetId)?.zone.pasture;if(p)p.animals=p.animals.filter(a=>a.id!==job.targetId);}this.removeJob(job,true);return{ok:true,message:'工作订单已取消'};}
    const zone=this.s.zones.find(z=>z.id===id);
    if(zone){
      if(zone.pasture?.animals.length) throw new Error('请先安置已收纳的动物。');
      if(zone.kind==='stockpile'&&!this.shelves().length&&this.s.zones.filter(z=>z.kind==='stockpile').length===1)throw new Error('请保留至少一处仓储区。');
      const crops=this.s.crops.filter(p=>containsCell(zone,p.x,p.z));
      for(const job of [...this.s.jobs])if(crops.some(p=>p.id===job.targetId))this.removeJob(job,true);
      this.s.crops=this.s.crops.filter(p=>!crops.includes(p));this.s.zones.splice(this.s.zones.indexOf(zone),1);
      if(zone.pasture){
        for(const b of [...this.s.buildings])if(!b.complete&&(b.kind==='pastureGate'||b.kind==='fence')&&containsCell(zone,b.x,b.z))this.cancel(b.id);
      }
      if(zone.kind==='stockpile')this.spillStorage(stack => !!stack.shelfId || !containsCell(zone,stack.x,stack.z));
      this.terrainIndexDirty=true;this.refreshJobs();
      return{ok:true,message:'区域已取消'};
    }
    throw new Error('未找到可取消的蓝图、区域或工作。');
  }
  private refreshGroundCell(x:number,z:number):void {
    let y=-1;
    for(let h=1;h<this.world.height-1;h++) {
      const under=this.world.get(x,h-1,z),feet=this.world.get(x,h,z),head=this.world.get(x,h+1,z);
      // Natural tree parts share the player's collision volume; loose authored leaves stay soft.
      if(under!==BLOCK.Air&&under!==BLOCK.Water&&under!==BLOCK.Wood&&under!==BLOCK.Leaves
        &&(feet===BLOCK.Air||feet===BLOCK.Leaves)&&(head===BLOCK.Air||head===BLOCK.Leaves)
        &&!this.world.treesAtVoxel(x,h,z).length&&!this.world.treesAtVoxel(x,h+1,z).length){y=h;break;}
    }
    this.ground[x+z*this.world.width]=y;
  }
  private refreshGround():void {
    for(let z=0;z<this.world.depth;z++)for(let x=0;x<this.world.width;x++)this.refreshGroundCell(x,z);
    this.worldRevision=this.world.revision;
  }
  private syncWorld():void {
    if(this.world.revision===this.worldRevision)return;
    this.refreshGround();this.navigationDirty=true;
    this.moveObstructedGroundStorage();
    this.refreshTreeJobs();
  }
  private refreshTreeJobs():void {
    for(const job of [...this.s.jobs])if(job.type==='chop'&&!this.world.getTree(job.targetId)
      ||job.type==='mine'&&!this.miningTargetValid(job))this.removeJob(job,false);
  }
  private groundY(x:number,z:number):number {return x>=0&&x<this.world.width&&z>=0&&z<this.world.depth?this.ground[x+z*this.world.width]??-1:-1;}
  getGroundHeight(x:number,z:number):number{if(this.world.revision!==this.worldRevision)this.refreshGround();return this.groundY(x,z);}
  private walkable(x:number,z:number):boolean {
    return this.groundY(x,z)>=1&&!this.blockedCells.has(this.cellKey(x,z));
  }
  private closestOpen(x:number,z:number,avoidBlueprint=false,accept?: (position: Position) => boolean):Position|null {
    for(let radius=0;radius<12;radius++)for(let dz=-radius;dz<=radius;dz++)for(let dx=-radius;dx<=radius;dx++) {
      if(Math.max(Math.abs(dx),Math.abs(dz))!==radius)continue;
      const xx=Math.floor(x)+dx,zz=Math.floor(z)+dz;
      if(!this.walkable(xx,zz)||avoidBlueprint&&this.buildingAt.has(this.cellKey(xx,zz)))continue;
      const position: Position = [xx+.5,this.groundY(xx,zz),zz+.5];
      if (!accept || accept(position)) return position;
    }return null;
  }
  /** Reusable A* buffers keep local work affordable on a 250×250 map. */
  private path(from:Position,to:Position,adjacent=false,avoid?:ReadonlySet<number>,maxSteps=Infinity,operableDoors=false):Position[]|null {
    const sx=Math.floor(from[0]),sz=Math.floor(from[2]),tx=Math.floor(to[0]),tz=Math.floor(to[2]);
    const start=sx+sz*this.world.width;
    if(sx<0||sz<0||sx>=this.world.width||sz>=this.world.depth)return null;
    const goals=new Set<number>();
    for(const [dx,dz]of adjacent?[[1,0],[-1,0],[0,1],[0,-1]]:[[0,0]])if(this.walkable(tx+dx,tz+dz)){
      const cell=this.cellKey(tx+dx,tz+dz);if(!avoid?.has(cell))goals.add(cell);
    }
    if(goals.has(start))return[];
    if(!goals.size)return null;
    const stamp=++this.pathStamp,parents=this.pathParents,seen=this.pathSeen,cost=this.pathCost;
    if(stamp>=0xfffffffe){this.pathStamp=1;seen.fill(0);return this.path(from,to,adjacent,avoid,maxSteps,operableDoors);}
    const heap:{cell:number;score:number;cost:number}[]=[];
    const push=(cell:number,g:number)=>{let i=heap.length;const row={cell,cost:g,score:g+Math.abs(cell%this.world.width-tx)+Math.abs(Math.floor(cell/this.world.width)-tz)};heap.push(row);while(i>0){const p=(i-1)>>1;if(heap[p]!.score<=row.score)break;heap[i]=heap[p]!;i=p;}heap[i]=row;};
    const pop=()=>{const row=heap[0]!,last=heap.pop()!;if(heap.length){let i=0;while(i*2+1<heap.length){let next=i*2+1;if(next+1<heap.length&&heap[next+1]!.score<heap[next]!.score)next++;if(heap[next]!.score>=last.score)break;heap[i]=heap[next]!;i=next;}heap[i]=last;}return row;};
    let found=-1;parents[start]=-1;seen[start]=stamp;cost[start]=0;push(start,0);
    while(heap.length){
      const row=pop(),cur=row.cell;if(row.cost!==cost[cur])continue;
      if(goals.has(cur)){found=cur;break;}
      const x=cur%this.world.width,z=Math.floor(cur/this.world.width),h=this.groundY(x,z);
      for(const[dx,dz]of [[1,0],[-1,0],[0,1],[0,-1]]){
        const nx=x+dx!,nz=z+dz!;
        if(!this.walkable(nx,nz) && !(operableDoors && this.groundY(nx,nz)>=1 && isSwingDoor(this.buildingAt.get(this.cellKey(nx,nz))?.kind??'')))continue;
        if(Math.abs(this.groundY(nx,nz)-h)>1.01)continue;
        const next=nx+nz*this.world.width,g=row.cost+1;
        if(g>maxSteps||avoid?.has(next)||seen[next]===stamp&&cost[next]!<=g)continue;
        parents[next]=cur;seen[next]=stamp;cost[next]=g;push(next,g);
      }
    }
    if(found<0)return null;
    const result:Position[]=[];
    for(let cell=found;cell!==start;cell=parents[cell]!)result.push([cell%this.world.width+0.5,this.groundY(cell%this.world.width,Math.floor(cell/this.world.width)),Math.floor(cell/this.world.width)+0.5]);
    return result.reverse();
  }
  private route(c:Colonist,target:Position,adjacent=false):boolean {
    const path=this.path(c.position,target,adjacent);if(path===null)return false;c.path=path;c.destination=target;return true;
  }
  private move(c:Colonist,dt:number):boolean {
    const speed = c.health < 35 ? .8 : c.personal?.kind === 'wander' ? 1.35 : 2.1;
    return this.walkResidentPath(c, c.path, dt * speed * (c.hunger < 15 ? .7 : 1));
  }

  private residentAt(position:Position, exceptId?:string):Colonist|undefined {
    return this.s.colonists.find(other => other.id !== exceptId && residentsOverlap(position, other.position));
  }

  residentBlocksMove(from:Position, to:Position, id:string):boolean {
    return !!this.blockingResident(from,to,id);
  }

  private blockingResident(from:Position, to:Position, id:string):Colonist|undefined {
    return this.s.colonists.find(other => other.id !== id && residentsOverlap(to, other.position) &&
      (!residentsOverlap(from, other.position) || horizontalDistance(to, other.position) <= horizontalDistance(from, other.position)));
  }

  residentVerticalLimit(position:Position, nextY:number, id:string):number {
    const feet=position[1], climbing=nextY>feet;
    let limit=nextY;
    for(const other of this.s.colonists){
      if(other.id===id||!residentsTouchHorizontally(position,other.position))continue;
      const edge=other.position[1]+(climbing?-RESIDENT_HEIGHT:RESIDENT_HEIGHT);
      if(climbing&&feet<=edge+1e-6)limit=Math.min(limit,edge);
      if(!climbing&&feet>=edge-1e-6)limit=Math.max(limit,edge);
    }
    return limit;
  }

  private detourResident(c:Colonist, route:Position[]):boolean {
    const occupied = new Set<number>();
    for (const other of this.s.colonists) {
      const [x,y,z] = other.position;
      if (other !== c && Math.abs(y - c.position[1]) < RESIDENT_HEIGHT && horizontalDistance(c.position, other.position) < 5) {
        occupied.add(this.cellKey(Math.floor(x), Math.floor(z)));
      }
    }
    for (let i=0; i<Math.min(route.length,4); i++) {
      const waypoint=route[i]!;
      if (this.residentAt(waypoint, c.id)) continue;
      const path=this.path(c.position,waypoint,false,occupied,8);
      if (!path?.length || horizontalDistance(path[0]!,route[0]!)<.01) continue;
      if (horizontalDistance(path[path.length-1]!,waypoint)>.01) path.push(waypoint);
      route.splice(0,i+1,...path);
      return true;
    }
    return false;
  }

  private walkResidentPath(c:Colonist, route:Position[], remaining:number, procession=false):boolean {
    while (remaining>1e-8 && route.length) {
      const next=route[0]!, x=Math.floor(next[0]), z=Math.floor(next[2]);
      if (!procession && (!this.walkable(x,z) || Math.abs(next[1]-this.groundY(x,z))>.1)) {
        this.releasePerson(c); c.retryAt=this.s.time+1; return false;
      }
      const nextHeight=this.walkSurface?.(next[0],next[2],next[1])??next[1];
      const currentSurface=this.walkSurface?.(c.position[0],c.position[2],NaN);
      const detailed=Number.isFinite(currentSurface)||nextHeight!==next[1];
      const [px,py,pz]=c.position, dx=next[0]-px, dz=next[2]-pz;
      const distance=procession||detailed?Math.hypot(dx,dz):Math.hypot(dx,next[1]-py,dz);
      const step=Math.min(remaining,.2,distance);
      const fraction=distance<1e-8?1:step/distance;
      const to:Position=[px+dx*fraction, fraction===1?nextHeight:py+(next[1]-py)*fraction, pz+dz*fraction];
      if(this.walkSurface)to[1]=this.walkSurface(to[0],to[2],to[1]);
      const blocker=this.blockingResident(c.position,to,c.id);
      if(blocker){
        const next=(procession?this.processionPaths.get(blocker.id):blocker.path)?.[0];
        // Give a resident already turning away time to clear the shared lane.
        if(next){
          const [bx,by,bz]=blocker.position, stride=Math.min(1,.25/horizontalDistance(blocker.position,next));
          const predicted:Position=[bx+(next[0]-bx)*stride,by,bz+(next[2]-bz)*stride];
          if(horizontalDistance(c.position,predicted)>horizontalDistance(c.position,blocker.position)+.012)return false;
        }
        if(!this.detourResident(c,route) && !procession && c.personal?.kind==='wander')this.releasePerson(c);
        return false;
      }
      if(Math.hypot(dx,dz)>.001)c.facing=Math.atan2(dx,dz);
      c.position=to;
      if(fraction===1)route.shift();
      remaining-=step;this.s.metrics.distanceWalked+=step;
    }
    return route.length===0;
  }
  private shelves():BuildingView[] {
    return this.s.buildings.filter(b => b.kind === 'shelf' && b.complete);
  }

  private zones():ZoneView[] {
    return [...this.s.zones, ...this.shelves().map(({id,x,y,z,w,d,storageClass}):ZoneView =>
      ({id:SHELF_ZONE_PREFIX + id, shelfId:id, kind:'stockpile',x,y,z,w,d,crop:DEFAULT_CROP,...(storageClass ? {storageClass} : {})}))];
  }

  private groundStockpileAt(x:number,z:number):boolean {
    return this.s.zones.some(zone => zone.kind === 'stockpile' && containsCell(zone,x,z));
  }

  private canStoreOnGround(x:number,z:number):boolean {
    const building = this.buildingAt.get(this.cellKey(x,z));
    return this.walkable(x,z) && (!building || building.kind === 'floor' && building.complete);
  }

  private storageAccessAt(x:number,z:number):boolean {
    return this.canStoreOnGround(x,z) && this.groundStockpileAt(x,z)
      || this.shelves().some(shelf => this.canWorkBeside(shelf,x,z));
  }

  private *groundStorageCells():Iterable<{stand:Position; storageClass?:StorageClass}> {
    for (const zone of this.s.zones) {
      if (zone.kind !== 'stockpile') continue;
      for(const [x,z] of footprintCells(zone)){
        if(this.canStoreOnGround(x,z))yield {stand:[x+.5,this.groundY(x,z),z+.5],storageClass:zone.storageClass};
      }
    }
  }

  private storageTarget(from?:Position):Position|null {
    const cells=[...this.groundStorageCells()].map(cell=>cell.stand);
    for (const shelf of this.shelves()) cells.push(...this.buildingStands(shelf));
    if(from)cells.sort((a,b)=>horizontalDistance(from,a)-horizontalDistance(from,b));
    for(const p of cells)if(!from||this.path(from,p)!==null)return p;
    return null;
  }

  private storageOptions(resource:Resource, from?:Position):{
    slot:WarehouseSlot; capacity:number; rank:number; stands:Position[];
  }[] {
    const stacks = warehouseSlotContents(this.s.warehouseStacks);
    const bays = warehouseBayContents(this.s.warehouseStacks);
    const cards = isWarehouseCard(resource);
    const options:{slot:WarehouseSlot;capacity:number;rank:number;stands:Position[]}[] = [];
    const preferred = storageClassFor(resource);
    const addBay = (bay:WarehouseSlot, stands:Position[], storageClass:StorageClass='general') => {
      if (!stands.length || storageClass !== 'general' && storageClass !== preferred) return;
      const occupied=bays.get(warehouseBayKey(bay));
      if (occupied && occupied.cards !== cards) return;
      for (let quarter=0;quarter<STORAGE_QUARTERS;quarter++) {
        const mask=packageMask(resource,quarter);
        if (!mask) continue;
        const slot={...bay,slot:bay.slot+quarter};
        const contents=stacks.get(warehouseSlotKey(slot));
        const same=contents?.some(stack => stack.resource===resource);
        if (contents ? !cards&&!same : (mask & (occupied?.mask??0))!==0) continue;
        const capacity=WAREHOUSE_STACK_LIMIT-(contents?.reduce((sum,stack) => sum+stack.count,0)??0);
        if (!capacity) continue;
        const classRank = storageClass==='general' ? 8 : 0;
        options.push({slot,capacity,rank:classRank+(slot.shelfId ? 0 : 4)+(same ? 0 : contents ? 1 : occupied ? 2 : 3),stands});
      }
    };
    for (const shelf of this.shelves()) {
      const stands = this.buildingStands(shelf);
      for (let bay=0;bay<SHELF_BAYS;bay++) addBay({x:shelf.x,z:shelf.z,shelfId:shelf.id,slot:bay*STORAGE_QUARTERS},stands,shelf.storageClass);
    }
    for (const {stand,storageClass} of this.groundStorageCells()) addBay({x:Math.floor(stand[0]),z:Math.floor(stand[2]),slot:0},[stand],storageClass);
    const distance = (positions:Position[]) => from ? Math.min(...positions.map(p => horizontalDistance(p,from))) : 0;
    options.sort((a,b) => a.rank-b.rank || distance(a.stands)-distance(b.stands));
    return options;
  }

  private haulDestination(resource:Resource, from:Position) {
    const unreachable = new Set<number>();
    for (const option of this.storageOptions(resource,from)) {
      const stands = [...option.stands].sort((a,b) => horizontalDistance(a,from)-horizontalDistance(b,from));
      for (const stand of stands) {
        const key=this.cellKey(Math.floor(stand[0]),Math.floor(stand[2]));
        if (unreachable.has(key)) continue;
        const path=this.path(from,stand);
        if (path !== null) return {...option,stand,path};
        unreachable.add(key);
      }
    }
    return null;
  }

  private updateColdStorage(dt: number): void {
    const day = this.day();
    for (const stack of this.s.warehouseStacks) {
      if (!coldEffect(stack.resource)) continue;
      const expired = stack.premium && stack.premium.day !== day;
      if (expired) delete stack.premium;
      if (!this.s.power.coldStorage) {
        delete stack.freezing;
        continue;
      }
      const lots = stack.freezing ?? [];
      let tracked = premiumCount(stack, day);
      for (const lot of lots) tracked += lot.count;
      if (tracked < stack.count) lots.push({ since: expired ? this.s.time : this.s.time - dt, count: stack.count - tracked });
      while (lots.length && this.s.time - lots[0]!.since >= DAY_SECONDS) {
        addPremium(stack, lots.shift()!.count, day);
      }
      if (lots.length) stack.freezing = lots;
      else delete stack.freezing;
    }
  }

  private putInStorage(slot:WarehouseSlot, resource:Resource, count:number, premium = 0):void {
    if (!count) return;
    const key=warehouseSlotKey(slot);
    let stack = this.s.warehouseStacks.find(existing => existing.resource===resource&&warehouseSlotKey(existing)===key);
    if (!stack) { stack = {...slot,resource,count:0}; this.s.warehouseStacks.push(stack); }
    stack.count += count;
    addPremium(stack, premium, this.day());
  }

  private putInAvailableStorage(resource:Resource, amount:number, source?:ColdMark):number {
    if (!amount) return 0;
    let left = amount;
    for (const option of this.storageOptions(resource)) {
      const count = Math.min(left,option.capacity);
      this.putInStorage(option.slot,resource,count,takePremium(source,count,this.day()));
      left -= count;
      if (!left) break;
    }
    return amount-left;
  }

  private storeInitialSupplies():void {
    // Larger stock types use the shelf slots efficiently. Preserve any stock above the
    // available capacity as supplies in the existing warehouse balance.
    const resources = [...RESOURCE_TYPES].sort((a,b) => this.s.resources[b]-this.s.resources[a]);
    for (const resource of resources) this.putInAvailableStorage(resource,this.s.resources[resource]);
  }

  private withdrawStock(resource:Resource, amount:number, record?:(count:number,stack?:StoredStack)=>void):number {
    if (!amount) return 0;
    let premium = 0;
    const stacks = this.s.warehouseStacks.filter(stack => stack.resource === resource);
    const stored = stacks.reduce((sum,stack) => sum+stack.count,0);
    let left = Math.max(0,amount-(this.s.resources[resource]-stored));
    if (left < amount) record?.(amount-left);
    this.s.resources[resource] -= amount;
    for (const stack of stacks.sort((a,b) => Number(!!a.shelfId)-Number(!!b.shelfId))) {
      const count = Math.min(left,stack.count);
      if (count) record?.(count,stack);
      const qualified = takePremium(stack,count,this.day());
      premium += qualified;
      let ordinary = count-qualified;
      // Consume the oldest cooling batches first; newly added units keep their own clock.
      while (ordinary && stack.freezing?.length) {
        const lot = stack.freezing[0]!;
        const take = Math.min(ordinary,lot.count);
        ordinary -= take;
        lot.count -= take;
        if (!lot.count) stack.freezing.shift();
      }
      stack.count -= count;
      left -= count;
      if (stack.count === 0) this.s.warehouseStacks.splice(this.s.warehouseStacks.indexOf(stack),1);
      if (!left) break;
    }
    return premium;
  }

  private tradeWithGuide(side:TradeSide, item:Resource, count:number|undefined, expectedTotal:number|undefined,merchantId:MerchantId='guide'):CommandResult {
    if (!count || !Number.isSafeInteger(count) || count < 1) throw new Error('请输入有效的交易件数');
    const day = this.day();
    const quote = merchantOrder({day, warehouseStacks:this.s.warehouseStacks, guideHousing:this.guideHousing,specialistMarket:this.projectMarket(this.clutterCells())}, side, item, count,merchantId);
    if (expectedTotal !== quote.total || !Number.isSafeInteger(quote.total)) throw new Error('报价已变，请重新确认');
    const buying = side === 'buy';
    const payment = buying ? 'silver' : item, received = buying ? item : 'silver';
    const debit = buying ? quote.total : count, credit = buying ? count : quote.total;
    if (this.s.resources[payment] < debit) throw new Error(buying ? '银币不足' : '仓库货物不足');
    if (!Number.isSafeInteger(this.s.resources[received] + credit)) throw new Error('余额超出可结算范围');
    if(quote.eventId){
      const market=this.s.specialistMarket;
      const next=reserveMarketQuota(market.events,day,quote.eventId,count);
      if(!next)throw new Error('活动剩余额度不足');
      market.events=next;
    }
    const sale:GuideSale = {merchantId,...(quote.eventId?{eventId:quote.eventId}:{}),side,item,count,premium:quote.premiumCount,total:quote.total,delivered:0,paid:0,inTransit:0,lots:[]};
    if (buying) {
      this.withdrawStock('silver',quote.total);
      const [x,y,z]=this.merchantPosition(merchantId);
      const job=this.addJob('haul','guide-delivery',Math.floor(x),y,Math.floor(z),1,'采购待取 · 等待居民');
      job.guideSale=sale;job.reserved={silver:quote.total};
      return {ok:true,message:`已预留 ${quote.total} 银币，居民将领取${RESOURCE_NAMES[item]} × ${count}`};
    }
    const reserve = (amount:number,stack?:StoredStack,qualified=0) => {
      const x=stack?.x??0, z=stack?.z??0, shelfId=stack?.shelfId;
      const lot=sale.lots.find(l=>l.x===x && l.z===z && l.shelfId===shelfId && !!l.overflow===!stack);
      if(lot) {lot.count+=amount;lot.premium=(lot.premium??0)+qualified;}
      else sale.lots.push({x,z,count:amount,premium:qualified,shelfId,...(!stack?{overflow:true}:{})});
    };
    let remainingPremium = quote.premiumCount;
    for (const stack of [...this.s.warehouseStacks]) {
      if (!remainingPremium) break;
      if (stack.resource !== item) continue;
      const removed = takePremium(stack, remainingPremium, day);
      if (removed) reserve(removed,stack,removed);
      remainingPremium -= removed;
      stack.count -= removed;
      this.s.resources[item] -= removed;
      if (!stack.count) this.s.warehouseStacks.splice(this.s.warehouseStacks.indexOf(stack), 1);
    }
    this.withdrawStock(item,count-quote.premiumCount,reserve);
    const [gx,gy,gz]=this.merchantPosition(merchantId);
    const job=this.addJob('haul','guide-delivery',Math.floor(gx),gy,Math.floor(gz),1,merchantName(merchantId)+'回收 · 待取货');
    job.guideSale=sale; job.reserved={[item]:count};
    if (sale.premium) job.quality={[item]:{premium:{day,count:sale.premium}}};
    return {ok:true,message:`已预约${RESOURCE_NAMES[item]} × ${count}，交付后共收 ${quote.total} 银币`};
  }

  private spillStorage(keep:(stack:StoredStack)=>boolean):number {
    let spilled=0;
    this.s.warehouseStacks=this.s.warehouseStacks.filter(stack => {
      if (keep(stack)) return true;
      this.s.resources[stack.resource] -= stack.count;
      const stand=this.closestOpen(stack.x,stack.z);
      this.drop(stack.resource,stack.count,Math.floor(stand?.[0]??stack.x),Math.floor(stand?.[2]??stack.z),{source:stack});
      spilled+=stack.count;
      return false;
    });
    return spilled;
  }

  private moveObstructedGroundStorage():void {
    const obstructed = this.s.warehouseStacks.filter(stack => {
      const building = this.buildingAt.get(this.cellKey(stack.x,stack.z));
      return !stack.shelfId && (!this.walkable(stack.x,stack.z) || building?.complete && building.kind !== 'floor');
    });
    for (const stack of obstructed) {
      this.s.warehouseStacks.splice(this.s.warehouseStacks.indexOf(stack),1);
      const remaining = stack.count-this.putInAvailableStorage(stack.resource,stack.count,stack);
      if (!remaining) continue;
      this.s.resources[stack.resource] -= remaining;
      const stand=this.closestOpen(stack.x,stack.z);
      this.drop(stack.resource,remaining,Math.floor(stand?.[0]??stack.x),Math.floor(stand?.[2]??stack.z),{source:stack});
    }
  }
  private treeBase(x:number,z:number):number{return this.world.treeAtColumn(x,z)?.y??-1;}
  /**
   * 玩家亲手砍倒一棵树（角色视角按住左键）。
   *
   * 和随从砍完的效果一致：整棵移除、掉落 trunkHeight*6 木材。
   * 但玩家不经过 job 队列——所以这里要顺手清掉这棵树可能挂着的待办，
   * 否则随从会走到一棵已经不存在的树旁边站着。
   */
  /**
   * 玩家亲手推进一棵树的砍伐进度（按工作量算，不是按秒）。
   *
   * 关键点：进度写进**同一条 chop job**，所以玩家和随从砍的是同一个进度条。
   * 玩家砍一半松手，随从走过去接着砍剩下的，不会重复劳动。
   * 返回 0 到 1 的工作进度，让 HUD 能显示。
   */
  playerChipTree(treeId:string,work:number):{felled:boolean;progress:number;wood:number;message:string}{
    const tree=this.world.getTree(treeId);
    if(!tree)return{felled:false,progress:0,wood:0,message:'这棵树已经不在了'};
    // 没有任务就先挂一个：随从之后看到它就会过来接手
    const job=this.treeChopJob(treeId)??this.addJob('chop',treeId,tree.x,tree.y,tree.z,CHOP_WORK,'砍伐树木');
    job.progress=Math.min(job.work,job.progress+Math.max(0,work));
    if(job.progress>=job.work){
      const result=this.playerFellTree(treeId);
      return{felled:true,progress:1,wood:result.wood,message:result.message};
    }
    return{felled:false,progress:job.progress/job.work,wood:0,message:`砍伐中 ${workPercent(job.progress, job.work)}%`};
  }

  playerFellTree(treeId:string):{ok:boolean;wood:number;message:string}{
    const tree=this.world.getTree(treeId);
    if(!tree)return{ok:false,wood:0,message:'这棵树已经不在了'};
    this.world.removeTree(tree.id,{recordHistory:false});
    this.refreshGround();
    this.navigationDirty=true;
    const wood=tree.trunkHeight*6;
    this.drop('wood',wood,tree.x,tree.z);
    const stale=this.s.jobs.filter(job=>job.type==='chop'&&job.targetId===tree.id);
    for(const job of stale)this.removeJob(job,false);
    return{ok:true,wood,message:`砍倒树木 · 掉落 ${wood} 木材`};
  }

  playerPlantCrop(cell: Position): CommandResult {
    const resident = this.controlled;
    if (!resident) return { ok: false, message: '请先附身村民' };
    const slot = resident.bag[resident.bagSelected];
    const kind = cropForPlantingItem(slot?.resource);
    if (!slot || !kind) return { ok: false, message: '请手持种子包或蓝莓' };
    if (!withinTerrainReach(resident.position, cell)) return { ok: false, message: '靠近一格内再播种' };

    const [x, y, z] = cell;
    const ground = this.world.get(x, y, z);
    if ((ground !== BLOCK.Grass && ground !== BLOCK.Dirt) || this.getGroundHeight(x, z) !== y + 1) {
      return { ok: false, message: '请对准裸露的草地或泥土表面' };
    }
    const zone = this.s.zones.find(area => containsCell(area,x,z));
    if (zone?.kind === 'stockpile' || this.buildingAt.has(this.cellKey(x, z)) || treeProtectingVoxel(this.world, x, y, z)
      || this.s.terrainPlans.some(plan => plan.state !== 'completed' && plan.cells.some(([xx, zz]) => xx === x && zz === z))) {
      return { ok: false, message: '此处有仓储、设施、树根或整地规划' };
    }

    const { name, requires } = CROP_DEFS[kind];
    if (requires && !this.s.research.completed.includes(requires)) {
      return { ok: false, message: `${name}需要先完成${RESEARCH_DEFS[requires]!.name}研究` };
    }
    let crop = this.s.crops.find(plant => plant.x === x && plant.z === z);
    if (crop?.planted) return { ok: false, message: '这一格已经种有作物' };

    if (!zone && !crop) {
      this.addZone('farm', x, z, 1, 1, kind);
      crop = this.s.crops.at(-1)!;
    }
    if (!crop) {
      crop = { id: this.id('crop'), kind, x, y: y + 1, z, growth: 0, planted: true };
      this.s.crops.push(crop);
    } else {
      Object.assign(crop, { kind, y: y + 1, growth: 0, planted: true });
      for (const job of [...this.s.jobs]) {
        if (job.type === 'grow' && job.targetId === crop.id) this.removeJob(job, true);
      }
    }
    resident.bag[resident.bagSelected] = slot.count > 1 ? { ...slot, count: slot.count - 1 } : null;
    return { ok: true, message: `已播种${name}`, id: crop.id };
  }

  playerBreakCrop(id: string): CommandResult {
    const crop = this.s.crops.find(plant => plant.id === id && plant.planted);
    const resident = this.controlled;
    if (!crop || !resident) return { ok: false, message: '这里没有可破坏的作物' };
    if (!withinTerrainReach(resident.position, [crop.x, crop.y - 1, crop.z])) {
      return { ok: false, message: '靠近一格内再破坏作物' };
    }
    const def = CROP_DEFS[crop.kind];
    const yieldAmount = crop.growth >= 1 ? def.yieldCount : 0;
    this.clearCrop(crop, yieldAmount, true);
    for (const job of [...this.s.jobs]) {
      if (job.targetId === crop.id && (job.type === 'grow' || job.type === 'harvest')) this.removeJob(job, true);
    }
    if (cropPlantingItem(crop.kind) === def.produce) {
      return { ok: true, message: yieldAmount ? `已收获${yieldAmount} 颗${def.name}` : `已拔除${def.name} · 掉落 1 颗${def.name}` };
    }
    return { ok: true, message: yieldAmount ? `已收获${def.name} · 掉落 ${yieldAmount} 个产物和种子` : `已拔除${def.name} · 掉落种子` };
  }

  private clearCrop(crop: CropView, yieldAmount: number, playerOnly = false): void {
    const { produce } = CROP_DEFS[crop.kind];
    const plantingItem = cropPlantingItem(crop.kind);
    if (plantingItem === produce) {
      this.drop(produce, Math.max(1, yieldAmount), crop.x, crop.z, { playerOnly });
    } else {
      this.drop(produce, yieldAmount, crop.x, crop.z, { playerOnly });
      this.drop(plantingItem, 1, crop.x, crop.z, { playerOnly });
    }
    crop.planted = false;
    crop.growth = 0;
    this.s.metrics.harvested += yieldAmount;
  }

  playerTerrainBlocked([x,y,z]: Position): boolean {
    return y<1 || !!buildingProtectingVoxel(this.s.buildings.filter(building=>building.complete),x,y,z) || !!treeProtectingVoxel(this.world,x,y,z)
      || this.s.crops.some(crop=>crop.x===x&&crop.z===z&&y>=crop.y-1);
  }

  playerHarvestTerrain(cell:Position,block:number,position:Position):CommandResult {
    const [x,y,z]=cell;
    const rule=playerTerrainRule(block);
    if(!this.controlled)return {ok:false,message:"请先附身村民"};
    const held=this.controlled.bag[this.controlled.bagSelected]?.resource??null;
    if(!rule||held!==rule.tool||!withinTerrainReach(position,cell))return {ok:false,message:'请靠近并使用合适的工具'};
    if(this.playerTerrainBlocked(cell))return {ok:false,message:'此处有设施、树根或作物需要保护'};
    if(this.world.get(x,y,z)!==block||!this.world.set(x,y,z,BLOCK.Air,{recordHistory:false}))return {ok:false,message:'方块已变动'};
    this.syncWorld();
    this.drop(rule.resource,rule.amount,x,z,{playerOnly:true});
    this.refreshJobs();
    return {ok:true,message:`${BLOCKS[block]?.name}已挖开，掉落 ${rule.amount} 个${itemName(rule.resource)}`};
  }

  private drop(resource:InventoryItem,amount:number,x:number,z:number,{scatter=false,playerOnly=false,source}:{scatter?:boolean;playerOnly?:boolean;source?:ColdMark}={}):void {
    if(amount<=0)return;const pos=this.closestOpen(x,z)??[x+.5,Math.max(1,this.world.surfaceHeight(x,z)+1),z+.5];
    const xx=Math.floor(pos[0]),zz=Math.floor(pos[2]);
    const existing=scatter||playerOnly?undefined:this.s.items.find(i=>i.resource===resource&&i.x===xx&&i.z===zz&&!i.reservedBy&&!i.playerOnly);
    const premium = takePremium(source,amount,this.day());
    if(existing){addPremium(existing,premium,this.day());existing.amount+=amount;existing.age=Math.min(existing.age,30);}
    else this.s.items.push({id:this.id('item'),resource,amount,...(premium ? {premium:{day:this.day(),count:premium}} : {}),x:xx,y:pos[1],z:zz,age:0,reservedBy:null,...(scatter?{scatter:true}:{}),...(playerOnly?{playerOnly:true}:{})});
  }
  private rawFoodCost(amount: number): Partial<Resources> {
    const food = Math.min(amount, this.s.resources.food);
    const cabbage = amount - food;
    return { ...(food ? { food } : {}), ...(cabbage ? { cabbage } : {}) };
  }

  private afford(cost:Partial<Resources>):boolean{return RESOURCE_TYPES.every(r=>this.s.resources[r]>=(cost[r]??0));}
  private take(cost:Partial<Resources>):QualityMap | undefined {
    let result:QualityMap | undefined;
    for (const r of RESOURCE_TYPES) {
      const count = this.withdrawStock(r,cost[r]??0);
      if (count) (result ??= {})[r] = {premium:{day:this.day(),count}};
    }
    return result;
  }
  private give(cost:Partial<Resources>,quality?:QualityMap):void {
    for (const r of RESOURCE_TYPES) {
      const amount=cost[r]??0;
      if (!amount) continue;
      this.putInAvailableStorage(r,amount,quality?.[r]);
      this.s.resources[r]+=amount;
    }
  }

  private addJob(type:OrderType,targetId:string,x:number,y:number,z:number,work:number,label:string):Job {
    const job:Job={id:this.id('job'),type,targetId,x,y,z,progress:0,work,state:'queued',assignedTo:null,reserved:{},label,phase:type==='haul'?'pickup':'work',amount:0,destination:null};
    this.s.jobs.push(job);return job;
  }
  private refreshJobs():void {
    this.refreshPastureJobs();
    this.refreshTreeJobs();
    this.refreshTerraformJobs();
    const has=(type:JobType,target:string)=>this.s.jobs.some(j=>j.type===type&&j.targetId===target);
    for(const b of this.s.buildings)if(!b.complete&&b.phase!=='preparingTerrain'&&!b.blockedReason&&!has('construct',b.id))this.addJob('construct',b.id,b.x,b.y,b.z,BUILDING_DEFS[b.kind].work,`建造${BUILDING_DEFS[b.kind].name}`).progress=b.progress*BUILDING_DEFS[b.kind].work;
    for(const crop of this.s.crops){
      if(!crop.planted&&!has('grow',crop.id))this.addJob('grow',crop.id,crop.x,crop.y,crop.z,5,'播种'+CROP_DEFS[crop.kind].name);
      if(crop.planted&&crop.growth>=1&&!has('harvest',crop.id))this.addJob('harvest',crop.id,crop.x,crop.y,crop.z,6,'收获'+CROP_DEFS[crop.kind].name);
    }
    if(this.storageTarget())for(const item of this.s.items)if(isResource(item.resource)&&!item.playerOnly&&!item.reservedBy&&!has('haul',item.id))this.addJob('haul',item.id,item.x,item.y,item.z,1,'搬运物资');
    const complete=(kind:BuildingKind)=>this.s.buildings.find(b=>b.complete&&b.kind===kind);
    const desk=complete('researchDesk'),active=this.s.research.active;
    if(desk&&active&&!has('research',active))this.addJob('research',active,desk.x,desk.y,desk.z,RESEARCH_DEFS[active]!.work,'研究'+RESEARCH_DEFS[active]!.name).progress=this.s.research.progress[active]??0;
    for(const c of this.s.colonists)if(c.disease>15&&!has('doctor',c.id))this.addJob('doctor',c.id,Math.floor(c.position[0]),c.position[1],Math.floor(c.position[2]),9,`治疗${c.name}`);
    for(const j of [...this.s.jobs]){
      if(j.type==='haul'&&!j.guideSale&&j.targetId!==PLAYER_DELIVERY_TARGET&&j.phase==='pickup'&&!this.s.items.some(i=>i.id===j.targetId))this.removeJob(j,true);
      if(j.type==='doctor'){const p=this.s.colonists.find(c=>c.id===j.targetId);if(!p||p.disease<=0)this.removeJob(j,true);else if(!j.assignedTo){j.x=Math.floor(p.position[0]);j.y=p.position[1];j.z=Math.floor(p.position[2]);}}
    }
  }
  private releasePerson(c:Colonist):void {
    const job=this.s.jobs.find(j=>j.id===c.jobId);
    if(job){
      job.assignedTo=null;job.state='queued';
      if(job.type==='herd'){
        const a=this.penFor(job.targetId)?.animal;
        if(a?.state==='leading')a.state='ordered';
      }
      if (job.recipe) {
        this.give(job.reserved,job.quality);
        job.reserved = {}; delete job.quality;
        job.phase = 'pickup';
        job.destination = null;
      } else if (job.guideSale) {
        const sale=job.guideSale;
        if(sale.inTransit && !sale.pickupAt) sale.pickupAt=[...c.position];
        job.phase='pickup'; job.label='待取货 · 等待居民';
      } else if (job.targetId === PLAYER_DELIVERY_TARGET) {
        job.phase = 'pickup';
      } else if(job.type==='haul'){
        for(const r of RESOURCE_TYPES)if(c.carrying[r])this.drop(r,c.carrying[r]!,Math.floor(c.position[0]),Math.floor(c.position[2]),{source:c.cargoQuality?.[r]});
        c.carrying={};c.cargoQuality=undefined;const item=this.s.items.find(i=>i.id===job.targetId);if(item)item.reservedBy=null;
        this.s.jobs.splice(this.s.jobs.indexOf(job),1);
      }
    }
    if(c.personal?.reserved)this.give(c.personal.reserved,c.personal.quality);
    c.personal=null;c.jobId=null;c.path=[];c.destination=null;
  }
  private removeJob(job:Job,refund:boolean):void {
    const c=this.s.colonists.find(c=>c.id===job.assignedTo);
    const sale=job.guideSale;
    if(refund && sale?.eventId){
      const market=this.s.specialistMarket;
      const next=releaseMarketQuota(market.events,sale.eventId,sale.count-sale.delivered);
      if(!next)throw new Error('该订单的活动额度记录无效');
      market.events=next;
    }
    if (refund && sale?.side==='buy' && sale.inTransit) {
      const place=sale.pickupAt??c?.position??this.merchantPosition(sale.merchantId);
      this.drop(sale.item,sale.inTransit,Math.floor(place[0]),Math.floor(place[2]));
    }
    if(c){
      for(const r of RESOURCE_TYPES)if(c.carrying[r])this.drop(r,c.carrying[r]!,Math.floor(c.position[0]),Math.floor(c.position[2]),{source:c.cargoQuality?.[r]});
      c.carrying={};c.cargoQuality=undefined;c.jobId=null;c.path=[];c.destination=null;
    }
    const item=this.s.items.find(i=>i.id===job.targetId);if(item?.reservedBy===job.id)item.reservedBy=null;
    if(refund)this.give(job.reserved,job.quality);
    const index=this.s.jobs.indexOf(job);if(index>=0)this.s.jobs.splice(index,1);
  }
  private schedule(c:Colonist):'work'|'sleep'|'relax'|'anything' {
    const hour=this.hour();
    if(c.schedule==='rest')return hour<7||hour>=22?'sleep':'relax';
    if(c.schedule==='night')return hour>=8&&hour<16?'sleep':hour>=16&&hour<18?'relax':'work';
    if(c.schedule==='day')return hour<6||hour>=22?'sleep':hour>=20?'relax':'work';
    return hour<6||hour>=23?'sleep':hour>=19&&hour<22?'relax':'anything';
  }
  private personal(c:Colonist,kind:Exclude<Personal['kind'],'wander'>):boolean {
    let target:Position|null=null,path:Position[]|null=null,bed=false,reserved:Partial<Resources>={},buildingId:string|undefined;
    const useBuildings=(kinds:BuildingKind[],excludeOccupied=false):boolean=>{
      const candidates=this.s.buildings.filter(b=>b.complete&&kinds.includes(b.kind)
        && !Array.from(this.merchantHomes.values()).some(home=>home.bed.id===b.id)
        &&(!excludeOccupied||!this.s.colonists.some(p=>p!==c&&p.personal&&(p.personal.kind==='sleep'||p.personal.kind==='patient')&&(p.personal.buildingId===b.id||p.destination?.[0]===b.x+.5&&p.destination?.[2]===b.z+.5))))
        .sort((a,b)=>Math.hypot(a.x-c.position[0],a.z-c.position[2])-Math.hypot(b.x-c.position[0],b.z-c.position[2]));
      for(const b of candidates){const pos:Position=[b.x+.5,b.y,b.z+.5],route=this.buildingStand(b,c.position);if(route!==null){target=pos;path=route;buildingId=b.id;return true;}}
      return false;
    };
    if(kind==='eat'){
      reserved = this.s.resources.meal > 0 ? { meal: 1 } : this.rawFoodCost(1);
      if (!this.afford(reserved)) return false;
      if(!useBuildings(['table'])){target=this.storageTarget(c.position);if(target)path=this.path(c.position,target);}
    }else if(kind==='sleep'||kind==='patient'){
      bed=useBuildings(kind==='patient'?['medicalBed','bed']:['bed'],true);
      if(!bed){target=[...c.position];path=[];}
    }else if(kind==='relax'){
      if(!useBuildings(['table'])){target=this.closestOpen(Math.floor(c.position[0])+2,Math.floor(c.position[2]));if(target)path=this.path(c.position,target);}
    }
    if(!target||path===null)return false;
    this.releasePerson(c);const quality=this.take(reserved);c.path=path;c.destination=target;c.personal={kind,quality,elapsed:0,duration:kind==='eat'?4:kind==='sleep'||kind==='patient'?bed?20:40:20,reserved,...(buildingId?{buildingId}:{})};
    c.task={eat:'前往用餐',sleep:'前往休息',relax:'休闲娱乐',patient:'卧床休养'}[kind];return true;
  }

  private wander(c:Colonist,dt:number,resting:boolean):void {
    if(!c.personal){
      const x=Math.floor(c.position[0]),z=Math.floor(c.position[2]);
      for(let attempt=0;attempt<7;attempt++){
        const dx=Math.floor(this.random()*9)-4,dz=Math.floor(this.random()*9)-4;
        const tx=x+dx,tz=z+dz,range=Math.abs(dx)+Math.abs(dz);
        if(range<2||range>5||!this.walkable(tx,tz)||this.buildingAt.has(this.cellKey(tx,tz)))continue;
        const target:Position=[tx+.5,this.groundY(tx,tz),tz+.5];
        if(this.residentAt(target,c.id)||this.s.colonists.some(other=>other!==c&&other.destination&&residentsOverlap(target,other.destination)))continue;
        const route=this.path(c.position,target,false,undefined,8);
        if(!route?.length)continue;
        const duration=1.25+this.random()*2;
        c.path=route;c.destination=target;c.personal={kind:'wander',elapsed:0,duration,reserved:{}};
        break;
      }
      c.personal??={kind:'wander',elapsed:0,duration:1.5,reserved:{}};
    }
    c.task=resting?'休息 · 散步':'等待工作 · 散步';
    if(c.personal&&(!this.move(c,dt)||!c.personal))return;
    c.task=resting?'休息 · 自由活动':'等待工作 · 自由活动';
    if(!c.personal)return;
    c.personal.elapsed+=dt;
    if(resting)c.recreation=clamp(c.recreation+dt*1.5);
    if(c.personal.elapsed>=c.personal.duration){c.personal=null;c.destination=null;}
  }

  private updateColonist(c:Colonist,dt:number):void {
    c.hunger=clamp(c.hunger-dt*.12);c.rest=clamp(c.rest-dt*.07);c.recreation=clamp(c.recreation-dt*.055);
    const ri=this.roomAt[Math.floor(c.position[0])+Math.floor(c.position[2])*this.world.width]??-1;
    c.comfort=ri>=0?this.rooms[ri]?.comfort??0:0;
    const temperature=ri>=0?this.rooms[ri]?.temperature??this.s.temperature:this.s.temperature;
    if(temperature>34||temperature<1){c.health=clamp(c.health-dt*.018,5);c.disease=clamp(c.disease+dt*.015);}
    if(c.hunger<8)c.health=clamp(c.health-dt*.08,5);
    else if(c.disease<10&&c.hunger>40)c.health=clamp(c.health+dt*.035);
    if(c.disease>0)c.disease=clamp(c.disease-dt*(c.personal?.kind==='patient'?.035:.008));
    const moodTarget=clamp(16+(c.hunger+c.rest+c.recreation)*.22+c.comfort*.15-c.disease*.35+(c.traits.includes('乐观')?8:0));
    c.mood=clamp(c.mood+(moodTarget-c.mood)*dt*.025);
    if(c===this.controlled)return;
    c.stamina=clamp(c.stamina+dt*PLAYER_STAMINA_REGEN);
    const schedule=this.schedule(c);
    // Critical hunger can interrupt prolonged sleep or medical rest; food is still reserved once.
    if(c.personal&&c.personal.kind!=='eat'&&c.hunger<20&&this.personal(c,'eat'))return;
    const available=!c.personal||c.personal.kind==='wander';
    if(available&&((c.hunger<34&&this.personal(c,'eat'))||(c.rest<20&&this.personal(c,'sleep'))))return;
    if(available&&c.disease>38&&this.personal(c,'patient'))return;
    if(c.personal&&c.personal.kind!=='wander'){
      if(!this.move(c,dt)||!c.personal)return;
      const p=c.personal;p.elapsed+=dt;
      if(p.kind==='eat'&&p.elapsed>=p.duration){
        const cooked=!!p.reserved.meal;c.hunger=clamp(c.hunger+(cooked?70:43));c.mood=clamp(c.mood+(cooked?5:-3));p.reserved={};c.personal=null;c.task='吃饱了';
      }else if(p.kind==='sleep'){
        c.rest=clamp(c.rest+dt*(p.duration===20?1.2:.6));c.task='睡眠中';
        if(c.rest>=98||(schedule!=='sleep'&&c.rest>=78)){c.personal=null;c.task='精神饱满';}
      }else if(p.kind==='patient'){
        c.rest=clamp(c.rest+dt*.8);c.health=clamp(c.health+dt*.08);c.task='卧床休养';if(c.disease<12){c.personal=null;c.task='病情好转';}
      }else if(p.kind==='relax'){
        c.recreation=clamp(c.recreation+dt*1.5);c.mood=clamp(c.mood+dt*.1);
        if(p.elapsed>=p.duration||c.recreation>=98){c.personal=null;c.task='休闲结束';}
      }
      return;
    }
    if(!c.jobId){
      if(schedule==='sleep'&&c.rest<94&&this.personal(c,'sleep'))return;
      if(c.recreation<24&&this.personal(c,'relax'))return;
      const resting=schedule==='sleep'||schedule==='relax';
      if(!resting&&this.s.time>=c.retryAt){
        if(this.assign(c))c.personal=null;
        else c.retryAt=this.s.time+2;
      }
      if(!c.jobId){this.wander(c,dt,resting);return;}
    }
    const job=this.s.jobs.find(j=>j.id===c.jobId);if(!job){c.jobId=null;return;}
    if(job.type==='chop'&&!this.world.getTree(job.targetId)){this.removeJob(job,false);return;}
    if(job.type==='herd'||job.type==='husbandry'){this.workPasture(c,job,dt);return;}
    if (job.targetId === PLAYER_DELIVERY_TARGET) { this.deliverToPlayer(c, job, dt); return; }
    if (job.guideSale) {
      const sale=job.guideSale;
      if(!this.merchantHomes.has(sale.merchantId??'guide')){
        this.releasePerson(c);job.state='blocked';job.label='暂停 · 等待商人重新安家';return;
      }
      if (sale.pickupAt) {
        c.task='接取在途货物';
        if(this.move(c,dt) && c.jobId===job.id) { delete sale.pickupAt;job.phase='deliver';c.destination=null;c.retryAt=0; }
      } else if (sale.side==='buy') this.collectFromGuide(c,job,sale,dt);
      else this.deliverToGuide(c,job,sale,dt);
      return;
    }
    const recipe = recipeFor(job.recipe);
    if (recipe) { this.runRecipe(c, job, recipe, dt); return; }
    c.task=c.path.length?`前往${job.label}`:job.label;
    if(!this.move(c,dt)||c.jobId!==job.id)return;
    if (job.type === 'demolish') {
      const b = this.buildingAtVoxel(job.x, job.y, job.z);
      if (!b?.complete || b.id !== job.targetId) { this.removeJob(job, false); return; }
      if (!this.canWorkBeside(b, Math.floor(c.position[0]), Math.floor(c.position[2]))) {
        this.releasePerson(c);
        return;
      }
    }
    if(job.type==='chop'&&(Math.abs(Math.floor(c.position[0])-job.x)+Math.abs(Math.floor(c.position[2])-job.z)!==1||Math.abs(c.position[1]-job.y)>1.01)){
      this.releasePerson(c);c.retryAt=this.s.time+1;return;
    }
    if(job.type==='construct'){
      const b=this.s.buildings.find(b=>b.id===job.targetId);
      if(!b||!this.constructionReady(b)){this.removeJob(job,false);this.refreshJobs();return;}
      this.advanceConstruction(b, job, dt * this.workRate(c, 'construct'), c);
      return;
    }
    if(job.type==='haul'){this.haul(c,job);return;}
    if(job.type==='doctor'){
      const patient=this.s.colonists.find(p=>p.id===job.targetId);
      if(!patient){this.removeJob(job,true);return;}
      if(horizontalDistance(c.position,patient.position)>1.7){
        if(!this.route(c,patient.position,true)){this.releasePerson(c);c.retryAt=this.s.time+3;}return;
      }
    }
    const rate=this.workRate(c, workSkill(job.type));
    job.progress+=dt*rate;
    // 砍树额外耗体力：按进度比例扣，所以一棵树固定掉 COLONIST_CHOP_STAMINA，
    // 不管他技能高低砍得快还是慢。
    if(job.type==='chop')c.rest=clamp(c.rest-dt*rate/Math.max(1,job.work)*COLONIST_CHOP_STAMINA);
    if(job.type==='research')this.s.research.progress[job.targetId]=Math.min(job.work,job.progress);
    if(job.progress>=job.work)this.finish(c,job);
  }
  private workRate(c: Colonist, job: JobType): number {
    return (.65+c.skills[job]*.1)*(c.hunger<20?.65:1)*(c.rest<25?.65:1)*(c.traits.includes('勤劳')?1.1:1);
  }

  private constructionReady(building: BuildingView): boolean {
    return !building.complete && building.phase !== 'preparingTerrain' && this.buildingClearance(building)
      && this.footprint(building).every(([x,z]) => this.world.terrainHeight(x,z) === building.y && !this.terrainBlocker(x,z,building.y));
  }

  private advanceConstruction(building: BuildingView, job: Job, work: number, worker?: Colonist): void {
    building.phase = 'constructing';
    building.blockedReason = undefined;
    job.progress = Math.min(job.work, job.progress + work);
    if (job.progress === job.work && BUILDING_DEFS[building.kind].blocking && this.occupiedByActor(building)) {
      building.blockedReason = '等待角色离开建筑占地';
      job.progress = Math.max(0, job.work - .25);
      for (const person of this.s.colonists) {
        if (person.position[0]+.23 <= building.x || person.position[0]-.23 >= building.x+building.w
          || person.position[2]+.23 <= building.z || person.position[2]-.23 >= building.z+building.d) continue;
        if (person !== worker) this.releasePerson(person);
        const stands=this.buildingStands(building).filter(p=>!this.s.colonists.some(other=>other!==person&&horizontalDistance(p,other.position)<.65));
        const path=stands.sort((a,b)=>horizontalDistance(a,person.position)-horizontalDistance(b,person.position)).map(p=>{const route=this.path(person.position,p);return route?.length===0?[p]:route;}).find(route=>route!==null);
        if (path) {
          person.path = path; person.destination = path.at(-1) ?? person.position;
          if (person !== worker) person.personal = { kind: 'wander', elapsed: 0, duration: 1, reserved: {} };
        }
      }
    }
    building.progress = job.progress / job.work;
    if (job.progress < job.work) return;
    const leaves = buildingParts(building).filter(part => this.world.get(part.x,part.y,part.z) === BLOCK.Leaves);
    if (leaves.length) this.world.edit(leaves.map(({x,y,z}) => ({x,y,z,block:BLOCK.Air})));
    building.complete = true;
    building.phase = 'completed';
    building.reserved = {};
    this.s.metrics.built++;
    this.s.metrics.jobsCompleted++;
    this.navigationDirty = true;
    this.rebuildBuildings();
    this.moveObstructedGroundStorage();
    this.event('info', `${worker?.name ?? '玩家'}完成了${BUILDING_DEFS[building.kind].name}。`);
    this.removeJob(job, false);
    if (worker) {
      worker.skills.construct = Math.min(20, worker.skills.construct + .12);
      worker.task = '工作完成';
    }
    if(building.kind==='pastureGate'){
      const pen=this.s.zones.find(z=>z.pasture?.pendingGate?.[0]===building.x&&z.pasture.pendingGate[1]===building.z)?.pasture;
      if(pen?.pendingGate){
        const old=this.buildingAt.get(this.cellKey(...pen.gate));
        pen.gate=pen.pendingGate; delete pen.pendingGate;
        if(old?.kind==='pastureGate'){old.kind='fence';old.complete=false;old.progress=0;old.phase='readyToBuild';}
        this.invalidateBuildingNavigation();this.refreshJobs();
      }
    }
    if (building.kind==='campfirePlaza') this.beginFinale(building);
  }
  private assign(c:Colonist):boolean {
    const options=this.s.jobs.filter(j=>!j.assignedTo&&c.priorities[workSkill(j.type)]>0&&(j.type!=='doctor'||j.targetId!==c.id)
      &&(j.type!=='construct'||j.targetId!==this.playerBuild?.id)&&j.recipientId!==c.id)
      .sort((a,b)=>Number(b.targetId===PLAYER_DELIVERY_TARGET)-Number(a.targetId===PLAYER_DELIVERY_TARGET)
        ||c.priorities[workSkill(a.type)]-c.priorities[workSkill(b.type)]||Math.hypot(a.x-c.position[0],a.z-c.position[2])-Math.hypot(b.x-c.position[0],b.z-c.position[2]));
    for(const job of options){
      if (job.guideSale) {
        const sale=job.guideSale, lot=sale.lots[0];
        if(!this.merchantHomes.has(sale.merchantId??'guide')){job.state='blocked';job.label='暂停 · 等待商人重新安家';continue;}
        const shelf=!sale.pickupAt && lot?.shelfId && this.s.buildings.find(b=>b.id===lot.shelfId);
        const source:Position|null=sale.pickupAt ?? (sale.side==='buy' ? this.merchantPosition(sale.merchantId) : lot!.overflow ? this.storageTarget(c.position) : [lot!.x+.5,this.groundY(lot!.x,lot!.z),lot!.z+.5]);
        const path=shelf ? this.buildingStand(shelf,c.position) : source && this.path(c.position,source,sale.side==='buy' && !sale.pickupAt);
        if (!path || !source) { job.state='blocked';job.label='待取货 · 仓位道路受阻';continue; }
        c.path=path;c.destination=path.at(-1)??[...c.position];
        job.x=Math.floor(source[0]);job.y=source[1];job.z=Math.floor(source[2]);
        job.assignedTo=c.id;job.state='working';job.label=sale.side==='buy'?'采购待取 · 前往'+merchantName(sale.merchantId):'待取货 · 前往仓位';c.jobId=job.id;return true;
      }
      if(job.type==='herd'||job.type==='husbandry'){
        if(this.assignPasture(c,job))return true;
        continue;
      }
      const recipe = recipeFor(job.recipe);
      if (recipe) {
        if (this.assignRecipe(c, job, recipe)) return true;
        continue;
      }
      if (job.targetId === PLAYER_DELIVERY_TARGET) {
        const source = this.storageTarget(c.position);
        if (!source || !this.route(c, source)) { job.state = 'blocked'; continue; }
        [job.x, job.y, job.z] = [Math.floor(source[0]), source[1], Math.floor(source[2])];
        job.assignedTo = c.id; job.state = 'working'; c.jobId = job.id;
        return true;
      }
      const crop = job.type === 'grow' ? this.s.crops.find(plant => plant.id === job.targetId) : undefined;
      if (job.type === 'grow' && (!crop || crop.planted)) {
        this.removeJob(job, true);
        continue;
      }
      let cost:Partial<Resources>={};
      if(!Object.keys(job.reserved).length){
        if (crop) cost = { [cropPlantingItem(crop.kind)]: 1 };
        if(job.type==='doctor')cost={medicine:1};
      }
      if (!this.afford(cost)) {
        job.state = 'blocked';
        if (crop) job.label = `缺少${RESOURCE_NAMES[cropPlantingItem(crop.kind)]}`;
        continue;
      }
      if (crop) job.label = `播种${CROP_DEFS[crop.kind].name}`;
      if(job.type==='haul'){
        const item=this.s.items.find(i=>i.id===job.targetId);if(!item||item.reservedBy&&item.reservedBy!==job.id)continue;
        if(!isResource(item.resource)||!this.haulDestination(item.resource,[item.x+.5,item.y,item.z+.5])){
          job.state='blocked';job.label='等待可达且有空位的仓储区';continue;
        }
        job.label='搬运物资';
      }
      const target:Position=[job.x+.5,job.y,job.z+.5];
      const adjacent=['construct','chop','mine','research','doctor'].includes(job.type);
      if(job.type==='terraform'){
        const work=this.earthwork.get(this.cellKey(job.x,job.z));
        if(!work)continue;
        const path=this.terraformStand(work,c.position);
        if(path===null){job.state='blocked';job.label='整地受阻：等待可达的同层施工位置';for(const id of work.plans){const plan=this.s.terrainPlans.find(p=>p.id===id);if(plan){plan.state='blocked';plan.blockedReason='等待可达的相邻施工位置';}}continue;}
        c.path=path;c.destination=target;
      }else if(job.type==='construct'||job.type==='demolish'){
        const b=this.s.buildings.find(b=>b.id===job.targetId),path=b?this.buildingStand(b,c.position):null;
        if(path===null){job.state='blocked';if(b&&job.type==='construct')b.blockedReason='等待可达的建筑施工位置';continue;}c.path=path;c.destination=target;
      }else if(job.type==='chop'){
        const tree=this.world.getTree(job.targetId),path=tree?this.treeStand(tree,c.position):null;
        if(path===null){job.state='blocked';continue;}c.path=path;c.destination=target;
      }else if(job.type==='mine'){
        const path=this.miningTargetValid(job)?this.mineStand(job,c.position):null;
        if(path===null){job.state='blocked';continue;}c.path=path;c.destination=target;
      }else if(!this.route(c,target,adjacent)){job.state='blocked';continue;}
      const quality = this.take(cost); if (quality) job.quality={...job.quality,...quality};for(const r of RESOURCE_TYPES)if(cost[r])job.reserved[r]=(job.reserved[r]??0)+cost[r]!;
      job.assignedTo=c.id;job.state='working';c.jobId=job.id;
      if(job.type==='haul'){const item=this.s.items.find(i=>i.id===job.targetId)!;item.reservedBy=job.id;}
      return true;
    }return false;
  }

  private assignRecipe(worker: Colonist, job: Job, recipe: Recipe): boolean {
    if (this.s.jobs.some(other => other.recipe && other.targetId === job.targetId && other.assignedTo)) return false;
    const station = this.s.buildings.find(b => b.id === job.targetId && b.complete);
    if (!station) { this.removeJob(job, true); return false; }
    const missing = this.missingRecipeMaterials(recipeCost(recipe, job.amount));
    const source = missing ? null : this.storageTarget(worker.position);
    if (!source || !this.buildingStand(station, source) || !this.route(worker, source)) {
      job.state = 'blocked';
      job.label = missing ?? '等待可达的仓储区和工作站';
      return false;
    }
    job.state = 'working';
    job.label = `领取${RESOURCE_NAMES[recipe.output]}的原料`;
    job.destination = source;
    job.assignedTo = worker.id;
    worker.jobId = job.id;
    return true;
  }

  private runRecipe(worker: Colonist, job: Job, recipe: Recipe, dt: number): void {
    const station = this.s.buildings.find(b => b.id === job.targetId && b.complete);
    if (!station) { this.removeJob(job, true); return; }
    worker.task = worker.path.length ? `前往${job.label}` : job.label;
    if (!this.move(worker, dt) || worker.jobId !== job.id) return;
    const x = Math.floor(worker.position[0]), z = Math.floor(worker.position[2]);
    if (job.phase === 'pickup') {
      const cost = recipeCost(recipe, job.amount);
      const missing = this.missingRecipeMaterials(cost);
      const inStorage = this.storageAccessAt(x,z);
      const path = inStorage && !missing ? this.buildingStand(station, worker.position) : null;
      if (!path) {
        this.releasePerson(worker);
        job.state = 'blocked';
        job.label = missing ?? '等待可达的仓储区和工作站';
        return;
      }
      job.quality=this.take(cost);
      job.reserved = cost;
      job.phase = 'work';
      job.destination = null;
      job.label = `制作${RESOURCE_NAMES[recipe.output]}`;
      worker.path = path;
      worker.destination = [station.x + .5, station.y, station.z + .5];
      return;
    }
    if (!this.canWorkBeside(station, x, z)) { this.releasePerson(worker); return; }
    job.progress += dt * this.workRate(worker, recipe.job);
    if (job.progress < job.work) return;
    const output = recipe.count * job.amount;
    this.drop(recipe.output, output, x, z);
    if (recipe.job === 'cook') this.s.metrics.cooked += output;
    this.finish(worker, job);
  }

  private collectFromGuide(c:Colonist, job:Job, sale:GuideSale, dt:number) {
    if (job.phase==='pickup') {
      const merchant=this.merchantPosition(sale.merchantId);
      c.task='前往'+merchantName(sale.merchantId)+'处领取'+RESOURCE_NAMES[sale.item];
      if (!this.move(c,dt) || c.jobId!==job.id) return;
      if(horizontalDistance(c.position,merchant)>1.5 || Math.abs(c.position[1]-merchant[1])>1.05) { this.releasePerson(c);return; }
      sale.inTransit=Math.min(HAUL_LIMIT,sale.count-sale.delivered);
      sale.paid=Math.floor(sale.total*(sale.delivered+sale.inTransit)/sale.count);
      job.reserved={silver:sale.total-sale.paid};job.phase='deliver';job.label='采购运送中';c.destination=null;c.retryAt=0;
      return;
    }
    c.task=`送${RESOURCE_NAMES[sale.item]} × ${sale.inTransit} 入库`;
    if (c.path.length && !this.move(c,dt) || c.jobId!==job.id || this.s.time<c.retryAt) return;
    const target=this.haulDestination(sale.item,c.position);
    if (!target) { job.state='blocked';job.label='采购在途 · 等待可达空仓位';c.retryAt=this.s.time+1;return; }
    job.state='working';job.label='采购运送中';
    if (target.path.length) { c.path=target.path;c.destination=target.stand;return; }
    const amount=Math.min(target.capacity,sale.inTransit);
    this.putInStorage(target.slot,sale.item,amount);
    this.s.resources[sale.item]+=amount;this.s.metrics.hauled+=amount;
    sale.delivered+=amount;sale.inTransit-=amount;
    if (sale.delivered===sale.count) {
      this.event('info',`${merchantName(sale.merchantId)}采购已入库 · ${RESOURCE_NAMES[sale.item]} × ${sale.count} · 已付 ${sale.paid} 银币`);
      this.removeJob(job,false);c.task='采购已入库';
    } else if (!sale.inTransit) this.releasePerson(c);
  }

  private deliverToGuide(c:Colonist, job:Job, sale:GuideSale, dt:number) {
    if (job.phase==='pickup') {
      c.task='到仓位领取'+RESOURCE_NAMES[sale.item];
      if (!this.move(c,dt) || c.jobId!==job.id) return;
      const lot=sale.lots[0]!;
      sale.inTransit=Math.min(HAUL_LIMIT,lot.count);
      sale.transitPremium=Math.min(sale.inTransit,lot.premium??0);
      lot.premium=(lot.premium??0)-sale.transitPremium;
      lot.count-=sale.inTransit;
      if (!lot.count) sale.lots.shift();
      job.phase='deliver';job.label='运送中';c.destination=null;c.retryAt=0;
      return;
    }
    const guide=this.merchantPosition(sale.merchantId);
    c.task=`向${merchantName(sale.merchantId)}运送${RESOURCE_NAMES[sale.item]} × ${sale.inTransit}`;
    if (horizontalDistance(c.position,guide)<=1.45 && Math.abs(c.position[1]-guide[1])<=1.05) {
      takePremium(job.quality?.[sale.item],sale.transitPremium??0,this.day());
      sale.transitPremium=0;
      const arrivals=recordGoods(this.s.specialistMarket,sale.item,sale.inTransit,this.day());
      for(const id of arrivals){
        this.startMerchantWalk(id);
        this.event('arrival',merchantName(id)+'来到了小镇，正在等待安排住所');
      }
      sale.delivered+=sale.inTransit;
      const paid=Math.floor(sale.total*sale.delivered/sale.count);
      this.give({silver:paid-sale.paid});
      sale.paid=paid;sale.inTransit=0;job.reserved[sale.item]=sale.count-sale.delivered;
      if (sale.delivered===sale.count) {
        this.event('info',`${merchantName(sale.merchantId)}回收已交付 · ${RESOURCE_NAMES[sale.item]} × ${sale.count} · 收到 ${paid} 银币`);
        this.removeJob(job,false);c.task='已交货给'+merchantName(sale.merchantId);
      } else this.releasePerson(c);
      return;
    }
    if ((!c.path.length || !c.destination || horizontalDistance(c.destination,guide)>1.5) && this.s.time>=c.retryAt) {
      c.retryAt=this.s.time+1;
      if (!this.route(c,guide,true) && !this.route(c,guide)) {
        job.state='blocked';job.label='运送中 · 等待道路畅通';c.path=[];c.destination=null;
      }
    }
    if(c.path.length) { job.state='working';job.label='运送中';this.move(c,dt); }
  }

  private deliverToPlayer(c: Colonist, job: Job, dt: number): void {
    const resource = job.resource!;
    if (job.phase === 'pickup') {
      c.task = `前往储藏区领取${RESOURCE_NAMES[resource]}`;
      if (!this.move(c, dt) || c.jobId !== job.id) return;
      if (!this.storageAccessAt(job.x,job.z)) {
        this.releasePerson(c);
        return;
      }
      job.phase = 'deliver';
      c.destination = null;
      c.retryAt = 0;
      return;
    }

    const recipient=this.s.colonists.find(person=>person.id===job.recipientId);
    if(!recipient){this.removeJob(job,true);return;}
    const player=recipient.position;
    c.task = `给${recipient.name}送${RESOURCE_NAMES[resource]}`;
    if (horizontalDistance(c.position, player) <= 1.5 && Math.abs(c.position[1] - player[1]) <= 1.5) {
      c.path = []; c.destination = null;
      const remaining = job.reserved[resource]!;
      const received = this.addToBag(recipient,resource,remaining,recipient===this.controlled,job.quality?.[resource]);
      if (!received) { c.task = '村民背包已满，等待收货'; job.state = 'blocked'; return; }
      this.deliveryMessage = `${c.name}送来了 ${received} 个${RESOURCE_NAMES[resource]}`;
      this.event('info', this.deliveryMessage);
      if (received === remaining) this.finish(c, job);
      else {
        job.reserved[resource] = remaining - received;
        c.task = '村民背包已满，等待收货'; job.state = 'blocked';
      }
      return;
    }

    const destination = c.destination;
    const playerMoved = !destination || Math.floor(destination[0]) !== Math.floor(player[0])
      || Math.floor(destination[2]) !== Math.floor(player[2]);
    if ((playerMoved || !c.path.length) && this.s.time >= c.retryAt) {
      c.retryAt = this.s.time + 1;
      const target: Position = [player[0], clamp(player[1], 0, this.world.height), player[2]];
      if (!this.route(c, target) && !this.route(c, target, true)) {
        c.path = []; c.destination = null;
        job.state = 'blocked';
      }
    }
    if (c.path.length) { job.state = 'working'; this.move(c, dt); }
    else if (job.state === 'blocked') c.task = '等待可到达的收货位置';
  }

  private haul(c:Colonist,job:Job):void {
    if (job.phase==='pickup') {
      const item=this.s.items.find(i=>i.id===job.targetId);
      if (!item || item.playerOnly || !isResource(item.resource)) { this.removeJob(job,true); return; }
      const destination=this.haulDestination(item.resource,c.position);
      if (!destination) { this.releasePerson(c); return; }
      const amount=Math.min(item.amount,HAUL_LIMIT,destination.capacity);
      item.amount-=amount;
      c.carrying[item.resource]=amount;
      const premium=takePremium(item,amount,this.day());
      c.cargoQuality = premium ? {[item.resource]:{premium:{day:this.day(),count:premium}}} : undefined;
      job.resource=item.resource;job.amount=amount;job.phase='deliver';
      if (item.amount===0) this.s.items.splice(this.s.items.indexOf(item),1);
      else item.reservedBy=null;
      c.path=destination.path;c.destination=destination.stand;job.destination=destination.stand;
      return;
    }
    const resource=job.resource!;
    const destination=this.haulDestination(resource,c.position);
    if (!destination) { this.releasePerson(c); return; }
    if (destination.path.length) {
      c.path=destination.path;c.destination=destination.stand;job.destination=destination.stand;
      return;
    }
    const carried=c.carrying[resource]??0, stored=Math.min(carried,destination.capacity);
    const quality = c.cargoQuality?.[resource];
    this.putInStorage(destination.slot,resource,stored,takePremium(quality,stored,this.day()));
    this.s.resources[resource]+=stored;this.s.metrics.hauled+=stored;
    c.carrying={};c.cargoQuality=undefined;
    if (carried > stored) this.drop(resource,carried-stored,Math.floor(c.position[0]),Math.floor(c.position[2]),{source:quality});
    this.finish(c,job);
  }
  private finish(c:Colonist,job:Job):void {
    if(job.type==='terraform'){
      if(this.finishTerraform(c,job)){c.skills.terraform=Math.min(20,c.skills.terraform+.05);this.s.metrics.jobsCompleted++;c.task='完成一层填挖';}return;
    }else if(job.type==='demolish'){
      const b = this.buildingAtVoxel(job.x, job.y, job.z);
      if (!b?.complete || b.id !== job.targetId) { this.removeJob(job, false); return; }
      this.dismantleBuilding(b, job, c);
    }else if(job.type==='grow'){
      const crop = this.s.crops.find(p => p.id === job.targetId);
      if (!crop || crop.planted) { this.removeJob(job, true); return; }
      const seed = cropPlantingItem(crop.kind);
      // 升级前已开工的播种任务还没有预留种子，完成前补扣一次。
      if (!job.reserved[seed]) {
        if (this.s.resources[seed] < 1) {
          this.releasePerson(c);
          job.state = 'blocked';
          job.label = `缺少${RESOURCE_NAMES[seed]}`;
          return;
        }
        this.withdrawStock(seed,1);
      }
      crop.planted = true;
      crop.growth = 0;
    }else if(job.type==='harvest'){
      const crop = this.s.crops.find(p => p.id === job.targetId);
      if (crop?.planted) this.clearCrop(crop, CROP_DEFS[crop.kind].yieldCount + Math.floor(c.skills.harvest / 5));
    }else if(job.type==='research'){
      this.s.research.progress[job.targetId]=job.work;
      if(!this.s.research.completed.includes(job.targetId)){this.s.research.completed.push(job.targetId);this.s.metrics.researched++;this.event('research',`研究完成：${RESEARCH_DEFS[job.targetId]!.name}。`);}
      this.s.research.active=null;
    }else if(job.type==='doctor'){
      const patient=this.s.colonists.find(p=>p.id===job.targetId);
      if(patient){patient.disease=clamp(patient.disease-(32+c.skills.doctor*3+(this.s.research.completed.includes('medicine')?15:0)));patient.health=clamp(patient.health+18);this.s.metrics.treated++;this.event('health',`${c.name}为${patient.name}进行了治疗。`);}
    }else if(job.type==='chop'){
      const tree=this.world.getTree(job.targetId);
      if(!tree){this.removeJob(job,false);return;}
      // Simulation harvesting is irreversible through sandbox history: one identity yields once.
      this.world.removeTree(tree.id,{recordHistory:false});this.refreshGround();this.navigationDirty=true;
      this.drop('wood',tree.trunkHeight*6,tree.x,tree.z);
    }else if(job.type==='mine'){
      if(!this.miningTargetValid(job)){this.removeJob(job,true);return;}
      const standX=Math.floor(c.position[0]),standZ=Math.floor(c.position[2]);
      if(Math.abs(standX-job.x)+Math.abs(standZ-job.z)!==1||Math.abs(this.groundY(standX,standZ)-(job.y+1))>1.01){this.releasePerson(c);return;}
      const block=this.world.get(job.x,job.y,job.z);
      this.world.set(job.x,job.y,job.z,BLOCK.Air,{recordHistory:false});this.refreshGround();this.navigationDirty=true;
      if(block===BLOCK.SteelOre)this.drop('pigIron',IRON_ORE_YIELD,job.x,job.z);
      else{
        this.drop('stone',block===BLOCK.Stone?8:3,job.x,job.z);
        // Maps generated before ore veins can still supply iron through ordinary stone.
        if(block===BLOCK.Stone&&this.world.generatorVersion<3)this.drop('pigIron',2,job.x,job.z);
      }
    }
    const skill = workSkill(job.type);
    job.reserved={};c.skills[skill]=Math.min(20,c.skills[skill]+.12);this.s.metrics.jobsCompleted++;
    this.removeJob(job,false);c.task='工作完成';
  }

  private describeRoom(id:number,cells:[number,number][]):RoomView {
    const furniture = new Set(cells.map(([x,z])=>this.buildingAt.get(this.cellKey(x,z))));
    let floors=0, furnishing=0;
    for (const b of furniture) {
      if (!b?.complete) continue;
      if (b.kind==='floor') floors++;
      if (GUIDE_HOUSING_RULES.beds.has(b.kind) || b.kind==='table' || b.kind==='medicalBed') furnishing++;
    }
    const comfort=Math.min(100,35+floors/cells.length*40+furnishing*7);
    return {id,cells,enclosed:true,comfort,temperature:this.s.temperature*.4+21*.6,cleanliness:100};
  }

  private updateRooms():void {
    this.navigationDirty=false;this.rooms=[];this.roomAt.fill(-1);
    const barriers=new Set(this.s.buildings.filter(buildingSealsRoom).flatMap(b=>this.footprint(b).map(([x,z])=>this.cellKey(x,z))));
    if(barriers.size<4){for(const b of this.s.buildings){b.roomId=null;b.comfort=0;}this.refreshMerchantHomes();return;}
    const visited=new Uint8Array(this.world.width*this.world.depth);
    for(let start=0;start<this.world.width*this.world.depth;start++){
      if(visited[start]||barriers.has(start))continue;
      const queue=[start],cells:[number,number][]=[];visited[start]=1;let touchesEdge=false;
      for(let i=0;i<queue.length;i++){
        const cell=queue[i]!,x=cell%this.world.width,z=Math.floor(cell/this.world.width);cells.push([x,z]);
        if(x===0||z===0||x===this.world.width-1||z===this.world.depth-1)touchesEdge=true;
        for(const[dx,dz]of [[1,0],[-1,0],[0,1],[0,-1]]){const nx=x+dx!,nz=z+dz!,next=nx+nz*this.world.width;if(nx<0||nz<0||nx>=this.world.width||nz>=this.world.depth||visited[next]||barriers.has(next))continue;visited[next]=1;queue.push(next);}
      }
      if(touchesEdge||cells.length>120)continue;
      const id=this.rooms.length;
      this.rooms.push(this.describeRoom(id,cells));
      for(const[x,z]of cells)this.roomAt[x+z*this.world.width]=id;
    }
    for(const b of this.s.buildings){const room=this.roomAt[b.x+b.z*this.world.width]??-1;b.roomId=room>=0?room:null;b.comfort=room>=0?this.rooms[room]!.comfort:0;}
    this.refreshMerchantHomes();
  }

  // For a current tenant, test the structure with operable doors shut. A removed
  // wall, bed or table still invalidates the lease even while the door is open.
  private retainedGuideRoom(bed:BuildingView):RoomView|null {
    const cells:[number,number][]=[[bed.x,bed.z]];
    const seen=new Set([this.cellKey(bed.x,bed.z)]);
    for(let i=0;i<cells.length;i++){
      const [x,z]=cells[i]!;
      if(cells.length>120 || x===0 || z===0 || x===this.world.width-1 || z===this.world.depth-1)return null;
      for(const [dx,dz] of CARDINAL_STEPS){
        const nx=x+dx,nz=z+dz,key=this.cellKey(nx,nz);
        if(seen.has(key))continue;
        seen.add(key);
        const wall=this.buildingAt.get(key);
        if(wall && buildingSealsRoom({...wall,doorOpen:false}))continue;
        cells.push([nx,nz]);
      }
    }
    const live=bed.roomId===null?null:this.rooms[bed.roomId];
    return live?.cells.length===cells.length ? live : this.describeRoom(-1,cells);
  }

  private arrivedMerchants():MerchantId[] {
    return ['guide',...specialistIds.filter(id=>this.s.specialistMarket.progress[id].arrivalDay!==null)];
  }

  private merchantPosition(id:MerchantId='guide'):Position {
    return this.s.specialistMarket.walks[id]?.position??this.camp;
  }

  private startMerchantWalk(id:MerchantId) {
    const index=this.arrivedMerchants().indexOf(id);
    const offsets=[[0,0],[3,0],[-3,0],[0,3],[0,-3]];
    const [dx,dz]=offsets[index]??[0,0];
    const start=this.closestOpen(this.camp[0]+dx!,this.camp[2]+dz!,true,p=>
      this.roomAt[this.cellKey(Math.floor(p[0]),Math.floor(p[2]))]!<0 && this.path(this.camp,p)!==null)??this.camp;
    this.s.specialistMarket.walks[id]={position:[...(this.merchantHomes.get(id)?.position??start)],path:[],retryAt:this.s.time};
  }

  private walkMerchants(dt:number){
    for(const id of this.arrivedMerchants()){
      const walk=this.s.specialistMarket.walks[id]!,home=this.merchantHomes.get(id);
      if(!walk.path.length){
        if(this.s.time<walk.retryAt || home && horizontalDistance(walk.position,home.position)<.02)continue;
        walk.retryAt=this.s.time+3;
        const stride=Math.floor(this.s.time/3)+this.arrivedMerchants().indexOf(id)*5;
        const target=home?.position??this.closestOpen(this.camp[0]+(stride*7%13)-6,
          this.camp[2]+(stride*3%13)-6,true,p=>this.roomAt[this.cellKey(Math.floor(p[0]),Math.floor(p[2]))]!<0);
        if(target)walk.path=this.path(walk.position,target,false,undefined,Infinity,!!home || this.roomAt[this.cellKey(Math.floor(walk.position[0]),Math.floor(walk.position[2]))]!>=0)??[];
      }
      const next=walk.path[0];
      if(!next)continue;
      const x=Math.floor(next[0]),z=Math.floor(next[2]);
      if(!this.walkable(x,z)){
        const door=this.buildingAt.get(this.cellKey(x,z));
        if(!door?.complete || !isSwingDoor(door.kind) || !home && this.roomAt[this.cellKey(Math.floor(walk.position[0]),Math.floor(walk.position[2]))]!<0){walk.path=[];continue;}
        this.toggleDoor({action:'toggleDoor',id:door.id});
      }
      const distance=Math.hypot(next[0]-walk.position[0],next[1]-walk.position[1],next[2]-walk.position[2]);
      if(distance<=dt*1.35){walk.position=walk.path.shift()??next;continue;}
      for(const axis of [0,1,2] as const)walk.position[axis]+=(next[axis]-walk.position[axis])*dt*1.35/distance;
    }
  }

  private refreshMerchantHomes():void {
    const midX=Math.floor(this.world.width/2)+3,midZ=Math.floor(this.world.depth/2)+3;
    this.camp=this.closestOpen(midX,midZ,true,([x,,z])=>this.roomAt[this.cellKey(Math.floor(x),Math.floor(z))]!<0)
      ?? this.closestOpen(midX,midZ) ?? this.s.colonists[0]?.position ?? [midX+.5,6,midZ+.5];
    this.merchantHomes.clear();this.roomChoices=[];
    const choices:MerchantHome[]=[];
    const retained=new Set([this.s.guideBedId,...specialistIds.map(id=>this.s.specialistMarket.progress[id].bedId)]);
    const openDoor=this.s.buildings.some(b=>b.complete && isSwingDoor(b.kind) && b.doorOpen);
    for(const bed of this.s.buildings){
      if(!bed.complete || !GUIDE_HOUSING_RULES.beds.has(bed.kind))continue;
      const room=retained.has(bed.id) && openDoor ? this.retainedGuideRoom(bed) : this.rooms[bed.roomId??-1];
      if(!room || room.cells.length<GUIDE_HOUSING_RULES.minimumCells || !room.cells.some(([x,z])=>{
        const table=this.buildingAt.get(this.cellKey(x,z));
        return table?.complete && table.kind===GUIDE_HOUSING_RULES.table;
      }))continue;
      for(const [x,z] of room.cells){
        const dx=Math.max(bed.x-x,0,x-(bed.x+bed.w-1)),dz=Math.max(bed.z-z,0,z-(bed.z+bed.d-1));
        if(dx+dz!==1 || !this.walkable(x,z) || Math.abs(this.groundY(x,z)-bed.y)>1)continue;
        const position:Position=[x+.5,this.groundY(x,z),z+.5];
        if(this.path(this.camp,position,false,undefined,Infinity,true)===null)continue;
        choices.push({bed,position,room});break;
      }
    }
    const occupied=new Set<number>();
    for(const id of this.arrivedMerchants()){
      const bedId=id==='guide'?this.s.guideBedId:this.s.specialistMarket.progress[id].bedId;
      const home=choices.find(h=>h.bed.id===bedId && !occupied.has(this.cellKey(h.bed.x,h.bed.z)));
      if(home){
        this.merchantHomes.set(id,home);
        for(const [x,z] of home.room.cells)occupied.add(this.cellKey(x,z));
      }else if(id==='guide')this.s.guideBedId=null;
      else this.s.specialistMarket.progress[id].bedId=null;
      if(!this.s.specialistMarket.walks[id])this.startMerchantWalk(id);
    }
    this.roomChoices=choices.filter(h=>h.room.id>=0 && !occupied.has(this.cellKey(h.bed.x,h.bed.z)));
    this.planCalendar();
  }

  private availableHomes(){
    const rooms=new Set<number>();
    return this.roomChoices.filter(h=>{
      if(rooms.has(h.room.id) || this.s.colonists.some(c=>c.personal?.kind==='sleep' &&
        c.personal.buildingId && h.room.cells.some(([x,z])=>this.buildingAt.get(this.cellKey(x,z))?.id===c.personal?.buildingId)))return false;
      rooms.add(h.room.id);return true;
    });
  }

  private assignMerchantRoom(id:MerchantId,bedId?:string):CommandResult{
    if(!this.arrivedMerchants().includes(id))throw new Error('商人尚未到镇');
    const home=this.availableHomes().find(h=>h.bed.id===bedId);
    if(!home || !this.path(this.merchantPosition(id),home.position,false,undefined,Infinity,true))throw new Error('请选择可达的合格空房');
    if(id==='guide')this.s.guideBedId=home.bed.id;
    else this.s.specialistMarket.progress[id].bedId=home.bed.id;
    const walk=this.s.specialistMarket.walks[id]!;
    walk.path=[];walk.retryAt=this.s.time;
    this.refreshMerchantHomes();
    return {ok:true,message:'已为'+merchantName(id)+'安排住所'};
  }

  private planCalendar(){
    const market=this.s.specialistMarket;
    market.events=planMarketEvents(market.events,this.day(),specialistIds.filter(id=>this.merchantHomes.has(id)),this.s.worldSeed);
  }

  private clutterCells():Set<number> {
    const clutter = new Set(this.s.warehouseStacks.filter(stack => !stack.shelfId).map(stack => this.cellKey(stack.x,stack.z)));
    for (const item of this.s.items) if (item.age >= 10) clutter.add(this.cellKey(item.x,item.z));
    return clutter;
  }

  private roomCleanliness(room:RoomView,clutter:Set<number>):number {
    const count=room.cells.reduce((n,[x,z])=>n+Number(clutter.has(this.cellKey(x,z))),0);
    return Math.round(100-60*count/room.cells.length);
  }

  private merchantHousing(id:MerchantId,clutter:Set<number>):MerchantHousing {
    const home=this.merchantHomes.get(id),room=home?.room;
    return {npcId:id,status:home?'housed':'camp',position:[...this.merchantPosition(id)],
      roomId:room && room.id>=0 ? room.id:null,bedId:home?.bed.id??null,
      ...housingTerms(room?.comfort??0,room?this.roomCleanliness(room,clutter):0)};
  }

  private projectMarket(clutter:Set<number>):SpecialistMarketView {
    const market=this.s.specialistMarket;
    return {events:market.events,merchants:specialistIds.map(id=>{
      const {sold,arrivalDay}=market.progress[id];
      return {id,sold,arrivalDay,status:arrivalDay===null?'locked':'arrived',housing:arrivalDay===null?null:this.merchantHousing(id,clutter)};
    }),availableRooms:this.availableHomes().map(h=>({roomId:h.room.id,bedId:h.bed.id,position:h.position,
      comfort:h.room.comfort,cleanliness:this.roomCleanliness(h.room,clutter)}))};
  }

  get guideHousing():GuideHousing {
    return {...this.merchantHousing('guide',this.merchantHomes.has('guide')?this.clutterCells():new Set()),npcId:'guide'};
  }
  private updatePower(dt:number):void {
    const solar=this.s.buildings.filter(b=>b.complete&&b.kind==='solar').length;
    const batteries=this.s.buildings.filter(b=>b.complete&&b.kind==='battery').length;
    const coolers=this.s.buildings.filter(b=>b.complete&&b.kind==='cooler');
    const sun=Math.max(0,Math.sin((this.hour()-6)/12*Math.PI));
    const generation=solar*120*sun*(this.s.weather==='细雨'?.45:this.s.weather==='多云'?.7:1),demand=coolers.length*45;
    const capacity=batteries*12000;
    let stored=Math.min(this.s.power.stored,capacity),supplied=Math.min(demand,generation);
    if(generation>demand)stored=Math.min(capacity,stored+(generation-demand)*dt*.85);
    else{
      // A paused topology change updates availability without consuming stored energy or time.
      const draw=Math.min(stored,(demand-generation)*dt);stored-=draw;
      supplied+=dt>0?draw/dt:stored>0?demand-generation:0;
    }
    for(const b of this.s.buildings)b.powered=b.complete&&(BUILDING_DEFS[b.kind].power<=0||supplied>=demand-.001);
    this.s.power={generation,demand,stored,capacity,supplied,coldStorage:coolers.length>0&&supplied>=demand-.001};
  }
  private updateClimate():void {
    const seasonal={春季:20,夏季:29,秋季:16,冬季:3}[this.season()]??20;
    this.s.temperature=seasonal+Math.sin((this.hour()-8)/24*Math.PI*2)*5+(this.s.weather==='热浪'?12:this.s.weather==='寒潮'?-12:this.s.weather==='细雨'?-2:0);
    for(const room of this.rooms)room.temperature=this.s.temperature*.4+21*.6;
  }
  private newDay():void {
    this.s.lastDay=this.day();this.planCalendar();const roll=this.random();
    this.s.weather=roll<.1?'热浪':roll<.2?'寒潮':roll<.42?'细雨':roll<.64?'多云':'晴朗';
    this.event('weather',`第 ${this.day()} 天：${this.season()}，预计${this.s.weather}。留意居民需求与食品供应。`);
    if(this.day()%3===2&&this.s.colonists.length){
      const c=this.s.colonists[Math.floor(this.random()*this.s.colonists.length)]!;c.disease=Math.min(100,c.disease+45);c.health=Math.max(20,c.health-8);
      this.event('health',`${c.name}出现季节性感冒。安排医生、药品与休养可帮助恢复。`);
    }
    if(this.day()===4&&this.s.colonists.length<6){
      this.addColonist('远山',Math.floor(this.world.width/2)+1,Math.floor(this.world.depth/2)+3,3);this.event('arrival','旅人远山希望加入和平营地。他带来新的劳动力，也需要床位与食物。');
    }
  }

  /** Internal renderer projection; consumers must never mutate simulation data. */
  renderState(){
    const carriers = this.s.jobs.filter(job => job.assignedTo &&
      ((job.guideSale || job.targetId === PLAYER_DELIVERY_TARGET) && job.phase === 'deliver' || job.recipe && job.phase === 'work'));
    const colonists = carriers.length ? this.s.colonists.map(colonist => {
      const carrying = carriers.find(job => job.assignedTo === colonist.id);
      return carrying ? { ...colonist, carrying: carrying.guideSale ? {[carrying.guideSale.item]:carrying.guideSale.inTransit} : carrying.reserved } : colonist;
    }) : this.s.colonists;
    return {colonists,buildings:this.s.buildings,zones:this.zones(),crops:this.s.crops,items:this.s.items,
      warehouseStacks:this.s.warehouseStacks,selectedColonistId:this.s.selectedColonistId};
  }
  snapshot():ColonySnapshot {
    const clutter=this.rooms.length || this.merchantHomes.size ? this.clutterCells() : new Set<number>();
    const chests = this.s.buildings.flatMap(({id,x,z,storage}) => storage ? [{id,x,z,slots:storage}] : []);
    const rendered=this.renderState();
    const snapshot=copy({version:1 as const,speed:this.s.speed,time:this.s.time,day:this.day(),hour:this.hour(),season:this.season(),weather:this.s.weather,temperature:this.s.temperature,
      resources:this.s.resources,playerBag:this.inventoryColonist?.bag??emptySlots(PLAYER_SLOTS),bagSelected:this.inventoryColonist?.bagSelected??0,controlledColonistId:this.controlled?.id??null,chests,
      colonists:rendered.colonists.map(({path,personal,destination,retryAt,...view})=>view),buildings:this.s.buildings,
      zones:rendered.zones.map(z=>z.pasture?{...z,pasture:{...z.pasture,capacity:this.pastureSpace(z).length,ready:this.pastureReady(z)}}:z),crops:this.s.crops,warehouseStacks:this.s.warehouseStacks,
      items:this.s.items,jobs:this.s.jobs.map(({phase,resource,amount,destination,...view}) => {
        if (view.recipe) return { ...view, craftAmount: amount, craftPhase: phase === 'pickup' ? 'pickup' as const : 'work' as const };
        if (view.targetId === PLAYER_DELIVERY_TARGET) return { ...view, deliveryPhase: phase === 'deliver' ? 'deliver' as const : 'pickup' as const };
        return view;
      }),rooms:this.rooms.map(r=>({...r,cleanliness:this.roomCleanliness(r,clutter)})),guideHousing:{...this.merchantHousing('guide',clutter),npcId:'guide' as const},specialistMarket:this.projectMarket(clutter),research:this.s.research,power:this.s.power,
      events:this.s.events,metrics:this.s.metrics,selectedColonistId:this.s.selectedColonistId});
    const terrainPlans=this.s.terrainPlans.map(({initialWork,cells,...view})=>{
      let stable=this.terrainCellViews.get(view.id);if(!stable){stable=cells.map(([x,z])=>Object.freeze([x,z]) as unknown as [number,number]);Object.freeze(stable);this.terrainCellViews.set(view.id,stable);}
      return {...view,cells:stable};
    });
    return {...snapshot,terrainPlans,...(this.s.finale ? {finale:this.finale} : {})};
  }
  serialize():unknown{
    const state=copy(this.s);
    const resident=state.colonists.find(person=>person.id===this.controlled?.id);
    if(resident){
      const [x,y,z]=resident.position;
      const ground=this.groundY(Math.floor(x),Math.floor(z));
      if(ground>=1&&y>ground)resident.position=[x,this.walkSurface?.(x,z,ground)??ground,z];
      resident.task='等待工作';resident.retryAt=state.time;
    }
    return state;
  }
  load(data:unknown):void {
    const legacyWarehouse = (data as {warehouseLayout?:unknown}|null)?.warehouseLayout !== WAREHOUSE_LAYOUT;
    const validated=this.validate(data);
    this.processionPaths.clear();
    // Older completed furniture was allowed to cut individual leaves. Its new complete
    // tree model must not grow back through that furniture when upgrading the save.
    const obstructingTrees=new Set<string>();
    for(const b of validated.buildings)if(b.complete)for(const p of buildingParts(b))for(const tree of this.world.treesAtVoxel(p.x,p.y,p.z))obstructingTrees.add(tree.id);
    for(const id of obstructingTrees)this.world.removeTree(id,{recordHistory:false});
    this.deliveryMessage = undefined;
    this.controlled=null;
    this.s=validated;this.terrainCellViews.clear();this.terrainIndexDirty=true;this.rebuildBuildings();this.refreshGround();this.refreshTerrainPlans();this.navigationDirty=true;this.updateRooms();
    this.moveObstructedGroundStorage();
    if (legacyWarehouse) this.storeInitialSupplies();
    for(const [i,c] of this.s.colonists.entries()){
      if(!this.s.colonists.slice(0,i).some(other=>residentsOverlap(c.position,other.position)))continue;
      const free=this.closestOpen(c.position[0],c.position[2],false,p=>!this.residentAt(p,c.id));
      if(free){this.releasePerson(c);c.position=free;c.task='等待工作';}
    }
    this.refreshTreeJobs();
    this.stopPlayerConstruction();
  }
  private validate(data:unknown):SavedState {
    const fail=():never=>{throw new Error('殖民地存档数据不完整、损坏或版本不兼容。');};
    if(!data||typeof data!=='object')fail();
    const s=copy(data) as Omit<SavedState,'version'|'warehouseLayout'> & {version:1|2|3;warehouseLayout?:number;chests?:ChestView[];playerBag?:PlayerInventorySlot[];bagSelected?:number;trade?:unknown;bills?:unknown};
    if(s.version!==1&&s.version!==2&&s.version!==3)fail();
    const legacy=s.version<3;
    const legacyChests=s.version===1?(s.chests??[this.starterChest()]):[];
    // Legacy objects are upgraded together, on the private copy, before any live state changes.
    if (Array.isArray(s.events)) s.events = s.events.filter(event => (event?.type as string) !== 'trade');
    s.terrainPlans??=[];
    const oldBag=legacy ? s.playerBag??[{ resource: HAMMER, count: 1 }, ...emptySlots(PLAYER_SLOTS-1)] : undefined;

    // 水稻原来共用白菜的外观。保留田格、生长进度、种子库存和预留量。
    const migrateSeedAmounts = (amounts: (Partial<Resources> & { riceSeed?: number }) | undefined) => {
      if (!amounts || !Object.hasOwn(amounts, 'riceSeed')) return;
      const old = amounts.riceSeed;
      const current = amounts.cabbageSeed ?? 0;
      if (typeof old !== 'number' || !Number.isSafeInteger(old) || old < 0
        || !Number.isSafeInteger(current) || current < 0) fail();
      amounts.cabbageSeed = current + old!;
      delete amounts.riceSeed;
    };
    const migrateSeedItem = (stack: { resource?: unknown } | null | undefined) => {
      if (stack?.resource === 'riceSeed') stack.resource = 'cabbageSeed';
    };
    const migrateSeedSlots = (slots: unknown) => {
      if (Array.isArray(slots)) for (const slot of slots) migrateSeedItem(slot);
    };
    migrateSeedAmounts(s.resources);
    migrateSeedSlots(oldBag);
    if (Array.isArray(legacyChests)) for (const chest of legacyChests) migrateSeedSlots(chest?.slots);
    if (Array.isArray(s.buildings)) for (const building of s.buildings) migrateSeedSlots(building?.storage);
    if (Array.isArray(s.zones)) for (const zone of s.zones) {
      if (zone && (zone.crop as string) === 'rice') zone.crop = DEFAULT_CROP;
    }
    if (Array.isArray(s.crops)) for (const crop of s.crops) {
      if (crop && (crop.kind as string) === 'rice') crop.kind = DEFAULT_CROP;
    }
    if (Array.isArray(s.colonists)) for (const person of s.colonists) {
      migrateSeedSlots(person?.bag);
      migrateSeedAmounts(person?.carrying);
      migrateSeedAmounts(person?.personal?.reserved);
      if (typeof person?.task === 'string') person.task = person.task.replaceAll('水稻', '白菜');
    }
    if (Array.isArray(s.items)) for (const item of s.items) migrateSeedItem(item);
    if (Array.isArray(s.warehouseStacks)) for (const stack of s.warehouseStacks) migrateSeedItem(stack);
    if (Array.isArray(s.jobs)) for (const job of s.jobs) {
      migrateSeedItem(job);
      migrateSeedAmounts(job?.reserved);
      if (typeof job?.label === 'string') job.label = job.label.replaceAll('水稻', '白菜');
    }

    // 老存档没有作物/料理这些新资源，缺的补 0，否则面板上会显示 NaN
    if (s.resources && typeof s.resources === 'object') {
      for (const seed of CROP_SEEDS) if (!Object.hasOwn(s.resources, seed)) s.resources[seed] = STARTER_SEED_PACKS;
      for (const resource of SUPPLY_TYPES) if (!Object.hasOwn(s.resources, resource)) s.resources[resource] = STARTER_SUPPLIES;
      if (!Object.hasOwn(s.resources, 'lambChopStew')) s.resources.lambChopStew = 10;
      for (const r of RESOURCE_TYPES) if (!Object.hasOwn(s.resources, r)) s.resources[r] = 0;
    }
    const legacyBuildings=new Set<string>();
    if(Array.isArray(s.buildings))for(const b of s.buildings)if(b&&typeof b==='object'){
      if(b.rotation===undefined&&b.h===undefined){legacyBuildings.add(b.id);b.rotation=0;b.h=BUILDING_DEFS[b.kind]?.height??1;if(b.kind==='door')b.doorOpen??=false;}
      if(b.kind==='stoneDoor' && b.doorOpen===undefined) b.doorOpen=false;
      b.w??=1;b.d??=1;b.phase??=b.complete?'completed':'readyToBuild';
    }
    if(Array.isArray(s.colonists))for(const c of s.colonists)if(c&&typeof c==='object'){if(legacy){c.bag??=emptySlots(1);if(Array.isArray(c.bag)&&c.bag.length===1)c.bag.push(...emptySlots(PLAYER_SLOTS-1));c.bagSelected??=0;c.stamina??=100;c.facing??=0;}if(c.skills)c.skills.terraform??=c.skills.construct??2;if(c.priorities)c.priorities.terraform??=c.priorities.construct??3;}
    const finite=(n:unknown,min=0,max=1e9)=>typeof n==='number'&&Number.isFinite(n)&&n>=min&&n<=max;
    const integer=(n:unknown,min=0,max=1e9)=>finite(n,min,max)&&Number.isInteger(n);
    const text=(x:unknown,max=200)=>typeof x==='string'&&x.length<=max;
    if(s.guideBedId!=null && !text(s.guideBedId,80))fail();
    const list=(x:unknown,max:number)=>Array.isArray(x)&&x.length<=max;
    const isBuildingItem = (resource: unknown) => typeof resource==='string'&&!!buildingItemKind(resource);
    const saveDay = Math.floor(s.time / DAY_SECONDS) + 1;
    const validMark = (mark:ColdMark, resource:InventoryItem, count:number) => mark.premium === undefined ||
      !!coldEffect(resource) && !!mark.premium && integer(mark.premium.day,1,saveDay) && integer(mark.premium.count,1,count);
    const validMap = (map:QualityMap | undefined, amounts:Partial<Resources>) => map === undefined ||
      !!map && typeof map==='object' && !Array.isArray(map) && Object.entries(map).every(([r,mark]) =>
        isResource(r) && !!mark && validMark(mark,r,amounts[r] ?? 0));
    const inventory = (slots: unknown, size: number) => Array.isArray(slots) && slots.length === size
      && TOOL_KINDS.every(tool => slots.filter(slot => slot?.resource === tool).length <= 1)
      && slots.every(slot => slot === null || slot && validMark(slot,slot.resource,slot.count) && (isToolKind(slot.resource)
        ? slot.count === 1 : (isResource(slot.resource)||isBuildingItem(slot.resource)) && integer(slot.count, 1, STACK_LIMIT)));
    const area=this.world.width*this.world.depth;
    const position=(p:unknown)=>Array.isArray(p)&&p.length===3&&finite(p[0],0,this.world.width)&&finite(p[1],0,this.world.height)&&finite(p[2],0,this.world.depth);
    const resources=(r:unknown,partial=false)=>!!r&&typeof r==='object'&&!Array.isArray(r)&&Object.keys(r).every(k=>RESOURCE_TYPES.includes(k as Resource))
      &&RESOURCE_TYPES.every(k=>partial&&(r as Resources)[k]===undefined||integer((r as Resources)[k],0,1e7));
    if(s.type!=='peaceful-colony'||s.worldSeed!==this.world.seed||!finite(s.time)||!finite(s.accumulator,0,STEP)||!integer(s.rng,1,4294967295)||!integer(s.nextId,1)||!SPEEDS.includes(s.speed)||!finite(s.decision,0,1)||!integer(s.lastDay,1)||!finite(s.spoilage,0,1000))fail();
    if(!resources(s.resources)||!list(s.colonists,20)||s.colonists.length<1||!list(s.buildings,area)||!list(s.zones,area)||!list(s.crops,area)||!list(s.items,Math.max(5000,area))||!list(s.jobs,Math.max(6000,area))||!list(s.events,80)||!list(s.terrainPlans,area))fail();
    // Retire inventory-target jobs and refund reservations exactly once on import.
    const retired = new Set<string>();
    s.jobs = s.jobs.filter(job => {
      if (!job || job.recipe !== undefined || (job.type !== 'cook' && job.type !== 'craft')) return true;
      if (!text(job.id, 80) || retired.has(job.id) || !resources(job.reserved, true)) fail();
      retired.add(job.id);
      for (const resource of RESOURCE_TYPES) s.resources[resource] += job.reserved[resource] ?? 0;
      return false;
    });
    if (retired.size) for (const resident of s.colonists) {
      if (!resident?.jobId || !retired.has(resident.jobId)) continue;
      resident.jobId = null;
      resident.path = [];
      resident.destination = null;
      resident.task = '等待工作';
    }
    if (!resources(s.resources)) fail();
    const unique=(rows:{id:string}[])=>{const ids=new Set<string>();for(const row of rows){if(!row||!text(row.id,80)||!row.id||ids.has(row.id))fail();ids.add(row.id);}return ids;};
    if (legacy&&!inventory(oldBag,PLAYER_SLOTS) || !list(legacyChests,area))fail();
    unique(legacyChests);
    const chestCells = new Set<number>();
    for (const chest of legacyChests) {
      if (!integer(chest.x, 0, this.world.width - 1) || !integer(chest.z, 0, this.world.depth - 1) || !inventory(chest.slots, CHEST_SLOTS)) fail();
      const key = this.cellKey(chest.x, chest.z);
      if (chestCells.has(key)) fail();
      chestCells.add(key);
    }
    const colonistIds=unique(s.colonists),buildingIds=unique(s.buildings),cropIds=unique(s.crops),itemIds=unique(s.items),jobIds=unique(s.jobs),planIds=unique(s.terrainPlans);unique(s.zones);unique(s.events);
    const location=(r:{x:number;y:number;z:number})=>integer(r.x,0,this.world.width-1)&&integer(r.z,0,this.world.depth-1)&&finite(r.y,0,this.world.height);
    for(const c of s.colonists){
      if(!text(c.name,40)||!list(c.traits,10)||!c.traits.every(t=>text(t,40))||!position(c.position)||!position(c.color)||!['balanced','day','night','rest'].includes(c.schedule)
        ||!['health','hunger','rest','recreation','mood','disease','comfort'].every(k=>finite(c[k as keyof Colonist],0,100))||!text(c.task)||!resources(c.carrying,true)||!validMap(c.cargoQuality,c.carrying)||c.personal&&!validMap(c.personal.quality,c.personal.reserved)||!inventory(c.bag,PLAYER_SLOTS)||!validSlot(c.bagSelected,c.bag)||!finite(c.stamina,0,100)||typeof c.facing!=='number'||!Number.isFinite(c.facing)
        ||!list(c.path,area)||!c.path.every(position)||c.destination!==null&&!position(c.destination)||!finite(c.retryAt)||!c.skills||!c.priorities
        ||!JOB_TYPES.every(j=>finite(c.skills[j],0,20)&&integer(c.priorities[j],0,4))||c.jobId!==null&&!jobIds.has(c.jobId))fail();
      if(c.personal&&(!['eat','sleep','relax','wander','patient'].includes(c.personal.kind)||!finite(c.personal.elapsed)||!finite(c.personal.duration,0,1000)||!resources(c.personal.reserved,true)||c.personal.buildingId!==undefined&&!buildingIds.has(c.personal.buildingId)))fail();
      for(let i=1;i<c.path.length;i++)if(horizontalDistance(c.path[i-1]!,c.path[i]!)>1.01||Math.abs(c.path[i-1]![1]-c.path[i]![1])>1.01)fail();
    }
    for(const b of s.buildings){
      if(!location(b)||!integer(b.y,1,this.world.height-1)||!(b.kind in BUILDING_DEFS)||typeof b.complete!=='boolean'||!finite(b.progress,0,1)||!resources(b.reserved,true)||typeof b.powered!=='boolean'||!finite(b.comfort,0,100)||b.roomId!==null&&!integer(b.roomId,0,area)||!integer(b.w,1,this.world.width)||!integer(b.d,1,this.world.depth)||!integer(b.h,1,this.world.height)||!integer(b.rotation,0,3)||b.x+b.w>this.world.width||b.z+b.d>this.world.depth||b.y+b.h>this.world.height||!['preparingTerrain','readyToBuild','constructing','completed'].includes(b.phase)||b.terrainPlanId!==undefined&&!planIds.has(b.terrainPlanId)||b.blockedReason!==undefined&&!text(b.blockedReason)||isSwingDoor(b.kind)&&typeof b.doorOpen!=='boolean'||!isSwingDoor(b.kind)&&b.doorOpen!==undefined)fail();
      if(b.complete&&(b.phase!=='completed'||b.progress!==1||Object.keys(b.reserved).length)||!b.complete&&b.phase==='completed')fail();
      const slots=BUILDING_DEFS[b.kind].storageSlots;
      if(slots ? !b.complete||!inventory(b.storage,slots) : b.storage!==undefined)fail();
    }
    if (s.finale) {
      const f=s.finale;
      if (!s.buildings.some(b=>b.id===f.buildingId && b.kind==='campfirePlaza' && b.complete) ||
        !['gathering','show','departing'].includes(f.phase) || !finite(f.elapsed) || !finite(f.startTime) ||
        !finite(f.nightTime,f.startTime) || !Array.isArray(f.guests) || f.guests.length!==colonistIds.size ||
        new Set(f.guests.map(g=>g.id)).size!==colonistIds.size ||
        f.guests.some(g=>!colonistIds.has(g.id)||!position(g.home)||!position(g.seat)||!text(g.task)||
          !Number.isFinite(g.facing)||typeof g.arrived!=='boolean')) fail();
    }
    const originalOccupied=new Set<string>();
    for(const b of s.buildings)for(const[x,z]of this.footprint(b)){const key=`${x},${z}`;if(originalOccupied.has(key))fail();originalOccupied.add(key);}
    for(const b of s.buildings)if(legacyBuildings.has(b.id)){
      const dimensions=buildingDimensions(b.kind,b.rotation);
      if(b.w===dimensions.w&&b.d===dimensions.d&&b.h===dimensions.h&&(!b.complete||buildingParts(b).every(p=>this.world.get(p.x,p.y,p.z)===BLOCK.Air)))continue;
      const oldX=b.x,oldZ=b.z,position=this.findBuildingPosition(b.kind,b.x,b.z,s.buildings.filter(other=>other!==b),b.rotation,b.y,s.crops);
      if(!position)throw new Error(`旧存档中的${BUILDING_DEFS[b.kind].name}没有安全的完整占地，加载已取消；请先在旧版清理附近空间。`);
      Object.assign(b,position,dimensions);
      for(const plan of s.terrainPlans)if(plan.buildingId===b.id){plan.cells=this.footprint(b);plan.initialWork=plan.cells.reduce((n,[x,z])=>n+Math.abs(this.world.terrainHeight(x,z)-b.y),0);}
      for(const job of s.jobs)if(job.targetId===b.id||job.type==='research'&&job.x===oldX&&job.z===oldZ){job.x=b.x;job.y=b.y;job.z=b.z;if(job.assignedTo){const c=s.colonists.find(c=>c.id===job.assignedTo);if(c){c.jobId=null;c.path=[];c.destination=null;c.retryAt=0;}job.assignedTo=null;job.state='queued';}}
      for(const c of s.colonists)if(c.personal&&(c.personal.buildingId===b.id||c.destination?.[0]===oldX+.5&&c.destination?.[2]===oldZ+.5)){
        for(const r of RESOURCE_TYPES)s.resources[r]+=c.personal.reserved[r]??0;c.personal=null;c.destination=null;c.path=[];c.retryAt=0;
      }
    }
    const occupied=new Set<string>();
    for (const b of s.buildings) if (b.storageClass !== undefined && (b.kind !== 'shelf' || !isStorageClass(b.storageClass))) fail();
    for (const z of s.zones) if (z.storageClass !== undefined && (z.kind !== 'stockpile' || !isStorageClass(z.storageClass))) fail();
    for(const b of s.buildings){
      const dimensions=buildingDimensions(b.kind,b.rotation);
      const oldShelf=b.kind==='shelf'&&b.w===1&&b.d===1&&b.h===1;
      if(!oldShelf&&(b.w!==dimensions.w||b.d!==dimensions.d||b.h!==dimensions.h))fail();
      if(b.complete&&buildingParts(b).some(p=>this.world.get(p.x,p.y,p.z)!==BLOCK.Air))fail();
      for(const p of buildingParts(b)){const key=`${p.x},${p.y},${p.z}`;if(occupied.has(key))fail();occupied.add(key);}
    }
    for(const z of s.zones)if(!location(z)||!['farm','stockpile','pasture'].includes(z.kind)||!integer(z.w,1,this.world.width)||!integer(z.d,1,this.world.depth)||z.x+z.w>this.world.width||z.z+z.d>this.world.depth||!isCropKind(z.crop)||z.shelfId!==undefined)fail();
    for (const zone of s.zones) if (zone.cells !== undefined) {
      if (!list(zone.cells,zone.w*zone.d) || !zone.cells.length) fail();
      const seen=new Set<number>();
      for (const cell of zone.cells) {
        if (!Array.isArray(cell) || cell.length!==2 || !integer(cell[0],zone.x,zone.x+zone.w-1) || !integer(cell[1],zone.z,zone.z+zone.d-1)) fail();
        seen.add(this.cellKey(cell[0],cell[1]));
      }
      if (seen.size!==zone.cells.length) fail();
    }
    const animalIds=new Set<string>();
    for(const zone of s.zones){
      if(zone.kind!=='pasture'){if(zone.pasture) fail();continue;}
      const pen=zone.pasture, layout=pastureLayout(zone);
      const validGate=(p:unknown)=>Array.isArray(p)&&p.length===2&&layout.gates.some(g=>g.cell[0]===p[0]&&g.cell[1]===p[1]);
      if(!pen||!layout.connected||!validGate(pen.gate)||pen.pendingGate&&!validGate(pen.pendingGate)||!list(pen.animals,area*2))fail();
      for(const a of pen!.animals){
        if(!a||!Object.hasOwn(STOCK_VOLUME,a.kind)||!text(a.id,80)||animalIds.has(a.id)||typeof a.young!=='boolean'||typeof a.female!=='boolean'||!['home','leading','ordered'].includes(a.state)||!finite(a.readyAt)||!integer(a.x,0,this.world.width-1)||!integer(a.z,0,this.world.depth-1)||!containsCell(zone,a.homeX,a.homeZ))fail();
        animalIds.add(a.id);
      }
    }
    if (s.warehouseLayout !== undefined && s.warehouseLayout !== 2 && s.warehouseLayout !== WAREHOUSE_LAYOUT) fail();
    // Older slot records are a projection of the same inventory totals. Repack once on load.
    if (s.warehouseLayout !== WAREHOUSE_LAYOUT) s.warehouseStacks=[];
    if (!list(s.warehouseStacks,area*SHELF_BAYS*STORAGE_QUARTERS*WAREHOUSE_STACK_LIMIT)) fail();
    const occupiedBays = new Map<string,{mask:number;cards:boolean}>();
    const packedSlots = new Map<string,{count:number;resources:Set<Resource>}>();
    const shelves = new Map(s.buildings.filter(b => b.kind==='shelf' && b.complete).map(b => [b.id,b]));
    const available = {...s.resources};
    s.warehouseStacks = s.warehouseStacks.flatMap(stack => {
      if (!stack || !integer(stack.x,0,this.world.width-1) || !integer(stack.z,0,this.world.depth-1)
        || !isResource(stack.resource) || !integer(stack.count,1,WAREHOUSE_STACK_LIMIT)
        || (stack.shelfId !== undefined && (!stack.shelfId || !text(stack.shelfId,80)))
        || !integer(stack.slot,0,(stack.shelfId ? SHELF_BAYS : 1)*STORAGE_QUARTERS-1)) fail();
      if (!validMark(stack,stack.resource,stack.count)) fail();
      if (stack.freezing !== undefined && (!coldEffect(stack.resource) || !list(stack.freezing,stack.count) ||
        !stack.freezing.every((lot,i,lots) => lot && finite(lot.since,0,s.time) && integer(lot.count,1,stack.count) && (!i || lot.since>=lots[i-1]!.since)) ||
        stack.freezing.reduce((n,lot)=>n+lot.count,0)+premiumCount(stack,saveDay)>stack.count)) fail();
      const key=warehouseBayKey(stack), mask=packageMask(stack.resource,stack.slot%STORAGE_QUARTERS);
      const previous=occupiedBays.get(key), cards=isWarehouseCard(stack.resource);
      if (!mask || previous && (previous.cards!==cards || !cards&&(previous.mask&mask)!==0)) fail();
      occupiedBays.set(key,{mask:(previous?.mask??0)|mask,cards});
      const slot=warehouseSlotKey(stack);
      const contents=packedSlots.get(slot)??{count:0,resources:new Set<Resource>()};
      if (contents.resources.has(stack.resource) || contents.count+stack.count>WAREHOUSE_STACK_LIMIT) fail();
      contents.resources.add(stack.resource);
      contents.count+=stack.count;
      packedSlots.set(slot,contents);
      const owner = stack.shelfId ? shelves.get(stack.shelfId) : undefined;
      if (stack.shelfId ? !owner || owner.x !== stack.x || owner.z !== stack.z
        : !s.zones.some(zone => zone.kind==='stockpile' && containsCell(zone,stack.x,stack.z))) return [];
      const count=Math.min(stack.count,available[stack.resource]);
      available[stack.resource]-=count;
      return count ? [{...stack,count}] : [];
    });
    const targets=new Map<number,number>();
    for(const p of s.terrainPlans){
      if(!integer(p.target,1,this.world.height-2)||!list(p.cells,area)||!p.cells.length||!finite(p.initialWork)||!finite(p.remainingCut)||!finite(p.remainingFill)||!finite(p.progress,0,1)||!['queued','working','blocked','completed'].includes(p.state)||p.blockedReason!==undefined&&!text(p.blockedReason)||p.buildingId!==undefined&&!buildingIds.has(p.buildingId))fail();
      const seen=new Set<number>();for(const cell of p.cells){if(!Array.isArray(cell)||cell.length!==2||!integer(cell[0],0,this.world.width-1)||!integer(cell[1],0,this.world.depth-1))fail();const key=this.cellKey(cell[0],cell[1]);if(seen.has(key))fail();seen.add(key);if(p.state!=='completed'){if(targets.has(key)&&targets.get(key)!==p.target)fail();targets.set(key,p.target);}}
      if(p.buildingId){const b=s.buildings.find(b=>b.id===p.buildingId)!;if(b.terrainPlanId!==p.id||b.y!==p.target||p.cells.length!==b.w*b.d||p.cells.some(([x,z])=>x<b.x||z<b.z||x>=b.x+b.w||z>=b.z+b.d))fail();}
    }
    for(const p of s.crops)if(!location(p)||!isCropKind(p.kind)||typeof p.planted!=='boolean'||!finite(p.growth,0,1))fail();
    for(const chest of legacyChests){
      if(buildingIds.has(chest.id))fail();
      const position=this.findBuildingPosition('chest',chest.x,chest.z,s.buildings,0,undefined,s.crops);
      if(!position)throw new Error('旧存档中的木箱附近没有可用空地，加载已取消。');
      s.buildings.push(this.chestBuilding(chest,position));
      buildingIds.add(chest.id);
    }
    if(oldBag?.some(Boolean)){
      const [x,,z]=s.colonists[0]!.position;
      const near=this.findBuildingPosition('chest',Math.floor(x),Math.floor(z),s.buildings,0,undefined,s.crops);
      if(near&&s.buildings.length<area&&!buildingIds.has('chest-legacy-player')){
        s.buildings.push(this.chestBuilding({id:'chest-legacy-player',x:near.x,z:near.z,slots:[...oldBag,...emptySlots(CHEST_SLOTS-PLAYER_SLOTS)]},near));
        buildingIds.add('chest-legacy-player');
      }else{
        for(const slot of oldBag)if(slot){
          const id='item-'+s.nextId++;
          s.items.push({id,resource:slot.resource,amount:slot.count,x:Math.min(this.world.width-1,Math.floor(x)),y:s.colonists[0]!.position[1],z:Math.min(this.world.depth-1,Math.floor(z)),age:0,reservedBy:null,playerOnly:true,scatter:true});
        }
      }
    }
    for(const item of s.items){
      if(!validMark(item,item.resource,item.amount)||!location(item)||!finite(item.age)||item.scatter!==undefined&&typeof item.scatter!=='boolean'||item.playerOnly!==undefined&&typeof item.playerOnly!=='boolean')fail();
      if(item.playerOnly||!isResource(item.resource)){
        if(item.reservedBy!==null || (isToolKind(item.resource)?item.amount!==1:!(isResource(item.resource)||isBuildingItem(item.resource))||!integer(item.amount,1,1e7)))fail();
      }else if(!integer(item.amount,1,1e7)||item.reservedBy!==null&&!jobIds.has(item.reservedBy))fail();
    }
    const demolitionTargets = new Set<string>();
    const staffedStations = new Set<string>();
    for(const j of s.jobs){
      if(!validMap(j.quality,j.reserved)||!location(j)||!(['demolish','herd','husbandry'].includes(j.type)||JOB_TYPES.includes(j.type as JobType))||!text(j.targetId,j.type==='chop'?120:80)||!finite(j.progress)||!finite(j.work,.01,10000)||!['queued','working','blocked'].includes(j.state)||j.assignedTo!==null&&!colonistIds.has(j.assignedTo)||!resources(j.reserved,true)||!text(j.label)||!['work','pickup','deliver'].includes(j.phase)||!integer(j.amount,0,10000)||j.destination!==null&&!position(j.destination)||j.resource!==undefined&&!RESOURCE_TYPES.includes(j.resource))fail();
      if (j.type === 'cook' || j.type === 'craft' || j.recipe !== undefined) {
        const recipe = recipeFor(j.recipe);
        const station = s.buildings.find(b => b.id === j.targetId);
        if (!recipe?.station || recipe.job !== j.type || !station?.complete || station.kind !== recipe.station ||
            !integer(j.amount, 1, 99) || j.work !== recipe.work * j.amount || j.progress >= j.work ||
            j.x !== station.x || j.y !== station.y || j.z !== station.z || j.recipientId !== undefined ||
            (j.phase !== 'pickup' && j.phase !== 'work') || (j.phase === 'work' && !j.assignedTo) ||
            (j.phase === 'pickup' && Boolean(j.destination) !== Boolean(j.assignedTo)) ||
            (j.assignedTo && staffedStations.has(j.targetId))) fail();
        const expectedCost = j.phase === 'work' ? recipeCost(recipe!, j.amount) : {};
        if (RESOURCE_TYPES.some(r => (j.reserved[r] ?? 0) !== (expectedCost[r] ?? 0))) fail();
        if (j.assignedTo) staffedStations.add(j.targetId);
      } else if (j.type === 'demolish') {
        const b = s.buildings.find(building => building.id === j.targetId);
        if (!b?.complete || b.x !== j.x || b.y !== j.y || b.z !== j.z || demolitionTargets.has(b.id)
          || j.phase !== 'work' || j.progress >= j.work || Object.keys(j.reserved).length) fail();
        demolitionTargets.add(j.targetId);
      }
      if (j.targetId==='guide-delivery' || j.guideSale) {
        const g=j.guideSale;
        if (!g || j.targetId!=='guide-delivery' || j.type!=='haul' || j.phase==='work' || !isResource(g.item)
          || !['buy','recycle'].includes(g.side) || !integer(g.count,1,1e7) || !integer(g.premium,0,g.count)
          || !integer(g.total,0,1e9) || !integer(g.delivered,0,g.count-1) || !integer(g.inTransit,0,Math.min(HAUL_LIMIT,g.count-g.delivered))
          || !integer(g.paid,0,g.total) || !list(g.lots,area*STORAGE_QUARTERS+1)
          || g.lots.some(l=>!l || !integer(l.x,0,this.world.width-1)||!integer(l.z,0,this.world.depth-1)||!integer(l.count,1,g.count))
          || g.pickupAt!==undefined && (!position(g.pickupAt)||!g.inTransit||j.phase!=='pickup')
          || (j.phase==='deliver')!==Boolean(g.inTransit&&!g.pickupAt) || j.phase==='deliver'&&!j.assignedTo) fail();
        if(g) {
          const buy=g.side==='buy', claimed=g.delivered+(buy?g.inTransit:0);
          if(g.paid!==Math.floor(g.total*claimed/g.count) || Object.keys(j.reserved).length!==1 ||
            (buy ? j.reserved.silver!==g.total-g.paid || g.premium!==0 || g.lots.length!==0 :
              j.reserved[g.item]!==g.count-g.delivered || g.lots.reduce((n,l)=>n+l.count,0)+g.inTransit+g.delivered!==g.count)) fail();
        }
      } else if (j.targetId === PLAYER_DELIVERY_TARGET) {
        if(legacy && !j.recipientId){
          j.recipientId=s.selectedColonistId&&colonistIds.has(s.selectedColonistId)?s.selectedColonistId:s.colonists[0]!.id;
          if(j.assignedTo===j.recipientId){
            const courier=s.colonists.find(person=>person.id===j.assignedTo)!;
            courier.jobId=null;courier.path=[];courier.destination=null;
            j.assignedTo=null;j.phase='pickup';j.state='queued';
          }
        }
        if (!j.recipientId||!colonistIds.has(j.recipientId)||j.recipientId===j.assignedTo||j.type !== 'haul' || !j.resource || !integer(j.reserved[j.resource], 1, PLAYER_SLOTS * STACK_LIMIT)
          || Object.keys(j.reserved).length !== 1 || j.phase === 'work' || j.phase === 'deliver' && !j.assignedTo) fail();
      } else if(j.type==='construct'&&!buildingIds.has(j.targetId)||['grow','harvest'].includes(j.type)&&!cropIds.has(j.targetId)||j.type==='haul'&&j.phase==='pickup'&&!itemIds.has(j.targetId)||j.type==='doctor'&&!colonistIds.has(j.targetId)||j.type==='research'&&!RESEARCH_DEFS[j.targetId])fail();
      if(j.type==='terraform'&&(!targets.has(this.cellKey(j.x,j.z))||j.targetId!==`earth:${j.x}:${j.z}`))fail();
      if(j.assignedTo&&s.colonists.find(c=>c.id===j.assignedTo)?.jobId!==j.id)fail();
    }
    if(!s.research||!list(s.research.completed,10)||!s.research.completed.every(id=>!!RESEARCH_DEFS[id])||new Set(s.research.completed).size!==s.research.completed.length||s.research.active!==null&&!RESEARCH_DEFS[s.research.active]||!s.research.progress||Object.entries(s.research.progress).some(([id,p])=>!RESEARCH_DEFS[id]||!finite(p,0,RESEARCH_DEFS[id]!.work)))fail();
    if(!s.power||!['generation','demand','stored','capacity','supplied'].every(k=>finite(s.power[k as keyof typeof s.power]))||typeof s.power.coldStorage!=='boolean'||s.power.stored>s.power.capacity+1e-6)fail();
    if(!s.metrics||!Object.values(s.metrics).every(v=>finite(v))||!text(s.weather,20)||!['晴朗','多云','细雨','热浪','寒潮'].includes(s.weather)||!finite(s.temperature,-40,70)||s.selectedColonistId!==null&&!colonistIds.has(s.selectedColonistId))fail();
    for(const e of s.events)if(!finite(e.time)||!integer(e.day,1)||!finite(e.hour,0,24)||!text(e.text,300)||!['info','weather','health','research','arrival'].includes(e.type))fail();
    // Old saves used tree:x:z rather than an object identity. Preserve valid work once,
    // release stale/duplicate assignments, and never interpret hand-built wood as a tree.
    const chopTargets=new Set<string>();
    s.jobs=s.jobs.filter(job=>{
      if(job.type!=='chop')return true;
      const legacy=/^tree:(\d+):(\d+)$/.exec(job.targetId);
      const tree=this.world.getTree(job.targetId)??(legacy?this.world.treeAtColumn(Number(legacy[1]),Number(legacy[2])):undefined);
      const keep=!!tree&&!chopTargets.has(tree.id);
      if(!keep){
        for(const c of s.colonists)if(c.jobId===job.id){c.jobId=null;c.path=[];c.destination=null;c.retryAt=0;}
        return false;
      }
      chopTargets.add(tree.id);
      const moved=job.x!==tree.x||job.y!==tree.y||job.z!==tree.z;
      job.targetId=tree.id;job.x=tree.x;job.y=tree.y;job.z=tree.z;
      if(moved&&job.assignedTo){const c=s.colonists.find(c=>c.id===job.assignedTo);if(c){c.jobId=null;c.path=[];c.destination=null;c.retryAt=0;}job.assignedTo=null;job.state='queued';}
      return true;
    });
    // Before the town market, completed sales survived in the bounded guide log.
    // Active orders also retain their delivered quantity. Removed or cancelled orders
    // without a receipt cannot be reconstructed from the warehouse balance.
    if(s.specialistMarket===undefined){
      s.specialistMarket=emptyMarket();
      for(const e of s.events){
        const match=e.type==='info' && /^向导回收已交付 · (.+) × ([1-9]\d*) · 收到 \d+ 银币$/.exec(e.text);
        if(!match)continue;
        const item=RESOURCE_TYPES.find(r=>RESOURCE_NAMES[r]===match[1]),count=Number(match[2]);
        if(item && integer(count,1,1e7))recordGoods(s.specialistMarket,item,count,e.day);
      }
      for(const job of s.jobs){
        const sale=job.guideSale;
        if(sale?.side==='recycle' && sale.delivered)recordGoods(s.specialistMarket,sale.item,sale.delivered,saveDay);
      }
    }
    const market=s.specialistMarket;
    if(!market?.progress || !market.walks || !Array.isArray(market.events))fail();
    for(const id of specialistIds){
      const row=market.progress[id];
      if(!row || !Number.isSafeInteger(row.sold) || row.sold<0 ||
        (row.sold>=SPECIALISTS[id].unlockQuantity)!==(row.arrivalDay!==null) ||
        row.arrivalDay!==null && !integer(row.arrivalDay,1,saveDay) ||
        row.bedId!==null && (!text(row.bedId,80) || row.arrivalDay===null))fail();
    }
    for(const [id,walk] of Object.entries(market.walks)){
      if((id!=='guide' && !specialistIds.includes(id as SpecialistId)) || !walk || !position(walk.position)
        || !list(walk.path,area) || !walk.path.every(position) || !finite(walk.retryAt))fail();
    }
    const byEvent=new Map<string,MarketEvent>();
    for(const e of market.events){
      if(!e || !specialistIds.includes(e.merchantId) || !text(e.id,100) || byEvent.has(e.id)
        || !integer(e.announcedDay,1,saveDay) || !integer(e.startDay,e.announcedDay+SPECIALIST_MARKET_RULES.minimumNoticeDays)
        || e.endDay!==e.startDay+SPECIALIST_MARKET_RULES.requestDurationDays-1 || SPECIALISTS[e.merchantId].request.item!==e.item
        || !integer(e.limit,1) || !integer(e.remaining,0,e.limit))fail();
      byEvent.set(e.id,e);
    }
    const reserved=new Map<string,number>();
    for(const j of s.jobs){
      const g=j.guideSale;
      if(!g)continue;
      const id=g.merchantId??'guide';
      if(id!=='guide' && (!specialistIds.includes(id) || market.progress[id].arrivalDay===null))fail();
      if(g.eventId!==undefined){
        const e=byEvent.get(g.eventId);
        if(!e || e.merchantId!==id || e.item!==g.item || g.side!=='recycle')return fail();
        const count=(reserved.get(e.id)??0)+g.count;
        if(count>e.limit-e.remaining)fail();
        reserved.set(e.id,count);
      }
    }
    delete s.trade;
    delete s.bills;
    delete s.chests;
    delete s.playerBag;
    delete s.bagSelected;
    return {...s,version:3,warehouseLayout:WAREHOUSE_LAYOUT};
  }
}
