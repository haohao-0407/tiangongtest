import type { World, EntityHandle } from '@forgeax/engine/ecs';
import type { AssetRegistry } from '@forgeax/engine/assets-runtime';
import { createMeshBuilder } from '@forgeax/engine/geometry';
import { Materials, MeshFilter, MeshRenderer, ShadowParticipation } from '@forgeax/engine/render';
import { Name, Transform } from '@forgeax/engine/scene';
import type { AssetHandle } from '@forgeax/engine/types';
import type { VoxelWorld } from './model.ts';
import type { TreeInstance } from './trees.ts';
import { buildTreeMesh } from './tree-mesh.ts';

interface Model { handle: AssetHandle<'mesh'>; triangles: number; users: number }
interface Entry { entity: EntityHandle; model: string; signature: string; selected: boolean }
const modelKey = (tree: TreeInstance) => `${tree.trunkHeight}:${tree.crownRadius}:${tree.variant}`;
const transform = (tree: TreeInstance) => {
  // treeParts rotates x/z counterclockwise, which is a negative rotation about Y.
  const halfAngle = -tree.rotation * Math.PI / 4;
  return { pos: [tree.x + .5, tree.y, tree.z + .5] as [number, number, number],
    quat: [0, Math.sin(halfAngle), 0, Math.cos(halfAngle)] as [number, number, number, number] };
};

/** One entity per natural tree; runtime map variants share a merged mesh and material. */
export class TreeView {
  private readonly material: AssetHandle<'material'>;
  private readonly selectedMaterial: AssetHandle<'material'>;
  private readonly entries = new Map<string, Entry>();
  private readonly models = new Map<string, Model>();
  private lastSource: VoxelWorld | null = null;
  private lastTrees: readonly TreeInstance[] | null = null;
  private selectedTreeId: string | null = null;
  private revision = 0;
  private disposed = false;

  constructor(private world: World, private assets: AssetRegistry) {
    this.material = assets.create(Materials.standard({ baseColor: [1, 1, 1, 1], roughness: .95, metallic: 0 })).unwrap();
    this.selectedMaterial = assets.create(Materials.standard({ baseColor: [1, .95, .72, 1], roughness: .95, metallic: 0,
      emissive: [.12, .09, .025], emissiveIntensity: .65 })).unwrap();
  }

  private model(tree: TreeInstance): Model {
    const key = modelKey(tree), existing = this.models.get(key);
    if (existing) return existing;
    const data = buildTreeMesh({ ...tree, x: 0, y: 0, z: 0, rotation: 0 });
    const mesh = createMeshBuilder({ attributes: { position: data.position, normal: data.normal, uv: data.uv, color: data.color }, indices: data.indices }).build().unwrap();
    const model = { handle: this.assets.create(mesh).unwrap(), triangles: data.indices.length / 3, users: 0 };
    this.models.set(key, model);
    return model;
  }

  private remove(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.world.despawn(entry.entity).unwrap();
    this.models.get(entry.model)!.users--;
    this.entries.delete(id);
  }

  private releaseUnusedModels(): void {
    for (const [key, model] of this.models) if (!model.users) {
      this.assets.release(model.handle).unwrap();
      this.models.delete(key);
    }
  }

  update(source: VoxelWorld, selectedTreeId?: string | null): boolean {
    if (this.disposed) return false;
    let changed = source !== this.lastSource;
    if (changed) this.clear();
    this.lastSource = source;
    const trees = source.getTrees();
    if (!changed && trees === this.lastTrees && (selectedTreeId ?? null) === this.selectedTreeId) return false;
    this.lastTrees = trees;
    const present = new Set(trees.map(tree => tree.id));
    this.selectedTreeId = selectedTreeId && present.has(selectedTreeId) ? selectedTreeId : null;
    for (const id of this.entries.keys()) if (!present.has(id)) { this.remove(id); changed = true; }
    for (const tree of trees) {
      const key = modelKey(tree), signature = `${key}:${tree.x}:${tree.y}:${tree.z}:${tree.rotation}`;
      const selected = tree.id === this.selectedTreeId;
      let entry = this.entries.get(tree.id);
      if (entry && entry.model !== key) { this.remove(tree.id); entry = undefined; }
      if (!entry) {
        const model = this.model(tree);
        const entity = this.world.spawn(
          { component: Name, data: { value: `整树 ${tree.id}` } },
          { component: Transform, data: transform(tree) },
          { component: MeshFilter, data: { assetHandle: model.handle } },
          { component: MeshRenderer, data: { materials: [selected ? this.selectedMaterial : this.material] } },
          { component: ShadowParticipation, data: { cast: true, receive: true } },
        ).unwrap();
        model.users++;
        this.entries.set(tree.id, { entity, model: key, signature, selected });
        changed = true;
      } else {
        if (entry.signature !== signature) {
          this.world.set(entry.entity, Transform, transform(tree)).unwrap();
          entry.signature = signature; changed = true;
        }
        if (entry.selected !== selected) {
          this.world.set(entry.entity, MeshRenderer, { materials: [selected ? this.selectedMaterial : this.material] }).unwrap();
          entry.selected = selected; changed = true;
        }
      }
    }
    this.releaseUnusedModels();
    if (changed) this.revision++;
    return changed;
  }

  read() {
    return { revision: this.revision, instances: this.entries.size, meshes: this.models.size,
      materials: this.disposed ? 0 : 2, selectedTreeId: this.selectedTreeId,
      triangles: [...this.models.values()].reduce((sum, model) => sum + model.triangles * model.users, 0),
      uniqueTriangles: [...this.models.values()].reduce((sum, model) => sum + model.triangles, 0),
      models: [...this.models].map(([key, model]) => ({ key, instances: model.users, triangles: model.triangles })) };
  }

  clear(): void {
    for (const id of this.entries.keys()) this.remove(id);
    this.releaseUnusedModels();
    this.lastSource = null; this.lastTrees = null; this.selectedTreeId = null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.clear();
    this.assets.release(this.material).unwrap();
    this.assets.release(this.selectedMaterial).unwrap();
    this.disposed = true;
  }
}
