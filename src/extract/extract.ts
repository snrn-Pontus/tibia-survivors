// Builds the sprite atlas from a Tibia client, in the browser (the twin of tools/extract.py: keep them in step).
// The output is CipSoft's artwork; it never leaves the player's machine.
import type { AtlasData, CreatureAnim, SimpleAnim } from "../atlas";
import { Client, crop, newImg, type Appearance, type Img, type ReadFile, type SpriteInfo } from "./client";

type RGB = [number, number, number];

/** What the game needs from src/tibia/data.json and src/tibia/terrain.json. */
export interface ExtractInput {
  monsters: Record<string, { lookType: number; lookColors?: number[] }>;
  items: Record<string, unknown>;
  fields?: Record<string, unknown>;
  terrain: {
    ground: Record<string, { ids: number[]; block?: boolean; border?: number[] }>;
    decor: Record<string, { ids: number[]; block?: boolean }>;
    cavewall: Record<string, number[]>;
    walls: Record<string, Record<string, number>>;
  };
}

export interface ExtractResult {
  data: AtlasData;
  width: number;
  height: number;
  pixels: Uint8Array; // RGBA
}

// Player vocations: looktype + Tibia-style outfit colours (head, body, legs, feet).
const PLAYERS: Record<string, [number, RGB[]]> = {
  rookie: [128, [[0x80, 0x60, 0x40], [0x60, 0x80, 0x50], [0x50, 0x50, 0x70], [0x50, 0x40, 0x30]]],
  knight: [131, [[0xc8, 0xa0, 0x60], [0x60, 0x60, 0x70], [0x50, 0x50, 0x60], [0x40, 0x30, 0x20]]],
  paladin: [129, [[0xa0, 0x70, 0x30], [0x30, 0x80, 0x30], [0x70, 0x50, 0x30], [0x50, 0x38, 0x20]]],
  sorcerer: [130, [[0x70, 0x20, 0x20], [0xa0, 0x20, 0x20], [0x30, 0x20, 0x60], [0x30, 0x20, 0x20]]],
  druid: [144, [[0x90, 0xb0, 0x50], [0x20, 0x70, 0x60], [0x40, 0x60, 0x30], [0x50, 0x40, 0x20]]],
};

/** Alpha-only bounding box [x0, y0, x1, y1), or null when the image is empty. */
function bbox(img: Img): [number, number, number, number] | null {
  let x0 = img.w, y0 = img.h, x1 = -1, y1 = -1;
  for (let y = 0; y < img.h; y++)
    for (let x = 0; x < img.w; x++)
      if (img.data[(y * img.w + x) * 4 + 3]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  return x1 < 0 ? null : [x0, y0, x1 + 1, y1 + 1];
}

function hash(b: Uint8Array): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < b.length; i++) h = Math.imul(h ^ b[i], 0x01000193);
  return h >>> 0;
}

const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

class Packer {
  frames: AtlasData["frames"] = []; // [x, y, w, h, ox, oy], x and y filled in at pack time
  images: Img[] = [];
  seen = new Map<string, number[]>();

  /** Trim a sprite and register it. Returns the frame index. */
  add(img: Img): number {
    const ax = img.w - 16, ay = img.h - 16; // anchor: centre of the sprite's own (bottom-right) tile
    const box = bbox(img) ?? [ax, ay, ax + 1, ay + 1];
    const c = crop(img, box[0], box[1], box[2] - box[0], box[3] - box[1]);
    const ox = box[0] - ax, oy = box[1] - ay;
    const key = `${hash(c.data)},${ox},${oy},${c.w},${c.h}`;
    const bucket = this.seen.get(key) ?? [];
    for (const i of bucket) if (same(this.images[i].data, c.data)) return i;
    const idx = this.frames.length;
    this.frames.push([0, 0, c.w, c.h, ox, oy]);
    this.images.push(c);
    bucket.push(idx);
    this.seen.set(key, bucket);
    return idx;
  }

