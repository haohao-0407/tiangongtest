import type { Resource } from './contracts.ts';

export type SpecialistId = 'chef' | 'tailor' | 'cheesemaker' | 'blacksmith';

export function housingToolResident(tool:string) {
  if(!tool.startsWith('house:'))return null;
  const id=tool.slice(6);
  return id==='guide' || Object.hasOwn(SPECIALISTS,id) ? id as SpecialistId|'guide' : null;
}

export interface SpecialistDefinition {
  name: string;
  unlockItems: readonly Resource[];
  unlockQuantity: number;
  shelf: readonly { item: Resource; buy: number }[];
  preferred: readonly Resource[];
  request: { name: string; item: Resource; quantity: number };
}

// Trial prices are in silver. The guide can buy these before a specialist arrives.
export const SPECIALIST_BASE_PRICES = {
  flour: 22, sugar: 22, egg: 12, wool: 3, milk: 8, cheese: 20, pigIron: 5, steel: 14,
} satisfies Partial<Record<Resource, number>>;

export const SPECIALISTS: Record<SpecialistId, SpecialistDefinition> = {
  chef: {
    name: '厨师', unlockItems: ['wheat', 'tomato', 'bread', 'pasta', 'blueberryPie'], unlockQuantity: 12,
    shelf: [{ item: 'bread', buy: 96 }, { item: 'pasta', buy: 250 }],
    preferred: ['tomato', 'flour', 'egg', 'sugar'],
    request: { name: '村宴备货', item: 'blueberryPie', quantity: 5 },
  },
  tailor: {
    name: '裁缝', unlockItems: ['wool', 'cloth'], unlockQuantity: 6,
    shelf: [{ item: 'cloth', buy: 20 }], preferred: ['wool'],
    request: { name: '冬衣赶工', item: 'cloth', quantity: 10 },
  },
  cheesemaker: {
    name: '乳酪师', unlockItems: ['milk', 'cheese'], unlockQuantity: 8,
    shelf: [{ item: 'milk', buy: 20 }, { item: 'cheese', buy: 48 }], preferred: ['milk'],
    request: { name: '奶坊收鲜奶', item: 'milk', quantity: 12 },
  },
  blacksmith: {
    name: '铁匠', unlockItems: ['pigIron', 'steel'], unlockQuantity: 12,
    shelf: [{ item: 'pigIron', buy: 13 }, { item: 'steel', buy: 32 }], preferred: ['pigIron', 'steel'],
    request: { name: '农具翻修', item: 'steel', quantity: 8 },
  },
};

export const SPECIALIST_MARKET_RULES = {
  preferredFactor: 1.2,
  requestFactor: 1.5,
  forecastDays: 7,
  minimumNoticeDays: 2,
  requestDurationDays: 2,
} as const;
