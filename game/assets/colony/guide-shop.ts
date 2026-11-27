import { CROP_SEEDS, premiumCount, RESOURCE_PRICES, RESOURCE_TYPES, type ColonySnapshot, type Resource } from './contracts.ts';
import { quoteGuideTrade } from './guide-housing.ts';
import type { MerchantId } from './contracts.ts';
import { SPECIALISTS, SPECIALIST_MARKET_RULES } from './specialist-catalog.ts';
import { activeMarketEvent } from './market-calendar.ts';

export const GUIDE_SHELF = [
  ...CROP_SEEDS.map(item=>({item,buy:2})),
  { item: 'cloth', buy: 20 }, { item: 'wheat', buy: 18 }, { item: 'bread', buy: 96 },
] as const;
export const GUIDE_RECYCLE_ITEMS = RESOURCE_TYPES.filter(item=>RESOURCE_PRICES[item]!==undefined);
export type TradeSide = 'buy' | 'recycle';
type Stock = Pick<ColonySnapshot, 'warehouseStacks' | 'guideHousing' | 'day'>;

const lowestShelfPrice = new Map<Resource, number>();
for (const {item,buy} of [...GUIDE_SHELF,...Object.values(SPECIALISTS).flatMap(s=>s.shelf)]) {
  lowestShelfPrice.set(item,Math.min(buy,lowestShelfPrice.get(item) ?? Infinity));
}
export function merchantOrder(stock:Stock & Partial<Pick<ColonySnapshot,'specialistMarket'>>, side:TradeSide, item:Resource, count:number, merchantId:MerchantId='guide') {
  const specialist = merchantId === 'guide' ? undefined : SPECIALISTS[merchantId];
  const merchant = stock.specialistMarket?.merchants.find(m=>m.id===merchantId);
  if (merchantId !== 'guide' && (!specialist || !merchant?.housing || merchant.status!=='arrived')) throw new Error('这位商人尚未到访');
  if ((merchant?.housing ?? stock.guideHousing).status!=='housed') throw new Error('请先为商人安排合格的空房');
  const listing = (specialist?.shelf ?? GUIDE_SHELF).find(row => row.item === item);
  const event = side==='recycle' && merchant && stock.specialistMarket
    ? activeMarketEvent(stock.specialistMarket.events,stock.day,merchant.id,item) : undefined;
  const preferred = specialist?.preferred.includes(item);
  if (event && count>event.remaining) throw new Error(`本次活动还可提交 ${event.remaining} 件`);
  if (specialist && side==='recycle' && !preferred && !event) throw new Error('这位商人当前不收购此商品');
  const baseRecycle = RESOURCE_PRICES[item];
  if (baseRecycle === undefined || side === 'buy' && !listing) throw new Error('此商品不在交易清单内');
  const qualified = side === 'buy' ? 0 : stock.warehouseStacks.reduce((sum, stack) =>
    sum + (stack.resource === item ? premiumCount(stack, stock.day) : 0), 0);
  const marketFactor = side==='buy' ? 1 : event ? SPECIALIST_MARKET_RULES.requestFactor : preferred ? SPECIALIST_MARKET_RULES.preferredFactor : 1;
  return {...quoteGuideTrade({ side, baseBuy: (side==='buy' ? listing?.buy : lowestShelfPrice.get(item)) ?? null, baseRecycle, count,
    premiumCount: Math.min(count, qualified), housing: merchant?.housing ?? stock.guideHousing, marketFactor }),marketFactor,eventId:event?.id??null};
}

export function guideOrder(stock:Stock, side:TradeSide, item:Resource, count:number) {
  return merchantOrder(stock,side,item,count);
}