  pack(width = 2048): Img {
    const order = this.images.map((_, i) => i).sort((a, b) => this.images[b].h - this.images[a].h);
    let x = 0, y = 0, shelf = 0;
    for (const i of order) {
      const im = this.images[i];
      if (x + im.w + 1 > width) {
        x = 0;
        y += shelf + 1;
        shelf = 0;
      }
      this.frames[i][0] = x;
      this.frames[i][1] = y;
      x += im.w + 1;
      shelf = Math.max(shelf, im.h);
    }
    const atlas = newImg(width, y + shelf);
    this.images.forEach((im, i) => {
      const [fx, fy] = this.frames[i];
      for (let row = 0; row < im.h; row++) atlas.data.set(im.data.subarray(row * im.w * 4, (row + 1) * im.w * 4), ((fy + row) * width + fx) * 4);
    });
    return atlas;
  }
}

/** Python's round(): halves go to the even neighbour. */
function round(x: number) {
  const f = Math.floor(x);
  return x - f === 0.5 ? f + (f % 2) : Math.round(x);
}

/** One of Tibia's 133 outfit colours (19 hues x 7 saturation/intensity steps) as RGB, like the client's
 *  Outfit::getColor. */
function outfitColor(c: number): RGB {
  if (c >= 19 * 7) c = 0;
  if (c % 19 === 0) {
    const v = round((1 - c / 19 / 7) * 255);
    return [v, v, v];
  }
  const h = (c % 19) / 18;
  const [s, i] = ([[0.25, 1.0], [0.25, 0.75], [0.5, 0.75], [0.667, 0.75], [1.0, 1.0], [1.0, 0.75], [1.0, 0.5]] as const)[Math.floor(c / 19)];
  const lo = i * (1 - s);
  let r: number, g: number, b: number;
  if (h < 1 / 6) [r, g, b] = [i, lo + (i - lo) * 6 * h, lo];
  else if (h < 2 / 6) [r, g, b] = [i - (i - lo) * (6 * h - 1), i, lo];
  else if (h < 3 / 6) [r, g, b] = [lo, i, lo + (i - lo) * (6 * h - 2)];
  else if (h < 4 / 6) [r, g, b] = [lo, i - (i - lo) * (6 * h - 3), i];
  else if (h < 5 / 6) [r, g, b] = [lo + (i - lo) * (6 * h - 4), lo, i];
  else [r, g, b] = [i, lo, i - (i - lo) * (6 * h - 5)];
  return [round(r * 255), round(g * 255), round(b * 255)];
}

function colorize(base: Img, mask: Img, colors: RGB[]): Img {
  const out = { ...base, data: base.data.slice() };
  const [head, body, legs, feet] = colors;
  const bp = out.data, mp = mask.data;
  for (let o = 0; o < bp.length; o += 4) {
    const mr = mp[o], mg = mp[o + 1], mb = mp[o + 2];
    if (!mp[o + 3]) continue;
    let c: RGB;
    if (mr && mg && !mb) c = head;
    else if (mr && !mg && !mb) c = body;
    else if (mg && !mr && !mb) c = legs;
    else if (mb && !mr && !mg) c = feet;
    else continue;
    for (let k = 0; k < 3; k++) bp[o + k] = Math.floor((bp[o + k] * c[k]) / 255);
  }
  return out;
}

/** `src` over `dst` in place, with Pillow's integer alpha_composite maths so both extractors agree. */
function alphaComposite(dst: Img, src: Img) {
  const d = dst.data, s = src.data;
  const div255 = (a: number) => (Math.floor(a / 256) + a) >>> 8;
  for (let o = 0; o < d.length; o += 4) {
    const sa = s[o + 3];
    if (sa === 0) continue;
    if (sa === 255) {
      d.set(s.subarray(o, o + 4), o);
      continue;
    }
    const outa255 = sa * 255 + d[o + 3] * (255 - sa);
    if (outa255 === 0) {
      d[o] = d[o + 1] = d[o + 2] = d[o + 3] = 0;
      continue;
    }
    const coef1 = Math.floor((sa * 255 * 255 * 128) / outa255);
    const coef2 = 255 * 128 - coef1;
    for (let k = 0; k < 3; k++) d[o + k] = div255(s[o + k] * coef1 + d[o + k] * coef2 + (0x80 << 7)) >>> 7;
    d[o + 3] = div255(outa255 + 0x80);
  }
}

