// Headless balance runs, as a campaign: run after run with one soul bank, buying unlocks in between.
//   npm run sim -- [voc 0-3 chosen at level 8] [runs]      (0 knight, 1 paladin, 2 sorcerer, 3 druid)
import { readFileSync } from "node:fs";
import { VOCATIONS, ZONES } from "../src/data";
import type { Game } from "../src/game";
import { BLESSING_COST, boostCost, buyBlessing, buyBoost, buyTier, loadSave, tier, TRACKS, writeSave } from "../src/meta";
import { run } from "../src/sim";
import { applyUnlocks } from "../src/unlocks";
import { MAX_BOOST, type BoostId } from "../src/upgrades";
import { World } from "../src/world";

const atlas = JSON.parse(readFileSync("public/assets/tibia-atlas.json", "utf-8"));
const world = new World(atlas.terrain);
const effectDur = (id: number) => {
  const e = atlas.effects[id];
  return e ? e.ms.reduce((a: number, b: number) => a + b, 0) / 1000 : 0;
};
const voc = Number(process.argv[2] ?? 0), runs = Number(process.argv[3] ?? 10);
const v = VOCATIONS[voc];
const train: BoostId = v.id === "knight" ? "train_axe" : v.id === "paladin" ? "train_distance" : "train_magic"; // the knight's kit is an axe
const wants: BoostId[] = ["xp", "gold", train, "loot", "haste", "train_shielding", "train_club"];

for (let k = 1; k <= runs; k++) {
  const save = loadSave();
  // Shopping: the cheapest available gear tier or boost level, until broke.
  for (;;) {
    const gear = TRACKS.map((t) => ({ t, next: t.tiers[tier(save, t.id) + 1] })).filter((x) => x.next && x.next.cost <= save.souls && !x.t.locked?.(save))
      .map((x) => ({ cost: x.next!.cost, buy: () => buyTier(save, x.t) }));
    const boosts = wants.filter((id) => (save.boosts[id] ?? 0) < MAX_BOOST).map((id) => ({ cost: boostCost(id, save.boosts[id] ?? 0), buy: () => buyBoost(save, id) }))
      .filter((o) => o.cost <= save.souls);
    // Rookgaard unlocks and starting gear first (they're what gets a new account out of Rookgaard), then boosts.
    const opts = gear.length ? gear.sort((a, b) => a.cost - b.cost) : boosts.sort((a, b) => a.cost - b.cost);
    if (!opts.length) break;
    opts[0].buy();
  }
  if (save.souls >= BLESSING_COST * 3) buyBlessing(save);
  const keep: { g?: Game } = {};
  run(world, effectDur, voc, 3600, keep, (g) => applyUnlocks(g, save));
  const g = keep.g!;
  const after = loadSave();
  after.blessings = 0;
  after.runs++;
  after.souls += g.souls;
  after.maxLevel = Math.max(after.maxLevel ?? 0, g.ch.level);
  after.zones = [...g.discovered];
  after.kills = { ...g.killTotals };
  writeSave(after);
  const t = Math.round(g.time);
  console.log(`run ${String(k).padStart(2)} ${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")} L${g.ch.level} ${g.ch.voc.name} ml${g.ch.ml} `
    + `sk${g.ch.skills.map((s) => s.level).join(",")} kills${g.kills} zone:${ZONES[g.deepest].name} +${g.souls} souls (bank ${after.souls}) `
    + `unlocks[${TRACKS.map((t) => tier(save, t.id)).join("")}] boosts[${Object.entries(save.boosts).map(([i, l]) => i + l).join(" ")}]`);
}
