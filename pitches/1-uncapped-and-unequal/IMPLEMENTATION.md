# Uncapped & Unequal: implementation

The engineering behind the pitch in [index.html](index.html). By Mira Halvorsen.

The short version: every pick becomes a **line** with **ranks**. Ranks 1–3 (or 1–5 for run bonuses) are today's values. Past that **knee**, one harmonic curve takes over. Every card is +1 rank, and rarity adds **layers**: Rare a secondary, Epic a perk, Legendary a relic. All sources of a stat pool into one cached total with one rail.

Contents

1. [Baseline: what the sim says today](#1-baseline-what-the-sim-says-today)
2. [The curve](#2-the-curve)
3. [Data model](#3-data-model)
4. [File-by-file changes](#4-file-by-file-changes)
5. [Combat hooks (game.ts, autocast.ts)](#5-combat-hooks-gamets-autocastts)
6. [Full line, affix and relic tables](#6-full-line-affix-and-relic-tables)
7. [UI changes](#7-ui-changes)
8. [Save migration](#8-save-migration)
9. [Balancing plan](#9-balancing-plan)
10. [Phased rollout](#10-phased-rollout)
11. [Open questions](#11-open-questions)

---

## 1. Baseline: what the sim says today

`npm run sim` from a fresh campaign never leaves Rookgaard at level 1 within its budget (2 runs, 0 souls), so it can't show the late-game card pool. I wrote a probe outside the repo that bundles `src/sim.ts` with esbuild, gives the run a mid-campaign save (Dawnport, Rookgaard gear, boosts XP 6, gold/loot 3, training 5, luck 2, haste 3), and wraps three `Character.prototype` methods:

- `rollChoices`: counts offers, cards and fillers (`train`, `supply`, `gold`) in buckets of 25 offers per run;
- `withRarity`: rolls the rarity itself, passes it in, and compares it with the rarity that comes back, which counts `fitRarity` downgrades;
- `applyChoice`: counts picks by kind.

It uses the existing sim bot (`src/sim.ts`: spells first, then run bonuses by rank, then the first card offered; the first charm offered). Each vocation got 3 runs of 3,600 s.

| | Knight | Paladin | Sorcerer | Druid |
|---|---|---|---|---|
| Levels reached | 29, 13 (died), 28 | 27, 19, 25 | 43, 36, 14 | 26, 30, 21 (died) |
| Offers (3 runs) | 143 | 223 | 181 | 179 |
| Filler share, offers 1–25 | 0% | 0% | 0% | 0% |
| Filler share, offers 26–50 | 32.2% | 28.5% | 1.7% | 7.9% |
| Filler share, offers 51–75 | **87.5%** | **77.5%** | 18.3% | **46.2%** |
| Rare+ rolls downgraded by `fitRarity` | 13.3% | 11.7% | 27.7% | 20.5% |
| Legendary rolled / kept | 14 / 3 | 23 / 14 | 31 / 13 | 24 / 5 |
| Prey picks | 17 | **72** | 42 | 29 |

The end states make the point. Sorcerer run 1, level 43: 6 imbuements at Powerful, 13/13 grades maxed, 20 of 22 charms at III, run bonuses 5/5 x4, run luck 50. Knight run 1, level 29: 6 Powerful imbuements, 3/3 grades, every run bonus 5/5, luck 50.

The pool is small by construction. A knight at level 20 has 18 imbuement tier steps (6 slots x 3) + 20 run-bonus picks + 10 luck steps + 6 grade steps = **54 steps**, about 39 cards at the mean rarity multiplier (0.70·1 + 0.22·2 + 0.07·3 + 0.01·5 = 1.40). Mages last longer only because they know more gradable spells (sorcerer: 25 grade steps at level 20, 55 at level 100).

Probe source: see [Appendix A](#appendix-a-the-probe). It's not committed: it lives in a temp folder and is reproduced here so the balancing phase can rebuild it as `tools/probe.ts`.

---

## 2. The curve

### 2.1 One formula

```
value(r) = table[r]                                   for r <= K   (Tibia's real values)
value(r) = table[K] + s * K * (H(r) - H(K))           for r >  K
           then min(value, rail) if the line has a rail
H(n)     = 1 + 1/2 + ... + 1/n
```

The increment of rank r > K is `s * K / r`: rank K+1 adds `s·K/(K+1)`, rank 2K adds `s/2`, rank 3K adds `s/3`. The sum grows like `s·K·ln(r/K)`. It's unbounded, so there's no wall, but it's slow: rank 20 on a K = 3 line is worth `3·(H20 − H3) = 5.29` tail steps, not 17.

Constants for K = 3, so you can check the tables:

| r | 4 | 5 | 6 | 7 | 8 | 10 | 12 | 15 | 20 | 30 |
|---|---|---|---|---|---|---|---|---|---|---|
| 3·(H(r) − H(3)) | 0.750 | 1.350 | 1.850 | 2.279 | 2.654 | 3.288 | 3.810 | 4.455 | 5.293 | 6.485 |

### 2.2 Worked examples

**Vampirism** (`table = [5, 10, 25]`, K = 3, s = 4, rail 50):

| r | 3 | 4 | 5 | 6 | 8 | 10 | 15 | 20 |
|---|---|---|---|---|---|---|---|---|
| life leech % | 25 | 25 + 4·0.75 = **28.0** | 30.4 | 32.4 | 35.6 | 38.2 | 42.8 | 46.2 |

**Run bonus Experience** (`table = [20, 40, 60, 80, 100]`, K = 5, s = 20, no rail). For K = 5, `5·(H(r) − H(5))`: r6 0.833, r8 1.746, r10 3.234, r15 5.175, r20 6.572.

| r | 5 | 6 | 8 | 10 | 15 | 20 |
|---|---|---|---|---|---|---|
| bonus % | 100 | 116.7 | 143.5 | 164.6 | 203.5 | 231.4 |

(r8: 5·(H8 − H5) = 5·(2.7179 − 2.2833) = 2.173, x20 = 43.5, so 143.5%.)

**Skill lines** (Slash, Chop, Bash, Precision, Blockade, Epiphany: `[1, 2, 4]`, K = 3, s = 2): the value is floored because skills are integers in `meleeDamage` and `spellFormula`. r4 = floor(5.5) = 5, r6 = floor(7.7) = 7, r10 = floor(10.58) = 10, r20 = floor(14.59) = 14.

**Prey stars** (K = 10, s = 1 star): effective stars `10 + 10·(H(n) − H(10))`. 11 stars → 10.91, 15 → 13.89, 20 → 16.69. Damage prey (2·stars + 5): 11★ 26.8%, 15★ 32.8%, 20★ 38.4%.

**Luck** (run luck, K = 10 steps of 5, s = 5): r11 54.5, r15 70.1, r20 83.4. Total luck (boost + run + Fortune) rails at 150. At 150, `rarityOdds` would give Common 31.8%, Rare 40.0%, Epic 22.3%, Legendary 5.9%: too generous, so the rail applies only to the rarity weights' luck input, which is capped at 100 as today. Luck above 100 only feeds the 4th card (still `luck/200`, capped at 0.5) and Fortune's own perks. That keeps Legendary at most 5%.

### 2.3 Rails

Rails are hard clamps on **pooled totals**, set high enough that a single line needs ~20 ranks to reach them:

| Stat | Rail | Why |
|---|---|---|
| Life leech | 50% | Above that you never drop under half health in a pack |
| Mana leech | 25% | Mages would never drink |
| Crit chance | 50% | Blood Rage's 30% + Low Blow + perks |
| Dodge / Parry (each) | 30% | Untouchable otherwise |
| Element protection (imbuement + gear) | 50% | `Character.absorb` already clamps at 100 |
| Spell cooldown reduction (Swiftcast) | 35% | Group cooldowns (2 s) still apply |
| Perk chances | 35% | Procs stay procs |
| Avatar of Steel | 45% | Evolution scaling |

---

## 3. Data model

### 3.1 New file `src/curves.ts`

```ts
export interface Curve {
  table: number[];   // real values for ranks 1..K (K = table.length)
  tail: number;      // s: step per rank past the knee, before the K/r falloff
  rail?: number;     // clamp on the pooled total, not the line
  int?: boolean;     // floor the result (skills, magic level)
}

const H = (n: number) => { let s = 0; for (let i = 1; i <= n; i++) s += 1 / i; return s; };
const HCACHE = Array.from({ length: 201 }, (_, i) => H(i));
const h = (n: number) => (n <= 200 ? HCACHE[n] : Math.log(n) + 0.5772156649 + 1 / (2 * n));

export function rankValue(c: Curve, r: number): number {
  if (r <= 0) return 0;
  const K = c.table.length;
  const v = r <= K ? c.table[r - 1] : c.table[K - 1] + c.tail * K * (h(r) - h(K));
  return c.int ? Math.floor(v) : v;
}

/** What the next rank adds, for card text ("25% → 28%"). */
export const nextGain = (c: Curve, r: number) => rankValue(c, r + 1) - rankValue(c, r);
```

### 3.2 New file `src/lines.ts`: one registry for everything with ranks

```ts
import type { Curve } from "./curves";
import type { VocationId } from "./tibia/db";

export type StatKey =
  | "lifeLeech" | "manaLeech" | "critChance" | "critDamage" | "dodge" | "parry"
  | "maxHpPct" | "maxManaPct" | "weaponDmgPct" | "spellDmgPct" | "cooldownPct" | "healRecvPct"
  | "potionPct" | "armor" | "speed" | "luck";

export type LineKind = "imbue" | "charm" | "grade" | "bonus" | "luck" | "prey" | "train" | "secondary" | "perk";
export type Socket = "weapon" | "armor" | "helmet" | "boots" | "offhand";
export type VocTag = "melee" | "distance" | "magic" | "healer" | "shield";

export type SecondaryId = "vitality" | "focus" | "battlefocus" | "arcanefocus" | "swiftcast" | "mending"
  | "alchemy" | "hardening" | "fleetness" | "fortune";
export type PerkId = "combatmastery" | "battleinstinct" | "executioner" | "ballistic" | "positional" | "divineemp"
  | "focusmastery" | "beammastery" | "runicmastery" | "twinbursts" | "grove" | "bloodlust" | "secondwind";
export type RelicId = "thunderhammer" | "stonecutter" | "warlord" | "demonbone" | "arbalest" | "hornbow" | "royalxbow"
  | "elvishbow" | "starstorm" | "inferno" | "ferumbras" | "voodoo" | "hailstorm" | "northwind" | "springsprout" | "muck"
  | "twistoffate" | "phoenix" | "suns" | "shielding" | "embrace" | "solitude" | "bloodmountain" | "heartmountain";

/** A line: anything you can hold ranks in. Ids are namespaced: "imbue:vampirism", "charm:Wound",
 *  "grade:great_energy_beam", "bonus:xp", "luck", "prey:dragon", "sec:vitality", "perk:focusmastery". */
export type LineId = `${LineKind}:${string}` | "luck";

export interface LineDef {
  id: LineId;
  kind: LineKind;
  name: string;
  curve: Curve;
  stat?: StatKey;            // pooled stat this line feeds, if any
  sockets?: Socket[];        // imbuements: where it fits
  major?: boolean;           // charms
  tags?: VocTag[];           // who may be offered it (empty = everyone)
  affinity: { secondary: SecondaryId[]; perk: PerkId[]; relic: RelicId[] };
}

export interface RelicDef {
  id: RelicId; name: string; icon: number; tags?: VocTag[];
  desc: (rank: number) => string;          // relics have ranks too (awakening)
  starter: boolean;                        // in the pool without the Relic Codex
}
```

Imbuement and charm lines are generated from `IMBUEMENTS` and `CHARM_LIST`, so the real values stay in one place: `curve.table` is `d.values` / `c.chance`.

### 3.3 Cards: extend `LevelChoice`, don't replace it

`character.ts` keeps its union (the UI and sim switch on `kind`), with layers added to the shared tail:

```ts
export interface Affix { line: LineId; ranks: number }   // secondaries and perks

export type LevelChoice = (
  | { kind: "spell"; spell: SpellData }
  | { kind: "imbue"; id: string; socket: Socket }        // socket chosen when offered
  | { kind: "boost"; id: BoostId }
  | { kind: "bonus"; id: RunBonusId }
  | { kind: "train"; skill: number | "magic" }
  | { kind: "grade"; spell: SpellData }
  | { kind: "charm"; name: string }
  | { kind: "prey"; prey: Prey }                          // stars: +1 on a held prey, else rolled
  | { kind: "luck"; n: number }
  // removed: "supply", "gold" (the Skip button pays gold)
) & {
  rarity?: Rarity;
  extras?: Affix[];          // Rare: 1 secondary; Epic and Legendary: + 1 perk (Epic only)
  relic?: RelicId;           // Legendary: a new relic, or an owned one to awaken
};
```

### 3.4 Character state

```ts
// character.ts, class Character
ranks = new Map<LineId, number>();            // the source of truth for every line
sockets = new Map<Socket, string[]>();        // socket -> imbuement ids (weapon holds 2)
charmSlots = { major: [] as string[], minor: [] as string[] };
relics = new Map<RelicId, number>();          // relic -> rank (1 + awakenings)
banished = new Set<LineId>();
private statCache: Partial<Record<StatKey, number>> | null = null;  // cleared in applyChoice

// Kept as views so existing callers keep working during the migration:
get imbuements(): Map<string, number>   // ids -> rank, from ranks "imbue:*"
get charms(): Map<string, number>       // names -> rank, from ranks "charm:*"
get grades(): Map<string, number>       // files -> rank, from ranks "grade:*"
```

`imbuements`, `charms` and `grades` are fields today (`character.ts` lines 50, 58, 59). Turning them into read-only getters over `ranks` keeps `evolutions.ts`, `hud.ts` and the sim compiling in phase 1; writers (`applyChoice`, `setVocation`) move to `ranks`.

### 3.5 Constants

```ts
// upgrades.ts
export const SOCKETS: Record<Socket, number> = { weapon: 2, armor: 1, helmet: 1, boots: 1, offhand: 1 };
export const CHARM_SLOTS = { major: 3, minor: 3 };     // 4 + 4 with Charm Expansion
export const RELIC_SLOTS = 3;
export const SKIP_GOLD = 75;                            // x level
// MAX_SLOTS, RUN_BONUS_MAX stay as the knees: RUN_BONUS_MAX = curve K of run bonuses.

// rarity.ts
export interface RarityDef { name: string; weight: number; layers: ("secondary" | "perk" | "relic")[] }
export const RARITIES: RarityDef[] = [
  { name: "Common", weight: 70, layers: [] },
  { name: "Rare", weight: 22, layers: ["secondary"] },
  { name: "Epic", weight: 7, layers: ["secondary", "perk"] },
  { name: "Legendary", weight: 1, layers: ["secondary", "relic"] },
];
// rarityMult is deleted, and so is fitRarity. PREY_STARS stays for new prey only.
```

---

## 4. File-by-file changes

### `src/rarity.ts`
- `RARITIES`: `mult` becomes `layers` (above). Weights and `LUCK_SCALE` unchanged.
- `weights(luck)`: clamp the luck input at 100 (see 2.2).
- Delete `rarityMult`, `fitRarity`. `rollRarity`, `rarityOdds`, `extraCardChance` unchanged.
- `RUN_LUCK_MAX` becomes the luck line's knee (10 steps), not a cap.

### `src/curves.ts` (new), `src/lines.ts` (new), `src/affixes.ts` (new)
- `curves.ts`: section 3.1.
- `lines.ts`: `LINES: LineDef[]` built from `IMBUEMENTS`, `CHARM_LIST`, `RUN_BONUSES`, plus static secondaries and perks (section 6); `line(id)`, `linesFor(voc, weaponSkill)`.
- `affixes.ts`: `SECONDARIES`, `PERKS`, `RELICS` tables, and `rollExtras(ch, c, rarity): { extras, relic }`:

```ts
export function rollExtras(ch: Character, c: LevelChoice, rarity: Rarity) {
  const def = lineOf(c), layers = RARITIES[rarity].layers, extras: Affix[] = [];
  const ok = (tags?: VocTag[]) => !tags?.length || tags.some((t) => ch.tags.has(t));
  if (layers.includes("secondary")) {
    const pool = def.affinity.secondary.filter((id) => ok(SECONDARIES[id].tags));
    if (pool.length) extras.push({ line: `secondary:${pick(pool)}`, ranks: 1 });
  }
  if (layers.includes("perk")) {
    const pool = def.affinity.perk.filter((id) => ok(PERKS[id].tags));
    if (pool.length) extras.push({ line: `perk:${pick(pool)}`, ranks: 1 });
  }
  let relic: RelicId | undefined;
  if (layers.includes("relic")) {
    const free = def.affinity.relic.filter((id) => ok(RELICS[id].tags) && !ch.relics.has(id) && ch.relicPool.has(id));
    relic = ch.relics.size < RELIC_SLOTS && free.length ? pick(free) : pick([...ch.relics.keys()]); // awaken
  }
  return { extras, relic };
}
```

If a line's affinity pool is empty for the vocation, the layer falls back to the vocation's generic list (`GENERIC_SECONDARY[voc]`, `GENERIC_PERK[voc]`), so a Rare card always has its Rare layer.

### `src/character.ts`
- **`rollChoices`** (line 156):
  - `full = slotsUsed >= MAX_SLOTS` becomes per socket: an imbuement is offered if you hold it (any rank) or some socket in `line.sockets` has room. The card carries the chosen socket (the first free one, weapon before helmet).
  - Grades: drop the `< spellGrades(s).grades.length` filter; every known instant spell with grades is offerable forever.
  - Run bonuses: drop `< RUN_BONUS_MAX`. Luck: drop `runLuck < RUN_LUCK_MAX`.
  - Prey: also offer a held prey (+1 star) with weight 1, a new creature with weight 2.
  - Lines in `banished` are filtered out. Once sockets are full, held lines get weight x2.
  - Fillers: only `trainChoice()` stays as the guaranteed filler; `supplyChoice()` and the gold card are deleted (potions stay in the shop; the Skip button pays gold).
  - Slot quotas stay (2 imbuements, 2 grades, 1 prey, 2 run bonuses, 1 luck) so a screen keeps its variety.
- **`withRarity`** (line 187): no `fitRarity`. Returns `{ ...c, rarity, ...rollExtras(this, c, rarity) }`. Prey keeps `PREY_STARS` for new creatures; on a held prey it's +1 star and the rarity layers apply (Rare: second bonus type; Epic: hunting-ground spread; Legendary: wildcard).
- **`room`** (line 199): deleted.
- **`charmChoices`** (line 211): drop the `< 3` filter; respect `charmSlots`: once Major is full, Major charms you don't hold are filtered out (same for Minor).
- **`charmValue`** (line 217): `rankValue(line("charm:" + name).curve, rank)`.
- **`gradeBonus`** (line 223): ranks <= grades.length use `spellGrades(s).grades[r-1]`; past that, add the tail to the grade's main key: `damage` or `heal` gets `s = 3` per supreme rank (K = number of grades). Other keys (cooldown, crit) stay at the last grade.
- **`preyBonus`** (line 229): `preyPercent` with effective stars from the curve (section 2.2), and the wildcard / hunting-ground scopes:

```ts
preyBonus(creature: string, bonus: PreyBonus) {
  let best = 0;
  for (const p of this.prey) {
    const hits = p.scope === "zone" ? this.preyPool.includes(creature)
      : p.scope === "hunt" ? huntOf(p.creature)?.pool.includes(creature) : p.creature === creature;
    if (hits && (p.bonus === bonus || p.bonus2 === bonus)) best = Math.max(best, preyPercent({ bonus, stars: effStars(p.stars) }));
  }
  return best;
}
```

- **`runRate`** (line 132): `1 + rankValue(BONUS_CURVE, ranks) / 100`.
- **`luck`** (line 134): `luckBonus(boost) + rankValue(LUCK_CURVE, runLuckRanks) + stat("luck")`.
- **`imbued`** (line 145): `d.values[tier - 1]` becomes `rankValue(line("imbue:" + id).curve, rank)`. That one change makes every existing caller (speed, skill, ml, absorb, crit) uncapped.
- **`applyChoice`** (line 257): `k = Character.steps(c)` goes away; every card is +1 rank of its line, then `extras` (+1 rank each), then `relic` (add at rank 1 or +1). Clears `statCache`. For imbuements, pushes the id into its socket the first time.
- **`stat(key)`** (new): pooled and cached:

```ts
stat(key: StatKey): number {
  this.statCache ??= {};
  if (this.statCache[key] !== undefined) return this.statCache[key]!;
  let v = 0;
  for (const [id, r] of this.ranks) { const d = line(id); if (d.stat === key && this.lineActive(d)) v += rankValue(d.curve, r); }
  v += EVOLUTION_STAT[key]?.(this) ?? 0;          // Blood Rage's 30% crit chance etc.
  return (this.statCache[key] = Math.min(v, RAILS[key] ?? Infinity));
}
```

  `lineActive` returns false for the off-hand socket while a two-handed weapon is equipped, and for charms beyond the slot count (can't happen through cards, only through a lost Charm Expansion; kept for safety). The spell's own grade leech or crit isn't pooled in the cache because it depends on the cast; `damageMonster` adds it and clamps again (section 5).
- **`maxHp` / `maxMana`** (line 76): multiply by `1 + stat("maxHpPct") / 100` (Vitality, Heart of the Mountain).
- **`armor`** (getter, ~line 287): `+ stat("armor")` (Hardening).
- **`speed`** (line 94): `+ stat("speed")` (Fleetness).
- **`setVocation`** (line ~447, "upgrades the new class can't use are dropped"): drops ranks of lines whose `tags` exclude the new vocation, as it drops imbuements today.
- **`slotsUsed`** (line 135): becomes `socketsUsed()`, returning `{ used, total }` (total drops by 1 with a two-handed weapon).
- **`imbuementOptions`** (line ~280): socket-aware (above); the "one elemental damage imbuement" rule stays.

### `src/picks.ts`
- `spellGrades` unchanged (the real Wheel data).
- New `gradeAt(s, rank): GradeBonus` with the supreme tail; `Character.gradeBonus` calls it.
- `describeCharm(name, tier)` takes a value instead of a tier index: `c.chance[tier - 1]` becomes `charmValueAt(name, rank)`.
- `CHARM_TIERS` (`["", "I", "II", "III"]`): extended by a formatter, `charmTierLabel(r)`: I, II, III, then III+1, III+2...
- `Prey` gets `bonus2?: PreyBonus; scope?: "creature" | "hunt" | "zone"`.

### `src/tibia/imbuements.ts`
- Each `ImbuementDef` gains `sockets: Socket[]`, `tail: number`, `rail?: number`. `values` stays the knee table. `TIERS` gains a label function: Basic, Intricate, Powerful, Powerful +1...

| id | sockets | tail |
|---|---|---|
| vampirism | weapon, armor | 4 |
| void | weapon, helmet | 1.5 |
| strike | weapon | 12 |
| scorch / frost / electrify / venom / reap | weapon | 0 to conversion; past r3 each rank adds +3·K/r % damage of that element (`elementDmgPct`) |
| bash / slash / chop / precision | weapon, helmet | 2 (int) |
| blockade | offhand | 2 (int) |
| epiphany | weapon (wand/rod), helmet, offhand (spellbook) | 2 (int) |
| swiftness | boots | 10 |
| dragonhide ... lichshroud | armor, offhand | 3 |

### `src/upgrades.ts`
- Add `SOCKETS`, `CHARM_SLOTS`, `RELIC_SLOTS`, `SKIP_GOLD` (3.5). `MAX_SLOTS` is derived (`sum(SOCKETS) = 6`) and kept for the UI string.
- `RUN_BONUS_STEP` and `RUN_BONUS_MAX` become `BONUS_CURVE = { table: [20, 40, 60, 80, 100], tail: 20 }`.
- `BOOSTS` unchanged.

### `src/evolutions.ts`
- `powerful(ch, id)` stays `rank >= 3`. `has()` reads `ranks`.
- `EvolutionDef` gains `scale?: (ch) => Partial<Record<StatKey, number>>` so evolutions grow with their partner's ranks:
  - Blood Rage: crit heal = `0.5 + 0.05 · max(0, strikeRank − 3)` of the crit's damage (today it heals the full damage dealt, `game.ts` line 1259, which a 100%-crit-damage build would make absurd; 50% + scaling is the safer start).
  - Avatar of Steel: `0.30 + 0.01 · protectionRanksPast3`, rail 0.45.
  - Draken Boots: speed `60 + 2 · swiftnessRanksPast3`.
  - Mastermind: unchanged (it's already strong).
  - Elemental Burst: splash = 100% of the converted part, + `elementDmgPct`.
  - Weapon Mastery, Stamina Bonus, Gold Pouch: unchanged.

### `src/meta.ts`
- `Save` gains `relicCodex?: string[]` and version 4 (section 8).
- `TRACKS` gains:
  - `charmexp`: "Charm Expansion", tiers `3+3` (free), `4+4` (300 souls).
  - `banish`: "Banishes per run", tiers 0 / 1 (75) / 2 (200) / 3 (450).

### `src/unlocks.ts`
- `applyUnlocks`: `g.banishes = tier.count` for `banish`; `ch.charmCap` for `charmexp`; `ch.relicPool = new Set([...STARTER_RELICS, ...save.relicCodex])`.

### `src/sim.ts`
- Pick policy becomes a score: `scoreCard(ch, c)` = marginal power from the curve (`nextGain` x a per-stat weight) + 1.5 per secondary + 4 per perk + 10 per relic, spells still first. Fillers get 0.1, so Skip wins over them.
- Charm stages: pick the best-scoring charm, not the first.
- `rows` gains `ranks` (total), `relics`, `filler`.

### `tools/simulate.ts`, `tools/probe.ts` (new)
- `probe.ts` = Appendix A, committed, with a `--save mid|late` preset and a CSV output for the balance sheet.

---

## 5. Combat hooks (game.ts, autocast.ts)

Line numbers are today's `src/game.ts`.

### 5.1 `damageMonster` (line 1228): crits, leech, perks

Today:
```ts
const crit = ch.imbued("crit");
const critChance = from.charm ? 0 : Math.max(bloodRage ? 30 : 0, crit > 0 ? 10 : 0) + (crit > 0 || bloodRage ? ch.charmValue("Low Blow") : 0) + (from.spell?.critChance ?? 0);
const critExtra = crit + ch.charmValue("Savage Blow") + (from.spell?.critDamage ?? 0);
...
const lifePct = from.charm ? 0 : ch.imbued("lifeLeech") + ch.charmValue("Vampiric Embrace") + (from.spell?.lifeLeech ?? 0);
```

After:
```ts
// Crit-capable if any source exists: Strike, Low Blow, Savage Blow, Blood Rage, a grade with crit (fixes dead Low Blow).
const capable = ch.critCapable || !!from.spell?.critChance || !!from.spell?.critDamage;
const critChance = from.charm && !ch.relics.has("bloodmountain") ? 0
  : Math.min(RAILS.critChance, (capable ? Math.max(10, ch.stat("critChance")) : 0) + (from.spell?.critChance ?? 0));
const critExtra = ch.stat("critDamage") + (from.spell?.critDamage ?? 0);
// Perks on the damage step
dmg *= 1 + (m.hp / m.maxHp < 0.3 ? ch.perkValue("executioner") : 0) / 100;
dmg *= 1 + (this.monstersInRange(1).length === 0 ? ch.perkValue("positional") + (ch.relics.has("solitude") ? 25 : 0) : 0) / 100;
dmg *= 1 + (m.markedUntil > this.time ? 15 : 0) / 100 + this.bloodlustStacks * ch.perkValue("bloodlust") / 100;
...
const lifePct = Math.min(RAILS.lifeLeech, ch.stat("lifeLeech") + (from.spell?.lifeLeech ?? 0));
const leechable = !from.charm || ch.relics.has("bloodmountain");
```

`stat("critChance")` pools Low Blow's curve, Blood Rage's 30 and perks. `stat("critDamage")` pools Strike, Savage Blow and Battle Focus is *not* in it (Battle Focus is plain weapon damage, applied in `weaponHit`).

After a crit: **Thunder Hammer** (rank r) picks `r` other creatures within 2 tiles and calls `damageMonster(o, round(dealt · 0.6), el, false, { chained: true })`; `chained` hits can't chain again.

Overheal (Blood of the Mountain, Ferumbras' Hat): the part of the leech that would pass max HP or mana goes to `this.leechShield` (capped at 15% max HP) or `this.manaShield` (capped at 20% max mana, reusing the Magic Shield fields at `cast`, line ~1608).

### 5.2 `weaponHit` (line 1515)

```ts
private weaponHit(m: Monster, dmg: number, echo = false) {
  dmg = Math.round(dmg * (1 + ch.stat("weaponDmgPct") / 100));       // Battle Focus
  ... existing conversion loop, now with rankValue for the element share and elementDmgPct past r3 ...
  this.charmProcs(m);
  if (echo) return;
  // Combat Mastery (knight), Stonecutter Axe (relic): a second strike.
  if (ch.relics.has("stonecutter")) this.weaponHit(m, Math.round(dmg * 0.5), true);
  else if (melee && roll(ch.perkValue("combatmastery"))) this.weaponHit(m, rerolled(), true);
  // Ballistic Mastery (paladin), Arbalest (relic): ricochet and pierce.
  if (distance && roll(ch.perkValue("ballistic"))) { const o = nearestOther(m, 3); if (o) this.weaponHit(o, Math.round(dmg * 0.6), true); }
  if (distance && ch.relics.has("arbalest")) { const o = this.monsterAt(behind(m)); if (o) this.weaponHit(o, dmg, true); }
}
```

The attack timer (`Elvish Bow` 1.5 s, `Warlord Sword` reset, `Composite Hornbow` every 4th) lives where the 2 s auto attack is scheduled (the `attack()` caller right above `weaponHit`, which already reads `Weapon Mastery`).

### 5.3 `cast` (line 1588) and `manaCost` (line 1553)

- `manaCost(s)`: returns 0 when `this.freeCast` is set. `freeCast` is rolled in `cast` **before** paying: `roll(perkValue("focusmastery"))`, or the Starstorm counter (`++this.starstorm % max(2, 6 - relicRank) === 0`, which also skips `spellReady`).
- Cooldown: `max(1, cooldown · mm · (1 − stat("cooldownPct")/100) − grade.cooldown)`.
- Spell damage: `k` gets `· (1 + stat("spellDmgPct") / 100)` (Arcane Focus).
- Echoes (Beam Mastery, Twin Bursts): after the damage loop, a `this.later(0.25, () => this.castEcho(s, dir, target, 0.5))` that re-runs the area at 50% damage, pays nothing and can't echo.
- Northwind Rod: for its three spells, run the area a second time with `dir + 2` (opposite direction).
- Wand of Inferno / Muck Rod: on each hit tile, `this.addField(FIELD.fire | FIELD.poison, tx, ty)`, the same function monster field spells use.
- Runic Mastery: in the rune branch (`ch.supplies.set(s.runeId!, ...)`, line 1594), skip the decrement on a proc.
- Healing: `· (1 + (hp < 40% ? perkValue("grove") : 0)/100) · (1 + stat("healRecvPct")/100)`; Springsprout adds a 5-tick heal-over-time through the existing condition list.

### 5.4 `hurtPlayer` (line 1109)

- Dodge and Parry read `ch.stat("dodge")` / `ch.stat("parry")` (railed 30%).
- Before absorb: **Spiritual Shielding** (`this.time >= this.shieldReady` absorbs the hit and sets `shieldReady = time + 8`); then `leechShield` soaks damage.
- In `loseHealth`: **Spark of the Phoenix**, if lethal and `time >= phoenixReady`, sets HP to 1 and starts a 3 s heal of 50%; blessings are checked after it.
- Battle Instinct is in `Character.skill(SKILL.shielding)`: `+ min(8, adjacent) · perkValue("battleinstinct")`. `Game` writes `ch.adjacent` each tick (it already computes `monstersInRange(1)` for autocast).
- Avatar of Steel (line 1153): `0.7` becomes `1 − evoScale("avatarsteel")`.

### 5.5 `charmProcs` (line 1267) and `killMonster` (line 1281)

- Charm damage cap `ch.level * 2` becomes `ch.level * 2 * (1 + 0.1 * max(0, rank − 3))`. Carnage's `ch.level * 6` the same way.
- `killMonster`: Bloodlust stacks (`this.bloodlust = { n: min(n+1, 5 + floor(rank/3)), until: time + 5 }`), Second Wind (`roll(perkValue("secondwind"))`: +4% HP and mana), Fire of the Suns (`++this.killCounter % 10 === 0`: holy 3x3 for 25% of the dead creature's max HP), Wand of Voodoo.
- Bestiary stages (line 1331) are unchanged.

### 5.6 `openChest` (line 1558)

- Evolutions first, unchanged.
- Picks: `ch.rollChoices().filter(...)[0]` stays. With `n === 5`, the first pick is re-rolled with `withRarity(c, max(2, rolled))` so a 5-chest always has an Epic or better.

### 5.7 `advance` (line 1689) and pending choices

Unchanged: one choice per level, one per skill advance at most every 20 s, `MAX_PENDING` 5. Uncapped lines are exactly why this frequency stops being a problem.

### 5.8 `src/autocast.ts`

- `expected(g, s)` (used to pick the best spell) multiplies by `1 + stat("spellDmgPct")/100` and by the grade tail, so supreme ranks change spell choice the way grades already do.
- Spell choice: when `g.freeCast` would be rolled at cast time it's invisible to autocast, which is fine. Starstorm: if the next attack spell is the free one (`(starstorm + 1) % N === 0`), prefer the most expensive ready attack spell.
- Royal Crossbow: the "no healing spells for 10 s" check for Sharpshooter (in `supportSpells`) is skipped with the relic; Demonbone: Blood Rage is used below the current HP threshold too.
- Wisdom of Solitude / Positional Tactics: none in autocast. Steering is the player's job, and those reward it.

---

## 6. Full line, affix and relic tables

### 6.1 Imbuement lines (K = 3, ranks 1–3 = Basic, Intricate, Powerful)

| Line | Stat | Table | s | Rail | r4 | r6 | r10 | r20 | Who |
|---|---|---|---|---|---|---|---|---|---|
| Vampirism | lifeLeech | 5 / 10 / 25 | 4 | 50 (pooled) | 28.0 | 32.4 | 38.2 | 46.2 | all |
| Void | manaLeech | 3 / 5 / 8 | 1.5 | 25 | 9.1 | 10.8 | 12.9 | 15.9 | all |
| Strike | critDamage | 5 / 15 / 40 | 12 | — | 49.0 | 62.2 | 79.5 | 103.5 | all |
| Scorch, Frost, Electrify, Venom, Reap | conversion, then elementDmgPct | 10 / 25 / 50 | 3 | — | 50 +2.3% | 50 +5.6% | 50 +9.9% | 50 +15.9% | K, P |
| Bash, Slash, Chop | skill | 1 / 2 / 4 | 2 (int) | — | 5 | 7 | 10 | 14 | K (weapon kind) |
| Precision | distance | 1 / 2 / 4 | 2 (int) | — | 5 | 7 | 10 | 14 | P |
| Blockade | shielding | 1 / 2 / 4 | 2 (int) | — | 5 | 7 | 10 | 14 | K |
| Epiphany | magic level | 1 / 2 / 4 | 2 (int) | — | 5 | 7 | 10 | 14 | S, D |
| Swiftness | speed | 10 / 15 / 30 | 10 | — | 37.5 | 48.5 | 62.9 | 82.9 | all |
| Dragon Hide ... Lich Shroud | absorb (element) | 3 / 8 / 15 | 3 | 50 with gear | 17.3 | 20.6 | 24.9 | 30.9 | all |

### 6.2 Charm lines (K = 3; Tibia's I / II / III)

| Charm | Kind | Table | s | Rail | r6 | r10 | Notes |
|---|---|---|---|---|---|---|---|
| Wound, Enflame, Poison, Freeze, Zap, Curse, Divine Wrath | Major | 5 / 10 / 11 | 2 | 35 | 14.7 | 17.6 | damage cap `level·2·(1 + 0.1·(r−3))` |
| Low Blow | Major | 4 / 8 / 9 | 1.5 | (critChance 50) | 11.8 | 13.9 | makes you crit-capable on its own |
| Savage Blow | Major | 20 / 40 / 44 | 8 | — | 58.8 | 70.3 | pools into critDamage |
| Carnage | Major | 10 / 20 / 22 | 3 | 45 | 27.6 | 31.9 | cap `level·6·(1 + 0.1·(r−3))` |
| Overpower, Overflux | Major | 5 / 10 / 11 | 2 | 35 | 14.7 | 17.6 | |
| Parry, Dodge | Major | 5 / 10 / 11 | 1.5 | 30 | 13.8 | 15.9 | |
| Cripple, Numb, Adrenaline Burst, Cleanse | Minor | 6 / 9 / 12 | 2 | 35 | 15.7 | 18.6 | |
| Fatal Hold | Minor | 30 / 45 / 60 | 5 | 90 | 69.3 | 76.4 | |
| Vampiric Embrace | Minor | 1.6 / 2.4 / 3.2 | 0.4 | (lifeLeech 50) | 3.9 | 4.5 | pools |
| Void's Call | Minor | 0.8 / 1.2 / 1.6 | 0.2 | (manaLeech 25) | 2.0 | 2.3 | pools |
| Void Inversion | Minor | 20 / 30 / 40 | 5 | 80 | 49.3 | 56.4 | |

### 6.3 Other lines

| Line | K | Table | s | Rail |
|---|---|---|---|---|
| Spell grade (per spell) | grades.length (1–3) | Wheel / gem grades | 3 (damage or heal %) | — |
| Run bonus (xp, gold, loot, skill, magic) | 5 | 20 / 40 / 60 / 80 / 100 | 20 | — |
| Run luck | 10 | 5 … 50 | 5 | total 150; rarity input ≤ 100 |
| Prey stars (per prey) | 10 | 1 … 10 | 1 star | — |
| Training (exercise weapon) | 1 | +1 | linear, as today | — |

### 6.4 Secondaries (Rare layer; K = 3, linear to r3, s = one rank)

| Id | Stat | Per rank | r3 | r10 | Tags | Affinity (lines that roll it) |
|---|---|---|---|---|---|---|
| vitality | maxHpPct | 4 | 12 | 25.2 | — | vampirism, protections, blockade, dodge, parry, healing grades |
| focus | maxManaPct | 4 | 12 | 25.2 | magic, distance | void, epiphany, overflux, mage grades |
| battlefocus | weaponDmgPct | 3 | 9 | 18.9 | melee, distance | strike, skill imbuements, elemental damage, wound |
| arcanefocus | spellDmgPct | 3 | 9 | 18.9 | magic, distance | epiphany, attack grades, element charms |
| swiftcast | cooldownPct | 4 | 12 | 25.2 (rail 35) | — | void, any grade, swiftness |
| mending | healRecvPct | 4 | 12 | 25.2 | — | vampirism, healing grades, cleanse |
| alchemy | potionPct | 8 | 24 | 50.3 | — | void, vampirism, protections |
| hardening | armor | 1 | 3 | 6.3 (int: 6) | melee, distance | protections, blockade, parry |
| fleetness | speed | 6 | 18 | 37.7 | — | swiftness, adrenaline burst, dodge |
| fortune | luck | 2 | 6 | 12.6 | — | run bonuses, luck, prey |

Vocation tags: knight = melee, shield; paladin = distance, magic (holy), shield; sorcerer = magic; druid = magic, healer.

### 6.5 Perks (Epic layer; chance perks 6 / 11 / 15, s = 2, rail 35)

| Id | Name | Tags | Rank 1 | Ranks | Affinity |
|---|---|---|---|---|---|
| combatmastery | Combat Mastery | melee | 6% second strike | chance curve | strike, vampirism, skill imbuements, knight grades |
| battleinstinct | Battle Instinct | melee, shield | +1 shielding per adjacent (max 8) | +1 per creature at r3, r6, r10 | blockade, parry, protections |
| executioner | Executioner's Edge | melee | +15% damage under 30% HP | 15 / 20 / 25, s = 5 | strike, wound, knight grades |
| ballistic | Ballistic Mastery | distance | 6% ricochet (60%) | chance curve | precision, strike, elemental damage |
| positional | Positional Tactics | distance | +10% with nothing adjacent | 10 / 15 / 20, s = 4 | swiftness, dodge, paladin grades |
| divineemp | Divine Empowerment | distance | 6% mark: +15% taken, 5 s | chance curve | divine wrath, holy grades |
| focusmastery | Focus Mastery | magic | 6% free cast | chance curve | void, epiphany, overflux, mage grades |
| beammastery | Beam Mastery | magic (sorcerer) | 6% beam/wave echo (50%) | chance curve | energy grades, zap, enflame |
| runicmastery | Runic Mastery | magic, distance | 8% rune not used | 8 / 14 / 18, s = 2 | epiphany, any rune-school charm |
| twinbursts | Twin Bursts | magic (druid) | 6% ice/earth burst (3x3, 50%) | chance curve | ice and earth grades, freeze, poison |
| grove | Blessing of the Grove | healer | +20% healing under 40% HP | 20 / 28 / 35, s = 5 | healing grades, mending lines |
| bloodlust | Bloodlust | — | +3% damage per kill, 5 stacks, 5 s | +1 stack at r3, r6, r10 | carnage, vampirism, run bonus xp |
| secondwind | Second Wind | — | 6% kill heals 4% HP and mana | chance curve | vampirism, void, cleanse |

### 6.6 Relics (Legendary layer; 3 slots, awakening ranks)

| Id | Name | Tags | Rank 1 | Each awakening | Starter |
|---|---|---|---|---|---|
| thunderhammer | Thunder Hammer | melee | crits chain to 1 creature (60%) | +1 chain target | yes |
| stonecutter | Stonecutter Axe | melee | every attack strikes twice (2nd 50%) | +10% second hit | no |
| warlord | Warlord Sword | melee | exori resets the weapon attack | +10% exori damage | no |
| demonbone | Demonbone | melee | Blood Rage: no extra damage taken | +5% Blood Rage melee | no |
| arbalest | Arbalest | distance | pierce 1 creature behind | +1 pierce | yes |
| hornbow | Composite Hornbow | distance | every 4th attack: 3 missiles | every 3rd, then 2nd (min) | no |
| royalxbow | Royal Crossbow | distance | Sharpshooter: no slow, healing allowed | +10% Sharpshooter distance | no |
| elvishbow | Elvish Bow | distance | attack every 1.5 s | −0.1 s (min 1.2) | no |
| starstorm | Wand of Starstorm | magic | every 5th attack spell free, no cooldown | every 4th, 3rd (min 2nd) | yes |
| inferno | Wand of Inferno | magic | fire spells leave fire fields | field damage +25% | no |
| ferumbras | Ferumbras' Hat | magic | overflow mana leech → magic shield (20%) | +5% cap | no |
| voodoo | Wand of Voodoo | magic | death kill curses nearest (10% over 5 s) | +5% | no |
| hailstorm | Hailstorm Rod | magic, healer | ice roots 1.5 s (8 s per creature) | +0.5 s | yes |
| northwind | Northwind Rod | magic, healer | three waves fire both ways | backward wave +25% | no |
| springsprout | Springsprout Rod | healer | heals add 5% HoT and cure poison | +2% HoT | no |
| muck | Muck Rod | magic, healer | earth spells leave poison fields | field damage +25% | no |
| twistoffate | Twist of Fate | — | +1 card per level-up | +1 reroll per run | yes |
| phoenix | Spark of the Phoenix | — | lethal hit → 1 HP, heal 50% (180 s) | −30 s cooldown | no |
| suns | Fire of the Suns | — | every 10th kill: holy 3x3, 25% | every 9th, 8th (min 5th) | yes |
| shielding | Spiritual Shielding | — | absorb one hit every 8 s | −1 s (min 4) | yes |
| embrace | Embrace of Tibia | — | potions +50%, 25% not used | +10% / +5% | yes |
| solitude | Wisdom of Solitude | — | +25% damage, nothing adjacent | +5% | no |
| bloodmountain | Blood of the Mountain | — | leech on charm/rune/field damage; overheal shield 15% | +5% shield | no |
| heartmountain | Heart of the Mountain | shield | +15% max HP; Protector keeps your damage | +5% max HP | no |

24 relics: 4 per vocation and 8 universal. Phase 3 ships the **8 starters** marked "yes" (one per vocation plus four universal); the other 16 unlock through the Relic Codex in phase 5. The final list is an open question (section 11).

Relic affinity: weapon-ish lines (strike, skill imbuements, elemental damage, wound, attack grades) roll the vocation's weapon relics; defensive and healing lines (vampirism, protections, healing grades, dodge, parry, cleanse) roll the blessings; run bonuses, luck and prey roll Twist of Fate, Fire of the Suns, Embrace of Tibia.

---

## 7. UI changes

### 7.1 `ui.ts` `levelUp` (line 193)

- `open(c)` keeps the frame classes `r1`–`r3` (already styled in `style.css` line 275) and adds `r0`.
- Each card renders a list of rows instead of one `<small>`:

```ts
const rows = (c: LevelChoice) => [
  row("rank", rankLabel(c), `${fmtNow(c)} → ${fmtNext(c)}`),                       // grey diamond
  ...(c.extras ?? []).map((a) => row(a.line.startsWith("perk:") ? "perk" : "sec",  // blue / purple diamond
        lineName(a.line), describeLine(a.line, ch.rank(a.line) + 1))),
  ...(c.relic ? [row("relic", RELICS[c.relic].name, RELICS[c.relic].desc(ch.relics.get(c.relic) ?? 0) + 1)] : []),  // orange star
].join("");
```

- Titles: `${TIERS[tier - 1]} ${d.name}` becomes `tierLabel(rank) + " " + name` ("Powerful +2 Vampirism" reads badly; use "Vampirism · Powerful +2"), and `CHARM_TIERS[t]` becomes `charmTierLabel(r)`.
- Header: `Upgrades ${slotsUsed}/${MAX_SLOTS}` becomes `Sockets 5/6 · Charms Major 3/3, Minor 2/3 · Luck 35 · Relics 1/3`.
- Buttons row: Reroll (existing), **Skip: +N gold** (`SKIP_GOLD · level`, always there), **Banish** (opens a second click: "click a card to banish its line"; only while `g.banishes > 0`).
- Delete the `supply` and `gold` card branches (lines 233–240) and their icon branches.
- Icons: perks reuse the line's effect icon; relics use the real item's sprite, resolved with `itemId("thunder hammer")` etc. at load (no hard-coded ids), so it comes from the player's client like every other item.
- `style.css`: `.card .ln.rank/.sec/.perk/.relic` rows as in the pitch mock, cards 232 px wide, 4 cards fit in the existing `.cards` flex row.

### 7.2 `hud.ts` `upgrades` (line 892)

Becomes a character sheet with a "Stats" section on top, then the sources:

```
Stats
  Life leech       31.4%    (tooltip: Vampirism 5 → 30.4, Vampiric Embrace 2 → 2.4, rail 50)
  Crit             38% / +56%
  Spell cooldowns  -12%
Sockets 5/6
  Weapon   Strike · Powerful +2   |  Vampirism · Powerful +1
  Armor    Dragon Hide · Intricate
  Helmet   Chop · Powerful
  Boots    Swiftness · Basic
  Shield   (free)
Charms  Major 3/3 · Minor 2/3
Perks   Combat Mastery 2 (11%), Bloodlust 1
Relics  ★ Thunder Hammer I
Spells, Prey, Run bonuses, Boosts, Evolutions   (as today)
```

Rows keep the existing `row(name, detail, tip)` helper and the `changed()` diffing. The window's default height (200, line 29) goes to 260.

### 7.3 Chest screen (`ui.ts`, after `levelUp`) and title screen

- The chest list shows the same layered rows, compacted to one line per card.
- The title screen gets a **Relic Codex** tab: 24 relics, unlocked ones in colour, locked ones as silhouettes with "Kill \<boss\>".

### 7.4 Tooltips (`tooltip.ts`)

The stat tooltip pattern exists for items; add `lineTooltip(id)` showing ranks 1..r+3 so players can see the curve flatten.

---

## 8. Save migration

Runs aren't saved (only `meta.ts`'s account, plus the HUD layout), so no in-run state needs migrating. Only the account changes.

```ts
// meta.ts
export interface Save {
  ...
  version?: number;          // 4: relic codex, new tracks
  relicCodex?: string[];     // relics unlocked beyond the starters
}
const fresh = (): Save => ({ ..., relicCodex: [], version: 4 });

function migrate(s: Save): Save {
  if ((s.version ?? 2) < 3) { /* existing v2 → v3 gear refund, unchanged */ }
  if ((s.version ?? 3) < 4) {
    s.relicCodex ??= [];
    // Unlock the codex for bosses already beaten: kills are kept per creature for achievements.
    for (const [boss, relic] of Object.entries(BOSS_RELIC)) if ((s.kills[boss] ?? 0) > 0) s.relicCodex.push(relic);
    s.version = 4;
  }
  return s;
}
```

`migrate` today returns early at `version >= 3`; it becomes a chain of `if (version < n)` steps. New tracks (`charmexp`, `banish`) need nothing: `tier()` returns 0 for a missing key. Boosts and souls are untouched, so nobody loses progress. `BOSS_RELIC` maps one boss per zone (from `ZONES[i].bosses[0]` in `data.ts`) to a non-starter relic.

---

## 9. Balancing plan

### 9.1 Metrics (all from `tools/probe.ts`, 4 vocations x 10 runs x 3,600 s, mid and late saves)

| Metric | Today (section 1) | Target |
|---|---|---|
| Filler share, offers 51–100 | 18–88% | < 10% for every vocation |
| Legendary rolls downgraded | 62% | 0% (by construction) |
| Distinct lines with rank ≥ 1 at 60 min | 30–40 (charms included) | 15–25 (sockets and charm slots) |
| Highest rank of any line at 60 min | 3 | 8–14 |
| Power index at 60 min (dealt/s · effective HP) | — (baseline in phase 1) | every vocation within 1.5x of the median |
| Deaths before 30 min | 2 of 12 runs | not higher than baseline |
| Relics per 60-min run | ~1 Legendary that stays | 2–3 relics, 1–3 awakenings |

### 9.2 Process

1. **Phase 1 baseline**: commit the probe and record today's numbers for the mid save (section 1) and a late save (boosts at 8).
2. **Curve sweep**: run the probe with `s` multiplied by 0.5 / 1 / 1.5 per stat family (leech, crit, skills, protection). Pick the lowest `s` that keeps filler under 10% and the bot's pick rate of rank-4+ cards over 50% (they must be worth taking).
3. **Rarity layer A/B**: perks and relics are each toggled by a flag in `affixes.ts`, so the probe can run "layers off" vs "layers on" and report each perk's and relic's pick rate and its delta on the power index. A relic that moves the index more than +40% gets nerfed; under +5% gets buffed or cut.
4. **Vocation parity**: per vocation, compare power index at 30 and 60 min. Tune perk chances and secondary weights, not the shared curve.
5. **Human check**: 10 manual runs (2–3 per vocation) with a checklist: did every screen have a card you wanted, did you understand every card, did a relic change how you steered.

### 9.3 Knobs, in order of preference

`s` per line family → rails → perk chance tables → secondary weights in affinity lists → relic numbers → socket and slot counts (last, since players learn them).

---

## 10. Phased rollout

Each phase is one PR to `main`, squash-merged, with the probe's before/after table in the description.

| Phase | Days | Scope | Files | Milestone |
|---|---|---|---|---|
| 1. Curves | 4 | `curves.ts`; `imbued`, `charmValue`, `gradeBonus`, `runRate`, `luck`, `preyBonus` on the curve; delete `fitRarity`, `room`, `rarityMult`, `steps`; drop gold and supply cards; Skip button; `tools/probe.ts` | rarity, curves (new), character, picks, imbuements, upgrades, ui, sim, tools | Filler < 15% on offers 51–75 for all four; 0 Legendary downgrades (Legendary is +1 rank and nothing else until phase 3) |
| 2. One sheet | 3 | `lines.ts`, `ranks` map with getters for the old maps, `stat()` with cache and rails, Low Blow fix, charm damage scaling, Upgrades window stats section | lines (new), character, game, hud | Identical leech and crit numbers for runs that stay at rank ≤ 3 (regression probe) |
| 3. Rarity layers | 8 | `affixes.ts`: 10 secondaries, 13 perks, 8 starter relics, `rollExtras`; combat hooks (5.1–5.6); card rows; autocast tweaks; probe scoring | affixes (new), character, game, autocast, ui, style.css, sim | Every card shows its layers; probe reports perk and relic pick rates |
| 4. Sockets and slots | 4 | `SOCKETS`, off-hand dormancy, `CHARM_SLOTS`, Banish, Charm Expansion, `RELIC_SLOTS` and awakening, save v4 | upgrades, character, evolutions, meta, unlocks, ui, hud | v3 saves load; new tracks buyable; the sim respects sockets |
| 5. Balance and codex | 5 | Sweeps (9.2), remaining 16 relics behind the Relic Codex, codex tab, evolution scaling, README "Not real" and SKILLS.md update | affixes, evolutions, meta, ui, README, SKILLS.md | All targets in 9.1 met |
| **Total** | **24** | | | |

Phase 1 is shippable alone and already removes the dead late game. If the project stops after it, the game is strictly better.

---

## 11. Open questions

1. **Sockets by body slot, or keep 6 free slots?** Sockets create the decisions the pitch promises, but they add a rule to learn. Fallback: 6 free slots plus "only one protection imbuement per element".
2. **Wheel of Destiny names for invented perks?** Combat Mastery, Beam Mastery, Twin Bursts and others are real perk names with different real effects. The alternative is plain names ("Double Strike", "Free Cast").
3. **Relic count at launch and how the codex unlocks**: 8 starters (proposed) and boss kills, or souls?
4. **Blood Rage at full crit damage heals the full hit today.** With uncapped Strike that's unbounded sustain; the pitch drops it to 50% + scaling. Is a change to an existing evolution acceptable?
5. **Epic's "jump"**: today an Epic Vampirism from nothing is Powerful in one card. Under this pitch it's Basic + secondary + perk. If playtests miss the jump, Epic could give +2 ranks of the main line.
6. **Exercise weapons**: they're uncapped already (+1 skill each). Should Rare and up add layers to them too, or stay plain as the guaranteed filler?
7. **Prey wildcard scope**: "every creature in the zone" (Legendary) may be too strong with experience prey and the XP boost at x50. Cap wildcard experience prey at half value?
8. **Skip gold amount**: 75 x level vs today's Common gold card at 50 x level. Skip should never beat a real card, but must feel fair when you skip three fillers in a row.

---

## Appendix A: the probe

Bundled from outside the repo (`esbuild probe.ts --bundle --platform=node`), run from the repo root because `sim.ts` reads `public/assets/tibia-atlas.json` by relative path. `node probe.cjs <voc 0-3> <runs> <seconds>`.

```ts
import { readFileSync } from "node:fs";
import { Character } from "../src/character";
import { run } from "../src/sim";
import { applyUnlocks } from "../src/unlocks";
import { rollRarity } from "../src/rarity";
import { World } from "../src/world";
import type { Game } from "../src/game";

const atlas = JSON.parse(readFileSync("public/assets/tibia-atlas.json", "utf-8"));
const world = new World(atlas.terrain);
const effectDur = (id: number) => { const e = atlas.effects[id]; return e ? e.ms.reduce((a: number, b: number) => a + b, 0) / 1000 : 0; };
const voc = Number(process.argv[2] ?? 0), runs = Number(process.argv[3] ?? 3), secs = Number(process.argv[4] ?? 3600);
const FILL = new Set(["train", "supply", "gold"]);
let offers = 0, cards = 0, fill = 0, rare = 0, down = 0, legRolled = 0, legKept = 0, perRun = 0;
const buckets: Record<string, { o: number; f: number; c: number }> = {};
const P = Character.prototype as any;
const roll0 = P.rollChoices, wr0 = P.withRarity;
P.rollChoices = function () {
  const out = roll0.call(this);
  const b = `${Math.floor(perRun / 25) * 25 + 1}-${Math.floor(perRun / 25) * 25 + 25}`; perRun++; offers++;
  const nf = out.filter((c: any) => FILL.has(c.kind)).length;
  (buckets[b] ??= { o: 0, f: 0, c: 0 }); buckets[b].o++; buckets[b].c += out.length; buckets[b].f += nf;
  cards += out.length; fill += nf;
  return out;
};
P.withRarity = function (c: any, rolled?: number) {
  if (c.kind === "spell") return wr0.call(this, c, rolled);
  const r = rolled ?? rollRarity(this.luck), res = wr0.call(this, c, r);
  if (r > 0) rare++; if (res.rarity < r) down++; if (r === 3) { legRolled++; if (res.rarity === 3) legKept++; }
  return res;
};
const save: any = { souls: 0, unlocks: { weapon: 2, shield: 2, armor: 2, helmet: 2, legs: 1, boots: 1, amulet: 1, potions: 3, gold: 3, dawnport: 1 },
  boosts: { xp: 6, gold: 3, loot: 3, luck: 2, haste: 3, train_magic: 5, train_distance: 5, train_axe: 5, train_shielding: 3 },
  blessings: 0, zones: [], kills: {} };
for (let k = 0; k < runs; k++) {
  const keep: { g?: Game } = {}; perRun = 0;
  run(world, effectDur, voc, secs, keep, (g) => applyUnlocks(g, save));
  const ch = keep.g!.ch;
  console.log(`run ${k + 1}: L${ch.level} imbues=${[...ch.imbuements].map(([i, t]) => i + t)} charms=${ch.charms.size}`);
}
console.log(`filler ${(100 * fill / cards).toFixed(1)}%, downgraded ${down}/${rare}, legendary ${legKept}/${legRolled}`);
for (const [b, v] of Object.entries(buckets)) console.log(`  offers ${b}: ${(100 * v.f / v.c).toFixed(1)}% filler`);
```

Back to the pitch: [index.html](index.html)
