import { describe, expect, it } from 'vitest';
import { BLOCK, VoxelWorld } from '../model.ts';
import type { FacadeLayout } from '../pcg/facade.ts';

const first: FacadeLayout = { version: 2, groups: [{ id: 'window:x:7:5:4.5', axis: 'x', plane: 7, base: 5, lower: 5.375, upper: 6.5625, u0: 4.5, u1: 6.5, panes: 2 }] };
const second: FacadeLayout = { version: 2, groups: [...first.groups, { ...first.groups[0]!, id: 'window:x:7:5:8.5', u0: 8.5, u1: 10.5 }] };
const world = () => new VoxelWorld('facade-history', { width: 16, height: 12, depth: 16 });

describe('facade placement persistence', () => {
  it('restores placements in the same undo/redo transaction as the source cells', () => {
    const source = world();
    source.set(4, 8, 7, BLOCK.Brick);
    source.setFacadeLayout(first);
    source.set(9, 8, 7, BLOCK.Brick);
    source.setFacadeLayout(second);
    expect(source.undoCount).toBe(2);
    expect(source.undo()).toBe(true);
    expect(source.getFacadeLayout()).toEqual(first);
    source.setFacadeLayout(first); // Renderer validates the restored placement without another edit.
    expect(source.redo()).toBe(true);
    expect(source.getFacadeLayout()).toEqual(second);
    source.setFacadeLayout(second);
    source.undo(); source.undo();
    expect(source.getFacadeLayout().groups).toEqual([]);
    expect(source.redoCount).toBe(2);
  });

  it('round-trips placements, keeps old saves compatible, and clears stale layout on reset', () => {
    const source = world(); source.setFacadeLayout(second);
    const save = source.serialize(), loaded = VoxelWorld.deserialize(save);
    expect(loaded.getFacadeLayout()).toEqual(second);
    expect(loaded.canUndo).toBe(false);
    const legacy = JSON.parse(save); delete legacy.facadeLayout;
    expect(VoxelWorld.deserialize(JSON.stringify(legacy)).getFacadeLayout().groups).toEqual([]);
    source.reset('another', { width: 16, height: 12, depth: 16 });
    expect(source.getFacadeLayout().groups).toEqual([]);
    source.load(save);
    expect(source.getFacadeLayout()).toEqual(second);
    const read = source.getFacadeLayout(); read.groups[0]!.u0 = 0;
    expect(source.getFacadeLayout()).toEqual(second);
  });

  it('rejects malformed layout atomically without losing the current map or history', () => {
    const source = world(); source.set(4, 8, 7, BLOCK.Brick); source.setFacadeLayout(first);
    const before = source.serialize(), undoCount = source.undoCount, data = JSON.parse(before);
    for (const layout of [
      { version: 999, groups: [] }, { version: 2, groups: [first.groups[0], first.groups[0]] },
      { version: 2, groups: [{ ...first.groups[0], u0: .01 }] },
      { version: 2, groups: [{ ...first.groups[0], u1: 1000 }] },
      { version: 2, groups: [{ ...first.groups[0], plane: -1 }] },
      { version: 2, groups: [{ ...first.groups[0], upper: null }] },
    ]) {
      expect(() => source.load(JSON.stringify({ ...data, facadeLayout: layout }))).toThrow();
      expect(source.serialize()).toBe(before);
      expect(source.undoCount).toBe(undoCount);
    }
  });
});
