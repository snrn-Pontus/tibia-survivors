// Dev-only balance testing: play whole runs without rendering. From the browser console:
//   sim.run(0, 1200)  -> knight; returns one row per simulated minute
// The bot stands and lets auto-combat fight (chase mode on), backs off below 30% HP,
// learns the highest spell offered, and trades once a minute like a player in the pause menu.
import { autoCombat } from "./autocast";
import { ROOKIE, VOCATIONS, zoneAt, ZONES } from "./data";
import { cheb, Game } from "./game";
import { itemId, PRICES } from "./tibia/db";
import type { World } from "./world";

export function trade(g: Game) {
  const ch = g.ch;
  ch.gold += ch.lootValue();
  ch.backpack.clear();
  for (let k = 0; k < 4; k++) {
    const up = ch.shopUpgrades().filter((e) => e.price <= ch.gold - 800).reverse();
    if (!up.length) break;
    const e = up[0];
    ch.gold -= e.price;
    const old = ch.equipment[e.slot];
    if (old) ch.stash(old);
    ch.equip(e.id);
  }
  // Thrown weapons: keep a stack of 20.
  const thrown = ch.thrown;
  if (thrown) {
    const price = PRICES[thrown]?.buy ?? 0;
    while ((ch.supplies.get(thrown) ?? 0) < 20 && price && ch.gold >= price * 10) {
      ch.gold -= price * 10;
      ch.supplies.set(thrown, (ch.supplies.get(thrown) ?? 0) + 10);
    }
  }
  const strong = ch.level >= 50;
  const plan: [string, number][] = ch.voc.id === "knight"
    ? [[ch.level >= 80 ? "great health potion" : strong ? "strong health potion" : "health potion", 40], ["mana potion", 15]]
    : ch.voc.id === "paladin"
      ? [[strong ? "strong health potion" : "health potion", 25], [strong ? "strong mana potion" : "mana potion", 30], ["arrow", 300]]
      : [["health potion", 15], [ch.level >= 80 ? "great mana potion" : strong ? "strong mana potion" : "mana potion", 50],
        [ch.voc.id === "sorcerer" ? "great fireball rune" : "avalanche rune", 40]];
  for (const [name, want] of plan) {
    const id = itemId(name), price = PRICES[id]?.buy ?? 0;
    const pack = name === "arrow" ? 100 : 10;
    while ((ch.supplies.get(id) ?? 0) < want && price && ch.gold >= price * pack) {
      ch.gold -= price * pack;
      ch.supplies.set(id, (ch.supplies.get(id) ?? 0) + pack);
    }
  }
}

export function run(world: World, effectDur: (id: number) => number, voc: number, seconds = 1200, keep?: { g?: Game }, setup?: (g: Game) => void) {
  const g = new Game(ROOKIE, world, effectDur);
  if (keep) keep.g = g;
  setup?.(g);
  g.viewW = 704;
  g.viewH = 448;
  const rows: Record<string, unknown>[] = [];
  const dt = 0.05;
  let lastTrade = 0, nextRow = 60;
  while (!g.over && g.time < seconds) {
    let mx = 0, my = 0;
    const p = g.player;
    const near = g.monsters.filter((m) => !m.dead).sort((a, b) => cheb(a.tx, a.ty, p.tx, p.ty) - cheb(b.tx, b.ty, p.tx, p.ty))[0];
    const ranged = g.ch.attackRange > 1;
    const dist = near ? cheb(near.tx, near.ty, p.tx, p.ty) : 99;
    // Back off when hurt; ranged vocations also kite anything that gets within two tiles. Out of its depth
    // (a zone above its level) it backs off toward the start, not further out.
    if (near && (g.ch.hp / g.ch.maxHp < 0.3 || (ranged && dist <= 1))) {
      mx = Math.sign(p.tx - near.tx) || 1;
      my = Math.sign(p.ty - near.ty);
      const z = zoneAt(p.tx, p.ty);
      if (z > 0 && ZONES[z].level > g.ch.level) { mx = -Math.sign(p.tx); my = -Math.sign(p.ty); }
    }
    else if (dist > 3) {
      // Nothing close: go loot the nearest unlooted corpse.
      const c = [...g.chests, ...g.corpses.filter((c) => !c.looted && c.loot.length)].filter((c) => cheb(c.tx, c.ty, p.tx, p.ty) <= 7)
        .sort((a, b) => cheb(a.tx, a.ty, p.tx, p.ty) - cheb(b.tx, b.ty, p.tx, p.ty))[0];
      if (c) { mx = Math.sign(c.tx - p.tx); my = Math.sign(c.ty - p.ty); }
      else {
        // Strong enough for the next zone? Walk outward; too weak for this one? Walk back in.
        const z = zoneAt(p.tx, p.ty), next = ZONES[z + 1];
        const out = next && g.ch.level >= next.level ? 1 : z > 0 && g.ch.level < ZONES[z].level - 5 ? -1 : 0;
        if (out) {
          const d = Math.hypot(p.tx, p.ty) || 1;
          mx = out * (p.tx / d || 1);
          my = out * (p.ty / d);
        }
      }
    }
    g.update(dt, mx, my);
    autoCombat(g);
    if (g.events.some((e) => e.type === "vocation")) {
      g.ch.setVocation(VOCATIONS[voc]);
      g.vocation = VOCATIONS[voc];
    }
    // Bestiary stages: the bot takes the first charm offered.
    for (const e of g.events) if (e.type === "charm") { const c = g.ch.charmChoices()[0]; if (c) g.ch.applyChoice(c); }
    g.events.length = 0;
    // A simple build: spells first, then XP, the main training, loot and gold boosts, then whatever.
    for (; g.pendingChoices > 0; g.pendingChoices--) {
      const cs = g.ch.rollChoices();
      const rank = (c: (typeof cs)[number]) => c.kind === "spell" ? 0 : c.kind === "boost"
        ? ({ xp: 1, train_magic: 2, train_distance: 2, train_sword: 2, loot: 3, gold: 3, haste: 4 } as Record<string, number>)[c.id] ?? 5 : 6;
      const c = cs.sort((a, b) => rank(a) - rank(b))[0];
      if (c) g.ch.applyChoice(c);
    }
    if (g.time - lastTrade > 60) { lastTrade = g.time; trade(g); }
    if (g.time >= nextRow || g.over) {
      nextRow += 60;
      const ch = g.ch;
      rows.push({
        t: Math.round(g.time), lvl: ch.level, ml: ch.ml, skills: ch.skills.map((s) => s.level).join(","), kills: g.kills,
        gold: ch.gold, hp: Math.round(ch.hp), alive: g.monsters.length, weapon: ch.weapon?.name, armor: ch.armor, spells: ch.known.size,
        dead: ch.hp <= 0, killer: ch.hp <= 0 ? g.log.filter((l) => l.text.startsWith("You lose")).slice(-3).map((l) => l.text.replace(/.*attack by /, "")).join(" / ") : "",
      });
    }
  }
  return rows;
}
