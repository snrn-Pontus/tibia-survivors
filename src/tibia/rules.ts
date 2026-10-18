// Tibia's formulas, ported from the Canary server (see the file/function named on each).
import type { ItemData, VocationData } from "./db";

export const SKILL = { fist: 0, club: 1, sword: 2, axe: 3, distance: 4, shielding: 5 } as const;
export const SKILL_NAMES = ["Fist Fighting", "Club Fighting", "Sword Fighting", "Axe Fighting", "Distance Fighting", "Shielding"];

/** Total experience needed to reach a level (Player::getExpForLevel). */
export function expForLevel(level: number): number {
  const l = level - 1;
  return Math.floor((50 * l * l * l - 150 * l * l + 400 * l) / 3);
}

/** Max HP / mana: 150 HP and 55 mana at level 1, +5 each per level until 8 (no vocation gains yet),
 *  then the vocation's gain per level (vocations.xml): 185 HP and 90 mana at level 8. */
export const maxHealthAt = (v: VocationData, level: number) => (level < 8 ? 150 + (level - 1) * 5 : 185 + (level - 8) * v.gainHp);
export const maxManaAt = (v: VocationData, level: number) => (level < 8 ? 55 + (level - 1) * 5 : 90 + (level - 8) * v.gainMana);

const SKILL_BASE = [50, 50, 50, 50, 30, 100, 20]; // Vocation::skillBase

/** Tries needed to advance from `level` to `level + 1` (Vocation::getReqSkillTries, minimum skill level 10). */
export function reqSkillTries(v: VocationData, skill: number, level: number, multiplier = v.skillMultipliers[skill]): number {
  return Math.floor(SKILL_BASE[skill] * Math.pow(multiplier, level + 1 - 11));
}

/** Mana to spend to reach magic level `ml + 1` (Vocation::getReqMana). */
export function reqMana(v: VocationData, ml: number): number {
  return Math.floor(1600 * Math.pow(v.manaMultiplier, ml));
}

/** normal_random from Canary's tools.cpp: a normal distribution around the middle, clamped to [min, max]. */
export function normalRandom(min: number, max: number): number {
  if (max <= min) return min;
  const diff = max - min;
  let v: number;
  do {
    const u = 1 - Math.random(), w = Math.random();
    v = 0.5 + Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * w) * 0.25;
  } while (v < 0 || v > 1);
  return Math.round(min + diff * v);
}

export const uniform = (min: number, max: number) => min + Math.floor(Math.random() * (max - min + 1));

/** ConditionDamage::generateDamageList: the ticks of a damage-over-time condition, from `start` down to 1,
 *  each value repeated while the running sum tracks `amount` (a 30 poison: 2 seven times, then 1 sixteen times). */
export function damageList(amount: number, start: number): number[] {
  amount = Math.abs(amount);
  const list: number[] = [];
  let sum = 0;
  for (let i = start; i > 0; i--) {
    const med = Math.trunc(((start + 1 - i) * amount) / start);
    let x1: number, x2: number;
    do {
      sum += i;
      list.push(i);
      x1 = Math.abs(1 - (sum + i) / med);
      x2 = Math.abs(1 - sum / med);
    } while (x1 < x2);
  }
  return list;
}

/** Tibia's fight modes. Player::getAttackFactor and getDefenseFactor, and the fight factor in
 *  PlayerWheel::calculateMitigation. Full attack defends at 0.5 only right after an attack, else 1.0. */
export type FightMode = "offensive" | "balanced" | "defensive";
export const FIGHT_MODES: Record<FightMode, { name: string; attack: number; defense: number; mitigation: number }> = {
  offensive: { name: "Offensive fighting", attack: 1.0, defense: 0.5, mitigation: 0.8 },
  balanced: { name: "Balanced fighting", attack: 0.75, defense: 0.75, mitigation: 1.0 },
  defensive: { name: "Defensive fighting", attack: 0.5, defense: 1.0, mitigation: 1.2 },
};

/** WeaponMelee::getWeaponDamage / Weapons::getMaxWeaponDamage. */
export function meleeDamage(level: number, skill: number, attack: number, v: VocationData, attackFactor = 1): number {
  const max = Math.round(0.085 * attackFactor * attack * skill + Math.floor(level / 5)) * v.meleeDamage;
  return normalRandom(Math.floor(level / 5), Math.floor(max));
}

/** WeaponDistance::getWeaponDamage. */
export function distanceDamage(level: number, skill: number, attack: number, v: VocationData, attackFactor = 1): number {
  const min = Math.floor(level / 5);
  const max = Math.round(0.09 * attackFactor * skill * attack + min);
  return normalRandom(min, Math.floor(max * v.distDamage));
}

/** Player::getDefense, with a shield (scaling 0.16) or just the weapon (0.146). */
export function playerDefense(defenseSkill: number, defenseValue: number, hasShield: boolean, v: VocationData, defenseFactor = 0.5): number {
  const scaling = hasShield ? 0.16 : 0.146;
  return Math.floor((defenseSkill / 4 + 2.23) * defenseValue * defenseFactor * scaling * v.defense);
}

/** Creature::blockHit: shield/weapon defense (melee only), then armor. Returns the damage left. */
export function blockHit(damage: number, defense: number, armor: number, useDefense: boolean, useArmor: boolean): number {
  if (useDefense && defense > 0) {
    damage -= uniform(Math.floor(defense / 2), defense);
    if (damage <= 0) return 0;
  }
  if (useArmor) {
    if (armor > 3) damage -= uniform(Math.floor(armor / 2), armor - ((armor % 2) + 1));
    else if (armor > 0) damage--;
  }
  return Math.max(0, damage);
}

/** PlayerWheel::calculateMitigation: percent of damage mitigated, from shielding, the shield's
 *  (or two-handed weapon's) defense, the vocation's mitigation factors and the fight mode. */
export function mitigation(v: VocationData, shieldSkill: number, shield?: ItemData, weapon?: ItemData, fightFactor = 0.8): number {
  let defenseValue = 0, shieldFactor = 1, distanceFactor = 1;
  if (shield) {
    if (shield.weapontype === "spellbook") distanceFactor = v.secondaryShield;
    else shieldFactor = v.primaryShield;
    defenseValue = shield.defense ?? 0;
  }
  if (weapon) {
    if (weapon.ammotype === "bolt" || weapon.ammotype === "arrow") distanceFactor = v.secondaryShield;
    else if (weapon.slottype === "two-handed") {
      defenseValue = (weapon.defense ?? 0) + (weapon.extradef ?? 0);
      shieldFactor = v.secondaryShield;
    } else {
      defenseValue += weapon.extradef ?? 0;
      shieldFactor = v.primaryShield;
    }
  }
  return Math.ceil((((shieldSkill * v.mitigation + shieldFactor * defenseValue) / 100) * fightFactor * distanceFactor) * 100) / 100;
}

/** Distance hit chance (WeaponDistance::useWeapon): items with a flat maxhitchance hit that often. */
export function distanceHitChance(maxHitChance: number | undefined): number {
  return maxHitChance ?? 75;
}
