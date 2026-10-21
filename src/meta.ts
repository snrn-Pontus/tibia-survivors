// Between runs (Project Ebonhold style): souls earned in every run are banked when it ends, and buy
// permanent unlocks: better starting gear, starting gold and potions, rerolls, blessings and rate boosts.
// Inside a run everything is real Tibia. Saved in localStorage, per character.
import type { VocationId } from "./tibia/db";
import { MAX_BOOST, type BoostId } from "./upgrades";

export interface Save {
  souls: number;
  unlocks: Record<string, number>; // track id -> tier reached (0 = base)
  boosts: Partial<Record<BoostId, number>>;
  blessings: number; // bought for the next run
  runs: number;
  best: { zone: number; level: number; kills: number } | null;
  maxLevel: number; // highest level reached in any run (Dawnport needs 8)
  zones: number[]; // zones with a kill in them, ever: their exploration souls are paid
  kills: Record<string, number>; // per creature over all runs, for achievements
  version?: number; // 3: Rookgaard starting gear (see migrate)
  refunded?: number; // souls given back by the last migration, shown once on the title screen
}

const OLD_KEY = "tibia-survivors-save-v2"; // the one save before characters
const KEY = "tibia-survivors-account-v1";
const fresh = (): Save => ({ souls: 0, unlocks: {}, boosts: {}, blessings: 0, runs: 0, best: null, maxLevel: 0, zones: [], kills: {}, version: 3 });
const noStorage = () => typeof localStorage === "undefined" || typeof localStorage?.setItem !== "function";

// ---------- characters ----------
// The account holds characters, each with its own souls, unlocks, boosts, bestiary and achievements. The first
// vocation a character chooses at level 8 is its vocation from then on.

export interface CharacterSave extends Save {
  name: string;
  vocation?: VocationId; // locked in by its first choice at level 8
  created: number;
}
interface Account { characters: CharacterSave[]; current: number }

export const newCharacter = (name: string): CharacterSave => ({ ...fresh(), name, created: Date.now() });
let memory: Account | null = null; // when there is no usable localStorage (the headless simulator)

function loadAccount(): Account {
  if (noStorage()) return (memory ??= { characters: [newCharacter("Bot")], current: 0 });
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const a = JSON.parse(raw) as Account;
      a.characters = a.characters.map((c) => migrate({ ...fresh(), ...c }) as CharacterSave);
      return a;
    }
  } catch {
    // unreadable: start over below (the old save, if any, is still there)
  }
  // First time with characters: the save from before becomes the first one.
  let old: Partial<Save> | null = null;
  try { old = JSON.parse(localStorage.getItem(OLD_KEY) ?? "null"); } catch { old = null; }
  const a: Account = old ? { characters: [migrate({ ...newCharacter("Adventurer"), ...old }) as CharacterSave], current: 0 } : { characters: [], current: -1 };
  writeAccount(a);
  return a;
}

function writeAccount(a: Account) {
  if (noStorage()) memory = a;
  else localStorage.setItem(KEY, JSON.stringify(a));
}

export const characters = (): CharacterSave[] => loadAccount().characters;
export const currentCharacter = (): number => loadAccount().current;

export function selectCharacter(i: number) {
  const a = loadAccount();
  if (i < 0 || i >= a.characters.length) return;
  a.current = i;
  writeAccount(a);
}

/** A new character, selected. Returns its index. */
export function createCharacter(name: string): number {
  const a = loadAccount();
  a.characters.push(newCharacter(name));
  a.current = a.characters.length - 1;
  writeAccount(a);
  return a.current;
}

export function deleteCharacter(i: number) {
  const a = loadAccount();
  a.characters.splice(i, 1);
  a.current = a.characters.length ? Math.min(Math.max(0, a.current > i ? a.current - 1 : a.current), a.characters.length - 1) : -1;
  writeAccount(a);
}

/** The selected character's save (a blank one if there is none yet). */
export function loadSave(): CharacterSave {
  const a = loadAccount();
  return a.characters[a.current] ?? newCharacter("");
}

export function writeSave(s: Save) {
  const a = loadAccount();
  if (!a.characters[a.current]) return;
  a.characters[a.current] = s as CharacterSave;
  writeAccount(a);
}

/** Starting gear used to go up to mainland items (spike sword, plate armor) that you kept after Rookgaard.
 *  It's Rookgaard's own shop now: every soul spent on the old gear tiers comes back, once. */
const OLD_GEAR_COSTS: Record<string, number[]> = {
  weapon: [15, 40, 150, 300, 1500], shield: [10, 25, 50, 100, 250, 600], armor: [10, 25, 60, 120, 250, 600],
  helmet: [5, 15, 40, 120, 300], legs: [5, 15, 35, 100, 300], boots: [5],
};
function migrate(s: Save): Save {
  if ((s.version ?? 2) >= 3) return s;
  let refund = 0;
  for (const [track, costs] of Object.entries(OLD_GEAR_COSTS)) {
    refund += costs.slice(0, s.unlocks[track] ?? 0).reduce((a, b) => a + b, 0);
    delete s.unlocks[track];
  }
  s.souls += refund;
  s.refunded = refund;
  s.version = 3;
  return s;
}

// ---------- unlock tracks ----------

/** One tier of an unlock track: what you start with, and its soul cost. Item ids are real Tibia items. */
export interface Tier { label: string; cost: number; item?: number; count?: number }
export interface Track {
  id: string; name: string; tiers: Tier[]; // tiers[0] is the free base
  rook?: boolean; // a Rookgaard unlock: it only works until you choose a vocation
  locked?: (s: Save) => string | null; // why it can't be bought yet
}

const it = (label: string, item: number, cost: number): Tier => ({ label, item, cost });

