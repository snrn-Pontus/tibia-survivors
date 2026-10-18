// Rookgaard balance: how long levels 1-8 take with different unlocks, and whether the character that leaves
// is any stronger on the mainland.   npm run sim:rook -- [runs per setup] [voc 0-3]
// For each setup: the level reached in Rookgaard and how long the run lasted there, time to level 8, skills at
// 8, then level, zone and survival 15 minutes later.
import { readFileSync } from "node:fs";
import { VOCATIONS, ZONES } from "../src/data";
import type { Game } from "../src/game";
import { loadSave, TRACKS, writeSave, type Save } from "../src/meta";
import { run } from "../src/sim";
import { applyUnlocks } from "../src/unlocks";
import { World } from "../src/world";

const atlas = JSON.parse(readFileSync("public/assets/tibia-atlas.json", "utf-8"));
const world = new World(atlas.decor);
const effectDur = (id: number) => {
  const e = atlas.effects[id];
  return e ? e.ms.reduce((a: number, b: number) => a + b, 0) / 1000 : 0;
};
const runs = Number(process.argv[2] ?? 5), voc = Number(process.argv[3] ?? 0);
const AFTER = 15 * 60;
const wildsLevel = ZONES[1].level; // mainland time measured after level 8
const CAP = 45 * 60; // give up on reaching 8 after this

// Unlock tiers per setup (track id -> tier index); the soul cost is summed from meta.ts.
const SETUPS: { name: string; unlocks: Record<string, number> }[] = [
  { name: "nothing", unlocks: {} },
  { name: "sword", unlocks: { weapon: 1 } },
  { name: "sword, rook 1", unlocks: { weapon: 1, rook_xp: 1, rook_train: 1, rook_regen: 1 } },
  { name: "sword, xp 2 only", unlocks: { weapon: 1, rook_xp: 2 } },
  { name: "gear 2, rook 1", unlocks: { weapon: 2, shield: 2, armor: 2, helmet: 2, legs: 2, rook_xp: 1, rook_train: 1, rook_regen: 1 } },
  { name: "sword, rook 2", unlocks: { weapon: 1, rook_xp: 2, rook_train: 2, rook_regen: 2 } },
  { name: "sword, rook 3", unlocks: { weapon: 1, rook_xp: 3, rook_train: 3, rook_regen: 3 } },
  { name: "sword, rook max", unlocks: { weapon: 1, rook_xp: 4, rook_train: 4, rook_regen: 3 } },
  { name: "rook max, x1 train", unlocks: { weapon: 1, rook_xp: 4, rook_regen: 3 } },
  { name: "sword, dawnport", unlocks: { weapon: 1, dawnport: 1 } },
];

const cost = (u: Record<string, number>) => Object.entries(u).reduce((sum, [id, t]) => {
  const tr = TRACKS.find((x) => x.id === id)!;
  return sum + tr.tiers.slice(1, t + 1).reduce((a, b) => a + b.cost, 0);
}, 0);
const mmss = (t: number) => `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, "0")}`;
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

console.log(`${VOCATIONS[voc].name}, ${runs} runs per setup; "after" is ${AFTER / 60} minutes past level 8\n`);
console.log("setup                souls  in Rookgaard: level  time  kills   reach 8  time to 8  skills at 8 (club,sword,shield)  after: level  zone  died");
for (const s of SETUPS) {
  const rookLvl: number[] = [], rookTime: number[] = [], rookKills: number[] = [];
  const t8s: number[] = [], lvls: number[] = [], zones: number[] = [], club: number[] = [], sword: number[] = [], shield: number[] = [];
  let reached = 0, died = 0;
  for (let k = 0; k < runs; k++) {
    const save: Save = { ...loadSave(), unlocks: { ...s.unlocks }, boosts: {}, blessings: 0, maxLevel: 8 };
    writeSave(save);
    const keep: { g?: Game } = {};
    let t8 = -1, stopAt = CAP;
    run(world, effectDur, voc, CAP + AFTER, keep, (g) => {
      applyUnlocks(g, save);
      // The bot heads out once it matches a zone's level; Rookgaard Wilds says 4, but its trolls can't be hurt
      // at that level, so it waits in the Fields until it has a vocation.
      ZONES[1].level = 99;
      const setVoc = g.ch.setVocation.bind(g.ch);
      g.ch.setVocation = (v) => {
        ZONES[1].level = wildsLevel;
        if (t8 < 0) {
          t8 = g.time;
          rookLvl.push(g.ch.level); rookTime.push(g.time); rookKills.push(g.kills);
          stopAt = g.time + AFTER;
          club.push(g.ch.skills[1].level); sword.push(g.ch.skills[2].level); shield.push(g.ch.skills[5].level);
        }
        setVoc(v);
      };
      // End the run AFTER seconds past level 8 (or at the cap without it).
      const update = g.update.bind(g);
      g.update = (dt, mx, my) => { if (g.time >= stopAt) g.over = true; else update(dt, mx, my); };
    });
    const g = keep.g!;
    if (t8 < 0) { rookLvl.push(g.ch.level); rookTime.push(g.time); rookKills.push(g.kills); }
    if (t8 >= 0) {
      reached++;
      t8s.push(t8);
      lvls.push(g.ch.level);
      zones.push(g.deepest);
    }
    if (g.ch.hp <= 0) died++;
  }
  const z = Math.round(avg(zones));
  console.log(`${s.name.padEnd(20)} ${String(cost(s.unlocks)).padStart(5)}  ${avg(rookLvl).toFixed(1).padStart(19)}  ${mmss(avg(rookTime)).padStart(5)}  ${avg(rookKills).toFixed(0).padStart(5)}  ${`${reached}/${runs}`.padStart(7)}   ${(t8s.length ? mmss(avg(t8s)) : "-").padStart(9)}`
    + `  ${club.length ? `${avg(club).toFixed(0)},${avg(sword).toFixed(0)},${avg(shield).toFixed(0)}` : "-"}`.padEnd(35)
    + `  ${lvls.length ? avg(lvls).toFixed(1) : "-"}`.padStart(12) + `  ${lvls.length ? ZONES[z].name : "-"}  ${died}/${runs}`);
}
