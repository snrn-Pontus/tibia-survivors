// Reads sprites and appearances from a Tibia 12+/13+ client's assets folder (the browser twin of
// tools/tibia_assets.py). Files come in through `read`, so this runs in a worker or in node alike.
import { lzmaDecode } from "./lzma";

/** An RGBA image; `data` is w * h * 4 bytes. */
export interface Img {
  w: number;
  h: number;
  data: Uint8Array;
}

export const newImg = (w: number, h: number): Img => ({ w, h, data: new Uint8Array(w * h * 4) });

// spritetype -> [width, height] of one sprite in a 384x384 sheet
const SPRITE_SIZES: Record<number, [number, number]> = { 0: [32, 32], 1: [32, 64], 2: [64, 32], 3: [64, 64] };

// ---------- minimal protobuf reader ----------

type Field = number | Uint8Array;
type Message = Map<number, Field[]>;

function varint(buf: Uint8Array, pos: number): [number, number] {
  let result = 0;
  let mul = 1;
  for (;;) {
    const b = buf[pos++];
    result += (b & 0x7f) * mul;
    if (!(b & 0x80)) return [result, pos];
    mul *= 128;
  }
}

/** {field number: [values]}; length-delimited values are raw bytes. */
function parse(buf: Uint8Array): Message {
  const fields: Message = new Map();
  let pos = 0;
  while (pos < buf.length) {
    let key: number;
    [key, pos] = varint(buf, pos);
    const num = Math.floor(key / 8);
    const wire = key & 7;
    let val: Field;
    if (wire === 0) [val, pos] = varint(buf, pos);
    else if (wire === 2) {
      let len: number;
      [len, pos] = varint(buf, pos);
      val = buf.subarray(pos, pos + len);
      pos += len;
    } else if (wire === 5) {
      val = buf[pos] | (buf[pos + 1] << 8) | (buf[pos + 2] << 16) | (buf[pos + 3] * 2 ** 24);
      pos += 4;
    } else if (wire === 1) {
      val = 0; // 64-bit fixed: unused here
      pos += 8;
    } else throw new Error(`unsupported wire type ${wire}`);
    let list = fields.get(num);
    if (!list) fields.set(num, (list = []));
    list.push(val);
  }
  return fields;
}

const first = <T extends Field>(m: Message, num: number, dflt: T): T => (m.get(num)?.[0] as T) ?? dflt;
const EMPTY = new Uint8Array(0);

function packedVarints(values: Field[]): number[] {
  const out: number[] = [];
  for (const v of values) {
    if (typeof v === "number") out.push(v);
    else
      for (let pos = 0; pos < v.length; ) {
        let n: number;
        [n, pos] = varint(v, pos);
        out.push(n);
      }
  }
  return out;
}

export class SpriteInfo {
  patternWidth: number;
  patternHeight: number;
  patternDepth: number;
  layers: number;
  spriteIds: number[];
  phases: [number, number][] = []; // [min ms, max ms]

  constructor(raw: Uint8Array) {
    const f = parse(raw);
    this.patternWidth = first(f, 1, 1);
    this.patternHeight = first(f, 2, 1);
    this.patternDepth = first(f, 3, 1);
    this.layers = first(f, 4, 1);
    this.spriteIds = packedVarints(f.get(5) ?? []);
    const anim = f.get(6);
    if (anim) {
      for (const ph of parse(anim[0] as Uint8Array).get(6) ?? []) {
        const p = parse(ph as Uint8Array);
        this.phases.push([first(p, 1, 100), first(p, 2, 100)]);
      }
    }
    if (!this.phases.length) this.phases = [[100, 100]];
  }

  spriteIndex(layer = 0, x = 0, y = 0, z = 0, phase = 0) {
    return (((phase * this.patternDepth + z) * this.patternHeight + y) * this.patternWidth + x) * this.layers + layer;
  }
}

export class Appearance {
  id: number;
  frameGroups: SpriteInfo[];
  unpass: boolean;
  light: [number, number] | null;

  constructor(raw: Uint8Array) {
    const f = parse(raw);
    this.id = first(f, 1, 0);
    this.frameGroups = (f.get(2) ?? []).map((fg) => new SpriteInfo(first(parse(fg as Uint8Array), 3, EMPTY)));
    const flags = parse(first(f, 3, EMPTY));
    this.unpass = !!first(flags, 13, 0); // AppearanceFlags.unpass: blocks movement
    const light = parse(first(flags, 23, EMPTY)); // AppearanceFlags.light: brightness (tiles), 8-bit color
    this.light = first(light, 1, 0) ? [first(light, 1, 0), first(light, 2, 215)] : null;
  }

  /** Has at least one sprite to draw. */
  get drawable() {
    return this.frameGroups.length > 0 && this.frameGroups[0].spriteIds.length > 0;
  }
}

interface SheetEntry {
  file: string;
  spritetype: number;
  firstspriteid: number;
  lastspriteid: number;
}

export type ReadFile = (name: string) => Promise<Uint8Array>;

export class Client {
  objects = new Map<number, Appearance>();
  outfits = new Map<number, Appearance>();
  effects = new Map<number, Appearance>();
  missiles = new Map<number, Appearance>();
  private sheets: SheetEntry[] = [];
  private sheetCache = new Map<string, Img>();

