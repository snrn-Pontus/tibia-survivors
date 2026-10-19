// Typed access to src/tibia/data.json (real Tibia data from the Canary server, see tools/fetch_tibia_data.py).
import raw from "./data.json";

export type Element = "physical" | "fire" | "energy" | "earth" | "ice" | "holy" | "death" | "lifedrain" | "manadrain" | "drown" | "healing";
export type VocationId = "none" | "knight" | "paladin" | "sorcerer" | "druid";

export interface MonsterAttack {
  name: string;
  interval: number;
  chance: number;
  min: number;
  max: number;
  element?: Element;
  range?: number;
  radius?: number;
  length?: number;
  spread?: number;
  target?: boolean;
  shoot?: number;
  effect?: number;
  /** Damage over time on a hit (poison from a melee bite), or all a "condition" spell does: a total rolled
   *  from min-max, dealt in shrinking ticks every `tick` ms (Canary's ConditionDamage). */
  condition?: { element: Element; min: number; max: number; tick: number };
  field?: number; // a field spell: the magic field item it leaves on every tile of its area
  speedChange?: number; // a paralyze spell: how much of your base speed it takes, per mille (negative)
  duration?: number; // ms
}

/** A bestiary charm: its chance (or value) per tier 1-3, and for damage charms the percent and element. */
export interface CharmData { name: string; description: string; chance: number[]; major: boolean; percent?: number; element?: Element }

/** A magic field lying on the ground (items.xml): stepping in starts its ticks, one every `every` ms
 *  (fire: 7 x 20, poison: a shrinking 100, energy: one 25). It lasts `duration` seconds, then turns into
 *  `decayTo` (a fire field cools down twice before it goes out) or disappears. */
export interface FieldData { id: number; name: string; element: Element; duration: number; decayTo: number; ticks: number[]; every: number }

export interface MonsterData {
  name: string;
  health: number;
  experience: number;
  speed: number;
  lookType: number;
  corpse: number; // item id of the body it leaves
  targetDistance: number;
  runHealth: number;
  attacks: MonsterAttack[];
  defense: number; // in the data, but not used on monsters (see Game.damageMonster)
  armor: number;
  mitigation: number; // percent of damage it shrugs off
  heals: { interval: number; chance: number; min: number; max: number }[];
  elements: Partial<Record<Element, number>>;
  loot: { id: number; chance: number; max: number }[];
  /** monster.summon: at most maxSummons alive; each kind rolls `chance`% every `interval` ms, up to `count` of it. */
  maxSummons: number;
  summons: { name: string; interval: number; chance: number; count: number }[];
}

export interface SpellData {
  file: string;
  name: string;
  words?: string;
  group: "attack" | "healing" | "support";
  kind: "instant" | "rune";
  level?: number;
  mana?: number;
  range?: number;
  magicLevel?: number;
  runeId?: number;
  cooldown?: number;
  groupCooldown?: number;
  needDirection: boolean;
  needTarget: boolean;
  selfTarget: boolean;
  vocations: string[];
  element: Element;
  effect: number;
  shoot: number;
  blockArmor: boolean;
  area?: string;
  areaRows?: number[][];
  formulaKind?: "skill" | "magic";
  formula?: string;
}

export interface ItemData {
  id: number;
  name: string;
  slot?: string;
  slottype?: string;
  weapontype?: string;
  attack?: number;
  defense?: number;
  extradef?: number;
  armor?: number;
  range?: number;
  shoottype?: string;
  maxhitchance?: number;
  ammotype?: string;
  level?: number;
  vocation?: string;
  fromdamage?: number;
  todamage?: number;
  wandtype?: string;
  mana?: number;
  speed?: number;
  healthgain?: number;
  healthticks?: number;
  managain?: number;
  manaticks?: number;
  transformequipto?: number;
  transformdeequipto?: number;
  weight?: number; // hundredths of an oz (items.xml)
  duration?: number; // seconds an equipped ring lasts
  charges?: number; // hits an amulet or ring absorbs before it's used up
  magiclevelpoints?: number;
  [key: string]: string | number | undefined;
}

