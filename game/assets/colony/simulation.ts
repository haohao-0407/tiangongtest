import { BLOCK, VoxelWorld } from '../voxel/model.ts';
import type { TreeInstance } from '../voxel/trees.ts';
import {buildingDimensions,buildingParts,buildingBlocksMovement} from './buildings.ts';
import {
  BUILDING_DEFS, RESEARCH_DEFS, JOB_TYPES, JOB_NAMES, RESOURCE_TYPES, SCHEDULES,
  CHEST_SLOTS, CHEST_WOOD_COST, PLAYER_DELIVERY_TARGET, PLAYER_SLOTS, RESOURCE_NAMES, STACK_LIMIT, inventorySpace,
  type BuildingKind, type BuildingView, type BuildingRotation, type ColonyCommand, type ColonyEvent,
  type ColonySnapshot, type ColonistView, type CommandResult, type CropView,
  type ItemView, type JobType, type JobView, type Position, type Resource,
  type Resources, type RoomView, type Schedule, type ZoneView, type TerrainPlanView,
  type ChestView, type InventoryLocation, type InventorySlot,
} from './contracts.ts';
export * from './contracts.ts';

const STEP = 0.25;
export const DAY_SECONDS = 360;
const SPEEDS = [0, 1, 3, 6];
const EMPTY_RESOURCES = (): Resources => Object.fromEntries(RESOURCE_TYPES.map((r) => [r, 0])) as Resources;
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));
const horizontalDistance = (a: Position, b: Position) => Math.hypot(a[0] - b[0], a[2] - b[2]);
const emptySlots = (size: number): InventorySlot[] => Array.from({ length: size }, () => null);
const validSlot = (index: unknown, slots: InventorySlot[]): index is number =>
  typeof index === 'number' && Number.isInteger(index) && index >= 0 && index < slots.length;
type Personal = { kind: 'eat'|'sleep'|'relax'|'wander'|'patient'; elapsed: number; duration: number; reserved: Partial<Resources>; buildingId?:string };
type Colonist = ColonistView & { path: Position[]; personal: Personal | null; destination: Position | null; retryAt: number };
type TerrainPlan = TerrainPlanView & {initialWork:number};
type Earthwork = {x:number;z:number;target:number;height:number;plans:string[];blockedReason?:string};
type Job = JobView & { phase: 'work'|'pickup'|'deliver'; resource?: Resource; amount: number; destination: Position | null };
type SavedState = {
  version: 1; type: 'peaceful-colony'; worldSeed: string; time: number; accumulator: number; rng: number;
  nextId: number; speed: number; decision: number; lastDay: number; spoilage: number;
  resources: Resources; colonists: Colonist[]; buildings: BuildingView[]; zones: ZoneView[];
  playerBag: InventorySlot[]; bagSelected: number; chests: ChestView[];
  crops: CropView[]; items: ItemView[]; jobs: Job[]; events: ColonyEvent[]; terrainPlans:TerrainPlan[];
  research: ColonySnapshot['research']; power: ColonySnapshot['power']; trade: ColonySnapshot['trade'];
  bills: ColonySnapshot['bills']; metrics: ColonySnapshot['metrics']; selectedColonistId: string|null;
  weather: string; temperature: number;
};

/** All quantities and work reservations have one owner; no runtime/browser API is needed. */
export class ColonySimulation {
  private deliveryPosition: Position | undefined;
  private deliveryMessage: string | undefined;
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
  private roomAt:Int16Array;

