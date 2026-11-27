import type { BuildingKind, Position } from './contracts.ts';
import { coldSaleSubtotal } from './contracts.ts';

export const GUIDE_HOUSING_RULES = {
  minimumCells: 6,
  beds: new Set<BuildingKind>(['bed', 'doubleBed']),
  table: 'table' as BuildingKind,
  comfortWeight: 0.5,
  maximumPriceChange: 0.1,
};

export interface GuideHousing {
  npcId: 'guide';
  status: 'camp' | 'housed';
  position: Position;
  bedId: string | null;
  roomId: number | null;
  comfort: number;
  cleanliness: number;
  quality: number;
  buyFactor: number;
  recycleFactor: number;
}

export function housingTerms(comfort: number, cleanliness: number) {
  const weight = GUIDE_HOUSING_RULES.comfortWeight;
  const quality = comfort * weight + cleanliness * (1 - weight);
  const change = quality / 100 * GUIDE_HOUSING_RULES.maximumPriceChange;
  return { comfort, cleanliness, quality, buyFactor: 1 - change, recycleFactor: 1 + change };
}

export interface GuideTradeRequest {
  side: 'buy' | 'recycle';
  baseBuy: number | null;
  baseRecycle: number;
  count: number;
  premiumCount?: number;
  marketFactor?: number;
  housing: Pick<GuideHousing, 'buyFactor' | 'recycleFactor'>;
}

export function quoteGuideTrade({ side, baseBuy, baseRecycle, count, premiumCount = 0, marketFactor = 1, housing }: GuideTradeRequest) {
  if (!Number.isSafeInteger(count) || count < 1 || !Number.isSafeInteger(premiumCount) || premiumCount < 0
    || !Number.isSafeInteger(baseRecycle) || baseRecycle < 0
    || (baseBuy !== null && (!Number.isSafeInteger(baseBuy) || baseBuy < 1))) {
    throw new RangeError('交易件数或基础价格无效');
  }
  const buy = side === 'buy';
  if ((!buy && side !== 'recycle') || (buy && baseBuy === null)) throw new RangeError('商品不支持此交易方向');
  const factor = buy ? housing.buyFactor : housing.recycleFactor;
  const limit = GUIDE_HOUSING_RULES.maximumPriceChange;
  if (!Number.isFinite(factor) || factor < (buy ? 1 - limit : 1) || factor > (buy ? 1 : 1 + limit)) {
    throw new RangeError('住房价格系数无效');
  }
  const cold = buy ? 0 : Math.min(count, premiumCount);
  const base = buy ? baseBuy! * count : coldSaleSubtotal(baseRecycle, count, cold) * marketFactor;
  // Cap resale against the cheapest possible purchase, including across different houses.
  const ceiling = !buy && baseBuy !== null ? baseBuy * count * (1 - limit) : Infinity;
  const value = Math.min(base * factor, ceiling);
  // A mathematical whole silver can land just above or below its integer in binary floating point.
  const nearest = Math.round(value);
  const amount = Math.abs(value - nearest) <= Number.EPSILON * Math.abs(value) ? nearest : value;
  const total = buy ? Math.ceil(amount) : Math.floor(amount);
  if (!Number.isSafeInteger(total)) throw new RangeError('交易总价超出范围');
  return { total, normalCount: count - cold, premiumCount: cold, factor };
}
