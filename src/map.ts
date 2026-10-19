// The world map. Space is cut into regions (Voronoi cells around jittered seeds, with warped, organic edges),
// and every region belongs to a zone: zones get harder further out, but not in circles, since a slow noise
// makes some directions harder sooner than others. Each zone has its own terrain (Rookgaard's meadows, the
// orcs' red steppe, the desert of the tombs, the cave, the snowy peaks, the swamp, the Pits' lava...).
// A border between two zones is a wall in that terrain's style (a tree line, rock, water, lava) with a gap or
// two, so you go from zone to zone through chokepoints; some borders inside a zone are walled as well. Inside
// a region there are ponds, outcrops and groves, kept away from the borders so every gap stays reachable.
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

  // Hunting grounds (data.ts HUNTS): each looks like its kind of place in Tibia.
  mines: { name: "mines", ground: ["dirt", "caverock"], wall: [rocks], outcrop: rocks,
    scatter: [["stalagmite", 0.02], ["pebbles", 0.035], ["crate", 0.004], ["boulder", 0.008], ["dwarfstatue", 0.001]] },
  jungle: { name: "jungle", ground: ["grass", "mud"], wall: [{ decor: "jungle" }, tree], pond: { ground: "swampwater" }, outcrop: { decor: "jungle" },
    scatter: [["jungle", 0.035], ["fern", 0.03], ["palm", 0.008], ["flowers", 0.012], ["cobrastatue", 0.002]] },
  beach: { name: "beach", ground: ["sand"], wall: [{ ground: "water" }], pond: { ground: "water" }, outcrop: { decor: "palm" },
    scatter: [["palm", 0.012], ["pebbles", 0.012], ["crate", 0.004], ["bones", 0.004]] },
  ruins: { name: "ruins", ground: ["stonefloor"], wall: [rocks], outcrop: rocks, built: "stone",
    scatter: [["pebbles", 0.02], ["bones", 0.008], ["minostatue", 0.003], ["boulder", 0.006]] },
  tombs: { name: "tombs", ground: ["tombfloor", "sand"], wall: [{ decor: "sandstone" }], outcrop: { decor: "sandstone" }, built: "sandstone",
    scatter: [["sarcophagus", 0.01], ["coffin", 0.004], ["bones", 0.012], ["sandstatue", 0.002]] },
  djinn: { name: "djinn tower", ground: ["sand"], wall: [{ decor: "sandstone" }], outcrop: { decor: "palm" }, pond: { ground: "water" }, built: "sandstone",
    scatter: [["palm", 0.008], ["sandstatue", 0.004], ["gargoyle", 0.002], ["pebbles", 0.01]] },
  webcave: { name: "spider caves", ground: ["caverock"], wall: [rocks], outcrop: { decor: "stalagmite" },
    scatter: [["web", 0.04], ["bones", 0.012], ["stalagmite", 0.012], ["pebbles", 0.02]] },
  camp: { name: "camp", ground: ["grass", "dirt"], wall: [tree], outcrop: tree, built: "palisade",
    scatter: [["tent", 0.012], ["campfire", 0.003], ["crate", 0.004], ["flowers", 0.012], ["bush", 0.004]] },
  snowcamp: { name: "snow camp", ground: ["snow"], wall: [{ decor: "snowtree" }], outcrop: { decor: "snowtree" }, built: "palisade",
    scatter: [["tent", 0.012], ["campfire", 0.004], ["snowheap", 0.012], ["snowtree", 0.008]] },
  orcfort: { name: "fortress", ground: ["earth", "dirt"], wall: [rocks], outcrop: rocks, built: "palisade",
    scatter: [["tent", 0.01], ["campfire", 0.004], ["bones", 0.008], ["crate", 0.004], ["pebbles", 0.02]] },
  crypt: { name: "crypt", ground: ["stonefloor", "mud"], wall: [{ decor: "deadtree" }], outcrop: { decor: "darkstatue" }, built: "stone",
    scatter: [["coffin", 0.01], ["graves", 0.012], ["bones", 0.014], ["brazier", 0.003], ["darkstatue", 0.002]] },
  lair: { name: "dragon lair", ground: ["scorched", "caverock"], wall: [rocks], pond: { ground: "lava" }, outcrop: rocks,
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

export interface Tile {
  zone: number;
  region: number;
  hunt: number; // index into the zone's hunts, -1 outside one
  ground: GroundKind;
  decor: DecorKind | null;
  wall: WallKind | null; // a piece of real wall (World picks which piece by its neighbours)
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
const huntOf = new Int8Array(W * W).fill(-1);
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
}

function regionHunt(gx: number, gy: number): number {
  const i = cell(gx, gy);
  return i < 0 ? -1 : huntOf[i];
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

export const biomeOf = (zone: number, hunt = -1): Biome => BIOMES[hunt >= 0 ? ZONES[zone].hunts[hunt].biome : ZONES[zone].biome];

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
  const za = regionZone(ax, ay), zb = regionZone(bx, by), ha = regionHunt(ax, ay), hb = regionHunt(bx, by);
  const biome = biomeOf(za, ha);
  const v = hash(tx, ty, SEED + 19);
  const start = Math.abs(tx) < 4 && Math.abs(ty) < 4; // a clearing to start in
  // Patches of the biome's other grounds.
  const g = biome.ground;
  let ground: GroundKind = g.length > 1 && noise(tx / 7, ty / 7, SEED + 9) > 0.62 ? g[1 + Math.floor(hash(ax, ay, SEED + 10) * (g.length - 1))] : g[0];
  let decor: DecorKind | null = null, wall: WallKind | null = null;
  const fill = (f: Fill) => { if (f.ground) ground = f.ground; if (f.decor) decor = f.decor; };
  // How thick this side of the border's wall is: between zones both sides wall up; around a hunting ground
  // only its own side does (a real wall if it has one), so it reads as a walled place with entrances.
  const thick = za !== zb ? ZONE_WALL : ha !== hb ? (ha < 0 ? 0 : ZONE_WALL * 0.8) : INNER_WALL;
  const house = biome.built && !start ? building(ax, ay, sa, tx, ty) : null;
  const inTown = Math.abs(tx) <= 12 && Math.abs(ty) <= 10;
  const town = inTown ? village(tx, ty) : null;
  if (town?.floor) ground = "stonefloor";

  if (edge < thick && !start && !inTown && walled(ax, ay, za, ha, bx, by, zb, hb) && !inGate(wx, wy, ax, ay, sa, bx, by, sb, len)) {
    fill(pick(biome.wall, hash(tx, ty, SEED + 12)));
  } else if (town?.wall) {
    wall = "stone";
  } else if (town?.decor) {
    decor = town.decor;
  } else if (inTown) {
    // the village: flowers and pebbles, nothing in the way
    if (hash(tx, ty, SEED + 17) < 0.04) decor = hash(tx, ty, SEED + 18) < 0.7 ? "flowers" : "pebbles";
    if (town?.floor || town?.near) decor = null;
  } else if (house?.wall && edge > 3) {
    wall = biome.built!;
  } else if (!start) {
    const inner = edge > MARGIN && (wx - sa[0]) ** 2 + (wy - sa[1]) ** 2 > 16 && !house?.near;
    if (inner && biome.pond && noise(tx / 6, ty / 6, SEED + 11 + za) > 0.76) fill(biome.pond);
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
  const block = wall !== null || !!GROUNDS[ground].block || (decor !== null && !!DECORS[decor as DecorKind].block);
  return { zone: za, region: regionId(ax, ay), hunt: ha, ground, decor, wall, block, v };
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

/** A hunting ground with real walls has a building in each of its regions: a rectangle of wall around the region's
 *  middle (a palisade fort, stone halls, a sandstone tomb) with doorways on two sides, kept clear of the region's border so there's a way around it. `near`: in or
 *  around it (no ponds there); `hug`: just inside or outside the wall (nothing in the way there). */
function building(ax: number, ay: number, sa: number[], tx: number, ty: number) {
  const cx = Math.round(sa[0]), cy = Math.round(sa[1]);
  const hw = 4 + Math.floor(hash(ax, ay, SEED + 41) * 3), hh = 3 + Math.floor(hash(ax, ay, SEED + 42) * 3);
  const dx = tx - cx, dy = ty - cy, adx = Math.abs(dx), ady = Math.abs(dy);
  if (adx > hw + 2 || ady > hh + 2) return { wall: false, near: false, hug: false };
  const perim = (adx === hw && ady <= hh) || (ady === hh && adx <= hw);
  // Doorways two tiles wide in the middle of a side: N, E, S, W.
  const d1 = Math.floor(hash(ax, ay, SEED + 43) * 4), d2 = (d1 + 1 + Math.floor(hash(ax, ay, SEED + 44) * 3)) % 4;
  const door = (side: number) => (side === 0 ? dy === -hh && (dx === 0 || dx === -1) : side === 2 ? dy === hh && (dx === 0 || dx === -1)
    : side === 1 ? dx === hw && (dy === 0 || dy === -1) : dx === -hw && (dy === 0 || dy === -1));
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
/** The hunting ground a tile is in, if any. */
export function huntAt(tx: number, ty: number): Hunt | null {
  const t = tileAt(tx, ty);
  return t.hunt >= 0 ? ZONES[t.zone].hunts[t.hunt] : null;
}
/** Tibia's ground speed of a tile (how long a step from it takes). */
export const groundSpeed = (tx: number, ty: number) => GROUNDS[tileAt(tx, ty).ground].speed ?? 150;
/** A tile's colour on the minimap. */
export function mapColor(tx: number, ty: number): [number, number, number] {
  const t = tileAt(tx, ty);
  const [r, g, b] = GROUNDS[t.ground].color;
  if (t.wall) return [60, 50, 40];
  return t.decor && DECORS[t.decor].block ? [r * 0.5, g * 0.55, b * 0.5] : [r, g, b];
}
