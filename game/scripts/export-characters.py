"""Bake the 17 approved FBX residents and their own skin and walk clips for ForgeAX."""
from pathlib import Path

import bpy
from mathutils import Matrix


MODELS = Path(__file__).resolve().parents[1] / "assets" / "models"
SOURCE = MODELS / "character-assets" / "all_characters_17"
BODY_PARTS = ("Head_", "UpperBody_", "LowerBody_", "Shoes_")
WALKS = {"Walk_Forward", "Walk_Backward", "Walk_Left", "Walk_Right"}


def bake_resident(source, destination, name, shared_material):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=str(source))
    scene = bpy.context.scene
    scene.name = name
    scene.render.fps = 24
    rig, = [obj for obj in scene.objects if obj.type == "ARMATURE"]
    assert len(rig.data.bones) == 22, source
    rig.animation_data.action = None
    for bone in rig.pose.bones:
        bone.matrix_basis = Matrix.Identity(4)

    for action in bpy.data.actions:
        action.name = action.name.rsplit("|", 1)[-1]
        action.use_fake_user = True
    assert {action.name for action in bpy.data.actions} == WALKS, source

    # Gameplay attaches the held item separately. Keep the four dressed body
    # parts and their weights from the approved full-character file.
    meshes = [obj for obj in scene.objects if obj.type == "MESH"]
    parts = []
    for prefix in BODY_PARTS:
        part, = [mesh for mesh in meshes if mesh.name.startswith(prefix)]
        parts.append(part)
    for prop in meshes:
        if prop not in parts:
            bpy.data.objects.remove(prop, do_unlink=True)

    palette = None
    if shared_material:
        palette = bpy.data.materials.new("Villager palette")
        palette.use_nodes = True
        shader = palette.node_tree.nodes.get("Principled BSDF")
        shader.inputs["Base Color"].default_value = (1, 1, 1, 1)
        shader.inputs["Metallic"].default_value = 0
        shader.inputs["Roughness"].default_value = .9

    for part in parts:
        mesh = part.data
        colors = mesh.color_attributes.new(name="Palette", type="BYTE_COLOR", domain="CORNER")
        swatches = [tuple(material.diffuse_color) for material in mesh.materials]
        for face in mesh.polygons:
            for corner in face.loop_indices:
                colors.data[corner].color = swatches[face.material_index]
        mesh.color_attributes.active_color = colors
        mesh.materials.clear()
        if palette:
            mesh.materials.append(palette)

    bpy.ops.object.select_all(action="DESELECT")
    for part in parts:
        part.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    body = bpy.context.object
    body.name = body.data.name = name
    bpy.context.view_layer.update()
    ground = min((body.matrix_world @ vertex.co).z for vertex in body.data.vertices)
    rig.location.z -= ground
    bpy.context.view_layer.update()

    bpy.ops.export_scene.gltf(filepath=str(destination), export_format="GLB",
                              export_materials="EXPORT" if shared_material else "NONE",
                              export_vertex_color="ACTIVE", export_all_vertex_colors=False,
                              export_texcoords=False, export_animation_mode="ACTIONS",
                              export_current_frame=False, export_rest_position_armature=True,
                              export_yup=True, export_cameras=False, export_lights=False)


outfits = sorted(SOURCE.glob("*/Villager_*.fbx"))
assert len(outfits) == 17
directory = MODELS / "villagers"
directory.mkdir(exist_ok=True)
for number, source in enumerate(outfits, 1):
    assert source.parent.name.startswith(f"{number:02d}_"), source
    name = f"Villager-{number:02d}"
    destination = MODELS / "villagers.glb" if number == 1 else directory / f"{name.lower()}.glb"
    # Import one skinned palette material for the complete roster.
    bake_resident(source, destination, name, shared_material=number == 1)
