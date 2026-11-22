"""Run with Blender -b Voxel_Campfire_Finale.blend -P scripts/export-campfire-plaza.py."""
from collections import defaultdict
from pathlib import Path
import bpy

scene = bpy.context.scene
scene.frame_set(252)
depsgraph = bpy.context.evaluated_depsgraph_get()


def layer(obj):
    collection = obj.users_collection[0].name[:2]
    name = obj.name
    if name.startswith(("灯盖", "灯座", "灯框", "灯芯")):
        return "lanterns"
    if collection == "01":
        # The game terrain supplies the grass and foundation.
        return "ground" if name.startswith(("主通道", "餐区通道", "围坐场地")) else None
    if collection == "02":
        return "seating" if "凳" in name else "hearth"
    if collection == "03":
        return "seating" if "凳" in name else "banquet"
    if collection == "04":
        return "banquet" if name.startswith(("备餐", "饮品木桶", "桶")) else "food"
    if collection == "05":
        return "stage"
    if collection == "06":
        return "decor"
    if collection == "09":
        if name.startswith("Voxel fire tongue"):
            return "flames"
        if name.startswith("Finale title"):
            return "title"
        if name.startswith("Voxel meteor pixel"):
            return "meteor"
        if name.startswith("Finale / "):
            if name.startswith(("Finale / sky ", "Finale / moss")):
                return None
            if "star_" in name:
                return "sky"
            if "leaf" in name or "flag" in name:
                return "decor"
            if "soil" in name:
                return "ground"
            return "hearth"
    return None


groups = defaultdict(list)
for obj in scene.objects:
    key = layer(obj) if obj.type == "MESH" and not obj.hide_render else None
    if key:
        groups[key].append(obj)
assert len([obj for obj in groups["lanterns"] if obj.name.startswith("灯芯")]) == 12
assert len([obj for obj in groups["seating"] if obj.name.startswith("餐桌长凳座板")]) == 8

# Bake evaluated bevels, transforms and the original linear palette. Keep the
# emitting wicks, fire, lettering and sky stars as their own glTF materials.
palette = bpy.data.materials.new("Plaza vertex palette")
palette.use_nodes = True
shader = next(n for n in palette.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
attribute = palette.node_tree.nodes.new("ShaderNodeVertexColor")
attribute.layer_name = "Palette"
palette.node_tree.links.new(attribute.outputs["Color"], shader.inputs["Base Color"])
shader.inputs["Roughness"].default_value = .9
baked = []
for key, objects in groups.items():
    points, faces, swatches, material_ids = [], [], [], []
    materials = [palette]
    for source in objects:
        obj = source.evaluated_get(depsgraph)
        mesh = obj.to_mesh()
        offset = len(points)
        for vertex in mesh.vertices:
            p = obj.matrix_world @ vertex.co
            if "leaf" in source.name:
                p.x *= 13 / 13.45
            points.append(tuple(p))
        for face in mesh.polygons:
            faces.append(tuple(offset + i for i in face.vertices))
            mat = obj.material_slots[face.material_index].material
            node = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
            emit = node.inputs["Emission Strength"].default_value > 0
            if emit and mat not in materials:
                materials.append(mat)
            material_ids.append(materials.index(mat) if emit else 0)
            swatches.append((1, 1, 1, 1) if emit else tuple(node.inputs["Base Color"].default_value))
        obj.to_mesh_clear()
    mesh = bpy.data.meshes.new(key)
    mesh.from_pydata(points, [], faces)
    mesh.update()
    for material in materials:
        mesh.materials.append(material)
    colors = mesh.color_attributes.new(name="Palette", type="BYTE_COLOR", domain="CORNER")
    for face, swatch, material_id in zip(mesh.polygons, swatches, material_ids):
        face.material_index = material_id
        for loop in face.loop_indices:
            colors.data[loop].color = swatch
    result = bpy.data.objects.new(key, mesh)
    scene.collection.objects.link(result)
    baked.append(result)
bpy.ops.object.select_all(action="DESELECT")
for obj in baked:
    obj.select_set(True)
path = Path(__file__).resolve().parents[1] / "assets/models/campfire-plaza.glb"
bpy.ops.export_scene.gltf(filepath=str(path), use_selection=True, export_format="GLB",
                          export_animations=False, export_yup=True, export_vertex_color="ACTIVE")

