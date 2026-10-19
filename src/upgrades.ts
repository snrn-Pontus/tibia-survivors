// Boosts: the one non-vanilla lever, bought between runs. Rates start at real Tibia's x1; boost levels
// multiply them along RATE_TABLE (x3 at level 1, x256 at 10), so a focused build goes from vanilla to absurd.
import type { VocationId } from "./tibia/db";
import { SKILL } from "./tibia/rules";

export const MAX_SLOTS = 6; // distinct boosts + imbuements you can pick in a run
/** Rate multiplier per boost level: front-loaded so the first purchases matter, still wild at the top. */
export const RATE_TABLE = [1, 2, 3, 5, 7, 10, 14, 19, 25, 35, 50];
/** Speed added per Haste level. */
export const HASTE_TABLE = [0, 30, 55, 75, 90, 105, 120, 135, 150, 165, 180];
export const MAX_BOOST = 10; // x1024 at the top
export const MAX_PENDING = 5; // queued level-up choices; extra levels at once don't add more

export type BoostId = "xp" | "loot" | "gold" | "haste" | "train_club" | "train_sword" | "train_axe" | "train_distance" | "train_shielding" | "train_magic";

export interface BoostDef {
  id: BoostId;
  name: string;
  icon: number; // item id shown on the card
  skill?: number | "magic";
  desc: (level: number) => string;
  for: (voc: VocationId) => boolean;
}

const rate = (l: number) => RATE_TABLE[Math.min(l, RATE_TABLE.length - 1)];
export const hasteBonus = (l: number) => HASTE_TABLE[Math.min(l, HASTE_TABLE.length - 1)];
const fmt = (x: number) => (x >= 10 ? Math.round(x).toLocaleString("en-US") : x.toFixed(x >= 3 ? 1 : 2).replace(/\.?0+$/, ""));
const knight = (v: VocationId) => v === "knight";
const mage = (v: VocationId) => v === "sorcerer" || v === "druid";

export const BOOSTS: BoostDef[] = [
  { id: "xp", name: "XP Boost", icon: 3061, desc: (l) => `Experience x${fmt(rate(l))}.`, for: () => true },
  { id: "loot", name: "Loot Boost", icon: 2854, desc: (l) => `Item drop chances x${fmt(rate(l))}.`, for: () => true },
  { id: "gold", name: "Gold Boost", icon: 3035, desc: (l) => `Gold dropped x${fmt(rate(l))}.`, for: () => true },
  { id: "haste", name: "Haste", icon: 3079, desc: (l) => `Speed +${hasteBonus(l)}.`, for: () => true },
  { id: "train_sword", name: "Sword Training", icon: 3264, skill: SKILL.sword, desc: (l) => `Sword fighting trains x${fmt(rate(l))} faster.`, for: knight },
  { id: "train_axe", name: "Axe Training", icon: 3274, skill: SKILL.axe, desc: (l) => `Axe fighting trains x${fmt(rate(l))} faster.`, for: knight },
  { id: "train_club", name: "Club Training", icon: 3270, skill: SKILL.club, desc: (l) => `Club fighting trains x${fmt(rate(l))} faster.`, for: knight },
  { id: "train_distance", name: "Distance Training", icon: 3350, skill: SKILL.distance, desc: (l) => `Distance fighting trains x${fmt(rate(l))} faster.`, for: (v) => v === "paladin" },
  { id: "train_shielding", name: "Shield Training", icon: 3409, skill: SKILL.shielding, desc: (l) => `Shielding trains x${fmt(rate(l))} faster.`, for: () => true }, // offered only while you hold a shield or spellbook
  { id: "train_magic", name: "Magic Training", icon: 3059, skill: "magic", desc: (l) => `Magic level trains x${fmt(rate(l))} faster.`, for: (v) => mage(v) || v === "paladin" },
];

export const boost = (id: string) => BOOSTS.find((b) => b.id === id);

/** Run bonuses: level-up picks that only last this run (the boosts above are bought with souls and stay).
 *  Each pick adds RUN_BONUS_STEP percent, up to RUN_BONUS_MAX picks, on top of the boost. */
export type RunBonusId = "xp" | "gold" | "loot" | "skill" | "magic";
export const RUN_BONUS_STEP = 20;
export const RUN_BONUS_MAX = 5;
export interface RunBonusDef { id: RunBonusId; name: string; icon: number; what: string; for: (voc: VocationId) => boolean }
export const RUN_BONUSES: RunBonusDef[] = [
  { id: "xp", name: "Experience", icon: 3061, what: "experience", for: () => true },
  { id: "gold", name: "Gold", icon: 3035, what: "gold dropped", for: () => true },
  { id: "loot", name: "Loot", icon: 2854, what: "item drop chances", for: () => true },
  { id: "skill", name: "Skill training", icon: 3264, what: "skill training (weapons, shielding)", for: (v) => !mage(v) },
  { id: "magic", name: "Magic training", icon: 3059, what: "magic level training", for: (v) => mage(v) || v === "paladin" },
];
export const runBonus = (id: string) => RUN_BONUSES.find((b) => b.id === id)!;
export const boostRate = (level: number) => rate(level);
export const formatRate = fmt;
