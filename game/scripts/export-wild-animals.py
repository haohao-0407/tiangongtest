"""Bake the three agriculture FBXs into named, ground-centred ForgeAX meshes with Blender."""
from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix, Vector

MODELS = Path(__file__).resolve().parents[1] / "assets" / "models"
SOURCES = {"chicken": "Feather/Chicken_1x2.fbx", "cow": "Hide/Cow_1x2.fbx", "sheep": "Wool/Sheep_1x2.fbx"}

bpy.ops.wm.read_factory_settings(use_empty=True)

for kind, relative in SOURCES.items():
    bpy.ops.import_scene.fbx(filepath=str(MODELS / "FBX/Agriculture/Animals" / relative))
    obj, = [o for o in bpy.context.selected_objects if o.type == "MESH"]
    mesh = obj.data
    mesh.transform(obj.matrix_world)
    obj.parent = None
    obj.matrix_world = Matrix.Identity(4)
    lo, hi = [Vector([op(v.co[i] for v in mesh.vertices) for i in range(3)]) for op in (min, max)]
    center = Vector(((hi.x+lo.x)/2, (hi.y+lo.y)/2, lo.z))
    mesh.transform(Matrix.Translation(-center))
    colors = []
    for material in mesh.materials:
        base = material.node_tree.nodes.get("Principled BSDF").inputs["Base Color"]
        assert not base.is_linked, f"Expected an untextured FBX swatch: {material.name}"
        colors.append(tuple(base.default_value))
    # The FBXs contain 9 cm voxels separated by 2 mm seams. Close those seams
    # before removing opposing interior faces and merging coplanar swatches.
    bm = bmesh.new()
    bm.from_mesh(mesh)
    origin = lo - center
    grid = {v: tuple(round((v.co[i]-origin[i])/.09) for i in range(3)) for v in bm.verts}
    for vert, cell in grid.items():
        vert.co = origin + Vector(cell)*.09
    outer, internal = {}, []
    for face in bm.faces:
        key = tuple(sorted(grid[v] for v in face.verts))
        if key in outer:
            internal.extend((outer.pop(key), face))
        else:
            outer[key] = face
    bmesh.ops.delete(bm, geom=internal, context='FACES')
    bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=.00001)
    bm.normal_update()
    bmesh.ops.dissolve_limit(bm, angle_limit=.001, verts=list(bm.verts), edges=list(bm.edges),
                             delimit={'MATERIAL'})
    bm.to_mesh(mesh)
    bm.free()
    attr = mesh.color_attributes.new(name="Palette", type="BYTE_COLOR", domain="CORNER")
    for face in mesh.polygons:
        for loop in face.loop_indices:
            attr.data[loop].color = colors[face.material_index]
    mesh.materials.clear()
    mesh.color_attributes.active_color = attr
    obj.name = mesh.name = kind

bpy.ops.export_scene.gltf(filepath=str(MODELS / "wild-animals.glb"), export_format="GLB",
                          export_materials="NONE", export_vertex_color="ACTIVE", export_yup=True, export_animations=False)