  constructor(readonly world: VoxelWorld) {
    const area=world.width*world.depth;
    this.ground=new Float32Array(area).fill(-1);this.roomAt=new Int16Array(area).fill(-1);
    this.pathParents=new Int32Array(area);this.pathSeen=new Uint32Array(area);this.pathCost=new Float64Array(area);
    let seed = 2166136261;
    for (const ch of world.seed) seed = Math.imul(seed ^ ch.charCodeAt(0), 16777619);
    this.s = {
      version: 1, type: 'peaceful-colony', worldSeed: world.seed, time: DAY_SECONDS / 3, accumulator: 0,
      rng: seed >>> 0 || 1, nextId: 1, speed: 1, decision: 0, lastDay: 1, spoilage: 0,
      resources: { wood: 140, stone: 110, steel: 60, food: 40, meal: 14, medicine: 12, cloth: 30, silver: 120, components: 8 },
      playerBag: emptySlots(PLAYER_SLOTS), bagSelected: 0, chests: [this.starterChest()],
      colonists: [], buildings: [], zones: [], crops: [], items: [], jobs: [], events: [],terrainPlans:[],
      research: { active: null, progress: {}, completed: [] },
      power: { generation: 0, demand: 0, stored: 0, capacity: 0, supplied: 0, coldStorage: false },
      trade: { available: true, leavesAt: DAY_SECONDS / 3 + 120, stock: { wood: 40, stone: 30, steel: 25, food: 35, meal: 12, medicine: 10, cloth: 20, silver: 500, components: 6 },
        prices: { wood: 2, stone: 2, steel: 4, food: 3, meal: 7, medicine: 12, cloth: 4, silver: 1, components: 18 } },
      bills: { meal: 16, medicine: 8, components: 4 },
      metrics: { jobsCompleted: 0, built: 0, harvested: 0, hauled: 0, cooked: 0, researched: 0, treated: 0, spoiled: 0, distanceWalked: 0 },
      selectedColonistId: null, weather: '晴朗', temperature: 22,
    };
    this.refreshGround();
    const midX=Math.floor(world.width/2)+3,midZ=Math.floor(world.depth/2)+3;
    const centre = this.closestOpen(midX, midZ) ?? [midX+.5, 6, midZ+.5];
    const cx = Math.floor(centre[0]), cz = Math.floor(centre[2]);
    this.addZone('stockpile', Math.max(1, cx - 4), cz - 1, 3, 3, 'rice');
    this.addZone('farm', cx - 2, cz + 3, 3, 3, 'rice');
    for (const [kind, dx, dz] of [
      ['bed', 1, -3], ['bed', 2, -3], ['bed', 3, -3], ['table', 1, -1],
      ['stove', 3, -1], ['workbench', 4, -1], ['researchDesk', 4, 1],
    ] as [BuildingKind, number, number][]) {
      const p = this.findBuildingPosition(kind,cx+dx,cz+dz,this.s.buildings,0);
      if (p) this.s.buildings.push({ id: this.id('building'), kind, ...p,...buildingDimensions(kind,0),rotation:0,phase:'completed',complete: true, progress: 1, reserved: {}, powered: false, comfort: 0, roomId: null });
      this.rebuildBuildings();
    }
    const names = ['林夏', '阿澈', '青禾'];
    names.forEach((name, index) => this.addColonist(name, cx - 1, cz + index - 1, index));
    this.s.selectedColonistId = this.s.colonists[0]?.id ?? null;
    this.drop('wood', 12, cx, cz + 2);
    this.drop('stone', 10, cx + 2, cz + 2);
    this.event('info', '三位旅人抵达河谷。和平营地已建立：先种田、搬运物资，再安排研究与建设。');
    this.event('trade', '友善商队正在营地附近停留，可用银币交易物资。购入物资需要居民搬入仓储。');
    this.navigationDirty = true;
    this.updateRooms();
    this.refreshJobs();
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
      position: this.closestOpen(x, z) ?? [this.world.width/2+.5, 6, this.world.depth/2+.5], health: 100, hunger: 72 + index * 5, rest: 88, recreation: 76, mood: 78, disease: 0,
      task: '观察新营地', jobId: null, color: [[0.78,0.44,0.25],[0.29,0.54,0.69],[0.55,0.66,0.32]][index % 3] as Position,
      carrying: {}, bag: emptySlots(1), comfort: 0, path: [], personal: null, destination: null, retryAt: 0 });
  }

  private starterChest(): ChestView {
    return { id: 'chest-starter', x: Math.min(this.world.width - 1, Math.floor(this.world.width / 2) + 1),
      z: Math.floor(this.world.depth / 2), slots: emptySlots(CHEST_SLOTS) };
  }

  private placeChest(x: number | undefined, z: number | undefined): CommandResult {
    this.validCell(x, z);
    const zz = z!;
    if (!this.walkable(x, zz) || this.treeBase(x, zz) >= 1 || this.buildingAt.has(this.cellKey(x, zz))
      || this.s.crops.some(crop => crop.x === x && crop.z === zz)
      || this.s.chests.some(chest => chest.x === x && chest.z === zz)) {
      return { ok: false, message: '请选择一块空地放置木箱' };
    }
    if (this.s.resources.wood < CHEST_WOOD_COST) return { ok: false, message: '仓库里的木材不足' };
    const id = this.id('chest');
    this.s.chests.push({ id, x, z: zz, slots: emptySlots(CHEST_SLOTS) });
    this.s.resources.wood -= CHEST_WOOD_COST;
    return { ok: true, message: '已放置木箱', id };
  }

  selectBagSlot(index: unknown): void {
    if (validSlot(index, this.s.playerBag)) this.s.bagSelected = index;
  }

  private inventorySlots(location: InventoryLocation): InventorySlot[] | undefined {
    if (location.kind === 'player') return this.s.playerBag;
    if (location.kind === 'chest') return this.s.chests.find(chest => chest.id === location.id)?.slots;
    if (location.kind === 'follower') return this.s.colonists.find(colonist => colonist.id === location.id)?.bag;
  }

  private addToPlayerBag(resource: Resource, amount: number): number {
    const bag = this.s.playerBag;
    const slots = bag.flatMap((stack, index) => stack?.resource === resource && stack.count < STACK_LIMIT ? [index] : []);
    bag.forEach((stack, index) => { if (stack === null) slots.push(index); });
    let left = amount;
    for (const index of slots) {
      if (left <= 0) break;
      const count = bag[index]?.count ?? 0;
      const added = Math.min(STACK_LIMIT - count, left);
      bag[index] = { resource, count: count + added };
      if (left === amount) this.selectBagSlot(index);
      left -= added;
    }
    return amount - left;
  }

  transferInventory(from: InventoryLocation, to: InventoryLocation, resource: Resource, amount: number): CommandResult {
    const unavailable = { ok: false, message: '来源格子里的物品已变动' };
    const full = { ok: false, message: '目标格放不下，物品留在原处' };
    if (!from || !to || !RESOURCE_TYPES.includes(resource) || !Number.isSafeInteger(amount) || amount < 1) {
      return { ok: false, message: '无效的物品转移' };
    }
    if (from.kind === 'warehouse' && to.kind === 'warehouse') return unavailable;
    const sourceSlots = this.inventorySlots(from);
    const sourceIndex = from.kind === 'player' || from.kind === 'chest' ? from.slot : 0;
    const cargo = from.kind === 'cargo' ? this.s.colonists.find(colonist => colonist.id === from.id)?.carrying : undefined;
    const sourceStack = sourceSlots && validSlot(sourceIndex, sourceSlots) ? sourceSlots[sourceIndex] : null;
    const available = from.kind === 'warehouse' ? this.s.resources[resource]
      : cargo ? cargo[resource] ?? 0 : sourceStack?.resource === resource ? sourceStack.count : 0;
    if (available < 1) return unavailable;

    const targetSlots = this.inventorySlots(to);
    const targetIndex = to.kind === 'player' || to.kind === 'chest' ? to.slot : 0;
    let moved = Math.min(available, amount);
    if (to.kind === 'player' && targetIndex === undefined && sourceSlots !== targetSlots) {
      moved = this.addToPlayerBag(resource, moved);
      if (!moved) return full;
    } else if (to.kind !== 'warehouse') {
      if (!targetSlots) return full;
      if (!validSlot(targetIndex, targetSlots)) return full;
      if (sourceSlots === targetSlots && sourceIndex === targetIndex) return { ok: false, message: '' };
      const current = targetSlots[targetIndex];
      if (current && current.resource !== resource) return full;
      moved = Math.min(moved, STACK_LIMIT - (current?.count ?? 0));
      if (moved <= 0) return full;
      targetSlots[targetIndex] = { resource, count: (current?.count ?? 0) + moved };
      if (to.kind === 'player') this.selectBagSlot(targetIndex);
    } else {
      this.s.resources[resource] += moved;
    }

    const left = available - moved;
    if (from.kind === 'warehouse') this.s.resources[resource] = left;
    else if (cargo) {
      if (left) cargo[resource] = left;
      else delete cargo[resource];
    } else if (sourceSlots && validSlot(sourceIndex, sourceSlots)) {
      sourceSlots[sourceIndex] = left ? { resource, count: left } : null;
    }
    return { ok: true, message: moved < amount ? `已转移 ${moved} 个，剩余物品留在原处` : `已转移 ${moved} 个` };
  }

  requestDelivery(resource: Resource, amount: number): CommandResult {
    if (!RESOURCE_TYPES.includes(resource) || !Number.isSafeInteger(amount) || amount < 1) return { ok: false, message: '获取数量无效' };
    if (amount > this.s.resources[resource]) return { ok: false, message: '仓库现有数量不足，请重新选择数量' };
    if (amount > inventorySpace(this.s.playerBag, resource)) return { ok: false, message: '快捷栏空间不足，请重新选择数量' };
    const source = this.storageTarget();
    if (!source) return { ok: false, message: '找不到可用的储藏区' };
    const job = this.addJob('haul', PLAYER_DELIVERY_TARGET, Math.floor(source[0]), source[1], Math.floor(source[2]), 1, `配送${RESOURCE_NAMES[resource]}`);
    job.resource = resource;
    job.reserved[resource] = amount;
    this.s.resources[resource] -= amount;
    return { ok: true, id: job.id, message: `已安排随从配送 ${amount} 个${RESOURCE_NAMES[resource]}` };
  }

  takeDeliveryMessage(): string | undefined {
    const message = this.deliveryMessage;
    this.deliveryMessage = undefined;
    return message;
  }

  tick(realSeconds: number, playerPosition?: Position): void {
    if (!Number.isFinite(realSeconds) || realSeconds < 0 || realSeconds > 600) throw new RangeError('模拟步长必须为 0–600 秒。');
    this.deliveryPosition = playerPosition;
    this.syncWorld();
    this.s.accumulator += realSeconds * this.s.speed;
    while (this.s.accumulator + 1e-9 >= STEP) {
      this.s.accumulator = Math.max(0, this.s.accumulator - STEP);
      this.step(STEP);
    }
  }
  private step(dt: number): void {
    this.s.time += dt;
    this.syncWorld();
    if (this.day() !== this.s.lastDay) this.newDay();
    if (this.s.trade.available && this.s.time >= this.s.trade.leavesAt) {
      this.s.trade.available = false; this.event('trade', '商队启程离开，下次拜访将在数日后。');
    }
    this.updateClimate();
    this.updatePower(dt);
    for (const crop of this.s.crops) if (crop.planted && crop.growth < 1) {
      const ideal = this.s.temperature >= 8 && this.s.temperature <= 32;
      const light = this.hour() >= 5 && this.hour() < 21 ? 1 : 0.25;
      crop.growth = Math.min(1, crop.growth + dt / (crop.kind === 'corn' ? 200 : 115) * (ideal ? 1 : 0.2) * light * (this.s.weather === '细雨' ? 1.15 : 1));
    }
    this.s.spoilage += dt * (this.s.power.coldStorage ? 0.12 : this.s.temperature > 30 ? 2 : 1);
    if (this.s.spoilage >= 95) {
      this.s.spoilage -= 95;
      for (const r of ['food', 'meal'] as Resource[]) {
        const amount = Math.min(this.s.resources[r], Math.max(0, Math.floor(this.s.resources[r] * 0.035)));
        this.s.resources[r] -= amount; this.s.metrics.spoiled += amount;
      }
    }
    for (const item of [...this.s.items]) {
      item.age += dt;
      if ((item.resource === 'food' || item.resource === 'meal') && item.age > 260 && !item.reservedBy) {
        this.s.metrics.spoiled += item.amount; this.s.items.splice(this.s.items.indexOf(item), 1);
      }
    }
    this.s.decision += dt;
    if (this.s.decision >= 1) {
      this.s.decision -= 1;
      if (this.navigationDirty) this.updateRooms();
      this.refreshJobs();
    }
    for (const c of this.s.colonists) this.updateColonist(c, dt);
  }

  command(c: ColonyCommand): CommandResult {
    try {
      if (!c || typeof c.action !== 'string') throw new Error('无效的营地指令。');
      this.syncWorld();
      if (c.action === 'speed') {
        if (typeof c.value !== 'number' || !SPEEDS.includes(c.value)) throw new Error('速度仅支持暂停、1、3、6 倍。');
        this.s.speed = c.value; return { ok:true, message:c.value === 0 ? '营地已暂停' : `${c.value} 倍速` };
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
          if (person.jobId && this.s.jobs.find((j) => j.id === person.jobId)?.type === c.job) this.releasePerson(person);
        } else {
          if (typeof c.value !== 'string' || !(c.value in SCHEDULES)) throw new Error('未知作息。');
          person.schedule = c.value as Schedule; this.releasePerson(person);
        }
        return {ok:true,message:'居民安排已更新'};
      }
      if (c.action === 'build') return this.orderBuild(c.kind, c.x, c.z,c.target,c.rotation);
      if (c.action === 'toggleDoor') return this.toggleDoor(c);
      if (c.action === 'demolish') return this.demolish(c);
      if (c.action === 'place-chest') return this.placeChest(c.x, c.z);
      if (c.action === 'level') return this.orderLevel(c);
      if (c.action === 'designate') return this.designate(c);
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
      if (c.action === 'bill') {
        if (!['meal','medicine','components'].includes(c.kind ?? '') || !Number.isInteger(c.target) || c.target! < 0 || c.target! > 200) throw new Error('生产目标必须为 0–200。');
        if (c.kind === 'components' && !this.s.research.completed.includes('fabrication')) throw new Error('请先研究精密制作。');
        this.s.bills[c.kind as keyof SavedState['bills']] = c.target!; this.refreshJobs();
        return {ok:true,message:'生产目标已更新'};
      }
      if (c.action === 'trade') return this.trade(c);
      throw new Error('未知营地指令。');
    } catch (error) { return {ok:false,message:error instanceof Error ? error.message : '无法执行指令'}; }
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
  blocksVoxel(x:number,y:number,z:number):boolean {const b=this.buildingAtVoxel(x,y,z);return !!b&&buildingBlocksMovement(b);}
  private footprint(b:Pick<BuildingView,'x'|'z'|'w'|'d'>):[number,number][]{const cells:[number,number][]=[];for(let z=b.z;z<b.z+b.d;z++)for(let x=b.x;x<b.x+b.w;x++)cells.push([x,z]);return cells;}
  private rebuildBuildings():void {
    this.buildingAt.clear();this.buildingVoxels.clear();this.blockedCells.clear();
    for(const b of this.s.buildings){
      for(const part of buildingParts(b))this.buildingVoxels.set(this.voxelKey(part.x,part.y,part.z),b);
      for(const[x,z]of this.footprint(b)){
        this.buildingAt.set(this.cellKey(x,z),b);
        if(buildingBlocksMovement(b))this.blockedCells.add(this.cellKey(x,z));
      }
    }
  }
  private findBuildingPosition(kind:BuildingKind,x:number,z:number,others:BuildingView[],rotation:BuildingRotation,target?:number,crops:CropView[]=this.s.crops):{x:number;y:number;z:number}|null {
    const {w,h,d}=buildingDimensions(kind,rotation);
    for(let radius=0;radius<12;radius++)for(let dz=-radius;dz<=radius;dz++)for(let dx=-radius;dx<=radius;dx++){
      if(Math.max(Math.abs(dx),Math.abs(dz))!==radius)continue;
      const xx=x+dx,zz=z+dz,y=target??this.world.terrainHeight(xx,zz);
      if(xx<0||zz<0||xx+w>this.world.width||zz+d>this.world.depth||y<1||y+h>this.world.height)continue;
      if(others.some(b=>xx<b.x+b.w&&xx+w>b.x&&zz<b.z+b.d&&zz+d>b.z))continue;
      const cells=this.footprint({x:xx,z:zz,w,d});
      if(cells.some(([cx,cz])=>this.world.terrainHeight(cx,cz)!==y||crops.some(p=>p.x===cx&&p.z===cz)))continue;
      if(buildingParts({kind,x:xx,y,z:zz,rotation}).some(p=>this.world.get(p.x,p.y,p.z)!==BLOCK.Air||this.world.treesAtVoxel(p.x,p.y,p.z).length))continue;
      return{x:xx,y,z:zz};
    }return null;
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
    if (def.research && !this.s.research.completed.includes(def.research)) throw new Error(`需要研究：${RESEARCH_DEFS[def.research]!.name}`);
    const {w,h,d}=buildingDimensions(def.id,rotation),y=target??this.world.terrainHeight(x,zz);this.validTarget(y);
    if(x+w>this.world.width||zz+d>this.world.depth||y+h>this.world.height)throw new Error('建筑整体超出地图范围。');
    const cells=this.footprint({x,z:zz,w,d});this.rebuildBuildings();
    if(cells.some(([xx,z])=>this.buildingAt.has(this.cellKey(xx,z))))throw new Error('建筑占地内已有建筑或蓝图。');
    if(this.s.chests.some(chest=>chest.x>=x&&chest.x<x+w&&chest.z>=zz&&chest.z<zz+d))throw new Error('建筑占地内已有木箱。');
    if(cells.some(([xx,z])=>this.s.crops.some(p=>p.x===xx&&p.z===z)))throw new Error('请先取消建筑占地内的农田。');
    for(const[xx,z]of cells){const old=this.earthwork.get(this.cellKey(xx,z));if(old&&old.target!==y)throw new Error('建筑地基与已有整地目标冲突。');}
    const rotationValue=rotation as BuildingRotation;
    // Earthwork may cut natural soil/rock; authored voxels cannot disappear to make room for furniture.
    for(const p of buildingParts({kind:def.id,x,y,z:zz,rotation:rotationValue}))if(![BLOCK.Air,BLOCK.Water,BLOCK.Leaves,BLOCK.Grass,BLOCK.Dirt,BLOCK.Stone,BLOCK.Sand].includes(this.world.get(p.x,p.y,p.z) as never))throw new Error('物体体积内有方块障碍，请先清理。');
    const building: BuildingView = {id:this.id('building'),kind:def.id,x,y,z:zz,w,h,d,rotation:rotationValue,...(def.id==='door'?{doorOpen:false}:{}),phase:'preparingTerrain',complete:false,progress:0,reserved:{},powered:false,comfort:0,roomId:null};
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
    if(b.kind!=='door'||!b.complete)throw new Error('只能操作已建成的门。');
    if(b.doorOpen&&this.occupiedByActor(b))throw new Error('门口有人，请等离开后再关门。');
    b.doorOpen=!b.doorOpen;this.invalidateBuildingNavigation();this.refreshJobs();
    return{ok:true,id:b.id,message:b.doorOpen?'门已打开，可以通行':'门已关闭，阻挡通行并围合房间'};
  }
  private demolish(c:ColonyCommand):CommandResult {
    const b=this.commandBuilding(c);if(!b.complete)return this.cancel(b.id);
    for(const p of this.s.colonists)if(p.personal?.buildingId===b.id||p.personal&&p.destination?.[0]===b.x+.5&&p.destination?.[2]===b.z+.5)this.releasePerson(p);
    for(const job of [...this.s.jobs])if(job.targetId===b.id||job.type==='research'&&job.x===b.x&&job.z===b.z)this.removeJob(job,true);
    this.s.buildings.splice(this.s.buildings.indexOf(b),1);
    for(const plan of this.s.terrainPlans)if(plan.buildingId===b.id)this.terrainCellViews.delete(plan.id);
    this.s.terrainPlans=this.s.terrainPlans.filter(p=>p.buildingId!==b.id);this.terrainIndexDirty=true;
    const recovered:Partial<Resources>={};for(const r of RESOURCE_TYPES){const amount=Math.floor((BUILDING_DEFS[b.kind].cost[r]??0)*2);if(amount)recovered[r]=amount;}
    this.give(recovered);this.invalidateBuildingNavigation();this.updatePower(0);this.refreshJobs();
    this.event('info',`已整体拆除${BUILDING_DEFS[b.kind].name}，回收一半建材。`);
    return{ok:true,id:b.id,message:'已整体拆除，回收 50% 建材（各项向下取整）'};
  }
  private terrainBlocker(x:number,z:number,target:number):string|undefined {
    const building=this.buildingAt.get(this.cellKey(x,z));
    if(building?.complete)return '等待拆除已完成建筑';
    if(this.s.crops.some(p=>p.x===x&&p.z===z))return '等待取消此处农田';
    if(this.terrainTrees(x,z,target).length)return '等待居民清理树木';
    if(this.world.waterSurfaceHeight(x,z)>target)return '目标地面仍有积水，请提高标高';
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
  private buildingStand(b:BuildingView,from:Position):Position[]|null {
    const options:Position[]=[];
    for(let z=b.z-1;z<=b.z+b.d;z++)for(let x=b.x-1;x<=b.x+b.w;x++){
      if(x>=b.x&&x<b.x+b.w&&z>=b.z&&z<b.z+b.d)continue;
      if((x<b.x||x>=b.x+b.w)&&(z<b.z||z>=b.z+b.d))continue;
      if(this.walkable(x,z)&&Math.abs(this.groundY(x,z)-b.y)<=1.01)options.push([x+.5,this.groundY(x,z),z+.5]);
    }
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
  private designate(c: ColonyCommand): CommandResult {
    if(c.kind==='chop')return this.designateChop(c);
    this.validCell(c.x,c.z); const x=c.x!, z=c.z!, w=c.w??1, d=c.d??1;
    if (!Number.isInteger(w)||!Number.isInteger(d)||w<1||d<1||w>this.world.width||d>this.world.depth||x+w>this.world.width||z+d>this.world.depth) throw new Error('区域必须位于地图内。');
    if (c.kind === 'farm' || c.kind === 'stockpile') {
      const crop = c.crop === 'corn' ? 'corn' : 'rice';
      if (crop === 'corn' && !this.s.research.completed.includes('agriculture')) throw new Error('玉米需要精耕农业研究。');
      if (this.s.zones.some((zone) => x < zone.x+zone.w && x+w > zone.x && z < zone.z+zone.d && z+d > zone.z)) throw new Error('区域不能相互重叠。');
      const cells: [number,number][]=[];
      for(let zz=z;zz<z+d;zz++)for(let xx=x;xx<x+w;xx++)cells.push([xx,zz]);
      if(cells.some(([xx,zz])=>!this.walkable(xx,zz)||this.buildingAt.has(this.cellKey(xx,zz))))throw new Error('区域包含水面、障碍或建筑，请选择空地。');
      const zone=this.addZone(c.kind,x,z,w,d,crop); this.refreshJobs();
      return {ok:true,message:c.kind==='farm'?'种植区已规划，居民会播种和收获':'仓储区已规划，居民会搬运落地物资',id:zone.id};
    }
    let added=0,treesBlockingMining=false;
    for(let zz=z;zz<z+d;zz++)for(let xx=x;xx<x+w;xx++) {
      if(c.kind==='mine') {
        if(this.world.treeAtColumn(xx,zz)){treesBlockingMining=true;continue;}
        if(this.buildingAt.has(this.cellKey(xx,zz)))continue;
        const y=this.world.surfaceHeight(xx,zz,false);
        if(y>0 && [BLOCK.Stone,BLOCK.Dirt,BLOCK.Grass,BLOCK.Sand].includes(this.world.get(xx,y,zz) as never)
          && !this.s.jobs.some(j=>j.type==='mine'&&j.x===xx&&j.z===zz)) {this.addJob('mine',`rock:${xx}:${zz}:${y}`,xx,y,zz,19,'开采地表');added++;}
      } else if(c.kind==='harvest') {
        for(const crop of this.s.crops.filter(p=>p.x===xx&&p.z===zz&&p.planted&&p.growth>=0.95)) {
          if(!this.s.jobs.some(j=>j.type==='harvest'&&j.targetId===crop.id)){this.addJob('harvest',crop.id,xx,crop.y,zz,6,'收获作物');added++;}
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
    const existing=this.s.jobs.find(j=>j.type==='chop'&&j.targetId===tree.id);
    if(existing){if(label==='砍伐树木')existing.label=label;return false;}
    this.addJob('chop',tree.id,tree.x,tree.y,tree.z,16,label);return true;
  }
  private addZone(kind:'farm'|'stockpile',x:number,z:number,w:number,d:number,crop:'rice'|'corn'):ZoneView {
    const zone:ZoneView={id:this.id('zone'),kind,x,y:Math.max(1,this.groundY(x,z)),z,w,d,crop};this.s.zones.push(zone);
    if(kind==='farm')this.terrainIndexDirty=true;
    if(kind==='farm')for(let zz=z;zz<z+d;zz++)for(let xx=x;xx<x+w;xx++) {
      const y=this.groundY(xx,zz); if(y<0||this.buildingAt.has(this.cellKey(xx,zz)))continue;
      this.s.crops.push({id:this.id('crop'),kind:crop,x:xx,y,z:zz,growth:0,planted:false});
    }
    return zone;
  }
  private cancel(id: string|undefined):CommandResult {
    const building=this.s.buildings.find(b=>b.id===id);
    if(building) {
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
    const job=this.s.jobs.find(j=>j.id===id);if(job){this.removeJob(job,true);return{ok:true,message:'工作订单已取消'};}
    const zone=this.s.zones.find(z=>z.id===id);
    if(zone){
      if(zone.kind==='stockpile'&&this.s.zones.filter(z=>z.kind==='stockpile').length===1)throw new Error('请保留至少一处仓储区。');
      const crops=this.s.crops.filter(p=>p.x>=zone.x&&p.x<zone.x+zone.w&&p.z>=zone.z&&p.z<zone.z+zone.d);
      for(const job of [...this.s.jobs])if(crops.some(p=>p.id===job.targetId))this.removeJob(job,true);
      this.s.crops=this.s.crops.filter(p=>!crops.includes(p));this.s.zones.splice(this.s.zones.indexOf(zone),1);
      this.terrainIndexDirty=true;this.refreshJobs();
      return{ok:true,message:'区域已取消'};
    }
    throw new Error('未找到可取消的蓝图、区域或工作。');
  }
  private trade(c:ColonyCommand):CommandResult {
    if(!this.s.trade.available)throw new Error('目前没有商队。');
    if(!RESOURCE_TYPES.includes(c.resource as Resource)||c.resource==='silver'||!Number.isInteger(c.amount)||c.amount!<=0||c.amount!>100||typeof c.buy!=='boolean')throw new Error('交易需要有效物资、方向及 1–100 的整数数量。');
    const resource=c.resource as Resource,amount=c.amount!,price=this.s.trade.prices[resource];
    if(c.buy) {
      const cost=price*amount;
      if(this.s.trade.stock[resource]<amount)throw new Error('商队库存不足。');
      if(this.s.resources.silver<cost)throw new Error('银币不足。');
      const resident=this.s.colonists[0]!;
      const p=this.closestOpen(Math.floor(resident.position[0]),Math.floor(resident.position[2]));
      if(!p)throw new Error('营地无可接收货物的地面。');
      this.s.resources.silver-=cost;this.s.trade.stock.silver+=cost;this.s.trade.stock[resource]-=amount;
      this.drop(resource,amount,Math.floor(p[0]),Math.floor(p[2]));
    } else {
      const revenue=Math.max(1,Math.floor(price*0.6))*amount;
      if(this.s.resources[resource]<amount)throw new Error('可出售的仓储物资不足。');
      if(this.s.trade.stock.silver<revenue)throw new Error('商队银币不足。');
      this.s.resources[resource]-=amount;this.s.resources.silver+=revenue;this.s.trade.stock.silver-=revenue;this.s.trade.stock[resource]+=amount;
    }
    this.refreshJobs();return{ok:true,message:c.buy?'货物已卸下，等待搬运入库':'交易完成，银币已入库'};
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
    this.refreshTreeJobs();
  }
  private refreshTreeJobs():void {
    for(const job of [...this.s.jobs])if(job.type==='chop'&&!this.world.getTree(job.targetId)
      ||job.type==='mine'&&this.world.treeAtColumn(job.x,job.z))this.removeJob(job,false);
  }
  private groundY(x:number,z:number):number {return x>=0&&x<this.world.width&&z>=0&&z<this.world.depth?this.ground[x+z*this.world.width]??-1:-1;}
  getGroundHeight(x:number,z:number):number{if(this.world.revision!==this.worldRevision)this.refreshGround();return this.groundY(x,z);}
  private walkable(x:number,z:number):boolean {
    return this.groundY(x,z)>=1&&!this.blockedCells.has(this.cellKey(x,z));
  }
  private closestOpen(x:number,z:number,avoidBlueprint=false):Position|null {
    for(let radius=0;radius<12;radius++)for(let dz=-radius;dz<=radius;dz++)for(let dx=-radius;dx<=radius;dx++) {
      if(Math.max(Math.abs(dx),Math.abs(dz))!==radius)continue;
      const xx=Math.floor(x)+dx,zz=Math.floor(z)+dz;
      if(this.walkable(xx,zz)&&(!avoidBlueprint||!this.buildingAt.has(this.cellKey(xx,zz))))return[xx+0.5,this.groundY(xx,zz),zz+0.5];
    }return null;
  }
  /** Reusable A* buffers keep local work affordable on a 250×250 map. */
  private path(from:Position,to:Position,adjacent=false):Position[]|null {
    const sx=Math.floor(from[0]),sz=Math.floor(from[2]),tx=Math.floor(to[0]),tz=Math.floor(to[2]);
    const start=sx+sz*this.world.width;
    if(sx<0||sz<0||sx>=this.world.width||sz>=this.world.depth)return null;
    const goals=new Set<number>();
    for(const [dx,dz]of adjacent?[[1,0],[-1,0],[0,1],[0,-1]]:[[0,0]])if(this.walkable(tx+dx,tz+dz))goals.add(tx+dx+(tz+dz)*this.world.width);
    if(goals.has(start))return[];
    if(!goals.size)return null;
    const stamp=++this.pathStamp,parents=this.pathParents,seen=this.pathSeen,cost=this.pathCost;
    if(stamp>=0xfffffffe){this.pathStamp=1;seen.fill(0);return this.path(from,to,adjacent);}
    const heap:{cell:number;score:number;cost:number}[]=[];
    const push=(cell:number,g:number)=>{let i=heap.length;const row={cell,cost:g,score:g+Math.abs(cell%this.world.width-tx)+Math.abs(Math.floor(cell/this.world.width)-tz)};heap.push(row);while(i>0){const p=(i-1)>>1;if(heap[p]!.score<=row.score)break;heap[i]=heap[p]!;i=p;}heap[i]=row;};
    const pop=()=>{const row=heap[0]!,last=heap.pop()!;if(heap.length){let i=0;while(i*2+1<heap.length){let next=i*2+1;if(next+1<heap.length&&heap[next+1]!.score<heap[next]!.score)next++;if(heap[next]!.score>=last.score)break;heap[i]=heap[next]!;i=next;}heap[i]=last;}return row;};
    let found=-1;parents[start]=-1;seen[start]=stamp;cost[start]=0;push(start,0);
    while(heap.length){
      const row=pop(),cur=row.cell;if(row.cost!==cost[cur])continue;
      if(goals.has(cur)){found=cur;break;}
      const x=cur%this.world.width,z=Math.floor(cur/this.world.width),h=this.groundY(x,z);
      for(const[dx,dz]of [[1,0],[-1,0],[0,1],[0,-1]]){
        const nx=x+dx!,nz=z+dz!;if(!this.walkable(nx,nz)||Math.abs(this.groundY(nx,nz)-h)>1.01)continue;
        const next=nx+nz*this.world.width,g=row.cost+1;if(seen[next]===stamp&&cost[next]!<=g)continue;
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
    let remaining=dt*(c.health<35?0.8:2.1)*(c.hunger<15?0.7:1);
    while(remaining>0&&c.path.length){
      const next=c.path[0]!,x=Math.floor(next[0]),z=Math.floor(next[2]);
      if(!this.walkable(x,z)||Math.abs(next[1]-this.groundY(x,z))>.1){this.releasePerson(c);c.retryAt=this.s.time+1;return false;}
      const nextHeight=this.walkSurface?.(next[0],next[2],next[1])??next[1];
      const currentSurface=this.walkSurface?.(c.position[0],c.position[2],NaN);
      const detailed=Number.isFinite(currentSurface)||nextHeight!==next[1];
      const distance=detailed?horizontalDistance(c.position,next):Math.hypot(...next.map((v,i)=>v-c.position[i]!));
      if(distance<=remaining+1e-9){c.position=[next[0],nextHeight,next[2]];c.path.shift();remaining-=distance;this.s.metrics.distanceWalked+=distance;}
      else{for(let i=0;i<3;i++)c.position[i]!+=(next[i]!-c.position[i]!)/distance*remaining;this.s.metrics.distanceWalked+=remaining;remaining=0;}
      if(this.walkSurface)c.position[1]=this.walkSurface(c.position[0],c.position[2],c.position[1]);
    }
    return c.path.length===0;
  }
  private storageTarget(from?:Position):Position|null {
    const cells:Position[]=[];
    for(const zone of this.s.zones.filter(z=>z.kind==='stockpile'))for(let z=zone.z;z<zone.z+zone.d;z++)for(let x=zone.x;x<zone.x+zone.w;x++)if(this.walkable(x,z))cells.push([x+.5,this.groundY(x,z),z+.5]);
    if(from)cells.sort((a,b)=>horizontalDistance(from,a)-horizontalDistance(from,b));
    for(const p of cells)if(!from||this.path(from,p)!==null)return p;
    return null;
  }
  private treeBase(x:number,z:number):number{return this.world.treeAtColumn(x,z)?.y??-1;}
  private drop(resource:Resource,amount:number,x:number,z:number):void {
    if(amount<=0)return;const pos=this.closestOpen(x,z)??[x+.5,Math.max(1,this.world.surfaceHeight(x,z)+1),z+.5];
    const xx=Math.floor(pos[0]),zz=Math.floor(pos[2]);
    const existing=this.s.items.find(i=>i.resource===resource&&i.x===xx&&i.z===zz&&!i.reservedBy);
    if(existing){existing.amount+=amount;existing.age=Math.min(existing.age,30);}
    else this.s.items.push({id:this.id('item'),resource,amount,x:xx,y:pos[1],z:zz,age:0,reservedBy:null});
  }
  private afford(cost:Partial<Resources>):boolean{return RESOURCE_TYPES.every(r=>this.s.resources[r]>=(cost[r]??0));}
  private take(cost:Partial<Resources>):void{for(const r of RESOURCE_TYPES)this.s.resources[r]-=cost[r]??0;}
  private give(cost:Partial<Resources>):void{for(const r of RESOURCE_TYPES)this.s.resources[r]+=cost[r]??0;}
  private owned(resource:Resource):number {
    return this.s.resources[resource]+this.s.items.filter(i=>i.resource===resource).reduce((sum,i)=>sum+i.amount,0)
      +this.s.colonists.reduce((sum,c)=>sum+(c.carrying[resource]??0),0);
  }

  private addJob(type:JobType,targetId:string,x:number,y:number,z:number,work:number,label:string):Job {
    const job:Job={id:this.id('job'),type,targetId,x,y,z,progress:0,work,state:'queued',assignedTo:null,reserved:{},label,phase:type==='haul'?'pickup':'work',amount:0,destination:null};
    this.s.jobs.push(job);return job;
  }
  private refreshJobs():void {
    this.refreshTreeJobs();
    this.refreshTerraformJobs();
    const has=(type:JobType,target:string)=>this.s.jobs.some(j=>j.type===type&&j.targetId===target);
    for(const b of this.s.buildings)if(!b.complete&&b.phase!=='preparingTerrain'&&!b.blockedReason&&!has('construct',b.id))this.addJob('construct',b.id,b.x,b.y,b.z,BUILDING_DEFS[b.kind].work,`建造${BUILDING_DEFS[b.kind].name}`).progress=b.progress*BUILDING_DEFS[b.kind].work;
    for(const crop of this.s.crops){
      if(!crop.planted&&!has('grow',crop.id))this.addJob('grow',crop.id,crop.x,crop.y,crop.z,5,'播种'+(crop.kind==='corn'?'玉米':'水稻'));
      if(crop.planted&&crop.growth>=1&&!has('harvest',crop.id))this.addJob('harvest',crop.id,crop.x,crop.y,crop.z,6,'收获'+(crop.kind==='corn'?'玉米':'水稻'));
    }
    if(this.storageTarget())for(const item of this.s.items)if(!item.reservedBy&&!has('haul',item.id))this.addJob('haul',item.id,item.x,item.y,item.z,1,'搬运物资');
    const complete=(kind:BuildingKind)=>this.s.buildings.find(b=>b.complete&&b.kind===kind);
    const stove=complete('stove');
    if(stove&&this.owned('meal')<this.s.bills.meal&&!has('cook',stove.id))this.addJob('cook',stove.id,stove.x,stove.y,stove.z,8,'烹饪熟食');
    const bench=complete('workbench');
    if(bench&&!has('craft',bench.id)){
      const kind=this.owned('medicine')<this.s.bills.medicine?'medicine':this.owned('components')<this.s.bills.components&&this.s.research.completed.includes('fabrication')?'components':null;
      if(kind){const job=this.addJob('craft',bench.id,bench.x,bench.y,bench.z,14,kind==='medicine'?'制作药品':'制作零件');job.resource=kind;}
    }
    const desk=complete('researchDesk'),active=this.s.research.active;
    if(desk&&active&&!has('research',active))this.addJob('research',active,desk.x,desk.y,desk.z,RESEARCH_DEFS[active]!.work,'研究'+RESEARCH_DEFS[active]!.name).progress=this.s.research.progress[active]??0;
    for(const c of this.s.colonists)if(c.disease>15&&!has('doctor',c.id))this.addJob('doctor',c.id,Math.floor(c.position[0]),c.position[1],Math.floor(c.position[2]),9,`治疗${c.name}`);
    for(const j of [...this.s.jobs]){
      const product=j.type==='cook'?'meal':j.type==='craft'?j.resource:null;
      if(product&&j.progress===0&&this.owned(product)>=this.s.bills[product as keyof SavedState['bills']]){this.removeJob(j,true);continue;}
      if(j.type==='haul'&&j.targetId!==PLAYER_DELIVERY_TARGET&&j.phase==='pickup'&&!this.s.items.some(i=>i.id===j.targetId))this.removeJob(j,true);
      if(j.type==='doctor'){const p=this.s.colonists.find(c=>c.id===j.targetId);if(!p||p.disease<=0)this.removeJob(j,true);else if(!j.assignedTo){j.x=Math.floor(p.position[0]);j.y=p.position[1];j.z=Math.floor(p.position[2]);}}
    }
  }
  private releasePerson(c:Colonist):void {
    const job=this.s.jobs.find(j=>j.id===c.jobId);
    if(job){
      job.assignedTo=null;job.state='queued';
      if (job.targetId === PLAYER_DELIVERY_TARGET) {
        job.phase = 'pickup';
      } else if(job.type==='haul'){
        for(const r of RESOURCE_TYPES)if(c.carrying[r])this.drop(r,c.carrying[r]!,Math.floor(c.position[0]),Math.floor(c.position[2]));
        c.carrying={};const item=this.s.items.find(i=>i.id===job.targetId);if(item)item.reservedBy=null;
        this.s.jobs.splice(this.s.jobs.indexOf(job),1);
      }
    }
    if(c.personal?.reserved)this.give(c.personal.reserved);
    c.personal=null;c.jobId=null;c.path=[];c.destination=null;
  }
  private removeJob(job:Job,refund:boolean):void {
    const c=this.s.colonists.find(c=>c.id===job.assignedTo);
    if(c){
      for(const r of RESOURCE_TYPES)if(c.carrying[r])this.drop(r,c.carrying[r]!,Math.floor(c.position[0]),Math.floor(c.position[2]));
      c.carrying={};c.jobId=null;c.path=[];c.destination=null;
    }
    const item=this.s.items.find(i=>i.id===job.targetId);if(item?.reservedBy===job.id)item.reservedBy=null;
    if(refund)this.give(job.reserved);
    const index=this.s.jobs.indexOf(job);if(index>=0)this.s.jobs.splice(index,1);
  }
  private schedule(c:Colonist):'work'|'sleep'|'relax'|'anything' {
    const hour=this.hour();
    if(c.schedule==='rest')return hour<7||hour>=22?'sleep':'relax';
    if(c.schedule==='night')return hour>=8&&hour<16?'sleep':hour>=16&&hour<18?'relax':'work';
    if(c.schedule==='day')return hour<6||hour>=22?'sleep':hour>=20?'relax':'work';
    return hour<6||hour>=23?'sleep':hour>=19&&hour<22?'relax':'anything';
  }
  private personal(c:Colonist,kind:Personal['kind']):boolean {
    let target:Position|null=null,path:Position[]|null=null,bed=false,reserved:Partial<Resources>={},buildingId:string|undefined;
    const useBuildings=(kinds:BuildingKind[],excludeOccupied=false):boolean=>{
      const candidates=this.s.buildings.filter(b=>b.complete&&kinds.includes(b.kind)
        &&(!excludeOccupied||!this.s.colonists.some(p=>p!==c&&p.personal&&(p.personal.kind==='sleep'||p.personal.kind==='patient')&&(p.personal.buildingId===b.id||p.destination?.[0]===b.x+.5&&p.destination?.[2]===b.z+.5))))
        .sort((a,b)=>Math.hypot(a.x-c.position[0],a.z-c.position[2])-Math.hypot(b.x-c.position[0],b.z-c.position[2]));
      for(const b of candidates){const pos:Position=[b.x+.5,b.y,b.z+.5],route=this.buildingStand(b,c.position);if(route!==null){target=pos;path=route;buildingId=b.id;return true;}}
      return false;
    };
    if(kind==='eat'){
      const resource=this.s.resources.meal>0?'meal':this.s.resources.food>0?'food':null;if(!resource)return false;
      reserved[resource]=1;
      if(!useBuildings(['table'])){target=this.storageTarget(c.position);if(target)path=this.path(c.position,target);}
    }else if(kind==='sleep'||kind==='patient'){
      bed=useBuildings(kind==='patient'?['medicalBed','bed']:['bed'],true);
      if(!bed){target=[...c.position];path=[];}
    }else if(kind==='relax'){
      if(!useBuildings(['table'])){target=this.closestOpen(Math.floor(c.position[0])+2,Math.floor(c.position[2]));if(target)path=this.path(c.position,target);}
    }else{target=this.closestOpen(Math.floor(c.position[0])+(this.random()<.5?-4:4),Math.floor(c.position[2])+(this.random()<.5?-3:3));if(target)path=this.path(c.position,target);}
    if(!target||path===null)return false;
    this.releasePerson(c);this.take(reserved);c.path=path;c.destination=target;c.personal={kind,elapsed:0,duration:kind==='eat'?4:kind==='wander'?16:kind==='sleep'||kind==='patient'?bed?20:40:20,reserved,...(buildingId?{buildingId}:{})};
    c.task={eat:'前往用餐',sleep:'前往休息',relax:'休闲娱乐',wander:'散步调节心情',patient:'卧床休养'}[kind];return true;
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
    const schedule=this.schedule(c);
    // Critical hunger can interrupt prolonged sleep or medical rest; food is still reserved once.
    if(c.personal&&c.personal.kind!=='eat'&&c.hunger<20&&this.personal(c,'eat'))return;
    if(!c.personal&&((c.hunger<34&&this.personal(c,'eat'))||(c.rest<20&&this.personal(c,'sleep'))))return;
    if(!c.personal&&c.disease>38&&this.personal(c,'patient'))return;
    if(c.personal){
      if(!this.move(c,dt)||!c.personal)return;
      const p=c.personal;p.elapsed+=dt;
      if(p.kind==='eat'&&p.elapsed>=p.duration){
        const cooked=!!p.reserved.meal;c.hunger=clamp(c.hunger+(cooked?70:43));c.mood=clamp(c.mood+(cooked?5:-3));p.reserved={};c.personal=null;c.task='吃饱了';
      }else if(p.kind==='sleep'){
        c.rest=clamp(c.rest+dt*(p.duration===20?1.2:.6));c.task='睡眠中';
        if(c.rest>=98||(schedule!=='sleep'&&c.rest>=78)){c.personal=null;c.task='精神饱满';}
      }else if(p.kind==='patient'){
        c.rest=clamp(c.rest+dt*.8);c.health=clamp(c.health+dt*.08);c.task='卧床休养';if(c.disease<12){c.personal=null;c.task='病情好转';}
      }else if(p.kind==='relax'||p.kind==='wander'){
        c.recreation=clamp(c.recreation+dt*1.5);c.mood=clamp(c.mood+dt*.1);
        if(p.elapsed>=p.duration||c.recreation>=98){c.personal=null;c.task='休闲结束';}
      }
      return;
    }
    if(!c.jobId){
      if(schedule==='sleep'&&c.rest<94&&this.personal(c,'sleep'))return;
      if((schedule==='relax'&&c.recreation<92||c.recreation<24)&&this.personal(c,'relax'))return;
      if(c.mood<22&&this.personal(c,'wander'))return;
      if(schedule==='sleep'||schedule==='relax'){c.task='自由活动';return;}
      if(this.s.time<c.retryAt)return;
      if(!this.assign(c)){c.task='等待工作 · 自由活动';c.retryAt=this.s.time+2;return;}
    }
    const job=this.s.jobs.find(j=>j.id===c.jobId);if(!job){c.jobId=null;return;}
    if(job.type==='chop'&&!this.world.getTree(job.targetId)){this.removeJob(job,false);return;}
    if (job.targetId === PLAYER_DELIVERY_TARGET) { this.deliverToPlayer(c, job, dt); return; }
    c.task=c.path.length?`前往${job.label}`:job.label;
    if(!this.move(c,dt)||c.jobId!==job.id)return;
    if(job.type==='chop'&&(Math.abs(Math.floor(c.position[0])-job.x)+Math.abs(Math.floor(c.position[2])-job.z)!==1||Math.abs(c.position[1]-job.y)>1.01)){
      this.releasePerson(c);c.retryAt=this.s.time+1;return;
    }
    if(job.type==='construct'){
      const b=this.s.buildings.find(b=>b.id===job.targetId);
      if(!b||b.phase==='preparingTerrain'||!this.buildingClearance(b)||!this.footprint(b).every(([x,z])=>this.world.terrainHeight(x,z)===b.y&&!this.terrainBlocker(x,z,b.y))){this.removeJob(job,false);this.refreshJobs();return;}
      b.phase='constructing';
    }
    if(job.type==='haul'){this.haul(c,job);return;}
    if(job.type==='doctor'){
      const patient=this.s.colonists.find(p=>p.id===job.targetId);
      if(!patient){this.removeJob(job,true);return;}
      if(horizontalDistance(c.position,patient.position)>1.7){
        if(!this.route(c,patient.position,true)){this.releasePerson(c);c.retryAt=this.s.time+3;}return;
      }
    }
    const rate=(.65+c.skills[job.type]*.1)*(c.hunger<20?.65:1)*(c.rest<25?.65:1)*(c.traits.includes('勤劳')?1.1:1);
    job.progress+=dt*rate;
    if(job.type==='construct'){const b=this.s.buildings.find(b=>b.id===job.targetId);if(b)b.progress=Math.min(1,job.progress/job.work);}
    if(job.type==='research')this.s.research.progress[job.targetId]=Math.min(job.work,job.progress);
    if(job.progress>=job.work)this.finish(c,job);
  }
  private assign(c:Colonist):boolean {
    const options=this.s.jobs.filter(j=>!j.assignedTo&&c.priorities[j.type]>0&&(j.type!=='doctor'||j.targetId!==c.id))
      .sort((a,b)=>Number(b.targetId===PLAYER_DELIVERY_TARGET)-Number(a.targetId===PLAYER_DELIVERY_TARGET)
        ||c.priorities[a.type]-c.priorities[b.type]||Math.hypot(a.x-c.position[0],a.z-c.position[2])-Math.hypot(b.x-c.position[0],b.z-c.position[2]));
    for(const job of options){
      if (job.targetId === PLAYER_DELIVERY_TARGET) {
        const source = this.storageTarget(c.position);
        if (!source || !this.route(c, source)) { job.state = 'blocked'; continue; }
        [job.x, job.y, job.z] = [Math.floor(source[0]), source[1], Math.floor(source[2])];
        job.assignedTo = c.id; job.state = 'working'; c.jobId = job.id;
        return true;
      }
      let cost:Partial<Resources>={};
      if(!Object.keys(job.reserved).length){
        if(job.type==='cook')cost={food:2};
        if(job.type==='craft')cost=job.resource==='components'?{steel:4,wood:2}:{food:2,cloth:1};
        if(job.type==='doctor')cost={medicine:1};
      }
      if(!this.afford(cost)){job.state='blocked';continue;}
      if(job.type==='haul'){
        const item=this.s.items.find(i=>i.id===job.targetId);if(!item||item.reservedBy&&item.reservedBy!==job.id)continue;
        if(!this.storageTarget())continue;
      }
      const target:Position=[job.x+.5,job.y,job.z+.5];
      const adjacent=['construct','chop','mine','cook','craft','research','doctor'].includes(job.type);
      if(job.type==='terraform'){
        const work=this.earthwork.get(this.cellKey(job.x,job.z));
        if(!work)continue;
        const path=this.terraformStand(work,c.position);
        if(path===null){job.state='blocked';job.label='整地受阻：等待可达的同层施工位置';for(const id of work.plans){const plan=this.s.terrainPlans.find(p=>p.id===id);if(plan){plan.state='blocked';plan.blockedReason='等待可达的相邻施工位置';}}continue;}
        c.path=path;c.destination=target;
      }else if(job.type==='construct'){
        const b=this.s.buildings.find(b=>b.id===job.targetId),path=b?this.buildingStand(b,c.position):null;
        if(path===null){job.state='blocked';if(b)b.blockedReason='等待可达的建筑施工位置';continue;}c.path=path;c.destination=target;
      }else if(job.type==='chop'){
        const tree=this.world.getTree(job.targetId),path=tree?this.treeStand(tree,c.position):null;
        if(path===null){job.state='blocked';continue;}c.path=path;c.destination=target;
      }else if(!this.route(c,target,adjacent)){job.state='blocked';continue;}
      this.take(cost);for(const r of RESOURCE_TYPES)if(cost[r])job.reserved[r]=(job.reserved[r]??0)+cost[r]!;
      job.assignedTo=c.id;job.state='working';c.jobId=job.id;
      if(job.type==='haul'){const item=this.s.items.find(i=>i.id===job.targetId)!;item.reservedBy=job.id;}
      return true;
    }return false;
  }

  private deliverToPlayer(c: Colonist, job: Job, dt: number): void {
    const resource = job.resource!;
    if (job.phase === 'pickup') {
      c.task = `前往储藏区领取${RESOURCE_NAMES[resource]}`;
      if (!this.move(c, dt) || c.jobId !== job.id) return;
      if (!this.s.zones.some(zone => zone.kind === 'stockpile' && job.x >= zone.x && job.x < zone.x + zone.w
        && job.z >= zone.z && job.z < zone.z + zone.d)) {
        this.releasePerson(c);
        return;
      }
      job.phase = 'deliver';
      c.destination = null;
      c.retryAt = 0;
      return;
    }

    const player = this.deliveryPosition;
    c.task = `给玩家送${RESOURCE_NAMES[resource]}`;
    if (!player) return;
    if (horizontalDistance(c.position, player) <= 1.5 && Math.abs(c.position[1] - player[1]) <= 1.5) {
      c.path = []; c.destination = null;
      const remaining = job.reserved[resource]!;
      const received = this.addToPlayerBag(resource, remaining);
      if (!received) { c.task = '玩家快捷栏已满，等待收货'; job.state = 'blocked'; return; }
      this.deliveryMessage = `${c.name}送来了 ${received} 个${RESOURCE_NAMES[resource]}`;
      this.event('info', this.deliveryMessage);
      if (received === remaining) this.finish(c, job);
      else {
        job.reserved[resource] = remaining - received;
        c.task = '玩家快捷栏已满，等待收货'; job.state = 'blocked';
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
    else if (job.state === 'blocked') c.task = '等待可到达的玩家位置';
  }

  private haul(c:Colonist,job:Job):void {
    if(job.phase==='pickup'){
      const item=this.s.items.find(i=>i.id===job.targetId),destination=this.storageTarget(c.position);
      if(!item||!destination){this.removeJob(job,true);return;}
      const path=this.path(c.position,destination);if(path===null){this.releasePerson(c);return;}
      const amount=Math.min(item.amount,12);item.amount-=amount;c.carrying[item.resource]=amount;
      job.resource=item.resource;job.amount=amount;job.phase='deliver';job.destination=destination;c.path=path;c.destination=destination;
      if(item.amount===0)this.s.items.splice(this.s.items.indexOf(item),1);else item.reservedBy=null;
    }else{
      if(!job.resource)return;const amount=c.carrying[job.resource]??0;
      this.s.resources[job.resource]+=amount;this.s.metrics.hauled+=amount;c.carrying={};this.finish(c,job);
    }
  }
  private finish(c:Colonist,job:Job):void {
    if(job.type==='terraform'){
      if(this.finishTerraform(c,job)){c.skills.terraform=Math.min(20,c.skills.terraform+.05);this.s.metrics.jobsCompleted++;c.task='完成一层填挖';}return;
    }else if(job.type==='construct'){
      const b=this.s.buildings.find(b=>b.id===job.targetId);if(b){
        if(!this.buildingClearance(b)||!this.footprint(b).every(([x,z])=>this.world.terrainHeight(x,z)===b.y&&!this.terrainBlocker(x,z,b.y))){this.removeJob(job,false);this.refreshJobs();return;}
        if(BUILDING_DEFS[b.kind].blocking&&this.occupiedByActor(b)){
          b.blockedReason='等待居民离开建筑占地';job.progress=job.work-.25;
          for(const p of this.s.colonists)if(p!==c&&p.position[0]+.23>b.x&&p.position[0]-.23<b.x+b.w&&p.position[2]+.23>b.z&&p.position[2]-.23<b.z+b.d){
            this.releasePerson(p);const path=this.buildingStand(b,p.position);if(path){p.path=path;p.destination=path.at(-1)??p.position;p.personal={kind:'wander',elapsed:0,duration:1,reserved:{}};}
          }return;
        }
        const leaves=buildingParts(b).filter(p=>this.world.get(p.x,p.y,p.z)===BLOCK.Leaves);if(leaves.length)this.world.edit(leaves.map(({x,y,z})=>({x,y,z,block:BLOCK.Air})));
        b.complete=true;b.phase='completed';b.progress=1;b.reserved={};this.s.metrics.built++;this.navigationDirty=true;this.rebuildBuildings();this.event('info',`${c.name}完成了${BUILDING_DEFS[b.kind].name}。`);}
    }else if(job.type==='grow'){
      const crop=this.s.crops.find(p=>p.id===job.targetId);if(crop){crop.planted=true;crop.growth=0;}
    }else if(job.type==='harvest'){
      const crop=this.s.crops.find(p=>p.id===job.targetId);if(crop?.planted){const yieldAmount=(crop.kind==='corn'?12:6)+Math.floor(c.skills.harvest/5);this.drop('food',yieldAmount,crop.x,crop.z);crop.planted=false;crop.growth=0;this.s.metrics.harvested+=yieldAmount;}
    }else if(job.type==='cook'){
      this.drop('meal',3,job.x,job.z);this.s.metrics.cooked+=3;
    }else if(job.type==='craft'){
      this.drop(job.resource==='components'?'components':'medicine',job.resource==='components'?1:2,job.x,job.z);
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
      if(this.buildingAt.has(this.cellKey(job.x,job.z))||this.world.treeAtColumn(job.x,job.z)){this.removeJob(job,true);return;}
      const y=this.world.surfaceHeight(job.x,job.z,false),block=this.world.get(job.x,y,job.z);
      if(y>0&&[BLOCK.Stone,BLOCK.Dirt,BLOCK.Grass,BLOCK.Sand].includes(block as never)){
        this.world.set(job.x,y,job.z,BLOCK.Air);this.refreshGround();this.navigationDirty=true;this.drop('stone',block===BLOCK.Stone?8:3,job.x,job.z);
        if(block===BLOCK.Stone)this.drop('steel',2,job.x,job.z);
      }
    }
    job.reserved={};c.skills[job.type]=Math.min(20,c.skills[job.type]+.12);this.s.metrics.jobsCompleted++;
    this.removeJob(job,false);c.task='工作完成';
  }

  private updateRooms():void {
    this.navigationDirty=false;this.rooms=[];this.roomAt.fill(-1);
    const barriers=new Set(this.s.buildings.filter(b=>b.complete&&(b.kind==='wall'||b.kind==='door'&&!b.doorOpen)).flatMap(b=>this.footprint(b).map(([x,z])=>this.cellKey(x,z))));
    if(barriers.size<4){for(const b of this.s.buildings){b.roomId=null;b.comfort=0;}return;}
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
      const id=this.rooms.length,set=new Set(cells.map(([x,z])=>x+z*this.world.width));
      const floors=this.s.buildings.filter(b=>b.complete&&b.kind==='floor'&&set.has(b.x+b.z*this.world.width)).length;
      const furnishing=this.s.buildings.filter(b=>b.complete&&['bed','table','medicalBed'].includes(b.kind)&&set.has(b.x+b.z*this.world.width)).length;
      const comfort=Math.min(100,35+floors/cells.length*40+furnishing*7);
      const room:RoomView={id,cells,enclosed:true,comfort,temperature:this.s.temperature*.4+21*.6};this.rooms.push(room);
      for(const[x,z]of cells)this.roomAt[x+z*this.world.width]=id;
    }
    for(const b of this.s.buildings){const room=this.roomAt[b.x+b.z*this.world.width]??-1;b.roomId=room>=0?room:null;b.comfort=room>=0?this.rooms[room]!.comfort:0;}
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
    this.s.lastDay=this.day();const roll=this.random();
    this.s.weather=roll<.1?'热浪':roll<.2?'寒潮':roll<.42?'细雨':roll<.64?'多云':'晴朗';
    this.event('weather',`第 ${this.day()} 天：${this.season()}，预计${this.s.weather}。留意居民需求与食品供应。`);
    if(this.day()%3===1){
      this.s.trade.available=true;this.s.trade.leavesAt=this.s.time+150;
      this.s.trade.stock={wood:40,stone:30,steel:25,food:35,meal:12,medicine:10,cloth:20,silver:500,components:6};
      this.event('trade','友善商队抵达，可在贸易面板交换物资。');
    }
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
    const deliveries = this.s.jobs.filter(job => job.targetId === PLAYER_DELIVERY_TARGET && job.phase === 'deliver' && job.assignedTo);
    const colonists = deliveries.length ? this.s.colonists.map(colonist => {
      const delivery = deliveries.find(job => job.assignedTo === colonist.id);
      return delivery ? { ...colonist, carrying: delivery.reserved } : colonist;
    }) : this.s.colonists;
    return {colonists,buildings:this.s.buildings,zones:this.s.zones,crops:this.s.crops,items:this.s.items,selectedColonistId:this.s.selectedColonistId};
  }
  snapshot():ColonySnapshot {
    const snapshot=copy({version:1 as const,speed:this.s.speed,time:this.s.time,day:this.day(),hour:this.hour(),season:this.season(),weather:this.s.weather,temperature:this.s.temperature,
      resources:this.s.resources,playerBag:this.s.playerBag,bagSelected:this.s.bagSelected,chests:this.s.chests,
      colonists:this.s.colonists.map(({path,personal,destination,retryAt,...view})=>view),buildings:this.s.buildings,zones:this.s.zones,crops:this.s.crops,
      items:this.s.items,jobs:this.s.jobs.map(({phase,resource,amount,destination,...view})=>view.targetId===PLAYER_DELIVERY_TARGET
        ? {...view,deliveryPhase:phase==='deliver'?'deliver' as const:'pickup' as const} : view),rooms:this.rooms,research:this.s.research,power:this.s.power,trade:this.s.trade,
      bills:this.s.bills,events:this.s.events,metrics:this.s.metrics,selectedColonistId:this.s.selectedColonistId});
    const terrainPlans=this.s.terrainPlans.map(({initialWork,cells,...view})=>{
      let stable=this.terrainCellViews.get(view.id);if(!stable){stable=cells.map(([x,z])=>Object.freeze([x,z]) as unknown as [number,number]);Object.freeze(stable);this.terrainCellViews.set(view.id,stable);}
      return {...view,cells:stable};
    });
    return {...snapshot,terrainPlans};
  }
  serialize():unknown{return copy(this.s);}
  load(data:unknown):void {
    const validated=this.validate(data);
    // Older completed furniture was allowed to cut individual leaves. Its new complete
    // tree model must not grow back through that furniture when upgrading the save.
    const obstructingTrees=new Set<string>();
    for(const b of validated.buildings)if(b.complete)for(const p of buildingParts(b))for(const tree of this.world.treesAtVoxel(p.x,p.y,p.z))obstructingTrees.add(tree.id);
    for(const id of obstructingTrees)this.world.removeTree(id,{recordHistory:false});
    this.deliveryMessage = undefined;
    this.s=validated;this.terrainCellViews.clear();this.terrainIndexDirty=true;this.rebuildBuildings();this.refreshGround();this.refreshTerrainPlans();this.navigationDirty=true;this.updateRooms();
    this.refreshTreeJobs();
  }
  private validate(data:unknown):SavedState {
    const fail=():never=>{throw new Error('殖民地存档数据不完整、损坏或版本不兼容。');};
    if(!data||typeof data!=='object')fail();
    const s=copy(data) as SavedState;
    // Legacy objects are upgraded together, on the private copy, before any live state changes.
    s.terrainPlans??=[];
    s.playerBag ??= emptySlots(PLAYER_SLOTS);
    s.bagSelected ??= 0;
    s.chests ??= [this.starterChest()];
    const legacyBuildings=new Set<string>();
    if(Array.isArray(s.buildings))for(const b of s.buildings)if(b&&typeof b==='object'){
      if(b.rotation===undefined&&b.h===undefined){legacyBuildings.add(b.id);b.rotation=0;b.h=BUILDING_DEFS[b.kind]?.height??1;if(b.kind==='door')b.doorOpen??=false;}
      b.w??=1;b.d??=1;b.phase??=b.complete?'completed':'readyToBuild';
    }
    if(Array.isArray(s.colonists))for(const c of s.colonists)if(c&&typeof c==='object'){c.bag??=emptySlots(1);if(c.skills)c.skills.terraform??=c.skills.construct??2;if(c.priorities)c.priorities.terraform??=c.priorities.construct??3;}
    const finite=(n:unknown,min=0,max=1e9)=>typeof n==='number'&&Number.isFinite(n)&&n>=min&&n<=max;
    const integer=(n:unknown,min=0,max=1e9)=>finite(n,min,max)&&Number.isInteger(n);
    const text=(x:unknown,max=200)=>typeof x==='string'&&x.length<=max;
    const list=(x:unknown,max:number)=>Array.isArray(x)&&x.length<=max;
    const inventory = (slots: unknown, size: number) => Array.isArray(slots) && slots.length === size
      && slots.every(slot => slot === null || slot && RESOURCE_TYPES.includes(slot.resource) && integer(slot.count, 1, STACK_LIMIT));
    const area=this.world.width*this.world.depth;
    const position=(p:unknown)=>Array.isArray(p)&&p.length===3&&finite(p[0],0,this.world.width)&&finite(p[1],0,this.world.height)&&finite(p[2],0,this.world.depth);
    const resources=(r:unknown,partial=false)=>!!r&&typeof r==='object'&&!Array.isArray(r)&&Object.keys(r).every(k=>RESOURCE_TYPES.includes(k as Resource))
      &&RESOURCE_TYPES.every(k=>partial&&(r as Resources)[k]===undefined||integer((r as Resources)[k],0,1e7));
    if(s.version!==1||s.type!=='peaceful-colony'||s.worldSeed!==this.world.seed||!finite(s.time)||!finite(s.accumulator,0,STEP)||!integer(s.rng,1,4294967295)||!integer(s.nextId,1)||!SPEEDS.includes(s.speed)||!finite(s.decision,0,1)||!integer(s.lastDay,1)||!finite(s.spoilage,0,1000))fail();
    if(!resources(s.resources)||!list(s.colonists,20)||s.colonists.length<1||!list(s.buildings,area)||!list(s.zones,area)||!list(s.crops,area)||!list(s.items,Math.max(5000,area))||!list(s.jobs,Math.max(6000,area))||!list(s.events,80)||!list(s.terrainPlans,area))fail();
    const unique=(rows:{id:string}[])=>{const ids=new Set<string>();for(const row of rows){if(!row||!text(row.id,80)||!row.id||ids.has(row.id))fail();ids.add(row.id);}return ids;};
    if (!inventory(s.playerBag, PLAYER_SLOTS) || !validSlot(s.bagSelected, s.playerBag) || !list(s.chests, area)) fail();
    unique(s.chests);
    const chestCells = new Set<number>();
    for (const chest of s.chests) {
      if (!integer(chest.x, 0, this.world.width - 1) || !integer(chest.z, 0, this.world.depth - 1) || !inventory(chest.slots, CHEST_SLOTS)) fail();
      const key = this.cellKey(chest.x, chest.z);
      if (chestCells.has(key)) fail();
      chestCells.add(key);
    }
    const colonistIds=unique(s.colonists),buildingIds=unique(s.buildings),cropIds=unique(s.crops),itemIds=unique(s.items),jobIds=unique(s.jobs),planIds=unique(s.terrainPlans);unique(s.zones);unique(s.events);
    const location=(r:{x:number;y:number;z:number})=>integer(r.x,0,this.world.width-1)&&integer(r.z,0,this.world.depth-1)&&finite(r.y,0,this.world.height);
    for(const c of s.colonists){
      if(!text(c.name,40)||!list(c.traits,10)||!c.traits.every(t=>text(t,40))||!position(c.position)||!position(c.color)||!['balanced','day','night','rest'].includes(c.schedule)
        ||!['health','hunger','rest','recreation','mood','disease','comfort'].every(k=>finite(c[k as keyof Colonist],0,100))||!text(c.task)||!resources(c.carrying,true)||!inventory(c.bag,1)
        ||!list(c.path,area)||!c.path.every(position)||c.destination!==null&&!position(c.destination)||!finite(c.retryAt)||!c.skills||!c.priorities
        ||!JOB_TYPES.every(j=>finite(c.skills[j],0,20)&&integer(c.priorities[j],0,4))||c.jobId!==null&&!jobIds.has(c.jobId))fail();
      if(c.personal&&(!['eat','sleep','relax','wander','patient'].includes(c.personal.kind)||!finite(c.personal.elapsed)||!finite(c.personal.duration,0,1000)||!resources(c.personal.reserved,true)||c.personal.buildingId!==undefined&&!buildingIds.has(c.personal.buildingId)))fail();
      for(let i=1;i<c.path.length;i++)if(horizontalDistance(c.path[i-1]!,c.path[i]!)>1.01||Math.abs(c.path[i-1]![1]-c.path[i]![1])>1.01)fail();
    }
    for(const b of s.buildings){
      if(!location(b)||!integer(b.y,1,this.world.height-1)||!(b.kind in BUILDING_DEFS)||typeof b.complete!=='boolean'||!finite(b.progress,0,1)||!resources(b.reserved,true)||typeof b.powered!=='boolean'||!finite(b.comfort,0,100)||b.roomId!==null&&!integer(b.roomId,0,area)||!integer(b.w,1,this.world.width)||!integer(b.d,1,this.world.depth)||!integer(b.h,1,this.world.height)||!integer(b.rotation,0,3)||b.x+b.w>this.world.width||b.z+b.d>this.world.depth||b.y+b.h>this.world.height||!['preparingTerrain','readyToBuild','constructing','completed'].includes(b.phase)||b.terrainPlanId!==undefined&&!planIds.has(b.terrainPlanId)||b.blockedReason!==undefined&&!text(b.blockedReason)||b.kind==='door'&&typeof b.doorOpen!=='boolean'||b.kind!=='door'&&b.doorOpen!==undefined)fail();
      if(b.complete&&(b.phase!=='completed'||b.progress!==1||Object.keys(b.reserved).length)||!b.complete&&b.phase==='completed')fail();
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
    for(const b of s.buildings){
      const dimensions=buildingDimensions(b.kind,b.rotation);
      if(b.w!==dimensions.w||b.d!==dimensions.d||b.h!==dimensions.h)fail();
      if(b.complete&&buildingParts(b).some(p=>this.world.get(p.x,p.y,p.z)!==BLOCK.Air))fail();
      for(const p of buildingParts(b)){const key=`${p.x},${p.y},${p.z}`;if(occupied.has(key))fail();occupied.add(key);}
    }
    for(const z of s.zones)if(!location(z)||!['farm','stockpile'].includes(z.kind)||!integer(z.w,1,this.world.width)||!integer(z.d,1,this.world.depth)||z.x+z.w>this.world.width||z.z+z.d>this.world.depth||!['rice','corn'].includes(z.crop))fail();
    const targets=new Map<number,number>();
    for(const p of s.terrainPlans){
      if(!integer(p.target,1,this.world.height-2)||!list(p.cells,area)||!p.cells.length||!finite(p.initialWork)||!finite(p.remainingCut)||!finite(p.remainingFill)||!finite(p.progress,0,1)||!['queued','working','blocked','completed'].includes(p.state)||p.blockedReason!==undefined&&!text(p.blockedReason)||p.buildingId!==undefined&&!buildingIds.has(p.buildingId))fail();
      const seen=new Set<number>();for(const cell of p.cells){if(!Array.isArray(cell)||cell.length!==2||!integer(cell[0],0,this.world.width-1)||!integer(cell[1],0,this.world.depth-1))fail();const key=this.cellKey(cell[0],cell[1]);if(seen.has(key))fail();seen.add(key);if(p.state!=='completed'){if(targets.has(key)&&targets.get(key)!==p.target)fail();targets.set(key,p.target);}}
      if(p.buildingId){const b=s.buildings.find(b=>b.id===p.buildingId)!;if(b.terrainPlanId!==p.id||b.y!==p.target||p.cells.length!==b.w*b.d||p.cells.some(([x,z])=>x<b.x||z<b.z||x>=b.x+b.w||z>=b.z+b.d))fail();}
    }
    for(const p of s.crops)if(!location(p)||!['rice','corn'].includes(p.kind)||typeof p.planted!=='boolean'||!finite(p.growth,0,1))fail();
    for(const item of s.items)if(!location(item)||!RESOURCE_TYPES.includes(item.resource)||!integer(item.amount,1,1e7)||!finite(item.age)||item.reservedBy!==null&&!jobIds.has(item.reservedBy))fail();
    for(const j of s.jobs){
      if(!location(j)||!JOB_TYPES.includes(j.type)||!text(j.targetId,j.type==='chop'?120:80)||!finite(j.progress)||!finite(j.work,.01,10000)||!['queued','working','blocked'].includes(j.state)||j.assignedTo!==null&&!colonistIds.has(j.assignedTo)||!resources(j.reserved,true)||!text(j.label)||!['work','pickup','deliver'].includes(j.phase)||!integer(j.amount,0,10000)||j.destination!==null&&!position(j.destination)||j.resource!==undefined&&!RESOURCE_TYPES.includes(j.resource))fail();
      if (j.targetId === PLAYER_DELIVERY_TARGET) {
        if (j.type !== 'haul' || !j.resource || !integer(j.reserved[j.resource], 1, PLAYER_SLOTS * STACK_LIMIT)
          || Object.keys(j.reserved).length !== 1 || j.phase === 'work' || j.phase === 'deliver' && !j.assignedTo) fail();
      } else if(j.type==='construct'&&!buildingIds.has(j.targetId)||['grow','harvest'].includes(j.type)&&!cropIds.has(j.targetId)||j.type==='haul'&&j.phase==='pickup'&&!itemIds.has(j.targetId)||j.type==='doctor'&&!colonistIds.has(j.targetId)||j.type==='research'&&!RESEARCH_DEFS[j.targetId])fail();
      if(j.type==='terraform'&&(!targets.has(this.cellKey(j.x,j.z))||j.targetId!==`earth:${j.x}:${j.z}`))fail();
      if(j.assignedTo&&s.colonists.find(c=>c.id===j.assignedTo)?.jobId!==j.id)fail();
    }
    if(!s.research||!list(s.research.completed,10)||!s.research.completed.every(id=>!!RESEARCH_DEFS[id])||new Set(s.research.completed).size!==s.research.completed.length||s.research.active!==null&&!RESEARCH_DEFS[s.research.active]||!s.research.progress||Object.entries(s.research.progress).some(([id,p])=>!RESEARCH_DEFS[id]||!finite(p,0,RESEARCH_DEFS[id]!.work)))fail();
    if(!s.power||!['generation','demand','stored','capacity','supplied'].every(k=>finite(s.power[k as keyof typeof s.power]))||typeof s.power.coldStorage!=='boolean'||s.power.stored>s.power.capacity+1e-6)fail();
    if(!s.trade||typeof s.trade.available!=='boolean'||!finite(s.trade.leavesAt)||!resources(s.trade.stock)||!resources(s.trade.prices)||!s.bills||!['meal','medicine','components'].every(k=>integer(s.bills[k as keyof typeof s.bills],0,200)))fail();
    if(!s.metrics||!Object.values(s.metrics).every(v=>finite(v))||!text(s.weather,20)||!['晴朗','多云','细雨','热浪','寒潮'].includes(s.weather)||!finite(s.temperature,-40,70)||s.selectedColonistId!==null&&!colonistIds.has(s.selectedColonistId))fail();
    for(const e of s.events)if(!finite(e.time)||!integer(e.day,1)||!finite(e.hour,0,24)||!text(e.text,300)||!['info','weather','health','trade','research','arrival'].includes(e.type))fail();
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
    return s;
  }
}
