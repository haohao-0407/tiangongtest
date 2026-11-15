/** Regenerate the portable model with: node --import tsx scripts/export-tree-model.mjs */
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { buildTreeMesh } from '../assets/voxel/tree-mesh.ts';

const tree = { id: 'tree-model', x: 0, y: 0, z: 0, trunkHeight: 4, crownRadius: 2, variant: 0, rotation: 0 };
const mesh = buildTreeMesh(tree);
const buffers = [], bufferViews = [], accessors = [];
let byteOffset = 0;
const attribute = (data, type, width, target, bounds = false) => {
  const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  bufferViews.push({ buffer: 0, byteOffset, byteLength: bytes.length, target });
  const accessor = { bufferView: bufferViews.length - 1, componentType: data instanceof Uint32Array ? 5125 : 5126,
    count: data.length / width, type };
  if (bounds) {
    accessor.min = Array.from({ length: width }, () => Infinity);
    accessor.max = Array.from({ length: width }, () => -Infinity);
    for (let i = 0; i < data.length; i++) {
      accessor.min[i % width] = Math.min(accessor.min[i % width], data[i]);
      accessor.max[i % width] = Math.max(accessor.max[i % width], data[i]);
    }
  }
  accessors.push(accessor); buffers.push(bytes); byteOffset += bytes.length;
  return accessors.length - 1;
};
const attributes = {
  POSITION: attribute(mesh.position, 'VEC3', 3, 34962, true),
  NORMAL: attribute(mesh.normal, 'VEC3', 3, 34962),
  TEXCOORD_0: attribute(mesh.uv, 'VEC2', 2, 34962),
  COLOR_0: attribute(mesh.color, 'VEC4', 4, 34962),
};
const indices = attribute(mesh.indices, 'SCALAR', 1, 34963);
const document = {
  asset: { version: '2.0', generator: 'Senyu shared treeParts / tree-mesh.ts' },
  scene: 0, scenes: [{ name: 'Senyu tree', nodes: [0] }],
  nodes: [{ name: 'Layered voxel tree', mesh: 0, extras: { ...tree, source: 'assets/voxel/trees.ts' } }],
  meshes: [{ name: 'Unified trunk branches and canopy', primitives: [{ attributes, indices, material: 0, mode: 4 }] }],
  materials: [{ name: 'Bark and three foliage greens', pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: .95 } }],
  buffers: [{ byteLength: byteOffset }], bufferViews, accessors,
};
const json = Buffer.from(JSON.stringify(document)), jsonPadding = (4 - json.length % 4) % 4;
const jsonChunk = Buffer.concat([json, Buffer.alloc(jsonPadding, 0x20)]);
const binary = Buffer.concat(buffers);
const output = Buffer.alloc(12 + 8 + jsonChunk.length + 8 + binary.length);
output.writeUInt32LE(0x46546c67, 0); output.writeUInt32LE(2, 4); output.writeUInt32LE(output.length, 8);
output.writeUInt32LE(jsonChunk.length, 12); output.writeUInt32LE(0x4e4f534a, 16); jsonChunk.copy(output, 20);
const binOffset = 20 + jsonChunk.length;
output.writeUInt32LE(binary.length, binOffset); output.writeUInt32LE(0x004e4942, binOffset + 4); binary.copy(output, binOffset + 8);
const target = new URL('../assets/models/tree.glb', import.meta.url);
await mkdir(new URL('../assets/models/', import.meta.url), { recursive: true });
await writeFile(target, output);
console.log(JSON.stringify({ path: fileURLToPath(target), bytes: output.length, vertices: mesh.position.length / 3,
  triangles: mesh.indices.length / 3, min: accessors[0].min, max: accessors[0].max }));