/** Which border piece a sprite is, from how much of each 8-pixel band along the tile's sides it covers. */
function borderPiece(img: Img): string {
  const x0 = img.w - 32, y0 = img.h - 32; // the tile is the bottom-right 32 x 32
  const cov = (xa: number, ya: number, xb: number, yb: number) => {
    let n = 0;
    for (let y = ya; y < yb; y++) for (let x = xa; x < xb; x++) if (img.data[((y0 + y) * img.w + x0 + x) * 4 + 3] > 0) n++;
    return n / ((xb - xa) * (yb - ya));
  };
  const t = cov(0, 0, 32, 8), b = cov(0, 24, 32, 32), l = cov(0, 0, 8, 32), r = cov(24, 0, 32, 32);
  const corners: [string, number][] = [["nw", cov(0, 0, 10, 10)], ["ne", cov(22, 0, 32, 10)], ["sw", cov(0, 22, 10, 32)], ["se", cov(22, 22, 32, 32)]];
  const high = [t, b, l, r].map((v) => v > 0.5);
  if (high.filter(Boolean).length >= 2) {
    // A big corner covers all but the far corner.
    const far = corners.reduce((m, c) => (c[1] < m[1] ? c : m))[0];
    return ({ se: "NW", sw: "NE", ne: "SW", nw: "SE" } as Record<string, string>)[far];
  }
  if (high[0]) return "N";
  if (high[1]) return "S";
  if (high[2]) return "W";
  if (high[3]) return "E";
  return corners.reduce((m, c) => (c[1] > m[1] ? c : m))[0];
}

