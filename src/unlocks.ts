// Turn the save's permanent unlocks into a fresh run's starting kit.
import type { Game } from "./game";
import { TRACKS, trackTier, type Save } from "./meta";
import type { BoostId } from "./upgrades";

export function applyUnlocks(g: Game, save: Save) {
  const ch = g.ch;
  for (const t of TRACKS) {
    const tier = trackTier(save, t);
    if (tier.item) ch.equip(tier.item);
    else if (t.id === "potions" && tier.count) ch.supplies.set(266, (ch.supplies.get(266) ?? 0) + tier.count);
    else if (t.id === "gold" && tier.count) ch.gold += tier.count;
    else if (t.id === "rerolls" && tier.count) g.rerolls = tier.count;
  }
  for (const [id, l] of Object.entries(save.boosts)) if (l) ch.boosts.set(id as BoostId, l);
  ch.blessings = save.blessings;
}
