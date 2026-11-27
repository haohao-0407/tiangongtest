import type { VoxelWorld } from './model.ts';
import { occupiedLandCells, type PlantLandUse } from './wild-plants.ts';

export const WILD_ANIMAL_KINDS = ['chicken', 'cow', 'sheep', 'pig'] as const;
export type WildAnimalKind = typeof WILD_ANIMAL_KINDS[number];
export interface WildAnimal {
  kind: WildAnimalKind;
  x: number; y: number; z: number;
  dx: number; dz: number;
  phase: number; scale: number;
}

export const stockAnimalId=(a:Pick<WildAnimal,'kind'|'x'|'z'>)=>a.kind+'-'+a.x+'-'+a.z;

// Include both endpoints, the space swept while walking and the turn at either end.
function habitat(animal: WildAnimal) {
  const pad = animal.kind === 'chicken' ? 0 : 1;
  return {
    left: animal.x + Math.min(0, animal.dx) - pad, right: animal.x + Math.max(0, animal.dx) + pad,
    back: animal.z + Math.min(0, animal.dz) - pad, front: animal.z + Math.max(0, animal.dz) + pad,
  };
}

function hasHabitat(animal: WildAnimal, available: (x: number, z: number) => boolean) {
  const {left, right, back, front} = habitat(animal);
  for (let z = back; z <= front; z++) for (let x = left; x <= right; x++) {
    if (!available(x, z)) return false;
  }
  return true;
}

export function planWildAnimals(width: number, depth: number,
  random: (x: number, z: number, salt: number) => number, ground: (x: number, z: number) => number): WildAnimal[] {
  const animals: WildAnimal[] = [];
  const reserved = new Set<number>();
  const region = 32;
  const campRadius = Math.min(12, Math.min(width, depth) / 5);
  for (let rz = 0; rz < depth; rz += region) for (let rx = 0; rx < width; rx += region) {
    const roll = (salt: number) => random(rx, rz, salt);
    const cx = rx + Math.floor(roll(1) * Math.min(region, width-rx));
    const cz = rz + Math.floor(roll(2) * Math.min(region, depth-rz));
    const kind = WILD_ANIMAL_KINDS[Math.floor(roll(3) * WILD_ANIMAL_KINDS.length)]!;
    const count = (kind === 'chicken' ? 3 : 2) + Math.floor(roll(4) * 3);
    for (let attempt = 0, placed = 0; attempt < 36 && placed < count; attempt++) {
      const salt = 10 + attempt * 6;
      const x = cx + Math.floor(roll(salt) * 15) - 7, z = cz + Math.floor(roll(salt+1) * 15) - 7;
      const y = ground(x, z);
      if (y < 0) continue;
      const direction = Math.floor(roll(salt+2) * 4);
      const length = 2 + Math.floor(roll(salt+3) * 3);
      const stride = direction < 2 ? length : -length;
      const animal = { kind, x, y, z, dx: direction % 2 ? stride : 0, dz: direction % 2 ? 0 : stride,
        phase: roll(salt+4), scale: (kind === 'chicken' ? .74 : .94) + roll(salt+5) * .08 };
      if (!hasHabitat(animal, (xx, zz) => Math.hypot(xx-width/2, zz-depth/2) >= campRadius &&
        ground(xx, zz) === y && !reserved.has(xx + zz*width))) continue;
      const {left, right, back, front} = habitat(animal);
      for (let zz = back; zz <= front; zz++) for (let xx = left; xx <= right; xx++) reserved.add(xx + zz*width);
      animals.push(animal);
      placed++;
    }
  }
  // Large livestock share the same grazing footprint. Populate a missing breed from a
  // surplus large-animal group when a seed only placed a few viable regions.
  const large = ['cow','sheep','pig'] as const;
  for(const kind of large) {
    if(animals.some(a=>a.kind===kind))continue;
    const donor=large.map(k=>animals.filter(a=>a.kind===k)).sort((a,b)=>b.length-a.length)[0];
    if(donor&&donor.length>1)donor.at(-1)!.kind=kind;
  }
  return animals;
}

export function visibleWildAnimals(world: VoxelWorld, land: PlantLandUse) {
  const occupied = occupiedLandCells(world.width, land);
  return world.getWildAnimals().filter(a => hasHabitat(a, (x, z) =>
    !occupied.has(x + z*world.width) && world.wildAnimalGround(x, z) === a.y));
}

/** The saved colony clock determines the pose, including pauses to graze and turn. */
export function wildAnimalPose(a: WildAnimal, time: number) {
  const cycle = (time / (14 + 8*a.phase) + a.phase) % 1;
  const progress = Math.min(1, cycle / .3, Math.max(0, (.8-cycle) / .3));
  const turn = Math.min(1, Math.max(0, (cycle-.42)/.08), (1-cycle)/.08);
  return { x: a.x + .5 + a.dx*progress, y: a.y, z: a.z + .5 + a.dz*progress,
    yaw: Math.atan2(a.dx, a.dz) + Math.PI*turn };
}
