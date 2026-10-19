// Game design on top of the real Tibia data: vocation kits, waves, server rates and shop prices.
import { KITS, MONSTERS, type VocationId } from "./tibia/db";

export interface VocationDef {
  id: VocationId;
  name: string;
  sprite: string;
  blurb: string;
  skills: number[]; // fist, club, sword, axe, distance, shielding
  magicLevel: number;
  equipment: (string | number)[]; // item ids, or starter item names (STARTER_ITEMS in tools/fetch_tibia_data.py)
  backpack?: [number, number][]; // [item id, count] that come in the backpack
  ammo?: string;
  supplies: Record<string, number>;
}

export const START_LEVEL = 1; // a rookie; the vocation is chosen at VOCATION_LEVEL
export const VOCATION_LEVEL = 8;
export const START_GOLD = 0; // a fresh Tibia character has no gold

/** Rookgaard: no vocation (Tibia's "None"), with the sword and wooden shield every rookie buys first. */
export const ROOKIE: VocationDef = {
  id: "none", name: "Rookie", sprite: "rookie", skills: [10, 10, 10, 10, 10, 10], magicLevel: 0,
  equipment: ["club", "coat"], // the classic Rookgaard start; better gear is unlocked with souls
  supplies: {},
  blurb: "No vocation yet: reach level 8 to choose one.",
};

/** Vocations, chosen at level 8: level, skills and everything you wear carry over. Of Canary's kits
 *  (send_first_items.lua) you only get the weapon, and only if you don't hold your vocation's kind of weapon
 *  already (Character.setVocation); the potions are this game's, for a run that's in the middle of a fight. */
const kit = (v: keyof typeof KITS) => ({ equipment: KITS[v].items, backpack: KITS[v].container });
export const VOCATIONS: VocationDef[] = [
  { id: "knight", name: "Knight", sprite: "knight", skills: [12, 15, 15, 15, 12, 15], magicLevel: 0, ...kit("knight"),
    supplies: { "health potion": 40, "mana potion": 10 },
    blurb: "Axes, swords and clubs, with a shield. Exori spells and Wound Cleansing." },
  { id: "paladin", name: "Paladin", sprite: "paladin", skills: [12, 12, 12, 12, 15, 12], magicLevel: 0, ...kit("paladin"),
    supplies: { "health potion": 25, "mana potion": 25, spear: 25 },
    blurb: "Spears and a shield, or a bow. Ethereal Spear, Divine Missile, Divine Caldera." },
  { id: "sorcerer", name: "Sorcerer", sprite: "sorcerer", skills: [12, 12, 12, 12, 12, 12], magicLevel: 0, ...kit("sorcerer"),
    supplies: { "health potion": 15, "mana potion": 40 },
    blurb: "Wands; fire, energy and death magic. Great Fireball and Sudden Death runes." },
  { id: "druid", name: "Druid", sprite: "druid", skills: [12, 12, 12, 12, 12, 12], magicLevel: 0, ...kit("druid"),
    supplies: { "health potion": 15, "mana potion": 40 },
    blurb: "Rods; ice and earth magic, strong healing. Avalanche and Stone Shower runes." },
];

/** Real Tibia's rates: x1. Boosts picked on level-up multiply them (see upgrades.ts). */
export const expRate = (_level: number) => 1;
export const SKILL_RATE = 1;
export const MAGIC_RATE = 1;

/** The world: zones by distance from where you start, like Tibia's hunting grounds. The world doesn't
 *  follow your level; you choose how far out to push. Each zone's bosses show up, one at a time, after you've
 *  killed enough there (`bossAt` kills for the first, then every `bossAt` more). */
