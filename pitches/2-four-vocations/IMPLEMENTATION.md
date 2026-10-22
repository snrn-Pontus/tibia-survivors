# Four Vocations, Four Games: implementation plan

Engineering backing for the pitch in [index.html](index.html). Author: Tomasz "Tom" Wieczorek.

Everything here is a plan. Nothing under `src/` has been changed. Function and line references are to `main` at `11b8cb0`.

---

## 0. Summary

- **Each vocation gets its own card pool: 3 paths × 7 cards = 21 cards.** Spell grades move into the paths, so a Wheel grade on Energy Beam counts as a point in Storm Caller.
- **Two of the three cards on each level-up come from your vocation's paths, and one from a small universal pool** (imbuements, prey, luck, fillers). Run bonuses leave level-ups and become boss chest picks.
- **Rarity decides which kind of card shows up, not only how much of it.** Common and Rare give ranks of minor nodes. Epic is where keystones live. Legendary is the Wheel of Destiny revelation (Avatar of Storm, Twin Bursts, Executioner's Throw, Divine Grenade...), and boss chests guarantee one once you qualify.
- **Cards have caps, the run doesn't.** Every node has 1 to 3 ranks. Once you've maxed a path, an uncapped "Mastery" card takes over, scaled by rarity x1/2/3/5.
- **Each stat lives in one system.** Leech belongs to imbuements, procs to charms, and per-spell bonuses to grades. That removes Vampiric Embrace and Void's Call, and the six protection imbuements merge into one card.
- **Rollout goes one vocation at a time, Sorcerer first.** About 5–6 weeks for one developer, with a sim gate at each phase.

---

## 1. What exists today (and what it costs us)

Figures are from `SKILLS.md` and the code.

| Fact | Source | Why it matters |
|---|---|---|
| A level-up draws from ≤2 imbuements, ≤2 spell grades, ≤1 prey, ≤2 run bonuses and ≤1 Luck card, then fillers | `Character.rollChoices` (character.ts) | Only the 2 grade slots are vocation-specific. 6 of the 8 candidate slots are the same for every vocation. |
| 13 of the sorcerer's 20 gradable spells, and 12 of the druid's 18, grade as a flat +5/10/15% | `spellGrades` (picks.ts), the non-Wheel fallback | Even the "vocation" cards are mostly the same flat damage card. |
| 10 of 19 imbuements are offered to every vocation (Vampirism, Void, Strike, Swiftness, six protections) | `IMBUEMENTS[].for` (imbuements.ts) | The six protections are one decision split into six cards. |
| Leech comes from 3 systems: Vampirism 5/10/25%, Vampiric Embrace 1.6/2.4/3.2%, grades (Front Sweep, Terra Wave 5%; Strong Ice Wave 3% mana) | `damageMonster` lines 1255–1257 | Players can't tell which pick matters. The charm adds about 1/8 of what the imbuement gives. |
| Crit comes from 3 systems: Strike (+5/15/40% at a 10% chance), Low Blow (+4/8/9% chance), Savage Blow (+20/40/44%), grade crit damage (up to +22.5%) | `damageMonster` lines 1235–1240 | Low Blow does nothing without Strike or Blood Rage, and the card doesn't say so. |
| Imbuements, charms and grades have 3 tiers, so a Legendary roll (1%) can never land on them | `fitRarity` (rarity.ts) | The rarest roll in the game only matters on economy cards: +250×level gold, +100% loot. |
| The sim's own bot ranks Experience run bonus first, then training, loot and gold, and takes imbuements and grades only after that | `src/sim.ts` lines 101–106 | Our own "reasonable player" picks economy over build. |
| Skill advances also give a pick (at most every 20 s), and up to 5 picks queue (`MAX_PENDING`) | `Game.advance`, upgrades.ts | Lots of picks come early. If they all feel the same, 50 level-ups feel like 5. |
| 8 evolutions: 3 economy (Stamina, Gold Pouch, Draken Boots), 5 generic combat | evolutions.ts | None of them is tied to a vocation's playstyle. |

---

## 2. Data model

New file `src/paths.ts`: paths, nodes and the mods they compile to.

```ts
import type { VocationId, Element } from "./tibia/db";
import type { Rarity } from "./rarity";

export type PathId =
  | "storm" | "deathmage" | "runemaster"        // sorcerer
  | "frost" | "grove" | "earth"                 // druid
  | "berserker" | "juggernaut" | "warlord"      // knight
  | "marksman" | "skirmisher" | "holy";         // paladin

/** Minor: 3 ranks, any rarity (Common +1 rank, Rare +2, Epic +3), like today's tiers.
 *  Notable: 2 ranks, Rare or rarer (Rare gives rank 1, Epic both).
 *  Keystone: 1 rank, Epic only, needs KEYSTONE_AT points in its path.
 *  Revelation: 1 rank, Legendary only, needs REVELATION_AT points plus the keystone; one per run. */
export type NodeTier = "minor" | "notable" | "keystone" | "revelation";

export const KEYSTONE_AT = 5;
export const REVELATION_AT = 12;
export const MASTERY_STEP = 2; // % per stack of a path's Mastery card, uncapped

export interface PathDef {
  id: PathId;
  voc: VocationId;
  name: string;               // "Storm Caller"
  color: string;              // UI ribbon
  blurb: string;
  /** Spell files whose Wheel grades count as points here (each spell belongs to exactly one path). */
  spells: string[];
  /** What the path's Mastery card scales: an element's damage, healing, or weapon damage. */
  mastery: { kind: "element"; element: Element } | { kind: "heal" } | { kind: "weapon" } | { kind: "runes" };
  /** Hints auto-combat reads (autocast.ts §6). */
  auto?: Partial<AutoHints>;
}

export interface NodeDef {
  id: string;                 // "storm.arc_conduit"
  path: PathId;
  name: string;
  tier: NodeTier;
  /** Value at each rank (index 0 = rank I). Some nodes carry two numbers: see `values2`. */
  values: number[];
  values2?: number[];
  /** "real": a real Tibia mechanic and name (Wheel perk, Forge tier, condition). "named": a real Tibia name with
   *  our effect. "invented": ours, listed in README's "Not real". */
  origin: "real" | "named" | "invented";
  source?: string;            // "Wheel of Destiny revelation (Canary io_wheel.cpp)"
  desc: (v: number, v2?: number) => string;
  /** Compiles a rank into Mods (below). Pure: called on every change, never per hit. */
  apply: (m: Mods, v: number, v2?: number) => void;
}

/** Everything combat reads, flattened once per pick (Character.recomputeMods). game.ts reads ch.mods.x
 *  instead of walking nodes on every hit. All percents. */
export interface Mods {
  // casting
  freeCast: number;            // chance an attack spell costs no mana
  echo: number;                // chance an attack spell recasts at echoPower % after 0.4 s
  echoPower: number;
  cdResetOnKill: number;       // chance a kill by a spell resets that spell
  spellCdFlat: Partial<Record<string, number>>; // spell file -> seconds off
  areaGrow: Partial<Record<string, number>>;    // spell file -> extra tiles (beams lengthen, circles widen)
  overcharge: { above: number; cost: number; dmg: number } | null;
  chain: { targets: number; pct: number; element?: Element } | null;
  // runes
  runeDmg: number; runeSave: number; conjureExtra: number; runeOwnGroup: number;
  // conditions applied on hit, as % of the hit spread over Tibia condition ticks
  burn: number; poison: number; electrify: number;
  poisonStacks: boolean; poisonSpread: number;
  slowPct: number; rootChance: number; rootSec: number; vsControlled: number;
  // healing
  hot: number; overhealSplash: number; healPulse: number; manaRegen: number; lowHpHeal: number;
  // melee and ranged
  doubleStrike: number; cleave: number; cleavePct: number; onslaught: number;
  ricochet: number; pierce: number; multishot: number; spearSave: number;
  markPct: number; markSec: number;
  // defense
  extraBlocks: number; retaliate: number; reflectPct: number; dodgeMoving: number;
  surroundHeal: number; slowedTakeLess: number;
  // stances
  stanceSec: Partial<Record<"blood_rage" | "protector" | "sharpshooter", number>>;
  stanceFix: Partial<Record<"blood_rage" | "protector" | "sharpshooter", Partial<import("./support").Stance>>>;
  // revelations (timed avatars, auto spells)
  avatar: { every: number; secs: number; critDmg: number; reduce: number; extra?: string } | null;
  autoSpell: { id: "executioners_throw" | "divine_grenade"; every: number } | null;
  // mastery
  mastery: Partial<Record<PathId, number>>;      // stacks
}
export const emptyMods = (): Mods => ({ /* zeros, nulls, {} */ } as Mods);
```

Additions to `Character` (character.ts):

```ts
nodes = new Map<string, number>();       // node id -> rank
revelation: string | null = null;        // the one revelation this run
mastery = new Map<PathId, number>();     // uncapped stacks
mods: Mods = emptyMods();

pathPoints(p: PathId): number             // minor + notable ranks in p, plus grades of p's spells (1:1); keystones and revelations do not count
recomputeMods(): void                     // emptyMods(), then every node's apply() at its rank; called by applyChoice
```

New `LevelChoice` kinds (character.ts, the union at the top):

```ts
| { kind: "node"; id: string }            // a path card
| { kind: "mastery"; path: PathId }       // uncapped, after the path's minors and notables are maxed
| { kind: "calling"; voc: VocationId }    // rookie pool, see §5
| { kind: "protect" }                     // the merged protection imbuement: element picked from the zone
```

`room()` gains `node` (ranks left, 1 for keystones), `mastery` (Infinity) and `calling` (Infinity). `applyChoice()` gains branches for each, and every branch ends with `this.recomputeMods()`.

---

## 3. Rarity, caps and the level-up roll

### 3.1 What rarity means

| Rarity | Base odds (unchanged) | Path cards | Universal cards (unchanged) |
|---|---|---|---|
| Common | 70% | +1 rank of a minor node, or +1 spell grade | +1 tier / x1 |
| Rare | 22% | +2 ranks of a minor, rank I of a notable, or +2 grades | +2 tiers / x2 |
| Epic | 7% | +3 ranks of a minor, both ranks of a notable, or **a keystone** once eligible (50% of Epic rolls when one is) | +3 tiers / x3 |
| Legendary | 1% | **A revelation** once eligible. Otherwise it falls back to Epic, as `fitRarity` does now | x5 (only on uncapped cards) |

`fitRarity` (rarity.ts) stays as it is for minor nodes, grades and universal cards. Notables use a new `fitNotable(r)` that maps Common to "not offered", Rare to 1 and Epic+ to 2.

### 3.2 Guarantees, so keystones don't depend on 1%

- **Keystone pity:** once a path reaches `KEYSTONE_AT` (5) points, its keystone is offered within the next 3 level-ups. `Character.keystonePity: Map<PathId, number>` counts down; at 0 the roll forces the keystone into slot 1 as Epic. A keystone tied to a spell (Beam Mastery, Twin Bursts, Weapon Dance) also needs one of its spells known: a Storm Caller with 5 points at level 11 gets Beam Mastery once Energy Beam arrives at 23, and Arc Conduit / Static Charge carry it until then.
- **Revelation through boss chests:** `Game.openChest` (game.ts ~1558) first checks evolutions (unchanged), then revelations. If `pathPoints(p) >= 12`, you own `p`'s keystone and `revelation === null`, the chest is "A Revelation": the path's revelation against the best Epic card from each of your other two paths. Today 60% of chests give a single pick, so this is a big upgrade to chests, and bosses become goals.
- **At most two keystones per run, and one revelation.** You can hybridise two paths, but you can't take everything.

### 3.3 Caps: "caps on cards, no cap on the run"

- Every node has 1–3 ranks, and grades stay at 1–3 (Wheel data).
- When every minor and notable node in a path is maxed, the path offers **`<Path> Mastery`**: +2% per stack to the path's element damage (Storm: energy; Death Mage: fire + death; Rune Master: runes; Frost: ice; Grove: healing; Earth: earth; Berserker and Warlord: melee; Juggernaut: shield defense +2%; Marksman and Skirmisher: distance; Holy: holy). Rarity scales the stacks by x1/2/3/5. It has no cap. It replaces gold and potion fillers late in the run, so endless runs always have a build card to take.
- Universal caps stay the same: imbuement slots (now 4), charm tiers 3, prey slots 3, run luck 50.

### 3.4 `rollChoices()` rewrite (character.ts)

```ts
rollChoices(): LevelChoice[] {
  if (this.voc.id === "none") return this.rookieChoices();          // §5
  const n = Math.random() < extraCardChance(this.luck) ? 4 : 3;
  const voc = this.vocationCandidates();   // eligible nodes + grades of known spells (both count as path cards)
  const uni = this.universalCandidates();  // imbuements (4 slots), protect, prey, luck
  const out: LevelChoice[] = [];
  const forced = this.pityKeystone();      // §3.2
  if (forced) out.push(forced);
  // Two vocation cards. Paths you've put points in weigh x2, a path with a pending keystone x3, so a build
  // keeps coming back without locking the others out. Never two cards for the same node.
  while (out.length < 2 && voc.length) out.push(this.drawWeighted(voc, (c) => this.pathWeight(c)));
  // One universal card (two if the 4th card shows up and a coin flip says so).
  out.push(...shuffle(uni).slice(0, n - out.length >= 2 && Math.random() < 0.5 ? 2 : 1));
  // Then Mastery (if a path is maxed), training, potions, gold, as today.
  for (const f of this.fillers()) if (out.length < n) out.push(f);
  return out.slice(0, n).map((c) => this.withRarity(c));
}
```

`withRarity()` keeps its signature. For `node` cards it rolls first and then picks the card's form. A rolled Epic on a path with an eligible keystone swaps the node for the keystone half the time (`swapToKeystone`). That's why vocation cards are rolled before they're chosen: the slot's rarity can change which card it holds. `Game.openChest` keeps calling `ch.rollChoices()[0]` for its free picks, and those are now path cards two times in three.

---

## 4. The card pools

Legend: **Real** = a real Tibia mechanic and name. **Named** = a real Tibia name (a spell, a Wheel perk, a Forge tier, a creature) on an effect of ours. **Inv.** = invented, added to README's "Not real".
Minor nodes list ranks I / II / III. A fresh Common card gives rank I, a Rare card rank II, an Epic card rank III.
Notables list ranks I / II. Rare gives rank I, Epic gives II.
Path points: 1 per rank of a minor or notable node, plus 1 per Wheel grade of the path's spells. Keystones and revelations do not count.

**Early levels matter most.** In the sim (§10.4) a mage ends a 60-minute run at a median of level 9 (sorcerer) or 11 (druid), mostly before Fire Wave or Ice Wave (level 18). So element-keyed nodes also trigger on **wand and rod hits of their element**. A wand of vortex is energy, so it feeds Storm Caller; a snakebite rod is earth, so it feeds Earthshaper. That way a path changes play from level 9. In code, `weaponAttack`'s wand branch passes `{ src: "weapon", spellLike: true }`, and element hooks accept `spellLike`.

### 4.1 Sorcerer

| Path | Spells (grades count here) | Identity |
|---|---|---|
| **Storm Caller** | Energy Strike, Energy Beam, Great Energy Beam, Energy Wave, Rage of the Skies, Strong / Ultimate Energy Strike | Long beams, chain lightning, free casts |
| **Death Mage** | Death Strike, Flame Strike, Fire Wave, Strong / Ultimate Flame Strike, Hell's Core, Great Death Beam | Burns, spell echo, kill resets |
| **Rune Master** | all attack runes (heavy magic missile → sudden death), conjuring | Charges saved, runes off the spell cooldown |

**Storm Caller**

| Card | Tier | I | II | III | Origin | Effect |
|---|---|---|---|---|---|---|
| Arc Conduit | minor | 25% | 35% | 50% | Inv. | Energy spell hits arc to 1 more creature within 2 tiles for X% damage |
| Static Charge | minor | 10% | 20% | 30% | Named (Tibia's *electrified* condition) | Energy hits electrify: X% of the hit over 4 ticks of 2 s |
| Widening Beam | minor | +1 | +2 | +3 | Inv. | Beams are X tiles longer (Energy Beam 5 → 8, Great Energy Beam 8 → 11) |
| Mana Weave | notable | 8% | 15% | — | Inv. | Attack spells cost no mana X% of the time |
| Overcharge | notable | +20% | +35% | — | Inv. | Above 80% mana, attack spells cost +50% mana and deal +X% |
| **Beam Mastery** | keystone | — | — | — | Real (Wheel of Destiny perk) | Beams −2 s cooldown and +8% damage per creature hit beyond the first (max +40%) |
| **Avatar of Storm** | revelation | — | — | — | Real (Wheel revelation) | Every 90 s, for 15 s: every attack spell crits (+25% crit damage), costs no mana, and you take 15% less damage |

**Death Mage**

| Card | Tier | I | II | III | Origin | Effect |
|---|---|---|---|---|---|---|
| Searing | minor | 10% | 20% | 30% | Real (Tibia's *burning* condition) | Fire hits burn: X% of the hit over 5 ticks of 2 s |
| Soul Harvest | minor | 1% | 2% | 3% | Inv. | A kill with death damage restores X% max mana |
| Momentum | minor | 5% | 10% | 15% | Named (Exaltation Forge helmet tier) | A kill with a spell resets its cooldown X% of the time |
| Spell Echo | notable | 10% | 18% | — | Inv. | An attack spell recasts 0.4 s later at 50% power on the same tiles (no mana, no cooldown) X% of the time |
| Hellfire | notable | +1 tile, +10% | +1 tile, +20% | — | Inv. | Fire Wave and Hell's Core reach 1 tile further and deal +X% to burning creatures |
| **Drain Body** | keystone | — | — | — | Real (Wheel revelation perk) | Death and fire spells leech 4% life and 2% mana, and deal +15% to creatures under 30% health |
| **Ferumbras' Legacy** | revelation | — | — | — | Named (Ferumbras) | Hell's Core, Ultimate Flame Strike and Great Death Beam always echo (at 60%), and their cooldowns drop 25% |

**Rune Master**

| Card | Tier | I | II | III | Origin | Effect |
|---|---|---|---|---|---|---|
| Runic Mastery | minor | +8% | +16% | +24% | Real (Wheel conviction perk) | Rune damage +X% |
| Thrifty Charges | minor | 10% | 20% | 30% | Inv. | A rune keeps its charge X% of the time |
| Bulk Conjuring | minor | +1 | +2 | +3 | Inv. | Conjuring makes X more runes (great fireball 4 → 7, sudden death 3 → 6) |
| Rune Weaving | notable | 25% | 50% | — | Inv. | A rune doesn't trigger the attack group cooldown X% of the time, so a spell can follow at once |
| Area Runes | notable | +15% | +15%, +1 radius | — | Inv. | Great fireball, avalanche and thunderstorm deal +15%, and at II their circle grows from 3×3 to 5×5 |
| **Rune Cascade** | keystone | — | — | — | Inv. | Every 4th rune also fires a free copy at the nearest other creature in range |
| **Arcane Barrage** | revelation | — | — | — | Inv. | Using 3 runes within 6 s opens an 8 s window where runes have a 0.5 s group cooldown (90 s cooldown) |

### 4.2 Druid

| Path | Spells | Identity |
|---|---|---|
| **Frostwarden** | Ice Strike, Ice Wave, Strong Ice Wave, Eternal Winter, Strong / Ultimate Ice Strike, icicle and avalanche runes | Slow, root, shatter |
| **Grovekeeper** | Light / Intense / Ultimate Healing, Mass Healing, intense / ultimate healing runes, Recovery | Heals that hurt, regeneration |
| **Earthshaper** | Terra Strike, Terra Wave, Wrath of Nature, Strong / Ultimate Terra Strike, stalagmite and stone shower runes | Poison that stacks and spreads |

**Frostwarden**

| Card | Tier | I | II | III | Origin | Effect |
|---|---|---|---|---|---|---|
| Chill | minor | 10% | 20% | 30% | Named (Tibia paralysis, speed formula) | Ice hits slow the creature by X% speed for 3 s |
| Deep Freeze | minor | 4% | 8% | 12% | Named (Cripple's root) | Ice hits root for 3 s X% of the time |
| Shatter | minor | +10% | +20% | +30% | Inv. | +X% damage to slowed or rooted creatures (Cripple and Numb roots count) |
| Glacial Reach | notable | +1 | +2 | — | Inv. | Ice Wave and Strong Ice Wave reach X tiles further |
| Frost Armor | notable | 5% | 10% | — | Inv. | Creatures that hit you in melee are slowed 30% for 2 s, and you take X% less damage from slowed creatures |
| **Twin Bursts** | keystone | — | — | — | Real (Wheel revelation: Ice Burst) | Every 12 s your next ice spell also bursts 3×3 around its first target for 100% of the hit and roots them 2 s |
| **Glacial Grasp** | revelation | — | — | — | Named (Eternal Winter) | Eternal Winter's cooldown drops from 40 s to 20 s, it roots everything it hits for 4 s, and rooted creatures that die burst for 20% of their max health as ice on their neighbours |

**Grovekeeper**

| Card | Tier | I | II | III | Origin | Effect |
|---|---|---|---|---|---|---|
| Regrowth | minor | 10% | 20% | 30% | Inv. | Heals leave a heal over time: X% of the heal again over 6 s |
| Nature's Splash | minor | 50% | 75% | 100% | Inv. | Healing past max health becomes earth damage, split among adjacent creatures at X% |
| Wellspring | minor | +15% | +30% | +45% | Inv. | Mana regeneration +X% |
| Deep Roots | notable | +10% | +20% | — | Inv. | Heals +X% while you haven't moved for 1 s |
| Thorns | notable | 5% | 10% | — | Inv. | X% of the melee damage you take is reflected as earth |
| **Nature's Embrace** | keystone | — | — | — | Named (druid spell) | Every heal pulses: creatures within 2 tiles take earth damage equal to 40% of the healing, overheal included |
| **Blessing of the Grove** | revelation | — | — | — | Real (Wheel revelation) | Heals +25%. Overheal is kept as a shield of up to 20% max health, and every 3rd heal heals double |

**Earthshaper**

| Card | Tier | I | II | III | Origin | Effect |
|---|---|---|---|---|---|---|
| Venom | minor | 15% | 25% | 35% | Real (Tibia's *poisoned* condition) | Earth hits poison: X% of the hit over Tibia's decaying poison ticks |
| Contagion | minor | 1 | 2 | 3 | Inv. | A poisoned creature that dies passes what's left of its poison to X neighbours |
| Spore Field | minor | 1 | 2 | 3 | Real (poison field item) | Terra Wave leaves a poison field on X of the tiles it hit for 6 s |
| Rot | notable | 8% | 15% | — | Inv. | Poisoned creatures deal X% less damage |
| Overgrowth | notable | −8 s | −15 s | — | Inv. | Wrath of Nature's cooldown drops by X (40 s → 25 s) |
| **Plague Bearer** | keystone | — | — | — | Inv. | Your poisons stack (a new one adds to the old one; Tibia only replaces a weaker one) and tick 25% faster |
| **Avatar of Nature** | revelation | — | — | — | Real (Wheel revelation) | Every 90 s, for 15 s: every hit crits (+25%), poison ticks double, and you take 15% less damage |

### 4.3 Knight

| Path | Spells | Identity |
|---|---|---|
| **Berserker** | Berserk, Fierce Berserk, Annihilation, Blood Rage (stance) | Double strikes, crowds, Blood Rage all the time |
| **Juggernaut** | Wound Cleansing family, Protector (stance), Recovery | Blocks, retaliation, healing from being surrounded |
| **Warlord** | Brutal Strike, Whirlwind Throw, Groundshaker, Front Sweep | Exori rotation, cleave, Onslaught |

**Berserker**

| Card | Tier | I | II | III | Origin | Effect |
|---|---|---|---|---|---|---|
| Twin Strike | minor | 8% | 14% | 20% | Inv. | A weapon attack hits twice X% of the time |
| Bloodlust | minor | +2 s, 110% | +4 s, 105% | +6 s, 100% | Named (utito tempo) | Blood Rage lasts X longer (10 → 16 s), and damage taken during it drops from 115% |
| Frenzy | minor | +3% | +5% | +7% | Inv. | +X% melee damage per adjacent creature (max 4) |
| Rampage | notable | +1 s, 2% | +2 s, 4% | — | Inv. | A kill during Blood Rage extends it and heals % max health |
| Reckless | notable | −1 s, +10% | −2 s, +20% | — | Inv. | Berserk and Fierce Berserk lose cooldown, and get +crit chance below 50% health |
| **Battle Instinct** | keystone | — | — | — | Named (Wheel conviction perk) | Weapon hits on a creature with 2+ others adjacent to you cleave 50% to all of them. Blood Rage auto-casts with 1 adjacent creature (instead of 2) |
| **Avatar of Steel** | revelation | — | — | — | Real (Wheel revelation) | Every 90 s, for 15 s: every hit crits (+25%), you take 15% less damage, and Blood Rage keeps your shield up |

**Juggernaut**

| Card | Tier | I | II | III | Origin | Effect |
|---|---|---|---|---|---|---|
| Iron Wall | minor | +1 | +2 | +3 | Named (Creature::blockCount) | +X max blocks (2 → 5), still +1 per second |
| Retaliation | minor | 6% | 12% | 18% | Inv. | A melee hit on you strikes back for a full weapon attack X% of the time |
| Bulwark | minor | +3 s, 75% | +6 s, 85% | +9 s, 95% | Named (utamo tempo) | Protector lasts longer (13 → 22 s), and its damage dealt rises from 65% |
| Second Wind | notable | +50% | +100% | — | Inv. | Wound Cleansing heals +X% below 30% health |
| Shield Bash | notable | 50% | 100% | — | Inv. | Each blocked hit deals X% of shielding × level / 5 to the attacker |
| **Battle Healing** | keystone | — | — | — | Real (Wheel conviction perk) | Heal 1% max health per adjacent creature every 2 s (max 5%) |
| **Combat Mastery** | revelation | — | — | — | Real (Wheel revelation) | With a shield, Protector no longer lowers damage dealt, and every 5 blocks charge a 300% weapon strike on all adjacent creatures |

**Warlord**

| Card | Tier | I | II | III | Origin | Effect |
|---|---|---|---|---|---|---|
| Weapon Drill | minor | −0.5 s | −1 s | −1.5 s | Inv. | Exori spell cooldowns −X (Brutal Strike 6 s → 4.5 s) |
| Cleave | minor | 25% | 40% | 55% | Inv. | Weapon attacks also hit 1 adjacent creature for X% |
| Onslaught | minor | 4% | 8% | 12% | Real (Exaltation Forge weapon tier: +60% damage) | X% of hits deal 60% extra damage |
| Shockwave | notable | +1, 1 s | +1, 2 s | — | Inv. | Groundshaker's circle grows from 3×3 to 5×5 and roots for 1/2 s |
| Whirlwind | notable | 1 | 2 | — | Inv. | Whirlwind Throw bounces to X more creatures |
| **Weapon Dance** | keystone | — | — | — | Inv. | Each exori that hits takes 1 s off every other exori's cooldown |
| **Executioner's Throw** | revelation | — | — | — | Real (Wheel revelation spell) | Auto-cast every 18 s: throws your weapon for 300% weapon damage, +100% below 30% health, bouncing to 2 more creatures |

### 4.4 Paladin

| Path | Spells | Identity |
|---|---|---|
| **Marksman** | weapon attacks, Sharpshooter (stance) | Ricochet, pierce, multishot |
| **Skirmisher** | Ethereal Spear, Strong Ethereal Spear, spears | Spears saved, kiting, staying out of reach |
| **Holy Avenger** | Divine Missile, Divine Caldera, holy missile rune, Divine Healing, Salvation | Holy marks, consecrated ground |

**Marksman**

| Card | Tier | I | II | III | Origin | Effect |
|---|---|---|---|---|---|---|
| Ricochet | minor | 10% | 20% | 30% | Inv. | A hit bounces to a 2nd creature within 3 tiles for 60%, X% of the time |
| Piercing Shot | minor | 30% | 45% | 60% | Inv. | Attacks also hit the creature behind the target for X% |
| Steady Aim | minor | +5% | +10% | +15% | Named (distanceHitChance) | +X hit chance with bows, crossbows and spears |
| Multishot | notable | 15% | 30% | — | Inv. | Fire at 2 extra creatures X% of the time |
| Deadeye | notable | +3 s | +6 s, no slow | — | Named (utito tempo san) | Sharpshooter lasts longer, and at II it no longer slows you |
| **Ballistic Mastery** | keystone | — | — | — | Real (Wheel conviction perk) | Ammunition hits get a 10% crit chance (even without Strike) and +30% crit damage. Pierce and ricochet can crit |
| **Avatar of Light** | revelation | — | — | — | Real (Wheel revelation) | Every 90 s, for 15 s: attacks hit 3 creatures, always crit (+25%), and you take 15% less damage |

**Skirmisher**

| Card | Tier | I | II | III | Origin | Effect |
|---|---|---|---|---|---|---|
| Spear Recovery | minor | 20% | 40% | 60% | Named (breakchance) | A spear that breaks isn't used up X% of the time |
| Hit and Run | minor | +10% | +20% | +30% | Inv. | The first weapon attack within 1 s of a step deals +X% |
| Light Feet | minor | +10 | +20 | +30 | Inv. | +X speed while a creature is within 3 tiles |
| Ethereal Volley | notable | 1 | 2 | — | Inv. | Ethereal Spear hits X more creatures |
| Evasion | notable | 5% | 10% | — | Inv. | X% dodge while you're moving |
| **Positional Tactics** | keystone | — | — | — | Real (Wheel conviction perk) | +20% damage to creatures 4+ tiles away, and 10% less damage from creatures 2+ tiles away |
| **Spear Storm** | revelation | — | — | — | Named (Strong Ethereal Spear) | Strong Ethereal Spear's cooldown drops from 8 s to 4 s, and it hits every creature within 5 tiles of the target |

**Holy Avenger**

| Card | Tier | I | II | III | Origin | Effect |
|---|---|---|---|---|---|---|
| Holy Mark | minor | +8% | +14% | +20% | Inv. | Divine Missile marks its target for 6 s, and marked creatures take +X% from everything |
| Consecration | minor | 10% | 20% | 30% | Inv. | Divine Caldera leaves holy ground for 4 s, dealing X% of its hit each second |
| Zeal | minor | +6% | +12% | +18% | Inv. | +X% holy damage to creatures weak to holy (undead, demons) |
| Absolution | notable | +15% | +30% | — | Inv. | Divine Healing and Salvation heal +X%, and pulse 50% of the heal as holy damage around you |
| Purge | notable | 1 | 2 | — | Inv. | A marked creature that dies marks X neighbours |
| **Divine Empowerment** | keystone | — | — | — | Real (Wheel revelation) | Every 30 s, consecrate the 3×3 under you for 5 s: +25% damage while you stand in it |
| **Divine Grenade** | revelation | — | — | — | Real (Wheel revelation spell) | Auto-cast every 15 s on a marked creature (or your target): explodes after 2 s for 400% of Divine Missile's damage, 3×3 |

### 4.5 Rookie (levels 1–8)

Rookies get a small pool of four **Callings** plus the fillers and Luck. Run bonuses also show up here in Rookgaard, since that's where reaching level 8 matters most.

| Card | Now (rookie) | At level 8, if it matches your vocation |
|---|---|---|
| Calling: the Blade | +1 melee skill per rank | Knight: 1 free point per rank in Berserker, Juggernaut or Warlord (your pick on the vocation screen) |
| Calling: the Bow | +5% distance hit chance per rank | Paladin: 1 point per rank in a path of your choice |
| Calling: the Flame | Spell damage +5% per rank | Sorcerer: same |
| Calling: the Grove | Healing +10% per rank | Druid: same |

Each card shows the three path names of its vocation, so the vocation choice is previewed on level 2. A character whose vocation is already locked (meta.ts `CharacterSave.vocation`) sees its own Calling twice as often. Callings for other vocations give nothing at 8, and the card says so.

### 4.6 Universal pool (everyone)

| Card | Today | Proposed |
|---|---|---|
| Vampirism, Void, Strike, Swiftness | imbuements, 6 slots | Same values, **4 slots** (weapon, helmet, armor, boots) |
| Protection | 6 separate imbuements | **One card**: the element of the zone's commonest attacker (Dragon Hide in the Dragon Lair, Lich Shroud in the Vampire Crypt), 3/8/15% |
| Elemental (Scorch… Reap), skill (Bash… Epiphany) | imbuements | Kept, inside the 4 slots |
| Prey | 1 card | Unchanged |
| Luck | 1 card, +5/10/15/25 | Unchanged |
| Training, potions, gold | fillers | Unchanged. Mastery replaces them once a path is maxed |
| Run bonuses (XP, gold, loot, skill, magic) | up to 2 per level-up | **Removed from level-ups.** Boss chest picks and rookie cards only |
| **Gift of Life** | — | Universal revelation-tier card (Real, Wheel perk shared by all vocations): once per run a lethal hit leaves you at 1 HP, heals 30% and gives 2 s without damage. Legendary-only, and doesn't count against the one revelation |

---

## 5. How the old systems change

| System | Change | Code |
|---|---|---|
| **Imbuements** | 6 → 4 slots. Protections merge into `kind: "protect"` with a zone element. Leech's only home stays here | `MAX_SLOTS` (upgrades.ts) → `IMBUE_SLOTS = 4`. `IMBUEMENTS` keeps the six protect defs for `Character.absorb`; `rollChoices` offers a single `{ kind: "protect" }` and `applyChoice` resolves the element from `Game.zoneAt(player)` through `ch.zoneElement` |
| **Charms** | Vampiric Embrace and Void's Call are removed (1.6%/0.8% next to Vampirism's 25%). Low Blow's text now says "with Strike or a crit source". The rest stay unslotted, 3 tiers, offered at bestiary stages. Charms are the "creature" layer: procs | `PLAYABLE` (picks.ts) drops 2 names. `damageMonster` lines 1256–1257 drop the `charmValue` terms. Low Blow's condition becomes `critChance > 0` so Ballistic Mastery and the avatars feed it |
| **Spell grades** | Kept with their real Wheel data. Every gradable spell belongs to one path, its grade cards appear in the vocation pool, and each grade is a path point. The flat +5/10/15% stays only for spells the Wheel doesn't touch | `PathDef.spells`. `vocationCandidates()` takes over the `grades` block of `rollChoices`. `pathPoints()` adds `this.grades.get(file)` |
| **Prey** | Unchanged, universal | — |
| **Luck** | Unchanged (0–100). It now also speeds up keystones, since 7% Epic becomes 15% at 50 luck | — |
| **Boosts** | Unchanged. New soul track **Path Attunement** (meta.ts `TRACKS`): start runs with 1/2/3 points in a path picked on the vocation screen, for 150/400/1000 souls | `TRACKS.push({ id: "attune", ... })`, applied in `applyUnlocks` (unlocks.ts) when the vocation is chosen |
| **Evolutions** | Economy evolutions unchanged. Combat ones are re-tied to paths: **Blood Rage** = Powerful Vampirism + Battle Instinct; **Mastermind** = Magic Training 10 + Void + any sorcerer/druid keystone; **Elemental Burst** = Powerful elemental + a Marksman or Warlord keystone. The evolution "Avatar of Steel" is renamed **Steel Skin** (the name goes to the knight's revelation) | `EVOLUTIONS[].ready` (evolutions.ts) gains `ch.nodes.has(...)`, and the id `avatarsteel` → `steelskin` |
| **Run bonuses** | Out of level-ups, into boss chest picks (`openChest` draws from `RUN_BONUSES` for 1 of its 1/3/5 picks) and the rookie pool | `rollChoices` drops the `bonuses` block. `openChest` adds `{ kind: "bonus" }` |

---

## 6. Combat hooks (game.ts)

All hooks read `ch.mods`, which is precomputed. None of them walk the node list during combat.

### 6.1 `cast(s, dir, target)` (game.ts ~1588)

```ts
const m = ch.mods;
// Mana Weave / avatar: free cast
const free = (this.avatarUntil > this.time && m.avatar) || Math.random() * 100 < m.freeCast;
if (s.kind === "rune") {
  if (Math.random() * 100 >= m.runeSave) ch.supplies.set(s.runeId!, left - 1);          // Thrifty Charges
} else if (s.mana && !free) this.advance(ch.spendMana(cost));
// Overcharge: costs more and hits harder above the threshold
let k2 = 1;
if (m.overcharge && ch.mana >= ch.maxMana * m.overcharge.above / 100) { extraMana(...); k2 += m.overcharge.dmg / 100; }
// Cooldowns: Wheel grade, Mastermind, then flat path cuts (Weapon Drill, Beam Mastery, Overgrowth)
this.spellReady.set(s.file, this.time + Math.max(1, base * mm - (grade.cooldown ?? 0) - (m.spellCdFlat[s.file] ?? 0)));
// Rune Weaving: sometimes a rune skips the shared attack group cooldown
if (!(s.kind === "rune" && Math.random() * 100 < m.runeOwnGroup)) this.groupReady[group] = ...;
...
const hits = this.spellTiles(s, dir, target, m.areaGrow[s.file]);    // spellTiles gains an `extra` param
for (...) { this.damageMonster(mon, roll * k2 * pathMult(s), s.element, s.blockArmor, { spell: grade, src: s }); ... }
// Arc Conduit: chain from each struck creature
if (m.chain && s.element === m.chain.element) this.chainFrom(struck, m.chain);
// Spell Echo: queue a recast
if (s.group === "attack" && Math.random() * 100 < echoChance(s)) this.queue.push({ at: this.time + 0.4, s, dir, target, power: m.echoPower });
```

- **`spellTiles(s, dir, target, extra = 0)`**: for beam areas (`AREA_BEAM5`, `AREA_BEAM8`), append `extra` rows. For `AREA_CIRCLE3X3` with `extra ≥ 1`, use `AREA_CIRCLE5X5`, which `db.ts` already has for other spells. Waves get one more row.
- **Echo queue**: a new `private delayed: { at, fn }[]`, drained in `update()` next to the monster DoT loop (game.ts ~766). It is also used by Divine Grenade's 2 s fuse and Twin Bursts.
- **`pathMult(s)`** is the Mastery stacks plus Runic Mastery for runes. It also feeds `autocast.expected()` (§7).

### 6.2 `damageMonster(m, dmg, el, useArmor, from)` (game.ts ~1228)

`from` gains `src?: SpellData | "weapon" | "echo" | "cleave" | "proc"`. That lets procs refuse to proc again: echoes don't echo and cleaves don't cleave.

```ts
// after prey and stance:
if (m.markedUntil > this.time) dmg *= 1 + ch.mods.markPct / 100;                          // Holy Mark
if (this.controlled(m)) dmg *= 1 + ch.mods.vsControlled / 100;                            // Shatter
if (from.src === "weapon" && Math.random() * 100 < ch.mods.onslaught) dmg *= 1.6;         // Onslaught (real: +60%)
// crit: avatar => 100% chance; Ballistic Mastery adds a 10% base for ammunition
// after the hit lands:
if (!from.charm && from.src !== "proc") this.applyConditions(m, dealt, el);              // burn, poison, electrify, slow, root
```

- **`applyConditions`** uses the same `DamageCondition` shape as fields. `Monster.dot` becomes `dots: Partial<Record<Element, DamageCondition>>`, so a field burn and a Venom poison can both run. Each tick list follows Tibia's condition shape (poison: decaying ticks, burning: fixed ticks every 2 s). Without Plague Bearer, a new condition only replaces a weaker one, the same rule `hurtPlayer` already applies to the player. With it, the tick lists are summed.
- **Slow**: `Monster.slowUntil` and `Monster.slowPct`. `moveMonster` (game.ts ~739) multiplies the step duration by `100 / (100 - slowPct)`.
- **Root**: reuses `rootedUntil` (Cripple), so Shatter and Frost synergise with the existing charm.
- **Leech** (lines 1255–1257): imbuement + grade only (the charm terms go), plus Drain Body's 4% / 2% when `el` is death or fire.

### 6.3 `weaponAttack(m)` / `weaponHit(m, dmg)` (game.ts ~1470 / ~1515)

```ts
// weaponAttack, after a successful hit:
if (Math.random() * 100 < m.doubleStrike) this.weaponHit(target, rollAgain(), "double");     // Twin Strike
// missile branch: Spear Recovery
if (breaks && Math.random() * 100 < m.spearSave) breaks = false;
// distance / missile: Ricochet, Piercing Shot, Multishot
this.rangedExtras(target, dmg);   // picks extra targets from monstersInRange, src "proc"
// weaponHit, after the hit:
if (m.cleave) for (const o of adjacentToPlayer().filter(x => x !== target).slice(0, battleInstinct ? 8 : 1))
  this.damageMonster(o, dmg * (battleInstinct ? 50 : m.cleavePct) / 100, "physical", true, { src: "cleave" });
```

`weaponHit` gains a `src` param so a double strike can still cleave but a cleave can't double.

### 6.4 `hurtPlayer(dmg, el, m, melee)` (game.ts ~1109)

- **Iron Wall**: `blockCount` cap `2` → `2 + m.extraBlocks` at line 582 and its recharge.
- **Retaliation**: after a melee hit lands, roll `m.retaliate` and call `weaponHit(m, rollWeapon(), "proc")`.
- **Shield Bash**: when `hasBlock && sh`, deal `shielding × level / 5 × pct`.
- **Thorns**: reflect `reflectPct` of melee `dmg` as earth.
- **Frost Armor**: slow the attacker, and multiply `dmg` by `1 − slowedTakeLess` if it's slowed.
- **Evasion**: when `this.time − lastStep < 0.5`, roll `dodgeMoving` (the same code path as Dodge).
- **Positional Tactics**: if `cheb(m, player) ≥ 2`, take 10% less.
- **Avatar**: `dmg *= 1 − avatar.reduce / 100` while it's active.
- **Gift of Life**: checked in `loseHealth` before blessings.

### 6.5 Healing (`cast` healing branch, `usePotion`)

```ts
const raw = roll * (1 + m.lowHpHeal * (ch.hp < 0.3 * ch.maxHp ? 1 : 0) / 100) * deepRoots;
const healed = Math.min(raw, ch.maxHp - ch.hp), over = raw - healed;
if (m.hot) this.addHot(raw * m.hot / 100, 6);                                 // Regrowth
if (over > 0 && m.overhealSplash) this.splash(over * m.overhealSplash / 100);  // Nature's Splash
if (m.healPulse) this.pulse(2, raw * m.healPulse / 100, "earth");              // Nature's Embrace
```

### 6.6 Timers in `update(dt)`

- **Avatar of Storm / Nature / Steel / Light**: `avatarNext` and `avatarUntil`. It triggers on its own when a creature is within 4 tiles and the cooldown is up, so a hands-off player gets it. The HUD shows a buff icon.
- **Auto spells** (Executioner's Throw, Divine Grenade): `autoSpellNext`. They fire through `cast()` with synthetic `SpellData` from `paths.ts`, so they share all the hooks.
- **Divine Empowerment**: places a holy-ground "field" (a `Field` with a new synthetic id, so the renderer can show it) and checks `player in field`.
- **Battle Healing**: every 2 s, `heal(min(5, adjacent) × 1%)`.
- **Stances**: `support()` reads `m.stanceSec` and `m.stanceFix` when it starts a stance (support.ts values stay as Canary's; the path adds on top).

---

## 7. Auto-combat (autocast.ts)

Combat is fully automatic, so every card has to work for a player who only steers. Rules:

1. **Passive procs need nothing.** Free cast, echo, double strike, cleave, ricochet, conditions, Onslaught and blocks all sit inside `cast` and `weaponHit`.
2. **Spell choice knows the path.** `expected(g, s)` gets multiplied by `pathValue(g, s)`, which adds echo chance × echo power, the chain (+1 target × pct), the Overcharge bonus, Runic Mastery, Mastery stacks and vs-controlled on targets that are controlled. The bot then prefers the build's spells, and a Storm Caller casts beams over Hell's Core.
3. **Rune penalty.** `value *= 0.9` for runes becomes `0.9 + runeSave / 100` (capped at 1.1 with Thrifty Charges III), so Rune Masters lean on runes.
4. **Stance thresholds move into `PathDef.auto`:**

```ts
export interface AutoHints {
  bloodRageAt: number;     // adjacent creatures to start Blood Rage (default 2; Battle Instinct 1)
  protectorAt: number;     // health fraction to start Protector (default 0.45; Juggernaut 0.6)
  sharpshooterHp: number;  // default 0.6; Deadeye II drops the slow so 0.4
  healAt: number;          // HEAL_AT (default 0.6; Grovekeeper 0.8, since overheal is damage)
  healAsAttack: boolean;   // Nature's Embrace / Splash: heal spells count as attacks when creatures are adjacent
  conjureKeep: number;     // conjure up to (default 40; Rune Master 60)
}
```

`supportSpells()` reads `hints(g)`, the merge of the hints of every path you've put a point in, highest priority first, instead of the constants `HEAL_AT`, `0.45`, `0.6`, `near >= 2` and `have < 40`.

5. **Heals as attacks (Grovekeeper).** When `healAsAttack` is on, the attack loop also scores healing spells: `value = pulse × creatures in 2 tiles + splash × adjacent`. That way Mass Healing gets cast in a crowd at full health.
6. **Movement-based cards** (Hit and Run, Evasion, Light Feet, Deep Roots) only reward what the player already does: steering, or standing still. Chase mode counts as moving, so a hands-off paladin still gets about half of Hit and Run's value (sim check, §10).
7. **Recommended card.** The level-up screen stars the card from your most-invested path (ui.ts). That costs nothing and helps players who don't read cards.

---

## 8. Save migration (meta.ts)

Runs aren't saved mid-run (`writeSave` is only called between runs, from main.ts and meta.ts), so no in-run state needs migrating.

```ts
export interface Save {
  ...
  version?: number;                           // 4: paths
  paths?: {
    keystones: string[];                      // keystone ids ever taken: the Paths codex, and achievements
    revelations: string[];                    // revelation ids ever taken
    attune?: PathId;                          // the path Path Attunement puts its points in
  };
}

function migrate(s: Save): Save {
  if ((s.version ?? 2) < 3) { /* existing v3 gear refund, unchanged */ }
  if (s.version === 3) {
    s.paths = { keystones: [], revelations: [] };
    // The Avatar of Steel evolution was renamed: nothing stored references evolutions, so nothing to rewrite.
    s.version = 4;
  }
  return s;
}
```

- The current `migrate` returns early when `version >= 3`. That becomes a chain of `if` steps.
- `fresh()` sets `version: 4` and `paths: { keystones: [], revelations: [] }`.
- `TRACKS` gains `attune` (§5). `unlocks` is a `Record<string, number>`, so older saves read 0.
- Boosts aren't touched. `MAX_SLOTS` (6) only limited imbuements in a run, so lowering it to 4 doesn't touch saves.

---

## 9. UI

### 9.1 Level-up card (ui.ts `levelUp`, ~line 193)

- New `card()` branches for `node`, `mastery`, `calling` and `protect`.
- A coloured ribbon with the path name (Storm Caller `#4fc3ff`, Death Mage `#c0392b`, Rune Master `#d4a017`; Frostwarden `#8fd8ff`, Grovekeeper `#6fcf5a`, Earthshaper `#a0782a`; Berserker `#e03c31`, Juggernaut `#9aa7b0`, Warlord `#e08a2c`; Marksman `#c7e36b`, Skirmisher `#5fd3a6`, Holy Avenger `#ffe08a`).
- Rank pips (●●○), and "Storm Caller 4 → 5: keystone unlocked!" when a pick crosses `KEYSTONE_AT`.
- An origin tag on the card's foot: "Wheel of Destiny", "Exaltation Forge", "Tibia condition", or nothing for invented ones.
- Keystones get an Epic frame with a gold inner border. Revelations get a Legendary frame and a full-width art band with the spell's effect sprite.
- The "Recommended" star (§7.7).

### 9.2 Upgrades window (hud.ts `upgrades`, ~line 892)

A new section on top, **Paths**: three bars per vocation (points / 12, with the keystone marker at 5), then the nodes you own with their ranks. "Spells" keeps listing grades, but grouped under their path. The `Imbuements` header becomes `x/4`. Evolutions stay.

### 9.3 Vocation screen (ui.ts `chooseVocation`) and the title screen

- Each vocation card lists its three paths with one line each, and the Calling points you'll bring.
- Path Attunement shows up as a track in the unlocks shop.
- New **Codex** tab on the title screen: every path's keystone and revelation, greyed until you've taken it once (from `Save.paths`). This is the meta goal that Last Epoch's mastery codex gives players.

---

## 10. Balancing plan (sim)

### 10.1 Baseline (today)

Measured with `npm run sim -- <voc> 16` on a fresh campaign. The bot buys unlocks and boosts between runs, and each run is up to 60 min. The numbers are in §10.4. In early runs most bots die in Rookgaard. A fresh account needs about 3 runs of souls before reaching level 8 is routine, so balancing must use a seeded "veteran" save (§10.2), not a fresh one.

### 10.2 Harness changes (tools/simulate.ts, src/sim.ts)

- `--save veteran`: start from a fixed save (all Rookgaard unlocks, boosts at 3), so runs reach the mainland and paths matter.
- `--path storm` (or `--path auto`): the bot ranks level-up cards as path card of that path > keystone > universal > filler. `auto` follows whichever path it got first. This is also the "hands-off player" model.
- New stats in `Game.stats`: `dealtBy: Record<string, number>` keyed by `from.src` and node id. It shows how much damage Echo, Cleave, Venom and so on contribute.
- New per-minute row columns: level, zone, kills/min, damage/min, potions used, deaths.

### 10.3 Targets

| Metric | Target |
|---|---|
| Level at 30:00 and 60:00, per path | Within ±15% of its vocation's median across its 3 paths |
| Vocation medians | Today the spread is 3–4x (§10.4). Halve it by the end of Phase 4, and reach ±20% after tuning |
| Survival to 60:00 | No path below 0.7× the best path of its vocation |
| A single node's share of damage | ≤ 25% (procs shouldn't do all the work); revelations ≤ 35% while active |
| Hands-off penalty | `--path auto` within 10% of the best fixed path (the bot isn't an expert, and builds shouldn't need one) |
| Free resources | Mana Weave + Thrifty Charges + Rune Weaving: mana potions used per minute ≥ 50% of baseline (sorcerers still buy supplies) |

### 10.4 Baseline numbers (measured 2026-10-22, `main` @ 11b8cb0)

`npm run sim -- <voc> 16`, a fresh campaign per vocation. Only runs where the bot reached level 8 and took the vocation are counted.

| Vocation | Runs counted | Median level at end | Best | Magic level / main skill | Deepest zone |
|---|---|---|---|---|---|
| Knight | 14 | 34.5 | 50 | axe 24–61 | Cyclopolis, Ancient Tombs |
| Paladin | 12 | 9.5 | 15 | distance 18–38 | Troll Woods |
| Sorcerer | 13 | 9 | 19 | ml 0–27 | Orc Fortress |
| Druid | 13 | 11 | 25 | ml 0–38 | Minotaur Hills |

Two consequences for this plan:

1. **Paths must work from level 9.** In 12 of 13 sorcerer runs the bot never reached Fire Wave (level 18), and no paladin run reached Ethereal Spear (23). That's why element nodes trigger on wand and rod hits (§4) and every path has at least two minors that need no high-level spell.
2. **The vocation spread is already 3–4x** (the knight is helped by skill-advance picks: up to ~50 per hour from axe and shielding). The ±20% vocation target in §10.3 is a goal, not "don't widen it". Phase 1 should measure whether Sorcerer paths close part of the gap before we tune the knight down.

### 10.5 Tuning knobs, in order

1. Node values (the tables in §4: one array each).
2. `KEYSTONE_AT` / `REVELATION_AT` (5 / 12).
3. Path weighting in `rollChoices` (x2 invested, x3 pending keystone).
4. Avatar cadence (90 s / 15 s).
5. Universal share (1 card of 3).

---

## 11. Phased rollout

Each phase ships behind a `PATHS` flag in data.ts. With the flag off, `rollChoices` runs the current code, so `main` stays shippable and the sim can A/B both.

| Phase | Scope | Est. (dev-days) | Gate |
|---|---|---|---|
| **0. Framework** | `paths.ts` types, `Mods`, `recomputeMods`, `rollChoices` rewrite with pity and chest revelations, `LevelChoice` kinds, ui.ts card, hud Paths section, sim `--path` and `dealtBy`, `delayed` queue, `dots` per element | 5 | With the flag on and no paths defined, the sim matches baseline within noise |
| **1. Sorcerer** | 21 cards, `cast()` hooks (free cast, echo, chain, overcharge, area growth, rune save / own group), `pathValue` in autocast | 6 | §10.3 targets for the 3 sorcerer paths |
| **2. Knight** | `weaponHit` hooks (double, cleave, Onslaught), blocks, retaliation, stance upgrades, Battle Healing, Executioner's Throw, autocast stance hints | 6 | Same |
| **3. Druid** | conditions (slow, root, poison stacking and spread), heal hooks, heals as attacks in autocast, Glacial Grasp | 7 | Same, plus the hands-off check for Grovekeeper |
| **4. Paladin** | ranged extras (ricochet, pierce, multishot), marks, holy ground field, Divine Grenade, movement-based cards | 6 | Same, plus the chase-mode check |
| **5. Universal and cleanup** | 4 slots, protect merge, charm removals, run bonuses into chests, evolution re-ties, Callings, Path Attunement, Codex, save v4, SKILLS.md / README "Not real" updates | 4 | Full sim pass for all vocations, and a save from `main` loads |
| | **Total** | **~34 days (≈ 6–7 weeks)** | |

Sorcerer goes first because nearly all its hooks are in `cast()` and its mechanics (free cast, echo) are the easiest to see. If the owner wants a cheaper first look: Phase 0 + Sorcerer alone is about 11 days, and the other vocations keep today's system behind the flag.

---

## 12. Risks

| Risk | Mitigation |
|---|---|
| Card count (84 path cards + universal) is a lot to balance | Phases, a sim gate per vocation, all values in arrays, and the `dealtBy` share cap |
| Procs on procs (echo → chain → conditions → Contagion) snowball or slow the frame | `from.src` blocks re-proccing, and conditions apply only on primary hits. Contagion spreads at most 3. The echo queue has one pending echo per spell |
| It drifts from "real Tibia inside a run" | Every card carries `origin`, and invented ones go into README's "Not real". Values build on real numbers (Onslaught's 60%, conditions' tick shapes, Canary stance values) |
| Keystones feel luck-gated | Pity within 3 level-ups, and revelations from boss chests |
| Hands-off players miss the point of movement cards | Movement is only on 4 of 84 cards, and only in Skirmisher and Grovekeeper. Chase mode counts as moving. The Recommended star helps |
| Losing generic picks (XP run bonus) slows leveling | Run bonuses move to chests (1 pick of each chest's 1/3/5) and the boosts are untouched. The sim compares level at 60:00 |
| Evolution recipes change under people | Evolutions are found in a run, not saved, so there's nothing to migrate |

---

## 13. Open questions for the owner

1. **Hybrids:** two keystones per run (this proposal), or one, or three? Two keeps identity and still lets people make a Storm/Rune sorcerer.
2. **Path Attunement price:** 150/400/1000 souls. Should it sit behind Dawnport?
3. **Run bonuses:** remove them from level-ups entirely (proposed), or keep one as the 4th card?
4. **Imbuement slots:** 4 (proposed), or keep 6 with the protection merge only?
5. **Paladin's holy mark** is invented. Is a named Tibia mechanic preferred (e.g. tie it to the *Divine Dazzle* spell), even though it isn't in the Canary data we use?
6. **Codex:** account-wide or per character? (Per character matches today's souls and bestiary.)
