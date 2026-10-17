import { Character } from "./character";
import { BESTIARY_STAGES, BOSS_KILLS, SOUL_EVERY, SOULS_PER_ZONE, soulsFor, spawnEvery, VOCATION_LEVEL, zoneAt, ZONES, type VocationDef } from "./data";
import { advance, DIAGONAL_COST, isStepping, newWalker, startStep, stepDuration, TILE, tileCenter, type Walker } from "./movement";
import { areaOffsets, canWear, item, MONSTERS, POTIONS, PRICES, radiusRows, SPELLS, spellArea, spellFormula, waveRows, type Element, type MonsterAttack, type MonsterData, type Offsets, type SpellData } from "./tibia/db";
import { blockHit, distanceDamage, distanceHitChance, FIGHT_MODES, meleeDamage, mitigation, normalRandom, playerDefense, SKILL, uniform, type FightMode } from "./tibia/rules";
import { imbuement } from "./tibia/imbuements";
import { boost, MAX_PENDING } from "./upgrades";
import { EVOLUTIONS, type EvolutionId } from "./evolutions";
import type { LevelChoice } from "./character";
import { imbuement as imbuementDef, TIERS } from "./tibia/imbuements";
import type { World } from "./world";

export { TILE };

export interface Monster extends Walker {
  id: number;
  key: string; // name in data.json, also the sprite name
  data: MonsterData;
  hp: number;
  maxHp: number;
  timers: number[]; // per attack: seconds until its next try
  healTimer: number;
  blockCount: number; // Creature::blockCount: defense works on at most this many hits, +1 per second up to 2
  blockTimer: number;
  dead: boolean;
  boss: boolean;
}

export interface Missile { fx: number; fy: number; tx: number; ty: number; t: number; dur: number; id: number }
export interface Effect { id: number; x: number; y: number; t: number; dur: number }
export interface FloatText { x: number; y: number; text: string; color: string; t: number; dur: number }
/** A body on the ground holding the loot rolled when the monster died. */
export interface Corpse { tx: number; ty: number; item: number; name: string; loot: { id: number; n: number }[]; looted: boolean; until: number }
export const CORPSE_SECONDS = 60;

/** A looted thing flying from the corpse into your bag (gold goes to the gold counter). */
export interface LootFx { id: number; x: number; y: number; t: number; delay: number; gold: boolean; rare: boolean }
/** Loot worth this much (NPC sell price) gets the rare-drop treatment. */
export const RARE_VALUE = 1000;

/** Console channels: everything shows in Default; loot and combat lines also get their own tab. */
export type Channel = "default" | "loot" | "combat";
export interface LogLine { text: string; color: string; t: number; n: number; channel: Channel }

export type GameEvent = { type: "vocation" } | { type: "levelup" } | { type: "dead" } | { type: "chest"; result: ChestResult };

/** What a boss chest gave: an evolution, or a handful of upgrades (and maybe a blessing). */
export interface ChestResult { evolution?: EvolutionId; gains: string[] }

export const ELEMENT_COLORS: Record<Element, string> = {
  physical: "#ff3030", fire: "#ff8c1a", energy: "#c58bff", earth: "#40d040", ice: "#88e0ff", holy: "#ffe26a",
  death: "#c02040", lifedrain: "#ff3030", manadrain: "#4f8cff", drown: "#88e0ff", healing: "#40ff60",
};

const key = (tx: number, ty: number) => (tx + 0x8000) * 0x10000 + (ty + 0x8000);
const ORTHO: [number, number][] = [[0, -1], [1, 0], [0, 1], [-1, 0]];
const DIAG: [number, number][] = [[1, -1], [1, 1], [-1, 1], [-1, -1]];
const FLOW_R = 22;
const FLOW_W = FLOW_R * 2 + 1;
export const cheb = (ax: number, ay: number, bx: number, by: number) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));
export const dirTo = (dx: number, dy: number) => (Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : dy > 0 ? 2 : 0);

export class Game {
  time = 0;
  kills = 0;
  over = false;
  ch: Character;
  player = { ...newWalker(0, 0), moving: false, hurt: 0, lastAxis: 0 };
  targetId = 0;
  manualTarget = false; // picked by the player (battle list or right click): auto-targeting leaves it alone
  pendingChoices = 0; // one choice per level gained (and per skill advance, see advance())
  private nextSkillPick = 0;
  chase = true; // Tibia fight mode: chase opponent (C toggles "stand while fighting")
  fightMode: FightMode = "offensive"; // offensive / balanced / defensive: Tibia's attack and defense factors
  lastAttack = -99; // full attack only drops your defense right after you swing
  logCount = 0;
  monsters: Monster[] = [];
  missiles: Missile[] = [];
  corpses: Corpse[] = [];
  lootFx: LootFx[] = [];
  goldGained = 0; // recent gold, shown big above you; resets when it fades
  goldGainedAt = -99;
  chests: { tx: number; ty: number }[] = []; // boss treasure chests on the ground
  bestiary = new Map<string, number>(); // kills per creature
  effects: Effect[] = [];
  texts: FloatText[] = [];
  log: LogLine[] = [];
  events: GameEvent[] = [];
  banner: { text: string; t: number } | null = null;
  viewW = 960;
  viewH = 540;

  // combat timers, in game seconds
  nextWeapon = 0;
  groupReady = { attack: 0, healing: 0, support: 0 };
  manaShield = 0; // utamo vita: damage taken from mana instead, up to this much
  manaShieldMax = 0;
  manaShieldUntil = 0;
  spellReady = new Map<string, number>();
  potionReady = 0;
  private blockCount = 2;
  private blockTimer = 0;
  private regen = { hp: 0, mana: 0, ringHp: 0, ringMana: 0 };

  private nextId = 1;
  private spawnTimer = 0;
  zone = -1; // the zone you stand in
  deepest = 0;
  souls = 0; // earned this run; banked when it ends
  rerolls = 0; // level-up rerolls left this run
  private zoneKills: number[] = [];
  private visited = new Set<number>();
  private soulClock = 0;
  private zoneBossesDone: number[] = [];
  private occupied = new Map<number, Monster>();
  private flow = new Int32Array(FLOW_W * FLOW_W);
  private flowAge = 0;
  private flowX = NaN;
  private flowY = NaN;

  constructor(public vocation: VocationDef, public world: World, private effectDur: (id: number) => number) {
    this.ch = new Character(vocation);
    this.msg(`Welcome to Rookgaard! Reach level ${VOCATION_LEVEL} to choose a vocation. The further you walk, the deadlier it gets.`);
  }

  // ---------- messages & visuals ----------

