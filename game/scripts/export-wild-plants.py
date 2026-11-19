"""Run with Blender --background --factory-startup --python export-wild-plants.py."""
from math import atan2, cos, hypot, pi, sin
from pathlib import Path

import bpy
from mathutils import Euler

ROOT = Path(__file__).resolve().parents[1]
UNIT = 1 / 32
STEM, LEAF, TIP = "497547", "60964c", "9bbd62"


class Plant:
    def __init__(self):
        self.cells = {}

    def box(self, x, y, z, w, d, h, color):
        for i in range(x, x + w):
            for j in range(y, y + d):
                for k in range(z, z + h):
                    self.cells[i, j, k] = color

    def blade(self, x, y, z, dx, dy, h, shade=LEAF, width=2):
        px, py = x, y
        for k in range(h):
            t = (k + .5) / h
            w = width if t < .75 else max(1, width - 1)
            nx, ny = x + round(dx*t*t), y + round(dy*t*t)
            self.box(min(px,nx), min(py,ny), z+k, w+abs(nx-px), w+abs(ny-py), 1,
                     TIP if t > .82 else shade)
            px, py = nx, ny

    def stem(self, x, y, h):
        self.box(x, y, 0, 2, 2, h, STEM)
        self.blade(x, y, h//4, -4, 2, 5)
        self.blade(x+1, y, h//2, 4, -1, 4, TIP)

    def object(self, name, material):
        # Greedily join adjacent exposed faces sharing a swatch and surface normal.
        planes = {}
        for xyz, color in self.cells.items():
            for axis in range(3):
                u, v = (axis+1) % 3, (axis+2) % 3
                for sign in (-1, 1):
                    other = list(xyz)
                    other[axis] += sign
                    if tuple(other) not in self.cells:
                        plane = xyz[axis] + (sign > 0)
                        planes.setdefault((axis, sign, plane, color), set()).add((xyz[u], xyz[v]))
        verts, faces, shades = [], [], []
        for (axis, sign, plane, color), pixels in planes.items():
            while pixels:
                x, y = min(pixels)
                w = h = 1
                while (x+w, y) in pixels:
                    w += 1
                while all((x+i, y+h) in pixels for i in range(w)):
                    h += 1
                pixels.difference_update((x+i, y+j) for i in range(w) for j in range(h))
                corners = [(x,y), (x+w,y), (x+w,y+h), (x,y+h)]
                faces.append(tuple(range(len(verts), len(verts)+4)))
                for a, b in corners if sign > 0 else reversed(corners):
                    co = [0,0,0]
                    co[axis], co[(axis+1)%3], co[(axis+2)%3] = plane, a, b
                    verts.append(tuple(n * UNIT for n in co))
                shades.append(color)
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata(verts, [], faces)
        mesh.update()
        mesh.materials.append(material)
        attr = mesh.color_attributes.new(name="Palette", type="BYTE_COLOR", domain="CORNER")
        for face, color in zip(mesh.polygons, shades):
            rgb = tuple(int(color[j:j+2], 16) / 255 for j in (0, 2, 4))
            for idx in face.loop_indices:
                attr.data[idx].color_srgb = (*rgb, 1)
        obj = bpy.data.objects.new(name, mesh)
        bpy.context.collection.objects.link(obj)
        return obj


def daisy(p):
    for x,y,h in [(-4,1,14), (3,-3,10), (2,5,17)]:
        p.stem(x,y,h)
        for i in range(8):
            dx,dy = cos(i*pi/4),sin(i*pi/4)
            for r in (2,3,4):
                p.box(x+round(dx*r)-1,y+round(dy*r)-1,h+(r==4),2,2,1,
                      "fff4d7" if i%2 else "fffdfa")
        p.box(x-1,y-1,h+1,3,3,2,"eab539")


def poppy(p):
    for x,y,h in [(-3,1,21),(4,-3,14)]:
        p.stem(x,y,h)
        for dx,dy in [(1,0),(-1,0),(0,-1),(0,1)]:
            for r in range(1,6):
                w = 5 if r < 5 else 3
                p.box(x+dx*r-(w//2 if dy else 0), y+dy*r-(w//2 if dx else 0),
                      h+r//2, w if dy else 1, w if dx else 1, 2,
                      "fc6252" if r>3 else "d83a39")
        p.box(x-1,y-1,h+1,3,3,2,"493543")
    p.blade(0,1,0,2,3,12)


def lavender(p):
    for x,y,h in [(-5,0,18),(0,3,25),(5,-2,16),(-1,-4,21)]:
        p.stem(x,y,h)
        for i in range(4):
            z = h-7+i*3
            p.box(x-1,y,z,4,2,2,["7759ac","926dc9","ae86d7","c3a3e8"][i])
            if i < 3:
                p.box(x,y-1,z+1,2,4,2,"a77ad1")


def marigold(p):
    for x,y,h,r in [(-3,-1,14,5),(4,3,11,4)]:
        p.stem(x,y,h)
        for dx in range(-r,r+1):
            for dy in range(-r,r+1):
                radius = hypot(dx,dy)
                wave = cos(8*atan2(dy,dx))
                if radius <= r+.7*wave:
                    inner = radius < r*.55
                    z = h + (2 if inner else int(wave>.1))
                    p.box(x+dx,y+dy,h,1,1,z-h+2,
                          "ffbe4b" if inner else "f6a52c" if wave>.1 else "e48022")


def hairgrass(p):
    for i in range(11):
        a = i*2.4
        p.blade(round(4*cos(a)),round(4*sin(a)),0,round(5*cos(a)),round(5*sin(a)),
                6+(i*5)%8,["488057","649958","71a963"][i%3])


def foxtail(p):
    hairgrass(p)
    for x,y,h in [(-4,1,17),(1,-2,20),(4,2,15)]:
        p.box(x,y,0,1,1,h,"a8a150")
        for i in range(7):
            w = 2 if i in (0,6) else 3
            p.box(x-1+i//3,y-1,h+i,w,w,1,"dcbe69" if i%2 else "c6a353")
        p.box(x+2,y,h+7,1,1,2,"edcf86")


def blueberry(p):
    p.box(-2,-1,0,4,3,12,"755545")
    # Overlapping stepped leaf clusters grow out from a single woody base.
    for x,y,z,r in [(-5,1,8,5),(4,3,10,5),(2,-4,9,5),(-2,5,12,4),
                    (-2,-1,15,5),(5,-1,14,3),(-6,-3,12,3),(1,3,18,3)]:
        for dz, radius in [(-3,r-2),(-2,r-1),(-1,r),(0,r),(1,r),(2,r-1),(3,r-2)]:
            for dx in range(-radius,radius+1):
                for dy in range(-radius,radius+1):
                    if abs(dx)+abs(dy) > radius*1.5: continue
                    tone = int(dz >= 0) + int(dz >= 2) + int(dx+dy<0 and dz>0)
                    p.box(x+dx,y+dy,z+dz,1,1,1,["416f55","57865a","6a9b64","84ad69"][tone])
    for x,y,z in [(-8,-3,11),(-7,-4,8),(-3,6,14),(0,-8,10),(3,-8,8),
                  (5,-5,13),(7,2,14),(8,3,10),(-1,1,19),(-5,-3,16)]:
        p.box(x,y,z,3,3,3,"5154a3")
        p.box(x,y,z+3,3,3,1,"8793d8")
        p.box(x+1,y+1,z+3,1,1,1,"403e79")


bpy.ops.wm.read_factory_settings(use_empty=True)
material = bpy.data.materials.new("Wild plant palette")
material.use_nodes = True
shader = material.node_tree.nodes.get("Principled BSDF")
shader.inputs["Roughness"].default_value = .94
vertex_color = material.node_tree.nodes.new("ShaderNodeVertexColor")
vertex_color.layer_name = "Palette"
material.node_tree.links.new(vertex_color.outputs["Color"], shader.inputs["Base Color"])
for i, design in enumerate([daisy, poppy, lavender, marigold, hairgrass, foxtail, blueberry]):
    plant = Plant()
    design(plant)
    obj = plant.object(design.__name__, material)
    obj.location = ((i%4-1.5)*1.1, (0 if i<4 else -1.2), 0)
for area in bpy.context.screen.areas:
    if area.type == "VIEW_3D":
        space = area.spaces.active
        space.shading.color_type = "VERTEX"
        space.overlay.show_overlays = False
        space.region_3d.view_distance = 5.3
        space.region_3d.view_location = (0,-.6,.35)
        space.region_3d.view_rotation = Euler((1.0,0,-.15)).to_quaternion()
source = ROOT / "art" / "wild-plants.blend"
source.parent.mkdir(exist_ok=True)
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=str(source), compress=True)
bpy.ops.export_scene.gltf(filepath=str(ROOT/"assets/models/wild-plants.glb"),
                          export_vertex_color="ACTIVE", export_yup=True, export_animations=False)
