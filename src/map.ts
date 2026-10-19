// The world map. Space is cut into regions (Voronoi cells around jittered seeds, with warped, organic edges),
// and every region belongs to a zone: zones get harder further out, but not in circles, since a slow noise
// makes some directions harder sooner than others. Each zone has its own terrain (Rookgaard's meadows, the
// orcs' red steppe, the desert of the tombs, the cave, the snowy peaks, the swamp, the Pits' lava...).
// A border between two zones is a wall in that terrain's style (a tree line, rock, water, lava) with a gap or
// two, so you go from zone to zone through chokepoints; some borders inside a zone are walled as well. Inside
// a region there are ponds, outcrops and groves, kept away from the borders so every gap stays reachable.
// Everything is a pure function of the tile position, cached per tile.
import { ZONES, ZONE_WIDTH } from "./data";
import TERRAIN from "./tibia/terrain.json";

export type GroundKind = keyof typeof TERRAIN.ground;
export type DecorKind = keyof typeof TERRAIN.decor;
const GROUNDS = TERRAIN.ground as Record<GroundKind, { ids: number[]; speed?: number; block?: boolean; color: number[] }>;
const DECORS = TERRAIN.decor as Record<DecorKind, { ids: number[]; block?: boolean }>;

export function hash(x: number, y: number, seed = 0): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Smooth value noise in [0, 1). */
function noise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const fx = x - xi, fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash(xi, yi, seed), b = hash(xi + 1, yi, seed), c = hash(xi, yi + 1, seed), d = hash(xi + 1, yi + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/** A wall, pond or outcrop: a blocking ground, or a blocking thing on the biome's ground. */
interface Fill { ground?: GroundKind; decor?: DecorKind; w?: number }
export interface Biome {
  name: string;
  ground: GroundKind[]; // the first is the main one; the others come in patches
  wall: Fill[];
  pond?: Fill;
  outcrop?: Fill;
  scatter: [DecorKind, number][]; // chance per tile
}

const tree: Fill = { decor: "tree" };
const rocks: Fill = { decor: "boulder" };
export const BIOMES: Record<string, Biome> = {
  meadow: { name: "meadow", ground: ["grass"], wall: [tree], pond: { ground: "water" }, outcrop: tree,
    scatter: [["flowers", 0.05], ["tree", 0.006], ["bush", 0.006], ["pebbles", 0.004]] },
  forest: { name: "forest", ground: ["grass"], wall: [tree, { decor: "bush", w: 0.3 }], pond: { ground: "water" }, outcrop: tree,
    scatter: [["tree", 0.035], ["bush", 0.012], ["flowers", 0.025], ["mushrooms", 0.006], ["deadtree", 0.003]] },
  darkwood: { name: "dark wood", ground: ["grass"], wall: [tree, { decor: "deadtree", w: 0.3 }], pond: { ground: "water" }, outcrop: tree,
    scatter: [["tree", 0.05], ["deadtree", 0.01], ["mushrooms", 0.012], ["fern", 0.01], ["bush", 0.008]] },
  steppe: { name: "steppe", ground: ["earth", "dirt"], wall: [rocks, { decor: "deadtree", w: 0.25 }], outcrop: rocks,
    scatter: [["pebbles", 0.03], ["deadtree", 0.008], ["bones", 0.005], ["boulder", 0.006]] },
  hills: { name: "hills", ground: ["gravel", "rocksoil"], wall: [rocks], outcrop: rocks, pond: { ground: "water" },
    scatter: [["pebbles", 0.035], ["boulder", 0.01], ["bush", 0.004]] },
  mountains: { name: "mountains", ground: ["rocksoil"], wall: [rocks], outcrop: rocks,
    scatter: [["boulder", 0.015], ["pebbles", 0.035]] },
  desert: { name: "desert", ground: ["sand"], wall: [{ decor: "sandstone", w: 2 }, { decor: "cactus" }], outcrop: { decor: "sandstone" }, pond: { ground: "water" },
    scatter: [["cactus", 0.012], ["bones", 0.006], ["palm", 0.003], ["sandstone", 0.004], ["pebbles", 0.01]] },
  graveyard: { name: "graveyard", ground: ["mud"], wall: [{ decor: "deadtree" }], pond: { ground: "swampwater" }, outcrop: { decor: "deadtree" },
    scatter: [["graves", 0.014], ["bones", 0.012], ["deadtree", 0.02], ["mushrooms", 0.006]] },
  scorched: { name: "scorched rock", ground: ["scorched"], wall: [{ ground: "lava" }], pond: { ground: "lava" }, outcrop: rocks,
    scatter: [["boulder", 0.01], ["bones", 0.008], ["pebbles", 0.02]] },
  cave: { name: "cave", ground: ["caverock"], wall: [rocks, { decor: "stalagmite", w: 0.6 }], outcrop: { decor: "stalagmite" }, pond: { ground: "water" },
    scatter: [["stalagmite", 0.02], ["pebbles", 0.03], ["mushrooms", 0.006]] },
  snow: { name: "snow", ground: ["snow", "ice"], wall: [{ decor: "snowtree" }], pond: { ground: "water" }, outcrop: rocks,
    scatter: [["snowtree", 0.02], ["snowheap", 0.01], ["pebbles", 0.01]] },
  swamp: { name: "swamp", ground: ["mud"], wall: [{ ground: "swampwater" }], pond: { ground: "swampwater" }, outcrop: { decor: "jungle" },
    scatter: [["reeds", 0.015], ["jungle", 0.01], ["deadtree", 0.008], ["fern", 0.02], ["mushrooms", 0.01]] },
  inferno: { name: "inferno", ground: ["scorched"], wall: [{ ground: "lava" }], pond: { ground: "lava" }, outcrop: rocks,
    scatter: [["bones", 0.012], ["stalagmite", 0.008], ["boulder", 0.006]] },
};

const SEED = 1;
const CELL = 22; // tiles between region seeds
const WARP = 4; // how far region edges wander
const ZONE_WALL = 1.9; // half a wall's thickness between zones
const INNER_WALL = 1.2; // ... and inside a zone
const GATE = 2.6; // half a gap's width
const MARGIN = 5; // no ponds or outcrops this close to a border: the way along it stays open
const SAME_ZONE_WALLS = 0.35; // share of borders inside a zone that are walled
const EXTRA_GAPS = 0.15; // share of walls between zones with a gap off the main paths
const WEIGHT_MEAN = 0.95; // keeps zones about ZONE_WIDTH deep on average
const GRID = 34; // regions laid out this many cells from the start; beyond, it's the last zone

export interface Tile {
  zone: number;
  region: number;
  ground: GroundKind;
  decor: DecorKind | null;
  block: boolean;
  v: number; // picks the sprite variant
}

const seedOf = (gx: number, gy: number): [number, number] =>
  gx === 0 && gy === 0 ? [0, 0] : [(gx + (hash(gx, gy, SEED + 1) - 0.5) * 0.7) * CELL, (gy + (hash(gx, gy, SEED + 2) - 0.5) * 0.7) * CELL];
const regionId = (gx: number, gy: number) => (gx + 4096) * 8192 + (gy + 4096);

// Zones by the cheapest walk from the start over the regions (Dijkstra on the region grid), where walking
// through a region costs its size times a slowly varying factor: cheap stretches reach far before the next
// zone starts, costly ones pinch it, so zones become irregular territories instead of rings. Every region
// remembers the neighbour it was reached from; the wall between them always has a gap, so there is a way to
// every region.
/** Do two regions meet at the midpoint between their seeds (no third seed is closer there)? */
function sharesBorder(ax: number, ay: number, bx: number, by: number): boolean {
  const [px, py] = seedOf(ax, ay), [qx, qy] = seedOf(bx, by);
  const mx = (px + qx) / 2, my = (py + qy) / 2, d = (mx - px) ** 2 + (my - py) ** 2;
  for (let gy = Math.min(ay, by) - 2; gy <= Math.max(ay, by) + 2; gy++)
    for (let gx = Math.min(ax, bx) - 2; gx <= Math.max(ax, bx) + 2; gx++) {
      if ((gx === ax && gy === ay) || (gx === bx && gy === by)) continue;
      const [sx, sy] = seedOf(gx, gy);
      if ((mx - sx) ** 2 + (my - sy) ** 2 < d - 9) return false; // a third region sits on the midpoint
    }
  return true;
}
const W = GRID * 2 + 1;
const cell = (gx: number, gy: number) => (Math.abs(gx) > GRID || Math.abs(gy) > GRID ? -1 : (gy + GRID) * W + gx + GRID);
const zoneOf = new Int8Array(W * W);
const parentOf = new Int32Array(W * W).fill(-1);
{
  const cost = new Float64Array(W * W).fill(Infinity);
  const done = new Uint8Array(W * W);
  const weight = (gx: number, gy: number) => {
    const [sx, sy] = seedOf(gx, gy);
    // Two octaves, squared for contrast: cheap valleys the zones reach far along, costly ridges that pinch them.
    const n = 0.65 * noise(sx / 170 + 7.3, sy / 170 - 2.1, SEED + 5) + 0.35 * noise(sx / 70 - 3.7, sy / 70 + 5.9, SEED + 4);
    return (0.25 + 2.6 * n * n + 0.2 * hash(gx, gy, SEED + 6)) / WEIGHT_MEAN;
  };
  const start = cell(0, 0);
  cost[start] = 0;
  // A small grid: a linear scan for the cheapest open cell is fast enough (once, at load).
  const open = [start];
  while (open.length) {
    let bi = 0;
    for (let k = 1; k < open.length; k++) if (cost[open[k]] < cost[open[bi]]) bi = k;
    const i = open[bi];
    open[bi] = open[open.length - 1];
    open.pop();
    if (done[i]) continue;
    done[i] = 1;
    const gx = (i % W) - GRID, gy = Math.floor(i / W) - GRID, [sx, sy] = seedOf(gx, gy);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const j = cell(gx + dx, gy + dy);
      if (j < 0 || done[j]) continue;
      const [nx, ny] = seedOf(gx + dx, gy + dy);
      const c = cost[i] + Math.hypot(nx - sx, ny - sy) * weight(gx + dx, gy + dy);
      if (c < cost[j]) {
        cost[j] = c;
        parentOf[j] = i;
        open.push(j);
      }
    }
  }
  for (let i = 0; i < W * W; i++) zoneOf[i] = Math.min(ZONES.length - 1, Math.floor(cost[i] / ZONE_WIDTH));
  // The guaranteed gap goes to the cheapest neighbour closer to the start that really shares a border at the
  // gap (the midpoint between the two seeds is on their border), falling back to the one the walk came from.
  for (let i = 0; i < W * W; i++) {
    const gx = (i % W) - GRID, gy = Math.floor(i / W) - GRID;
    let best = -1;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const j = cell(gx + dx, gy + dy);
      if (j >= 0 && cost[j] < cost[i] && (best < 0 || cost[j] < cost[best]) && sharesBorder(gx, gy, gx + dx, gy + dy)) best = j;
    }
    if (best >= 0) parentOf[i] = best;
  }
}