  msg(text: string, color = "#fff", channel: Channel = "default") {
    this.log.push({ text, color, t: this.time, n: ++this.logCount, channel });
    if (this.log.length > 200) this.log.shift();
  }

  /** Player::getDefenseFactor: full attack defends at 0.5 within one attack interval of a swing, else 1.0. */
  private defenseFactor() {
    if (this.fightMode !== "offensive") return FIGHT_MODES[this.fightMode].defense;
    return this.time - this.lastAttack < this.ch.vd.attackSpeed / 1000 ? 0.5 : 1.0;
  }

  addEffect(id: number, x: number, y: number) {
    if (!id) return;
    const dur = this.effectDur(id);
    if (dur > 0) this.effects.push({ id, x, y, t: 0, dur });
  }

  addMissile(id: number, fx: number, fy: number, tx: number, ty: number) {
    if (!id) return;
    const d = Math.hypot(tx - fx, ty - fy);
    this.missiles.push({ id, fx, fy, tx, ty, t: 0, dur: Math.max(0.08, d / 600) });
  }

  addText(x: number, y: number, text: string, color: string) {
    this.texts.push({ x: x + (Math.random() - 0.5) * 10, y, text, color, t: 0, dur: 1.0 });
  }

  // ---------- world queries ----------

  monsterAt(tx: number, ty: number) { return this.occupied.get(key(tx, ty)); }

  /** Attack a creature you picked (Tibia's battle list / right click); picking your target again stops. */
  setTarget(m: Monster | undefined) {
    if (!m || m.id === this.targetId) {
      this.targetId = 0;
      this.manualTarget = false;
      return;
    }
    this.targetId = m.id;
    this.manualTarget = true;
  }

  /** Tibia: one creature per tile, and trees and bushes block. */
  walkable(tx: number, ty: number) {
    return !this.world.blocked(tx, ty) && !this.occupied.has(key(tx, ty)) && !(tx === this.player.tx && ty === this.player.ty);
  }

  monstersInRange(range: number): Monster[] {
    const p = this.player;
    return this.monsters.filter((m) => !m.dead && cheb(m.tx, m.ty, p.tx, p.ty) <= range);
  }

  // ---------- main update ----------

  update(dt: number, mx: number, my: number) {
    if (this.over) return;
    this.time += dt;
    this.updatePlayer(dt, mx, my);
    // Re-plan when you move, and a few times a second as monsters shuffle around you.
    this.flowAge += dt;
    if (this.player.tx !== this.flowX || this.player.ty !== this.flowY || this.flowAge > 0.25) this.computeFlow();
    this.spawn(dt);
    this.updateMonsters(dt);
    this.updateRegen(dt);
    this.soulClock += dt;
    if (this.soulClock >= SOUL_EVERY) { this.soulClock -= SOUL_EVERY; this.souls++; }
    this.updateCorpses();

    for (const e of this.effects) e.t += dt;
    this.effects = this.effects.filter((e) => e.t < e.dur);
    for (const m of this.missiles) m.t += dt;
    this.missiles = this.missiles.filter((m) => m.t < m.dur);
    for (const t of this.texts) { t.t += dt; t.y -= dt * 26; }
    for (const f of this.lootFx) f.t += dt;
    this.lootFx = this.lootFx.filter((f) => f.t < f.delay + 1.1);
    this.texts = this.texts.filter((t) => t.t < t.dur);
    if (this.banner && (this.banner.t -= dt) <= 0) this.banner = null;
    this.monsters = this.monsters.filter((m) => !m.dead);

    if (this.ch.hp <= 0 && this.ch.blessings > 0) {
      // A blessing saves you, as in Tibia (minus the temple trip).
      this.ch.blessings--;
      this.ch.hp = this.ch.maxHp;
      this.ch.mana = this.ch.maxMana;
      this.addEffect(11, this.player.x, this.player.y);
      this.banner = { text: "A blessing saved you from death!", t: 3 };
      this.msg("You were saved by a blessing.", "#ffd34d");
    }
    if (this.ch.hp <= 0) {
      this.ch.hp = 0;
      this.over = true;
      this.msg("You are dead.", "#ff5050");
      this.events.push({ type: "dead" });
    }
  }

  private updatePlayer(dt: number, mx: number, my: number) {
    const p = this.player;
    p.hurt = Math.max(0, p.hurt - dt);
    const left = advance(p, dt);
    p.moving = isStepping(p);
    if (left < 0) return;
    let sx = Math.abs(mx) > 0.35 ? Math.sign(mx) : 0;
    let sy = Math.abs(my) > 0.35 ? Math.sign(my) : 0;
    if (!sx && !sy && this.chase) {
      // Tibia's "chase opponent" fight mode: walk to the target until it's in weapon range.
      const t = this.monsters.find((m) => m.id === this.targetId && !m.dead);
      if (!t || cheb(t.tx, t.ty, p.tx, p.ty) <= this.ch.attackRange) return;
      const step = this.pathStep(t.tx, t.ty);
      if (!step) return;
      [sx, sy] = step;
    }
    if (!sx && !sy) return;
    // Holding two directions walks a staircase instead of paying the 3x diagonal cost.
    let dx = sx, dy = sy;
    if (sx && sy) {
      const first: [number, number] = p.lastAxis === 0 ? [0, sy] : [sx, 0];
      const other: [number, number] = p.lastAxis === 0 ? [sx, 0] : [0, sy];
      [dx, dy] = this.walkable(p.tx + first[0], p.ty + first[1]) ? first : other;
    }
    const ghost = this.ch.evolutions.has("draken");
    if (ghost ? this.world.blocked(p.tx + dx, p.ty + dy) : !this.walkable(p.tx + dx, p.ty + dy)) {
      p.dir = dirTo(dx, dy); // blocked: just turn, like in Tibia
      return;
    }
    p.lastAxis = dx ? 0 : 1;
    startStep(p, dx, dy, stepDuration(this.ch.speed) / 1000, Math.min(left, 0.05));
    advance(p, 0);
    p.moving = true;
  }

