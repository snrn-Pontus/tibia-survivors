// Level-up picks taken from Tibia's own systems:
// - spell grades from the Wheel of Destiny (Canary's io_wheel.cpp grades and wheel_gems.cpp supreme mods),
// - bestiary charms (Canary's bestiary_charms.lua), offered when a bestiary stage unlocks,
// - prey (Canary's ioprey.cpp): a creature, a bonus and 1-10 stars.
import { SUPPORT } from "./support";
import { CHARMS, MONSTERS, SPELL_GRADES, type SpellData } from "./tibia/db";

// ---------- spell grades ----------

export type GradeKey = "damage" | "heal" | "cooldown" | "manaCost" | "lifeLeech" | "manaLeech" | "critChance" | "critDamage";
export type GradeBonus = Partial<Record<GradeKey, number>>;

const add = (a: GradeBonus, b: GradeBonus, k = 1): GradeBonus => {
  const out = { ...a };
  for (const [key, v] of Object.entries(b) as [GradeKey, number][]) out[key] = (out[key] ?? 0) + v * k;
  return out;
};

/** A spell's grades, each the total bonus at that grade (1-3), and whether they're the Wheel's. Wheel grades
 *  come first; the supreme gem mod fills the rest at its gem grade multipliers (1.1, 1.2, 1.5). A spell
 *  the Wheel doesn't touch (the basic strikes and heals) gets +5/10/15% damage or healing, not from Tibia. */
export function spellGrades(s: SpellData): { grades: GradeBonus[]; wheel: boolean } {
  const data = SPELL_GRADES[s.name];
  // Values the Wheel gives as flat amounts (380 damage, 125 healing) aren't percentages: left out.
  const wheel = (data?.wheel ?? []).map((g) => Object.fromEntries(Object.entries(g).filter(([k, v]) => !((k === "damage" || k === "heal") && v > 100))) as GradeBonus)
    .filter((g) => Object.keys(g).length);
  const gem = data?.gem;
  if (!wheel.length && !gem) {
    if (SUPPORT[s.file]) return { grades: [], wheel: false }; // a haste or a cure has nothing to grade
    const key: GradeKey = s.group === "healing" ? "heal" : "damage";
    return { grades: [5, 10, 15].map((v) => ({ [key]: v })), wheel: false };
  }
  const grades: GradeBonus[] = [];
  let sum: GradeBonus = {};
  for (const g of wheel.slice(0, 3)) grades.push((sum = add(sum, g)));
  // The gem fills the grades left, at the highest multipliers: after two Wheel grades only x1.5 is left.
  if (gem) for (const m of [1.1, 1.2, 1.5].slice(grades.length)) grades.push(add(sum, gem, m));
  return { grades, wheel: true };
}

const GRADE_TEXT: Record<GradeKey, (v: number) => string> = {
  damage: (v) => `+${round(v)}% damage`, heal: (v) => `+${round(v)}% healing`, cooldown: (v) => `-${round(v)} s cooldown`,
  manaCost: (v) => `-${round(v)} mana`, lifeLeech: (v) => `${round(v)}% life leech`, manaLeech: (v) => `${round(v)}% mana leech`,
  critChance: (v) => `+${round(v)}% critical chance`, critDamage: (v) => `+${round(v)}% critical damage`,
};
const round = (v: number) => Math.round(v * 10) / 10;
export const describeGrade = (g: GradeBonus) => (Object.entries(g) as [GradeKey, number][]).map(([k, v]) => GRADE_TEXT[k](v)).join(", ");

// ---------- charms ----------

/** The charms that do something here (Bless, Scavenge and Gut need death penalties and skinning). */
const PLAYABLE = new Set(["Wound", "Enflame", "Poison", "Freeze", "Zap", "Curse", "Divine Wrath", "Cripple", "Parry", "Dodge",
  "Adrenaline Burst", "Numb", "Cleanse", "Low Blow", "Savage Blow", "Vampiric Embrace", "Void's Call", "Fatal Hold",
  "Void Inversion", "Carnage", "Overpower", "Overflux"]);
export const CHARM_LIST = CHARMS.filter((c) => PLAYABLE.has(c.name));
export const charm = (name: string) => CHARM_LIST.find((c) => c.name === name)!;
export const CHARM_TIERS = ["", "I", "II", "III"];

/** What a charm does at a tier, in a line. */
export function describeCharm(name: string, tier: number): string {
  const c = charm(name), v = c.chance[tier - 1];
  switch (name) {
    case "Low Blow": return `+${v}% critical hit chance`;
    case "Savage Blow": return `+${v}% critical damage`;
    case "Vampiric Embrace": return `${v}% life leech`;
    case "Void's Call": return `${v}% mana leech`;
    case "Fatal Hold": return `${v}% chance a hit keeps it from fleeing for 30 s`;
    case "Carnage": return `${v}% chance a kill hits the creatures around it for 15% of its health`;
    case "Overpower": return `${v}% chance to hit for 5% of your health`;
    case "Overflux": return `${v}% chance to hit for 2.5% of your mana`;
    case "Cripple": return `${v}% chance a hit roots it for 10 s`;
    case "Numb": return `${v}% chance its attack roots it for 10 s`;
    case "Parry": return `${v}% chance to reflect a hit`;
    case "Dodge": return `${v}% chance to dodge a hit`;
    case "Adrenaline Burst": return `${v}% chance to run much faster for 10 s when hit`;
    case "Cleanse": return `${v}% chance a hit cleanses a condition`;
    case "Void Inversion": return `${v}% chance mana drain gives you mana`;
    default: return `${v}% chance to deal 5% of its health as ${c.element}`;
  }
}

// ---------- prey ----------

export type PreyBonus = "damage" | "defense" | "xp" | "loot";
export interface Prey { creature: string; bonus: PreyBonus; stars: number }
export const PREY_SLOTS = 3;
/** Canary's ioprey: damage 2s+5%, defense 2s+10%, experience and loot 3s+10%, for s stars (1-10). */
export const preyPercent = (p: { bonus: PreyBonus; stars: number }) => (p.bonus === "damage" ? 2 * p.stars + 5 : p.bonus === "defense" ? 2 * p.stars + 10 : 3 * p.stars + 10);
const PREY_TEXT: Record<PreyBonus, string> = { damage: "damage to", defense: "less damage from", xp: "experience from", loot: "loot from" };
export const describePrey = (p: Prey) => `+${preyPercent(p)}% ${PREY_TEXT[p.bonus]} ${MONSTERS[p.creature]?.name ?? p.creature}s`;
