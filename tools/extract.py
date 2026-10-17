"""Build public/assets/tibia-atlas.{png,json} from a local Tibia client.

Usage: python tools/extract.py [path-to-Tibia-assets-folder]

The output is CipSoft's artwork: keep it local, don't commit or redistribute it.
"""
import hashlib
import json
import os
import sys

from PIL import Image

import tibia_assets as t

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "public", "assets")

GAME_DATA = os.path.join(ROOT, "src", "tibia", "data.json")  # written by tools/fetch_tibia_data.py

# Player vocations: looktype + Tibia-style outfit colours (head, body, legs, feet).
PLAYERS = {
    "rookie": (128, [(0x80, 0x60, 0x40), (0x60, 0x80, 0x50), (0x50, 0x50, 0x70), (0x50, 0x40, 0x30)]),
    "knight": (131, [(0xC8, 0xA0, 0x60), (0x60, 0x60, 0x70), (0x50, 0x50, 0x60), (0x40, 0x30, 0x20)]),
    "paladin": (129, [(0xA0, 0x70, 0x30), (0x30, 0x80, 0x30), (0x70, 0x50, 0x30), (0x50, 0x38, 0x20)]),
    "sorcerer": (130, [(0x70, 0x20, 0x20), (0xA0, 0x20, 0x20), (0x30, 0x20, 0x60), (0x30, 0x20, 0x20)]),
    "druid": (144, [(0x90, 0xB0, 0x50), (0x20, 0x70, 0x60), (0x40, 0x60, 0x30), (0x50, 0x40, 0x20)]),
}

GROUND = list(range(4515, 4531))
DECOR = {
    "trees": [3614, 3615, 3616, 3617, 3618, 3619, 3620, 3621, 3622, 3625],
    "bushes": [3681, 3682, 3700, 3701, 3743, 3744, 3745],
    "flowers": [3657, 3658, 3662, 3663, 3676, 3677, 3678, 3679, 3680],
    "dead": [3631, 3632, 3633, 3634, 3628],
}


class Packer:
    def __init__(self):
        self.frames = []  # [x, y, w, h, ox, oy] filled in at pack time
        self.images = []
        self.seen = {}

    def add(self, img):
        """Trim a sprite and register it. Returns the frame index."""
        w, h = img.size
        ax, ay = w - 16, h - 16  # anchor: centre of the sprite's own (bottom-right) tile
        bbox = img.getbbox()
        if bbox is None:
            bbox = (ax, ay, ax + 1, ay + 1)
        crop = img.crop(bbox)
        key = hashlib.sha1(crop.tobytes() + repr((bbox[0] - ax, bbox[1] - ay, crop.size)).encode()).hexdigest()
        if key in self.seen:
            return self.seen[key]
        idx = len(self.frames)
        self.frames.append([0, 0, crop.width, crop.height, bbox[0] - ax, bbox[1] - ay])
        self.images.append(crop)
        self.seen[key] = idx
        return idx

    def pack(self, width=2048):
        order = sorted(range(len(self.images)), key=lambda i: -self.images[i].height)
        x = y = shelf = 0
        for i in order:
            im = self.images[i]
            if x + im.width + 1 > width:
                x, y, shelf = 0, y + shelf + 1, 0
            self.frames[i][0], self.frames[i][1] = x, y
            x += im.width + 1
            shelf = max(shelf, im.height)
        atlas = Image.new("RGBA", (width, y + shelf), (0, 0, 0, 0))
        for i, im in enumerate(self.images):
            atlas.paste(im, (self.frames[i][0], self.frames[i][1]))
        return atlas


