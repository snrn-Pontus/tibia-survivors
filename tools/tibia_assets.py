"""Read sprites and appearances from a local Tibia 12+/13+ client install."""
import io
import json
import lzma
import os
import struct

from PIL import Image

DEFAULT_ASSETS = os.path.join(os.environ.get("LOCALAPPDATA", ""), "Tibia", "packages", "Tibia", "assets")

# spritetype -> (width, height) of one sprite in a 384x384 sheet
SPRITE_SIZES = {0: (32, 32), 1: (32, 64), 2: (64, 32), 3: (64, 64)}


# ---------- minimal protobuf reader ----------

def _varint(buf, pos):
    result = shift = 0
    while True:
        b = buf[pos]
        pos += 1
        result |= (b & 0x7F) << shift
        if not b & 0x80:
            return result, pos
        shift += 7


def parse_message(buf):
    """Return {field_number: [values]}; length-delimited values are raw bytes."""
    fields = {}
    pos, end = 0, len(buf)
    while pos < end:
        key, pos = _varint(buf, pos)
        num, wire = key >> 3, key & 7
        if wire == 0:
            val, pos = _varint(buf, pos)
        elif wire == 2:
            ln, pos = _varint(buf, pos)
            val = buf[pos:pos + ln]
            pos += ln
        elif wire == 5:
            val = struct.unpack_from("<I", buf, pos)[0]
            pos += 4
        elif wire == 1:
            val = struct.unpack_from("<Q", buf, pos)[0]
            pos += 8
        else:
            raise ValueError(f"unsupported wire type {wire}")
        fields.setdefault(num, []).append(val)
    return fields


def _packed_varints(values):
    out = []
    for v in values:
        if isinstance(v, (bytes, bytearray)):
            pos = 0
            while pos < len(v):
                n, pos = _varint(v, pos)
                out.append(n)
        else:
            out.append(v)
    return out


def _first(fields, num, default=None):
    return fields[num][0] if num in fields else default


class SpriteInfo:
    def __init__(self, raw):
        f = parse_message(raw)
        self.pattern_width = _first(f, 1, 1)
        self.pattern_height = _first(f, 2, 1)
        self.pattern_depth = _first(f, 3, 1)
        self.layers = _first(f, 4, 1)
        self.sprite_ids = _packed_varints(f.get(5, []))
        self.phases = []  # list of (min_ms, max_ms)
        if 6 in f:
            anim = parse_message(f[6][0])
            for ph in anim.get(6, []):
                p = parse_message(ph)
                self.phases.append((_first(p, 1, 100), _first(p, 2, 100)))
        if not self.phases:
            self.phases = [(100, 100)]

    def sprite_index(self, layer=0, x=0, y=0, z=0, phase=0):
        return ((((phase * self.pattern_depth + z) * self.pattern_height + y)
                 * self.pattern_width + x) * self.layers + layer)


class Appearance:
    def __init__(self, raw):
        f = parse_message(raw)
        self.id = _first(f, 1, 0)
        self.frame_groups = []
        for fg in f.get(2, []):
            g = parse_message(fg)
            self.frame_groups.append(SpriteInfo(_first(g, 3, b"")))
        name = _first(f, 4)
        self.name = name.decode("utf-8", "replace") if name else ""
        flags = parse_message(_first(f, 3, b""))
        self.unpass = bool(_first(flags, 13, 0))  # AppearanceFlags.unpass: blocks movement
        light = parse_message(_first(flags, 23, b""))  # AppearanceFlags.light: brightness (tiles), 8-bit color
        self.light = [_first(light, 1, 0), _first(light, 2, 215)] if _first(light, 1, 0) else None


class Assets:
    def __init__(self, path=DEFAULT_ASSETS):
        self.path = path
        with open(os.path.join(path, "catalog-content.json"), encoding="utf-8") as fh:
            catalog = json.load(fh)
        self.sheets = sorted((e for e in catalog if e["type"] == "sprite"), key=lambda e: e["firstspriteid"])
        app_file = next(e["file"] for e in catalog if e["type"] == "appearances")
        with open(os.path.join(path, app_file), "rb") as fh:
            top = parse_message(fh.read())
        self.objects = {a.id: a for a in map(Appearance, top.get(1, []))}
        self.outfits = {a.id: a for a in map(Appearance, top.get(2, []))}
        self.effects = {a.id: a for a in map(Appearance, top.get(3, []))}
        self.missiles = {a.id: a for a in map(Appearance, top.get(4, []))}
        self._sheet_cache = {}

    # ---------- sprite sheets ----------

    def _find_sheet(self, sprite_id):
        lo, hi = 0, len(self.sheets) - 1
        while lo <= hi:
            mid = (lo + hi) // 2
            e = self.sheets[mid]
            if sprite_id < e["firstspriteid"]:
                hi = mid - 1
            elif sprite_id > e["lastspriteid"]:
                lo = mid + 1
            else:
                return e
        raise KeyError(sprite_id)

    def _load_sheet(self, entry):
        img = self._sheet_cache.get(entry["file"])
        if img is not None:
            return img
        with open(os.path.join(self.path, entry["file"]), "rb") as fh:
            data = fh.read()
        pos = 0
        while data[pos] == 0:  # CIP padding
            pos += 1
        pos += 5  # CIP constant 70 0A FA 80 24
        _, pos = _varint(data, pos)  # compressed size
        props = data[pos:pos + 5]
        pos += 5 + 8  # props + 8-byte size field
        bmp = lzma.decompress(props + b"\xff" * 8 + data[pos:], format=lzma.FORMAT_ALONE)
        img = Image.open(io.BytesIO(bmp)).convert("RGBA")
        # Fully black pixels with zero alpha are transparent already; magenta is the legacy key.
        px = img.load()
        w, h = img.size
        for yy in range(h):
            for xx in range(w):
                r, g, b, a = px[xx, yy]
                if r == 255 and g == 0 and b == 255:
                    px[xx, yy] = (0, 0, 0, 0)
        self._sheet_cache[entry["file"]] = img
        return img

    def sprite(self, sprite_id):
        entry = self._find_sheet(sprite_id)
        sheet = self._load_sheet(entry)
        sw, sh = SPRITE_SIZES[entry["spritetype"]]
        per_row = 384 // sw
        local = sprite_id - entry["firstspriteid"]
        x, y = (local % per_row) * sw, (local // per_row) * sh
        return sheet.crop((x, y, x + sw, y + sh))