export async function extract(read: ReadFile, input: ExtractInput, progress: (done: number, total: number) => void = () => {}): Promise<ExtractResult> {
  const a = await Client.open(read);
  const p = new Packer();
  const first = (o: Appearance) => a.sprite(o.frameGroups[0].spriteIds[0]);

  /** Compose one creature frame: base + addons, coloured through the mask layer. */
  const creatureFrame = async (info: SpriteInfo, dir: number, phase: number, colors?: RGB[]) => {
    let out: Img | null = null;
    const addons = colors ? info.patternHeight : 1;
    for (let addon = 0; addon < addons; addon++) {
      let img = await a.sprite(info.spriteIds[info.spriteIndex(0, dir, addon, 0, phase)]);
      if (colors && info.layers > 1) img = colorize(img, await a.sprite(info.spriteIds[info.spriteIndex(1, dir, addon, 0, phase)]), colors);
      if (!out) out = img;
      else alphaComposite(out, img);
    }
    return out!;
  };

  const exportCreature = async (looktype: number, colors?: RGB[]): Promise<CreatureAnim> => {
    const groups = a.outfits.get(looktype)!.frameGroups;
    const idleG = groups[0];
    const walkG = groups.length > 1 ? groups[1] : groups[0];
    const dirs = Math.min(4, idleG.patternWidth);
    const idle: number[][] = [], walk: number[][] = [];
    for (let d = 0; d < 4; d++) {
      const dd = d < dirs ? d : 0;
      const i: number[] = [], w: number[] = [];
      for (let ph = 0; ph < idleG.phases.length; ph++) i.push(p.add(await creatureFrame(idleG, dd, ph, colors)));
      for (let ph = 0; ph < walkG.phases.length; ph++) w.push(p.add(await creatureFrame(walkG, dd, ph, colors)));
      idle.push(i);
      walk.push(w);
    }
    const ms = walkG.phases.reduce((s, [lo]) => s + lo, 0) / walkG.phases.length;
    return { idle, walk, walkMs: Math.round(ms) };
  };

  const exportSimple = async (app: Appearance): Promise<SimpleAnim> => {
    const g = app.frameGroups[0];
    const frames: number[] = [];
    for (let ph = 0; ph < g.phases.length; ph++) frames.push(p.add(await a.sprite(g.spriteIds[g.spriteIndex(0, 0, 0, 0, ph)])));
    return { frames, ms: g.phases.map(([lo]) => lo) };
  };

  const exportItem = async (app: Appearance) => {
    const out: SimpleAnim & { stack?: number[] } = await exportSimple(app);
    const g = app.frameGroups[0];
    // Stackables have 4 x 2 patterns, one per count step (otclient's Item::calculatePatterns):
    // 1, 2, 3, 4 on the first row, then 5-9, 10-24, 25-49 and 50+.
    if (g.patternWidth === 4 && g.patternHeight === 2) {
      out.stack = [];
      for (let i = 0; i < 8; i++) out.stack.push(p.add(await a.sprite(g.spriteIds[g.spriteIndex(0, i % 4, i >> 2)])));
    }
    return out;
  };

  const exportMissile = async (app: Appearance) => {
    const g = app.frameGroups[0];
    // angle order: E, SE, S, SW, W, NW, N, NE  ->  pattern (x, y)
    let pats = [[2, 1], [2, 2], [1, 2], [0, 2], [0, 1], [0, 0], [1, 0], [2, 0]];
    if (g.patternWidth < 3 || g.patternHeight < 3) pats = pats.map(() => [0, 0]);
    const dirs: number[] = [];
    for (const [x, y] of pats) dirs.push(p.add(await a.sprite(g.spriteIds[g.spriteIndex(0, x, y)])));
    return { dirs };
  };

  const data: AtlasData = {
    frames: [],
    creatures: {},
    effects: {},
    missiles: {},
    items: {},
    terrain: { ground: {}, decor: {} } as unknown as AtlasData["terrain"],
    light: { creatures: {}, effects: {}, missiles: {}, items: {} }, // what glows: [brightness, color]
  };
  const light = data.light!;
  const t = input.terrain;
  const monsters = Object.entries(input.monsters).filter(([, m]) => a.outfits.has(m.lookType));
  const itemIds = [...Object.keys(input.items), ...Object.keys(input.fields ?? {})]; // fields: magic fields on the ground
  const total = Object.keys(PLAYERS).length + monsters.length + a.effects.size + a.missiles.size + itemIds.length + 1;
  let done = 0;
  const step = () => progress(++done, total);

  for (const [name, [looktype, colors]] of Object.entries(PLAYERS)) {
    data.creatures[name] = await exportCreature(looktype, colors);
    step();
  }
  for (const [name, m] of monsters) {
    const look = m.lookColors;
    data.creatures[name] = await exportCreature(m.lookType, look && look.some(Boolean) ? look.map(outfitColor) : undefined);
    const lt = a.outfits.get(m.lookType)!.light;
    if (lt) light.creatures[name] = lt;
    step();
  }
  for (const [id, app] of a.effects) {
    if (app.drawable) {
      data.effects[id] = await exportSimple(app);
      if (app.light) light.effects[id] = app.light;
    }
    step();
  }
  for (const [id, app] of a.missiles) {
    if (app.drawable) {
      data.missiles[id] = await exportMissile(app);
      if (app.light) light.missiles[id] = app.light;
    }
    step();
  }
  for (const id of itemIds) {
    const app = a.objects.get(Number(id));
    if (app?.drawable) {
      data.items[id] = await exportItem(app);
      if (app.light) light.items[id] = app.light;
    }
    step();
  }

  const terrain = data.terrain as unknown as Record<string, Record<string, unknown>>;
  for (const section of ["ground", "decor"] as const) {
    for (const [kind, spec] of Object.entries(t[section])) {
      const frames: number[] = [];
      for (const i of spec.ids) {
        const o = a.objects.get(i);
        if (o?.drawable) frames.push(p.add(await first(o)));
      }
      terrain[section][kind] = frames;
    }
  }
  // Ground borders: each piece goes where its pixels are (edges N E S W, small corners nw ne sw se for a
  // diagonal neighbour, big corners NW NE SW SE for two sides), whatever order the set lists them in.
  terrain.border = {};
  for (const [kind, spec] of Object.entries(t.ground)) {
    if (!spec.border) continue;
    const pieces: Record<string, number> = {};
    for (const i of spec.border) {
      const spr = await first(a.objects.get(i)!);
      pieces[borderPiece(spr)] = p.add(spr);
    }
    terrain.border[kind] = pieces;
  }
  // Earth cave walls, by which of their sides have a rim (the cave floor is there).
  terrain.cavewall = {};
  for (const [k, ids] of Object.entries(t.cavewall)) {
    const frames: number[] = [];
    for (const i of ids) frames.push(p.add(await first(a.objects.get(i)!)));
    terrain.cavewall[k] = frames;
  }
  terrain.walls = {};
  for (const [name, parts] of Object.entries(t.walls)) {
    const out: Record<string, number> = {};
    for (const [k, i] of Object.entries(parts)) out[k] = p.add(await first(a.objects.get(i)!));
    terrain.walls[name] = out;
  }
  step();

  const atlas = p.pack();
  data.frames = p.frames;
  return { data, width: atlas.w, height: atlas.h, pixels: atlas.data };
}
