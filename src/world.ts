// The world's sprites: map.ts decides what is where (zones, walls, ponds, trees...); this picks the frames.
// Things that block movement stand up (drawn y-sorted with creatures); the rest lie on the ground. Grounds get
// Tibia's borders: a ground with a higher z draws its border pieces over the tiles next to it, so grass edges
// spill onto water and sand, and rock rims a lava pool, the way the Tibia map is drawn. Underground, earth walls
// get a rim where the cave floor is north or west of them.
import { tileAt, type GroundKind } from "./map";
import TERRAIN from "./tibia/terrain.json";
export { hash } from "./map";

export interface Decor { frame: number; block: boolean; tall: boolean }

type Piece = "N" | "E" | "S" | "W" | "nw" | "ne" | "sw" | "se" | "NW" | "NE" | "SW" | "SE";
/** The atlas's terrain frames by kind (tools/extract.py, from src/tibia/terrain.json). */
export interface TerrainFrames {
  ground: Record<string, number[]>;
  decor: Record<string, number[]>;
  border: Record<string, Partial<Record<Piece, number>>>;
  walls: Record<string, { h: number; v: number; corner: number; pole: number }>;
  cavewall: Record<"plain" | "N" | "W" | "NW" | "lump", number[]>;
}

const Z = (k: GroundKind) => (TERRAIN.ground[k] as { z: number }).z;

export class World {
  private borders = new Map<number, number[]>();

  /** Without frames (the headless simulator) only the map is known. */
  constructor(private frames: TerrainFrames | null = null) {}

  /** The ground's frame: mostly the kind's first sprite, now and then one of the others; a shore's piece; an earth
   *  wall's by where the cave floor is; -1 for the dark beyond a cave (nothing to draw). */
  groundFrame(tx: number, ty: number): number {
    const t = tileAt(tx, ty), f = this.frames?.ground[t.ground];
    if (t.ground === "void") return -1;
    if (!f?.length) return 0;
    if (t.piece !== undefined) return f[t.piece] ?? f[0];
    if (t.ground === "cavewall" && this.frames?.cavewall) {
      const c = this.frames.cavewall;
      const n = tileAt(tx, ty - 1).ground !== "cavewall", w = tileAt(tx - 1, ty).ground !== "cavewall";
      const set = n && w ? c.NW : n ? c.N : w ? c.W : t.v < 0.06 ? c.lump : c.plain;
      return set[Math.floor(((t.v * 7919) % 1) * set.length)];
    }
    return t.v < 0.7 || f.length === 1 ? f[0] : f[1 + Math.floor(((t.v - 0.7) / 0.3) * (f.length - 1))];
  }

  /** Border pieces to draw over this tile's ground, lowest ground first. */
  bordersAt(tx: number, ty: number): number[] {
    const key = (tx + 0x100000) * 0x200000 + (ty + 0x100000);
    let out = this.borders.get(key);
    if (out) return out;
    out = [];
    const own = Z(tileAt(tx, ty).ground);
    const at = (dx: number, dy: number) => tileAt(tx + dx, ty + dy).ground;
    const kinds = new Set<GroundKind>();
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0], [1, -1], [1, 1], [-1, 1], [-1, -1]]) {
      const k = at(dx, dy);
      if (Z(k) > own && this.frames?.border[k]) kinds.add(k);
    }
    for (const k of [...kinds].sort((a, b) => Z(a) - Z(b))) {
      const set = this.frames!.border[k];
      const n = at(0, -1) === k, s = at(0, 1) === k, w = at(-1, 0) === k, e = at(1, 0) === k;
      const pieces: Piece[] = [];
      // Two sides: a big inner corner. One side: an edge. Only a diagonal: a small corner.
      if (n && w) pieces.push("NW");
      if (n && e) pieces.push("NE");
      if (s && w) pieces.push("SW");
      if (s && e) pieces.push("SE");
      if (n && !w && !e) pieces.push("N");
      if (s && !w && !e) pieces.push("S");
      if (w && !n && !s) pieces.push("W");
      if (e && !n && !s) pieces.push("E");
      if (at(-1, -1) === k && !n && !w) pieces.push("nw");
      if (at(1, -1) === k && !n && !e) pieces.push("ne");
      if (at(-1, 1) === k && !s && !w) pieces.push("sw");
      if (at(1, 1) === k && !s && !e) pieces.push("se");
      for (const p of pieces) if (set[p] !== undefined) out.push(set[p]!);
    }
    if (this.borders.size > 200000) this.borders.clear();
    this.borders.set(key, out);
    return out;
  }

  decorAt(tx: number, ty: number): Decor | null {
    const t = tileAt(tx, ty);
    if (t.wall) {
      // A wall piece by where the wall goes on: west-east, north-south, a corner going east and south, or a pole.
      const p = this.frames?.walls[t.wall];
      if (!p) return null;
      const same = (dx: number, dy: number) => tileAt(tx + dx, ty + dy).wall === t.wall;
      const n = same(0, -1), s = same(0, 1), e = same(1, 0), w = same(-1, 0);
      const frame = e && s ? p.corner : n && w && !e && !s ? p.pole : (e || w) && !(n || s) ? p.h : (n || s) && !(e || w) ? p.v : e || w ? p.h : p.pole;
      return { frame, block: true, tall: true };
    }
    if (!t.decor) return null;
    const f = this.frames?.decor[t.decor];
    if (!f?.length) return null;
    const frame = f[Math.floor(((t.v * 7919) % 1) * f.length)];
    // Stairs lie on the ground, except a ladder or stairs going up.
    return { frame, block: t.block, tall: t.block && (!t.stair || t.decor === "ladder" || t.decor === "upstairs") };
  }

  /** Blocks walking about: monsters and paths go around stairs too (you step onto them on purpose). */
  blocked(tx: number, ty: number): boolean {
    return tileAt(tx, ty).block;
  }

  /** Stairs on a tile: 1 down, -1 up, 0 none. */
  stairAt(tx: number, ty: number): number {
    return tileAt(tx, ty).stair;
  }
}