export interface Zone {
  name: string; level: number; from: number; pool: string[]; bosses: string[]; maxAlive: number; spawnEvery?: number;
  weights?: number[]; // how often each of `pool` spawns, relative (default: all the same)
}
export const ZONE_WIDTH = 30; // tiles per ring
export const BOSS_KILLS = 20;
export const ZONES: Zone[] = [
  // Mainland zones also have the creatures of Tibia's hunting grounds at their experience, for the armor they drop.
  // Mostly plain rats, like the fields outside Rookgaard's village; the odd cave rat, bat, snake or spider.
  { name: "Rookgaard Fields", level: 1, pool: ["rat", "cave rat", "bat", "snake", "spider"], weights: [16, 2, 1, 1, 1], bosses: ["munster"], maxAlive: 3, spawnEvery: 3 },
  { name: "Rookgaard Wilds", level: 6, pool: ["cave rat", "wolf", "bug", "troll", "rotworm"], bosses: ["teleskor", "apprentice sheng"], maxAlive: 4, spawnEvery: 2.2 },
  { name: "Troll Woods", level: 10, pool: ["troll", "orc", "rotworm", "poison spider", "orc spearman", "goblin", "swamp troll", "elf", "dwarf", "smuggler"], bosses: ["rotworm queen", "the snapper"], maxAlive: 6 },
  { name: "Orc Fortress", level: 15, pool: ["orc", "orc spearman", "orc warrior", "skeleton", "amazon", "minotaur", "wild warrior", "bandit", "barbarian headsplitter", "gladiator"], bosses: ["the horned fox"], maxAlive: 7 },
  { name: "Minotaur Hills", level: 22, pool: ["orc warrior", "orc shaman", "minotaur", "ghoul", "dwarf soldier", "scorpion", "valkyrie", "assassin", "orc rider", "lizard sentinel", "dwarf guard", "barbarian bloodwalker", "orc leader"], bosses: ["dharalion", "general murius"], maxAlive: 8 },
  { name: "Cyclopolis", level: 30, pool: ["valkyrie", "hunter", "slime", "cyclops", "orc berserker", "mummy", "bonelord", "gargoyle", "lizard templar", "pirate cutthroat", "crypt shambler", "pirate buccaneer"], bosses: ["necropharus"], maxAlive: 8 },
  { name: "Ancient Tombs", level: 40, pool: ["cyclops", "mummy", "bonelord", "demon skeleton", "vampire", "necromancer", "dragon", "ice golem", "pirate corsair", "quara constrictor", "nightstalker", "ancient scarab"], bosses: ["the evil eye"], maxAlive: 9 },
  { name: "Vampire Crypts", level: 55, pool: ["dragon", "vampire", "necromancer", "giant spider", "banshee", "bog raider", "crystal spider", "quara hydromancer", "lizard legionnaire", "nightmare scion"], bosses: ["warlord ruzad", "zevelon duskbringer"], maxAlive: 9 },
  { name: "Dragon Lairs", level: 70, pool: ["dragon", "giant spider", "banshee", "lich", "hero", "lizard high guard", "quara pincher", "wyrm", "black knight", "frost dragon"], bosses: ["the old widow"], maxAlive: 10 },
  { name: "Hero Cave", level: 90, pool: ["hero", "lich", "dragon lord", "behemoth", "lizard zaogun", "nightmare", "sea serpent", "draken warmaster", "destroyer", "elder wyrm"], bosses: ["the many"], maxAlive: 10 },
  { name: "Dragon Lord Peaks", level: 110, pool: ["dragon lord", "behemoth", "hydra", "lizard chosen", "hellspawn", "serpent spawn", "draken spellweaver", "warlock"], bosses: ["demodras"], maxAlive: 10 },
  { name: "Hydra Swamps", level: 130, pool: ["dragon lord", "hydra", "behemoth", "demon", "medusa", "draken abomination", "ghastly dragon", "draken elite", "hand of cursed fate"], bosses: ["the plasmother", "dracola"], maxAlive: 11 },
  { name: "Pits of Inferno", level: 200, pool: ["demon", "behemoth", "hydra", "juggernaut", "fury", "plaguesmith", "hellfire fighter", "dark torturer", "hellhound", "grim reaper", "blightwalker", "undead dragon"], bosses: ["orshabaal", "ghazbaran", "morgaroth", "ferumbras", "gaz'haragoth"], maxAlive: 12 },
].map((z, i) => ({ ...z, from: i * ZONE_WIDTH }));

