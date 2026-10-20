// The world map. Space is cut into regions (Voronoi cells around jittered seeds, with warped, organic edges),
// and every region belongs to a zone: zones get harder further out, but not in circles, since a slow noise
// makes some directions harder sooner than others. Each zone has its own terrain (Rookgaard's meadows, the
// orcs' red steppe, the desert of the tombs, the cave, the snowy peaks, the swamp, the Pits' lava...).
// A border between two zones is a wall in that terrain's style (a tree line, rock, water, lava) with a gap or
// two, so you go from zone to zone through chokepoints; some borders inside a zone are walled as well. Inside
// a region there are ponds, outcrops and groves, kept away from the borders so every gap stays reachable.
// Water lies in smooth lakes at least two tiles across, and where a grassy or sandy land meets it there are
// Tibia's sandy shore tiles with surf, and a beach behind them.
// Hunting grounds that are dungeons in Tibia (sewers, mines, caves, crypts, lairs) go down: a hole, a grate or
// stairs in each of their regions leads to caves below, one to three floors deep, with a ladder back up.
// Floors below lie in their own band of the coordinate plane (floor k at y + k * FLOOR_SPAN), so everything that
// works with tile positions works on them unchanged.
// Everything is a pure function of the tile position, cached per tile.
import { ZONES, ZONE_WIDTH, type Hunt } from "./data";
import TERRAIN from "./tibia/terrain.json";

export type GroundKind = keyof typeof TERRAIN.ground;
export type DecorKind = keyof typeof TERRAIN.decor;
export type WallKind = keyof typeof TERRAIN.walls;
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
  built?: WallKind; // a hunting ground walled with real walls (a palisade, stone, sandstone) instead of `wall`
  beach?: number; // share of its shores that are sandy beaches (Tibia's shore tiles); the rest is its ground's edge
  below?: GroundKind[]; // the cave floor of its dungeon floors (default: its grounds)
  entrance?: DecorKind; // the way down from the surface (default: a hole)
}