function regionZone(gx: number, gy: number): number {
  const i = cell(gx, gy);
  return i < 0 ? ZONES.length - 1 : zoneOf[i];
}
/** Is a the region b was first reached from, or the other way round? */
function treeEdge(ax: number, ay: number, bx: number, by: number) {
  const a = cell(ax, ay), b = cell(bx, by);
  return a >= 0 && b >= 0 && (parentOf[a] === b || parentOf[b] === a);
}

export const biomeOf = (zone: number): Biome => BIOMES[ZONES[zone].biome];

const pick = <T extends Fill>(fills: T[], r: number): T => {
  const total = fills.reduce((a, f) => a + (f.w ?? 1), 0);
  let x = r * total;
  for (const f of fills) if ((x -= f.w ?? 1) < 0) return f;
  return fills[fills.length - 1];
};

function compute(tx: number, ty: number): Tile {
  const wx = tx + WARP * 2 * (noise(tx / 11, ty / 11, SEED + 7) - 0.5);
  const wy = ty + WARP * 2 * (noise(tx / 11, ty / 11, SEED + 8) - 0.5);
  // The nearest seed (in warped space) is the region; the nearest border is with whichever neighbour's
  // bisector is closest (not always the second-nearest seed's, near corners).
  const cgx = Math.round(wx / CELL), cgy = Math.round(wy / CELL);
  const near: { gx: number; gy: number; s: [number, number]; d: number }[] = [];
  for (let gy = cgy - 2; gy <= cgy + 2; gy++)
    for (let gx = cgx - 2; gx <= cgx + 2; gx++) {
      const s = seedOf(gx, gy);
      near.push({ gx, gy, s, d: (s[0] - wx) ** 2 + (s[1] - wy) ** 2 });
    }
  let a = near[0];
  for (const n of near) if (n.d < a.d) a = n;
  let b = a, edge = Infinity, len = 1;
  for (const n of near) {
    if (n === a) continue;
    const l = Math.hypot(n.s[0] - a.s[0], n.s[1] - a.s[1]), e = (n.d - a.d) / (2 * l);
    if (e < edge) { edge = e; b = n; len = l; }
  }
  const ax = a.gx, ay = a.gy, bx = b.gx, by = b.gy, sa = a.s, sb = b.s;
  const za = regionZone(ax, ay), zb = regionZone(bx, by);
  const biome = biomeOf(za);
  const v = hash(tx, ty, SEED + 19);
  const start = Math.abs(tx) < 4 && Math.abs(ty) < 4; // a clearing to start in
  // Patches of the biome's other grounds.
  const g = biome.ground;
  let ground: GroundKind = g.length > 1 && noise(tx / 7, ty / 7, SEED + 9) > 0.62 ? g[1 + Math.floor(hash(ax, ay, SEED + 10) * (g.length - 1))] : g[0];
  let decor: DecorKind | null = null;
  const fill = (f: Fill) => { if (f.ground) ground = f.ground; if (f.decor) decor = f.decor; };

  if (edge < (za !== zb ? ZONE_WALL : INNER_WALL) && !start && walled(ax, ay, za, bx, by, zb) && !inGate(wx, wy, ax, ay, sa, bx, by, sb, len)) {
    fill(pick(biome.wall, hash(tx, ty, SEED + 12)));
  } else if (!start) {
    const inner = edge > MARGIN && (wx - sa[0]) ** 2 + (wy - sa[1]) ** 2 > 16;
    if (inner && biome.pond && noise(tx / 6, ty / 6, SEED + 11 + za) > 0.76) fill(biome.pond);
    else if (inner && biome.outcrop && noise(tx / 4.5, ty / 4.5, SEED + 13 + za) > 0.78) fill(biome.outcrop);
    else {
      // Scatter: flowers and pebbles anywhere; things in the way only clear of the borders.
      let r = hash(tx, ty, SEED + 17);
      for (const [kind, chance] of biome.scatter) {
        if ((r -= chance) >= 0) continue;
        if (!DECORS[kind].block || edge > 3.5) decor = kind;
        break;
      }
    }
  }
  const block = !!GROUNDS[ground].block || (decor !== null && !!DECORS[decor as DecorKind].block);
  return { zone: za, region: regionId(ax, ay), ground, decor, block, v };
}

