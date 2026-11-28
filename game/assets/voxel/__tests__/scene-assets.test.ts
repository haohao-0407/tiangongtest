import { describe, expect, it, vi } from 'vitest';
import type { AssetRegistry } from '@forgeax/engine/assets-runtime';
import { SceneAssets } from '../../shared/scene-assets.ts';

function fixture() {
  const pending = new Map<string, (handle: number) => void>();
  const result = (value: number) => ({ unwrap: () => value });
  const registry = {
    load: vi.fn((guid: string) => new Promise<ReturnType<typeof result>>(resolve => {
      pending.set(guid, handle => resolve(result(handle)));
    })),
    release: vi.fn((_handle: number) => ({ unwrap() {} })),
  };
  return { loads: new SceneAssets(registry as unknown as AssetRegistry), registry, pending };
}

describe('scene asset streaming', () => {
  it('shares required and deferred reads and admits at most two optional assets per frame', async () => {
    const { loads, registry, pending } = fixture();
    for (const guid of ['a', 'b', 'a', 'c']) expect(loads.get(guid, 'mesh')).toBeUndefined();
    expect(registry.load).not.toHaveBeenCalled();
    loads.update();
    loads.update();
    expect([...pending.keys()]).toEqual(['a', 'b']);
    const required = loads.preload('a', 'mesh');
    pending.get('a')!(7);
    expect(await required).toBe(7);
    expect(loads.get('a', 'mesh')).toBe(7);
    expect(registry.load).toHaveBeenCalledTimes(2);
    loads.update();
    expect([...pending.keys()]).toEqual(['a', 'b', 'c']);
    const remaining = Promise.all([loads.preload('b', 'mesh'), loads.preload('c', 'mesh')]);
    pending.get('b')!(8);
    pending.get('c')!(9);
    await remaining;
    loads.dispose();
    expect(registry.release.mock.calls.map(([h]) => h)).toEqual([7, 8, 9]);
  });

  it('aborts pending reads on exit and releases a handle even when its provider completes late', async () => {
    const { loads, registry, pending } = fixture();
    const loading = loads.preload('late', 'scene');
    loads.get('never-started', 'mesh');
    loads.dispose();
    pending.get('late')!(15);
    await expect(loading).rejects.toMatchObject({name: 'AbortError'});
    expect(loads.get('late', 'scene')).toBeUndefined();
    loads.update();
    loads.dispose();
    expect(registry.load).toHaveBeenCalledTimes(1);
    expect(registry.release).toHaveBeenCalledExactlyOnceWith(15);
  });
});
