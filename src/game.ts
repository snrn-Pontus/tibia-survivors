import { Character } from "./character";
import { achievement, mitigationOf, BESTIARY_STAGES, BOSS_KILLS, SOUL_EVERY, SOULS_PER_ZONE, soulsFor, spawnEvery, VOCATION_LEVEL, zoneAt, ZONES, type VocationDef } from "./data";
import { advance, DIAGONAL_COST, isStepping, newWalker, startStep, stepDuration, TILE, tileCenter, type Walker } from "./movement";
import { areaOffsets, canWear, FIELDS, item, MONSTERS, POTIONS, PRICES, radiusRows, SPELLS, spellArea, spellFormula, waveRows, type Element, type MonsterAttack, type MonsterData, type Offsets, type SpellData } from "./tibia/db";
import { blockHit, damageList, distanceDamage, expForLevel, speedChange, distanceHitChance, FIGHT_MODES, meleeDamage, mitigation, normalRandom, playerDefense, SKILL, uniform, type FightMode } from "./tibia/rules";
import { imbuement } from "./tibia/imbuements";
import { charm, CHARM_TIERS, describePrey, type GradeBonus } from "./picks";
import type { Slot } from "./character";
import { boost, MAX_PENDING, RUN_BONUS_STEP, runBonus } from "./upgrades";
import { EVOLUTIONS, type EvolutionId } from "./evolutions";
import type { LevelChoice } from "./character";
import { SUPPORT, type Support } from "./support";
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
  dead: boolean;
  boss: boolean;
  master?: number; // summoned by this monster: no experience, no corpse, and it dies with its master
  dot?: DamageCondition & { element: Element }; // a field burning it
  rootedUntil?: number; // Cripple / Numb charms: paralyzed in place until then
  holdUntil?: number; // Fatal Hold charm: won't flee until then
  summonTimers: number[]; // per monster.summon entry: seconds until its next roll
}
/** A magic field on the ground (a fire, poison or energy field item), until it decays. */
export interface Field { tx: number; ty: number; id: number; until: number }
/** Damage over time on the player, one per kind (Tibia's poisoned, burning, electrified... icons). */
export interface DamageCondition { ticks: number[]; every: number; next: number }

export interface Missile { fx: number; fy: number; tx: number; ty: number; t: number; dur: number; id: number }
export interface Effect { id: number; x: number; y: number; t: number; dur: number }
export interface FloatText { x: number; y: number; text: string; color: string; t: number; dur: number }
/** A body on the ground holding the loot rolled when the monster died. */
export interface Corpse {
  tx: number; ty: number; item: number; name: string; loot: { id: number; n: number }[]; looted: boolean; until: number;
  opened?: boolean; // looted once already (what's left didn't fit)
  nextTry?: number; // when to try again for what didn't fit
}
export const CORPSE_SECONDS = 60;

/** Where looted things fly: the gold counter, the backpack, the supplies window or the equipment. */
export type LootDest = "gold" | "bag" | "supplies" | "worn";
/** A looted thing flying from the corpse to where it went. */
export interface LootFx { id: number; n: number; x: number; y: number; t: number; delay: number; to: LootDest; rare: boolean }
/** Loot worth this much (NPC sell price) gets the rare-drop treatment. */
export const RARE_VALUE = 1000;

/** Console channels: everything shows in Default; loot and combat lines also get their own tab. */
export type Channel = "default" | "loot" | "combat";
/** Auto-targeting: the closest creature, or the one with the least health left (by percent, like the battle list). */
export type Targeting = "closest" | "weakest";
export interface LogLine { text: string; color: string; t: number; n: number; channel: Channel }

export type GameEvent = { type: "vocation" } | { type: "levelup" } | { type: "dead" } | { type: "chest"; result: ChestResult }
  | { type: "charm"; creature: string; stage: number }; // a bestiary stage: pick a charm

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
const PLAYER_DIAGONAL_COST = Math.SQRT2; // a diagonal step for you (see updatePlayer)
/** What a damage-over-time tick is called in the summary. */
const CONDITION_NAMES: Partial<Record<Element, string>> = { earth: "poison", fire: "burning", energy: "electrification", physical: "bleeding", drown: "drowning", ice: "freezing", holy: "dazzling", death: "curse" };