  /** First step of a shortest walk (4-way, around trees and creatures) to a tile next to (gx, gy). */
  private pathStep(gx: number, gy: number): [number, number] | null {
    const p = this.player, R = 12, W = R * 2 + 1;
    const prev = new Int32Array(W * W).fill(-1);
    const idx = (x: number, y: number) => (y - p.ty + R) * W + (x - p.tx + R);
    const q: [number, number][] = [[p.tx, p.ty]];
    prev[idx(p.tx, p.ty)] = idx(p.tx, p.ty);
    for (let h = 0; h < q.length; h++) {
      const [x, y] = q[h];
      if (cheb(x, y, gx, gy) <= 1 && (x !== p.tx || y !== p.ty)) {
        // Walk back to the first step.
        let i = idx(x, y);
        while (prev[i] !== idx(p.tx, p.ty)) i = prev[i];
        return [(i % W) - R, Math.floor(i / W) - R];
      }
      for (const [dx, dy] of ORTHO) {
        const nx = x + dx, ny = y + dy;
        if (Math.abs(nx - p.tx) > R || Math.abs(ny - p.ty) > R) continue;
        const ni = idx(nx, ny);
        if (prev[ni] !== -1 || !this.walkable(nx, ny)) continue;
        prev[ni] = idx(x, y);
        q.push([nx, ny]);
      }
    }
    return null;
  }

  private updateRegen(dt: number) {
    const ch = this.ch, vd = ch.vd, r = this.regen;
    // Vocation regeneration while fed (vocations.xml).
    r.hp += dt * 1000;
    while (r.hp >= vd.gainHpTicks) { r.hp -= vd.gainHpTicks; ch.hp = Math.min(ch.maxHp, ch.hp + vd.gainHpAmount); }
    r.mana += dt * 1000;
    while (r.mana >= vd.gainManaTicks) { r.mana -= vd.gainManaTicks; ch.mana = Math.min(ch.maxMana, ch.mana + vd.gainManaAmount); }
    // Rings (healthgain/healthticks of the equipped ring).
    const ringId = ch.equipment.ring;
    const ring = ringId ? item(item(ringId)?.transformequipto ?? ringId) : undefined;
    if (ring?.healthticks) {
      r.ringHp += dt * 1000;
      while (r.ringHp >= ring.healthticks) { r.ringHp -= ring.healthticks; ch.hp = Math.min(ch.maxHp, ch.hp + (ring.healthgain ?? 0)); }
    }
    if (ring?.manaticks) {
      r.ringMana += dt * 1000;
      while (r.ringMana >= ring.manaticks) { r.ringMana -= ring.manaticks; ch.mana = Math.min(ch.maxMana, ch.mana + (ring.managain ?? 0)); }
    }
    // Defense blocks recharge (Creature::blockCount).
    this.blockTimer += dt;
    if (this.blockTimer >= 1) { this.blockTimer = 0; this.blockCount = Math.min(2, this.blockCount + 1); }
  }

  // ---------- pathfinding ----------

