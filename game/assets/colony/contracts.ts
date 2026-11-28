import { sugarPress } from './sugar-press.ts';
import { SPECIALIST_BASE_PRICES } from './specialist-catalog.ts';
import type { Pasture } from './pasture.ts';
export type Position = [number, number, number];
export const CROP_TYPES = ['wheat','corn','blueberry','sugarcane','cabbage','leek','potato','tomato'] as const;
export const DISH_TYPES = ['friedEgg','bread','salad','pasta','pancake','blueberryPie','pizza','perfectBreakfast','lambChopStew'] as const;
export const SUPPLY_TYPES = ['sugar','flour','oil','blueberryWine','cheese','milk','egg','wool','chickenMeat','mutton','beef','pork'] as const;
export type SupplyType = typeof SUPPLY_TYPES[number];
export const isSupplyType = (value: unknown): value is SupplyType => (SUPPLY_TYPES as readonly unknown[]).includes(value);
const SEEDED_CROP_KINDS = ['cabbage', 'tomato', 'sugarcane', 'wheat', 'potato', 'leek', 'corn'] as const;
export const CROP_KINDS = [...SEEDED_CROP_KINDS, 'blueberry'] as const;
export type CropKind = typeof CROP_KINDS[number];
export const DEFAULT_CROP: CropKind = 'cabbage';
export const isCropKind = (value: unknown): value is CropKind => (CROP_KINDS as readonly unknown[]).includes(value);
export type CropSeed = `${typeof SEEDED_CROP_KINDS[number]}Seed`;
const cropSeed = (crop: typeof SEEDED_CROP_KINDS[number]): CropSeed => `${crop}Seed`;
export const CROP_SEEDS = SEEDED_CROP_KINDS.map(cropSeed);
export const cropPlantingItem = (crop: CropKind): CropSeed | 'blueberry' => crop === 'blueberry' ? crop : cropSeed(crop);
export const cropForPlantingItem = (item: unknown): CropKind | undefined =>
  CROP_KINDS.find(crop => cropPlantingItem(crop) === item);
export const isCropSeed = (value: unknown): value is CropSeed => (CROP_SEEDS as readonly unknown[]).includes(value);
export const RESOURCE_TYPES = [
  'wood','stone','steel','food','meal','medicine','cloth','silver','components',
  ...CROP_TYPES, ...CROP_SEEDS, ...DISH_TYPES, ...SUPPLY_TYPES, 'dirt', 'pigIron', 'plank', 'stoneBrick',
] as const;
export type CropType = typeof CROP_TYPES[number];
export type DishType = typeof DISH_TYPES[number];
export type Resource = typeof RESOURCE_TYPES[number];
export const isResource = (item: unknown): item is Resource => (RESOURCE_TYPES as readonly unknown[]).includes(item);
export type Resources = Record<Resource, number>;
export const PLAYER_SLOTS = 9, CHEST_SLOTS = 20, STACK_LIMIT = 99, CHEST_WOOD_COST = 4;
export const SHELF_BAYS = 6, STORAGE_QUARTERS = 4, WAREHOUSE_STACK_LIMIT = 32, HAUL_LIMIT = 12;
export const PLAYER_DELIVERY_TARGET = 'player-delivery';
export const HAMMER = 'hammer', AXE = 'axe', PICKAXE = 'pickaxe', PLAYER_BUILD_MULTIPLIER = 2, PLAYER_BUILD_REACH = 3;
/** 工具不是 Resource，但要走同一条搬运/存档流程。加新工具时只往这里加。 */
export const TOOL_KINDS = [HAMMER, AXE, PICKAXE] as const;
export type ToolKind = typeof TOOL_KINDS[number];
export type BuildingItem = `building:${BuildingKind}`;
export type InventoryItem = Resource | ToolKind | BuildingItem;
export const isToolKind = (item: unknown): item is ToolKind => (TOOL_KINDS as readonly unknown[]).includes(item);
export const TOOL_NAMES: Record<ToolKind,string> = {hammer:'锤子',axe:'木斧',pickaxe:'石镐'};

/**
 * 玩家砍树的参数。
 * 时间按「真实秒」算，和随从那套 work/workRate 是两套（玩家不受技能影响）。
 */
/** 一棵树的总工作量。随从和玩家算的是同一个数。 */
export const CHOP_WORK = 16;
export const workPercent = (progress: number, total: number): number =>
  Math.floor(Math.min(1, Math.max(0, progress / total)) * 100);
