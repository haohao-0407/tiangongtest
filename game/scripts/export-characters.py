"""Run with Blender --background --factory-startup --python scripts/export-characters.py."""
import json
import struct
import tempfile
from pathlib import Path

import bpy
from mathutils import Matrix


MODELS = Path(__file__).resolve().parents[1] / "assets" / "models"
SOURCE = MODELS / "character-assets" / "characters"
WALKS = {"Walk_Forward", "Walk_Backward", "Walk_Left", "Walk_Right"}


def assemble():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    palette = bpy.data.materials.new("Villager palette")
    palette.diffuse_color = (1, 1, 1, 1)
    palette.roughness = 0.9
    master = None
    for number in range(1, 23):
        parts = []
        for folder, name in [(f"heads/Head_{number}", f"Head_{number}"),
                             ("upper_body", f"upper_body_{number}"),
                             ("lower_body", f"lower_body_{number}"),
                             ("shoes", f"shoes_{number}")]:
            before = set(bpy.data.actions)
            bpy.ops.import_scene.fbx(filepath=str(SOURCE / folder / f"{name}.fbx"))
            imported = bpy.context.selected_objects
            rig, = [obj for obj in imported if obj.type == "ARMATURE"]
            mesh, = [obj for obj in imported if obj.type == "MESH"]
            if master is None:
                master = rig
                actions = set(bpy.data.actions) - before
                for action in actions:
                    action.name = action.name.split("|")[-1]
                assert {action.name for action in actions} == WALKS
                master.animation_data.action = None
            else:
                assert list(rig.data.bones.keys()) == list(master.data.bones.keys())
                transform = mesh.matrix_world.copy()
                mesh.parent = master
                mesh.matrix_world = transform
                for modifier in mesh.modifiers:
                    if modifier.type == "ARMATURE":
                        modifier.object = master
                bpy.data.objects.remove(rig, do_unlink=True)
                for action in set(bpy.data.actions) - before:
                    bpy.data.actions.remove(action)
            data = mesh.data
            colors = data.color_attributes.new(name="Palette", type="BYTE_COLOR", domain="CORNER")
            for face in data.polygons:
                color = data.materials[face.material_index].diffuse_color
                for corner in face.loop_indices:
                    colors.data[corner].color = color
            data.materials.clear()
            data.materials.append(palette)
            parts.append(mesh)
        bpy.ops.object.select_all(action="DESELECT")
        for part in parts:
            part.select_set(True)
        bpy.context.view_layer.objects.active = parts[0]
        bpy.ops.object.join()
        body = bpy.context.object
        body.name = body.data.name = f"Villager-{number:02d}"
    for bone in master.pose.bones:
        bone.matrix_basis = Matrix.Identity(4)
    bpy.context.scene.render.fps = 24


def export():
    # One scene supplies the rig. The game binds the chosen outfit to its mesh node.
    with tempfile.TemporaryDirectory(dir=MODELS) as folder:
        path = Path(folder) / "all.glb"
        bpy.ops.export_scene.gltf(filepath=str(path), export_format="GLB",
                                  export_vertex_color="ACTIVE", export_all_vertex_colors=False,
                                  export_animation_mode="ACTIONS", export_current_frame=False,
                                  export_rest_position_armature=True, export_yup=True,
                                  export_cameras=False, export_lights=False)
        blob = path.read_bytes()
    length, = struct.unpack_from("<I", blob, 12)
    doc = json.loads(blob[20:20 + length])
    nodes = doc["nodes"]
    bodies = sorted((i for i, node in enumerate(nodes) if "mesh" in node), key=lambda i: nodes[i]["name"])
    assert len(bodies) == 22 and len(doc["skins"]) == 1 and len(doc["skins"][0]["joints"]) == 22
    assert {clip["name"] for clip in doc["animations"]} == WALKS
    for mesh in doc["meshes"]:
        primitive, = mesh["primitives"]
        assert {"COLOR_0", "JOINTS_0", "WEIGHTS_0"} <= primitive["attributes"].keys()
    unused = set(bodies[1:])
    scene, = doc["scenes"]
    scene["name"] = "Villager-01"
    scene["nodes"] = [i for i in scene["nodes"] if i not in unused]
    for node in nodes:
        if "children" in node:
            node["children"] = [i for i in node["children"] if i not in unused]
    material, = doc["materials"]
    material["pbrMetallicRoughness"].update(baseColorFactor=[1, 1, 1, 1], roughnessFactor=0.9)
    encoded = json.dumps(doc, separators=(",", ":")).encode()
    encoded += b" " * (-len(encoded) % 4)
    binary_chunk = blob[20 + length:]
    (MODELS / "villagers.glb").write_bytes(struct.pack("<4sIIII", b"glTF", 2,
        20 + len(encoded) + len(binary_chunk), len(encoded), 0x4E4F534A) + encoded + binary_chunk)


assemble()
export()
