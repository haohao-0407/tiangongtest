"""Refresh just the textile tiles in the shared build catalog, preserving existing slots."""
import json
from pathlib import Path
from PIL import Image, ImageDraw

assets = Path(__file__).resolve().parents[1] / "assets"
models = json.loads((assets / "colony/textile-models.json").read_text())
index_file = assets / "ui/building-icons.json"
atlas_file = assets / "ui/building-icons.png"
index = json.loads(index_file.read_text())
atlas = Image.open(atlas_file).convert("RGBA")
tile = atlas.width // index["columns"]


def thumbnail(parts):
    faces = []
    for part in parts:
        x, y, z = part["center"]
        w, h, d = (n / 2 for n in part["size"])
        rgb = bytes.fromhex(part["color"][1:])
        corners = [(x+i*w, y+j*h, z+k*d) for i in (-1, 1) for j in (-1, 1) for k in (-1, 1)]
        for ids, shade in [((4, 5, 7, 6), .80), ((1, 3, 7, 5), .93), ((2, 6, 7, 3), 1.09)]:
            points = [corners[i] for i in ids]
            depth = sum(a + b + c for a, b, c in points) / 4
            projected = [((a-c)*.707, (a+c)*.36-b*.86) for a,b,c in points]
            color = tuple(min(255, round(n*shade)) for n in rgb)
            faces.append((depth, projected, color))
    xs, ys = zip(*(p for _, poly, _ in faces for p in poly))
    size = tile * 4
    fit = size * .82 / max(max(xs)-min(xs), max(ys)-min(ys))
    cx, cy = (max(xs)+min(xs))/2, (max(ys)+min(ys))/2
    image = Image.new("RGBA", (size, size))
    draw = ImageDraw.Draw(image)
    for _, poly, color in sorted(faces, key=lambda face: face[0]):
        draw.polygon([(size/2+(x-cx)*fit, size/2+(y-cy)*fit) for x,y in poly], fill=color)
    return image.resize((tile,tile), Image.Resampling.LANCZOS)


for kind, parts in models.items():
    if kind not in index["tiles"]:
        occupied = {tuple(pos) for pos in index["tiles"].values()}
        slot = next(i for i in range(len(occupied)+1) if (i % index["columns"], i // index["columns"]) not in occupied)
        index["tiles"][kind] = [slot % index["columns"], slot // index["columns"]]
    col, row = index["tiles"][kind]
    if row >= index["rows"]:
        index["rows"] = row + 1
        larger = Image.new("RGBA", (atlas.width, index["rows"]*tile))
        larger.paste(atlas)
        atlas = larger
    atlas.paste(thumbnail(parts), (col*tile, row*tile))
atlas.save(atlas_file)
index_file.write_text(json.dumps(index, ensure_ascii=False, indent=2)+"\n", encoding="utf-8")