export const PLAYER_CHOP_SECONDS = 6;          // 空手砍完一棵
export const PLAYER_CHOP_SECONDS_AXE = 4;      // 木斧
export const RESIDENT_RADIUS = .28;
export const RESIDENT_HEIGHT = 1.8;
export const PLAYER_WORK_REACH = 1;            // 角色到目标格中心的水平圆形半径。
export const PLAYER_CHOP_STAMINA = 12;         // 空手砍一棵扣多少体力
export const PLAYER_CHOP_STAMINA_AXE = 8;      // 木斧扣得少
export const PLAYER_STAMINA_REGEN = 2;         // 静立每秒回多少
/** 掉落物落地的 0.5 秒内不许捡：看得见它弹一下，而不是瞬间消失。 */
export const ITEM_PICKUP_DELAY = 0.5;
/** 玩家自动拾取的水平距离（格）。 */
export const ITEM_PICKUP_RANGE = 1.2;
/** 随从砍一棵树扣多少体力（不管快慢，按棵算）。 */
export const COLONIST_CHOP_STAMINA = 8;
export type ColdMark = { premium?: { day: number; count: number } };
export type FreezeLot = { since: number; count: number };
export type ItemStack = { resource: Resource; count: number };
export type InventorySlot = ItemStack | null;
export type PlayerInventorySlot = ({ resource: InventoryItem; count: number } & ColdMark) | null;
export const inventorySpace = (slots: readonly PlayerInventorySlot[], resource: InventoryItem): number =>
  isToolKind(resource) ? Number(slots.includes(null) && !slots.some(slot => slot?.resource === resource))
    : slots.reduce((total, slot) => total + (slot === null ? STACK_LIMIT : slot.resource === resource ? STACK_LIMIT - slot.count : 0), 0);
export type InventoryLocation =
  | { kind: 'warehouse' }
  | { kind: 'player'; id?: string; slot?: number }
  | { kind: 'chest'; id: string; slot: number }
  | { kind: 'follower'; id: string; slot?: number }
  | { kind: 'cargo'; id: string };
export interface ChestView { id: string; x: number; z: number; slots: PlayerInventorySlot[] }
export const RESOURCE_NAMES: Record<Resource,string> = {
  wood:'木材',stone:'石材',steel:'钢铁',food:'生食',meal:'熟食',medicine:'药品',cloth:'布料',silver:'银币',components:'零件',dirt:'泥土',
  pigIron:'生铁',plank:'木板',stoneBrick:'石砖',
  wheat:'小麦',corn:'玉米',blueberry:'蓝莓',sugarcane:'甘蔗',cabbage:'白菜',leek:'韭葱',potato:'土豆',tomato:'番茄',
  cabbageSeed:'白菜种子包', tomatoSeed:'番茄种子包', sugarcaneSeed:'甘蔗种子包',
  wheatSeed:'小麦种子包', potatoSeed:'土豆种子包', leekSeed:'韭葱种子包', cornSeed:'玉米种子包',
  friedEgg:'煎鸡蛋',bread:'面包',salad:'沙拉',pasta:'意大利面',pancake:'薄煎饼',blueberryPie:'蓝莓千层酥',pizza:'披萨',perfectBreakfast:'完美早餐',lambChopStew:'炖羊排',
  sugar:'糖',flour:'面粉',oil:'油',blueberryWine:'蓝莓酒',cheese:'奶酪',
  milk:'牛奶',egg:'鸡蛋',wool:'羊毛',chickenMeat:'鸡肉',mutton:'生羊肉',beef:'牛肉',pork:'生猪肉',
};

