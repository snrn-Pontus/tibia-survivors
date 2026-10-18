// Support spells: hastes, stances (Blood Rage, Protector, Sharpshooter), Recovery and the cures, with Canary's values.
import type { Element } from "./tibia/db";

/** A support spell's stance: skill percents, damage dealt and received percents, no shield defense. */
export interface Stance { name: string; melee?: number; dist?: number; shield?: number; dealt?: number; received?: number; noDefense?: boolean }

/** Support spells, with Canary's values (data/scripts/spells/support and healing). Hastes are ConditionSpeed
 *  formulas (new speed = a * (base - 40) + b); stances are CONDITION_ATTRIBUTES percents. */
export type Support =
  | { kind: "haste"; seconds: number; a: number; b: number }
  | { kind: "stance"; seconds: number; stance: Omit<Stance, "name">; slow?: [number, number]; healLock?: boolean }
  | { kind: "regen"; seconds: number; hp: number; every: number }
  | { kind: "cure"; element: Element | "paralyze" };
export const SUPPORT: Record<string, Support> = {
  haste: { kind: "haste", seconds: 30, a: 1.3, b: 40 }, // utani hur
  strong_haste: { kind: "haste", seconds: 22, a: 1.7, b: 40 }, // utani gran hur
  charge: { kind: "haste", seconds: 5, a: 1.9, b: 40 }, // utani tempo hur
  blood_rage: { kind: "stance", seconds: 10, stance: { melee: 135, received: 115, noDefense: true } }, // utito tempo
  protector: { kind: "stance", seconds: 13, stance: { shield: 220, dealt: 65, received: 85 } }, // utamo tempo
  // utito tempo san: distance 140%, no defense, slowed to 0.7 (base - 40) + 56, and no healing spells for 10 s.
  sharpshooter: { kind: "stance", seconds: 10, stance: { dist: 140, noDefense: true }, slow: [0.7, 56], healLock: true },
  recovery: { kind: "regen", seconds: 60, hp: 20, every: 3 }, // utura
  intense_recovery: { kind: "regen", seconds: 60, hp: 40, every: 3 }, // utura gran
  cure_poison: { kind: "cure", element: "earth" }, // exana pox
  cure_burning: { kind: "cure", element: "fire" }, // exana flam
  cure_electrification: { kind: "cure", element: "energy" }, // exana vis
  cure_bleeding: { kind: "cure", element: "physical" }, // exana kor
};
