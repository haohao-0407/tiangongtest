import balance from './resource-balance.json';
import type { BuildingDefinition } from './contracts.ts';
import type { Recipe } from './recipes.ts';

export const sugarPress: BuildingDefinition = {
  id: 'sugarPress', name: '手摇制糖台', description: '居民摇动压辊榨取蔗汁，在台侧糖锅熬糖。每 2 份甘蔗制成 1 份糖。',
  cost: balance.buildingCosts.sugarPress, work: 16, power: 0, blocking: true,
  color: [.65, .43, .22], footprint: [2, 1], height: 1, category: 'production',
};

export const sugarRecipe: Recipe = {
  output: 'sugar', count: 1, cost: { sugarcane: 2 }, station: 'sugarPress', work: 6, job: 'craft',
};

// Local box centres, dimensions and colours for the press, crank and boiling pan.
export const sugarPressParts: [number, number, number, number, number, number, string][] = [
  [0, .12, 0, 1.86, .24, .80, '#846849'],
  [-.38, .33, 0, 1.04, .18, .68, '#b27f46'],
  [-.38, .64, -.27, 1.00, .50, .11, '#845634'],
  [-.38, .59, .27, 1.00, .40, .11, '#95683b'],
  [-.56, .72, 0, .26, .26, .64, '#c5a263'],
  [-.20, .72, 0, .26, .26, .64, '#dcb976'],
  [-.56, .72, .36, .09, .09, .12, '#52463a'],
  [-.56, .84, .40, .09, .28, .07, '#b18650'],
  [-.56, .95, .45, .11, .09, .09, '#6c4c34'],
  [.48, .37, 0, .69, .28, .68, '#83817b'],
  [.48, .37, .344, .36, .15, .015, '#45382e'],
  [.48, .57, 0, .72, .13, .68, '#5a4540'],
  [.48, .646, 0, .60, .034, .56, '#e1ab51'],
  [.48, .67, -.31, .72, .10, .06, '#805845'],
  [.48, .67, .31, .72, .10, .06, '#805845'],
  [.15, .67, 0, .06, .10, .58, '#94664d'],
  [.81, .67, 0, .06, .10, .58, '#94664d'],
];
