import type { Resource } from './contracts.ts';
import { SPECIALISTS, SPECIALIST_MARKET_RULES as rules, type SpecialistId } from './specialist-catalog.ts';

export interface MarketEvent {
  id: string;
  merchantId: SpecialistId;
  announcedDay: number;
  startDay: number;
  endDay: number;
  item: Resource;
  limit: number;
  remaining: number;
}

function draw(key: string, choices: number) {
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) hash = Math.imul(hash ^ key.charCodeAt(i), 16777619);
  return (hash >>> 0) % choices;
}

export function planMarketEvents(events: MarketEvent[], day: number, housedIds: readonly SpecialistId[], worldSeed: string) {
  const housed = [...new Set(housedIds)].sort();
  if (!housed.length) return events;
  const key = `${worldSeed}/${day}`;
  // Each merchant posts a first request within the visible week after receiving a home.
  let hosts = housed.filter(id => !events.some(event => event.merchantId === id));
  if (!hosts.length) {
    if (events.some(event => event.startDay > day)) return events;
    hosts = [housed[draw(key + '/host', housed.length)]!];
  }
  return events.concat(hosts.map(merchantId => {
    const request = SPECIALISTS[merchantId].request;
    const startDay = day + rules.minimumNoticeDays + draw(`${key}/${merchantId}/start`, 3);
    return {
      id: `${merchantId}-${startDay}`, merchantId, item: request.item, announcedDay: day, startDay,
      endDay: startDay + rules.requestDurationDays - 1, limit: request.quantity, remaining: request.quantity,
    };
  }));
}

export function activeMarketEvent(events: readonly MarketEvent[], day: number, merchantId: SpecialistId, item: Resource) {
  return events.find(event => event.merchantId === merchantId && event.item === item && event.startDay <= day && day <= event.endDay);
}

export function reserveMarketQuota(events: MarketEvent[], day: number, eventId: string, count: number) {
  const event = events.find(row => row.id === eventId);
  if (!event || !Number.isSafeInteger(count) || count <= 0 || count > event.remaining || day < event.startDay || day > event.endDay) return null;
  return events.map(row => row === event ? { ...row, remaining: row.remaining - count } : row);
}

export function releaseMarketQuota(events: MarketEvent[], eventId: string, count: number) {
  const event = events.find(row => row.id === eventId);
  if (!event || !Number.isSafeInteger(count) || count <= 0 || count > event.limit - event.remaining) return null;
  return events.map(row => row === event ? { ...row, remaining: row.remaining + count } : row);
}