  /** Walking cost to reach a free tile next to the player, for every tile nearby (Dijkstra).
   *  Straight steps cost 1 and diagonal ones 3 (as in Tibia); tiles other monsters stand on cost 3 more,
   *  so followers spread out around you instead of queueing behind the first one. */
  private computeFlow() {
    const p = this.player;
    this.flowX = p.tx;
    this.flowY = p.ty;
    this.flowAge = 0;
    const f = this.flow;
    f.fill(-1);
    const idx = (x: number, y: number) => (y + FLOW_R) * FLOW_W + x + FLOW_R;
    // Small binary heap of [cost, index].
    const heap: number[][] = [];
    const push = (c: number, i: number) => {
      heap.push([c, i]);
      let k = heap.length - 1;
      while (k > 0) {
        const pk = (k - 1) >> 1;
        if (heap[pk][0] <= heap[k][0]) break;
        [heap[pk], heap[k]] = [heap[k], heap[pk]];
        k = pk;
      }
    };
    const pop = () => {
      const top = heap[0], last = heap.pop()!;
      if (heap.length) {
        heap[0] = last;
        let k = 0;
        for (;;) {
          const l = 2 * k + 1, r = l + 1;
          let m = k;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === k) break;
          [heap[m], heap[k]] = [heap[k], heap[m]];
          k = m;
        }
      }
      return top;
    };
    const around = [...ORTHO, ...DIAG].filter(([dx, dy]) => !this.world.blocked(p.tx + dx, p.ty + dy));
    const free = around.filter(([dx, dy]) => !this.occupied.has(key(p.tx + dx, p.ty + dy)));
    for (const [dx, dy] of free.length ? free : around) push(0, idx(dx, dy));
    const best = new Int32Array(FLOW_W * FLOW_W).fill(0x7fffffff);
    for (const [, i] of heap) best[i] = 0;
    while (heap.length) {
      const [c, i] = pop();
      if (c > best[i] || f[i] !== -1) continue;
      f[i] = c;
      const x = (i % FLOW_W) - FLOW_R, y = Math.floor(i / FLOW_W) - FLOW_R;
      for (const [dx, dy] of [...ORTHO, ...DIAG]) {
        const nx = x + dx, ny = y + dy;
        if (nx < -FLOW_R || nx > FLOW_R || ny < -FLOW_R || ny > FLOW_R || (nx === 0 && ny === 0)) continue;
        const ni = idx(nx, ny);
        if (f[ni] !== -1 || this.world.blocked(p.tx + nx, p.ty + ny)) continue;
        const nc = c + (dx && dy ? DIAGONAL_COST : 1) + (this.occupied.has(key(p.tx + nx, p.ty + ny)) ? 3 : 0);
        if (nc < best[ni]) {
          best[ni] = nc;
          push(nc, ni);
        }
      }
    }
  }

  private flowAt(tx: number, ty: number): number {
    const x = tx - this.flowX, y = ty - this.flowY;
    if (x < -FLOW_R || x > FLOW_R || y < -FLOW_R || y > FLOW_R) return -1;
    return this.flow[(y + FLOW_R) * FLOW_W + x + FLOW_R];
  }

  // ---------- monsters ----------

  /** The zone you stand in decides what spawns; its bosses come after enough kills there, one at a time. */
  private spawn(dt: number) {
    const z = zoneAt(this.player.tx, this.player.ty);
    if (z !== this.zone) {
      this.zone = z;
      if (!this.visited.has(z)) {
        this.visited.add(z);
        const found = SOULS_PER_ZONE * (z + 1);
        if (z > 0) {
          this.souls += found;
          this.msg(`Exploring a new zone: +${found} souls.`, "#c9a0ff");
        }
      }
      this.deepest = Math.max(this.deepest, z);
      const info = ZONES[z];
      this.banner = { text: `${info.name} (level ${info.level}+)`, t: 3 };
      this.msg(`You enter ${info.name}. Recommended level: ${info.level}.`, "#80c0ff");
    }
    const zone = ZONES[z];
    const kills = this.zoneKills[z] ?? 0;
    const done = this.zoneBossesDone[z] ?? 0;
    const bossAlive = this.monsters.some((m) => m.boss && !m.dead);
    if (!bossAlive && done < zone.bosses.length && kills >= BOSS_KILLS * (done + 1)) {
      const m = this.spawnMonster(zone.bosses[done], true);
      if (m) {
        this.zoneBossesDone[z] = done + 1;
        this.banner = { text: `${m.data.name} has appeared!`, t: 5 };
        this.msg(`${m.data.name} has appeared!`, "#ff8080");
      }
    }
    this.spawnTimer -= dt;
    if (this.spawnTimer > 0) return;
    this.spawnTimer = zone.spawnEvery ?? spawnEvery;
    const alive = this.monsters.filter((m) => !m.boss).length;
    if (alive >= zone.maxAlive) return;
    this.spawnMonster(zone.pool[Math.floor(Math.random() * zone.pool.length)], false);
  }

  private spawnMonster(name: string, boss: boolean): Monster | null {
    const data = MONSTERS[name];
    if (!data) return null;
    const t = this.offscreenTile(Math.random() * Math.PI * 2);
    if (!t) return null;
    const m: Monster = {
      ...newWalker(t[0], t[1]), id: this.nextId++, key: name, data, hp: data.health, maxHp: data.health,
      timers: data.attacks.map((a) => Math.random() * (a.interval / 1000)), healTimer: 2, blockCount: 2, blockTimer: 0, dead: false, boss,
    };
    this.occupied.set(key(m.tx, m.ty), m);
    this.monsters.push(m);
    return m;
  }

  /** A free tile just outside the screen that can walk to the player. */
  private offscreenTile(a: number): [number, number] | null {
    const r = (Math.hypot(this.viewW, this.viewH) / 2 + 40) / TILE;
    for (let tries = 0; tries < 24; tries++) {
      const jitter = () => (tries ? Math.round((Math.random() - 0.5) * 8) : 0);
      const tx = this.player.tx + Math.round(Math.cos(a) * r) + jitter();
      const ty = this.player.ty + Math.round(Math.sin(a) * r) + jitter();
      if (this.walkable(tx, ty) && this.flowAt(tx, ty) >= 0) return [tx, ty];
    }
    return null;
  }

  private moveMonster(m: Monster, dx: number, dy: number) {
    this.occupied.delete(key(m.tx, m.ty));
    const ms = stepDuration(m.data.speed) * (dx && dy ? DIAGONAL_COST : 1);
    startStep(m, dx, dy, ms / 1000);
    this.occupied.set(key(m.tx, m.ty), m);
  }

  private updateMonsters(dt: number) {
    const p = this.player;
    const far = Math.ceil(Math.hypot(this.viewW, this.viewH) / TILE);
    for (const m of this.monsters) {
      if (m.dead) continue;
      const d = cheb(m.tx, m.ty, p.tx, p.ty);
      m.blockTimer += dt;
      if (m.blockTimer >= 1) { m.blockTimer = 0; m.blockCount = Math.min(2, m.blockCount + 1); }
      this.monsterAttacks(m, dt, d);
      if (m.dead || advance(m, dt) < 0) continue;
      if (m.hp < m.data.runHealth && d > Math.max(this.viewW, this.viewH) / TILE / 2 + 2) {
        // A fleeing monster that made it off screen got away.
        m.dead = true;
        this.occupied.delete(key(m.tx, m.ty));
        continue;
      }
      if (d > far && !m.boss) {
        // Left far behind: come back around, as in Vampire Survivors.
        const t = this.offscreenTile(Math.random() * Math.PI * 2);
        if (t) {
          this.occupied.delete(key(m.tx, m.ty));
          Object.assign(m, newWalker(t[0], t[1]));
          this.occupied.set(key(m.tx, m.ty), m);
        }
        continue;
      }
      const step = this.chooseStep(m, d);
      if (step) this.moveMonster(m, step[0], step[1]);
      else m.dir = dirTo(p.tx - m.tx, p.ty - m.ty);
    }
  }

  private chooseStep(m: Monster, d: number): [number, number] | null {
    const p = this.player;
    const fleeing = m.hp < m.data.runHealth;
    const want = fleeing ? 99 : Math.max(1, m.data.targetDistance);
    const free = (s: [number, number]) => this.walkable(m.tx + s[0], m.ty + s[1]);
    if (d < want) {
      // Ranged monsters keep their distance; hurt ones run.
      const away = ORTHO.filter((s) => free(s) && cheb(m.tx + s[0], m.ty + s[1], p.tx, p.ty) > d);
      return away.length ? away[Math.floor(Math.random() * away.length)] : null;
    }
    if (d === want) return null;
    const cur = this.flowAt(m.tx, m.ty);
    if (cur >= 0) {
      // The neighbour that gets closest to a free tile next to the player, counting the step itself
      // (diagonals take 3x as long); ties go to straight steps.
      let best: [number, number] | null = null, bestCost = Infinity;
      for (const s of [...ORTHO, ...DIAG]) {
        if (!free(s)) continue;
        const f = this.flowAt(m.tx + s[0], m.ty + s[1]);
        if (f < 0 || f >= cur) continue;
        const cost = f + (s[0] && s[1] ? DIAGONAL_COST : 1);
        if (cost < bestCost) { bestCost = cost; best = s; }
      }
      return best;
    }
    const best = ORTHO.filter(free).sort((a, b) => cheb(m.tx + a[0], m.ty + a[1], p.tx, p.ty) - cheb(m.tx + b[0], m.ty + b[1], p.tx, p.ty))[0];
    return best && cheb(m.tx + best[0], m.ty + best[1], p.tx, p.ty) < d ? best : null;
  }

  private monsterAttacks(m: Monster, dt: number, d: number) {
    const p = this.player;
    m.data.attacks.forEach((a, i) => {
      m.timers[i] -= dt;
      if (m.timers[i] > 0) return;
      m.timers[i] += a.interval / 1000;
      if (Math.random() * 100 >= a.chance) return;
      if (a.name === "melee") {
        if (d <= 1) {
          m.dir = dirTo(p.tx - m.tx, p.ty - m.ty);
          this.hurtPlayer(normalRandom(a.min, a.max), "physical", m, true);
        }
        return;
      }
      this.monsterSpell(m, a, d);
    });
    if (m.data.heals.length && m.hp < m.maxHp) {
      m.healTimer -= dt;
      if (m.healTimer <= 0) {
        const h = m.data.heals[0];
        m.healTimer = h.interval / 1000;
        if (Math.random() * 100 < h.chance) {
          m.hp = Math.min(m.maxHp, m.hp + normalRandom(h.min, h.max));
          this.addEffect(13, m.x, m.y);
        }
      }
    }
  }

  /** A monster spell: at the player (maybe with a radius), a wave/beam, or a burst around itself. */
  private monsterSpell(m: Monster, a: MonsterAttack, d: number) {
    const p = this.player;
    let tiles: Offsets | null = null;
    let cx = m.tx, cy = m.ty;
    if (a.length) {
      if (d > a.length) return;
      const dir = dirTo(p.tx - m.tx, p.ty - m.ty);
      tiles = areaOffsets(waveRows(a.length, a.spread ?? 0), dir);
      if (!tiles.some(([x, y]) => cx + x === p.tx && cy + y === p.ty)) return; // only breathe when it would hit
      m.dir = dir;
    } else if (a.target || a.range) {
      if (d > (a.range ?? 7)) return;
      if (a.radius) { tiles = areaOffsets(radiusRows(a.radius)); cx = p.tx; cy = p.ty; }
    } else if (a.radius) {
      if (d > a.radius) return;
      tiles = areaOffsets(radiusRows(a.radius));
    } else if (d > 7) return;

    if (a.shoot && !a.length) this.addMissile(a.shoot, m.x, m.y, p.x, p.y);
    let hit = true;
    if (tiles) {
      hit = false;
      for (const [ox, oy] of tiles) {
        const tx = cx + ox, ty = cy + oy;
        if (tx === m.tx && ty === m.ty) continue;
        this.addEffect(a.effect ?? 0, tileCenter(tx), tileCenter(ty));
        if (tx === p.tx && ty === p.ty) hit = true;
      }
    } else this.addEffect(a.effect ?? 0, p.x, p.y);
    if (hit) this.hurtPlayer(normalRandom(a.min, a.max), a.element ?? "physical", m, false);
  }

  /** Damage to the player, with Tibia's blocking: defense (melee), armor (physical), equipment absorb (elements). */
  private hurtPlayer(dmg: number, el: Element, m: Monster, melee: boolean) {
    const ch = this.ch, p = this.player;
    if (el === "manadrain") {
      const v = Math.min(ch.mana, dmg);
      ch.mana -= v;
      if (v > 0) this.addText(p.x, p.y - 40, String(v), ELEMENT_COLORS.manadrain);
      return;
    }
    // Creature::blockHit, in Canary's order: absorb (equipment protection), then defense and armor,
    // then mitigation. Defense only works while a block is left: 2 at most, +1 per second, and every
    // physical hit uses one, so the more monsters hit you, the more hits get through unblocked.
    dmg = Math.round((dmg * (100 - ch.absorb(el))) / 100);
    const sh = ch.shield, w = ch.weapon;
    if (el === "physical") {
      const hasBlock = this.blockCount > 0;
      if (hasBlock) this.blockCount--;
      const defValue = sh ? (sh.defense ?? 0) + (w?.extradef ?? 0) : (w?.defense ?? 0) + (w?.extradef ?? 0);
      const defSkill = sh ? ch.skill(SKILL.shielding) : ch.skill(ch.weaponSkill);
      dmg = blockHit(dmg, playerDefense(defSkill, defValue, !!sh, ch.vd, this.defenseFactor()), ch.armor, melee && hasBlock, true);
      // Shielding trains when you defend with a shield (or a spellbook).
      if (melee && hasBlock && sh) this.advance(ch.train(SKILL.shielding));
    }
    if (dmg > 0 && el !== "lifedrain") dmg -= Math.floor((dmg * mitigation(ch.vd, ch.skill(SKILL.shielding), sh, w, FIGHT_MODES[this.fightMode].mitigation)) / 100);
    // Power-ups on top of the Tibia rules.
    if (ch.evolutions.has("avatarsteel")) dmg = Math.round(dmg * 0.7);
    if (dmg > 0 && this.manaShield > 0 && this.time < this.manaShieldUntil) {
      const v = Math.min(dmg, ch.mana, this.manaShield);
      ch.mana -= v;
      this.manaShield -= v;
      dmg -= v;
      if (v > 0) this.addText(p.x + 10, p.y - 40, String(v), ELEMENT_COLORS.manadrain);
      if (dmg <= 0) return;
    }
    if (dmg <= 0) {
      this.addEffect(melee ? 4 : 3, p.x, p.y); // blocked
      return;
    }
    ch.hp -= dmg;
    p.hurt = 0.15;
    if (el === "physical") this.addEffect(1, p.x, p.y);
    this.addText(p.x, p.y - 40, String(dmg), ELEMENT_COLORS[el]);
    this.msg(`You lose ${dmg} hitpoint${dmg === 1 ? "" : "s"} due to an attack by ${article(m.data.name)}.`, "#bbb", "combat");
  }

  // ---------- player combat ----------

  /** Damage a monster: its elemental resistance, then its defense and armor where they apply. */
  damageMonster(m: Monster, dmg: number, el: Element, useDefense: boolean, useArmor: boolean) {
    if (m.dead) return;
    const ch = this.ch;
    // Strike imbuement: 10% chance of a critical hit.
    const crit = ch.imbued("crit");
    const bloodRage = ch.evolutions.has("bloodrage");
    const isCrit = (crit > 0 || bloodRage) && Math.random() < (bloodRage ? 0.3 : 0.1);
    if (isCrit) dmg = Math.round(dmg * (1 + crit / 100));
    // Monster::blockHit: defense and armor (Creature::blockHit) first, then the element modifier.
    if (useDefense || useArmor) {
      const hasBlock = m.blockCount > 0;
      if (hasBlock) m.blockCount--;
      dmg = blockHit(dmg, m.data.defense, m.data.armor, useDefense && hasBlock, useArmor);
    }
    const pct = m.data.elements[el] ?? 0;
    dmg = Math.round((dmg * (100 - pct)) / 100);
    if (dmg <= 0) {
      this.addEffect(pct >= 100 ? 4 : 3, m.x, m.y);
      return;
    }
    const dealt = Math.min(dmg, m.hp);
    m.hp -= dmg;
    if (el === "physical") this.addEffect(1, m.x, m.y);
    this.addText(m.x, m.y - 30, isCrit ? `${dealt}!` : String(dealt), isCrit ? "#ffd34d" : ELEMENT_COLORS[el]);
    // Vampirism / Void imbuements: leech part of the damage dealt.
    const life = Math.floor((dealt * ch.imbued("lifeLeech")) / 100), mana = Math.floor((dealt * ch.imbued("manaLeech")) / 100);
    if (life > 0) ch.hp = Math.min(ch.maxHp, ch.hp + life);
    if (isCrit && bloodRage) ch.hp = Math.min(ch.maxHp, ch.hp + dealt);
    if (mana > 0) ch.mana = Math.min(ch.maxMana, ch.mana + mana);
    if (m.hp <= 0) this.killMonster(m);
  }

  private killMonster(m: Monster) {
    m.dead = true;
    this.kills++;
    // Souls for the meta progression, and kill counts per zone for its bosses.
    const soul = soulsFor(m.data.experience, m.boss);
    this.souls += soul;
    const mz = zoneAt(m.tx, m.ty);
    this.zoneKills[mz] = (this.zoneKills[mz] ?? 0) + 1;
    // Bestiary: kill counts per creature unlock stages, each worth a choice.
    const seen = (this.bestiary.get(m.data.name) ?? 0) + 1;
    this.bestiary.set(m.data.name, seen);
    const stage = BESTIARY_STAGES.indexOf(seen);
    if (stage >= 0) {
      this.msg(`Bestiary: you unlocked stage ${stage + 1} of the ${m.data.name.toLowerCase()} entry.`, "#80c0ff");
      this.pendingChoices = Math.min(MAX_PENDING, this.pendingChoices + 1);
      if (!this.events.some((e) => e.type === "levelup")) this.events.push({ type: "levelup" });
    }
    this.occupied.delete(key(m.tx, m.ty));
    this.addEffect(3, m.x, m.y);
    const { gained, amount } = this.ch.addExp(m.data.experience);
    this.addText(this.player.x, this.player.y - 52, String(amount), "#ffffff");
    if (gained) {
      const from = this.ch.level - gained;
      this.banner = { text: `You advanced from Level ${from} to Level ${this.ch.level}.`, t: 3 };
      this.msg(`You advanced from Level ${from} to Level ${this.ch.level}.`);
      this.addEffect(14, this.player.x, this.player.y);
      this.pendingChoices = Math.min(MAX_PENDING, this.pendingChoices + gained);
      if (this.ch.voc.id === "none" && this.ch.level >= VOCATION_LEVEL && !this.events.some((e) => e.type === "vocation")) {
        this.msg("You are ready to choose a vocation!", "#ffd34d");
        this.events.unshift({ type: "vocation" });
      }
      if (!this.events.some((e) => e.type === "levelup")) this.events.push({ type: "levelup" });
    }
    // Real loot tables (chance out of 100000), rolled now and left in the corpse.
    const loot: Corpse["loot"] = [];
    for (const l of m.data.loot) {
      if (!item(l.id)) continue;
      const coins = l.id === 3031 || l.id === 3035 || l.id === 3043;
      // Loot Boost scales the drop chance; past 100% it drops several times. Gold Boost scales coins.
      const chance = (l.chance / 100000) * (coins ? 1 : this.ch.rate("loot"));
      const drops = Math.floor(chance) + (Math.random() < chance % 1 ? 1 : 0);
      if (!drops) continue;
      // Each drop is 1..max of the item; many drops are summed rather than rolled one by one.
      let n = drops <= 20 ? Array.from({ length: drops }, () => (l.max > 1 ? uniform(1, l.max) : 1)).reduce((a, b) => a + b, 0)
        : Math.round((drops * (1 + l.max)) / 2);
      if (coins) n = Math.max(1, Math.round(n * this.ch.rate("gold")));
      loot.push({ id: l.id, n });
    }
    this.corpses.push({ tx: m.tx, ty: m.ty, item: m.data.corpse, name: m.data.name, loot, looted: false, until: this.time + CORPSE_SECONDS });
    if (m.boss) {
      this.chests.push({ tx: m.tx, ty: m.ty });
      this.msg(`${m.data.name} dropped a treasure chest!`, "#ffd34d");
    }
  }

  /** Walk onto or next to a corpse to loot it (like Tibia's quick loot); bodies rot away after a while. */
  private updateCorpses() {
    const p = this.player;
    for (const c of this.corpses) {
      if (!c.looted && cheb(c.tx, c.ty, p.tx, p.ty) <= (this.ch.evolutions.has("goldpouch") ? 3 : 1)) {
        c.looted = true;
        this.takeLoot(c);
      }
    }
    this.corpses = this.corpses.filter((c) => c.until > this.time);
    for (const c of this.chests) {
      if (cheb(c.tx, c.ty, p.tx, p.ty) > 1) continue;
      c.tx = NaN; // opened
      this.addEffect(11, tileCenter(p.tx), tileCenter(p.ty));
      this.events.push({ type: "chest", result: this.openChest() });
    }
    this.chests = this.chests.filter((c) => !Number.isNaN(c.tx));
  }

  private takeLoot(c: Corpse) {
    const ch = this.ch;
    const got: string[] = [];
    const gold0 = ch.gold;
    const cx = tileCenter(c.tx), cy = tileCenter(c.ty);
    c.loot.forEach(({ id: lid, n }, i) => {
      const l = { id: lid };
      const it = item(lid)!;
      got.push(n > 1 ? `${n} ${it.name}s` : `${/^[aeiou]/.test(it.name) ? "an" : "a"} ${it.name}`);
      const coins = l.id === 3031 || l.id === 3035 || l.id === 3043;
      let equipped = false;
      if (l.id === 3031) ch.gold += n;
      else if (l.id === 3035) ch.gold += n * 100;
      else if (l.id === 3043) ch.gold += n * 10000;
      else if (POTIONS[l.id] || SPELLS.some((s) => s.runeId === l.id) || l.id === ch.equipment.ammo) {
        ch.supplies.set(l.id, (ch.supplies.get(l.id) ?? 0) + n);
      } else if (ch.offer(l.id)) {
        if (n > 1) ch.stash(l.id, n - 1);
        equipped = true;
        this.msg(`You equip ${it.name}.`, "#80ff80", "loot");
      } else if (ch.evolutions.has("goldpouch")) ch.gold += (PRICES[l.id]?.sell ?? 0) * n;
      else ch.stash(l.id, n);
      // Flair: every item hops out of the body and flies to your bag; rare ones get a fanfare.
      const rare = !coins && (equipped || (PRICES[l.id]?.sell ?? 0) >= RARE_VALUE);
      this.lootFx.push({ id: l.id, x: cx, y: cy, t: 0, delay: i * 0.08, gold: coins, rare });
      if (rare) {
        this.banner = { text: equipped ? `Upgrade! ${it.name}` : `Rare drop: ${it.name}!`, t: 3 };
        this.addEffect(11, cx, cy);
        this.msg(`Rare drop: ${it.name} (worth ${(PRICES[l.id]?.sell ?? 0).toLocaleString("en-US")} gold).`, "#d080ff", "loot");
      }
    });
    const gained = ch.gold - gold0;
    if (gained > 0) {
      this.addEffect(30, cx, cy); // yellow sparkles
      if (this.time - this.goldGainedAt > 1.5) this.goldGained = 0;
      this.goldGained += gained;
      this.goldGainedAt = this.time;
    }
    this.msg(`Loot of ${article(c.name)}: ${got.length ? got.join(", ") : "nothing"}.`, "#40d040", "loot");
  }

  /** Auto attack with the equipped weapon. Returns false if it couldn't (range, mana, ammo). */
  weaponAttack(m: Monster): boolean {
    const ch = this.ch, p = this.player, w = ch.weapon;
    if (cheb(m.tx, m.ty, p.tx, p.ty) > ch.attackRange) return false;
    const t = w?.weapontype;
    const af = FIGHT_MODES[this.fightMode].attack;
    this.lastAttack = this.time;
    if (t === "wand") {
      const cost = w!.mana ?? 0;
      if (ch.mana < cost) return false;
      this.advance(ch.spendMana(cost));
      this.addMissile(missileFor(w!.shoottype), p.x, p.y, m.x, m.y);
      this.damageMonster(m, normalRandom(w!.fromdamage ?? 0, w!.todamage ?? 0), (w!.wandtype as Element) ?? "energy", false, false);
    } else if (t === "distance") {
      ch.fitAmmo();
      const ammoId = ch.equipment.ammo;
      const left = ammoId ? ch.supplies.get(ammoId) ?? 0 : 0;
      if (!ammoId || left <= 0) return false;
      ch.supplies.set(ammoId, left - 1);
      this.addMissile(missileFor(ch.ammo?.shoottype), p.x, p.y, m.x, m.y);
      this.advance(ch.train(SKILL.distance));
      if (Math.random() * 100 < distanceHitChance(ch.ammo?.maxhitchance)) {
        this.weaponHit(m, distanceDamage(ch.level, ch.skill(SKILL.distance), ch.attackValue, ch.vd, af));
      } else this.addEffect(3, m.x, m.y);
    } else {
      this.advance(ch.train(ch.weaponSkill));
      this.weaponHit(m, meleeDamage(ch.level, ch.skill(ch.weaponSkill), ch.attackValue, ch.vd, af));
    }
    p.dir = dirTo(m.tx - p.tx, m.ty - p.ty);
    return true;
  }

  /** A melee or distance hit; elemental imbuements (Scorch, Frost...) turn part of it into element damage. */
  private weaponHit(m: Monster, dmg: number) {
    let physical = dmg;
    for (const [id, tier] of this.ch.imbuements) {
      const d = imbuement(id);
      if (d.kind !== "convert") continue;
      const part = Math.round((dmg * d.values[tier - 1]) / 100);
      physical -= part;
      if (part <= 0) continue;
      this.damageMonster(m, part, d.element!, false, false);
      if (this.ch.evolutions.has("elementalburst")) {
        for (const [dx, dy] of [...ORTHO, ...DIAG]) {
          const o = this.monsterAt(m.tx + dx, m.ty + dy);
          if (o && o !== m) {
            this.addEffect(d.effect, o.x, o.y);
            this.damageMonster(o, part, d.element!, false, false);
          }
        }
      }
    }
    if (physical > 0) this.damageMonster(m, physical, "physical", true, true);
  }

  /** Tiles a spell hits: around the player, in the facing direction, or on/around the target. */
  spellTiles(s: SpellData, dir: number, target?: Monster): [number, number][] {
    const rows = spellArea(s);
    const p = this.player;
    const onTarget = !!target && (s.kind === "rune" || !rows);
    const cx = onTarget ? target!.tx : p.tx, cy = onTarget ? target!.ty : p.ty;
    const offs: Offsets = rows ? areaOffsets(rows, s.needDirection ? dir : 0) : [[0, 0]];
    return offs.map(([x, y]) => [cx + x, cy + y] as [number, number]).filter(([x, y]) => !(x === p.tx && y === p.ty));
  }

  /** Mana a spell costs now (Mastermind halves it). */
  manaCost(s: SpellData) {
    return Math.ceil((s.mana ?? 0) * (this.ch.evolutions.has("mastermind") ? 0.5 : 1));
  }

  /** A boss chest: evolve an upgrade if a recipe is complete, else 1, 3 or 5 free upgrades (and maybe a blessing). */
  private openChest(): ChestResult {
    const ch = this.ch;
    const evo = EVOLUTIONS.find((e) => !ch.evolutions.has(e.id) && e.ready(ch));
    if (evo) {
      ch.evolutions.add(evo.id);
      this.msg(`Evolution! ${evo.name}: ${evo.desc}`, "#ffd34d");
      return { evolution: evo.id, gains: [] };
    }
    const r = Math.random();
    const n = r < 0.1 ? 5 : r < 0.4 ? 3 : 1;
    const gains: string[] = [];
    for (let i = 0; i < n; i++) {
      const c = ch.rollChoices().filter((c) => c.kind !== "spell")[0];
      if (!c) break;
      ch.applyChoice(c);
      gains.push(describeChoice(ch, c));
    }
    if (Math.random() < 0.35) {
      ch.blessings++;
      gains.push("A blessing (saves you from one death)");
    }
    for (const gn of gains) this.msg(`Treasure: ${gn}.`, "#ffd34d");
    return { gains };
  }

  spellRange(s: SpellData) {
    return s.kind === "rune" ? 7 : s.range ?? 1;
  }

  /** Cast for real: mana or rune charge, cooldowns, the formula rolled per creature hit. */
  cast(s: SpellData, dir: number, target?: Monster) {
    const ch = this.ch, p = this.player;
    const attack = s.file.includes("ethereal_spear") && s.file !== "strong_ethereal_spear" ? 25 : ch.attackValue;
    const [lo, hi] = spellFormula(s)(ch.level, ch.ml, ch.skill(ch.weaponSkill), attack);
    if (s.kind === "rune") ch.supplies.set(s.runeId!, (ch.supplies.get(s.runeId!) ?? 0) - 1);
    else if (s.mana) this.advance(ch.spendMana(this.manaCost(s)));
    const mm = ch.evolutions.has("mastermind") ? 0.7 : 1;
    this.spellReady.set(s.file, this.time + ((s.cooldown ?? 2000) / 1000) * mm);
    const group = s.group;
    this.groupReady[group] = this.time + (s.groupCooldown ?? 2000) / 1000;
    if (s.words) this.addText(p.x, p.y - 62, s.words, "#f0e060");

    if (s.file === "magic_shield") {
      // Canary: 300 + 7.6 * level + 7 * magic level, at most max mana, for 180 s.
      this.manaShield = this.manaShieldMax = Math.floor(Math.min(ch.maxMana, 300 + 7.6 * ch.level + 7 * ch.ml));
      this.manaShieldUntil = this.time + 180;
      this.addEffect(s.effect || 13, p.x, p.y);
      return;
    }
    if (s.group === "healing") {
      const healed = Math.min(normalRandom(Math.floor(lo), Math.floor(hi)), ch.maxHp - ch.hp);
      ch.hp += healed;
      this.addEffect(s.effect || 13, p.x, p.y);
      if (healed > 0) this.addText(p.x, p.y - 44, String(healed), ELEMENT_COLORS.healing);
      return;
    }
    if (s.needDirection) p.dir = dir;
    else if (target) p.dir = dirTo(target.tx - p.tx, target.ty - p.ty);
    // CONST_ANI_WEAPONTYPE: the missile follows the weapon (whirlwind sword/axe/club).
    const shoot = s.shoot === 254 ? ({ sword: 25, axe: 26, club: 27 } as Record<string, number>)[ch.weapon?.weapontype ?? ""] ?? 0 : s.shoot;
    if (target && shoot) this.addMissile(shoot, p.x, p.y, target.x, target.y);
    for (const [tx, ty] of this.spellTiles(s, dir, target)) {
      this.addEffect(s.effect, tileCenter(tx), tileCenter(ty));
      const m = this.monsterAt(tx, ty);
      if (m) this.damageMonster(m, normalRandom(Math.floor(lo), Math.floor(hi)), s.element, false, s.blockArmor);
    }
  }

  /** A spell or rune used by hand (the hotbar), with Tibia's checks and messages. Returns the failure, if any. */
  castByHand(s: SpellData): string | null {
    const ch = this.ch, p = this.player;
    if (this.over) return "You are dead.";
    if (this.time < (this.spellReady.get(s.file) ?? 0) || this.time < this.groupReady[s.group]) return "You are exhausted.";
    if (s.kind === "rune") {
      if ((ch.supplies.get(s.runeId!) ?? 0) <= 0) return "You have no more of these runes.";
    } else if (ch.mana < this.manaCost(s)) return "You do not have enough mana.";
    let target: Monster | undefined;
    if (s.group !== "healing" && s.file !== "magic_shield" && (s.needTarget || s.kind === "rune")) {
      target = this.monsters.find((m) => m.id === this.targetId && !m.dead);
      if (!target) return "You can only use this on creatures. Select a target first.";
      if (cheb(target.tx, target.ty, p.tx, p.ty) > this.spellRange(s)) return "Target is too far away.";
    }
    this.cast(s, p.dir, target);
    return null;
  }

  /** A potion drunk by hand. Returns the failure, if any. */
  potionByHand(id: number): string | null {
    const ch = this.ch, pot = POTIONS[id], it = item(id);
    if (this.over) return "You are dead.";
    if (!pot || (ch.supplies.get(id) ?? 0) <= 0) return "You have none left.";
    if (this.time < this.potionReady) return "You are exhausted.";
    if ((pot.level && ch.level < pot.level) || (pot.voc && !pot.voc.includes(ch.voc.id)) || (it && !canWear(it, ch.voc.id, ch.level))) {
      return `This potion can only be consumed by ${pot.voc ? pot.voc.map((v) => `${v}s`).join(" and ") : "players"}${pot.level ? ` of level ${pot.level} or higher` : ""}.`;
    }
    this.usePotion(id);
    return null;
  }

  usePotion(id: number) {
    const ch = this.ch, pot = POTIONS[id], p = this.player;
    const n = ch.supplies.get(id) ?? 0;
    if (!pot || n <= 0) return;
    ch.supplies.set(id, n - 1);
    this.potionReady = this.time + 1;
    if (pot.health) {
      const v = Math.min(uniform(pot.health[0], pot.health[1]), ch.maxHp - ch.hp);
      ch.hp += v;
      if (v > 0) this.addText(p.x, p.y - 44, String(v), ELEMENT_COLORS.healing);
    }
    if (pot.mana) {
      const v = Math.min(uniform(pot.mana[0], pot.mana[1]), ch.maxMana - ch.mana);
      ch.mana += v;
      if (v > 0) this.addText(p.x + 12, p.y - 44, String(v), ELEMENT_COLORS.manadrain);
    }
    this.addEffect(13, p.x, p.y);
    this.addText(p.x, p.y - 62, "Aaaah...", "#f0e060");
  }

  /** Skill and magic level advancements: a message, and a level-up style choice (at most every 20 s). */
  advance(msgs: string[]) {
    for (const m of msgs) this.msg(m);
    if (msgs.length && this.time >= this.nextSkillPick) {
      this.nextSkillPick = this.time + 20;
      this.pendingChoices = Math.min(MAX_PENDING, this.pendingChoices + 1);
      if (!this.events.some((e) => e.type === "levelup")) this.events.push({ type: "levelup" });
    }
  }
}