export interface VocationData {
  gainHp: number;
  gainMana: number;
  gainCap: number; // capacity (oz) per level
  gainHpTicks: number;
  gainHpAmount: number;
  gainManaTicks: number;
  gainManaAmount: number;
  manaMultiplier: number;
  baseSpeed: number;
  attackSpeed: number;
  meleeDamage: number;
  distDamage: number;
  defense: number;
  armor: number;
  skillMultipliers: number[]; // fist, club, sword, axe, distance, shielding, fishing
  mitigation: number; // <mitigation multiplier primaryShield secondaryShield> in vocations.xml
  primaryShield: number;
  secondaryShield: number;
}

export interface PotionData { health?: [number, number]; mana?: [number, number]; level?: number; voc?: string[] }

const data = raw as unknown as {
  monsters: Record<string, MonsterData>;
  spells: SpellData[];
  areas: Record<string, number[][]>;
  items: Record<string, ItemData>;
  starter: Record<string, number>;
  vocations: Record<VocationId, VocationData>;
  potions: Record<string, PotionData>;
  prices: Record<string, { buy?: number; sell?: number }>;
  fields: Record<string, FieldData>;
  kits: Record<"knight" | "paladin" | "sorcerer" | "druid", { items: number[]; container: [number, number][] }>;
  rookShop: Record<string, number>;
  charms: CharmData[];
  spellGrades: Record<string, { wheel?: Record<string, number>[]; gem?: Record<string, number> }>;
};

export const MONSTERS = data.monsters;
export const SPELLS = data.spells;
export const VOCATION_DATA = data.vocations;
export const POTIONS = data.potions;
export const STARTER = data.starter;
export const FIELDS = data.fields;
/** Canary's starting kits per vocation (send_first_items.lua). */
export const KITS = data.kits;
/** What Rookgaard's NPCs sell, and for how much (Obi, Dixi, Lee'Delle, Al Dee). */
export const ROOK_SHOP = data.rookShop;
/** Bestiary charms (bestiary_charms.lua). */
export const CHARMS = data.charms;
/** Wheel of Destiny spell bonuses by spell name (see picks.ts). */
export const SPELL_GRADES = data.spellGrades;
/** NPC prices: the cheapest an NPC sells for, the most one pays (from Canary's NPC shop lists). */
export const PRICES = data.prices;

export const item = (id: number): ItemData | undefined => data.items[id];
export const itemId = (name: string): number => {
  const id = data.starter[name];
  if (id === undefined) throw new Error(`unknown starter item ${name}`);
  return id;
};

/** Stats of an item while worn (rings change into another item when equipped). */
export function wornItem(id: number): ItemData | undefined {
  const it = item(id);
  return it?.transformequipto ? item(it.transformequipto) ?? it : it;
}

/** What the shop charges for an item (0: not sold). NPC wares at their NPC price; equipment only monsters drop
 *  at three times what an NPC pays for it (so selling it back returns a third), or, for treasures no NPC buys
 *  (umbral weapons, golden boots...), 2,000 gold per level they need and at least 100,000. */
export const SHOP_PRICES: Record<number, number> = (() => {
  const out: Record<number, number> = {};
  for (const [k, p] of Object.entries(PRICES)) if (p.buy) out[Number(k)] = p.buy;
  const gear = (it: ItemData) => it.weapontype || ["head", "armor", "legs", "feet", "ring", "necklace", "shield", "hand", "two-handed", "ammo"].includes(it.slot ?? "");
  for (const m of Object.values(MONSTERS)) {
    for (const l of m.loot) {
      const it = item(l.id);
      if (!it || out[l.id] || !gear(it)) continue;
      const sell = PRICES[l.id]?.sell ?? 0;
      out[l.id] = sell ? sell * 3 : Math.max(100000, 2000 * (it.level ?? 0));
    }
  }
  return out;
})();
export const buyPrice = (id: number) => SHOP_PRICES[id] ?? 0;

export function canWear(it: ItemData, voc: VocationId, level: number): boolean {
  if (it.level && level < it.level) return false;
  if (typeof it.vocation === "string") {
    const vocs = it.vocation.toLowerCase();
    if (!vocs.includes(voc)) return false;
  }
  return true;
}

// ---------- spell formulas ----------

const SAFE = /^[\s\w.+\-*/()[\];,=]*$/;
const ALLOWED_WORDS = new Set(["const", "return", "level", "maglevel", "magicLevel", "skill", "attack", "factor", "min", "max", "skillTotal", "levelTotal"]);
type Formula = (level: number, maglevel: number, skill: number, attack: number) => [number, number];
const formulaCache = new Map<string, Formula>();