  private constructor(private read: ReadFile) {}

  static async open(read: ReadFile): Promise<Client> {
    const c = new Client(read);
    const catalog = JSON.parse(new TextDecoder().decode(await read("catalog-content.json"))) as
      ({ type: string; file: string } & Partial<SheetEntry>)[];
    c.sheets = catalog.filter((e) => e.type === "sprite").map((e) => e as SheetEntry).sort((a, b) => a.firstspriteid - b.firstspriteid);
    const appFile = catalog.find((e) => e.type === "appearances");
    if (!appFile) throw new Error("catalog-content.json lists no appearances");
    const top = parse(await read(appFile.file));
    const fill = (map: Map<number, Appearance>, num: number) => {
      for (const raw of top.get(num) ?? []) {
        const a = new Appearance(raw as Uint8Array);
        map.set(a.id, a);
      }
    };
    fill(c.objects, 1);
    fill(c.outfits, 2);
    fill(c.effects, 3);
    fill(c.missiles, 4);
    return c;
  }

  // ---------- sprite sheets ----------

  private findSheet(id: number): SheetEntry {
    let lo = 0;
    let hi = this.sheets.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const e = this.sheets[mid];
      if (id < e.firstspriteid) hi = mid - 1;
      else if (id > e.lastspriteid) lo = mid + 1;
      else return e;
    }
    throw new Error(`no sprite sheet holds sprite ${id}`);
  }

  private async loadSheet(entry: SheetEntry): Promise<Img> {
    const cached = this.sheetCache.get(entry.file);
    if (cached) return cached;
    const data = await this.read(entry.file);
    let pos = 0;
    while (data[pos] === 0) pos++; // CIP padding
    pos += 5; // CIP constant 70 0A FA 80 24
    pos = varint(data, pos)[1]; // compressed size
    const props = data.subarray(pos, pos + 5);
    pos += 5 + 8; // props + 8-byte size field
    // The BMP header says how big the whole file is.
    const bmp = lzmaDecode(props, data, pos, (out) => (out[2] | (out[3] << 8) | (out[4] << 16) | (out[5] << 24)) >>> 0);
    const img = decodeBmp(bmp);
    // Magenta is the legacy transparency key.
    const px = img.data;
    for (let i = 0; i < px.length; i += 4) {
      if (px[i] === 255 && px[i + 1] === 0 && px[i + 2] === 255) px[i] = px[i + 1] = px[i + 2] = px[i + 3] = 0;
    }
    this.sheetCache.set(entry.file, img);
    return img;
  }

  async sprite(id: number): Promise<Img> {
    const entry = this.findSheet(id);
    const sheet = await this.loadSheet(entry);
    const [sw, sh] = SPRITE_SIZES[entry.spritetype];
    const perRow = Math.floor(384 / sw);
    const local = id - entry.firstspriteid;
    return crop(sheet, (local % perRow) * sw, Math.floor(local / perRow) * sh, sw, sh);
  }
}

export function crop(src: Img, x: number, y: number, w: number, h: number): Img {
  const out = newImg(w, h);
  for (let row = 0; row < h; row++) {
    const s = ((y + row) * src.w + x) * 4;
    out.data.set(src.data.subarray(s, s + w * 4), row * w * 4);
  }
  return out;
}

/** 24- or 32-bit BMP (BI_RGB or BI_BITFIELDS) to RGBA. */
function decodeBmp(b: Uint8Array): Img {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (b[0] !== 0x42 || b[1] !== 0x4d) throw new Error("sprite sheet is not a BMP");
  const offset = dv.getUint32(10, true);
  const headerSize = dv.getUint32(14, true);
  const w = dv.getInt32(18, true);
  const rawH = dv.getInt32(22, true);
  const bpp = dv.getUint16(28, true);
  const compression = dv.getUint32(30, true);
  const h = Math.abs(rawH);
  let masks = [0xff0000, 0xff00, 0xff, bpp === 32 ? 0xff000000 : 0];
  if (compression === 3 || compression === 6) {
    masks = [dv.getUint32(54, true), dv.getUint32(58, true), dv.getUint32(62, true), headerSize >= 56 || compression === 6 ? dv.getUint32(66, true) : 0];
  } else if (compression !== 0) throw new Error(`unsupported BMP compression ${compression}`);
  if (bpp !== 32 && bpp !== 24) throw new Error(`unsupported BMP depth ${bpp}`);
  const shifts = masks.map((m) => (m ? Math.log2(m & -m) : 0));
  const stride = Math.ceil((w * bpp) / 32) * 4;
  const img = newImg(w, h);
  for (let y = 0; y < h; y++) {
    const row = offset + (rawH > 0 ? h - 1 - y : y) * stride;
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      if (bpp === 24) {
        const p = row + x * 3;
        img.data[o] = b[p + 2];
        img.data[o + 1] = b[p + 1];
        img.data[o + 2] = b[p];
        img.data[o + 3] = 255;
      } else {
        const v = dv.getUint32(row + x * 4, true);
        for (let c = 0; c < 4; c++) img.data[o + c] = masks[c] ? ((v & masks[c]) >>> shifts[c]) & 0xff : 255;
      }
    }
  }
  return img;
}
