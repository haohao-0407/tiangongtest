import type { ColonySnapshot, MerchantHousing, MerchantId, Position } from './contracts.ts';
import { rayBox } from '../voxel/tree-interaction.ts';

export function townMerchants(colony: ColonySnapshot): MerchantHousing[] {
  return [colony.guideHousing, ...colony.specialistMarket.merchants.flatMap(merchant =>
    merchant.status === 'arrived' && merchant.housing ? [merchant.housing] : [])];
}

export function inConversationRange(player: Position, position: Position) {
  return Math.hypot(player[0]-position[0], player[1]-position[1], player[2]-position[2]) <= 3;
}

export function pickMerchant(merchants: readonly MerchantHousing[], player: Position, origin: Position, direction: Position, limit: number) {
  let nearest: MerchantId | null = null;
  for (const {npcId, position} of merchants) {
    const [x,y,z] = position;
    const distance = rayBox(origin, direction, [x-.43,y,z-.43], [x+.43,y+1.92,z+.43], limit);
    if (distance === null || distance >= limit) continue;
    limit = distance;
    nearest = inConversationRange(player, position) ? npcId : null;
  }
  return nearest;
}