export function article(name: string) {
  if (/^(demodras|orshabaal|ferumbras)$/i.test(name)) return name;
  const lower = name.toLowerCase();
  return `${/^[aeiou]/.test(lower) ? "an" : "a"} ${lower}`;
}

/** Item shoot types ("arrow", "energy", "smallearth"...) to Tibia's missile ids (ShootType_t). */
const SHOOT: Record<string, number> = {
  spear: 1, bolt: 2, arrow: 3, fire: 4, energy: 5, poisonarrow: 6, burstarrow: 7, throwingstar: 8, throwingknife: 9,
  smallstone: 10, death: 11, largerock: 12, snowball: 13, powerbolt: 14, poison: 15, infernalbolt: 16, huntingspear: 17,
  enchantedspear: 18, redstar: 19, greenstar: 20, royalspear: 21, sniperarrow: 22, onyxarrow: 23, piercingbolt: 24,
  etherealspear: 28, ice: 29, earth: 30, holy: 31, suddendeath: 32, flasharrow: 33, flammingarrow: 34, shiverarrow: 35,
  energyball: 36, smallice: 37, smallholy: 38, smallearth: 39, eartharrow: 40, explosion: 41,
};
export const missileFor = (name?: string) => (name ? SHOOT[name.toLowerCase()] ?? 0 : 0);

/** A chosen upgrade in words, as it stands after applying it. */
export function describeChoice(ch: Character, c: LevelChoice): string {
  switch (c.kind) {
    case "spell": return `${c.spell.name} (${c.spell.words})`;
    case "boost": return `${boost(c.id)!.name} ${ch.boostLevel(c.id)}`;
    case "imbue": return `${TIERS[(ch.imbuements.get(c.id) ?? 1) - 1]} ${imbuementDef(c.id).name}`;
    case "train": return c.skill === "magic" ? "+1 magic level" : "+1 skill";
    case "supply": return `${c.n} ${item(c.id)!.name}s`;
  }
}
