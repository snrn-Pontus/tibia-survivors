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

TERRAIN = os.path.join(ROOT, "src", "tibia", "terrain.json")  # ground and decoration sprites by kind


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


def outfit_color(c):
    """One of Tibia's 133 outfit colours (19 hues x 7 saturation/intensity steps) as RGB, like the client's
    Outfit::getColor."""
    if c >= 19 * 7:
        c = 0
    if c % 19 == 0:
        v = round((1 - c / 19 / 7) * 255)
        return (v, v, v)
    h = (c % 19) / 18
    s, i = [(0.25, 1.0), (0.25, 0.75), (0.5, 0.75), (0.667, 0.75), (1.0, 1.0), (1.0, 0.75), (1.0, 0.5)][c // 19]
    lo = i * (1 - s)
    if h < 1 / 6:
        r, g, b = i, lo + (i - lo) * 6 * h, lo
    elif h < 2 / 6:
        r, g, b = i - (i - lo) * (6 * h - 1), i, lo
    elif h < 3 / 6:
        r, g, b = lo, i, lo + (i - lo) * (6 * h - 2)
    elif h < 4 / 6:
        r, g, b = lo, i - (i - lo) * (6 * h - 3), i
    elif h < 5 / 6:
        r, g, b = lo + (i - lo) * (6 * h - 4), lo, i
    else:
        r, g, b = i, lo, i - (i - lo) * (6 * h - 5)
    return (round(r * 255), round(g * 255), round(b * 255))


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


def border_piece(img):
    """Which border piece a sprite is, from how much of each 8-pixel band along the tile's sides it covers."""
    al = img.getchannel("A").load()
    w, h = img.size
    x0, y0 = w - 32, h - 32  # the tile is the bottom-right 32 x 32
    def cov(xa, ya, xb, yb):
        n = sum(1 for y in range(ya, yb) for x in range(xa, xb) if al[x0 + x, y0 + y] > 0)
        return n / ((xb - xa) * (yb - ya))
    t, b, l, r = cov(0, 0, 32, 8), cov(0, 24, 32, 32), cov(0, 0, 8, 32), cov(24, 0, 32, 32)
    corners = {"nw": cov(0, 0, 10, 10), "ne": cov(22, 0, 32, 10), "sw": cov(0, 22, 10, 32), "se": cov(22, 22, 32, 32)}
    high = [v > 0.5 for v in (t, b, l, r)]
    if sum(high) >= 2:
        # A big corner covers all but the far corner.
        far = min(corners, key=corners.get)
        return {"se": "NW", "sw": "NE", "ne": "SW", "nw": "SE"}[far]
    if high[0]: return "N"
    if high[1]: return "S"
    if high[2]: return "W"
    if high[3]: return "E"
    return max(corners, key=corners.get)


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


def export_item(a, p, app):
    out = export_simple(a, p, app)
    g = app.frame_groups[0]
    # Stackables have 4 x 2 patterns, one per count step (otclient's Item::calculatePatterns):
    # 1, 2, 3, 4 on the first row, then 5-9, 10-24, 25-49 and 50+.
    if g.pattern_width == 4 and g.pattern_height == 2:
        out["stack"] = [p.add(a.sprite(g.sprite_ids[g.sprite_index(x=i % 4, y=i // 4)])) for i in range(8)]
    return out


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
    data = {"creatures": {}, "effects": {}, "missiles": {}, "items": {}, "terrain": {"ground": {}, "decor": {}},
            "light": {"creatures": {}, "effects": {}, "missiles": {}, "items": {}}}  # what glows: [brightness, color]

    for name, (looktype, colors) in PLAYERS.items():
        data["creatures"][name] = export_creature(a, p, looktype, colors)
    for name, m in game["monsters"].items():
        if m["lookType"] in a.outfits:
            look = m.get("lookColors")
            colors = [outfit_color(c) for c in look] if look and any(look) else None
            data["creatures"][name] = export_creature(a, p, m["lookType"], colors)
            if a.outfits[m["lookType"]].light:
                data["light"]["creatures"][name] = a.outfits[m["lookType"]].light
        else:
            print("no outfit for", name)
    print("creatures", len(data["creatures"]))
    for eid, app in a.effects.items():
        if app.frame_groups and app.frame_groups[0].sprite_ids:
            data["effects"][eid] = export_simple(a, p, app)
            if app.light:
                data["light"]["effects"][eid] = app.light
    for mid, app in a.missiles.items():
        if app.frame_groups and app.frame_groups[0].sprite_ids:
            data["missiles"][mid] = export_missile(a, p, app)
            if app.light:
                data["light"]["missiles"][mid] = app.light
    for iid in game["items"]:
        app = a.objects.get(int(iid))
        if app and app.frame_groups and app.frame_groups[0].sprite_ids:
            data["items"][iid] = export_item(a, p, app)
    for iid in game.get("fields", {}):  # magic fields on the ground, animated
        app = a.objects.get(int(iid))
        if app and app.frame_groups and app.frame_groups[0].sprite_ids:
            data["items"][iid] = export_item(a, p, app)
    for iid in data["items"]:
        app = a.objects.get(int(iid))
        if app and app.light:
            data["light"]["items"][iid] = app.light
    print("effects", len(data["effects"]), "missiles", len(data["missiles"]), "items", len(data["items"]))
    with open(TERRAIN, encoding="utf-8") as fh:
        terrain = json.load(fh)
    for section in ("ground", "decor"):
        for kind, spec in terrain[section].items():
            frames = []
            for i in spec["ids"]:
                o = a.objects.get(i)
                if not o or not o.frame_groups or not o.frame_groups[0].sprite_ids:
                    print("no sprite for", section, kind, i)
                    continue
                if o.unpass != bool(spec.get("block")):
                    print(f"{section} {kind} {i}: the client says unpass={o.unpass}, terrain.json disagrees")
                frames.append(p.add(a.sprite(o.frame_groups[0].sprite_ids[0])))
            data["terrain"][section][kind] = frames
    # Ground borders: each piece goes where its pixels are (edges N E S W, small corners nw ne sw se for a
    # diagonal neighbour, big corners NW NE SW SE for two sides), whatever order the set lists them in.
    data["terrain"]["border"] = {}
    for kind, spec in terrain["ground"].items():
        if "border" not in spec:
            continue
        pieces = {}
        for i in spec["border"]:
            spr = a.sprite(a.objects[i].frame_groups[0].sprite_ids[0])
            key = border_piece(spr)
            if key in pieces:
                print(f"border {kind}: {i} is a second {key}")
            pieces[key] = p.add(spr)
        if len(pieces) != 12:
            print(f"border {kind}: {len(pieces)} of 12 pieces", sorted(pieces))
        data["terrain"]["border"][kind] = pieces
    data["terrain"]["walls"] = {}
    for name, parts in terrain["walls"].items():
        data["terrain"]["walls"][name] = {k: p.add(a.sprite(a.objects[i].frame_groups[0].sprite_ids[0])) for k, i in parts.items()}

    atlas = p.pack()
    data["frames"] = p.frames
    os.makedirs(OUT_DIR, exist_ok=True)
    atlas.save(os.path.join(OUT_DIR, "tibia-atlas.png"), optimize=True)
    with open(os.path.join(OUT_DIR, "tibia-atlas.json"), "w", encoding="utf-8") as fh:
        json.dump(data, fh, separators=(",", ":"))
    print(f"atlas {atlas.size[0]}x{atlas.size[1]}, {len(p.frames)} frames -> {OUT_DIR}")


if __name__ == "__main__":
    main()
