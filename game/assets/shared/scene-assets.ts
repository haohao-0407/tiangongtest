import type { AssetRegistry } from '@forgeax/engine/assets-runtime';
import type { AssetHandle, BuiltinAssetKind } from '@forgeax/engine/types';

/** Owns one registry reference per GUID for this world. Optional reads start on game frames. */
export class SceneAssets {
  private readonly handles = new Map<string, AssetHandle>();
  private readonly queued = new Map<string, BuiltinAssetKind>();
  private readonly loading = new Map<string, Promise<AssetHandle>>();
  private readonly retryAt = new Map<string, number>();
  private readonly lifetime = new AbortController();

  constructor(private readonly registry: AssetRegistry) {}

  /** The opening scene explicitly awaits these reads before enabling input. */
  preload<K extends BuiltinAssetKind>(guid: string, kind: K): Promise<AssetHandle<K>> {
    const { signal } = this.lifetime;
    signal.throwIfAborted();
    const handle = this.handles.get(guid);
    if (handle !== undefined) return Promise.resolve(handle as AssetHandle<K>);
    const pending = this.loading.get(guid);
    if (pending) return pending as Promise<AssetHandle<K>>;

    this.queued.delete(guid);
    const load = this.registry.load(guid, kind, { signal }).then(result => {
      const handle = result.unwrap();
      if (signal.aborted) {
        this.registry.release(handle).unwrap();
        signal.throwIfAborted();
      }
      this.handles.set(guid, handle);
      this.retryAt.delete(guid);
      return handle;
    }).finally(() => this.loading.delete(guid));
    this.loading.set(guid, load);
    return load;
  }

  /** The caller can draw its fallback and ask again on the next view update. */
  get<K extends BuiltinAssetKind>(guid: string, kind: K): AssetHandle<K> | undefined {
    const handle = this.handles.get(guid);
    if (handle !== undefined) return handle as AssetHandle<K>;
    if (this.lifetime.signal.aborted || this.loading.has(guid) || this.queued.has(guid)) return;
    const retry = this.retryAt.get(guid);
    if (retry === undefined || performance.now() >= retry) this.queued.set(guid, kind);
  }

  update(): void {
    for (const [guid, kind] of this.queued) {
      if (this.loading.size >= 2) break;
      void this.preload(guid, kind).catch(error => {
        if (this.lifetime.signal.aborted) return;
        this.retryAt.set(guid, performance.now() + 30_000);
        console.warn(`场景资源 ${guid} 暂未加载，将在需要时重试。`, error);
      });
    }
  }

  dispose(): void {
    this.lifetime.abort();
    this.queued.clear();
    this.retryAt.clear();
    for (const handle of this.handles.values()) this.registry.release(handle).unwrap();
    this.handles.clear();
  }
}