const pairHash = (ax: number, ay: number, bx: number, by: number, k: number) => {
  const a = regionId(ax, ay), b = regionId(bx, by);
  return a < b ? hash(a, b, SEED + k) : hash(b, a, SEED + k);
};

/** Is the border between two regions a wall? Always between zones; sometimes inside one. */
function walled(ax: number, ay: number, za: number, bx: number, by: number, zb: number) {
  return za !== zb || pairHash(ax, ay, bx, by, 21) < SAME_ZONE_WALLS;
}

/** In the wall's gap? Walls on the paths out from the start have one, near the middle of the border; inside a zone
 *  half of the other walls do, and between zones a few. */
function inGate(wx: number, wy: number, ax: number, ay: number, sa: number[], bx: number, by: number, sb: number[], len: number) {
  if (!treeEdge(ax, ay, bx, by) && pairHash(ax, ay, bx, by, 27) >= (regionZone(ax, ay) === regionZone(bx, by) ? 0.5 : EXTRA_GAPS)) return false;
  // Measured along the border from the middle between the two seeds, in the same direction from either side.
  const flip = regionId(ax, ay) > regionId(bx, by);
  const [px, py] = flip ? sb : sa, [qx, qy] = flip ? sa : sb;
  const mx = (px + qx) / 2, my = (py + qy) / 2;
  const u = ((wx - mx) * -(qy - py) + (wy - my) * (qx - px)) / len;
  const g1 = (pairHash(ax, ay, bx, by, 23) - 0.5) * 0.3 * len;
  return Math.abs(u - g1) <= GATE;
}

const cache = new Map<number, Tile>();
export function tileAt(tx: number, ty: number): Tile {
  const key = (tx + 0x8000) * 0x10000 + (ty + 0x8000);
  let t = cache.get(key);
  if (!t) {
    if (cache.size > 300000) cache.clear();
    t = compute(tx, ty);
    cache.set(key, t);
  }
  return t;
}

/** Which zone a tile is in. */
export const zoneAt = (tx: number, ty: number) => tileAt(tx, ty).zone;
/** Tibia's ground speed of a tile (how long a step from it takes). */
export const groundSpeed = (tx: number, ty: number) => GROUNDS[tileAt(tx, ty).ground].speed ?? 150;
/** A tile's colour on the minimap. */
export function mapColor(tx: number, ty: number): [number, number, number] {
  const t = tileAt(tx, ty);
  const [r, g, b] = GROUNDS[t.ground].color;
  return t.decor && DECORS[t.decor].block ? [r * 0.5, g * 0.55, b * 0.5] : [r, g, b];
}