/** 售卖价（照飞书表）。农作物统一 10，料理按表。 */
export const RESOURCE_PRICES: Partial<Record<Resource, number>> = {
  ...Object.fromEntries(CROP_SEEDS.map(seed => [seed,1])), ...SPECIALIST_BASE_PRICES, cloth:8,
  wheat:10,corn:10,blueberry:10,sugarcane:10,cabbage:10,leek:10,potato:10,tomato:10,
  friedEgg:35,bread:60,salad:110,pasta:120,pancake:80,blueberryPie:150,pizza:300,perfectBreakfast:350,
};
const foodForCooling = new Set<InventoryItem>(['food','meal',...CROP_TYPES,...DISH_TYPES,...SUPPLY_TYPES.filter(r => r !== 'wool')]);
export function coldEffect(resource: InventoryItem) {
  if (resource === 'milk' || resource === 'blueberryWine') return '冰镇';
  return foodForCooling.has(resource) ? '保鲜' : undefined;
}
export const STORAGE_CLASSES = {general:'普通仓', food:'食材仓', materials:'建材仓'} as const;
export type StorageClass = keyof typeof STORAGE_CLASSES;
export interface BuildingView {
  /** World-space +X,+Z,-X,-Z bits. Derived for display, never required in a save. */
  connections?:number;
  mining?: {resource:'stone'|'pigIron'; remaining:number; status:string};
  storageClass?: StorageClass }
export interface BuildingView {
  /** The standing structure while residents convert a fence section into a gate or back. */
  previousBoundary?: {kind:'fence'|'pastureGate';rotation:BuildingRotation};
}
export interface ZoneView { storageClass?: StorageClass }
export const isStorageClass = (value:unknown):value is StorageClass =>
  typeof value === 'string' && Object.hasOwn(STORAGE_CLASSES,value);
const constructionStock = new Set<Resource>(['wood','plank','stone','stoneBrick','steel','pigIron','cloth','components','dirt']);
export function storageClassFor(resource:Resource):StorageClass {
  if (foodForCooling.has(resource)) return 'food';
  return constructionStock.has(resource) ? 'materials' : 'general';
}
export function premiumCount(stock: ColdMark | null | undefined, day: number) {
  return stock?.premium?.day === day ? stock.premium.count : 0;
}
/** 同一叠可以混有普通品；只计算有效件数的加价，不在这里舍入银币。 */
export function coldSaleValue(baseUnitPrice: number, count: number, stock: ColdMark, day: number) {
  return coldSaleSubtotal(baseUnitPrice, count, premiumCount(stock, day));
}
export function coldSaleSubtotal(baseUnitPrice: number, count: number, effectiveCount: number) {
  return baseUnitPrice * (count + Math.min(count, effectiveCount) / 5);
}
export const JOB_TYPES = ['terraform','construct','grow','harvest','haul','cook','chop','mine','research','doctor','craft'] as const;
export type JobType = typeof JOB_TYPES[number];
export type OrderType = JobType | 'demolish'|'herd'|'husbandry';
export const JOB_NAMES: Record<OrderType,string> = {herd:'领动物',husbandry:'采集畜产',terraform:'整地',construct:'建造',demolish:'拆除',grow:'种植',harvest:'收获',haul:'搬运',cook:'烹饪',chop:'伐木',mine:'采矿',research:'研究',doctor:'医疗',craft:'制作'};
export type BuildingKind =
  | 'extractionStation' | 'sugarPress'
  // 原有 12 种
  | 'bed'|'table'|'stove'|'workbench'|'researchDesk'|'solar'|'battery'|'cooler'|'medicalBed'|'wall'|'door'|'floor'
  // 结构类（飞书「结构类」表）——木门/石墙沿用已有的 door/wall
  | 'woodWall'|'brickWall'|'stoneDoor'|'autoDoor'|'fence'
  // 家具类——单人床沿用 bed、餐桌沿用 table
  | 'chest'|'bedroll'|'doubleBed'|'chair'|'stool'|'shelf'|'planter'|'painting'|'sculpture'|'vase'
  | 'campfire'|'campfirePlaza'|'torch'|'floorLamp'|'chandelier'
  // 生产类——炉灶沿用 stove、研究台沿用 researchDesk
  | 'campStove'|'carpenterBench'|'stoneCutter'|'forgery'|'fabricator'|'tailorBench'|'pickleBarrel'|'brewBarrel'|'cheesePress'
  | 'advancedResearchDesk'|'artBench'|'flourMill'|'pastureGate'|'milker'|'henNest'
  // 农业类——种植区是区域标记，不走建筑
  | 'shearingStand'|'loom'
  | 'hydroponics'|'sprinkler'|'greenhouseWall'|'scarecrow'|'compostBin';