def colorize(base, mask, colors):
    base = base.copy()
    bp, mp = base.load(), mask.load()
    head, body, legs, feet = colors
    for y in range(base.height):
        for x in range(base.width):
            mr, mg, mb, ma = mp[x, y]
            if ma == 0:
                continue
            if mr and mg and not mb:
                c = head
            elif mr and not mg and not mb:
                c = body
            elif mg and not mr and not mb:
                c = legs
            elif mb and not mr and not mg:
                c = feet
            else:
                continue
            r, g, b, a = bp[x, y]
            bp[x, y] = (r * c[0] // 255, g * c[1] // 255, b * c[2] // 255, a)
    return base


def creature_frame(a, info, direction, phase, colors=None):
    """Compose one creature frame: base + addons, coloured through the mask layer."""
    out = None
    addons = range(info.pattern_height) if colors else [0]
    for addon in addons:
        idx = info.sprite_index(layer=0, x=direction, y=addon, z=0, phase=phase)
        img = a.sprite(info.sprite_ids[idx])
        if colors and info.layers > 1:
            mask = a.sprite(info.sprite_ids[info.sprite_index(layer=1, x=direction, y=addon, z=0, phase=phase)])
            img = colorize(img, mask, colors)
        if out is None:
            out = img.copy()
        else:
            out.alpha_composite(img)
    return out


def export_creature(a, p, looktype, colors=None):
    app = a.outfits[looktype]
    groups = app.frame_groups
    idle_g = groups[0]
    walk_g = groups[1] if len(groups) > 1 else groups[0]
    dirs = min(4, idle_g.pattern_width)
    idle, walk = [], []
    for d in range(4):
        dd = d if d < dirs else 0
        idle.append([p.add(creature_frame(a, idle_g, dd, ph, colors)) for ph in range(len(idle_g.phases))])
        walk.append([p.add(creature_frame(a, walk_g, dd, ph, colors)) for ph in range(len(walk_g.phases))])
    ms = sum(lo for lo, _ in walk_g.phases) / len(walk_g.phases)
    return {"idle": idle, "walk": walk, "walkMs": round(ms)}


def export_simple(a, p, app):
    g = app.frame_groups[0]
    frames = [p.add(a.sprite(g.sprite_ids[g.sprite_index(phase=ph)])) for ph in range(len(g.phases))]
    return {"frames": frames, "ms": [lo for lo, _ in g.phases]}


def export_missile(a, p, app):
    g = app.frame_groups[0]
    # angle order: E, SE, S, SW, W, NW, N, NE  ->  pattern (x, y)
    pats = [(2, 1), (2, 2), (1, 2), (0, 2), (0, 1), (0, 0), (1, 0), (2, 0)]
    if g.pattern_width < 3 or g.pattern_height < 3:
        pats = [(0, 0)] * 8
    return {"dirs": [p.add(a.sprite(g.sprite_ids[g.sprite_index(x=x, y=y)])) for x, y in pats]}


def main():
    a = t.Assets(sys.argv[1]) if len(sys.argv) > 1 else t.Assets()
    with open(GAME_DATA, encoding="utf-8") as fh:
        game = json.load(fh)
    p = Packer()
    data = {"creatures": {}, "effects": {}, "missiles": {}, "items": {}, "ground": [], "decor": {}}

    for name, (looktype, colors) in PLAYERS.items():
        data["creatures"][name] = export_creature(a, p, looktype, colors)
    for name, m in game["monsters"].items():
        if m["lookType"] in a.outfits:
            data["creatures"][name] = export_creature(a, p, m["lookType"])
        else:
            print("no outfit for", name)
    print("creatures", len(data["creatures"]))
    for eid, app in a.effects.items():
        if app.frame_groups and app.frame_groups[0].sprite_ids:
            data["effects"][eid] = export_simple(a, p, app)
    for mid, app in a.missiles.items():
        if app.frame_groups and app.frame_groups[0].sprite_ids:
            data["missiles"][mid] = export_missile(a, p, app)
    for iid in game["items"]:
        app = a.objects.get(int(iid))
        if app and app.frame_groups and app.frame_groups[0].sprite_ids:
            data["items"][iid] = export_simple(a, p, app)
    print("effects", len(data["effects"]), "missiles", len(data["missiles"]), "items", len(data["items"]))
    data["ground"] = [p.add(a.sprite(a.objects[g].frame_groups[0].sprite_ids[0])) for g in GROUND]
    for kind, ids in DECOR.items():
        # [frame, blocks movement] -- straight from the client's unpass flag
        data["decor"][kind] = [[p.add(a.sprite(a.objects[i].frame_groups[0].sprite_ids[0])), a.objects[i].unpass] for i in ids]

    atlas = p.pack()
    data["frames"] = p.frames
    os.makedirs(OUT_DIR, exist_ok=True)
    atlas.save(os.path.join(OUT_DIR, "tibia-atlas.png"), optimize=True)
    with open(os.path.join(OUT_DIR, "tibia-atlas.json"), "w", encoding="utf-8") as fh:
        json.dump(data, fh, separators=(",", ":"))
    print(f"atlas {atlas.size[0]}x{atlas.size[1]}, {len(p.frames)} frames -> {OUT_DIR}")


if __name__ == "__main__":
    main()