// Starting gear is what Rookgaard's NPCs sell (Obi, Dixi, Lee'Delle): it helps levels 1-8 and is no better
// than what you'd find there, so the mainland stays as hard as it is. (Boots and the scarf aren't sold there, but
// both drop on Rookgaard.)
export const TRACKS: Track[] = [
  { id: "weapon", name: "Starting weapon", tiers: [it("club", 3270, 0), it("rapier", 3272, 10), it("sabre", 3273, 25)] },
  { id: "spears", name: "Starting spears", tiers: [
    { label: "none", cost: 0 }, { label: "5 spears", item: 3277, count: 5, cost: 15 }, { label: "10 spears", item: 3277, count: 10, cost: 40 }] }, // 20 oz each
  { id: "shield", name: "Starting shield", tiers: [{ label: "none", cost: 0 }, it("wooden shield", 3412, 10), it("studded shield", 3426, 25)] },
  { id: "armor", name: "Starting armor", tiers: [it("coat", 3562, 0), it("doublet", 3379, 5), it("leather armor", 3361, 15)] },
  { id: "helmet", name: "Starting helmet", tiers: [{ label: "none", cost: 0 }, it("leather helmet", 3355, 5), it("studded helmet", 3376, 15)] },
  { id: "legs", name: "Starting legs", tiers: [{ label: "none", cost: 0 }, it("leather legs", 3559, 5)] },
  { id: "boots", name: "Starting boots", tiers: [{ label: "none", cost: 0 }, it("leather boots", 3552, 5)] },
  { id: "amulet", name: "Starting amulet", tiers: [{ label: "none", cost: 0 }, it("scarf", 3572, 5)] },
  { id: "potions", name: "Starting health potions", tiers: [
    { label: "none", cost: 0 }, { label: "5 potions", count: 5, cost: 20 }, { label: "15 potions", count: 15, cost: 60 },
    { label: "30 potions", count: 30, cost: 150 }] },
  { id: "gold", name: "Starting gold", tiers: [
    { label: "none", cost: 0 }, { label: "100 gold", count: 100, cost: 25 }, { label: "500 gold", count: 500, cost: 100 },
    { label: "2,000 gold", count: 2000, cost: 400 }] },
  { id: "rerolls", name: "Rerolls per run", tiers: [
    { label: "none", cost: 0 }, { label: "1 reroll", count: 1, cost: 50 }, { label: "2 rerolls", count: 2, cost: 150 },
    { label: "3 rerolls", count: 3, cost: 400 }] },
  // Rookgaard: these make levels 1-8 faster and stop working when you choose a vocation, so the mainland
  // stays real Tibia. At x1 level 8 is about 840 rats (hours, as in Tibia); `npm run sim:rook` puts a knight
  // with a sword at level 8 in ~14 min at x10, ~7 at x20, ~3 at x50, always with about the same skills
  // (training keeps pace with the faster levels, it doesn't add to them).
  { id: "rook_xp", name: "Rookgaard experience", rook: true, tiers: [
    { label: "x1", count: 1, cost: 0 }, { label: "x5", count: 5, cost: 15 }, { label: "x10", count: 10, cost: 40 },
    { label: "x20", count: 20, cost: 100 }, { label: "x50", count: 50, cost: 250 }] },
  { id: "rook_train", name: "Rookgaard training", rook: true, tiers: [
    { label: "x1", count: 1, cost: 0 }, { label: "x5", count: 5, cost: 15 }, { label: "x10", count: 10, cost: 40 },
    { label: "x20", count: 20, cost: 100 }, { label: "x50", count: 50, cost: 250 }] },
  { id: "rook_regen", name: "Rookgaard regeneration", rook: true, tiers: [
    { label: "x1", count: 1, cost: 0 }, { label: "x5", count: 5, cost: 20 }, { label: "x10", count: 10, cost: 60 },
    { label: "x20", count: 20, cost: 150 }] },
  { id: "dawnport", name: "Dawnport", rook: true, locked: (s) => (s.maxLevel >= 8 || (s.best?.level ?? 0) >= 8 ? null : "Reach level 8 once"),
    tiers: [{ label: "start in Rookgaard", cost: 0 }, { label: "start at level 8", cost: 400 }] },
];

export const tier = (s: Save, track: string) => s.unlocks[track] ?? 0;
export const trackTier = (s: Save, t: Track) => t.tiers[tier(s, t.id)];

export function buyTier(s: Save, t: Track): boolean {
  const next = t.tiers[tier(s, t.id) + 1];
  if (!next || s.souls < next.cost || t.locked?.(s)) return false;
  s.souls -= next.cost;
  s.unlocks[t.id] = tier(s, t.id) + 1;
  writeSave(s);
  return true;
}

// ---------- boosts and blessings ----------

/** Soul cost of the first level of each boost; every further level costs twice the last. */
const BASE_COST: Record<BoostId, number> = {
  xp: 30, loot: 25, gold: 20, haste: 25,
  train_sword: 20, train_axe: 20, train_club: 20, train_distance: 20, train_shielding: 20, train_magic: 25,
};
export const BLESSING_COST = 100; // souls per blessing, for one run

export const boostCost = (id: BoostId, level: number) => BASE_COST[id] * Math.pow(2, level);

export function buyBoost(s: Save, id: BoostId): boolean {
  const lvl = s.boosts[id] ?? 0;
  const cost = boostCost(id, lvl);
  if (lvl >= MAX_BOOST || s.souls < cost) return false;
  s.souls -= cost;
  s.boosts[id] = lvl + 1;
  writeSave(s);
  return true;
}

export function buyBlessing(s: Save): boolean {
  if (s.souls < BLESSING_COST || s.blessings >= 5) return false;
  s.souls -= BLESSING_COST;
  s.blessings++;
  writeSave(s);
  return true;
}
