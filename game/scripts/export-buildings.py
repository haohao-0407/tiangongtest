"""Bake the existing colony buildings from assets/models/FBX with Blender in background mode."""
from math import pi
from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix, Vector


MODELS = Path(__file__).resolve().parents[1] / "assets" / "models"
SOURCES = {f.stem: f for f in (MODELS / "FBX").rglob("*.fbx")}
# Output mesh names are the game's persistent building kinds.
BUILDINGS = {
    "wall": "RoughStoneWall_1x1", "woodWall": "WoodWall_1x1", "brickWall": "StoneBrickWall_1x1",
    "door": "WoodDoor_Rectangular_1x1", "doorOpen": "WoodDoor_Rectangular_1x1",
    "stoneDoor": "StoneDoor_Rectangular_1x1", "autoDoor": "IronDoor_RuralBlue_1x1",
    "bed": "SingleBed_1x2", "medicalBed": "SingleBed_1x2", "doubleBed": "DoubleBed_2x2",
    "bedroll": "FloorMat_1x2", "table": "DiningTable_2x2", "stool": "Stool_1x1",
    "chair": "Chair_1x1", "chest": "WoodenChest_1x1", "shelf": "StorageShelf_1x2",
    "painting": "PaintingEasel_1x1", "campfire": "CampfireStove_1x1", "campStove": "CampfireStove_1x1",
    "stove": "Stove_1x1", "stoneCutter": "StonecuttingTable_1x2", "forgery": "ForgeTable_1x2",
    "fabricator": "MechanicalWorkbench_2x1", "tailorBench": "SewingTable_1x2",
    "researchDesk": "ResearchTable_1x2", "advancedResearchDesk": "AdvancedResearchTable_1x2",
    "artBench": "ArtTable_1x2", "pickleBarrel": "PicklingVat_1x1", "brewBarrel": "BrewingBarrel_1x1",
    "cheesePress": "CheesePress_1x1", "hydroponics": "HydroponicBasin_1x1",
    "sprinkler": "IrrigatedPlanter_1x1", "planter": "IrrigatedPlanter_1x1",
    "greenhouseWall": "GreenhouseWall_1x1", "scarecrow": "Scarecrow_1x1", "compostBin": "CompostBin_1x1",
}


def included(kind, name):
    if kind == "campfire":
        return name.startswith(("Pit_", "Fire_", "Log_"))
    if kind == "planter":
        return not name.startswith(("tap_", "water_drop"))
    return True


def bounds(points):
    return [Vector([op(p[i] for p in points) for i in range(3)]) for op in (min, max)]


def bake(kind, path, palettes, transform=None):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=str(path))
    imported = set(bpy.data.objects) - before
    pieces = sorted((o for o in imported if o.type == "MESH" and included(kind, o.name)), key=lambda o: o.name)
    coords = {o: [o.matrix_world @ v.co for v in o.data.vertices] for o in pieces}
    lo, hi = bounds([p for points in coords.values() for p in points])
    center = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))
    if kind == "doorOpen":
        ends = bounds([p for o, points in coords.items() if "_Hinge" in o.name for p in points])
        hinge = (ends[0] + ends[1]) / 2
        leaf_left = min(p.x for o, points in coords.items() if "_Plank" in o.name for p in points)
        jamb_right = max(p.x for o, points in coords.items() if "_Frame_LeftJamb" in o.name for p in points)
        hinge.x = (leaf_left + jamb_right) / 2
        swing = Matrix.Rotation(-pi / 2, 3, 'Z')
    vertices, faces, colors, alphas = [], [], [], []
    for obj, points in coords.items():
        # FBX duplicates vertices at face boundaries. Weld within each authored part.
        welded = {}
        local_indices = []
        for p in points:
            if kind == "doorOpen" and "_Frame_" not in obj.name:
                p = hinge + swing @ (p - hinge)
            p = transform(p, center) if transform else p - center
            if kind in ("door", "doorOpen", "stoneDoor", "autoDoor"):
                p.y += .405
            if kind == "wall":
                # The PCG facade supplies axis-aligned solid panels around its window holes.
                p.y /= hi.y - lo.y
            key = tuple(round(v, 6) for v in p)
            if key not in welded:
                welded[key] = len(vertices)
                vertices.append(p)
            local_indices.append(welded[key])
        swatches = []
        for slot in obj.material_slots:
            mat = slot.material
            shader = next(node for node in mat.node_tree.nodes if node.type == "BSDF_PRINCIPLED")
            base = shader.inputs["Base Color"]
            assert not base.is_linked, f"Textured material needs UV export: {mat.name}"
            color = tuple(base.default_value)
            if kind == "medicalBed" and "Blanket" in obj.name:
                color = (.78, .86, .82, 1) if "Pixels" in obj.name else (.58, .71, .69, 1)
            swatches.append((color, round(shader.inputs["Alpha"].default_value, 3)))
        for face in obj.data.polygons:
            faces.append(tuple(local_indices[i] for i in face.vertices))
            color, alpha = swatches[face.material_index]
            colors.append(color)
            alphas.append(alpha)
    for obj in imported:
        bpy.data.objects.remove(obj, do_unlink=True)
    mesh = bpy.data.meshes.new(kind)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    # The voxel FBXs tessellate flat boards and stones into hundreds of coplanar quads.
    # Merge only faces sharing both their plane and their original swatch.
    swatches = list(dict.fromkeys(zip(colors, alphas)))
    indices = {swatch: i for i, swatch in enumerate(swatches)}
    bm = bmesh.new()
    bm.from_mesh(mesh)
    for face in bm.faces:
        face.material_index = indices[(colors[face.index], alphas[face.index])]
    bm.normal_update()
    bmesh.ops.dissolve_limit(bm, angle_limit=.001, verts=list(bm.verts), edges=list(bm.edges),
                             delimit={'MATERIAL'})
    bm.to_mesh(mesh)
    bm.free()
    attr = mesh.color_attributes.new(name="Palette", type="BYTE_COLOR", domain="CORNER")
    levels = sorted(set(alphas), reverse=True)
    for alpha in levels:
        if alpha not in palettes:
            mat = bpy.data.materials.new(f"Building palette {alpha}")
            mat.use_nodes = True
            shader = mat.node_tree.nodes.get("Principled BSDF")
            shader.inputs["Base Color"].default_value = (1, 1, 1, 1)
            shader.inputs["Roughness"].default_value = .88
            shader.inputs["Alpha"].default_value = alpha
            if alpha < 1:
                mat.surface_render_method = 'BLENDED'
            palettes[alpha] = mat
        mesh.materials.append(palettes[alpha])
    for face in mesh.polygons:
        color, alpha = swatches[face.material_index]
        face.material_index = levels.index(alpha)
        for i in face.loop_indices:
            attr.data[i].color = color
    bpy.context.collection.objects.link(bpy.data.objects.new(kind, mesh))
    return lo, hi


if __name__ == "__main__":
    bpy.ops.wm.read_factory_settings(use_empty=True)
    palettes = {}
    for kind, filename in BUILDINGS.items():
        bake(kind, SOURCES[filename], palettes)
    bpy.ops.export_scene.gltf(filepath=str(MODELS / "buildings.glb"), export_format="GLB",
                              export_vertex_color="ACTIVE", export_yup=True, export_animations=False)