const tree: Fill = { decor: "tree" };
const rocks: Fill = { decor: "boulder" };
export const BIOMES: Record<string, Biome> = {
  meadow: { name: "meadow", ground: ["grass"], wall: [tree], pond: { ground: "water" }, outcrop: tree, beach: 0.6,
    scatter: [["flowers", 0.05], ["tree", 0.006], ["bush", 0.006], ["pebbles", 0.004]] },
  forest: { name: "forest", ground: ["grass"], wall: [tree, { decor: "bush", w: 0.3 }], pond: { ground: "water" }, outcrop: tree, beach: 0.4,
    scatter: [["tree", 0.035], ["bush", 0.012], ["flowers", 0.025], ["mushrooms", 0.006], ["deadtree", 0.003]] },
  darkwood: { name: "dark wood", ground: ["grass"], wall: [tree, { decor: "deadtree", w: 0.3 }], pond: { ground: "water" }, outcrop: tree, beach: 0.25,
    scatter: [["tree", 0.05], ["deadtree", 0.01], ["mushrooms", 0.012], ["fern", 0.01], ["bush", 0.008]] },
  steppe: { name: "steppe", ground: ["earth", "dirt"], wall: [rocks, { decor: "deadtree", w: 0.25 }], outcrop: rocks,
    scatter: [["pebbles", 0.03], ["deadtree", 0.008], ["bones", 0.005], ["boulder", 0.006]] },
  hills: { name: "hills", ground: ["gravel", "rocksoil"], wall: [rocks], outcrop: rocks, pond: { ground: "water" },
    scatter: [["pebbles", 0.035], ["boulder", 0.01], ["bush", 0.004]] },
  mountains: { name: "mountains", ground: ["rocksoil"], wall: [rocks], outcrop: rocks,
    scatter: [["boulder", 0.015], ["pebbles", 0.035]] },
  desert: { name: "desert", ground: ["sand"], wall: [{ decor: "sandstone", w: 2 }, { decor: "cactus" }], outcrop: { decor: "sandstone" }, pond: { ground: "water" }, beach: 1,
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

  // Hunting grounds (data.ts HUNTS): each looks like its kind of place in Tibia.
  mines: { name: "mines", ground: ["dirt", "caverock"], wall: [rocks], outcrop: rocks, below: ["caverock", "dirt"],
    scatter: [["stalagmite", 0.02], ["pebbles", 0.035], ["crate", 0.004], ["boulder", 0.008], ["dwarfstatue", 0.001]] },
  jungle: { name: "jungle", ground: ["grass", "mud"], wall: [{ decor: "jungle" }, tree], pond: { ground: "swampwater" }, outcrop: { decor: "jungle" }, beach: 0.5,
    scatter: [["jungle", 0.035], ["fern", 0.03], ["palm", 0.008], ["flowers", 0.012], ["cobrastatue", 0.002]] },
  beach: { name: "beach", ground: ["sand"], wall: [{ ground: "water" }], pond: { ground: "water" }, outcrop: { decor: "palm" }, beach: 1,
    scatter: [["palm", 0.012], ["pebbles", 0.012], ["crate", 0.004], ["bones", 0.004]] },
  ruins: { name: "ruins", ground: ["stonefloor"], wall: [rocks], outcrop: rocks, built: "stone", below: ["stonefloor", "caverock"], entrance: "stairs",
    scatter: [["pebbles", 0.02], ["bones", 0.008], ["minostatue", 0.003], ["boulder", 0.006]] },
  tombs: { name: "tombs", ground: ["tombfloor", "sand"], wall: [{ decor: "sandstone" }], outcrop: { decor: "sandstone" }, built: "sandstone", below: ["tombfloor", "sand"], entrance: "sandstairs",
    scatter: [["sarcophagus", 0.01], ["coffin", 0.004], ["bones", 0.012], ["sandstatue", 0.002]] },
  djinn: { name: "djinn tower", ground: ["sand"], wall: [{ decor: "sandstone" }], outcrop: { decor: "palm" }, pond: { ground: "water" }, built: "sandstone", beach: 1,
    scatter: [["palm", 0.008], ["sandstatue", 0.004], ["gargoyle", 0.002], ["pebbles", 0.01]] },
  webcave: { name: "spider caves", ground: ["caverock"], wall: [rocks], outcrop: { decor: "stalagmite" },
    scatter: [["web", 0.04], ["bones", 0.012], ["stalagmite", 0.012], ["pebbles", 0.02]] },
  camp: { name: "camp", ground: ["grass", "dirt"], wall: [tree], outcrop: tree, built: "palisade", beach: 0.5,
    scatter: [["tent", 0.012], ["campfire", 0.003], ["crate", 0.004], ["flowers", 0.012], ["bush", 0.004]] },
  snowcamp: { name: "snow camp", ground: ["snow"], wall: [{ decor: "snowtree" }], outcrop: { decor: "snowtree" }, built: "palisade",
    scatter: [["tent", 0.012], ["campfire", 0.004], ["snowheap", 0.012], ["snowtree", 0.008]] },
  orcfort: { name: "fortress", ground: ["earth", "dirt"], wall: [rocks], outcrop: rocks, built: "palisade",
    scatter: [["tent", 0.01], ["campfire", 0.004], ["bones", 0.008], ["crate", 0.004], ["pebbles", 0.02]] },
  crypt: { name: "crypt", ground: ["stonefloor", "mud"], wall: [{ decor: "deadtree" }], outcrop: { decor: "darkstatue" }, built: "stone", below: ["stonefloor", "caverock"], entrance: "stairs",
    scatter: [["coffin", 0.01], ["graves", 0.012], ["bones", 0.014], ["brazier", 0.003], ["darkstatue", 0.002]] },
  lair: { name: "dragon lair", ground: ["scorched", "caverock"], wall: [rocks], pond: { ground: "lava" }, outcrop: rocks, below: ["caverock", "scorched"],
    scatter: [["bones", 0.025], ["boulder", 0.01], ["pebbles", 0.02]] },
  iceland: { name: "ice", ground: ["ice", "snow"], wall: [{ decor: "snowtree" }], pond: { ground: "water" }, outcrop: rocks,
    scatter: [["snowheap", 0.02], ["boulder", 0.008], ["bones", 0.006]] },
  forge: { name: "forge", ground: ["scorched"], wall: [{ ground: "lava" }], pond: { ground: "lava" }, outcrop: { decor: "darkstatue" },
    scatter: [["darkstatue", 0.004], ["brazier", 0.004], ["bones", 0.012], ["boulder", 0.008], ["stalagmite", 0.006]] },
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
const HUNT_LEVEL = 0.6; // how much of the map is hunting grounds (higher: less)
const GRID = 34; // regions laid out this many cells from the start; beyond, it's the last zone
const LAKES = 0.63; // how much of the land is lakes (higher: less)
/** Floor k below the surface is the band of tiles around y = k * FLOOR_SPAN. */
export const FLOOR_SPAN = 1 << 18;
/** How far below the surface a tile is: 0 on the surface, then 1, 2, 3. */
export const floorOf = (ty: number) => Math.max(0, Math.round(ty / FLOOR_SPAN));

export interface Tile {
  zone: number;
  region: number;
  hunt: number; // index into the zone's hunts, -1 outside one
  ground: GroundKind;
  piece?: number; // which of the ground's sprites, for a ground made of pieces (the shore)
  decor: DecorKind | null;
  wall: WallKind | null; // a piece of real wall (World picks which piece by its neighbours)
  block: boolean;
  stair: number; // 1: a way down, -1: a way up (blocked for walking about: you step onto it to take it)
  v: number; // picks the sprite variant
}

const seedOf = (gx: number, gy: number): [number, number] =>
  gx === 0 && gy === 0 ? [0, 0] : [(gx + (hash(gx, gy, SEED + 1) - 0.5) * 0.7) * CELL, (gy + (hash(gx, gy, SEED + 2) - 0.5) * 0.7) * CELL];
const regionId = (gx: number, gy: number) => (gx + 4096) * 8192 + (gy + 4096);
const DIRS8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

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
const huntOf = new Int8Array(W * W).fill(-1);
const parentOf = new Int32Array(W * W).fill(-1);
const floorsOf = new Uint8Array(W * W); // how many floors go down under a region (its hunting ground's)
const tunnels = new Uint8Array(W * W); // underground: bit d, a tunnel to the DIRS8[d] neighbour (same dungeon)
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
    for (const [dx, dy] of DIRS8) {
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
    for (const [dx, dy] of DIRS8) {
      const j = cell(gx + dx, gy + dy);
      if (j >= 0 && cost[j] < cost[i] && (best < 0 || cost[j] < cost[best]) && sharesBorder(gx, gy, gx + dx, gy + dy)) best = j;
    }
    if (best >= 0) parentOf[i] = best;
  }
  // Hunting grounds: clusters of regions where a slow noise is high; which of the zone's hunts it is changes
  // even more slowly, so neighbouring regions mostly share one. Never at the start.
  for (let i = 0; i < W * W; i++) {
    const gx = (i % W) - GRID, gy = Math.floor(i / W) - GRID, hunts = ZONES[zoneOf[i]].hunts;
    if (!hunts.length || (Math.abs(gx) <= 1 && Math.abs(gy) <= 1)) continue;
    const [sx, sy] = seedOf(gx, gy);
    if (noise(sx / 60 + 1.3, sy / 60 - 4.1, SEED + 31) < HUNT_LEVEL) continue;
    huntOf[i] = Math.floor(noise(sx / 140 - 2.2, sy / 140 + 8.9, SEED + 33) * 1.6 * hunts.length) % hunts.length;
  }
  // Every hunting ground somewhere: one the noise left out takes the zone's likeliest free region (nearest the
  // start, so it's on the way) and up to two free neighbours in the same zone.
  ZONES.forEach((zone, z) => {
    zone.hunts.forEach((_, h) => {
      if (huntOf.some((x, i) => x === h && zoneOf[i] === z)) return;
      let best = -1, bestCost = Infinity;
      for (let i = 0; i < W * W; i++) {
        const gx = (i % W) - GRID, gy = Math.floor(i / W) - GRID;
        if (zoneOf[i] !== z || huntOf[i] >= 0 || (Math.abs(gx) <= 1 && Math.abs(gy) <= 1)) continue;
        const c = Math.hypot(gx, gy) + hash(gx, gy, SEED + 35 + h);
        if (c < bestCost) { bestCost = c; best = i; }
      }
      if (best < 0) return;
      huntOf[best] = h;
      const gx = (best % W) - GRID, gy = Math.floor(best / W) - GRID;
      let added = 0;
      for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
        const j = cell(gx + dx, gy + dy);
        if (added < 2 && j >= 0 && zoneOf[j] === z && huntOf[j] < 0 && !(Math.abs(gx + dx) <= 1 && Math.abs(gy + dy) <= 1)) { huntOf[j] = h; added++; }
      }
    });
  });
  // Dungeons: how deep each hunting ground's regions go, and tunnels between its neighbouring regions down there.
  for (let i = 0; i < W * W; i++) if (huntOf[i] >= 0) floorsOf[i] = ZONES[zoneOf[i]].hunts[huntOf[i]].floors ?? 0;
  for (let i = 0; i < W * W; i++) {
    if (!floorsOf[i]) continue;
    const gx = (i % W) - GRID, gy = Math.floor(i / W) - GRID;
    DIRS8.forEach(([dx, dy], d) => {
      const j = cell(gx + dx, gy + dy);
      if (j >= 0 && floorsOf[j] && huntOf[j] === huntOf[i] && zoneOf[j] === zoneOf[i] && sharesBorder(gx, gy, gx + dx, gy + dy)) tunnels[i] |= 1 << d;
    });
  }
}

