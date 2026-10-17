// Loads the atlas produced by tools/extract.py and draws frames from it.
// Every frame is stored trimmed, with (ox, oy) = offset from the sprite's anchor,
// which is the centre of the tile the sprite stands on (Tibia's bottom-right tile).

export interface CreatureAnim {
  idle: number[][]; // [direction N,E,S,W][phase]
  walk: number[][];
  walkMs: number;
}

export interface SimpleAnim {
  frames: number[];
  ms: number[];
}

export interface AtlasData {
  frames: [number, number, number, number, number, number][];
  creatures: Record<string, CreatureAnim>;
  effects: Record<string, SimpleAnim>;
  missiles: Record<string, { dirs: number[] }>;
  items: Record<string, SimpleAnim>;
  ground: number[];
  decor: Record<string, [number, boolean][]>; // [frame, blocks movement]
}

export class Atlas {
  constructor(public img: HTMLImageElement, public data: AtlasData) {}

  static async load(base = "assets/tibia-atlas"): Promise<Atlas> {
    const res = await fetch(`${base}.json`);
    if (!res.ok) throw new Error("missing atlas");
    const data = (await res.json()) as AtlasData;
    const img = new Image();
    img.src = `${base}.png`;
    await img.decode();
    return new Atlas(img, data);
  }

  draw(ctx: CanvasRenderingContext2D, frame: number, x: number, y: number) {
    const [sx, sy, w, h, ox, oy] = this.data.frames[frame];
    ctx.drawImage(this.img, sx, sy, w, h, Math.round(x + ox), Math.round(y + oy), w, h);
  }

  /** Pick the frame of a looping animation at time t (seconds). */
  animFrame(anim: SimpleAnim, t: number, loop = true): number {
    const total = anim.ms.reduce((a, b) => a + b, 0);
    let ms = t * 1000;
    if (loop) ms %= total;
    for (let i = 0; i < anim.frames.length; i++) {
      ms -= anim.ms[i];
      if (ms < 0) return anim.frames[i];
    }
    return anim.frames[anim.frames.length - 1];
  }

  effectDuration(id: number): number {
    return this.data.effects[id].ms.reduce((a, b) => a + b, 0) / 1000;
  }

  /** Draw a frame centred into a fresh canvas, for menus and the HUD. */
  icon(frame: number, size = 32, zoom = 1): HTMLCanvasElement {
    const c = document.createElement("canvas");
    c.width = c.height = size * zoom;
    const ctx = c.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    const [sx, sy, w, h] = this.data.frames[frame];
    const s = Math.min(zoom, (size * zoom) / Math.max(w, h));
    ctx.drawImage(this.img, sx, sy, w, h, (c.width - w * s) / 2, (c.height - h * s) / 2, w * s, h * s);
    return c;
  }

  /** Items are keyed by their Tibia item id. */
  itemIcon(id: number, size = 32, zoom = 1) {
    const it = this.data.items[id];
    if (!it) return this.icon(this.data.ground[0], size, zoom);
    return this.icon(it.frames[0], size, zoom);
  }

  /** Tibia missiles have 8 directional sprites; pick one by direction. Order: E, SE, S, SW, W, NW, N, NE. */
  missileFrame(missile: number, vx: number, vy: number): number | undefined {
    const m = this.data.missiles[missile];
    if (!m) return undefined;
    const idx = ((Math.round(Math.atan2(vy, vx) / (Math.PI / 4)) % 8) + 8) % 8;
    return m.dirs[idx];
  }
}
