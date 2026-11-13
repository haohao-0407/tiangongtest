import { BLOCK, VoxelWorld } from '../voxel/model.ts';
import {
  BUILDING_DEFS, RESEARCH_DEFS, JOB_TYPES, JOB_NAMES, RESOURCE_TYPES, SCHEDULES,
  type BuildingKind, type BuildingView, type ColonyCommand, type ColonyEvent,
  type ColonySnapshot, type ColonistView, type CommandResult, type CropView,
  type ItemView, type JobType, type JobView, type Position, type Resource,
  type Resources, type RoomView, type Schedule, type ZoneView,
} from './contracts.ts';
export * from './contracts.ts';

const STEP = 0.25;
export const DAY_SECONDS = 360;
const SPEEDS = [0, 1, 3, 6];
const EMPTY_RESOURCES = (): Resources => Object.fromEntries(RESOURCE_TYPES.map((r) => [r, 0])) as Resources;
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));
const horizontalDistance = (a: Position, b: Position) => Math.hypot(a[0] - b[0], a[2] - b[2]);
type Personal = { kind: 'eat'|'sleep'|'relax'|'wander'|'patient'; elapsed: number; duration: number; reserved: Partial<Resources> };
type Colonist = ColonistView & { path: Position[]; personal: Personal | null; destination: Position | null; retryAt: number };
type Job = JobView & { phase: 'work'|'pickup'|'deliver'; resource?: Resource; amount: number; destination: Position | null };
type SavedState = {
  version: 1; type: 'peaceful-colony'; worldSeed: string; time: number; accumulator: number; rng: number;
  nextId: number; speed: number; decision: number; lastDay: number; spoilage: number;
  resources: Resources; colonists: Colonist[]; buildings: BuildingView[]; zones: ZoneView[];
  crops: CropView[]; items: ItemView[]; jobs: Job[]; events: ColonyEvent[];
  research: ColonySnapshot['research']; power: ColonySnapshot['power']; trade: ColonySnapshot['trade'];
  bills: ColonySnapshot['bills']; metrics: ColonySnapshot['metrics']; selectedColonistId: string|null;
  weather: string; temperature: number;
};

/** All quantities and work reservations have one owner; no runtime/browser API is needed. */
export class ColonySimulation {
  private s: SavedState;
  private ground = new Float32Array(48 * 48).fill(-1);
  private worldRevision = -1;
  private navigationDirty = true;
  private rooms: RoomView[] = [];
  private roomAt = new Int16Array(48 * 48).fill(-1);