function regionHunt(gx: number, gy: number): number {
  const i = cell(gx, gy);
  return i < 0 ? -1 : huntOf[i];
}

function regionZone(gx: number, gy: number): number {
  const i = cell(gx, gy);
  return i < 0 ? ZONES.length - 1 : zoneOf[i];
}
function regionFloors(gx: number, gy: number): number {
  const i = cell(gx, gy);
  return i < 0 ? 0 : floorsOf[i];
}
/** Is a the region b was first reached from, or the other way round? */
function treeEdge(ax: number, ay: number, bx: number, by: number) {
  const a = cell(ax, ay), b = cell(bx, by);
  return a >= 0 && b >= 0 && (parentOf[a] === b || parentOf[b] === a);
}

export const biomeOf = (zone: number, hunt = -1): Biome => BIOMES[hunt >= 0 ? ZONES[zone].hunts[hunt].biome : ZONES[zone].biome];

const pick = <T extends Fill>(fills: T[], r: number): T => {
  const total = fills.reduce((a, f) => a + (f.w ?? 1), 0);
  let x = r * total;
  for (const f of fills) if ((x -= f.w ?? 1) < 0) return f;
  return fills[fills.length - 1];
};

/** Region shapes come from warped space: the slow part of the warp at a tile. */
const warpAt = (tx: number, ty: number): [number, number] =>
  [WARP * 2 * (noise(tx / 11, ty / 11, SEED + 7) - 0.5), WARP * 2 * (noise(tx / 11, ty / 11, SEED + 8) - 0.5)];
/** A region's middle on the map: its seed is in warped space, so the tile that warps onto it. */
const middles = new Map<number, [number, number]>();
function middleOf(gx: number, gy: number): [number, number] {
  const id = regionId(gx, gy);
  let m = middles.get(id);
  if (!m) {
    const [sx, sy] = seedOf(gx, gy);
    let x = sx, y = sy;
    for (let i = 0; i < 4; i++) { const [ox, oy] = warpAt(x, y); x = sx - ox; y = sy - oy; }
    m = [Math.round(x), Math.round(y)];
    middles.set(id, m);
  }
  return m;
}

interface Seed { gx: number; gy: number; s: [number, number]; d: number }
/** Where a tile is among the regions: the nearest seed in warped space is its region, and the nearest border is with
 *  whichever neighbour's bisector is closest (not always the second-nearest seed's, near corners). The warp has a
 *  slow part (the regions' shapes) and a quick one (ragged edges). */
