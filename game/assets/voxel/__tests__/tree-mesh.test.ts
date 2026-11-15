import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildTreeMesh, meshTreeParts } from '../tree-mesh.ts';
import { treeBounds, treeParts, type TreeInstance, type TreePart } from '../trees.ts';

const tree: TreeInstance = { id: 'oak', x: 13, y: 4, z: 21, trunkHeight: 4, crownRadius: 2, variant: 0, rotation: 0 };
const inside = (parts: TreePart[], p: number[]) => parts.some(part => p.every((v, axis) => v > part.min[axis]! && v < part.max[axis]!));

describe('shared whole-tree mesh', () => {
  it('matches the collision bounds for every authored height, color variant and rotation', () => {
    for (const trunkHeight of [3, 4]) for (const variant of [0, 1, 2]) for (const rotation of [0, 1, 2, 3] as const) {
      const instance = { ...tree, trunkHeight, variant, rotation }, mesh = buildTreeMesh(instance), bounds = treeBounds(instance);
      expect(mesh.indices.length).toBeGreaterThan(0);
      expect(mesh.indices.length % 3).toBe(0);
      const count = mesh.position.length / 3;
      expect(mesh.normal.length).toBe(count * 3); expect(mesh.color.length).toBe(count * 4); expect(mesh.uv.length).toBe(count * 2);
      expect([...mesh.indices].every(index => index < count)).toBe(true);
      expect([...mesh.position, ...mesh.normal, ...mesh.color, ...mesh.uv].every(Number.isFinite)).toBe(true);
      const offset = [instance.x + .5, instance.y, instance.z + .5];
      for (let axis = 0; axis < 3; axis++) {
        const values = [...mesh.position].filter((_, i) => i % 3 === axis);
        expect(Math.min(...values) + offset[axis]!).toBe(bounds.min[axis]);
        expect(Math.max(...values) + offset[axis]!).toBe(bounds.max[axis]);
      }
    }
  });

  it('emits outward-facing triangles only on the visible union surface', () => {
    const local = { ...tree, x: -.5, y: 0, z: -.5 }, parts = treeParts(local), mesh = buildTreeMesh(local);
    for (let i = 0; i < mesh.indices.length; i += 3) {
      const points = [0, 1, 2].map(j => [...mesh.position.slice(mesh.indices[i + j]! * 3, mesh.indices[i + j]! * 3 + 3)]);
      const normal = [...mesh.normal.slice(mesh.indices[i]! * 3, mesh.indices[i]! * 3 + 3)];
      const center = [0, 1, 2].map(axis => points.reduce((sum, p) => sum + p[axis]!, 0) / 3);
      expect(inside(parts, center.map((v, axis) => v - normal[axis]! * .001))).toBe(true);
      expect(inside(parts, center.map((v, axis) => v + normal[axis]! * .001))).toBe(false);
      const a = points[1]!.map((v, axis) => v - points[0]![axis]!);
      const b = points[2]!.map((v, axis) => v - points[0]![axis]!);
      const cross = [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];
      expect(cross.reduce((sum, v, axis) => sum + v * normal[axis]!, 0)).toBeGreaterThan(0);
    }
    expect(mesh.indices.length / 3).toBeLessThan(parts.length * 24);
  });

  it('removes internal faces of touching boxes and supports an empty part list', () => {
    const mesh = meshTreeParts([
      { min: [0, 0, 0], max: [1, 1, 1], role: 'trunk', tone: 0 },
      { min: [1, 0, 0], max: [2, 1, 1], role: 'trunk', tone: 0 },
    ]);
    expect(mesh.indices.length / 3).toBe(12);
    expect(meshTreeParts([]).position.length).toBe(0);
  });

  it('ships a self-contained GLB whose buffers match the same model source', () => {
    const file = readFileSync(new URL('../../models/tree.glb', import.meta.url));
    expect(file.readUInt32LE(0)).toBe(0x46546c67); expect(file.readUInt32LE(4)).toBe(2); expect(file.readUInt32LE(8)).toBe(file.length);
    const jsonLength = file.readUInt32LE(12), json = JSON.parse(file.subarray(20, 20 + jsonLength).toString());
    expect(file.readUInt32LE(16)).toBe(0x4e4f534a);
    const binaryOffset = 20 + jsonLength;
    expect(file.readUInt32LE(binaryOffset + 4)).toBe(0x004e4942);
    expect(json.buffers).toEqual([{ byteLength: file.readUInt32LE(binaryOffset) }]);
    expect(json.images).toBeUndefined(); expect(json.textures).toBeUndefined();
    const source = buildTreeMesh({ ...tree, x: 0, y: 0, z: 0 });
    const primitive = json.meshes[0].primitives[0];
    for (const [key, data] of Object.entries({ POSITION: source.position, NORMAL: source.normal, TEXCOORD_0: source.uv, COLOR_0: source.color, indices: source.indices })) {
      const accessor = json.accessors[key === 'indices' ? primitive.indices : primitive.attributes[key]], view = json.bufferViews[accessor.bufferView];
      expect(view.byteOffset % 4).toBe(0);
      const actual = file.subarray(binaryOffset + 8 + view.byteOffset, binaryOffset + 8 + view.byteOffset + view.byteLength);
      expect(actual.equals(Buffer.from(data.buffer, data.byteOffset, data.byteLength))).toBe(true);
    }
  });
});
