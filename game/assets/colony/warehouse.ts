import { STORAGE_QUARTERS, type Resource, type StoredStack, type WarehouseSlot } from './contracts.ts';
import { ITEM_CARD_MESHES } from './item-cards.ts';

type PackageSize = 1 | 2 | 4;
const LUGGAGE_SIZES: Partial<Record<Resource,PackageSize>> = {
  wood:4, stone:4, dirt:4, stoneBrick:4,
  plank:2, steel:2, pigIron:2, cloth:2, food:2, meal:2,
};

export const isWarehouseCard = (resource:Resource):boolean => Object.hasOwn(ITEM_CARD_MESHES,resource);
export const packageSize = (resource:Resource):PackageSize => isWarehouseCard(resource) ? 1 : LUGGAGE_SIZES[resource] ?? 1;
export const cardLayers = (count:number):number => Math.ceil(count/8);

export function packageMask(resource:Resource, quarter:number):number {
  const size=packageSize(resource);
  return quarter%size===0 ? ((1<<size)-1)<<quarter : 0;
}

export function warehouseBayKey(slot:WarehouseSlot):string {
  return slot.shelfId ? `${slot.shelfId}/${Math.floor(slot.slot/STORAGE_QUARTERS)}` : `${slot.x},${slot.z}`;
}

export const warehouseSlotKey = (slot:WarehouseSlot):string => `${warehouseBayKey(slot)}/${slot.slot%STORAGE_QUARTERS}`;

export function warehouseSlotContents(stacks:readonly StoredStack[]):Map<string,StoredStack[]> {
  const slots=new Map<string,StoredStack[]>();
  for (const stack of stacks) {
    const key=warehouseSlotKey(stack), contents=slots.get(key);
    if (contents) contents.push(stack);
    else slots.set(key,[stack]);
  }
  return slots;
}

export function warehouseBayContents(stacks:readonly StoredStack[]):Map<string,{mask:number;cards:boolean}> {
  const bays=new Map<string,{mask:number;cards:boolean}>();
  for (const stack of stacks) {
    const key=warehouseBayKey(stack);
    const previous=bays.get(key)?.mask??0;
    const mask=packageMask(stack.resource,stack.slot%STORAGE_QUARTERS);
    bays.set(key,{mask:previous|mask,cards:isWarehouseCard(stack.resource)});
  }
  return bays;
}