export type BuildingCategory = 'structure'|'furniture'|'production'|'agriculture'|'core';
export type BuildingRotation = 0|1|2|3;
export interface BuildingDefinition { id: BuildingKind; name: string; description: string; cost: Partial<Resources>; work: number; research?: string; power: number; blocking: boolean; color: [number,number,number]; footprint?:[number,number]; height?:number; category?: BuildingCategory; storageSlots?:number }
export const BUILDING_DEFS: Record<BuildingKind,BuildingDefinition> = {
  sugarPress,
  extractionStation:{id:'extractionStation',name:'采集站',description:'建在石料点或铁矿点上。居民携石镐分批采出，由搬运员送仓。',cost:{wood:8},work:12,power:0,blocking:true,color:[.62,.48,.32],category:'production'},
  pastureGate:{id:'pastureGate',name:'牧场门',description:'供居民领动物进出。',cost:{wood:3},work:4,power:0,blocking:false,color:[.6,.39,.2],category:'structure'},
  milker:{id:'milker',name:'挤奶器',description:'在牧场内为成年母牛挤奶。',cost:{wood:6,steel:2},work:12,power:0,blocking:true,color:[.7,.75,.7],category:'agriculture'},
  henNest:{id:'henNest',name:'鸡窝',description:'居民在巢内收取母鸡产下的蛋。',cost:{wood:4},work:6,power:0,blocking:true,color:[.73,.59,.27],category:'agriculture'},
  shearingStand:{id:'shearingStand',name:'剪毛台',description:'建在牧场内。每只成年羊每天可剪出 2 份羊毛。',cost:{wood:6},work:8,power:0,blocking:true,color:[.68,.47,.29],category:'agriculture'},
  loom:{id:'loom',name:'织布机',description:'居民手工将 2 份羊毛织成 1 份布料。',cost:{wood:12},work:14,power:0,blocking:true,color:[.59,.40,.24],footprint:[2,1],category:'production'},
  campfirePlaza:{id:'campfirePlaza',name:'篝火晚会广场',description:'居民整地、搭台设宴。完工当晚，全村围火相聚。',footprint:[26,22],height:4,cost:{},work:72,power:0,blocking:false,color:[.86,.52,.23],category:'core'},
  bed:{id:'bed',name:'木床',description:'为居民提供安稳睡眠。',cost:{plank:24,cloth:3},work:18,power:0,blocking:true,color:[0.60,0.42,0.23],footprint:[1,2]},
  table:{id:'table',name:'餐桌',description:'就餐与休闲，改善心情。',cost:{plank:30},work:16,power:0,blocking:true,color:[0.64,0.44,0.23]},
  stove:{id:'stove',name:'炉灶',description:'村民按制作清单烹饪料理。',cost:{stoneBrick:8,steel:6},work:24,power:0,blocking:true,color:[0.40,0.43,0.44]},
  workbench:{id:'workbench',name:'工作台',description:'研究后可按制作清单加工零件。',cost:{plank:40,steel:10},work:28,power:0,blocking:true,color:[0.58,0.40,0.23],footprint:[2,1]},
  researchDesk:{id:'researchDesk',name:'研究桌',description:'分配研究项目，由居民逐步研究。',cost:{plank:40,steel:8},work:25,power:0,blocking:true,color:[0.40,0.49,0.55]},
  solar:{id:'solar',name:'太阳能板',description:'晴天白昼发电，阴雨天减产。',cost:{steel:22,components:2},work:36,research:'electricity',power:-120,blocking:true,color:[0.19,0.35,0.55]},
  battery:{id:'battery',name:'蓄电池',description:'保存白天余电，在夜间供电。',cost:{steel:16,components:2},work:30,research:'electricity',power:0,blocking:true,color:[0.40,0.47,0.29]},
  cooler:{id:'cooler',name:'冷藏机',description:'消耗 45 W。仓储食物、饮品连续冷藏满一天后获得保鲜或冰镇，售价提高 20%，到次日零点失效。',cost:{steel:18,components:3},work:35,research:'refrigeration',power:45,blocking:true,color:[0.59,0.72,0.73]},
  medicalBed:{id:'medicalBed',name:'医护床',description:'病人休养并接受医护治疗。',cost:{plank:36,steel:6,cloth:8},work:30,research:'medicine',power:0,blocking:true,color:[0.80,0.85,0.79],footprint:[1,2]},
  wall:{id:'wall',name:'石墙',description:'原石砌成的厚墙，连续墙面可形成嵌窗。',cost:{stone:5},work:9,power:0,blocking:true,color:[0.61,0.63,0.57],height:2,category:'structure'},
  door:{id:'door',name:'木门',description:'上下两格组成一扇门。打开通行，关闭围合房间。',cost:{wood:8},work:12,power:0,blocking:true,color:[0.54,0.36,0.20],height:2,category:'structure'},
  floor:{id:'floor',name:'木地板',description:'可通行，提升封闭房间舒适度。',cost:{wood:3},work:5,power:0,blocking:false,color:[0.70,0.52,0.31],category:'structure'},

  // ---- 结构类（占位符：颜色区分，形状统一） ----
  woodWall:{id:'woodWall',name:'木墙',description:'木质隔断，成本低。',cost:{wood:5},work:8,power:0,blocking:true,color:[0.62,0.45,0.26],height:2,category:'structure'},
  brickWall:{id:'brickWall',name:'砖墙',description:'黏土砖砌成，耐久。',cost:{stoneBrick:4},work:11,power:0,blocking:true,color:[0.66,0.42,0.34],height:2,category:'structure'},
  stoneDoor:{id:'stoneDoor',name:'石门',description:'石门，通行与围合。',cost:{stoneBrick:5,stone:2},work:14,power:0,blocking:true,color:[0.58,0.60,0.55],height:2,category:'structure'},
  autoDoor:{id:'autoDoor',name:'自动门',description:'感应开合，需要电力。',cost:{steel:12,components:2},work:20,research:'electricity',power:8,blocking:true,color:[0.52,0.58,0.62],height:2,category:'structure'},
  fence:{id:'fence',name:'栅栏',description:'轻质围挡，划分地块。',cost:{wood:3},work:4,power:0,blocking:true,color:[0.70,0.56,0.34],category:'structure'},

  // ---- 家具类 ----
  chest:{id:'chest',name:'木箱',description:`独立储物 · ${CHEST_SLOTS} 格`,cost:{wood:CHEST_WOOD_COST},work:8,power:0,blocking:false,color:[0.60,0.42,0.23],category:'furniture',storageSlots:CHEST_SLOTS},
  bedroll:{id:'bedroll',name:'地铺',description:'最简陋的睡眠点。',cost:{cloth:4},work:6,power:0,blocking:true,color:[0.68,0.58,0.42],category:'furniture'},
  doubleBed:{id:'doubleBed',name:'双人床',description:'两位居民同住，节省空间。',cost:{plank:44,cloth:6},work:26,power:0,blocking:true,color:[0.60,0.42,0.23],footprint:[2,2],category:'furniture'},
  chair:{id:'chair',name:'椅子',description:'就餐与休闲。',cost:{plank:12},work:8,power:0,blocking:true,color:[0.64,0.44,0.23],category:'furniture'},
  stool:{id:'stool',name:'凳子',description:'最简单的座位。',cost:{wood:3},work:4,power:0,blocking:true,color:[0.66,0.47,0.27],category:'furniture'},
  shelf:{id:'shelf',name:'储物架',description:`自动规划为仓储区 · ${SHELF_BAYS} 个分区，每区可按体积放置物资。`,cost:{plank:28},work:16,power:0,blocking:true,color:[0.56,0.39,0.22],footprint:[2,1],height:2,category:'furniture'},
  planter:{id:'planter',name:'盆栽',description:'室内绿植，提升心情。',cost:{plank:12,stone:2},work:8,power:0,blocking:true,color:[0.42,0.60,0.36],category:'furniture'},
  painting:{id:'painting',name:'挂画',description:'墙上装饰，提升心情。',cost:{plank:10,cloth:2},work:10,power:0,blocking:false,color:[0.72,0.56,0.38],category:'furniture'},
  sculpture:{id:'sculpture',name:'雕塑',description:'艺术台产物，大幅提升心情。',cost:{stoneBrick:6},work:22,power:0,blocking:true,color:[0.72,0.70,0.64],category:'furniture'},
  vase:{id:'vase',name:'花瓶',description:'陶制摆设。',cost:{stoneBrick:2},work:6,power:0,blocking:true,color:[0.76,0.62,0.46],category:'furniture'},
  campfire:{id:'campfire',name:'篝火',description:'夜间照明与聚会。',cost:{wood:8,stone:4},work:8,power:0,blocking:true,color:[0.85,0.48,0.20],category:'furniture'},
  torch:{id:'torch',name:'火把',description:'廉价照明。',cost:{wood:2},work:2,power:0,blocking:false,color:[0.88,0.56,0.24],category:'furniture'},
  floorLamp:{id:'floorLamp',name:'落地灯',description:'照明，需要电力。',cost:{steel:6,components:1},work:12,research:'electricity',power:6,blocking:true,color:[0.86,0.80,0.52],category:'furniture'},
  chandelier:{id:'chandelier',name:'吊灯',description:'大厅照明，耗电较高。',cost:{steel:10,components:2},work:18,research:'electricity',power:12,blocking:false,color:[0.90,0.84,0.58],category:'furniture'},

  // ---- 生产类 ----
  carpenterBench:{id:'carpenterBench',name:'木工台',description:'把木材加工成木板。',cost:{wood:10,stone:4},work:14,power:0,blocking:true,color:[0.62,0.45,0.27],footprint:[2,1],category:'production'},
  flourMill:{id:'flourMill',name:'面粉机',description:'居民用手摇石磨把 2 份小麦磨成 1 份面粉。',cost:{wood:10,stone:8},work:14,power:0,blocking:true,color:[0.59,0.56,0.49],footprint:[2,1],category:'production'},
  campStove:{id:'campStove',name:'篝火灶台',description:'早期烹饪，效率低。',cost:{plank:20,stone:6},work:10,power:0,blocking:true,color:[0.80,0.50,0.24],category:'production'},
  stoneCutter:{id:'stoneCutter',name:'切石台',description:'石块加工成石砖。',cost:{plank:24,stone:8},work:16,power:0,blocking:true,color:[0.62,0.64,0.58],category:'production'},
  forgery:{id:'forgery',name:'锻造台',description:'将生铁加工成钢铁。',cost:{stoneBrick:10,pigIron:12},work:26,power:0,blocking:true,color:[0.48,0.50,0.52],category:'production'},
  fabricator:{id:'fabricator',name:'机械加工台',description:'制作零件。',cost:{steel:18,components:4},work:32,research:'electricity',power:20,blocking:true,color:[0.44,0.52,0.58],category:'production'},
  tailorBench:{id:'tailorBench',name:'裁缝台',description:'缝制衣物。',cost:{plank:24,steel:4,cloth:6},work:20,power:0,blocking:true,color:[0.66,0.52,0.62],category:'production'},
  pickleBarrel:{id:'pickleBarrel',name:'腌制桶',description:'果蔬腌制成腌菜。',cost:{plank:28},work:18,power:0,blocking:true,color:[0.58,0.44,0.28],category:'production'},
  brewBarrel:{id:'brewBarrel',name:'酿酒桶',description:'发酵酿酒。',cost:{plank:32},work:22,power:0,blocking:true,color:[0.52,0.38,0.26],category:'production'},
  cheesePress:{id:'cheesePress',name:'奶酪机',description:'牛奶加工成奶酪。',cost:{plank:16,steel:10},work:20,power:0,blocking:true,color:[0.78,0.72,0.50],category:'production'},
  advancedResearchDesk:{id:'advancedResearchDesk',name:'高级研究台',description:'研究速度更快。',cost:{steel:16,stoneBrick:6,components:3},work:34,research:'electricity',power:10,blocking:true,color:[0.36,0.46,0.54],category:'production'},
  artBench:{id:'artBench',name:'艺术台',description:'雕刻雕塑与装饰。',cost:{plank:28,stoneBrick:3},work:24,power:0,blocking:true,color:[0.68,0.56,0.42],category:'production'},

  // ---- 农业类 ----
  hydroponics:{id:'hydroponics',name:'水培盆',description:'室内快速种植，需要电力。',cost:{steel:10,components:2},work:22,research:'agriculture',power:14,blocking:true,color:[0.42,0.66,0.46],category:'agriculture'},
  sprinkler:{id:'sprinkler',name:'灌溉花洒',description:'自动浇水。',cost:{steel:6,components:1},work:14,power:4,blocking:false,color:[0.50,0.70,0.78],category:'agriculture'},
  greenhouseWall:{id:'greenhouseWall',name:'温室墙',description:'透光墙体，维持室温。',cost:{plank:4,steel:4},work:10,power:0,blocking:true,color:[0.76,0.86,0.82],height:2,category:'agriculture'},
  scarecrow:{id:'scarecrow',name:'稻草人',description:'防鸟，减少作物损失。',cost:{plank:12,cloth:2},work:12,power:0,blocking:true,color:[0.74,0.62,0.36],category:'agriculture'},
  compostBin:{id:'compostBin',name:'堆肥箱',description:'秸秆转化成肥料。',cost:{plank:20},work:16,power:0,blocking:true,color:[0.50,0.42,0.28],category:'agriculture'},
};
export function buildingItemKind(item: string | undefined): BuildingKind | undefined {
  if (!item?.startsWith('building:')) return;
  const kind = item.slice('building:'.length);
  if (Object.hasOwn(BUILDING_DEFS, kind)) return kind as BuildingKind;
}