function locate(tx: number, ty: number) {
  const [ox, oy] = warpAt(tx, ty);
  const wx = tx + ox + 1.6 * (noise(tx / 3.5, ty / 3.5, SEED + 71) - 0.5);
  const wy = ty + oy + 1.6 * (noise(tx / 3.5, ty / 3.5, SEED + 72) - 0.5);
  const cgx = Math.round(wx / CELL), cgy = Math.round(wy / CELL);
  const near: Seed[] = [];
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
  return { wx, wy, a, b, edge, len, near };
}

/** A biome's ground at a tile: its main one, with patches of the others. */
const groundOf = (grounds: GroundKind[], tx: number, ty: number, gx: number, gy: number): GroundKind =>
  grounds.length > 1 && noise(tx / 7, ty / 7, SEED + 9) > 0.62 ? grounds[1 + Math.floor(hash(gx, gy, SEED + 10) * (grounds.length - 1))] : grounds[0];
/** Water, swamp water, lava: the blocking grounds. */
const isLiquid = (g: GroundKind) => !!GROUNDS[g].block;

type RawTile = Tile & { land: GroundKind };
/** The surface before the water is tidied up: zones, walls and their gaps, buildings, lakes, outcrops and scatter.
 *  `land` is the ground under a lake or a wall of water, for where it's too thin to keep. */
function surfaceRaw(tx: number, ty: number): RawTile {
  const { wx, wy, a, b, edge, len } = locate(tx, ty);
  const ax = a.gx, ay = a.gy, bx = b.gx, by = b.gy, sa = a.s, sb = b.s;
  const za = regionZone(ax, ay), zb = regionZone(bx, by), ha = regionHunt(ax, ay), hb = regionHunt(bx, by);
  const biome = biomeOf(za, ha);
  const v = hash(tx, ty, SEED + 19);
  const start = Math.abs(tx) < 4 && Math.abs(ty) < 4; // a clearing to start in
  // Next to another kind of land the grounds interlock instead of meeting on a line: which side's ground a tile
  // gets is decided a little to either side of the border, by a noise that's the same seen from both.
  let ground = groundOf(biome.ground, tx, ty, ax, ay);
  const other = biomeOf(zb, hb);
  if (other !== biome && edge < 1.6) {
    const up = regionId(ax, ay) > regionId(bx, by);
    const u = (up ? edge : -edge) + (noise(tx / 3.2, ty / 3.2, SEED + 50) - 0.5) * 3.2; // > 0: the higher id's side
    if (u > 0 !== up) ground = groundOf(other.ground, tx, ty, bx, by);
  }
  const land = ground;
  let decor: DecorKind | null = null, wall: WallKind | null = null;
  const fill = (f: Fill) => { if (f.ground) ground = f.ground; if (f.decor) decor = f.decor; };
  // How thick this side of the border's wall is: between zones both sides wall up; around a hunting ground only
  // its own side does (a real wall if it has one), so it reads as a walled place with entrances. It swells and
  // thins along the border, with a ragged edge.
  const base = za !== zb ? ZONE_WALL : ha !== hb ? (ha < 0 ? 0 : ZONE_WALL * 0.8) : INNER_WALL;
  const thick = base * (0.65 + 0.75 * noise(tx / 6, ty / 6, SEED + 52)) + (hash(tx, ty, SEED + 53) - 0.5) * 0.5;
  const house = biome.built && !start ? building(ax, ay, tx, ty) : null;
  const inTown = Math.abs(tx) <= 12 && Math.abs(ty) <= 10;
  const town = inTown ? village(tx, ty) : null;
  if (town?.floor) ground = "stonefloor";

  if (base > 0 && edge < thick && !start && !inTown && walled(ax, ay, za, ha, bx, by, zb, hb) && !inGate(wx, wy, ax, ay, sa, bx, by, sb, len)) {
    fill(pick(biome.wall, hash(tx, ty, SEED + 12)));
  } else if (town?.wall) {
    wall = "stone";
  } else if (town?.decor) {
    decor = town.decor;
  } else if (inTown) {
    // the village: flowers and pebbles, nothing in the way
    if (hash(tx, ty, SEED + 17) < 0.04) decor = hash(tx, ty, SEED + 18) < 0.7 ? "flowers" : "pebbles";
    if (town?.floor || town?.near) decor = null;
  } else if (house?.wall) {
    wall = biome.built!;
  } else if (!start) {
    const inner = edge > MARGIN && (wx - sa[0]) ** 2 + (wy - sa[1]) ** 2 > 25 && !house?.near;
    // Lakes: a slow noise and a quicker one, so they're rounded with wobbly shores, and shrink toward the
    // region's border.
    const lake = 0.6 * noise(tx / 9, ty / 9, SEED + 11 + za) + 0.4 * noise(tx / 3.6, ty / 3.6, SEED + 14);
    if (inner && biome.pond && lake > LAKES + Math.max(0, MARGIN + 3 - edge) * 0.03) fill(biome.pond);
    else if (inner && biome.outcrop && noise(tx / 4.5, ty / 4.5, SEED + 13 + za) > 0.78) fill(biome.outcrop);
    else {
      // Scatter: flowers and pebbles anywhere; things in the way only clear of borders and building walls.
      let r = hash(tx, ty, SEED + 17);
      for (const [kind, chance] of biome.scatter) {
        if ((r -= chance) >= 0) continue;
        if (!DECORS[kind].block || (edge > 3.5 && !house?.hug)) decor = kind;
        break;
      }
    }
  }
  const block = wall !== null || isLiquid(ground) || (decor !== null && !!DECORS[decor as DecorKind].block);
  return { zone: za, region: regionId(ax, ay), hunt: ha, ground, decor, wall, block, stair: 0, v, land };
}