/** Which zone a tile is in: rings around the start. */
export function zoneAt(tx: number, ty: number): number {
  return Math.min(ZONES.length - 1, Math.floor(Math.hypot(tx, ty) / ZONE_WIDTH));
}

export const spawnEvery = 1.4; // seconds between spawns while below the zone's maxAlive (unless the zone says otherwise)
/** Souls also come from exploring and surviving, so even a run without kills moves you forward. */
// x (zone number + 1), once per account: the first time you kill a creature in a zone (Troll Woods: 30). Paying
// for reaching a zone each run made sprinting outward at level 1 the best way to earn souls.
export const SOULS_PER_ZONE = 10;
export const SOUL_EVERY = 30; // seconds alive per soul
/** Souls (the meta currency) for a kill: a tenth of the experience, a fifth for bosses. At least 1. */
export const soulsFor = (exp: number, boss: boolean) => Math.max(1, Math.round(exp / (boss ? 5 : 10)));
/** A creature's mitigation (percent). Canary leaves bosses' as ???, so a boss takes the highest of its
 *  zone's creatures, times 1.5. */
export function mitigationOf(key: string): number {
  const m = MONSTERS[key];
  if (!m) return 0;
  if (m.mitigation) return m.mitigation;
  const zone = ZONES.find((z) => z.bosses.includes(key));
  return zone ? 1.5 * Math.max(0, ...zone.pool.map((k) => MONSTERS[k]?.mitigation ?? 0)) : 0;
}

/** Achievements: kill a creature this many times over all your runs. Each milestone pays souls, from a
 *  tenth of its experience times 1, 5 and 25 (at least 5, 10 and 15); bosses count 1, 5 and 25 kills and pay
 *  twice that. */
export const KILL_MILESTONES = [10, 100, 1000];
export const BOSS_MILESTONES = [1, 5, 25];
const MILESTONE_TITLES = ["Hunter", "Slayer", "Bane"];
export function achievement(key: string, total: number): { title: string; count: number; souls: number } | null {
  const m = MONSTERS[key];
  if (!m) return null;
  const boss = ZONES.some((z) => z.bosses.includes(key));
  const tier = (boss ? BOSS_MILESTONES : KILL_MILESTONES).indexOf(total);
  if (tier < 0) return null;
  const souls = Math.max(5 * (tier + 1), Math.round((m.experience / 10) * [1, 5, 25][tier] * (boss ? 2 : 1)));
  return { title: `${m.name} ${MILESTONE_TITLES[tier]}`, count: total, souls };
}

/** Bestiary kill counts that unlock a stage (and a level-up style choice). */
export const BESTIARY_STAGES = [5, 25, 100];

/** Supplies sold in the shop (prices come from Canary's NPC shops), and how many per purchase. */
export const SHOP: { name: string; count: number }[] = [
  { name: "health potion", count: 10 }, { name: "mana potion", count: 10 },
  { name: "strong health potion", count: 10 }, { name: "strong mana potion", count: 10 },
  { name: "great health potion", count: 10 }, { name: "great mana potion", count: 10 },
  { name: "great spirit potion", count: 10 }, { name: "ultimate health potion", count: 10 },
  { name: "arrow", count: 100 },
  { name: "light magic missile rune", count: 20 }, { name: "heavy magic missile rune", count: 20 },
  { name: "stalagmite rune", count: 20 }, { name: "holy missile rune", count: 20 },
  { name: "fireball rune", count: 20 }, { name: "icicle rune", count: 20 }, { name: "explosion rune", count: 20 },
  { name: "stone shower rune", count: 20 }, { name: "thunderstorm rune", count: 20 },
  { name: "great fireball rune", count: 20 }, { name: "avalanche rune", count: 20 },
  { name: "sudden death rune", count: 20 }, { name: "intense healing rune", count: 10 },
  { name: "ultimate healing rune", count: 10 },
];
