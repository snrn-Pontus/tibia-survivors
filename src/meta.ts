// Between runs (Project Ebonhold style): souls earned in every run are banked when it ends, and buy
// permanent unlocks: better starting gear, starting gold and potions, rerolls, blessings and rate boosts.
// Inside a run everything is real Tibia. Saved in localStorage.
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
}

const KEY = "tibia-survivors-save-v2";
const fresh = (): Save => ({ souls: 0, unlocks: {}, boosts: {}, blessings: 0, runs: 0, best: null, maxLevel: 0, zones: [], kills: {} });
let memory: Save | null = null; // when there is no usable localStorage (the headless simulator)
const noStorage = () => typeof localStorage === "undefined" || typeof localStorage?.setItem !== "function";

export function loadSave(): Save {
  if (noStorage()) return (memory ??= fresh());
  try {
    return { ...fresh(), ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
  } catch {
    return fresh();
  }
}

export function writeSave(s: Save) {
  if (noStorage()) memory = s;
  else localStorage.setItem(KEY, JSON.stringify(s));
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

export const TRACKS: Track[] = [
  { id: "weapon", name: "Starting weapon", tiers: [
    it("club", 3270, 0), it("sword", 3264, 15), it("mace", 3286, 40), it("battle hammer", 3305, 150),
    it("morning star", 3282, 300), it("spike sword", 3271, 1500)] },
  { id: "shield", name: "Starting shield", tiers: [
    { label: "none", cost: 0 }, it("wooden shield", 3412, 10), it("studded shield", 3426, 25), it("brass shield", 3411, 50),
    it("plate shield", 3410, 100), it("steel shield", 3409, 250), it("dwarven shield", 3425, 600)] },
  { id: "armor", name: "Starting armor", tiers: [
    it("coat", 3562, 0), it("leather armor", 3361, 10), it("studded armor", 3378, 25), it("chain armor", 3358, 60),
    it("scale armor", 3377, 120), it("brass armor", 3359, 250), it("plate armor", 3357, 600)] },
  { id: "helmet", name: "Starting helmet", tiers: [
    { label: "none", cost: 0 }, it("leather helmet", 3355, 5), it("studded helmet", 3376, 15), it("brass helmet", 3354, 40),
    it("iron helmet", 3353, 120), it("steel helmet", 3351, 300)] },
  { id: "legs", name: "Starting legs", tiers: [
    { label: "none", cost: 0 }, it("leather legs", 3559, 5), it("studded legs", 3362, 15), it("chain legs", 3558, 35),
    it("brass legs", 3372, 100), it("plate legs", 3557, 300)] },
  { id: "boots", name: "Starting boots", tiers: [{ label: "none", cost: 0 }, it("leather boots", 3552, 5)] },
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
