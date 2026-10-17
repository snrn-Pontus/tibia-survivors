// Evolutions, Vampire Survivors style: a boss chest turns a maxed upgrade plus a partner into a super upgrade.
// The maxed upgrade keeps working and keeps its slot; the evolution adds its effect on top.
import type { Character } from "./character";
import { IMBUEMENTS, imbuement } from "./tibia/imbuements";
import { boost, MAX_BOOST, type BoostId } from "./upgrades";

export type EvolutionId = "stamina" | "goldpouch" | "draken" | "bloodrage" | "mastermind" | "avatarsteel" | "elementalburst" | "weaponmastery";

export interface EvolutionDef {
  id: EvolutionId;
  name: string;
  icon: number; // item id
  desc: string;
  recipe: string; // shown to the player
  /** The upgrades that lead here, for hints on level-up cards. */
  parts: string[];
  ready: (ch: Character) => boolean;
}

const maxBoost = (ch: Character, id: BoostId) => ch.boostLevel(id) >= MAX_BOOST;
const has = (ch: Character, id: string) => ch.boosts.has(id as BoostId) || ch.imbuements.has(id);
const powerful = (ch: Character, id: string) => (ch.imbuements.get(id) ?? 0) >= 3;
const kinds = (kind: string) => IMBUEMENTS.filter((d) => d.kind === kind).map((d) => d.id);
const WEAPON_TRAINING: BoostId[] = ["train_sword", "train_axe", "train_club", "train_distance"];

export const EVOLUTIONS: EvolutionDef[] = [
  { id: "stamina", name: "Stamina Bonus", icon: 3061, parts: ["xp", "gold"],
    recipe: "XP Boost 10 + Gold Boost", desc: "Experience x4 on top of XP Boost.",
    ready: (ch) => maxBoost(ch, "xp") && has(ch, "gold") },
  { id: "goldpouch", name: "Gold Pouch", icon: 3043, parts: ["gold", "loot"],
    recipe: "Gold Boost 10 + Loot Boost", desc: "Loot corpses from 3 tiles away; loot you can't use is sold on the spot.",
    ready: (ch) => maxBoost(ch, "gold") && has(ch, "loot") },
  { id: "draken", name: "Draken Boots", icon: 3079, parts: ["haste", "swiftness"],
    recipe: "Haste 10 + Swiftness", desc: "Speed +60, and you walk through monsters.",
    ready: (ch) => maxBoost(ch, "haste") && has(ch, "swiftness") },
  { id: "bloodrage", name: "Blood Rage", icon: 3281, parts: ["vampirism", "strike"],
    recipe: "Powerful Vampirism + Strike", desc: "30% critical hit chance, and critical hits heal you for the damage.",
    ready: (ch) => powerful(ch, "vampirism") && has(ch, "strike") },
  { id: "mastermind", name: "Mastermind", icon: 3059, parts: ["train_magic", "void"],
    recipe: "Magic Training 10 + Void", desc: "Spells cost half mana and recharge 30% faster.",
    ready: (ch) => maxBoost(ch, "train_magic") && has(ch, "void") },
  { id: "avatarsteel", name: "Avatar of Steel", icon: 3409, parts: ["train_shielding", ...kinds("protect")],
    recipe: "Shield Training 10 + any protection imbuement", desc: "Take 30% less damage.",
    ready: (ch) => maxBoost(ch, "train_shielding") && kinds("protect").some((id) => has(ch, id)) },
  { id: "elementalburst", name: "Elemental Burst", icon: 3280, parts: [...kinds("convert"), ...kinds("skill")],
    recipe: "A Powerful elemental damage imbuement + a skill imbuement", desc: "Your weapon's element also hits every monster next to the target.",
    ready: (ch) => kinds("convert").some((id) => powerful(ch, id)) && kinds("skill").some((id) => has(ch, id)) },
  { id: "weaponmastery", name: "Weapon Mastery", icon: 3278, parts: [...WEAPON_TRAINING, "xp"],
    recipe: "Sword, Axe, Club or Distance Training 10 + XP Boost", desc: "Weapon attacks come twice as fast.",
    ready: (ch) => WEAPON_TRAINING.some((id) => maxBoost(ch, id)) && has(ch, "xp") },
];

export const evolution = (id: string) => EVOLUTIONS.find((e) => e.id === id)!;

/** Evolutions an upgrade is part of (for hints on cards). */
export function evolutionsFor(upgradeId: string) {
  return EVOLUTIONS.filter((e) => e.parts.includes(upgradeId));
}

export const upgradeName = (id: string) => boost(id)?.name ?? (IMBUEMENTS.some((d) => d.id === id) ? imbuement(id).name : id);