/** Rookgaard's village where you start: a stone plaza with braziers at its corners, and four small stone houses
 *  around it with their doors toward the plaza. */
const HOUSES: [number, number][] = [[-8, -7], [8, -7], [-8, 7], [8, 7]];
function village(tx: number, ty: number): { floor: boolean; wall: boolean; near: boolean; decor: DecorKind | null } {
  const r = Math.hypot(tx, ty);
  const corner = Math.abs(tx) === 4 && Math.abs(ty) === 4;
  let wall = false, near = false, floor = r <= 5.5;
  for (const [hx, hy] of HOUSES) {
    const dx = tx - hx, dy = ty - hy, adx = Math.abs(dx), ady = Math.abs(dy);
    if (adx > 3 || ady > 3) continue;
    near = true;
    if (adx <= 2 && ady <= 2) floor = true;
    const door = ady === 0 && dx === (hx < 0 ? 2 : -2);
    if (((adx === 2 && ady <= 2) || (ady === 2 && adx <= 2)) && !door) wall = true;
  }
  return { floor, wall, near, decor: corner ? "brazier" : null };
}

/** How big a region's building is: as big as fits well inside the region, so the region's border never cuts it
 *  off and there's a way around it; null if not even a small one does. */
const buildings = new Map<number, { hw: number; hh: number } | null>();
function buildingSize(ax: number, ay: number) {
  const id = regionId(ax, ay);
  let size = buildings.get(id);
  if (size !== undefined) return size;
  size = null;
  const [cx, cy] = middleOf(ax, ay);
  // Its wall, and a tile around it, clear of the region's border walls (they're up to about 3 thick).
  const inside = (x: number, y: number) => { const l = locate(x, y); return l.a.gx === ax && l.a.gy === ay && l.edge > 3.2; };
  const fits = (hw: number, hh: number) => {
    for (let x = -hw - 1; x <= hw + 1; x += 2) if (!inside(cx + x, cy - hh - 1) || !inside(cx + x, cy + hh + 1)) return false;
    for (let y = -hh - 1; y <= hh + 1; y += 2) if (!inside(cx - hw - 1, cy + y) || !inside(cx + hw + 1, cy + y)) return false;
    return true;
  };
  const w0 = 4 + Math.floor(hash(ax, ay, SEED + 41) * 3), h0 = 3 + Math.floor(hash(ax, ay, SEED + 42) * 3);
  for (let k = 0; k <= 3 && !size; k++) {
    const hw = Math.max(3, w0 - k), hh = Math.max(2, h0 - k);
    if (fits(hw, hh)) size = { hw, hh };
  }
  buildings.set(id, size);
  return size;
}

/** A hunting ground with real walls has a building in each of its regions: a rectangle of wall around the region's
 *  middle (a palisade fort, stone halls, a sandstone tomb) with doorways on two sides. `near`: in or around it (no
 *  ponds there); `hug`: just inside or outside the wall (nothing in the way there). */
function building(ax: number, ay: number, tx: number, ty: number) {
  const none = { wall: false, near: false, hug: false };
  const [cx, cy] = middleOf(ax, ay);
  const dx = tx - cx, dy = ty - cy, adx = Math.abs(dx), ady = Math.abs(dy);
  if (adx > 8 || ady > 7) return none;
  const size = buildingSize(ax, ay);
  if (!size || adx > size.hw + 2 || ady > size.hh + 2) return none;
  const { hw, hh } = size;
  const perim = (adx === hw && ady <= hh) || (ady === hh && adx <= hw);
  // Doorways in the middle of a side (N, E, S, W): two tiles wide in a long side, one in a short one.
  const d1 = Math.floor(hash(ax, ay, SEED + 43) * 4), d2 = (d1 + 1 + Math.floor(hash(ax, ay, SEED + 44) * 3)) % 4;
  const along = (d: number, half: number) => d === 0 || (half >= 4 && d === -1);
  const door = (side: number) => (side === 0 ? dy === -hh && along(dx, hw) : side === 2 ? dy === hh && along(dx, hw)
    : side === 1 ? dx === hw && along(dy, hh) : dx === -hw && along(dy, hh));
  const isDoor = door(d1) || door(d2);
  const hug = Math.abs(adx - hw) <= 1 && ady <= hh + 1 || Math.abs(ady - hh) <= 1 && adx <= hw + 1;
  return { wall: perim && !isDoor, near: true, hug };
}

const pairHash = (ax: number, ay: number, bx: number, by: number, k: number) => {
  const a = regionId(ax, ay), b = regionId(bx, by);
  return a < b ? hash(a, b, SEED + k) : hash(b, a, SEED + k);
};

/** Is the border between two regions a wall? Always between zones and around hunting grounds; sometimes inside. */
function walled(ax: number, ay: number, za: number, ha: number, bx: number, by: number, zb: number, hb: number) {
  return za !== zb || ha !== hb || pairHash(ax, ay, bx, by, 21) < SAME_ZONE_WALLS;
}

