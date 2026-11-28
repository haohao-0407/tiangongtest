import { BUILDING_DEFS, CROP_DEFS, PLAYER_DELIVERY_TARGET, RESOURCE_NAMES, RESOURCE_TYPES,
  cropPlantingItem, isCropKind, isCropSeed, isResource, type ColonySnapshot, type Resource, type Resources } from './contracts.ts';
import { recipeCost, recipeFor } from './recipes.ts';

type Amounts = Partial<Resources>;

function add(total: Amounts, item: Resource, count: number) {
  total[item] = (total[item] ?? 0) + count;
}

function addUnreserved(total: Amounts, cost: Amounts, reserved: Amounts) {
  for (const [item, count] of Object.entries(cost) as [Resource, number][]) {
    add(total, item, Math.max(0, count - (reserved[item] ?? 0)));
  }
}

function stationHint(c: ColonySnapshot, item: 'stone' | 'pigIron') {
  const point = item === 'stone' ? '石料点' : '铁矿点';
  const stations = c.buildings.filter(b => b.kind === 'extractionStation' && b.mining?.resource === item &&
    b.mining.remaining > 0 && !c.jobs.some(j => j.type === 'demolish' && j.targetId === b.id));
  if (!stations.length) return `建造 → 在${point}放置采集站`;
  const ready = stations.filter(b => b.complete);
  if (!ready.length) return `等待${point}的采集站完工`;
  const busy = ready.find(b => c.jobs.some(j => j.type === 'mine' && j.targetId === b.id && j.assignedTo));
  const station = busy ?? ready[0];
  return `采集站 · ${station.mining!.status}`;
}

export function materialSource(c: ColonySnapshot, item: Resource) {
  const recipe = recipeFor(item);
  if (recipe?.station) return `制作清单 → ${BUILDING_DEFS[recipe.station].name}制作${RESOURCE_NAMES[item]}`;
  if (isCropSeed(item)) return '向已入住的向导购买种子包';
  if (isCropKind(item)) return `规划 → 农田种植${CROP_DEFS[item].name}`;
  switch (item) {
    case 'wood': return '规划 → 伐木，选择树木';
    case 'stone':
    case 'pigIron': return stationHint(c, item);
    case 'egg': return '牧场 → 鸡窝收取鸡蛋';
    case 'milk': return '牧场 → 挤奶器采集牛奶';
    case 'wool': return '牧场 → 剪毛台采集羊毛';
    default: return '暂无常规补给途径';
  }
}

export function taskMaterials(c: ColonySnapshot) {
  const demand: Amounts = {}, ground: Amounts = {}, hauling: Amounts = {}, ordered: Amounts = {};
  const crops = new Map(c.crops.map(crop => [crop.id, crop]));
  const residents = new Map(c.colonists.map(person => [person.id, person]));
  for (const b of c.buildings) {
    // Construction reserves the full bill at once. A saved reservation owns its original price.
    if (!b.complete && !Object.keys(b.reserved).length) addUnreserved(demand, BUILDING_DEFS[b.kind].cost, b.reserved);
  }
  for (const job of c.jobs) {
    const recipe = recipeFor(job.recipe);
    if (recipe) {
      const batches = job.craftAmount ?? 1;
      addUnreserved(demand, recipeCost(recipe, batches), job.reserved);
      add(ordered, recipe.output, recipe.count * batches);
    } else if (job.type === 'grow') {
      const crop = crops.get(job.targetId);
      if (crop && !crop.planted) addUnreserved(demand, { [cropPlantingItem(crop.kind)]: 1 }, job.reserved);
    } else if (job.type === 'doctor') {
      addUnreserved(demand, { medicine: 1 }, job.reserved);
    } else if (job.guideSale?.side === 'buy') {
      const sale = job.guideSale;
      add(ordered, sale.item, sale.count - sale.delivered - sale.inTransit);
      add(hauling, sale.item, sale.inTransit);
    } else if (job.type === 'haul' && !job.guideSale && job.targetId !== PLAYER_DELIVERY_TARGET && job.assignedTo) {
      const cargo = residents.get(job.assignedTo)?.carrying ?? {};
      for (const [item,count] of Object.entries(cargo) as [Resource,number][]) add(hauling,item,count);
    }
  }
  for (const drop of c.items) {
    if (!drop.playerOnly && isResource(drop.resource)) add(ground, drop.resource, drop.amount);
  }
  return RESOURCE_TYPES.flatMap(item => {
    const missing = (demand[item] ?? 0) - c.resources[item];
    if (missing <= 0) return [];
    const transit = Math.min(missing, hauling[item] ?? 0);
    const loose = Math.min(missing - transit, ground[item] ?? 0);
    const pending = Math.min(missing - transit - loose, ordered[item] ?? 0);
    const acquire = missing - transit - loose - pending;
    return [{ item, missing, transit, loose, pending, acquire, source: acquire ? materialSource(c,item) : '' }];
  });
}
