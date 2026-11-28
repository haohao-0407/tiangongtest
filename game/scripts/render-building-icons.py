"""Render the build catalog atlas with Blender in background mode."""
import json
import re
from math import cos, radians, sin, sqrt
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"
TILE = 128
COLUMNS = 8
PALETTE = {
    "wood": "#a97943", "trim": "#69523b", "plank": "#c39356", "steel": "#899fae",
    "dark": "#2e4247", "solar": "#4d7d96", "green": "#63935e", "gold": "#e5c66f",
    "white": "#e9eee4", "cold": "#568b9b", "stone": "#9ca9a5", "soil": "#8f5c42",
    "clay": "#b97050", "clayEdge": "#cd8960", "fire": "#ec7c3f", "flame": "#ffe39b",
    "grass": "#82a35f",
}


def linear_srgb(hex_color):
    rgb = [int(hex_color[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4 for v in rgb) + (1,)


def box(center, size, color):
    bpy.ops.mesh.primitive_cube_add(size=1, location=center)
    obj = bpy.context.object
    obj.scale = size
    channel = obj.data.color_attributes.new(name="Color", type="FLOAT_COLOR", domain="POINT")
    for entry in channel.data:
        entry.color = linear_srgb(color if color.startswith("#") else PALETTE[color])
    return obj


def import_meshes(source):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(ASSETS / "models" / source))
    return {
        obj.name: obj for obj in bpy.data.objects
        if obj not in before and obj.type == "MESH"
    }


# Simple voxel previews for catalog entries that do not yet have exported art.
# Coordinates use Blender's Z-up convention: center, dimensions, palette swatch.
PLACEHOLDERS = {
    "flourMill": [
        ((0, 0, .19), (1.66, .76, .38), "wood"),
        ((-.25, 0, .47), (.85, .55, .16), "stone"),
        ((-.25, 0, .47), (.58, .78, .16), "stone"),
        ((-.25, 0, .65), (.79, .55, .16), "stone"),
        ((-.25, 0, .65), (.54, .78, .16), "stone"),
        ((-.25, 0, .77), (.12, .12, .12), "dark"),
        ((.02, 0, .82), (.66, .10, .09), "wood"),
        ((.30, 0, .92), (.10, .10, .19), "wood"),
    ],
    "floor": [
        ((x, 0, .043), (.184, .98, .086), "plank" if i % 3 == 0 else "wood")
        for i, x in enumerate((-.392, -.196, 0, .196, .392))
    ],
    "fence": [
        ((x, 0, .52), (.13, .17, .98), "wood") for x in (-.43, .43)
    ] + [
        ((0, 0, height), (.88, .11, .105), "plank") for height in (.38, .70)
    ],
    "solar": [
        ((0, 0, .35), (.18, .18, .70), "steel"),
        ((0, 0, .075), (.36, .36, .15), "dark"),
        ((0, 0, .75), (1.43, 1.22, .12), "dark"),
    ] + [
        ((x, y, .822), (.29, .326, .035), "solar")
        for x in (-.49, -.163, .163, .49) for y in (-.368, 0, .368)
    ],
    "battery": [
        ((0, 0, .42), (.7, .7, .84), "dark"),
        ((0, 0, .81), (.74, .74, .095), "steel"),
        ((-.18, 0, .90), (.12, .15, .13), "gold"),
        ((.18, 0, .90), (.12, .15, .13), "steel"),
        ((0, -.358, .44), (.43, .032, .42), "green"),
    ],
    "cooler": [
        ((0, 0, .63), (.83, .83, 1.23), "white"),
        ((0, -.429, .858), (.73, .075, .66), "cold"),
        ((0, -.429, .30), (.73, .075, .365), "cold"),
        ((.248, -.48, .79), (.067, .06, .28), "steel"),
    ],
    "sculpture": [
        ((0, 0, .09), (.65, .59, .18), "trim"),
        ((0, 0, .25), (.48, .45, .15), "stone"),
        ((0, 0, .50), (.28, .27, .4), "stone"),
        ((0, 0, .73), (.48, .28, .21), "stone"),
        ((0, 0, .93), (.265, .24, .25), "white"),
    ],
    "vase": [
        ((0, 0, .08), (.44, .44, .16), "clay"),
        ((0, 0, .32), (.64, .6, .39), "clay"),
        ((0, 0, .53), (.48, .45, .15), "clayEdge"),
        ((0, 0, .665), (.29, .27, .19), "clay"),
        ((0, 0, .775), (.38, .36, .095), "clayEdge"),
        ((0, 0, .824), (.235, .22, .014), "soil"),
    ],
    "torch": [
        ((0, 0, .34), (.125, .125, .68), "wood"),
        ((0, 0, .62), (.185, .185, .12), "trim"),
        ((0, 0, .76), (.255, .25, .22), "fire"),
        ((.026, 0, .87), (.16, .15, .17), "gold"),
        ((-.035, -.113, .78), (.091, .043, .138), "flame"),
    ],
    "floorLamp": [
        ((0, 0, .055), (.47, .47, .11), "dark"),
        ((0, 0, .55), (.09, .09, .99), "steel"),
        ((0, 0, 1.08), (.52, .52, .27), "gold"),
        ((0, 0, .945), (.6, .6, .055), "trim"),
        ((0, 0, 1.23), (.39, .39, .067), "trim"),
    ],
    "chandelier": [
        ((0, 0, .71), (.085, .085, .56), "dark"),
        ((0, 0, .42), (.86, .115, .095), "trim"),
        ((0, 0, .42), (.115, .86, .095), "trim"),
    ] + [
        ((x, y, height), (width, width, depth), color)
        for x, y in [(-.39, 0), (.39, 0), (0, -.39), (0, .39)]
        for height, width, depth, color in [(.50, .15, .14, "gold"), (.62, .078, .10, "flame")]
    ],
}


def arrange(objects, column, row, row_count):
    # Aim diagonally across the front and right sides, at a 35° elevation.
    points = [obj.matrix_world @ Vector(corner) for obj in objects for corner in obj.bound_box]
    x_span, y_span = [[point.dot(axis) for point in points] for axis in (RIGHT, UP)]
    span = max(max(x_span) - min(x_span), max(y_span) - min(y_span))
    projected_center = (RIGHT * (min(x_span) + max(x_span)) + UP * (min(y_span) + max(y_span))) / 2
    depth_center = (min(p.dot(VIEW) for p in points) + max(p.dot(VIEW) for p in points)) / 2
    center = projected_center + VIEW * depth_center
    position = RIGHT * (column + .5 - COLUMNS / 2) + UP * (row_count / 2 - row - .5)
    factor = .81 / span
    for obj in objects:
        obj.location = position + (obj.location - center) * factor
        obj.scale *= factor
        obj.hide_render = False


contracts = (ASSETS / "colony/contracts.ts").read_text(encoding="utf-8")
catalog = contracts.split("export const BUILDING_DEFS", 1)[1].split("\n};", 1)[0]
kinds = re.findall(r"^\s*(\w+)\s*:\s*\{\s*id\s*:", catalog, re.M)
# Use the same cuboids as the scene for the two textile equipment thumbnails.
for name, parts in json.loads((ASSETS / "colony/textile-models.json").read_text()).items():
    PLACEHOLDERS[name] = [
        ((x, -z, y), (w, d, h), part["color"])
        for part in parts for x, y, z in [part["center"]] for w, h, d in [part["size"]]
    ]
# These three use standalone menu symbols. Preserve the existing atlas slot order.
previous = json.loads((ASSETS / "ui/building-icons.json").read_text())["tiles"]
kinds = [kind for kind in kinds if kind not in ("pastureGate", "milker", "henNest")]
kinds.sort(key=lambda k: previous[k][1] * COLUMNS + previous[k][0] if k in previous else len(kinds) + 1000)
assert kinds and len(kinds) == len(set(kinds))
rows = (len(kinds) + COLUMNS - 1) // COLUMNS
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
buildings = import_meshes("buildings.glb")
plaza = import_meshes("campfire-plaza.glb")
for obj in (*buildings.values(), *plaza.values()):
    obj.hide_render = True

angle = radians(35)
VIEW = Vector((cos(angle) / sqrt(2), -cos(angle) / sqrt(2), sin(angle)))
RIGHT = VIEW.cross(Vector((0, 0, -1))).normalized()
UP = VIEW.cross(RIGHT)

tiles = {}
for index, kind in enumerate(kinds):
    row, column = divmod(index, COLUMNS)
    tiles[kind] = [column, row]
    if kind == "campfirePlaza":
        layers = ["ground", "hearth", "stage", "banquet", "seating", "decor", "food", "lanterns", "flames"]
        subjects = [plaza[layer] for layer in layers]
        subjects.append(box((0, 0, -.43), (26, 22, .7), "grass"))
    elif kind in ("workbench", "carpenterBench"):
        obj = buildings["fabricator"].copy()
        bpy.context.collection.objects.link(obj)
        subjects = [obj]
    elif kind in buildings:
        subjects = [buildings[kind]]
        # Blender uses Z up. Match the proportions of the free-standing wall in game.
        if kind in ("wall", "woodWall", "brickWall", "greenhouseWall"):
            subjects[0].dimensions = (1, 6/16, 29/16 if kind == "wall" else 2)
    else:
        subjects = [box(*part) for part in PLACEHOLDERS[kind]]
    bpy.context.view_layer.update()
    arrange(subjects, column, row, rows)

bpy.ops.object.camera_add(location=VIEW * 20)
camera = bpy.context.object
camera.rotation_euler = (-VIEW).to_track_quat("-Z", "Y").to_euler()
camera.data.type = "ORTHO"
camera.data.ortho_scale = COLUMNS
scene.camera = camera
scene.render.engine = "BLENDER_WORKBENCH"
scene.render.resolution_x = COLUMNS * TILE
scene.render.resolution_y = rows * TILE
scene.render.resolution_percentage = 100
scene.render.film_transparent = True
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA"
scene.view_settings.view_transform = "Standard"
scene.view_settings.exposure = .36
shading = scene.display.shading
shading.light = "STUDIO"
shading.studiolight_rotate_z = .28
shading.color_type = "VERTEX"
shading.show_cavity = True
shading.cavity_type = "BOTH"
shading.cavity_ridge_factor = .8
shading.cavity_valley_factor = 1
shading.show_shadows = False
scene.display.render_aa = "16"
scene.render.filepath = str(ASSETS / "ui/building-icons.png")
bpy.ops.render.render(write_still=True)
(ASSETS / "ui/building-icons.json").write_text(
    json.dumps({"columns": COLUMNS, "rows": rows, "tiles": tiles}, indent=2) + "\n", encoding="utf-8"
)