/** In the wall's gap? Walls on the paths out from the start have one, near the middle of the border; inside a zone
 *  half of the other walls do, and between zones a few. */
function inGate(wx: number, wy: number, ax: number, ay: number, sa: number[], bx: number, by: number, sb: number[], len: number) {
  const extra = regionZone(ax, ay) !== regionZone(bx, by) ? EXTRA_GAPS : regionHunt(ax, ay) !== regionHunt(bx, by) ? 0.35 : 0.5;
  if (!treeEdge(ax, ay, bx, by) && pairHash(ax, ay, bx, by, 27) >= extra) return false;
  // Measured along the border from the middle between the two seeds, in the same direction from either side.
  const flip = regionId(ax, ay) > regionId(bx, by);
  const [px, py] = flip ? sb : sa, [qx, qy] = flip ? sa : sb;
  const mx = (px + qx) / 2, my = (py + qy) / 2;
  const u = ((wx - mx) * -(qy - py) + (wy - my) * (qx - px)) / len;
  const g1 = (pairHash(ax, ay, bx, by, 23) - 0.5) * 0.3 * len;
  return Math.abs(u - g1) <= GATE;
}

// ---------- stairs ----------

/** Where a region's stairs are. Link 0 joins the surface and floor 1, link 1 floors 1 and 2, link 2 floors 2 and 3
 *  (at link 0's spot again). Near the region's middle, inside its building if it has one; you come out on the tile
 *  south of them. */
function stairSpot(gx: number, gy: number, link: number): [number, number] {
  const [sx, sy] = middleOf(gx, gy);
  const dx = Math.floor(hash(gx, gy, SEED + 81) * 5) - 2, dy = -Math.floor(hash(gx, gy, SEED + 82) * 2);
  return link % 2 === 0 ? [sx + dx, sy + dy] : [sx + (dx >= 0 ? -3 : 3), sy + 2];
}

/** The stairs on a tile of a floor (y measured on the surface): 1 down, -1 up, 0 none, and whose they are.
 *  `clear`: next to stairs or where you come out of them, kept free (and `owner` is whose). */
function stairsAt(tx: number, sy: number, floor: number, near: Seed[]): { stair: number; clear: boolean; owner: Seed | null } {
  let clear = false, owner: Seed | null = null;
  for (const n of near) {
    const floors = regionFloors(n.gx, n.gy);
    if (floor > floors) continue;
    for (const [link, dir] of [[floor, 1], [floor - 1, -1]]) {
      if (link < 0 || link >= floors) continue;
      const [px, py] = stairSpot(n.gx, n.gy, link);
      if (tx === px && sy === py) return { stair: dir, clear: true, owner: n };
      if (Math.abs(tx - px) <= 1 && sy - py >= -1 && sy - py <= 2) { clear = true; owner = n; }
    }
  }
  return { stair: 0, clear, owner };
}

// ---------- the surface, tidied ----------

const tileKey = (tx: number, ty: number) => (tx + 0x100000) * 0x200000 + (ty + 0x100000);
const rawCache = new Map<number, RawTile>();
function raw(tx: number, ty: number) {
  const key = tileKey(tx, ty);
  let t = rawCache.get(key);
  if (!t) {
    if (rawCache.size > 400000) rawCache.clear();
    t = surfaceRaw(tx, ty);
    rawCache.set(key, t);
  }
  return t;
}
const rawLiquid = (tx: number, ty: number) => isLiquid(raw(tx, ty).ground);
/** Liquid that stays: part of a 2 x 2 block of it, so no lake, moat or wall of water is a single tile across. */
function liquid(tx: number, ty: number) {
  if (!rawLiquid(tx, ty)) return false;
  for (const [ox, oy] of [[0, 0], [-1, 0], [0, -1], [-1, -1]])
    if (rawLiquid(tx + ox, ty + oy) && rawLiquid(tx + ox + 1, ty + oy) && rawLiquid(tx + ox, ty + oy + 1) && rawLiquid(tx + ox + 1, ty + oy + 1)) return true;
  return false;
}
const lake = (tx: number, ty: number) => raw(tx, ty).ground === "water" && liquid(tx, ty);
/** Water after tidying: a lake's, and a strip of land a tile wide between water on both sides is water too. */
function water(tx: number, ty: number) {
  if (lake(tx, ty)) return true;
  const t = raw(tx, ty);
  return !t.wall && !t.stair && t.ground !== "stonefloor" && (lake(tx, ty - 1) && lake(tx, ty + 1) || lake(tx - 1, ty) && lake(tx + 1, ty));
}

/** Tibia's sandy shore tiles (terrain.json's "shore", in this order) by where the water is: an edge (N, W, S, E),
 *  water on two sides (SE, SW, NW, NE), or only diagonally (se, sw, ne, nw). */
const SHORE = { N: 0, W: 1, S: 2, E: 3, SE: 4, SW: 5, NE: 6, NW: 7, se: 8, sw: 9, ne: 10, nw: 11 };

