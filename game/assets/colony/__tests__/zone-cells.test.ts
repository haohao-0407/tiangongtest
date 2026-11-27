import { expect, it } from 'vitest';
import { ColonySimulation } from '../simulation.ts';
import { VoxelWorld } from '../../voxel/model.ts';
import { footprintCells, type ZoneCell } from '../zone-cells.ts';

it('allows the hole in a farm to be used by a second zone across save, load and cancellation', () => {
  const world = new VoxelWorld();
  const sim = new ColonySimulation(world);
  let corner: ZoneCell | undefined;
  for (let z = 115; z < 140 && !corner; z++) for (let x = 115; x < 140; x++) {
    if ([...footprintCells({x,z,w:2,d:2})].every(([cx,cz]) => !sim.zoneCellBlocker(cx,cz))) {
      corner = [x,z];
      break;
    }
  }
  expect(corner).toBeDefined();
  const [x,z] = corner!;
  const cells: ZoneCell[] = [[x,z],[x+1,z],[x,z+1]];
  const hole: ZoneCell = [x+1,z+1];
  const farm = sim.command({action:'designate', kind:'farm', cells});
  expect(farm.ok).toBe(true);
  const count = sim.snapshot().zones.length;
  expect(sim.command({action:'designate',kind:'stockpile',cells:[hole,cells[0]]}).ok).toBe(false);
  expect(sim.snapshot().zones.length).toBe(count);
  const second = sim.command({action:'designate',kind:'farm',cells:[hole]});
  expect(second.ok).toBe(true);
  const restored = new ColonySimulation(world);
  restored.load(JSON.parse(JSON.stringify(sim.serialize())));
  expect(restored.snapshot().zones.find(zone=>zone.id===farm.id)?.cells).toEqual(cells);
  expect(restored.command({action:'cancel',id:farm.id}).ok).toBe(true);
  expect(restored.snapshot().crops.some(c=>c.x===hole[0] && c.z===hole[1])).toBe(true);
  expect(restored.zoneCellBlocker(...hole)).toBeTruthy();
  for (const cell of cells) expect(restored.zoneCellBlocker(...cell)).toBeNull();
});
