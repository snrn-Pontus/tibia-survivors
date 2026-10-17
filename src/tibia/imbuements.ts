// Tibia's imbuements, offered as level-up rewards. Values are the real Basic / Intricate / Powerful tiers.
import type { Element, VocationId } from "./db";

export type ImbuementKind = "lifeLeech" | "manaLeech" | "crit" | "convert" | "skill" | "magic" | "speed" | "protect";

export interface ImbuementDef {
  id: string;
  name: string;
  kind: ImbuementKind;
  values: [number, number, number];
  element?: Element; // convert / protect
  skill?: number; // skill boosts: index into Character.skills
  effect: number; // magic effect used as its icon
  desc: (v: number) => string;
  /** Which vocations can have it (Tibia restricts imbuements by the item they go on). */
  for: (voc: VocationId, weaponSkill: number) => boolean;
}

const all = () => true;
const weaponUsers = (v: VocationId) => v === "knight" || v === "paladin";
const mages = (v: VocationId) => v === "sorcerer" || v === "druid";

export const TIERS = ["Basic", "Intricate", "Powerful"];

export const IMBUEMENTS: ImbuementDef[] = [
  { id: "vampirism", name: "Vampirism", kind: "lifeLeech", values: [5, 10, 25], effect: 14, for: all,
    desc: (v) => `${v}% life leech: heal for part of the damage you deal.` },
  { id: "void", name: "Void", kind: "manaLeech", values: [3, 5, 8], effect: 13, for: all,
    desc: (v) => `${v}% mana leech: regain mana from the damage you deal.` },
  { id: "strike", name: "Strike", kind: "crit", values: [5, 15, 40], effect: 4, for: all,
    desc: (v) => `10% chance of a critical hit dealing ${v}% extra damage.` },
  { id: "scorch", name: "Scorch", kind: "convert", element: "fire", values: [10, 25, 50], effect: 16, for: weaponUsers,
    desc: (v) => `${v}% of your weapon damage becomes fire damage.` },
  { id: "frost", name: "Frost", kind: "convert", element: "ice", values: [10, 25, 50], effect: 44, for: weaponUsers,
    desc: (v) => `${v}% of your weapon damage becomes ice damage.` },
  { id: "electrify", name: "Electrify", kind: "convert", element: "energy", values: [10, 25, 50], effect: 12, for: weaponUsers,
    desc: (v) => `${v}% of your weapon damage becomes energy damage.` },
  { id: "venom", name: "Venom", kind: "convert", element: "earth", values: [10, 25, 50], effect: 17, for: weaponUsers,
    desc: (v) => `${v}% of your weapon damage becomes earth damage.` },
  { id: "reap", name: "Reap", kind: "convert", element: "death", values: [10, 25, 50], effect: 18, for: weaponUsers,
    desc: (v) => `${v}% of your weapon damage becomes death damage.` },
  { id: "bash", name: "Bash", kind: "skill", skill: 1, values: [1, 2, 4], effect: 10, for: (v, s) => v === "knight" && s === 1,
    desc: (v) => `Club fighting +${v}.` },
  { id: "slash", name: "Slash", kind: "skill", skill: 2, values: [1, 2, 4], effect: 10, for: (v, s) => v === "knight" && s === 2,
    desc: (v) => `Sword fighting +${v}.` },
  { id: "chop", name: "Chop", kind: "skill", skill: 3, values: [1, 2, 4], effect: 10, for: (v, s) => v === "knight" && s === 3,
    desc: (v) => `Axe fighting +${v}.` },
  { id: "precision", name: "Precision", kind: "skill", skill: 4, values: [1, 2, 4], effect: 10, for: (v) => v === "paladin",
    desc: (v) => `Distance fighting +${v}.` },
  { id: "blockade", name: "Blockade", kind: "skill", skill: 5, values: [1, 2, 4], effect: 4, for: (v) => v === "knight",
    desc: (v) => `Shielding +${v}.` },
  { id: "epiphany", name: "Epiphany", kind: "magic", values: [1, 2, 4], effect: 13, for: mages,
    desc: (v) => `Magic level +${v}.` },
  { id: "swiftness", name: "Swiftness", kind: "speed", values: [10, 15, 30], effect: 15, for: all,
    desc: (v) => `Speed +${v}.` },
  { id: "dragonhide", name: "Dragon Hide", kind: "protect", element: "fire", values: [3, 8, 15], effect: 16, for: all,
    desc: (v) => `${v}% fire protection.` },
  { id: "snakeskin", name: "Snake Skin", kind: "protect", element: "earth", values: [3, 8, 15], effect: 17, for: all,
    desc: (v) => `${v}% earth protection.` },
  { id: "quarascale", name: "Quara Scale", kind: "protect", element: "ice", values: [3, 8, 15], effect: 44, for: all,
    desc: (v) => `${v}% ice protection.` },
  { id: "cloudfabric", name: "Cloud Fabric", kind: "protect", element: "energy", values: [3, 8, 15], effect: 12, for: all,
    desc: (v) => `${v}% energy protection.` },
  { id: "demonpresence", name: "Demon Presence", kind: "protect", element: "holy", values: [3, 8, 15], effect: 49, for: all,
    desc: (v) => `${v}% holy protection.` },
  { id: "lichshroud", name: "Lich Shroud", kind: "protect", element: "death", values: [3, 8, 15], effect: 18, for: all,
    desc: (v) => `${v}% death protection.` },
];

export const imbuement = (id: string) => IMBUEMENTS.find((i) => i.id === id)!;
