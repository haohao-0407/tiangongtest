"""blender -b -P scripts/export-homestead-models.py -- <delivery-directory>"""
import json
import runpy
import sys
from pathlib import Path

import bpy
from mathutils import Vector


SCRIPTS = Path(__file__).resolve().parent
MODELS = SCRIPTS.parent / "assets/models"
root = Path(sys.argv[sys.argv.index("--") + 1])
sources = {p.parent.name: (p.parent, json.loads(p.read_text(encoding="utf-8-sig")))
           for p in root.rglob("asset_info.json")}
kinds = ["guide", "pig", "fence", "pastureGate", "milker", "henNest", "sugarPress",
         "shearingStand", "loom", "flourMill", "cooler", "solar", "battery", "torch",
         "floorLamp", "chandelier", "sculpture", "vase"]
assert len(sources) == 19
bake = runpy.run_path(str(SCRIPTS / "export-buildings.py"))["bake"]
bake_character = runpy.run_path(str(SCRIPTS / "export-characters.py"))["bake_resident"]

bpy.ops.wm.read_factory_settings(use_empty=True)
palettes = {}
for name, (directory, info) in sorted(sources.items()):
    kind = kinds[int(name[:2]) - 1]
    path = directory / (name + ".fbx")
    if kind == "guide":
        guide = path
        continue
    if name.endswith("_Corner"):
        kind = "fenceCorner"

    def anchor(p, center):
        if kind == "fenceCorner":
            # Corner post in the source is (-.8, 0). Arms point +X and +Y.
            return Vector((p.x + .8, p.y, p.z))
        if kind == "pastureGate":
            return p.copy()  # footing or hinge-post centreline
        if kind == "flourMill":
            v = p - center
            return Vector((v.y, -v.x, v.z))  # long axis of the existing 2x1 station
        if kind == "chandelier":
            return p - Vector((0, 0, info["bounds_max"][2]))
        return p - center

    lo, hi = bake(kind, path, palettes, anchor)
    for actual, specified in zip(hi - lo, info["dimensions_m"]):
        assert abs(actual - specified) < .012, (name, tuple(hi-lo), info["dimensions_m"])
bpy.ops.export_scene.gltf(filepath=str(MODELS / "homestead.glb"), export_format="GLB",
                          export_materials="NONE", export_vertex_color="ACTIVE", export_yup=True, export_animations=False)
bake_character(guide, MODELS / "guide-merchant.glb", "GuideMerchant", False, whole_character=True)
