// Turn the save's permanent unlocks into a fresh run's starting kit.
import type { Game } from "./game";
import { TRACKS, trackTier, type Save } from "./meta";
import type { BoostId } from "./upgrades";

export function applyUnlocks(g: Game, save: Save) {
  const ch = g.ch;
  for (const t of TRACKS) {
    const tier = trackTier(save, t);
    if (t.id === "spears" && tier.item) {
      // Spears in hand (the bought weapon goes in the backpack: click it to switch).
      if (ch.equipment.weapon) ch.stash(ch.equipment.weapon);
      ch.equip(tier.item);
      ch.supplies.set(tier.item, tier.count ?? 0);
    } else if (tier.item) ch.equip(tier.item);
    else if (t.id === "potions" && tier.count) ch.supplies.set(266, (ch.supplies.get(266) ?? 0) + tier.count);
    else if (t.id === "gold" && tier.count) ch.gold += tier.count;
    else if (t.id === "rerolls" && tier.count) g.rerolls = tier.count;
    else if (t.id === "rook_xp") ch.rookXp = tier.count ?? 1;
    else if (t.id === "rook_train") ch.rookTrain = tier.count ?? 1;
    else if (t.id === "rook_regen") ch.rookRegen = tier.count ?? 1;
    else if (t.id === "dawnport" && tier.cost) g.dawnport();
  }
  for (const [id, l] of Object.entries(save.boosts)) if (l) ch.boosts.set(id as BoostId, l);
  ch.blessings = save.blessings;
  g.discovered = new Set(save.zones ?? []);
  g.killTotals = { ...(save.kills ?? {}) };
}