  constructor(readonly world: VoxelWorld) {
    let seed = 2166136261;
    for (const ch of world.seed) seed = Math.imul(seed ^ ch.charCodeAt(0), 16777619);
    this.s = {
      version: 1, type: 'peaceful-colony', worldSeed: world.seed, time: DAY_SECONDS / 3, accumulator: 0,
      rng: seed >>> 0 || 1, nextId: 1, speed: 1, decision: 0, lastDay: 1, spoilage: 0,
      resources: { wood: 140, stone: 110, steel: 60, food: 40, meal: 14, medicine: 12, cloth: 30, silver: 120, components: 8 },
      colonists: [], buildings: [], zones: [], crops: [], items: [], jobs: [], events: [],
      research: { active: null, progress: {}, completed: [] },
      power: { generation: 0, demand: 0, stored: 0, capacity: 0, supplied: 0, coldStorage: false },
      trade: { available: true, leavesAt: DAY_SECONDS / 3 + 120, stock: { wood: 40, stone: 30, steel: 25, food: 35, meal: 12, medicine: 10, cloth: 20, silver: 500, components: 6 },
        prices: { wood: 2, stone: 2, steel: 4, food: 3, meal: 7, medicine: 12, cloth: 4, silver: 1, components: 18 } },
      bills: { meal: 16, medicine: 8, components: 4 },
      metrics: { jobsCompleted: 0, built: 0, harvested: 0, hauled: 0, cooked: 0, researched: 0, treated: 0, spoiled: 0, distanceWalked: 0 },
      selectedColonistId: null, weather: '晴朗', temperature: 22,
    };
    this.refreshGround();
    const centre = this.closestOpen(27, 27) ?? [27.5, 6, 27.5];
    const cx = Math.floor(centre[0]), cz = Math.floor(centre[2]);
    this.addZone('stockpile', Math.max(1, cx - 4), cz - 1, 3, 3, 'rice');
    this.addZone('farm', cx - 2, cz + 3, 3, 3, 'rice');
    for (const [kind, dx, dz] of [
      ['bed', 1, -3], ['bed', 2, -3], ['bed', 3, -3], ['table', 1, -1],
      ['stove', 3, -1], ['workbench', 4, -1], ['researchDesk', 4, 1],
    ] as [BuildingKind, number, number][]) {
      const p = this.closestOpen(cx + dx, cz + dz, true);
      if (p) this.s.buildings.push({ id: this.id('building'), kind, x: Math.floor(p[0]), y: p[1], z: Math.floor(p[2]), complete: true, progress: 1, reserved: {}, powered: false, comfort: 0, roomId: null });
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
    if (index % 3 === 0) { priorities.construct = 1; priorities.chop = 2; priorities.mine = 2; skills.construct = 9; }
    if (index % 3 === 1) { priorities.cook = 1; priorities.doctor = 1; priorities.haul = 2; skills.cook = 8; skills.doctor = 7; }
    if (index % 3 === 2) { priorities.grow = 1; priorities.harvest = 1; priorities.research = 2; skills.grow = 9; skills.research = 8; }
    this.s.colonists.push({ id: this.id('colonist'), name, traits: [['勤劳', '巧手'], ['体贴', '乐观'], ['园艺爱好者', '好学']][index % 3]!, skills, priorities, schedule: 'balanced',
      position: this.closestOpen(x, z) ?? [27.5, 6, 27.5], health: 100, hunger: 72 + index * 5, rest: 88, recreation: 76, mood: 78, disease: 0,
      task: '观察新营地', jobId: null, color: [[0.78,0.44,0.25],[0.29,0.54,0.69],[0.55,0.66,0.32]][index % 3] as Position,
      carrying: {}, comfort: 0, path: [], personal: null, destination: null, retryAt: 0 });
  }

  tick(realSeconds: number): void {
    if (!Number.isFinite(realSeconds) || realSeconds < 0 || realSeconds > 600) throw new RangeError('模拟步长必须为 0–600 秒。');
    this.s.accumulator += realSeconds * this.s.speed;
    while (this.s.accumulator + 1e-9 >= STEP) {
      this.s.accumulator = Math.max(0, this.s.accumulator - STEP);
      this.step(STEP);
    }
  }
  private step(dt: number): void {
    this.s.time += dt;
    if (this.world.revision !== this.worldRevision) { this.refreshGround(); this.navigationDirty = true; }
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
      if (c.action === 'build') return this.orderBuild(c.kind, c.x, c.z);
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
  private orderBuild(kind: string|undefined, x: number|undefined, z: number|undefined): CommandResult {
    this.validCell(x,z); const zz = z!;
    if (!kind || !(kind in BUILDING_DEFS)) throw new Error('未知建筑。');
    const def = BUILDING_DEFS[kind as BuildingKind];
    if (def.research && !this.s.research.completed.includes(def.research)) throw new Error(`需要研究：${RESEARCH_DEFS[def.research]!.name}`);
    if (this.s.buildings.some((b) => b.x === x && b.z === zz)) throw new Error('这里已有建筑或蓝图。');
    const y = this.groundY(x,zz);
    if (y < 0 || !this.walkable(x,zz)) throw new Error('这里没有可施工的干燥地面，请先清理树木或障碍。');
    if (this.s.crops.some((p) => p.x === x && p.z === zz)) throw new Error('请在农田以外建造。');
    if (!this.afford(def.cost)) throw new Error('仓储物资不足；落地物资需先搬运入库。');
    this.take(def.cost);
    const building: BuildingView = {id:this.id('building'),kind:def.id,x,y,z:zz,complete:false,progress:0,reserved:copy(def.cost),powered:false,comfort:0,roomId:null};
    this.s.buildings.push(building); this.refreshJobs();
    this.event('info', `已规划${def.name}，材料已预约，等待居民施工。`);
    return {ok:true,message:`${def.name}蓝图已下达`,id:building.id};
  }
  private designate(c: ColonyCommand): CommandResult {
    this.validCell(c.x,c.z); const x=c.x!, z=c.z!, w=c.w??1, d=c.d??1;
    if (!Number.isInteger(w)||!Number.isInteger(d)||w<1||d<1||w>12||d>12||x+w>48||z+d>48) throw new Error('区域尺寸必须为 1–12 格且位于地图内。');
    if (c.kind === 'farm' || c.kind === 'stockpile') {
      const crop = c.crop === 'corn' ? 'corn' : 'rice';
      if (crop === 'corn' && !this.s.research.completed.includes('agriculture')) throw new Error('玉米需要精耕农业研究。');
      if (this.s.zones.some((zone) => x < zone.x+zone.w && x+w > zone.x && z < zone.z+zone.d && z+d > zone.z)) throw new Error('区域不能相互重叠。');
      const cells: [number,number][]=[];
      for(let zz=z;zz<z+d;zz++)for(let xx=x;xx<x+w;xx++)cells.push([xx,zz]);
      if(cells.some(([xx,zz])=>!this.walkable(xx,zz)||this.s.buildings.some(b=>b.x===xx&&b.z===zz)))throw new Error('区域包含水面、障碍或建筑，请选择空地。');
      const zone=this.addZone(c.kind,x,z,w,d,crop); this.refreshJobs();
      return {ok:true,message:c.kind==='farm'?'种植区已规划，居民会播种和收获':'仓储区已规划，居民会搬运落地物资',id:zone.id};
    }
    let added=0;
    for(let zz=z;zz<z+d;zz++)for(let xx=x;xx<x+w;xx++) {
      if(c.kind==='chop') {
        const trunk=this.treeBase(xx,zz);
        if(trunk>=1 && !this.s.jobs.some(j=>j.type==='chop'&&j.x===xx&&j.z===zz)) {this.addJob('chop',`tree:${xx}:${zz}`,xx,trunk,zz,16,'砍伐树木');added++;}
      } else if(c.kind==='mine') {
        const y=this.world.surfaceHeight(xx,zz,false);
        if(y>0 && [BLOCK.Stone,BLOCK.Dirt,BLOCK.Grass,BLOCK.Sand].includes(this.world.get(xx,y,zz) as never)
          && !this.s.jobs.some(j=>j.type==='mine'&&j.x===xx&&j.z===zz)) {this.addJob('mine',`rock:${xx}:${zz}:${y}`,xx,y,zz,19,'开采地表');added++;}
      } else if(c.kind==='harvest') {
        for(const crop of this.s.crops.filter(p=>p.x===xx&&p.z===zz&&p.planted&&p.growth>=0.95)) {
          if(!this.s.jobs.some(j=>j.type==='harvest'&&j.targetId===crop.id)){this.addJob('harvest',crop.id,xx,crop.y,zz,6,'收获作物');added++;}
        }
      } else throw new Error('未知区域或采集指令。');
    }
    if(!added)throw new Error('选区没有符合条件的树木、地表矿石或成熟作物。');
    return {ok:true,message:`已下达 ${added} 项工作`};
  }
  private addZone(kind:'farm'|'stockpile',x:number,z:number,w:number,d:number,crop:'rice'|'corn'):ZoneView {
    const zone:ZoneView={id:this.id('zone'),kind,x,y:Math.max(1,this.groundY(x,z)),z,w,d,crop};this.s.zones.push(zone);
    if(kind==='farm')for(let zz=z;zz<z+d;zz++)for(let xx=x;xx<x+w;xx++) {
      const y=this.groundY(xx,zz); if(y<0||this.s.buildings.some(b=>b.x===xx&&b.z===zz))continue;
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
      return {ok:true,message:'蓝图已取消，未消耗预约材料已退还'};
    }
    const job=this.s.jobs.find(j=>j.id===id);if(job){this.removeJob(job,true);return{ok:true,message:'工作订单已取消'};}
    const zone=this.s.zones.find(z=>z.id===id);
    if(zone){
      if(zone.kind==='stockpile'&&this.s.zones.filter(z=>z.kind==='stockpile').length===1)throw new Error('请保留至少一处仓储区。');
      const crops=this.s.crops.filter(p=>p.x>=zone.x&&p.x<zone.x+zone.w&&p.z>=zone.z&&p.z<zone.z+zone.d);
      for(const job of [...this.s.jobs])if(crops.some(p=>p.id===job.targetId))this.removeJob(job,true);
      this.s.crops=this.s.crops.filter(p=>!crops.includes(p));this.s.zones.splice(this.s.zones.indexOf(zone),1);
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

  private refreshGround():void {
    for(let z=0;z<48;z++)for(let x=0;x<48;x++) {
      let y=-1;
      for(let h=1;h<this.world.height-1;h++) {
        const under=this.world.get(x,h-1,z);
        const feet=this.world.get(x,h,z),head=this.world.get(x,h+1,z);
        // Leaf canopies are soft foliage for pedestrians; the actual trunk remains solid.
        if(under!==BLOCK.Air&&under!==BLOCK.Water&&under!==BLOCK.Wood&&under!==BLOCK.Leaves
          &&(feet===BLOCK.Air||feet===BLOCK.Leaves)&&(head===BLOCK.Air||head===BLOCK.Leaves)){y=h;break;}
      }
      this.ground[x+z*48]=y;
    }
    this.worldRevision=this.world.revision;
  }
  private groundY(x:number,z:number):number {return x>=0&&x<48&&z>=0&&z<48?this.ground[x+z*48]??-1:-1;}
  private walkable(x:number,z:number):boolean {
    return this.groundY(x,z)>=1&&!this.s.buildings.some(b=>b.complete&&b.x===x&&b.z===z&&BUILDING_DEFS[b.kind].blocking);
  }
  private closestOpen(x:number,z:number,avoidBlueprint=false):Position|null {
    for(let radius=0;radius<12;radius++)for(let dz=-radius;dz<=radius;dz++)for(let dx=-radius;dx<=radius;dx++) {
      if(Math.max(Math.abs(dx),Math.abs(dz))!==radius)continue;
      const xx=Math.floor(x)+dx,zz=Math.floor(z)+dz;
      if(this.walkable(xx,zz)&&(!avoidBlueprint||!this.s.buildings.some(b=>b.x===xx&&b.z===zz)))return[xx+0.5,this.groundY(xx,zz),zz+0.5];
    }return null;
  }
  /** Four-neighbour BFS, with a one-voxel climb limit; no path means no task claim. */
  private path(from:Position,to:Position,adjacent=false):Position[]|null {
    const sx=Math.floor(from[0]),sz=Math.floor(from[2]),tx=Math.floor(to[0]),tz=Math.floor(to[2]);
    const start=sx+sz*48;
    if(sx<0||sz<0||sx>=48||sz>=48)return null;
    const goals=new Set<number>();
    for(const [dx,dz]of adjacent?[[1,0],[-1,0],[0,1],[0,-1]]:[[0,0]])if(this.walkable(tx+dx,tz+dz))goals.add(tx+dx+(tz+dz)*48);
    if(goals.has(start))return[];
    if(!goals.size)return null;
    const queue=new Int32Array(2304),parents=new Int32Array(2304).fill(-2);let head=0,tail=1,found=-1;
    queue[0]=start;parents[start]=-1;
    while(head<tail){
      const cur=queue[head++]!,x=cur%48,z=Math.floor(cur/48),h=this.groundY(x,z);
      for(const[dx,dz]of [[1,0],[-1,0],[0,1],[0,-1]]){
        const nx=x+dx!,nz=z+dz!;if(!this.walkable(nx,nz)||Math.abs(this.groundY(nx,nz)-h)>1.01)continue;
        const next=nx+nz*48;if(parents[next]!==-2)continue;parents[next]=cur;
        if(goals.has(next)){found=next;head=tail;break;}queue[tail++]=next;
      }
    }
    if(found<0)return null;
    const result:Position[]=[];
    for(let cell=found;cell!==start;cell=parents[cell]!)result.push([cell%48+0.5,this.groundY(cell%48,Math.floor(cell/48)),Math.floor(cell/48)+0.5]);
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
      const distance=Math.hypot(...next.map((v,i)=>v-c.position[i]!));
      if(distance<=remaining+1e-9){c.position=[...next];c.path.shift();remaining-=distance;this.s.metrics.distanceWalked+=distance;}
      else{for(let i=0;i<3;i++)c.position[i]!+=(next[i]!-c.position[i]!)/distance*remaining;this.s.metrics.distanceWalked+=remaining;remaining=0;}
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
  private treeBase(x:number,z:number):number{for(let y=1;y<24;y++)if(this.world.get(x,y,z)===BLOCK.Wood)return y;return-1;}
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
    const has=(type:JobType,target:string)=>this.s.jobs.some(j=>j.type===type&&j.targetId===target);
    for(const b of this.s.buildings)if(!b.complete&&!has('construct',b.id))this.addJob('construct',b.id,b.x,b.y,b.z,BUILDING_DEFS[b.kind].work,`建造${BUILDING_DEFS[b.kind].name}`);
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
      if(j.type==='haul'&&j.phase==='pickup'&&!this.s.items.some(i=>i.id===j.targetId))this.removeJob(j,true);
      if(j.type==='doctor'){const p=this.s.colonists.find(c=>c.id===j.targetId);if(!p||p.disease<=0)this.removeJob(j,true);else if(!j.assignedTo){j.x=Math.floor(p.position[0]);j.y=p.position[1];j.z=Math.floor(p.position[2]);}}
    }
  }
  private releasePerson(c:Colonist):void {
    const job=this.s.jobs.find(j=>j.id===c.jobId);
    if(job){
      job.assignedTo=null;job.state='queued';
      if(job.type==='haul'){
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
    let target:Position|null=null,path:Position[]|null=null,bed=false,reserved:Partial<Resources>={};
    const useBuildings=(kinds:BuildingKind[],excludeOccupied=false):boolean=>{
      const candidates=this.s.buildings.filter(b=>b.complete&&kinds.includes(b.kind)
        &&(!excludeOccupied||!this.s.colonists.some(p=>p!==c&&p.personal&&(p.personal.kind==='sleep'||p.personal.kind==='patient')&&p.destination?.[0]===b.x+.5&&p.destination?.[2]===b.z+.5)))
        .sort((a,b)=>Math.hypot(a.x-c.position[0],a.z-c.position[2])-Math.hypot(b.x-c.position[0],b.z-c.position[2]));
      for(const b of candidates){const pos:Position=[b.x+.5,b.y,b.z+.5],route=this.path(c.position,pos,true);if(route!==null){target=pos;path=route;return true;}}
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
    this.releasePerson(c);this.take(reserved);c.path=path;c.destination=target;c.personal={kind,elapsed:0,duration:kind==='eat'?4:kind==='wander'?16:kind==='sleep'||kind==='patient'?bed?20:40:20,reserved};
    c.task={eat:'前往用餐',sleep:'前往休息',relax:'休闲娱乐',wander:'散步调节心情',patient:'卧床休养'}[kind];return true;
  }
  private updateColonist(c:Colonist,dt:number):void {
    c.hunger=clamp(c.hunger-dt*.12);c.rest=clamp(c.rest-dt*.07);c.recreation=clamp(c.recreation-dt*.055);
    const ri=this.roomAt[Math.floor(c.position[0])+Math.floor(c.position[2])*48]??-1;
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
    c.task=c.path.length?`前往${job.label}`:job.label;
    if(!this.move(c,dt)||c.jobId!==job.id)return;
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
      .sort((a,b)=>c.priorities[a.type]-c.priorities[b.type]||Math.hypot(a.x-c.position[0],a.z-c.position[2])-Math.hypot(b.x-c.position[0],b.z-c.position[2]));
    for(const job of options){
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
      if(!this.route(c,target,adjacent)){job.state='blocked';continue;}
      this.take(cost);for(const r of RESOURCE_TYPES)if(cost[r])job.reserved[r]=(job.reserved[r]??0)+cost[r]!;
      job.assignedTo=c.id;job.state='working';c.jobId=job.id;
      if(job.type==='haul'){const item=this.s.items.find(i=>i.id===job.targetId)!;item.reservedBy=job.id;}
      return true;
    }return false;
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
    if(job.type==='construct'){
      const b=this.s.buildings.find(b=>b.id===job.targetId);if(b){b.complete=true;b.progress=1;b.reserved={};this.s.metrics.built++;this.navigationDirty=true;this.event('info',`${c.name}完成了${BUILDING_DEFS[b.kind].name}。`);}
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
      const edits=[];let wood=0;
      for(let y=1;y<24;y++)if(this.world.get(job.x,y,job.z)===BLOCK.Wood){edits.push({x:job.x,y,z:job.z,block:BLOCK.Air});wood++;}
      if(wood){
        for(let z=job.z-2;z<=job.z+2;z++)for(let x=job.x-2;x<=job.x+2;x++)for(let y=Math.max(1,job.y);y<Math.min(24,job.y+8);y++)if(this.world.get(x,y,z)===BLOCK.Leaves)edits.push({x,y,z,block:BLOCK.Air});
        this.world.edit(edits);this.refreshGround();this.navigationDirty=true;this.drop('wood',wood*6,job.x,job.z);
      }
    }else if(job.type==='mine'){
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
    const barriers=new Set(this.s.buildings.filter(b=>b.complete&&(b.kind==='wall'||b.kind==='door')).map(b=>b.x+b.z*48));
    if(barriers.size<4){for(const b of this.s.buildings){b.roomId=null;b.comfort=0;}return;}
    const visited=new Uint8Array(2304);
    for(let start=0;start<2304;start++){
      if(visited[start]||barriers.has(start))continue;
      const queue=[start],cells:[number,number][]=[];visited[start]=1;let touchesEdge=false;
      for(let i=0;i<queue.length;i++){
        const cell=queue[i]!,x=cell%48,z=Math.floor(cell/48);cells.push([x,z]);
        if(x===0||z===0||x===47||z===47)touchesEdge=true;
        for(const[dx,dz]of [[1,0],[-1,0],[0,1],[0,-1]]){const nx=x+dx!,nz=z+dz!,next=nx+nz*48;if(nx<0||nz<0||nx>=48||nz>=48||visited[next]||barriers.has(next))continue;visited[next]=1;queue.push(next);}
      }
      if(touchesEdge||cells.length>120)continue;
      const id=this.rooms.length,set=new Set(cells.map(([x,z])=>x+z*48));
      const floors=this.s.buildings.filter(b=>b.complete&&b.kind==='floor'&&set.has(b.x+b.z*48)).length;
      const furnishing=this.s.buildings.filter(b=>b.complete&&['bed','table','medicalBed'].includes(b.kind)&&set.has(b.x+b.z*48)).length;
      const comfort=Math.min(100,35+floors/cells.length*40+furnishing*7);
      const room:RoomView={id,cells,enclosed:true,comfort,temperature:this.s.temperature*.4+21*.6};this.rooms.push(room);
      for(const[x,z]of cells)this.roomAt[x+z*48]=id;
    }
    for(const b of this.s.buildings){const room=this.roomAt[b.x+b.z*48]??-1;b.roomId=room>=0?room:null;b.comfort=room>=0?this.rooms[room]!.comfort:0;}
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
    else{const draw=Math.min(stored,(demand-generation)*dt);stored-=draw;supplied+=draw/dt;}
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
      this.addColonist('远山',25,27,3);this.event('arrival','旅人远山希望加入和平营地。他带来新的劳动力，也需要床位与食物。');
    }
  }

  snapshot():ColonySnapshot {
    return copy({version:1,speed:this.s.speed,time:this.s.time,day:this.day(),hour:this.hour(),season:this.season(),weather:this.s.weather,temperature:this.s.temperature,
      resources:this.s.resources,colonists:this.s.colonists.map(({path,personal,destination,retryAt,...view})=>view),buildings:this.s.buildings,zones:this.s.zones,crops:this.s.crops,
      items:this.s.items,jobs:this.s.jobs.map(({phase,resource,amount,destination,...view})=>view),rooms:this.rooms,research:this.s.research,power:this.s.power,trade:this.s.trade,
      bills:this.s.bills,events:this.s.events,metrics:this.s.metrics,selectedColonistId:this.s.selectedColonistId});
  }
  serialize():unknown{return copy(this.s);}
  load(data:unknown):void {
    const validated=this.validate(data);
    this.s=validated;this.refreshGround();this.navigationDirty=true;this.updateRooms();
  }
  private validate(data:unknown):SavedState {
    const fail=():never=>{throw new Error('殖民地存档数据不完整、损坏或版本不兼容。');};
    if(!data||typeof data!=='object')fail();
    const s=copy(data) as SavedState;
    const finite=(n:unknown,min=0,max=1e9)=>typeof n==='number'&&Number.isFinite(n)&&n>=min&&n<=max;
    const integer=(n:unknown,min=0,max=1e9)=>finite(n,min,max)&&Number.isInteger(n);
    const text=(x:unknown,max=200)=>typeof x==='string'&&x.length<=max;
    const list=(x:unknown,max:number)=>Array.isArray(x)&&x.length<=max;
    const position=(p:unknown)=>Array.isArray(p)&&p.length===3&&finite(p[0],0,48)&&finite(p[1],0,24)&&finite(p[2],0,48);
    const resources=(r:unknown,partial=false)=>!!r&&typeof r==='object'&&!Array.isArray(r)&&Object.keys(r).every(k=>RESOURCE_TYPES.includes(k as Resource))
      &&RESOURCE_TYPES.every(k=>partial&&(r as Resources)[k]===undefined||integer((r as Resources)[k],0,1e7));
    if(s.version!==1||s.type!=='peaceful-colony'||s.worldSeed!==this.world.seed||!finite(s.time)||!finite(s.accumulator,0,STEP)||!integer(s.rng,1,4294967295)||!integer(s.nextId,1)||!SPEEDS.includes(s.speed)||!finite(s.decision,0,1)||!integer(s.lastDay,1)||!finite(s.spoilage,0,1000))fail();
    if(!resources(s.resources)||!list(s.colonists,20)||s.colonists.length<1||!list(s.buildings,2304)||!list(s.zones,256)||!list(s.crops,2304)||!list(s.items,5000)||!list(s.jobs,6000)||!list(s.events,80))fail();
    const unique=(rows:{id:string}[])=>{const ids=new Set<string>();for(const row of rows){if(!row||!text(row.id,80)||!row.id||ids.has(row.id))fail();ids.add(row.id);}return ids;};
    const colonistIds=unique(s.colonists),buildingIds=unique(s.buildings),cropIds=unique(s.crops),itemIds=unique(s.items),jobIds=unique(s.jobs);unique(s.zones);unique(s.events);
    const location=(r:{x:number;y:number;z:number})=>integer(r.x,0,47)&&integer(r.z,0,47)&&finite(r.y,0,24);
    for(const c of s.colonists){
      if(!text(c.name,40)||!list(c.traits,10)||!c.traits.every(t=>text(t,40))||!position(c.position)||!position(c.color)||!['balanced','day','night','rest'].includes(c.schedule)
        ||!['health','hunger','rest','recreation','mood','disease','comfort'].every(k=>finite(c[k as keyof Colonist],0,100))||!text(c.task)||!resources(c.carrying,true)
        ||!list(c.path,2304)||!c.path.every(position)||c.destination!==null&&!position(c.destination)||!finite(c.retryAt)||!c.skills||!c.priorities
        ||!JOB_TYPES.every(j=>finite(c.skills[j],0,20)&&integer(c.priorities[j],0,4))||c.jobId!==null&&!jobIds.has(c.jobId))fail();
      if(c.personal&&(!['eat','sleep','relax','wander','patient'].includes(c.personal.kind)||!finite(c.personal.elapsed)||!finite(c.personal.duration,0,1000)||!resources(c.personal.reserved,true)))fail();
      for(let i=1;i<c.path.length;i++)if(horizontalDistance(c.path[i-1]!,c.path[i]!)>1.01||Math.abs(c.path[i-1]![1]-c.path[i]![1])>1.01)fail();
    }
    const occupied=new Set<string>();
    for(const b of s.buildings){const key=`${b.x},${b.z}`;if(!location(b)||!(b.kind in BUILDING_DEFS)||typeof b.complete!=='boolean'||!finite(b.progress,0,1)||!resources(b.reserved,true)||typeof b.powered!=='boolean'||!finite(b.comfort,0,100)||b.roomId!==null&&!integer(b.roomId,0,2304)||occupied.has(key))fail();occupied.add(key);if(b.complete&&Object.keys(b.reserved).length)fail();}
    for(const z of s.zones)if(!location(z)||!['farm','stockpile'].includes(z.kind)||!integer(z.w,1,12)||!integer(z.d,1,12)||z.x+z.w>48||z.z+z.d>48||!['rice','corn'].includes(z.crop))fail();
    for(const p of s.crops)if(!location(p)||!['rice','corn'].includes(p.kind)||typeof p.planted!=='boolean'||!finite(p.growth,0,1))fail();
    for(const item of s.items)if(!location(item)||!RESOURCE_TYPES.includes(item.resource)||!integer(item.amount,1,1e7)||!finite(item.age)||item.reservedBy!==null&&!jobIds.has(item.reservedBy))fail();
    for(const j of s.jobs){
      if(!location(j)||!JOB_TYPES.includes(j.type)||!text(j.targetId,80)||!finite(j.progress)||!finite(j.work,.01,10000)||!['queued','working','blocked'].includes(j.state)||j.assignedTo!==null&&!colonistIds.has(j.assignedTo)||!resources(j.reserved,true)||!text(j.label)||!['work','pickup','deliver'].includes(j.phase)||!integer(j.amount,0,10000)||j.destination!==null&&!position(j.destination)||j.resource!==undefined&&!RESOURCE_TYPES.includes(j.resource))fail();
      if(j.type==='construct'&&!buildingIds.has(j.targetId)||['grow','harvest'].includes(j.type)&&!cropIds.has(j.targetId)||j.type==='haul'&&j.phase==='pickup'&&!itemIds.has(j.targetId)||j.type==='doctor'&&!colonistIds.has(j.targetId)||j.type==='research'&&!RESEARCH_DEFS[j.targetId])fail();
      if(j.assignedTo&&s.colonists.find(c=>c.id===j.assignedTo)?.jobId!==j.id)fail();
    }
    if(!s.research||!list(s.research.completed,10)||!s.research.completed.every(id=>!!RESEARCH_DEFS[id])||new Set(s.research.completed).size!==s.research.completed.length||s.research.active!==null&&!RESEARCH_DEFS[s.research.active]||!s.research.progress||Object.entries(s.research.progress).some(([id,p])=>!RESEARCH_DEFS[id]||!finite(p,0,RESEARCH_DEFS[id]!.work)))fail();
    if(!s.power||!['generation','demand','stored','capacity','supplied'].every(k=>finite(s.power[k as keyof typeof s.power]))||typeof s.power.coldStorage!=='boolean'||s.power.stored>s.power.capacity+1e-6)fail();
    if(!s.trade||typeof s.trade.available!=='boolean'||!finite(s.trade.leavesAt)||!resources(s.trade.stock)||!resources(s.trade.prices)||!s.bills||!['meal','medicine','components'].every(k=>integer(s.bills[k as keyof typeof s.bills],0,200)))fail();
    if(!s.metrics||!Object.values(s.metrics).every(v=>finite(v))||!text(s.weather,20)||!['晴朗','多云','细雨','热浪','寒潮'].includes(s.weather)||!finite(s.temperature,-40,70)||s.selectedColonistId!==null&&!colonistIds.has(s.selectedColonistId))fail();
    for(const e of s.events)if(!finite(e.time)||!integer(e.day,1)||!finite(e.hour,0,24)||!text(e.text,300)||!['info','weather','health','trade','research','arrival'].includes(e.type))fail();
    return s;
  }
}
