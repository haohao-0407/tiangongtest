import { sugarRecipe } from './sugar-press.ts';
import type { BuildingKind, Resource, Resources } from './contracts.ts';

export type Recipe = {
  output: Resource;
  count: number;
  cost: Partial<Resources>;
  station: BuildingKind | null;
  plannedStation?: string;
  work: number;
  job: 'cook' | 'craft';
  requires?: string;
};

export const RECIPES: readonly Recipe[] = [
  { output: 'friedEgg', count: 1, cost: { egg: 1 }, station: 'stove', work: 4, job: 'cook' },
  { output: 'bread', count: 1, cost: { wheat: 3 }, station: 'stove', work: 4, job: 'cook' },
  { output: 'salad', count: 1, cost: { cabbage: 1, leek: 1 }, station: 'stove', work: 4, job: 'cook' },
  { output: 'pasta', count: 1, cost: { flour: 1, tomato: 1 }, station: 'stove', work: 4, job: 'cook' },
  { output: 'pancake', count: 1, cost: { flour: 1, egg: 1 }, station: 'stove', work: 4, job: 'cook' },
  { output: 'blueberryPie', count: 1, cost: { blueberry: 1, flour: 1, sugar: 1, egg: 1 }, station: 'stove', work: 4, job: 'cook' },
  { output: 'pizza', count: 1, cost: { flour: 1, tomato: 1, milk: 1 }, station: 'stove', work: 4, job: 'cook' },
  { output: 'perfectBreakfast', count: 1, cost: { egg: 1, milk: 1, wheat: 1 }, station: 'stove', work: 4, job: 'cook' },
  { output: 'lambChopStew', count: 1, cost: { mutton: 1, potato: 1 }, station: 'stove', work: 4, job: 'cook' },
  { output: 'plank', count: 2, cost: { wood: 1 }, station: 'carpenterBench', work: 5, job: 'craft' },
  { output: 'stoneBrick', count: 1, cost: { stone: 2 }, station: 'stoneCutter', work: 5, job: 'craft' },
  { output: 'steel', count: 1, cost: { pigIron: 2 }, station: 'forgery', work: 8, job: 'craft' },
  sugarRecipe,
  { output: 'flour', count: 1, cost: { wheat: 2 }, station: 'flourMill', work: 5, job: 'craft' },
  { output: 'oil', count: 1, cost: { corn: 3 }, station: null, plannedStation: '榨油机', work: 0, job: 'craft' },
  { output: 'blueberryWine', count: 1, cost: { blueberry: 3 }, station: 'brewBarrel', work: 8, job: 'craft' },
  { output: 'cheese', count: 1, cost: { milk: 2 }, station: 'cheesePress', work: 6, job: 'craft' },
  { output: 'cloth', count: 1, cost: { wool: 2 }, station: 'loom', work: 6, job: 'craft' },
  // Advanced buildings still consume components, so the former stock target has a manual order.
  { output: 'components', count: 1, cost: { steel: 4, wood: 2 }, station: 'workbench', work: 14, job: 'craft', requires: 'fabrication' },
];

export const recipeFor = (id: unknown): Recipe | undefined => RECIPES.find(recipe => recipe.output === id);

export function recipeCost(recipe: Recipe, amount: number): Partial<Resources> {
  return Object.fromEntries(Object.entries(recipe.cost).map(([resource, count]) => [resource, count * amount]));
}