/** The charms' hit effects by element (bestiary_charms.lua). */
const CHARM_EFFECT: Partial<Record<Element, number>> = { physical: 10, fire: 16, earth: 9, ice: 44, energy: 12, death: 39, holy: 40 };
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
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
  targeting: Targeting = "closest"; // which creature auto-targeting picks (T toggles)
  conditions = new Map<Element, DamageCondition>(); // poison, fire, energy... ticking on you, by damage type
  paralyzedUntil = 0; // a paralysis on you (Character.slowDelta is how strong)
  hasteUntil = 0; // a haste on you (Character.hasteDelta)
  stanceUntil = 0; // Blood Rage / Protector / Sharpshooter (Character.stance)
  lightSpell: { level: number; from: number; until: number } | null = null; // utevo lux and the like

  /** Your light level: a light spell's, fading as it runs out (Canary's ConditionLight), or what glows on you. */
  playerLight(glow: (id: number) => number): number {
    const s = this.lightSpell;
    const spell = s && this.time < s.until ? Math.ceil((s.level * (s.until - this.time)) / (s.until - s.from)) : 0;
    let worn = 0;
    for (const id of Object.values(this.ch.equipment)) if (id) worn = Math.max(worn, glow(id));
    return Math.max(spell, worn);
  }

  /** The world's light where you stand (255 day, 40 a deep cave), easing between zones. */
  ambient = 255;
  recovery: { hp: number; every: number; next: number; until: number } | null = null; // Recovery / Intense Recovery
  fightMode: FightMode = "offensive"; // offensive / balanced / defensive: Tibia's attack and defense factors
  lastAttack = -99; // full attack only drops your defense right after you swing
  logCount = 0;
  monsters: Monster[] = [];
  missiles: Missile[] = [];
  corpses: Corpse[] = [];
  fields = new Map<number, Field>(); // by tile
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
  killTotals: Record<string, number> = {}; // kills per creature over all runs (from the save), for achievements
  discovered = new Set<number>(); // zones you've made a kill in, ever (from the save): each pays souls once
  private soulClock = 0;
  /** The run in numbers, for the summary when it ends. */
  stats = {
    dealt: 0, healed: 0,
    taken: new Map<string, number>(), // by who (or what condition) hurt you
    lastHits: [] as { t: number; source: string; dmg: number; el: Element }[],
    bestLoot: null as { id: number; n: number; value: number } | null,
    souls: { kills: 0, zones: 0, achievements: 0, fighting: 0 } as Record<"kills" | "zones" | "achievements" | "fighting", number>,
  };
  private lastKill = -999; // time of your last kill (survival souls need one in the last SOUL_EVERY seconds)
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

  /** On your screen (15 x 11 tiles: 7 to either side, but only 5 up or down). What you can target and hit. */
  onScreen(tx: number, ty: number) {
    const p = this.player;
    return Math.abs(tx - p.tx) <= Math.floor(this.viewW / TILE / 2) && Math.abs(ty - p.ty) <= Math.floor(this.viewH / TILE / 2);
  }

  /** Creatures within range that you can see (a range of 7 reaches past the top and bottom of the screen). */
  monstersInRange(range: number): Monster[] {
    const p = this.player;
    return this.monsters.filter((m) => !m.dead && cheb(m.tx, m.ty, p.tx, p.ty) <= range && this.onScreen(m.tx, m.ty));
  }

  // ---------- main update ----------

  private dtLast = 0;

  update(dt: number, mx: number, my: number) {
    if (this.over) return;
    this.dtLast = dt;
    this.time += dt;
    this.updatePlayer(dt, mx, my);
    // Re-plan when you move, and a few times a second as monsters shuffle around you.
    this.flowAge += dt;
    if (this.player.tx !== this.flowX || this.player.ty !== this.flowY || this.flowAge > 0.25) this.computeFlow();
    this.spawn(dt);
    this.updateMonsters(dt);
    this.updateConditions();
    this.updateFields();
    this.updateBuffs();
    this.ambient += (ZONES[Math.max(0, zoneAt(this.player.tx, this.player.ty))].ambient - this.ambient) * Math.min(1, dt * 1.5);

    this.updateRegen(dt);
    if (this.time - this.lastKill < SOUL_EVERY) this.soulClock += dt; // only while you're killing things
    if (this.soulClock >= SOUL_EVERY) { this.soulClock -= SOUL_EVERY; this.addSouls(1, "fighting"); }
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
      this.conditions.clear(); // dying clears them
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
      if (!t || !this.onScreen(t.tx, t.ty) || cheb(t.tx, t.ty, p.tx, p.ty) <= this.ch.attackRange) return;
      // Something else on you: fight it first (auto-combat swings at what's in reach); don't drag it along after
      // a target that runs or keeps its distance.
      if (this.monsters.some((o) => o !== t && !o.dead && cheb(o.tx, o.ty, p.tx, p.ty) <= 1)) return;
      const step = this.pathStep(t.tx, t.ty);
      if (!step) return;
      [sx, sy] = step;
    }
    if (!sx && !sy) return;
    // Holding two directions steps diagonally. Canary makes a diagonal step take 3x as long (monsters still
    // do), which made two keys walk a staircase; you pay the real distance instead (x1.41). Into a wall or a
    // creature, it slides along whichever straight step is free.
    let dx = sx, dy = sy, cost = 1;
    if (sx && sy) {
      if (this.walkable(p.tx + sx, p.ty + sy)) cost = PLAYER_DIAGONAL_COST;
      else {
        const first: [number, number] = p.lastAxis === 0 ? [0, sy] : [sx, 0];
        const other: [number, number] = p.lastAxis === 0 ? [sx, 0] : [0, sy];
        [dx, dy] = this.walkable(p.tx + first[0], p.ty + first[1]) ? first : other;
      }
    }
    const ghost = this.ch.evolutions.has("draken");
    if (ghost ? this.world.blocked(p.tx + dx, p.ty + dy) : !this.walkable(p.tx + dx, p.ty + dy)) {
      p.dir = dirTo(dx, dy); // blocked: just turn, like in Tibia
      return;
    }
    p.lastAxis = dx ? 0 : 1;
    startStep(p, dx, dy, (stepDuration(this.ch.speed) * cost) / 1000, Math.min(left, 0.05));
    advance(p, 0);
    p.moving = true;
    this.stepIntoField(p.tx, p.ty);
  }

  /** First step of the quickest walk (8-way, around trees, creatures and fields) to a tile next to (gx, gy). */
  private pathStep(gx: number, gy: number): [number, number] | null {
    // Dijkstra over 8 directions with Dial's buckets: a straight step costs 5, a diagonal 7 (your x1.41).
    const p = this.player, R = 12, W = R * 2 + 1, STRAIGHT = 5, DIAGONAL = 7;
    const prev = new Int32Array(W * W).fill(-1);
    const cost = new Int32Array(W * W).fill(0x7fffffff);
    const idx = (x: number, y: number) => (y - p.ty + R) * W + (x - p.tx + R);
    const start = idx(p.tx, p.ty);
    const buckets: number[][] = [[start]];
    prev[start] = start;
    cost[start] = 0;
    for (let c = 0; c < buckets.length; c++) {
      for (const i of buckets[c] ?? []) {
        if (cost[i] !== c) continue; // reached cheaper since
        const x = (i % W) - R + p.tx, y = Math.floor(i / W) - R + p.ty;
        if (cheb(x, y, gx, gy) <= 1 && i !== start) {
          // Walk back to the first step.
          let j = i;
          while (prev[j] !== start) j = prev[j];
          return [(j % W) - R, Math.floor(j / W) - R];
        }
        for (const [dx, dy] of [...ORTHO, ...DIAG]) {
          const nx = x + dx, ny = y + dy;
          if (Math.abs(nx - p.tx) > R || Math.abs(ny - p.ty) > R) continue;
          const ni = idx(nx, ny), nc = c + (dx && dy ? DIAGONAL : STRAIGHT);
          if (nc >= cost[ni] || !this.walkable(nx, ny) || this.fieldHurts(nx, ny)) continue; // autowalk goes around fields
          cost[ni] = nc;
          prev[ni] = i;
          (buckets[nc] ??= []).push(ni);
        }
      }
    }
    return null;
  }

  private updateRegen(dt: number) {
    const ch = this.ch, vd = ch.vd, r = this.regen;
    // Vocation regeneration while fed (vocations.xml); the Rookgaard regeneration unlock speeds up a rookie's.
    r.hp += dt * 1000 * (ch.voc.id === "none" ? ch.rookRegen : 1);
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
      this.ch.preyPool = ZONES[z].pool;
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
    const alive = this.monsters.filter((m) => !m.boss && m.master === undefined).length; // summons don't count
    if (alive >= zone.maxAlive) return;
    const w = zone.weights ?? zone.pool.map(() => 1);
    let r = Math.random() * w.reduce((a, b) => a + b, 0), i = 0;
    while (i < zone.pool.length - 1 && (r -= w[i]) >= 0) i++;
    this.spawnMonster(zone.pool[i], false);
  }

  private spawnMonster(name: string, boss: boolean, at?: [number, number]): Monster | null {
    const data = MONSTERS[name];
    if (!data) return null;
    const t = at ?? this.offscreenTile(Math.random() * Math.PI * 2);
    if (!t) return null;
    const m: Monster = {
      ...newWalker(t[0], t[1]), id: this.nextId++, key: name, data, hp: data.health, maxHp: data.health,
      timers: data.attacks.map((a) => Math.random() * (a.interval / 1000)), healTimer: 2, dead: false, boss,
      summonTimers: (data.summons ?? []).map((s) => s.interval / 1000),
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
    this.monsterIntoField(m);
  }

  /** A monster in a field it isn't immune to burns like you would (its first tick at once). */
  private monsterIntoField(m: Monster) {
    const f = this.fields.get(key(m.tx, m.ty));
    if (!f || !this.fieldHurts(m.tx, m.ty, m)) return;
    const fd = FIELDS[f.id];
    m.dot = { element: fd.element, ticks: [...fd.ticks], every: fd.every / 1000, next: this.time };
  }

  private updateMonsters(dt: number) {
    const p = this.player;
    const far = Math.ceil(Math.hypot(this.viewW, this.viewH) / TILE);
    for (const m of this.monsters) {
      if (m.dead) continue;
      const d = cheb(m.tx, m.ty, p.tx, p.ty);
      if (m.master !== undefined && !this.monsters.some((x) => x.id === m.master && !x.dead)) {
        // Its master got away: it goes too.
        m.dead = true;
        this.occupied.delete(key(m.tx, m.ty));
        this.addEffect(3, m.x, m.y);
        continue;
      }
      while (m.dot && m.dot.ticks.length && this.time >= m.dot.next) {
        m.dot.next += m.dot.every;
        this.damageMonster(m, m.dot.ticks.shift()!, m.dot.element, false);
      }
      if (m.dead) continue;
      this.monsterAttacks(m, dt, d);
      this.monsterSummons(m, dt, d);
      if (m.dead || advance(m, dt) < 0) continue;
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
    if (this.time < (m.rootedUntil ?? 0)) return null; // crippled: stands (it still attacks)
    const fleeing = m.hp < m.data.runHealth && this.time >= (m.holdUntil ?? 0);
    const want = fleeing ? 99 : Math.max(1, m.data.targetDistance);
    // Monsters don't walk into fields that would hurt them (they do if they're immune: a demon in fire).
    const free = (s: [number, number]) => this.walkable(m.tx + s[0], m.ty + s[1]) && !this.fieldHurts(m.tx + s[0], m.ty + s[1], m);
    if (d < want) {
      // Ranged monsters keep their distance; hurt ones run (runHealth), but only to the edge of your screen: there
      // they stand, so you can still catch them (they used to vanish, bosses too). With the way straight back
      // blocked (a tree, or the top of the screen), they slide sideways, toward a corner.
      const open = ORTHO.filter((s) => free(s) && this.onScreen(m.tx + s[0], m.ty + s[1]));
      const dist = (s: [number, number]) => cheb(m.tx + s[0], m.ty + s[1], p.tx, p.ty);
      const manhattan = (s: [number, number]) => Math.abs(m.tx + s[0] - p.tx) + Math.abs(m.ty + s[1] - p.ty);
      let away = open.filter((s) => dist(s) > d);
      if (!away.length) away = open.filter((s) => dist(s) === d && manhattan(s) > Math.abs(m.tx - p.tx) + Math.abs(m.ty - p.ty));
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
          // A bite that gets through can poison too (a blocked one doesn't).
          if (this.hurtPlayer(normalRandom(a.min, a.max), "physical", m, true) > 0 && a.condition) this.applyCondition(a.condition);
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
    if (a.name === "paralyze") {
      // A paralyze spell (monster "speed" with a negative speedChange): slows you while it lasts, the
      // stronger one wins (Tibia's paralysis icon).
      const hits = !tiles || tiles.some(([ox, oy]) => cx + ox === p.tx && cy + oy === p.ty);
      if (!tiles) this.addEffect(a.effect ?? 0, p.x, p.y);
      else for (const [ox, oy] of tiles) this.addEffect(a.effect ?? 0, tileCenter(cx + ox), tileCenter(cy + oy));
      if (hits) {
        // Monsters::deserializeSpell: setFormulaVars(m / 2, 40, m, 40) with m = 1 + speedChange / 1000.
        const k = 1 + a.speedChange! / 1000;
        if (this.paralyze(speedChange(this.ch.baseSpeed, k / 2, 40, k, 40, true), (a.duration ?? 10000) / 1000))
          this.msg(`You are paralyzed by ${article(m.data.name)}.`, "#ff9c30", "combat");
      }
      return;
    }
    if (a.field) {
      // A field spell does no damage itself: it leaves a field on every free tile of the area (yours included).
      const area = tiles ? tiles.map(([ox, oy]) => [cx + ox, cy + oy]) : [[p.tx, p.ty]];
      for (const [tx, ty] of area) if ((tx !== m.tx || ty !== m.ty) && !this.world.blocked(tx, ty)) this.placeField(tx, ty, a.field);
      return;
    }
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
    if (!hit) return;
    // A "condition" spell only does damage over time; a combat spell can do both.
    const dealt = a.max > 0 ? this.hurtPlayer(normalRandom(a.min, a.max), a.element ?? "physical", m, false) : 1;
    if (dealt > 0 && a.condition) this.applyCondition(a.condition);
  }

  addSouls(n: number, from: keyof Game["stats"]["souls"]) {
    this.souls += n;
    this.stats.souls[from] += n;
  }

  /** The Dawnport unlock: skip Rookgaard. You start at level 8 with the level-up choices a rookie would have
   *  earned, and choose a vocation right away; skills stay where a new character's are. */
  dawnport() {
    const ch = this.ch;
    ch.exp = expForLevel(VOCATION_LEVEL);
    ch.level = VOCATION_LEVEL;
    ch.hp = ch.maxHp;
    ch.mana = ch.maxMana;
    this.pendingChoices = Math.min(MAX_PENDING, VOCATION_LEVEL - 1);
    this.events.unshift({ type: "vocation" });
    this.events.push({ type: "levelup" });
    this.msg("You arrive on Dawnport, ready to choose a vocation.", "#ffd34d");
  }

  // ---------- support spells, hastes and paralysis ----------

  /** A haste on you: replaces a weaker one and cures a paralysis (they cancel in Tibia). */
  haste(delta: number, seconds: number) {
    const ch = this.ch;
    if (this.time < this.hasteUntil && ch.hasteDelta > delta) return;
    ch.hasteDelta = delta;
    this.hasteUntil = this.time + seconds;
    ch.slowDelta = 0;
    this.paralyzedUntil = 0;
  }

  /** A paralysis on you: replaces a weaker one and ends a haste. Returns false if a stronger one holds. */
  paralyze(delta: number, seconds: number): boolean {
    const ch = this.ch;
    if (this.time < this.paralyzedUntil && ch.slowDelta < delta) return false;
    ch.slowDelta = delta;
    this.paralyzedUntil = this.time + seconds;
    ch.hasteDelta = 0;
    this.hasteUntil = 0;
    return true;
  }

  /** A ring or amulet ran out: gone, as in Tibia. */
  private wornOut(slot: Slot) {
    const id = this.ch.equipment[slot];
    if (!id) return;
    delete this.ch.equipment[slot];
    delete this.ch.wear[slot];
    this.msg(`Your ${item(id)?.name ?? "item"} has run out.`, "#ff9c30");
  }

  /** Hastes, paralysis, stances and Recovery wearing off; Recovery's ticks; rings running down. */
  private updateBuffs() {
    const ch = this.ch;
    for (const [slot, wear] of Object.entries(ch.wear) as [Slot, { left: number; timed: boolean }][]) {
      if (wear.timed && (wear.left -= this.dtLast) <= 0) this.wornOut(slot);
    }
    if (ch.slowDelta && this.time >= this.paralyzedUntil) ch.slowDelta = 0;
    if (ch.hasteDelta && this.time >= this.hasteUntil) ch.hasteDelta = 0;
    if (ch.stance && this.time >= this.stanceUntil) ch.stance = null;
    const r = this.recovery;
    if (r) {
      while (this.time >= r.next && r.next <= r.until) {
        r.next += r.every;
        const healed = Math.min(r.hp, ch.maxHp - ch.hp);
        this.stats.healed += healed;
        ch.hp += healed;
        if (healed > 0) this.addText(this.player.x, this.player.y - 44, String(healed), ELEMENT_COLORS.healing);
      }
      if (this.time > r.until) this.recovery = null;
    }
  }

  /** Cast a support spell (SUPPORT has its Canary values). */
  private support(s: SpellData, sup: Support) {
    const ch = this.ch, p = this.player;
    this.addEffect(s.effect || 15, p.x, p.y);
    switch (sup.kind) {
      case "haste":
        this.haste(speedChange(ch.baseSpeed, sup.a, sup.b, sup.a, sup.b), sup.seconds);
        break;
      case "stance":
        // Blood Rage and Protector share a slot (AttrSubId_BloodRageProtector): the new one replaces the old.
        ch.stance = { name: s.name, ...sup.stance };
        this.stanceUntil = this.time + sup.seconds;
        if (sup.slow) this.paralyze(speedChange(ch.baseSpeed, sup.slow[0], sup.slow[1], sup.slow[0], sup.slow[1], true), sup.seconds);
        if (sup.healLock) this.groupReady.healing = Math.max(this.groupReady.healing, this.time + sup.seconds);
        break;
      case "regen":
        this.recovery = { hp: sup.hp, every: sup.every, next: this.time + sup.every, until: this.time + sup.seconds };
        break;
      case "light":
        this.lightSpell = { level: sup.level, from: this.time, until: this.time + sup.seconds };
        break;
      case "cure":
        if (sup.element === "paralyze") { ch.slowDelta = 0; this.paralyzedUntil = 0; }
        else this.conditions.delete(sup.element);
        break;
    }
  }

  /** Conjure a rune: a blank rune and the spell's mana make a stack (adori gran mort: 3 sudden deaths for 985
   *  mana). Tibia's soul points are left out: they're there to stop people making runes while away from the
   *  keyboard, which isn't a thing here. Returns why not, if it can't. */
  conjure(rune: SpellData): string | null {
    const ch = this.ch, c = rune.conjure;
    if (!c || !ch.conjurable().includes(rune)) return "You can't conjure that rune.";
    if (this.time < this.groupReady.support) return "You are exhausted.";
    if ((ch.supplies.get(c.reagent) ?? 0) <= 0) return "You need a blank rune.";
    if (ch.mana < c.mana) return "You do not have enough mana.";
    ch.supplies.set(c.reagent, ch.supplies.get(c.reagent)! - 1);
    this.advance(ch.spendMana(c.mana));
    ch.supplies.set(rune.runeId!, (ch.supplies.get(rune.runeId!) ?? 0) + c.count);
    this.groupReady.support = this.time + 2;
    this.addText(this.player.x, this.player.y - 62, c.words, "#f0e060");
    this.addEffect(13, this.player.x, this.player.y);
    this.msg(`You conjure ${c.count} ${rune.name}${c.count > 1 ? "s" : ""}.`, "#80c0ff");
    return null;
  }

  // ---------- magic fields ----------

  private placeField(tx: number, ty: number, id: number) {
    this.fields.set(key(tx, ty), { tx, ty, id, until: this.time + FIELDS[id].duration });
    // Landing on you (or a monster) counts as stepping in.
    if (tx === this.player.tx && ty === this.player.ty) this.stepIntoField(tx, ty);
    const m = this.monsterAt(tx, ty);
    if (m) this.monsterIntoField(m);
  }

  /** Would this tile's field hurt you (or monster m)? Spent fire fields and immune monsters are safe. */
  fieldHurts(tx: number, ty: number, m?: Monster) {
    const f = this.fields.get(key(tx, ty));
    if (!f) return false;
    const fd = FIELDS[f.id];
    return fd.ticks.length > 0 && (!m || (m.data.elements[fd.element] ?? 0) < 100);
  }

  /** MagicField::onStepInField: its condition starts with a tick right away, replacing the one you have
   *  (field conditions force the update). Standing in it does nothing more; stepping in again restarts it. */
  private stepIntoField(tx: number, ty: number) {
    const f = this.fields.get(key(tx, ty));
    if (!f) return;
    const fd = FIELDS[f.id];
    if (fd.ticks.length) this.conditions.set(fd.element, { ticks: [...fd.ticks], every: fd.every / 1000, next: this.time });
  }

  /** Fields decay (items.xml decayTo): a fire field cools down twice, then goes out. */
  private updateFields() {
    for (const [k, f] of this.fields) {
      if (this.time < f.until) continue;
      const next = FIELDS[f.id].decayTo;
      if (next && FIELDS[next]) {
        f.id = next;
        f.until += FIELDS[next].duration;
      } else this.fields.delete(k);
    }
  }

  /** monster.summon (Monster::onThinkDefense): while it's after you, each kind of summon rolls its chance
   *  every interval, up to its count and the monster's maxSummons. They appear next to it. */
  private monsterSummons(m: Monster, dt: number, d: number) {
    const list = m.data.summons;
    if (!list?.length || m.master !== undefined || d > 8) return;
    list.forEach((s, i) => {
      m.summonTimers[i] -= dt;
      if (m.summonTimers[i] > 0) return;
      m.summonTimers[i] += s.interval / 1000;
      const mine = this.monsters.filter((x) => !x.dead && x.master === m.id);
      if (mine.length >= m.data.maxSummons || mine.filter((x) => x.key === s.name).length >= s.count) return;
      if (s.chance < uniform(1, 100)) return;
      const spots = [...ORTHO, ...DIAG].map(([dx, dy]) => [m.tx + dx, m.ty + dy]).filter(([x, y]) => this.walkable(x, y));
      if (!spots.length) return;
      const [tx, ty] = spots[Math.floor(Math.random() * spots.length)];
      const sm = this.spawnMonster(s.name, false, [tx, ty]);
      if (!sm) return;
      sm.master = m.id;
      this.addEffect(13, m.x, m.y); // CONST_ME_MAGIC_BLUE on the summoner
      this.addEffect(11, sm.x, sm.y); // CONST_ME_TELEPORT where it appears
    });
  }

  /** Damage to the player, with Tibia's blocking: defense (melee), armor (physical), equipment absorb (elements). */
  /** Returns the damage that got through (before the magic shield), so a hit that lands can also poison. */
  private hurtPlayer(dmg: number, el: Element, m: Monster, melee: boolean): number {
    const ch = this.ch, p = this.player;
    const proc = (name: string) => Math.random() * 100 < ch.charmValue(name);
    // Dodge charm: the hit misses entirely.
    if (proc("Dodge")) {
      this.addEffect(3, p.x, p.y);
      this.msg("You dodged an attack. (dodge charm)", "#c9a0ff", "combat");
      return 0;
    }
    // Prey: less damage from the creature you prey on; a stance's damage received.
    dmg = Math.round(dmg * (1 - ch.preyBonus(m.key, "defense") / 100) * (ch.stance?.received ?? 100) / 100);
    if (el === "manadrain") {
      if (proc("Void Inversion")) {
        ch.mana = Math.min(ch.maxMana, ch.mana + dmg);
        this.addText(p.x, p.y - 40, `+${dmg}`, ELEMENT_COLORS.manadrain);
        return 0;
      }
      const v = Math.min(ch.mana, dmg);
      ch.mana -= v;
      if (v > 0) this.addText(p.x, p.y - 40, String(v), ELEMENT_COLORS.manadrain);
      return 0;
    }
    // Creature::blockHit, in Canary's order: absorb (equipment protection), then defense and armor,
    // then mitigation. Defense only works while a block is left: 2 at most, +1 per second, and every
    // physical hit uses one, so the more monsters hit you, the more hits get through unblocked.
    dmg = Math.round((dmg * (100 - ch.absorb(el))) / 100);
    // An amulet or ring that absorbed part of the hit uses a charge.
    for (const slot of ["necklace", "ring"] as const) {
      const wear = ch.wear[slot];
      if (wear && !wear.timed && ch.protects(slot, el) && --wear.left <= 0) this.wornOut(slot);
    }
    const sh = ch.shield, w = ch.weapon;
    if (el === "physical") {
      const hasBlock = this.blockCount > 0;
      if (hasBlock) this.blockCount--;
      // Blood Rage and Sharpshooter switch your shield defense off (CONDITION_PARAM_DISABLE_DEFENSE).
      const defValue = ch.stance?.noDefense ? 0 : sh ? (sh.defense ?? 0) + (w?.extradef ?? 0) : (w?.defense ?? 0) + (w?.extradef ?? 0);
      const defSkill = sh ? ch.skill(SKILL.shielding) : ch.skill(ch.weaponSkill);
      dmg = blockHit(dmg, playerDefense(defSkill, defValue, !!sh, ch.vd, this.defenseFactor()), ch.armor, melee && hasBlock, true);
      // Shielding trains when you defend with a shield (or a spellbook).
      if (melee && hasBlock && sh) this.advance(ch.train(SKILL.shielding));
    }
    if (dmg > 0 && el !== "lifedrain") dmg -= Math.floor((dmg * mitigation(ch.vd, ch.skill(SKILL.shielding), sh, w, FIGHT_MODES[this.fightMode].mitigation)) / 100);
    // Power-ups on top of the Tibia rules.
    if (ch.evolutions.has("avatarsteel")) dmg = Math.round(dmg * 0.7);
    if (dmg <= 0) {
      this.addEffect(melee ? 4 : 3, p.x, p.y); // blocked
      return 0;
    }
    this.loseHealth(dmg, el, `due to an attack by ${article(m.data.name)}`, m.data.name);
    // Defensive charms, after a hit that landed (Canary's IOBestiary::parseCharmCombat).
    if (proc("Parry")) {
      this.addEffect(5, m.x, m.y);
      this.damageMonster(m, dmg, "physical", false, { charm: true });
      this.msg(`You parried an attack. (parry charm)`, "#c9a0ff", "combat");
    }
    if (proc("Numb")) m.rootedUntil = this.time + 10;
    if (proc("Adrenaline Burst")) this.haste(speedChange(ch.baseSpeed, 2.5, 40, 2.5, 40), 10); // IOBestiary: (2.5, 40) for 10 s
    if (proc("Cleanse")) {
      const bad = [...this.conditions.keys()];
      if (ch.slowDelta) { ch.slowDelta = 0; this.paralyzedUntil = 0; }
      else if (bad.length) this.conditions.delete(bad[Math.floor(Math.random() * bad.length)]);
    }
    return dmg;
  }

  /** Damage that got past blocking: the magic shield takes what it can, the rest comes off your health. */
  private loseHealth(dmg: number, el: Element, why: string, source: string) {
    const ch = this.ch, p = this.player;
    this.stats.taken.set(source, (this.stats.taken.get(source) ?? 0) + dmg);
    this.stats.lastHits.push({ t: this.time, source, dmg, el });
    if (this.stats.lastHits.length > 6) this.stats.lastHits.shift();
    if (this.manaShield > 0 && this.time < this.manaShieldUntil) {
      const v = Math.min(dmg, ch.mana, this.manaShield);
      ch.mana -= v;
      this.manaShield -= v;
      dmg -= v;
      if (v > 0) this.addText(p.x + 10, p.y - 40, String(v), ELEMENT_COLORS.manadrain);
      if (dmg <= 0) return;
    }
    ch.hp -= dmg;
    p.hurt = 0.15;
    if (el === "physical") this.addEffect(1, p.x, p.y);
    this.addText(p.x, p.y - 40, String(dmg), ELEMENT_COLORS[el]);
    this.msg(`You lose ${dmg} hitpoint${dmg === 1 ? "" : "s"}${why ? ` ${why}` : ""}.`, "#bbb", "combat");
  }

  // ---------- conditions: damage over time on you ----------

  /** Get poisoned, burned, electrified... Canary's ConditionDamage: a total rolled from min-max, split into
   *  ticks that start at a twentieth of it and shrink to 1. A new one only replaces the current one of the
   *  same kind if it would do more damage than what's left. */
  private applyCondition(c: NonNullable<MonsterAttack["condition"]>) {
    const amount = uniform(c.min, c.max);
    if (amount <= 0) return;
    const cur = this.conditions.get(c.element);
    if (cur && cur.ticks.reduce((a, b) => a + b, 0) >= amount) return;
    // The first tick comes one interval after it starts.
    this.conditions.set(c.element, { ticks: damageList(amount, Math.max(1, Math.ceil(amount / 20))), every: c.tick / 1000, next: this.time + c.tick / 1000 });
  }

  private updateConditions() {
    for (const [el, c] of this.conditions) {
      while (c.ticks.length && this.time >= c.next) {
        c.next += c.every;
        // Ticks go through equipment protection only: no defense, armor or mitigation (combatBlockHit without them).
        const dmg = Math.round((c.ticks.shift()! * (100 - this.ch.absorb(el))) / 100);
        if (dmg > 0) this.loseHealth(dmg, el, "", CONDITION_NAMES[el] ?? el);
      }
      if (!c.ticks.length) this.conditions.delete(el);
    }
  }

  // ---------- player combat ----------

  /** Damage a monster: its armor where it applies, its elemental resistance, then its mitigation. Monster
   *  defense isn't used: Canary still applies it (a rat's defense of 5 cancels nearly every hit of a fresh
   *  character), but real Tibia's creatures only show armor and mitigation, and a new character kills rats.
   *  This is Canary with its disableMonsterArmor switch, keeping the armor. */
  damageMonster(m: Monster, dmg: number, el: Element, useArmor: boolean, from: { spell?: GradeBonus; charm?: boolean } = {}): number {
    if (m.dead) return 0;
    const ch = this.ch;
    // Prey: more damage to the creature you prey on; a stance's damage dealt (Protector: 65%).
    dmg = Math.round(dmg * (1 + ch.preyBonus(m.key, "damage") / 100) * (from.charm ? 100 : ch.stance?.dealt ?? 100) / 100);
    // Critical hits: a Strike imbuement makes your attacks critical-capable (10%); Low Blow adds chance,
    // Savage Blow and spell grades add damage. Charm damage itself never crits.
    const crit = ch.imbued("crit");
    const bloodRage = ch.evolutions.has("bloodrage");
    const critChance = from.charm ? 0 : Math.max(bloodRage ? 30 : 0, crit > 0 ? 10 : 0) + (crit > 0 || bloodRage ? ch.charmValue("Low Blow") : 0) + (from.spell?.critChance ?? 0);
    const critExtra = crit + ch.charmValue("Savage Blow") + (from.spell?.critDamage ?? 0);
    const isCrit = critChance > 0 && Math.random() * 100 < critChance;
    if (isCrit) dmg = Math.round(dmg * (1 + critExtra / 100));
    // Monster::blockHit: armor (Creature::blockHit), the element modifier, then mitigation (Creature::mitigateDamage).
    if (useArmor) dmg = blockHit(dmg, 0, m.data.armor, false, true);
    const pct = m.data.elements[el] ?? 0;
    dmg = Math.round((dmg * (100 - pct)) / 100);
    if (el !== "lifedrain" && el !== "manadrain") dmg = Math.round(dmg * (1 - mitigationOf(m.key) / 100));
    if (dmg <= 0) {
      this.addEffect(pct >= 100 ? 4 : 3, m.x, m.y);
      return 0;
    }
    const dealt = Math.min(dmg, m.hp);
    this.stats.dealt += dealt;
    m.hp -= dmg;
    if (el === "physical") this.addEffect(1, m.x, m.y);
    this.addText(m.x, m.y - 30, isCrit ? `${dealt}!` : String(dealt), isCrit ? "#ffd34d" : ELEMENT_COLORS[el]);
    // Leech: Vampirism / Void imbuements, Vampiric Embrace / Void's Call charms, and spell grades.
    const lifePct = from.charm ? 0 : ch.imbued("lifeLeech") + ch.charmValue("Vampiric Embrace") + (from.spell?.lifeLeech ?? 0);
    const manaPct = from.charm ? 0 : ch.imbued("manaLeech") + ch.charmValue("Void's Call") + (from.spell?.manaLeech ?? 0);
    const life = Math.floor((dealt * lifePct) / 100), mana = Math.floor((dealt * manaPct) / 100);
    if (life > 0) ch.hp = Math.min(ch.maxHp, ch.hp + life);
    if (isCrit && bloodRage) ch.hp = Math.min(ch.maxHp, ch.hp + dealt);
    if (mana > 0) ch.mana = Math.min(ch.maxMana, ch.mana + mana);
    if (m.hp <= 0) this.killMonster(m);
    return dealt;
  }

  /** Offensive charms, rolled once per hit of yours on a creature (Canary's IOBestiary::parseOffensiveCharmCombat). */
  private charmProcs(m: Monster) {
    const ch = this.ch;
    for (const [name] of ch.charms) {
      if (m.dead || Math.random() * 100 >= ch.charmValue(name)) continue;
      const c = charm(name);
      let dmg = 0, el: Element = "physical";
      if (c.element && c.percent && name !== "Parry") { dmg = Math.min(ch.level * 2, Math.ceil(m.maxHp * c.percent / 100)); el = c.element; }
      else if (name === "Overpower") dmg = Math.min(Math.ceil(m.maxHp * 0.08), Math.ceil(ch.maxHp * 0.05));
      else if (name === "Overflux") dmg = Math.min(Math.ceil(m.maxHp * 0.08), Math.ceil(ch.maxMana * 0.025));
      else if (name === "Cripple") { m.rootedUntil = this.time + 10; this.msg(`You crippled ${article(m.data.name)}. (cripple charm)`, "#c9a0ff", "combat"); continue; }
      else if (name === "Fatal Hold") { m.holdUntil = this.time + 30; continue; }
      else continue;
      this.addEffect(CHARM_EFFECT[el] ?? 10, m.x, m.y);
      this.damageMonster(m, dmg, el, false, { charm: true });
      this.msg(`${cap(article(m.data.name))} loses ${dmg} hitpoints. (${name.toLowerCase()} charm)`, "#c9a0ff", "combat");
    }
  }

  private killMonster(m: Monster) {
    m.dead = true;
    this.occupied.delete(key(m.tx, m.ty));
    // Its summons die with it (Monster::death).
    for (const s of this.monsters) {
      if (s.master === m.id && !s.dead) {
        s.dead = true;
        this.occupied.delete(key(s.tx, s.ty));
        this.addEffect(3, s.x, s.y);
      }
    }
    // A summon is worth nothing: no experience, souls or bestiary, and no corpse to loot (Canary sets
    // skillLoss and lootDrop off on summons).
    if (m.master !== undefined) {
      this.addEffect(3, m.x, m.y);
      return;
    }
    this.kills++;
    this.lastKill = this.time;

    // Souls for the meta progression, and kill counts per zone for its bosses.
    this.addSouls(soulsFor(m.data.experience, m.boss), "kills");
    const mz = zoneAt(m.tx, m.ty);
    this.zoneKills[mz] = (this.zoneKills[mz] ?? 0) + 1;
    // The first kill ever in a zone, of a creature that lives there, pays its exploration souls (once per
    // account, so rushing outward pays nothing, and neither does killing a rat that followed you out).
    const native = ZONES[mz].pool.includes(m.key) || ZONES[mz].bosses.includes(m.key);
    if (mz > 0 && native && !this.discovered.has(mz)) {
      this.discovered.add(mz);
      const found = SOULS_PER_ZONE * (mz + 1);
      this.addSouls(found, "zones");
      this.banner = { text: `${ZONES[mz].name} discovered! +${found} souls`, t: 3 };
      this.msg(`Your first kill in ${ZONES[mz].name}: +${found} souls.`, "#c9a0ff");
    }
    // Achievements: kills of a creature over all your runs; milestones pay souls.
    const total = (this.killTotals[m.key] ?? 0) + 1;
    this.killTotals[m.key] = total;
    const ach = achievement(m.key, total);
    if (ach) {
      this.addSouls(ach.souls, "achievements");
      this.banner = { text: `Achievement: ${ach.title}! +${ach.souls} souls`, t: 3.5 };
      this.msg(`Achievement unlocked: ${ach.title} (${ach.count} ${m.data.name} kills). +${ach.souls} souls.`, "#c9a0ff");
    }
    // Bestiary: kill counts per creature unlock stages, each worth a choice.
    const seen = (this.bestiary.get(m.data.name) ?? 0) + 1;
    this.bestiary.set(m.data.name, seen);
    const stage = BESTIARY_STAGES.indexOf(seen);
    if (stage >= 0) {
      this.msg(`Bestiary: you unlocked stage ${stage + 1} of the ${m.data.name.toLowerCase()} entry.`, "#80c0ff");
      this.events.push({ type: "charm", creature: m.data.name, stage: stage + 1 });
    }
    this.occupied.delete(key(m.tx, m.ty));
    this.addEffect(3, m.x, m.y);
    // Carnage charm: the kill hits the creatures next to it.
    if (Math.random() * 100 < this.ch.charmValue("Carnage")) {
      const dmg = Math.min(Math.ceil(m.maxHp * 0.15), this.ch.level * 6);
      for (const [dx, dy] of ORTHO) {
        const o = this.monsterAt(m.tx + dx, m.ty + dy);
        this.addEffect(1, tileCenter(m.tx + dx), tileCenter(m.ty + dy));
        if (o && !o.dead) this.damageMonster(o, dmg, "physical", false, { charm: true });
      }
    }
    const { gained, amount, learned } = this.ch.addExp(m.data.experience * (1 + this.ch.preyBonus(m.key, "xp") / 100));
    for (const s of learned) this.msg(`You learned ${s.name} (${s.words}).`, "#80c0ff");
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
      const chance = (l.chance / 100000) * (coins ? 1 : this.ch.rate("loot") * this.ch.runRate("loot") * (1 + this.ch.preyBonus(m.key, "loot") / 100));
      const drops = Math.floor(chance) + (Math.random() < chance % 1 ? 1 : 0);
      if (!drops) continue;
      // Each drop is 1..max of the item; many drops are summed rather than rolled one by one.
      let n = drops <= 20 ? Array.from({ length: drops }, () => (l.max > 1 ? uniform(1, l.max) : 1)).reduce((a, b) => a + b, 0)
        : Math.round((drops * (1 + l.max)) / 2);
      if (coins) n = Math.max(1, Math.round(n * this.ch.rate("gold") * this.ch.runRate("gold")));
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
      if (!c.looted && this.time >= (c.nextTry ?? 0) && cheb(c.tx, c.ty, p.tx, p.ty) <= (this.ch.evolutions.has("goldpouch") ? 3 : 1)) {
        c.nextTry = this.time + 1; // what didn't fit is tried again (after selling, say)
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
    // Capacity: coins go to your gold and Gold Pouch sells on the spot, but anything you keep must fit; what
    // doesn't stays in the corpse (and junk always does).
    const left: Corpse["loot"] = [];
    let tooHeavy = false;
    const keep = c.loot.filter((l) => {
      if (ch.isJunk(l.id)) { left.push(l); return false; }
      const coins = l.id === 3031 || l.id === 3035 || l.id === 3043;
      const sold = ch.evolutions.has("goldpouch") && !POTIONS[l.id] && !SPELLS.some((s) => s.runeId === l.id) && !ch.slotFor(item(l.id)!);
      if (coins || sold) return true;
      const fit = Math.min(l.n, ch.fits(l.id));
      if (fit < l.n) { tooHeavy = true; left.push({ id: l.id, n: l.n - fit }); }
      l.n = fit;
      return fit > 0;
    });
    c.loot = left;
    c.looted = !left.some((l) => !ch.isJunk(l.id));
    if (tooHeavy && !c.opened) this.msg("You do not have enough capacity to carry everything.", "#ff9c30", "loot");
    if (!keep.length && c.opened) return;
    c.opened = true;
    keep.forEach(({ id: lid, n }, i) => {
      const l = { id: lid };
      const it = item(lid)!;
      got.push(n > 1 ? `${n} ${it.name}s` : `${/^[aeiou]/.test(it.name) ? "an" : "a"} ${it.name}`);
      const coins = l.id === 3031 || l.id === 3035 || l.id === 3043;
      let equipped = false, to: LootDest = coins ? "gold" : "bag";
      if (l.id === 3031) ch.gold += n;
      else if (l.id === 3035) ch.gold += n * 100;
      else if (l.id === 3043) ch.gold += n * 10000;
      else if (POTIONS[l.id] || SPELLS.some((s) => s.runeId === l.id) || l.id === ch.equipment.ammo || l.id === ch.thrown) {
        ch.supplies.set(l.id, (ch.supplies.get(l.id) ?? 0) + n);
        to = "supplies";
      } else if (ch.offer(l.id)) {
        if (n > 1) ch.stash(l.id, n - 1);
        equipped = true;
        to = "worn";
        this.msg(`You equip ${it.name}.`, "#80ff80", "loot");
      } else if (ch.evolutions.has("goldpouch")) {
        ch.gold += (PRICES[l.id]?.sell ?? 0) * n;
        to = "gold";
      } else ch.stash(l.id, n);
      // Flair: every item hops out of the body and flies to where it went; rare ones get a fanfare.
      const rare = !coins && (equipped || (PRICES[l.id]?.sell ?? 0) >= RARE_VALUE);
      const value = (PRICES[l.id]?.sell ?? 0) * n;
      if (!coins && value > (this.stats.bestLoot?.value ?? 0)) this.stats.bestLoot = { id: l.id, n, value };
      this.lootFx.push({ id: l.id, n, x: cx, y: cy, t: 0, delay: i * 0.08, to, rare });
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
      this.damageMonster(m, normalRandom(w!.fromdamage ?? 0, w!.todamage ?? 0), (w!.wandtype as Element) ?? "energy", false);
    } else if (t === "missile") {
      // Spears, throwing stars...: distance fighting with the weapon's own attack and hit chance. A throw that
      // breaks it (its breakchance) uses one up; the others you pick up again.
      const id = ch.thrown!, left = ch.supplies.get(id) ?? 0;
      if (left <= 0) { ch.outOfThrown(); return false; }
      this.addMissile(missileFor(w!.shoottype), p.x, p.y, m.x, m.y);
      this.advance(ch.train(SKILL.distance));
      if (Math.random() * 100 < distanceHitChance(w!.maxhitchance)) {
        this.weaponHit(m, distanceDamage(ch.level, ch.skill(SKILL.distance), ch.attackValue, ch.vd, af));
      } else this.addEffect(3, m.x, m.y);
      if (Math.random() * 100 < Number(w!.breakchance ?? 0)) {
        ch.supplies.set(id, left - 1);
        if (left - 1 <= 0) {
          this.msg(`Your last ${w!.name} broke.`, "#ff9c30");
          ch.outOfThrown();
        }
      }
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
      this.damageMonster(m, part, d.element!, false);
      if (this.ch.evolutions.has("elementalburst")) {
        for (const [dx, dy] of [...ORTHO, ...DIAG]) {
          const o = this.monsterAt(m.tx + dx, m.ty + dy);
          if (o && o !== m) {
            this.addEffect(d.effect, o.x, o.y);
            this.damageMonster(o, part, d.element!, false);
          }
        }
      }
    }
    if (physical > 0) this.damageMonster(m, physical, "physical", true);
    this.charmProcs(m);
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
    return Math.max(0, Math.ceil((s.mana ?? 0) * (this.ch.evolutions.has("mastermind") ? 0.5 : 1)) - (this.ch.gradeBonus(s).manaCost ?? 0));
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
    // The spell's Wheel grade: more damage or healing, a shorter cooldown, crits and leech.
    const grade = ch.gradeBonus(s);
    const k = 1 + ((s.group === "healing" ? grade.heal : grade.damage) ?? 0) / 100;
    const [lo, hi] = spellFormula(s)(ch.level, ch.ml, ch.skill(ch.weaponSkill), attack).map((v) => v * k);
    if (s.kind === "rune") ch.supplies.set(s.runeId!, (ch.supplies.get(s.runeId!) ?? 0) - 1);
    else if (s.mana) this.advance(ch.spendMana(this.manaCost(s)));
    const mm = ch.evolutions.has("mastermind") ? 0.7 : 1;
    this.spellReady.set(s.file, this.time + Math.max(1, ((s.cooldown ?? 2000) / 1000) * mm - (grade.cooldown ?? 0)));
    const group = s.group;
    this.groupReady[group] = this.time + (s.groupCooldown ?? 2000) / 1000;
    if (s.words) this.addText(p.x, p.y - 62, s.words, "#f0e060");

    const sup = SUPPORT[s.file];
    if (sup) {
      this.support(s, sup);
      return;
    }
    if (s.file === "magic_shield") {
      // Canary: 300 + 7.6 * level + 7 * magic level, at most max mana, for 180 s.
      this.manaShield = this.manaShieldMax = Math.floor(Math.min(ch.maxMana, 300 + 7.6 * ch.level + 7 * ch.ml));
      this.manaShieldUntil = this.time + 180;
      this.addEffect(s.effect || 13, p.x, p.y);
      return;
    }
    if (s.group === "healing") {
      const healed = Math.min(normalRandom(Math.floor(lo), Math.floor(hi)), ch.maxHp - ch.hp);
      this.stats.healed += healed;
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
      if (!m) continue;
      this.damageMonster(m, normalRandom(Math.floor(lo), Math.floor(hi)), s.element, s.blockArmor, { spell: grade });
      this.charmProcs(m);
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
      this.stats.healed += v;
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
    case "bonus": return `${runBonus(c.id).name} +${(ch.runBonuses.get(c.id) ?? 0) * RUN_BONUS_STEP}% this run`;
    case "imbue": return `${TIERS[(ch.imbuements.get(c.id) ?? 1) - 1]} ${imbuementDef(c.id).name}`;
    case "train": return c.skill === "magic" ? "+1 magic level" : "+1 skill";
    case "supply": return `${c.n} ${item(c.id)!.name}s`;
    case "gold": return `${c.n} gold`;
    case "grade": return `${c.spell.name} grade ${["", "I", "II", "III"][ch.grades.get(c.spell.file) ?? 0]}`;
    case "charm": return `${c.name} ${CHARM_TIERS[ch.charms.get(c.name) ?? 0]}`;
    case "prey": return `prey: ${describePrey(c.prey)}`;
  }
}