/** Compile a spell's damage formula (Lua translated by the fetcher), after checking it is plain arithmetic. */
export function spellFormula(s: SpellData): Formula {
  let f = formulaCache.get(s.file);
  if (f) return f;
  const src = s.formula ?? "return [0, 0];";
  const words = src.match(/[A-Za-z_]\w*/g) ?? [];
  if (!SAFE.test(src) || words.some((w) => !ALLOWED_WORDS.has(w))) throw new Error(`unsafe formula in ${s.file}`);
  const fn = new Function("level", "maglevel", "skill", "attack", `const magicLevel = maglevel; const factor = 1;\n${src}`) as Formula;
  f = (level, ml, skill, attack) => {
    const [a, b] = fn(level, ml, skill, attack);
    const lo = Math.abs(a), hi = Math.abs(b);
    return [Math.min(lo, hi), Math.max(lo, hi)];
  };
  formulaCache.set(s.file, f);
  return f;
}

// ---------- areas ----------

export type Offsets = [number, number][];

/** Tiles hit by an area, relative to its centre, for a facing (0 N, 1 E, 2 S, 3 W). Values 1 and 3 hit; 3 (or 2) is the centre. */
export function areaOffsets(rows: number[][], dir = 0): Offsets {
  let cx = 0, cy = 0;
  rows.forEach((r, y) => r.forEach((v, x) => { if (v === 2 || v === 3) { cx = x; cy = y; } }));
  const out: Offsets = [];
  rows.forEach((r, y) => r.forEach((v, x) => {
    if (v !== 1 && v !== 3) return;
    const dx = x - cx, dy = y - cy; // north-facing
    out.push(dir === 0 ? [dx, dy] : dir === 1 ? [-dy, dx] : dir === 2 ? [-dx, -dy] : [dy, -dx]);
  }));
  return out;
}

export function spellArea(s: SpellData): number[][] | null {
  if (s.areaRows) return s.areaRows;
  if (s.area && data.areas[s.area]) return data.areas[s.area];
  return null;
}

/** Monster wave/beam: AreaCombat::setupArea(length, spread). */
export function waveRows(length: number, spread: number): number[][] {
  const rows: number[][] = [];
  const cols = spread ? ((length - (length % spread)) / spread) * 2 + 1 : 1;
  let colSpread = cols;
  for (let y = 1; y <= length; y++) {
    const mincol = cols - colSpread + 1, maxcol = cols - (cols - colSpread);
    const row: number[] = [];
    for (let x = 1; x <= cols; x++) {
      if (y === length && x === (cols - (cols % 2)) / 2 + 1) row.push(3);
      else row.push(x >= mincol && x <= maxcol ? 1 : 0);
    }
    rows.push(row);
    if (spread > 0 && y % spread === 0) colSpread--;
  }
  return rows;
}

const RADIUS = [
  [0, 0, 0, 0, 0, 0, 8, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 8, 8, 7, 8, 8, 0, 0, 0, 0],
  [0, 0, 0, 8, 7, 6, 6, 6, 7, 8, 0, 0, 0],
  [0, 0, 8, 7, 6, 5, 5, 5, 6, 7, 8, 0, 0],
  [0, 8, 7, 6, 5, 4, 4, 4, 5, 6, 7, 8, 0],
  [0, 8, 6, 5, 4, 3, 2, 3, 4, 5, 6, 8, 0],
  [8, 7, 6, 5, 4, 2, 1, 2, 4, 5, 6, 7, 8],
  [0, 8, 6, 5, 4, 3, 2, 3, 4, 5, 6, 8, 0],
  [0, 8, 7, 6, 5, 4, 4, 4, 5, 6, 7, 8, 0],
  [0, 0, 8, 7, 6, 5, 5, 5, 6, 7, 8, 0, 0],
  [0, 0, 0, 8, 7, 6, 6, 6, 7, 8, 0, 0, 0],
  [0, 0, 0, 0, 8, 8, 7, 8, 8, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 8, 0, 0, 0, 0, 0, 0],
];

/** Monster radius attack: AreaCombat::setupArea(radius). */
export function radiusRows(radius: number): number[][] {
  return RADIUS.map((r) => r.map((c) => (c === 1 ? 3 : c > 0 && c <= radius ? 1 : 0)));
}
