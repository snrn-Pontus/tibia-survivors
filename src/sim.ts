// Dev-only balance testing: play whole runs without rendering. From the browser console:
//   sim.run(0, 1200)  -> knight; returns one row per simulated minute
// The bot stands and lets auto-combat fight (chase mode on), backs off below 30% HP,
// learns the highest spell offered, and trades once a minute like a player in the pause menu.
import { autoCombat } from "./autocast";
import { ROOKIE, VOCATIONS, ZONES } from "./data";
import { zoneAt } from "./map";
import { cheb, Game } from "./game";
import { buyPrice, itemId, PRICES } from "./tibia/db";
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
    const price = buyPrice(thrown);
    while ((ch.supplies.get(thrown) ?? 0) < 10 && price && ch.gold >= price * 10 && ch.fits(thrown) >= 10) {
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
  let lastTrade = 0, nextRow = 60, resting = false;
  const router = new Router();
  while (!g.over && g.time < seconds) {
    let mx = 0, my = 0;
    const p = g.player;
    const near = g.monsters.filter((m) => !m.dead).sort((a, b) => cheb(a.tx, a.ty, p.tx, p.ty) - cheb(b.tx, b.ty, p.tx, p.ty))[0];
    const ranged = g.ch.attackRange > 1;
    const dist = near ? cheb(near.tx, near.ty, p.tx, p.ty) : 99;
    const hp = g.ch.hp / g.ch.maxHp;
    // Hurt: back off until mostly healed (not just back over the line, which walked it straight into the pack
    // again). Ranged vocations also kite anything that gets next to them, and melee ones step out of a crowd
    // instead of trading blows with three at once.
    if (hp < 0.3) resting = true;
    else if (hp > 0.75) resting = false;
    const adjacent = g.monstersInRange(1).length;
    const threat = (resting && dist <= 4) || (ranged && dist <= 1) || (!ranged && adjacent >= 2 && hp < 0.8);
    // Chase mode would walk it back to its target while it rests.
    g.chase = !resting;
    if (near && threat) [mx, my] = escape(g);
    else if (dist > 3 && !resting) {
      // Nothing close: go loot the nearest unlooted corpse.
      const c = [...g.chests, ...g.corpses.filter((c) => !c.looted && c.loot.length)].filter((c) => cheb(c.tx, c.ty, p.tx, p.ty) <= 7)
        .sort((a, b) => cheb(a.tx, a.ty, p.tx, p.ty) - cheb(b.tx, b.ty, p.tx, p.ty))[0];
      if (c) [mx, my] = router.step(g, `c${c.tx},${c.ty}`, (x, y) => cheb(x, y, c.tx, c.ty) <= 1);
      else {
        // Strong enough for the next zone? Walk out to it (through a gap in the wall); too weak for this one?
        // Walk back in.
        const z = zoneAt(p.tx, p.ty), next = ZONES[z + 1];
        const out = next && g.ch.level >= next.level ? 1 : z > 0 && g.ch.level < ZONES[z].level - 5 ? -1 : 0;
        if (out) [mx, my] = router.step(g, `z${z}${out}`, (x, y) => (out > 0 ? zoneAt(x, y) > z : zoneAt(x, y) < z));
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
      const rank = (c: (typeof cs)[number]) => c.kind === "spell" ? 0 : c.kind === "bonus" ? ({ xp: 1, skill: 2, magic: 2, loot: 3, gold: 3 } as Record<string, number>)[c.id] : c.kind === "boost"
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

/** The free neighbouring tile farthest from the monsters around (closest ones count most), leaning back toward
 *  the start when this zone is above your level. Picking from walkable tiles keeps it from running into a tree. */
function escape(g: Game): [number, number] {
  const p = g.player;
  const around = g.monsters.filter((m) => !m.dead && cheb(m.tx, m.ty, p.tx, p.ty) <= 6);
  const z = zoneAt(p.tx, p.ty);
  const inward = z > 0 && ZONES[z].level > g.ch.level;
  let best: [number, number] = [0, 0], bestScore = -Infinity;
  for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0], [1, -1], [1, 1], [-1, 1], [-1, -1]]) {
    const tx = p.tx + dx, ty = p.ty + dy;
    if (!g.walkable(tx, ty)) continue;
    let score = 0;
    for (const m of around) score -= 1 / Math.max(0.5, Math.hypot(m.tx - tx, m.ty - ty)) ** 2;
    if (inward) score -= Math.hypot(tx, ty) * 0.3;
    if (score > bestScore) { bestScore = score; best = [dx, dy]; }
  }
  return best;
}

/** The bot's way around walls: a breadth-first path (8-way) to the nearest tile `goal` accepts, followed step by
 *  step and planned again when the goal changes, the bot strays from it, or every few seconds. */
class Router {
  private path: [number, number][] = [];
  private key = "";
  private at = -99;

  step(g: Game, key: string, goal: (tx: number, ty: number) => boolean, radius = 90): [number, number] {
    const p = g.player;
    while (this.path.length && this.path[0][0] === p.tx && this.path[0][1] === p.ty) this.path.shift();
    const next = this.path[0];
    if (key !== this.key || g.time - this.at > 4 || !next || cheb(next[0], next[1], p.tx, p.ty) !== 1) {
      this.path = findPath(g, goal, radius);
      this.key = key;
      this.at = g.time;
    }
    const n = this.path[0];
    return n ? [n[0] - p.tx, n[1] - p.ty] : [0, 0];
  }
}

function findPath(g: Game, goal: (tx: number, ty: number) => boolean, R: number): [number, number][] {
  const p = g.player, W = R * 2 + 1;
  const prev = new Int32Array(W * W).fill(-1), q = new Int32Array(W * W);
  const start = R * W + R;
  let h = 0, n = 0;
  q[n++] = start;
  prev[start] = start;
  while (h < n) {
    const i = q[h++], x = (i % W) - R + p.tx, y = Math.floor(i / W) - R + p.ty;
    if (i !== start && goal(x, y)) {
      const out: [number, number][] = [];
      for (let j = i; j !== start; j = prev[j]) out.push([(j % W) - R + p.tx, Math.floor(j / W) - R + p.ty]);
      return out.reverse();
    }
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0], [1, -1], [1, 1], [-1, 1], [-1, -1]]) {
      const nx = x + dx, ny = y + dy, ix = nx - p.tx + R, iy = ny - p.ty + R;
      if (ix < 0 || iy < 0 || ix >= W || iy >= W) continue;
      const j = iy * W + ix;
      if (prev[j] >= 0 || g.world.blocked(nx, ny)) continue;
      // No cutting a corner between two walls.
      if (dx && dy && g.world.blocked(x + dx, y) && g.world.blocked(x, y + dy)) continue;
      prev[j] = i;
      q[n++] = j;
    }
  }
  return [];
}