function surface(tx: number, ty: number): Tile {
  const t = raw(tx, ty);
  const st = stairsAt(tx, ty, 0, locate(tx, ty).near);
  if (st.stair && st.owner) {
    const z = regionZone(st.owner.gx, st.owner.gy), h = regionHunt(st.owner.gx, st.owner.gy);
    const decor = ((ZONES[z].hunts[h].entrance as DecorKind | undefined) ?? biomeOf(z, h).entrance ?? "hole") as DecorKind;
    return { ...t, ground: t.land, decor, wall: null, block: true, stair: 1 };
  }
  if (st.clear) return { ...t, ground: t.land, decor: null, wall: null, block: false };
  if (isLiquid(t.ground) && liquid(tx, ty)) return t;
  if (t.ground !== "lava" && t.ground !== "swampwater" && water(tx, ty)) return { ...t, ground: "water", decor: null, wall: null, block: true };
  return shore(tx, ty, isLiquid(t.ground) ? { ...t, ground: t.land, decor: null, block: false } : t);
}

/** Shores: where the land has beaches (all of a desert's, stretches of a meadow's), the tiles next to the water are
 *  Tibia's sandy shore pieces with surf, with a tile or two of sand behind them. */
function shore(tx: number, ty: number, t: Tile): Tile {
  const biome = biomeOf(t.zone, t.hunt);
  if (!biome.beach || t.wall || t.ground === "stonefloor" || t.ground === "tombfloor") return t;
  let wet = false;
  for (let dy = -2; dy <= 2 && !wet; dy++) for (let dx = -2; dx <= 2 && !wet; dx++) wet = rawLiquid(tx + dx, ty + dy);
  if (!wet || noise(tx / 16, ty / 16, SEED + 55) > biome.beach + 0.08) return t;
  const n = water(tx, ty - 1), s = water(tx, ty + 1), w = water(tx - 1, ty), e = water(tx + 1, ty);
  const piece = n && s || w && e ? -1 : n && w ? SHORE.NW : n && e ? SHORE.NE : s && w ? SHORE.SW : s && e ? SHORE.SE
    : n ? SHORE.N : s ? SHORE.S : w ? SHORE.W : e ? SHORE.E
    : water(tx + 1, ty + 1) ? SHORE.se : water(tx - 1, ty + 1) ? SHORE.sw : water(tx + 1, ty - 1) ? SHORE.ne : water(tx - 1, ty - 1) ? SHORE.nw : -1;
  if (piece >= 0) return { ...t, ground: "shore", piece, decor: null, block: false };
  let behind = false;
  for (let dy = -2; dy <= 2 && !behind; dy++) for (let dx = -2; dx <= 2 && !behind; dx++) behind = water(tx + dx, ty + dy);
  if (!behind || t.block) return t;
  return { ...t, ground: "sand", decor: t.decor === "pebbles" ? t.decor : null };
}

// ---------- underground ----------

/** A floor below a hunting ground: caves dug into the earth, a chamber around the middle of each of its regions with
 *  galleries off it, tunnels to its neighbours, and pockets. An earth wall around them, and beyond it the dark, as
 *  in Tibia. */
function underground(tx: number, ty: number, floor: number): Tile {
  const sy = ty - floor * FLOOR_SPAN; // the same place on the surface
  const { a, near } = locate(tx, sy);
  const v = hash(tx, ty, SEED + 19);
  const own = caveOwner(tx, sy, floor);
  if (!own) {
    const wall = DIRS8.some(([dx, dy]) => caveOwner(tx + dx, sy + dy, floor));
    return { zone: regionZone(a.gx, a.gy), region: regionId(a.gx, a.gy), hunt: regionHunt(a.gx, a.gy), ground: wall ? "cavewall" : "void", decor: null, wall: null, block: true, stair: 0, v };
  }
  const zone = regionZone(own.gx, own.gy), hunt = regionHunt(own.gx, own.gy), biome = biomeOf(zone, hunt);
  const base = { zone, region: regionId(own.gx, own.gy), hunt, wall: null, v };
  const ground = groundOf(biome.below ?? biome.ground, tx, ty, own.gx, own.gy);
  const st = stairsAt(tx, sy, floor, near);
  if (st.stair && st.owner) {
    const built = !!biomeOf(regionZone(st.owner.gx, st.owner.gy), regionHunt(st.owner.gx, st.owner.gy)).built;
    const decor: DecorKind = st.stair > 0 ? (built ? "stairs" : "hole") : built ? "upstairs" : "ladder";
    return { ...base, ground, decor, block: true, stair: st.stair };
  }
  // Scatter: bones, webs, coffins... Things in the way only where the cave is open all around.
  let decor: DecorKind | null = null;
  if (!st.clear) {
    let r = hash(tx, ty, SEED + 57 + floor);
    for (const [kind, chance] of biome.scatter) {
      if ((r -= chance) >= 0) continue;
      if (!DECORS[kind].block || DIRS8.every(([dx, dy]) => caveOwner(tx + dx, sy + dy, floor))) decor = kind;
      break;
    }
  }
  return { ...base, ground, decor, block: decor !== null && !!DECORS[decor as DecorKind].block, stair: 0 };
}

/** Which dungeon region a tile underground (y measured on the surface) belongs to, or null for rock. Two
 *  different dungeons never meet: there's always rock between them. */
