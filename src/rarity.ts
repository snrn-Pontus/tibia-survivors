// Card rarity: every level-up card (and charm, and chest pick) rolls one. A rarer card is the same pick, more of
// it: two or three tiers of an imbuement, grade or charm at once, more run bonus, skill levels, gold and potions,
// more prey stars. Luck makes the rarer ones likelier, and sometimes adds a fourth card.

export type Rarity = 0 | 1 | 2 | 3;
export interface RarityDef { name: string; mult: number; weight: number }
export const RARITIES: RarityDef[] = [
  { name: "Common", mult: 1, weight: 70 },
  { name: "Rare", mult: 2, weight: 22 },
  { name: "Epic", mult: 3, weight: 7 },
  { name: "Legendary", mult: 5, weight: 1 },
];
export const rarityMult = (r?: Rarity) => RARITIES[r ?? 0].mult;

/** Luck scales the rarer weights: at 50 luck rare cards are twice as likely, epic three times, legendary five. */
const LUCK_SCALE = [Infinity, 50, 25, 12.5];
const weights = (luck: number) => RARITIES.map((r, i) => r.weight * (1 + Math.max(0, luck) / LUCK_SCALE[i]));

/** The chance of each rarity at a luck, in percent. */
export function rarityOdds(luck: number): number[] {
  const w = weights(luck), sum = w.reduce((a, b) => a + b, 0);
  return w.map((x) => (100 * x) / sum);
}

export function rollRarity(luck: number): Rarity {
  const w = weights(luck);
  let r = Math.random() * w.reduce((a, b) => a + b, 0);
  for (let i = w.length - 1; i > 0; i--) if ((r -= w[i]) < 0) return i as Rarity;
  return 0;
}

/** The rarest rarity up to `r` whose multiplier fits in `room` (tiers or picks left), so a Legendary card
 *  never stands for one tier. */
export function fitRarity(r: Rarity, room: number): Rarity {
  while (r > 0 && RARITIES[r].mult > room) r--;
  return r;
}

/** Prey stars by rarity: about Tibia's 1-10 on average without luck, all ten on a Legendary. */
export const PREY_STARS: [number, number][] = [[1, 7], [6, 8], [8, 9], [10, 10]];

/** A fourth card: luck / 2 percent of level-ups, at most half. */
export const extraCardChance = (luck: number) => Math.min(0.5, Math.max(0, luck) / 200);

/** Luck from a common Luck card (rarer ones give more), and the most a run's cards can add. */
export const LUCK_STEP = 5;
export const RUN_LUCK_MAX = 50;
