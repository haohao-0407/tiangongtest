import { describe, expect, it } from 'vitest';
import { planFacades, type FacadeLayout, type FacadeWindowState } from '../facade.ts';
import type { PcgBuilding, PcgSource } from '../rules.ts';

class Fixture implements PcgSource {
  width = 48; height = 12; depth = 32; revision = 0;
  data = new Uint8Array(this.width * this.height * this.depth);
  get(x: number, y: number, z: number) {
    return x < 0 || x >= this.width || y < 0 || y >= this.height || z < 0 || z >= this.depth ? 0 : this.data[x + this.width * (z + this.depth * y)]!;
  }
  set(x: number, y: number, z: number, block: number) { this.data[x + this.width * (z + this.depth * y)] = block; this.revision++; }
  wall(x: number, z: number, width: number, height = 2, axis: 'x' | 'z' = 'x') {
    for (let u = 0; u < width; u++) for (let y = 4; y < 4 + height; y++) this.set(x + (axis === 'x' ? u : 0), y, z + (axis === 'z' ? u : 0), 6);
  }
}
const geometry = (g: FacadeWindowState) => [g.id, g.axis, g.plane, g.base, g.lower, g.upper, g.u0, g.u1, g.panes];

describe('whole facade planning', () => {
  it('designs multi-column window groups from the complete wall width on the 1/16 grid', () => {
    const six = new Fixture(); six.wall(4, 8, 6);
    const plan = planFacades(six, []);
    expect(plan.groups).toHaveLength(2);
    expect(plan.patches.filter(p => p.axis === 'x')).toHaveLength(1);
    for (const g of plan.groups) {
      expect(g.u1 - g.u0).toBeGreaterThan(2);
      expect(Math.floor(g.u0)).not.toBe(Math.floor(g.u1));
      expect(g.faces).toEqual([-1, 1]);
      expect(g.panes).toBe(2);
      for (const value of [g.plane, g.base, g.lower, g.upper, g.u0, g.u1]) expect(value * 16).toBe(Math.round(value * 16));
    }
    const nine = new Fixture(); nine.wall(4, 8, 9);
    expect(planFacades(nine, []).groups).toHaveLength(3);
    const column = new Fixture(); column.wall(4, 8, 1);
    expect(planFacades(column, []).groups).toHaveLength(0);
  });

  it('retains exact IDs and positions after extending a facade and editing an unrelated facade', () => {
    const source = new Fixture(); source.wall(4, 8, 6); source.wall(22, 18, 6);
    const initial = planFacades(source, []);
    source.wall(10, 8, 3);
    const extended = planFacades(source, [], initial.layout);
    for (const group of initial.groups) expect(extended.groups.find(g => g.id === group.id)).toMatchObject(geometryToState(group));
    expect(extended.groups.length).toBeGreaterThan(initial.groups.length);
    const unrelated = initial.groups.filter(g => g.plane === 18).map(geometry);
    expect(extended.groups.filter(g => g.plane === 18).map(geometry)).toEqual(unrelated);
    expect(planFacades(source, [], extended.layout).layout).toEqual(extended.layout);
  });

  it('removes unsupported groups after a middle gap without spanning that entrance or moving the distant group', () => {
    const source = new Fixture(); source.wall(4, 8, 12);
    const initial = planFacades(source, []), damaged = [...initial.groups].sort((a, b) => a.u0 - b.u0)[1]!;
    const hole = Math.floor((damaged.u0 + damaged.u1) / 2);
    source.set(hole, 4, 8, 0); source.set(hole, 5, 8, 0);
    const changed = planFacades(source, [], initial.layout);
    expect(changed.groups.some(g => g.id === damaged.id)).toBe(false);
    expect(changed.groups.every(g => g.u1 <= hole || g.u0 >= hole + 1)).toBe(true);
    const distant = initial.groups.find(g => g.u0 > hole + 3)!;
    expect(changed.groups.find(g => g.id === distant.id)).toMatchObject(geometryToState(distant));
    expect(changed.patches.filter(p => p.axis === 'x')).toHaveLength(2);
    source.set(hole, 4, 8, 6); source.set(hole, 5, 8, 6);
    // A source transaction restores the matching historical semantic layout along with the source.
    expect(planFacades(source, [], initial.layout).layout).toEqual(initial.layout);
  });

  it('reserves planned and completed door openings, including their side piers', () => {
    const source = new Fixture(); source.wall(4, 8, 12);
    const door: PcgBuilding = { id: 'entry', kind: 'door', x: 9, y: 4, z: 8, complete: false };
    const plan = planFacades(source, [door]);
    expect(plan.groups.length).toBeGreaterThan(1);
    for (const g of plan.groups) expect(g.u1 <= 8.5 || g.u0 >= 10.5).toBe(true);
    expect(planFacades(source, [{ ...door, complete: true }], plan.layout).layout).toEqual(plan.layout);
    const before = planFacades(source, []);
    const after = planFacades(source, [door], before.layout);
    expect(after.groups.every(g => g.u1 <= 8.5 || g.u0 >= 10.5)).toBe(true);
  });

  it('keeps real two-dimensional holes and structural corners solid', () => {
    const source = new Fixture(); source.wall(4, 8, 8, 4); source.wall(4, 8, 5, 2, 'z');
    source.set(8, 5, 8, 0);
    const plan = planFacades(source, []);
    for (const g of plan.groups) {
      // The perpendicular corner column belongs to neither opening span.
      if (g.axis === 'x' && g.plane === 8 && g.base === 4) expect(g.u0).toBeGreaterThanOrEqual(5.5);
      if (g.axis === 'z' && g.plane === 4 && g.base === 4) expect(g.u0).toBeGreaterThanOrEqual(9.5);
      if (g.axis === 'x' && g.plane === 8 && g.base === 4) expect(g.u1 <= 8 || g.u0 >= 9).toBe(true);
    }
    expect(plan.groups.some(g => g.base === 6)).toBe(true);
    // A bounding rectangle must not manufacture support in the missing source cell.
    expect(plan.groups.some(g => g.axis === 'x' && g.base === 4 && g.u0 < 8.5 && g.u1 > 8.5)).toBe(false);
  });

  it('plans completed colony walls and source walls with the same group contract', () => {
    const source = new Fixture();
    const walls: PcgBuilding[] = Array.from({ length: 6 }, (_, i) => ({ id: `wall-${i}`, kind: 'wall', x: 4 + i, y: 4, z: 8, complete: true }));
    const built = planFacades(source, walls);
    expect(built.groups).toHaveLength(2);
    expect(built.groups.every(g => g.upper < 4 + 29 / 16)).toBe(true);
    expect(planFacades(source, walls.map(w => ({ ...w, complete: false }))).groups).toHaveLength(0);
    const door = { id: 'door', kind: 'door', x: 7, y: 4, z: 8, complete: true };
    const withEntry = planFacades(source, [...walls, door], built.layout);
    expect(withEntry.groups.every(g => g.u1 <= 6.5 || g.u0 >= 8.5)).toBe(true);
  });

  it('round-trips semantic layout exactly and rebuilds without mutating saved metadata', () => {
    const source = new Fixture(); source.wall(4, 8, 9);
    const original = planFacades(source, []), json = JSON.stringify(original.layout);
    const restored: FacadeLayout = JSON.parse(json);
    expect(planFacades(source, [], restored).layout).toEqual(original.layout);
    expect(JSON.stringify(restored)).toBe(json);
    const reversed = new Fixture();
    for (let x = 12; x >= 4; x--) for (let y = 5; y >= 4; y--) reversed.set(x, y, 8, 6);
    expect(planFacades(reversed, []).layout).toEqual(original.layout);
  });

  it('keeps supported upper windows when bottom-row holes or foundation additions change local column bases', () => {
    const source = new Fixture(); source.wall(4, 8, 9, 4);
    const original = planFacades(source, []), upper = original.groups.filter(g => g.base === 6);
    expect(upper).toHaveLength(3);
    source.set(5, 3, 8, 6); // A single foundation brick must not split the existing floor datum.
    const withFoundation = planFacades(source, [], original.layout);
    expect(withFoundation.layout).toEqual(original.layout);
    expect(planFacades(source, []).layout).toEqual(original.layout);
    source.set(5, 3, 8, 0); source.set(5, 4, 8, 0);
    const oneHole = planFacades(source, [], withFoundation.layout);
    for (const group of upper) expect(oneHole.groups.find(g => g.id === group.id)).toMatchObject(geometryToState(group));
    for (let x = 4; x < 13; x++) source.set(x, 4, 8, 0);
    const removedRow = planFacades(source, [], oneHole.layout);
    for (const group of upper) expect(removedRow.groups.find(g => g.id === group.id)).toMatchObject(geometryToState(group));
    for (const a of removedRow.groups) for (const b of removedRow.groups) {
      if (a.id === b.id || a.axis !== b.axis || a.plane !== b.plane) continue;
      const intersects = a.u0 < b.u1 && a.u1 > b.u0 && a.lower < b.upper && a.upper > b.lower;
      expect(intersects).toBe(false);
    }
    for (let x = 4; x < 13; x++) source.set(x, 4, 8, 6);
    const restored = planFacades(source, [], removedRow.layout);
    for (const group of upper) expect(restored.groups.find(g => g.id === group.id)).toMatchObject(geometryToState(group));
    expect(restored.layout).toEqual(original.layout);
  });
});

function geometryToState(g: FacadeWindowState): FacadeWindowState {
  return { id: g.id, axis: g.axis, plane: g.plane, base: g.base, lower: g.lower, upper: g.upper, u0: g.u0, u1: g.u1, panes: g.panes };
}