export function itemName(item: InventoryItem): string {
  if (isToolKind(item)) return TOOL_NAMES[item];
  if (isResource(item)) return RESOURCE_NAMES[item];
  const kind = buildingItemKind(item);
  return kind ? BUILDING_DEFS[kind].name : item;
}

export interface ResearchDefinition {id:string;name:string;description:string;work:number;requires?:string;unlocks:string[]}
export const RESEARCH_DEFS: Record<string,ResearchDefinition> = {
  agriculture:{id:'agriculture',name:'精耕农业',description:'解锁玉米和更高产的种植方式。',work:90,unlocks:['corn']},
  electricity:{id:'electricity',name:'基础电力',description:'解锁太阳能板与蓄电池。',work:110,unlocks:['solar','battery']},
  refrigeration:{id:'refrigeration',name:'食物冷藏',description:'解锁冷藏机，为食物保鲜、为饮品冰镇。',work:130,requires:'electricity',unlocks:['cooler']},
  medicine:{id:'medicine',name:'基础医学',description:'解锁医护床并改善治疗效果。',work:100,unlocks:['medicalBed']},
  fabrication:{id:'fabrication',name:'精密制作',description:'解锁工作台零件配方。',work:140,requires:'electricity',unlocks:['components']},
};
export const SCHEDULES = {balanced:'均衡作息',day:'日班',night:'夜班',rest:'休养'} as const;
export type Schedule = keyof typeof SCHEDULES;
export const CROP_DEFS: Record<CropKind, {
  name: string;
  produce: Resource;
  growthSeconds: number;
  yieldCount: number;
  requires?: string;
}> = {
  cabbage: { name: RESOURCE_NAMES.cabbage, produce: 'cabbage', growthSeconds: 115, yieldCount: 6 },
  tomato: { name: RESOURCE_NAMES.tomato, produce: 'tomato', growthSeconds: 115, yieldCount: 6 },
  sugarcane: { name: RESOURCE_NAMES.sugarcane, produce: 'sugarcane', growthSeconds: 115, yieldCount: 6 },
  wheat: { name: RESOURCE_NAMES.wheat, produce: 'wheat', growthSeconds: 115, yieldCount: 6 },
  potato: { name: RESOURCE_NAMES.potato, produce: 'potato', growthSeconds: 115, yieldCount: 6 },
  leek: { name: RESOURCE_NAMES.leek, produce: 'leek', growthSeconds: 115, yieldCount: 6 },
  corn: { name: RESOURCE_NAMES.corn, produce: 'corn', growthSeconds: 200, yieldCount: 12, requires: 'agriculture' },
  blueberry: { name: RESOURCE_NAMES.blueberry, produce: 'blueberry', growthSeconds: 115, yieldCount: 6 },
};
export interface ColonyCommand {action:string;value?:unknown;kind?:string;x?:number;y?:number;z?:number;rotation?:number;w?:number;d?:number;cells?:[number,number][];id?:string;colonistId?:string;job?:string;target?:number;crop?:string;recipe?:string;amount?:number}
export interface CommandResult {ok:boolean;message:string;id?:string}
export type MerchantId = 'guide' | import('./specialist-catalog.ts').SpecialistId;
export interface ColonyCommand { merchantId?: MerchantId }
export type MerchantHousing = Omit<import('./guide-housing.ts').GuideHousing,'npcId'> & {npcId:MerchantId};
export interface SpecialistMerchantView {
  id: import('./specialist-catalog.ts').SpecialistId;
  sold:number;
  arrivalDay:number|null;
  status:'locked'|'scheduled'|'arrived';
  housing:MerchantHousing|null;
}
export interface SpecialistMarketView {
  flags?: Partial<Record<MerchantId, Position>>;
  availableRooms:{roomId:number;bedId:string;position:Position;comfort:number;cleanliness:number}[];
  merchants:SpecialistMerchantView[];
  events:import('./market-calendar.ts').MarketEvent[];
}
export type MapToolMenu = 'build' | 'plan' | 'residents';
export interface ColonistView {id:string;name:string;traits:string[];skills:Record<JobType,number>;priorities:Record<JobType,number>;schedule:Schedule;position:Position;health:number;hunger:number;rest:number;recreation:number;mood:number;disease:number;task:string;jobId:string|null;color:Position;carrying:Partial<Resources>;bag:PlayerInventorySlot[];bagSelected:number;stamina:number;facing:number;comfort:number}
export interface BuildingView {id:string;kind:BuildingKind;x:number;y:number;z:number;w:number;h:number;d:number;rotation:BuildingRotation;doorOpen?:boolean;phase:'preparingTerrain'|'readyToBuild'|'constructing'|'completed';terrainPlanId?:string;blockedReason?:string;complete:boolean;progress:number;reserved:Partial<Resources>;powered:boolean;comfort:number;roomId:number|null;storage?:PlayerInventorySlot[]}
export interface TerrainPlanView {id:string;target:number;cells:[number,number][];remainingCut:number;remainingFill:number;progress:number;state:'queued'|'working'|'blocked'|'completed';blockedReason?:string;buildingId?:string}
export interface ZoneView {id:string;kind:'farm'|'stockpile'|'pasture';pasture?:Pasture;x:number;y:number;z:number;w:number;d:number;crop:CropKind;shelfId?:string;cells?:[number,number][]}
export type WarehouseSlot = {x:number;z:number;slot:number;shelfId?:string};
export type StoredStack = WarehouseSlot & ColdMark & {resource:Resource;count:number; freezing?:FreezeLot[]};
export interface CropView {id:string;kind:CropKind;x:number;y:number;z:number;growth:number;planted:boolean}
export interface ItemView extends ColdMark {id:string;resource:InventoryItem;amount:number;x:number;y:number;z:number;age:number;reservedBy:string|null;scatter?:boolean;playerOnly?:boolean}
export interface JobView {id:string;type:OrderType;targetId:string;x:number;y:number;z:number;progress:number;work:number;state:'queued'|'working'|'blocked';assignedTo:string|null;reserved:Partial<Resources>;label:string;recipientId?:string;deliveryPhase?:'pickup'|'deliver';recipe?:string;craftAmount?:number;craftPhase?:'pickup'|'work'}
export interface ColonyEvent {id:string;time:number;day:number;hour:number;type:'info'|'weather'|'health'|'research'|'arrival';text:string}
export interface GuideSale {
  merchantId?:MerchantId;
  eventId?:string;
  side:'buy'|'recycle'; pickupAt?:Position;
  item:Resource; count:number; premium:number; total:number; delivered:number; paid:number; inTransit:number;
  lots:{x:number; z:number; count:number; shelfId?:string; overflow?:boolean; premium?:number}[];
  transitPremium?:number;
}
export interface JobView { guideSale?:GuideSale }
export interface RoomView {id:number;cells:[number,number][];enclosed:boolean;comfort:number;temperature:number;cleanliness:number}
export type FinalePhase = 'gathering' | 'show' | 'departing';
export interface FinaleView {
  buildingId:string; phase:FinalePhase; elapsed:number; arrived:number; guests:number;
}
export interface ColonySnapshot {
  specialistMarket: SpecialistMarketView;
  guideHousing: import('./guide-housing.ts').GuideHousing;
  finale?:FinaleView;
  version:1;speed:number;day:number;hour:number;season:string;weather:string;temperature:number;time:number;
  resources:Resources;colonists:ColonistView[];buildings:BuildingView[];zones:ZoneView[];crops:CropView[];items:ItemView[];jobs:JobView[];rooms:RoomView[];terrainPlans:TerrainPlanView[];
  warehouseStacks:StoredStack[];
  playerBag:PlayerInventorySlot[];bagSelected:number;controlledColonistId:string|null;chests:ChestView[];
  research:{active:string|null;progress:Record<string,number>;completed:string[]};
  power:{generation:number;demand:number;stored:number;capacity:number;supplied:number;coldStorage:boolean};
  events:ColonyEvent[];selectedColonistId:string|null;
  metrics:{jobsCompleted:number;built:number;harvested:number;hauled:number;cooked:number;researched:number;treated:number;spoiled:number;distanceWalked:number};
}
