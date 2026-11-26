import type { CropSeed, CropType, DishType, SupplyType } from './contracts.ts';

const PRODUCE_MESHES: Record<CropType, string> = {
  blueberry: '01a1efdb-b959-71b1-8ad3-626e46b86571',
  cabbage: '01a1efdb-b95a-728a-a024-f379aab2575d',
  corn: '01a1efdb-b95a-728a-a024-f37ab37d2a39',
  leek: '01a1efdb-b95a-728a-a024-f37bb4b5d99b',
  potato: '01a1efdb-b95a-728a-a024-f37c1b678212',
  sugarcane: '01a1efdb-b95a-728a-a024-f37d509080e4',
  tomato: '01a1efdb-b95a-728a-a024-f37ef58dcc91',
  wheat: '01a1efdb-b95a-728a-a024-f37ffe23b2c3',
};

const SEED_ITEM_MESHES: Record<CropSeed, string> = {
  cabbageSeed: '01a1f3fb-2a1f-7238-8ac3-04ff43534a5d',
  tomatoSeed: '01a1f3fb-2a1f-7238-8ac3-0500af905f71',
  sugarcaneSeed: '01a1f3fb-2a1f-7238-8ac3-050119a3cf20',
  leekSeed: '01a1f3fb-2a1f-7238-8ac3-0502ef916604',
  potatoSeed: '01a1f3fb-2a1f-7238-8ac3-05034adfa5ea',
  wheatSeed: '01a1f3fb-2a1f-7238-8ac3-05043a3917b5',
  cornSeed: '01a1f3fb-2a1f-7238-8ac3-05053e8b8930',
};

const FOOD_AND_SUPPLY_MESHES = {
  blueberryWine: '01a1f41a-056b-7fa4-adad-548a24188318',
  flour: '01a1f41a-056b-7fa4-adad-548b2ae46ec1',
  cheese: '01a1f41a-056b-7fa4-adad-548c9277b8b5',
  chickenMeat: '01a1f41a-056b-7fa4-adad-548d6764b801',
  beef: '01a1f41a-056b-7fa4-adad-548ecdf554fa',
  pork: '01a1f41a-056b-7fa4-adad-548f92b44e99',
  sugar: '01a1f41a-056b-7fa4-adad-54901049b389',
  lambChopStew: '01a1fa01-d067-7fe2-88de-cfb33287de32',
  mutton: '01a1fa01-d067-7fe2-88de-cfb42d633b6a',
  wool: '01a1fa01-d067-7fe2-88de-cfb55560f7a9',
} satisfies Partial<Record<SupplyType | DishType, string>>;

export const ITEM_CARD_MESHES = { ...PRODUCE_MESHES, ...SEED_ITEM_MESHES, ...FOOD_AND_SUPPLY_MESHES };
