import type { VoxelWorld } from './model.ts';

export const WILD_PLANT_KINDS = ['daisy', 'poppy', 'lavender', 'marigold', 'hairgrass', 'foxtail', 'blueberry'] as const;
export type WildPlantKind = typeof WILD_PLANT_KINDS[number];
export interface WildPlant {
  kind: WildPlantKind;
  x: number;
  y: number;
  z: number;
  turn: number;
  scale: number;
}

/** Patches mix one dominant species with fine grass. Sampling has its own seed stream. */
export function planWildPlants(width: number, depth: number, random: (x: number, z: number, salt: number) => number,
  ground: (x: number, z: number) => number): WildPlant[] {
  const plants: WildPlant[] = [];
  const occupied = new Set<number>();
  for (let pz = 0; pz < depth; pz += 8) for (let px = 0; px < width; px += 8) {
    const cx = px + Math.floor(random(px, pz, 1) * 8), cz = pz + Math.floor(random(px, pz, 2) * 8);
    const pick = random(px, pz, 3);
    const dominant = pick < .48 ? WILD_PLANT_KINDS[Math.floor(pick / .12)]! :
      pick < .72 ? 'hairgrass' : pick < .91 ? 'foxtail' : 'blueberry';
    const size = 2 + Math.floor(random(px, pz, 4) * 4);
    for (let i = 0; i < size; i++) {
      const x = cx + Math.floor(random(px, pz, 10 + i * 2) * 5) - 2;
      const z = cz + Math.floor(random(px, pz, 11 + i * 2) * 5) - 2;
      if (x < 0 || z < 0 || x >= width || z >= depth || occupied.has(x + z * width)) continue;
      const y = ground(x, z);
      if (y < 0) continue;
      occupied.add(x + z * width);
      plants.push({ x, y, z, kind: i > 0 && random(x, z, 30) < .32 ? 'hairgrass' : dominant,
        turn: Math.floor(random(x, z, 31) * 4), scale: .89 + random(x, z, 32) * .26 });
    }
  }
  return plants;
}

import { footprintCells, type Footprint } from '../colony/zone-cells.ts';
export type PlantLandUse = { buildings: readonly Footprint[]; zones: readonly Footprint[]; crops: readonly { x: number; z: number }[] };

export function landFootprintKey(width: number, land: PlantLandUse): string {
  return [...land.buildings, ...land.zones].map(b => [b.x,b.z,b.w,b.d,b.cells?.join('/')].join(',')).join(';') +
    '|' + land.crops.map(c => c.x + c.z * width).join(',');
}

export function occupiedLandCells(width: number, land: PlantLandUse): Set<number> {
  const occupied = new Set<number>();
  for (const area of [...land.buildings, ...land.zones]) {
    for (const [x,z] of footprintCells(area))
      occupied.add(x + z * width);
  }
  for (const crop of land.crops) occupied.add(crop.x + crop.z * width);
  return occupied;
}

export function visibleWildPlants(source: VoxelWorld, land: PlantLandUse): WildPlant[] {
  const occupied = occupiedLandCells(source.width, land);
  return source.getWildPlants().filter(plant => !occupied.has(plant.x + plant.z * source.width) && source.supportsWildPlant(plant));
}