const owners = new Map<number, Seed | null>();
function caveOwner(tx: number, sy: number, floor: number): Seed | null {
  const key = tileKey(tx, sy + floor * FLOOR_SPAN);
  let own = owners.get(key);
  if (own === undefined) {
    if (owners.size > 300000) owners.clear();
    own = findOwner(tx, sy, floor);
    owners.set(key, own);
  }
  return own;
}
function findOwner(tx: number, sy: number, floor: number): Seed | null {
  const { near, a, edge } = locate(tx, sy);
  const k = SEED + 60 + floor * 7;
  // Tunnels wander: they're measured from a warped position, and widen and narrow.
  const qx = tx + 6 * (noise(tx / 9, sy / 9, k + 1) - 0.5), qy = sy + 6 * (noise(tx / 9, sy / 9, k + 2) - 0.5);
  const width = 1.2 + 1.2 * noise(tx / 5, sy / 5, k + 3);
  const segment = (sx: number, sy0: number, ex: number, ey: number, w: number) => {
    const t = Math.max(0, Math.min(1, ((qx - sx) * ex + (qy - sy0) * ey) / (ex * ex + ey * ey)));
    return (qx - sx - t * ex) ** 2 + (qy - sy0 - t * ey) ** 2 < w * w;
  };
  /** Is the tile in region n's caves, with everything `pad` tiles wider? 2: in its chamber, 1: in a gallery, a
   *  tunnel or a pocket, 0: no. */
  const claims = (n: Seed, pad: number) => {
    if (regionFloors(n.gx, n.gy) < floor) return 0;
    const [sx, sy0] = middleOf(n.gx, n.gy), d2 = (tx - sx) ** 2 + (sy - sy0) ** 2;
    if (d2 > 1600) return 0;
    // The chamber: round, with a wobbly wall.
    const r = 5.4 + 3.6 * noise(tx / 4.5, sy / 4.5, k + 4) + floor * 0.4 + pad;
    if (d2 < r * r) return 2;
    // Galleries: three or four, each ending in a small cave, different on every floor.
    const spokes = 3 + Math.floor(hash(n.gx, n.gy, k + 6) * 2);
    for (let i = 0; i < spokes; i++) {
      const ang = hash(n.gx, n.gy, k + 7) * 6.2832 + (i * 6.2832) / spokes + (hash(n.gx + i, n.gy, k + 8) - 0.5) * 1.2;
      const l = 8 + hash(n.gx, n.gy + i, k + 9) * 4, ex = Math.cos(ang) * l, ey = Math.sin(ang) * l;
      const room = 2.6 + 1.6 * noise(tx / 3.5, sy / 3.5, k + 10) + pad;
      if ((tx - sx - ex) ** 2 + (sy - sy0 - ey) ** 2 < room * room || segment(sx, sy0, ex, ey, width * 0.85 + pad)) return 1;
    }
    // Tunnels to its neighbours, each from the end with the even direction (DIRS8 lists both ways of each).
    const bits = tunnels[cell(n.gx, n.gy)];
    for (let d = 0; d < 8; d += 2) {
      if (!(bits & (1 << d))) continue;
      const [ox, oy] = middleOf(n.gx + DIRS8[d][0], n.gy + DIRS8[d][1]);
      if (segment(sx, sy0, ox - sx, oy - sy0, width + pad)) return 1;
    }
    // Pockets off the chamber, inside the region.
    return n === a && edge > 2 - pad && d2 < 150 + pad * 30 && noise(tx / 5.5, sy / 5.5, k + 5) > 0.6 - pad * 0.06 ? 1 : 0;
  };
  const stairs = stairsAt(tx, sy, floor, near);
  if (stairs.owner) return stairs.owner; // around stairs it's always open
  let own: Seed | null = null, level = 0;
  for (const n of near) {
    const l = claims(n, 0);
    if (l > level) { own = n; level = l; }
  }
  if (!own) return null;
  // Another dungeon close by (its caves two tiles wider reach here): rock between them, but a chamber holds
  // its ground against the other's galleries.
  const [mx, my] = middleOf(own.gx, own.gy);
  if ((tx - mx) ** 2 + (sy - my) ** 2 < 30) return own; // the heart of a chamber, where its stairs are, always
  const dungeon = (n: Seed) => regionZone(n.gx, n.gy) * 64 + regionHunt(n.gx, n.gy);
  for (const n of near) if (dungeon(n) !== dungeon(own) && claims(n, 2) >= level) return null;
  return own;
}

const cache = new Map<number, Tile>();
export function tileAt(tx: number, ty: number): Tile {
  const key = tileKey(tx, ty);
  let t = cache.get(key);
  if (!t) {
    if (cache.size > 300000) cache.clear();
    const floor = floorOf(ty);
    t = floor ? underground(tx, ty, floor) : surface(tx, ty);
    cache.set(key, t);
  }
  return t;
}

/** Which zone a tile is in. */
export const zoneAt = (tx: number, ty: number) => tileAt(tx, ty).zone;
/** The hunting ground a tile is in, if any. */
export function huntAt(tx: number, ty: number): Hunt | null {
  const t = tileAt(tx, ty);
  return t.hunt >= 0 ? ZONES[t.zone].hunts[t.hunt] : null;
}
/** Tibia's ground speed of a tile (how long a step from it takes). */
export const groundSpeed = (tx: number, ty: number) => GROUNDS[tileAt(tx, ty).ground].speed ?? 150;
/** A tile's colour on the minimap; stairs are yellow, as on Tibia's. */
export function mapColor(tx: number, ty: number): [number, number, number] {
  const t = tileAt(tx, ty);
  if (t.stair) return [255, 230, 0];
  if (t.ground === "void") return [0, 0, 0];
  const [r, g, b] = GROUNDS[t.ground].color;
  if (t.wall) return [60, 50, 40];
  return t.decor && DECORS[t.decor].block ? [r * 0.5, g * 0.55, b * 0.5] : [r, g, b];
}
