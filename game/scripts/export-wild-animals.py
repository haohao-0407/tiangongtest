"""Bake the approved chicken, cow and sheep FBXs into ground-centred ForgeAX meshes."""
from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix, Vector


MODELS = Path(__file__).resolve().parents[1] / "assets" / "models"
SOURCES = {
    "chicken": "Feather/Chicken_1x2.fbx",
    "cow": "Hide/Cow_1x2.fbx",
    "sheep": "Wool/Sheep_1x2.fbx",
}
VOXEL_SPACING = {"chicken": .0612, "cow": .09}


def compact_shell(mesh, spacing):
    """Remove the hidden walls between adjacent cubes in the regular grids."""
    shell = bmesh.new()
    shell.from_mesh(mesh)
    origin = Vector([min(v.co[axis] for v in shell.verts) for axis in range(3)])
    cells = {v: tuple(round(value / spacing) for value in v.co - origin) for v in shell.verts}
    assert all((origin + Vector(cell) * spacing - v.co).length < .004 for v, cell in cells.items())
    for v, cell in cells.items():
        v.co = origin + Vector(cell) * spacing
    pairs = {}
    for face in shell.faces:
        key = tuple(sorted(cells[v] for v in face.verts))
        pairs.setdefault(key, []).append(face)
    hidden = [face for pair in pairs.values()
              if len(pair) == 2 and pair[0].normal.dot(pair[1].normal) < -.99 for face in pair]
    bmesh.ops.delete(shell, geom=hidden, context="FACES")
    bmesh.ops.remove_doubles(shell, verts=list(shell.verts), dist=.00001)
    shell.normal_update()
    bmesh.ops.dissolve_limit(shell, angle_limit=.001, verts=list(shell.verts),
                             edges=list(shell.edges), delimit={"MATERIAL"})
    shell.to_mesh(mesh)
    shell.free()

bpy.ops.wm.read_factory_settings(use_empty=True)

for kind, relative in SOURCES.items():
    bpy.ops.import_scene.fbx(filepath=str(MODELS / "FBX/Agriculture/Animals" / relative))
    parts = [obj for obj in bpy.context.selected_objects if obj.type == "MESH"]
    assert parts, relative
    # All authored parts keep their world transforms and palette. In particular,
    # the sheep's individual wool blocks are joined without resnapping vertices.
    for part in parts:
        mesh = part.data
        if kind in VOXEL_SPACING:
            compact_shell(mesh, VOXEL_SPACING[kind])
        colors = mesh.color_attributes.new(name="Palette", type="BYTE_COLOR", domain="CORNER")
        swatches = [tuple(material.diffuse_color) for material in mesh.materials]
        for face in mesh.polygons:
            for corner in face.loop_indices:
                colors.data[corner].color = swatches[face.material_index]
        mesh.color_attributes.active_color = colors
        mesh.materials.clear()

    bpy.context.view_layer.objects.active = parts[0]
    if len(parts) > 1:
        bpy.ops.object.join()
    obj = bpy.context.object
    mesh = obj.data
    mesh.transform(obj.matrix_world)
    obj.parent = None
    obj.matrix_world = Matrix.Identity(4)
    low, high = [Vector([bound(v.co[axis] for v in mesh.vertices) for axis in range(3)])
                 for bound in (min, max)]
    center = Vector(((high.x + low.x) / 2, (high.y + low.y) / 2, low.z))
    mesh.transform(Matrix.Translation(-center))
    obj.name = mesh.name = kind

bpy.ops.export_scene.gltf(filepath=str(MODELS / "wild-animals.glb"), export_format="GLB",
                          export_materials="NONE", export_vertex_color="ACTIVE",
                          export_texcoords=False, export_yup=True, export_animations=False)
