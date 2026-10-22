# Play Tibia's Endgame in 30 Minutes: implementation

Engineering backing for the pitch in [index.html](index.html). Author: Ana Lucía "Lu" Ferreira.

Everything below references the code at `11b8cb0` and Canary pinned at `52550d5e3c0ffe565f4bd1014f4e5575abf1059b`
(the commit `tools/fetch_tibia_data.py` already uses). Values marked **(verify against Canary)** are from memory or
inferred; everything else was read from the Canary source while writing this.

---

## 0. Summary of the change

| System | Today | After | Real source |
|---|---|---|---|
| Level-up spine | 3-4 cards from 8 pools (imbuements, grades, prey, run bonuses, luck, fillers), rarity x1/x2/x3/x5 | **Wheel of Destiny**: 4 promotion points per level, placed on the vocation's wheel (36 slots, 4 domains), dedication + conviction + revelation perks, gem vessels | `io_wheel.cpp`, `player_wheel.cpp`, `wheel_gems.cpp`, `wheel_definitions.hpp` |
| Imbuements | 21 floating perks, 6 run slots, from cards | **On gear**: each item's real `imbuementslot` count and allowed types; applied at a shrine tab or with imbuement scrolls | `items.xml` (`imbuementslot`), `imbuements.xml` |
| Charms | 22 charms on every creature, 3 cards per bestiary stage per run | **Bestiary reward**: charm points from completing entries (across runs), bought between runs, **assigned to one creature each**, 2 slots (6 with the expansion unlock) | monster `Bestiary` blocks, `bestiary_charms.lua` `points`, `iobestiary.cpp` |
| Procs | Strike crit + invented evolutions (Blood Rage, Mastermind...) | **Exaltation Forge tiers**: fuse duplicates, tier capped by the item's real classification; Onslaught, Ruse, Momentum, Transcendence, Amplification | `item_tiers.lua`, `item.cpp`, `config.lua.dist` formulas, `combat.cpp`, `player.cpp` |
| Prey | 3 slots from cards | unchanged mechanics; offered as the "hunt" card; prey wildcards from boss chests | `ioprey.cpp` |
| Boosts | rates x2-x50, Luck | unchanged; Luck now moves quality (gems, prey stars, 4th card), not multipliers | (not real, by design) |
| Rarity | a multiplier on the card | the colour of a real quality: item classification, gem quality, prey star band | appearances `upgradeclassification`, `WheelGemQuality_t` |
| Evolutions | 8 invented recipes | retired; boss chests drop real endgame materials | `wheel_scrolls.lua`, forge cores, imbuement scrolls |

---

## 1. Data to extract from Canary

All new fields go into `src/tibia/data.json` through `tools/fetch_tibia_data.py`, so the "real Tibia" claim stays
reproducible from one pinned commit. New files to add to the fetch list (same `fetch()` cache):

| File | What we take | New data.json key |
|---|---|---|
| `data/items/items.xml` (already fetched) | `imbuementslot` value and its nested `<attribute key="life leech" value="3"/>` children (allowed category and max tier) | `items[id].imbue = { slots, allow: Record<Category, 1-3> }` |
| `data/items/appearances.dat` (already fetched for `cumulative`) | `AppearanceFlags` field **48** = `upgradeclassification` (sub-field 1 = classification 1-4). Checked: magic plate armor 2, crossbow 1, magician hat 3, chain bolter 4. **(verify field number against appearances.proto)** | `items[id].classification` |
| `data/XML/imbuements.xml` | per imbuement and base (1-3): name, category, effect value, materials (`item` + `count`), `scroll` id; `<base>` price, protectionPrice, percent, duration | `imbuements[]`, `imbuementBases[]` |
| `data/scripts/systems/item_tiers.lua` | per classification and tier: `regular` gold price, `core` count | `forge.tiers` |
| `config.lua.dist` | `ruse/onslaught/momentum/transcendence/amplificationChanceFormulaA/B/C`, `transcendenceAvatarDuration`, `forgeBaseSuccessRate` 50, `forgeBonusSuccessRate` 15, `forgeFusionDustCost` 100, `forgeAmountMultiplier` 3, `forgeMinSlivers` 3, `forgeMaxSlivers` 7, `wheelPointsPerLevel` 1 | `forge.formulas`, `forge.config` |
| monster files (already fetched) | `monster.Bestiary = { class, race, toKill, FirstUnlock, SecondUnlock, CharmsPoints, Stars }` | `monsters[k].bestiary` |
| `data/scripts/systems/bestiary_charms.lua` (already parsed by `parse_charms`) | add `points = { I, II, III }` per charm (the regex in `parse_charms` currently drops nested tables) | `charms[].points` |
| `src/io/io_wheel.cpp` (already fetched for grades) | slot functions `slotGreen200` ... `slotPurple200`: per vocation, dedication per point and the conviction on a full slot | `wheel.slots[]` (see 1.1) |
| `src/io/io_wheel.hpp` | `Revelation.stats` = {4,4}, {9,9}, {20,20} (flat damage/healing per stage) | `wheel.revelationStats` |
| `src/creatures/players/components/wheel/wheel_definitions.hpp` | `WheelSlots_t` 1-36, `WheelStagePointsEnum_t` 250/500/1000 | `wheel.layout` |
| `src/creatures/players/components/wheel/player_wheel.cpp` | revelation perk values: `checkExecutionersThrow` 100/125/150%, `checkDivineGrenade` 30/60/100%, `checkTwinBurstByTarget` 20/40/60%, `checkBlessingGroveHealingByTarget` 6/9/12 and 12/18/24%, `checkBeamMasteryDamage` 10/12/14%, `checkDrainBodyLeech`, `checkCombatMastery`, `checkDivineEmpowerment` 8/10/12%, `checkAvatarSkill` (100% crit, +5/10/15% crit damage, 5/10/15% reduction), Gift of Life 20/25/30% heal and 30/20/10 h cooldown, `checkFocusMasteryDamage` 35% | `wheel.revelations` (hand-written TS table, values cited) |
| `src/creatures/players/components/wheel/wheel_gems.cpp` (already fetched) | basic and supreme modifier values (e.g. physical resistance 100 = 1%, fire 200 = 2%, mitigation 500, dodge 28, life leech 200, mana leech 80, crit damage 200, revelation mastery +150 domain points, cooldown mods with `momentum += 0.33 * grade`) and the grade multipliers 1.1 / 1.2 / 1.5 | `wheel.gems` |
| `data/scripts/actions/items/wheel_scrolls.lua` | promotion scrolls: abridged 3, basic 5, revised 9, extended 13, advanced 20 points | `wheel.scrolls` |
| new spell scripts | `support/avatar_of_steel.lua` (15 s, 2 h cooldown, 2 s group), `attack/executioners_throw.lua` (18 s cooldown), and the other revelation / conviction spells listed in 1.2 | `spells[]` (existing `parse_spell`) |

The io_wheel slot functions are C++ code, not data. Parsing them with regex is fragile; I'd **transcribe them once
into `src/tibia/wheel.ts`** (36 rows x 4 vocations, ~150 lines) with a comment per row pointing at the function,
and add a check in `fetch_tibia_data.py` that hashes `io_wheel.cpp` and warns when the pin moves.

### 1.1 Wheel slot data (transcribed from `io_wheel.cpp`)

Per point: K/P/S/D = knight / paladin / sorcerer / druid. "Full" = the conviction when the slot is complete
(`isMaxPointAddedToSlot`). Mitigation per point is `MITIGATION_INCREASE` 0.03%; leech on full is
`HEALTH_LEECH_INCREASE` 0.75% or `MANA_LEECH_INCREASE` 0.25%. "Vessel" = `addVesselResonance` (a gem vessel).

| Slot (enum) | Size | Dedication per real point | Conviction when full |
|---|---|---|---|
| GREEN_200 (1) | 200 | HP 3/2/1/1, mana 1/3/6/6 | K Battle Instinct, P Positional Tactics, S Runic Mastery, D Healing Link |
| GREEN_TOP_150 (2) | 150 | mitigation | mana leech +0.25% |
| GREEN_TOP_100 (3) | 100 | HP 3/2/1/1 | vessel |
| RED_TOP_100 (4) | 100 | mana 1/3/6/6 | +1 melee / distance / magic level |
| RED_TOP_150 (5) | 150 | HP 3/2/1/1 | vessel |
| RED_200 (6) | 200 | HP 3/2/1/1, mana 1/3/6/6 | augment: K Front Sweep, P Sharpshooter, S focus spells, D Strong Ice Wave |
| GREEN_BOTTOM_150 (7) | 150 | mitigation | vessel |
| GREEN_MIDDLE_100 (8) | 100 | HP 3/2/1/1 | augment: K Groundshaker, P Strong Ethereal Spear, S Magic Shield, D Mass Healing |
| GREEN_TOP_75 (9) | 75 | mana 1/3/6/6 | life leech +0.75% |
| RED_TOP_75 (10) | 75 | capacity 5/4/2/2 | vessel |
| RED_MIDDLE_100 (11) | 100 | mana 1/3/6/6 | augment: K Chivalrous Challenge, P Divine Dazzle, S Sap Strength, D Nature's Embrace |
| RED_BOTTOM_150 (12) | 150 | HP 3/2/1/1 | mana leech +0.25% |
| GREEN_BOTTOM_100 (13) | 100 | HP 3/2/1/1 | augment: K Intense Wound Cleansing, P Swift Foot, S Energy Wave, D Terra Wave |
| GREEN_BOTTOM_75 (14) | 75 | mana 1/3/6/6 | +1 melee / distance / magic level |
| GREEN_50 (15) | 50 | capacity 5/4/2/2 | vessel |
| RED_50 (16) | 50 | mitigation | augment: K Fierce Berserk, P Divine Caldera, S Great Fire Wave, D Heal Friend |
| RED_BOTTOM_75 (17) | 75 | capacity 5/4/2/2 | life leech +0.75% |
| RED_BOTTOM_100 (18) | 100 | mana 1/3/6/6 | vessel |
| BLUE_TOP_100 (19) | 100 | mitigation | vessel |
| BLUE_TOP_75 (20) | 75 | HP 3/2/1/1 | mana leech +0.25% |
| BLUE_50 (21) | 50 | mana 1/3/6/6 | augment (2nd grade): K Front Sweep, P Sharpshooter, S focus spells, D Strong Ice Wave |
| PURPLE_50 (22) | 50 | HP 3/2/1/1 | vessel |
| PURPLE_TOP_75 (23) | 75 | mitigation | +1 melee / distance / magic level |
| PURPLE_TOP_100 (24) | 100 | capacity 5/4/2/2 | augment (2nd grade): K Groundshaker, P Strong Ethereal Spear, S Magic Shield, D Mass Healing |
| BLUE_TOP_150 (25) | 150 | capacity 5/4/2/2 | life leech +0.75% |
| BLUE_MIDDLE_100 (26) | 100 | mitigation | augment (2nd grade): Chivalrous Challenge / Divine Dazzle / Sap Strength / Nature's Embrace |
| BLUE_BOTTOM_75 (27) | 75 | HP 3/2/1/1 | vessel |
| PURPLE_BOTTOM_75 (28) | 75 | mitigation | mana leech +0.25% |
| PURPLE_MIDDLE_100 (29) | 100 | capacity 5/4/2/2 | augment (2nd grade): Intense Wound Cleansing / Swift Foot / Energy Wave / Terra Wave |
| PURPLE_TOP_150 (30) | 150 | mana 1/3/6/6 | vessel |
| BLUE_200 (31) | 200 | HP 3/2/1/1, mana 1/3/6/6 | augment (2nd grade): Fierce Berserk / Divine Caldera / Great Fire Wave / Heal Friend |
| BLUE_BOTTOM_150 (32) | 150 | capacity 5/4/2/2 | vessel |
| BLUE_BOTTOM_100 (33) | 100 | mitigation | +1 melee / distance / magic level (mages also fist) |
| PURPLE_BOTTOM_100 (34) | 100 | capacity 5/4/2/2 | vessel |
| PURPLE_BOTTOM_150 (35) | 150 | mana 1/3/6/6 | life leech +0.75% |
| PURPLE_200 (36) | 200 | HP 3/2/1/1, mana 1/3/6/6 | K Battle Healing, P Ballistic Mastery, S Focus Mastery, D Runic Mastery |

Each spell appears in two slots (one grade each), which is exactly the two Wheel grades `parse_spell_grades`
already extracts; the third grade stays the supreme gem mod. **Today's spell-grade cards become a consequence of
where you put Wheel points**, with no new grade data needed.

Domain fill order: inner ring first. `IOWheel::getSlotPrioritaryOrder` ranks 50 (0), 75 (1), 100 (2), 150 (3),
200 (4); a slot can take points once a neighbour toward the centre is full (Tibia's client enforces this; Canary
checks it in `canPlayerSelectPointOnSlot`). Per domain: 1 x 50, 2 x 75, 3 x 100, 2 x 150, 1 x 200 = 1,000 points.

### 1.2 Spells the Wheel needs that the game doesn't have yet

| Spell | Vocation | Source | Needed for | Solo value |
|---|---|---|---|---|
| Executioner's Throw | K | `attack/executioners_throw.lua` (18 s cd) | Red revelation | high |
| Avatar of Steel / Light / Storm / Nature | K/P/S/D | `support/avatar_of_*.lua` (15 s, 2 h cd) | Purple revelation, Transcendence | high |
| Divine Grenade | P | `attack/divine_grenade.lua` **(verify path)** | Red revelation | high |
| Divine Empowerment | P | `support/divine_empowerment.lua` **(verify path)** | Blue revelation | medium (stand on the field) |
| Terra Burst, Ice Burst | D | **(verify path)** | Blue revelation (Twin Bursts) | high |
| Great Death Beam | S | already in data.json | Red revelation (Beam Mastery) | high |
| Sap Strength, Expose Weakness | S | **(verify path)** | Blue revelation (Drain Body), Red augment | medium |
| Great Fire Wave | S | **(verify path)** | Red_50 / Blue_200 augment | high |
| Nature's Embrace | D | **(verify path)** | augment | medium |
| Divine Dazzle | P | **(verify path)** | augment (pull) | low |
| Chivalrous Challenge | K | **(verify path)** | augment (taunt) | low |
| Swift Foot | P | **(verify path)** | augment | low |
| Heal Friend | D | already a Tibia spell, not in data | augment | none solo |

Solo-dead convictions (Heal Friend, Chivalrous Challenge) stay in the wheel: they're dead for solo players in
Tibia too, which is exactly what makes the Red_50 / Blue_200 path a real choice. Their dedication stats still count.

---

## 2. Data model (TypeScript sketches)

### 2.1 Item instances (the big one)

`Character.equipment` is `Partial<Record<Slot, number>>` (item ids) and `Container` holds `{ id, n }`. Imbuements
and tiers live **on an item**, so gear needs instance state. Stackables stay plain ids.

```ts
// src/gear.ts (new)
export type ImbueCategory = "elementalDamage" | "lifeLeech" | "manaLeech" | "critical"
  | `protect:${"death" | "earth" | "fire" | "ice" | "energy" | "holy"}`
  | `skill:${"axe" | "sword" | "club" | "distance" | "shielding" | "magic" | "fist"}`
  | "speed" | "paralysisDeflection" | "capacity";

export interface Imbue { id: string; tier: 1 | 2 | 3 }          // id = imbuements.xml name ("vampirism")
export interface Gear {
  uid: number;                // unique per run
  id: number;                 // item id (data.json)
  tier: number;               // Exaltation Forge tier 0-10, capped by classification
  imbues: (Imbue | null)[];   // length = items[id].imbue.slots
}
export const gearOf = (id: number): Gear => ({ uid: nextUid++, id, tier: 0, imbues: Array(item(id)?.imbue?.slots ?? 0).fill(null) });
```

- `Character.equipment: Partial<Record<Slot, Gear>>` (ammo and thrown stacks keep an id with `tier 0`, no slots).
- `Container` items gain an optional `gear?: Gear` (non-stackables only). `Container.add(id, n)` keeps working for
  stackables; `Container.addGear(g)` for instances. `worth()` adds nothing for tiers (NPCs pay base price, as in Tibia).
- `ItemData` gains `imbue?: { slots: number; allow: Partial<Record<ImbueCategory, 1 | 2 | 3>> }` and `classification?: 1 | 2 | 3 | 4`.

### 2.2 Wheel

```ts
// src/tibia/wheel.ts (new, transcribed)
export type Domain = "green" | "red" | "blue" | "purple";
export interface WheelSlotDef {
  id: number;                 // WheelSlots_t 1-36
  domain: Domain; size: 50 | 75 | 100 | 150 | 200; ring: 0 | 1 | 2 | 3 | 4;
  neighbours: number[];       // toward the centre (fill order)
  perPoint: Partial<Record<VocationId, { hp?: number; mana?: number; cap?: number; mitigation?: number }>>;
  full: Partial<Record<VocationId, Conviction>>;
}
export type Conviction =
  | { kind: "augment"; spell: string }                       // next Wheel grade of a spell
  | { kind: "skill"; skill: "melee" | "distance" | "magic" } // +1
  | { kind: "leech"; life?: number; mana?: number }          // +0.75 / +0.25
  | { kind: "vessel" }
  | { kind: "perk"; perk: "battleInstinct" | "positionalTactics" | "runicMastery" | "healingLink"
      | "battleHealing" | "ballisticMastery" | "focusMastery" };

// src/wheel.ts (new, run state)
export interface WheelState {
  points: Map<number, number>;   // slot id -> compressed points placed
  bank: number;                  // unplaced points
  scrolls: Set<string>;          // promotion scrolls read this run
  gems: (Gem | null)[];          // one socket per domain (Tibia: one gem per domain)
}
export interface Gem { domain: Domain; quality: "lesser" | "regular" | "greater"; basic: string[]; supreme?: string; grade: 0 | 1 | 2 | 3 }
```

### 2.3 Charms (meta)

```ts
// meta.ts additions to Save
charmPoints: number;                    // unspent
charmEchoes: number;                    // minor charm echoes (from buying major tiers)
charmTiers: Record<string, 1 | 2 | 3>;  // bought, persists
charmSlots: number;                     // 2, raised to 6 by an unlock track
charmAssign: Record<string, string>;    // charm name -> creature key (persists between runs)
bestiaryDone: string[];                 // creatures whose entry is complete (points paid once)
version: 4;
```

### 2.4 Forge

```ts
export interface ForgeState { dust: number; slivers: number; cores: number }   // on Game, per run
export const TIER_EFFECT: Record<"weapon" | "armor" | "head" | "legs" | "feet",
  "onslaught" | "ruse" | "momentum" | "transcendence" | "amplification">;
```

---

## 3. Tables

### 3.1 Exaltation Forge tier effects (from `config.lua.dist` + `Item::get*Chance`, `quadraticPoly(a,b,c,tier)`)

| Tier | Onslaught (weapon) | Ruse (armor) | Momentum (helmet) | Transcendence (legs) | Amplification (boots) |
|---|---|---|---|---|---|
| a, b, c | 0.05, 0.4, 0.05 | 0.0307576, 0.440697, 0.026 | 0.05, 1.9, 0.05 | 0.0127, 0.1070, 0.0073 | 0.4, 1.7, 0.4 |
| 1 | 0.50% | 0.50% | 2.00% | 0.13% | 2.50% |
| 2 | 1.05% | 1.03% | 4.05% | 0.27% | 5.40% |
| 3 | 1.70% | 1.62% | 6.20% | 0.44% | 9.10% |
| 4 | 2.45% | 2.28% | 8.45% | 0.64% | 13.60% |
| 5 | 3.30% | 3.00% | 10.80% | 0.86% | 18.90% |
| 6 | 4.25% | 3.78% | 13.25% | 1.11% | 25.00% |
| 7 | 5.30% | 4.62% | 15.80% | 1.38% | 31.90% |
| 8 | 6.45% | 5.52% | 18.45% | 1.68% | 39.60% |
| 9 | 7.70% | 6.48% | 21.20% | 2.00% | 48.10% |
| 10 | 9.05% | 7.51% | 24.05% | 2.35% | 57.40% |

What each does (Canary code):
- **Onslaught** (`Combat`, `combat.cpp` ~2674): on a hit, chance → `fatal`, primary and secondary damage +60%. Amplified by boots: `chance *= 1 + amp/100`.
- **Ruse** (`Player::getDodgeChance`, `game.cpp` ~7890): chance to dodge an incoming hit entirely; amplified.
- **Momentum** (`Player::triggerMomentum`): every even second while in fight, chance (+ Wheel `bonusData.momentum` from cooldown gems) to cut **every** spell cooldown and non-support group cooldown by 2 s. Amplified.
- **Transcendence** (`Player::triggerTranscendence`): every even second within 2 s of an aggressive action, chance to become your vocation's avatar for `transcendenceAvatarDuration` 7,000 ms, at stage-3 avatar values (`checkAvatarSkill`: `AVATAR_FORGE` timer → stage 3: 100% crit chance, +15% crit damage, 15% damage reduction). Amplified.
- **Amplification**: multiplies the other four.

Classification caps (`item_tiers.lua`): class 1 → tier 1, class 2 → tier 2, class 3 → tier 3, class 4 → tier 10.
Fusion price (gold, cores) per step: class 1 T0→1 25,000 / 1; class 2 750,000 / 1, 5,000,000 / 1; class 3 4M / 1, 10M / 2,
20M / 3; class 4 8M / 1, 20M / 2, 40M / 5, 65M / 10, 100M / 15, 250M / 25, 750M / 35, 2.5B / 50, 8B / 60, 15B / 85.

**Compression**: gold ÷100, cores as-is (cores come from boss chests). Dust 100 per fusion (real). Success 50%, 65%
with a core spent as "success boost" (real `forgeBonusSuccessRate` 15). On failure the second copy is lost and the
first keeps its tier (real tier-loss reduction is a chance; I simplify it to "never lose tier", labelled).

In-game gear with a classification (from appearances, counted over data.json items): class 1: 130, class 2: 152,
class 3: 23, class 4: 18 (e.g. chain bolter L60, ravenwing L65, ghazbaran oyoroi L75, umbral master weapons L250).
Shields and spellbooks have no classification: no tier (and Ruse / Momentum aren't theirs anyway).

### 3.2 Imbuement slot rules (from `items.xml`, items present in data.json)

176 items in our data carry `imbuementslot` (580 in all of items.xml). Distribution by slot and count:

| Gear | 1 slot | 2 slots | 3 slots | Allowed categories (typical) |
|---|---|---|---|---|
| Swords | 3 | 12 | 8 | elemental damage, life leech, mana leech, critical, skill sword |
| Axes | 4 | 8 | 5 | same, skill axe |
| Clubs | 4 | 10 | 5 | same, skill club |
| Distance | 2 | 2 | 5 | same, skill distance |
| Wands / rods | 0 | several | 0 | life leech, mana leech, skill magic level |
| Armors | 4 | 9 | 0 | life leech, all six protections |
| Helmets | 4 | 8 | 0 | mana leech + weapon skills/shielding (warrior style) or mana leech + magic level (mage hat) |
| Shields, spellbooks | 19 | 0 | 0 | six protections, skill shielding |
| Boots | 13 | 0 | 0 | paralysis deflection, increase speed |
| Legs | 0 | 0 | 0 | none (legs are the Transcendence slot) |
| Backpacks | 21 | 0 | 0 | increase capacity (Featherweight; skipped, see open questions) |

Examples (all verified in data): barbarian axe L20 class 1, 2 slots; knight axe L25 class 2, 2 slots; Zaoan
halberd L25 class 1, 3 slots; twin axe L50 class 3, 3 slots; crossbow class 1, 3 slots; elvish bow class 2, 3 slots;
composite hornbow L50 class 2, 3 slots; chain bolter L60 class 4, 3 slots; wand of draconia L22 / wand of
starstorm L37 / wand of voodoo L42 class 1, 2 slots (life, mana, magic level); wand of inferno and hailstorm rod:
no slots; mage hat class 1, 2 slots (mana leech, magic level); magician hat class 3, 2 slots (mana leech + warrior
skills; useless to a mage, by Tibia's design); royal / crown / warrior helmet class 2, 2 slots; golden / knight /
magic plate armor and blue robe class 2, 2 slots; crown armor / dragon scale mail / paladin armor class 2, 1 slot;
boots of haste class 2, 1 slot (paralysis deflection only); steel boots and leather boots 1 slot (speed or
deflection); great / mastermind / demon / tower / vampire shield and spellbook of warding 1 slot.

**Maximum slots worn**: weapon 3 + armor 2 + helmet 2 + shield 1 + boots 1 = **9**, only with the right items.
Today's run cap is 6, with no item involved.

Rules (real):
- An item takes only its allowed categories, up to the listed tier (all listed values are 3 in our data).
- One imbuement per category per item (no Vampirism twice on one sword); two items may both carry Vampirism (sword and armor), and leech stacks, as in Tibia.
- One elemental damage imbuement per weapon (already enforced by `imbuementOptions` today, now per item).
- Imbuement values unchanged (current `IMBUEMENTS[].values`).

Cost (real base `imbuements.xml`): Basic 5,000 gold + protection 10,000, Intricate 30,000 + 30,000, Powerful
200,000 + 50,000; materials 25 / +15-25 / +5-20 creature products. **Compression**: materials ÷5 (25 → 5),
gold ÷10, protection always paid (100% success, no "it failed" moments), duration = the rest of the run
(real: 72,000 s = 20 h). Material coverage: of the 63 material slots of the 21 playable imbuements, **30 drop from
our 176 creatures** (e.g. Vampirism's vampire teeth from vampires, Epiphany's elvish talismans from elves, orc
shamans, medusas); the other 33 are bought at the shrine for 2x the compressed gold price (labelled shortcut).

Imbuement scrolls (`imbuements.xml` `scroll` attribute, `imbuement_scrolls.lua`): boss chests drop a scroll for a
random imbuement your gear can take, at Intricate (zones 1-6) or Powerful (7+). Applying a scroll is free.

### 3.3 Charm costs (from `bestiary_charms.lua`)

| Charm | Kind | I | II | III | Compressed I / II / III (÷5) |
|---|---|---|---|---|---|
| Wound | major | 240 | 360 | 1,200 | 48 / 72 / 240 |
| Enflame | major | 400 | 600 | 2,000 | 80 / 120 / 400 |
| Poison | major | 240 | 360 | 1,200 | 48 / 72 / 240 |
| Freeze | major | 320 | 480 | 1,600 | 64 / 96 / 320 |
| Zap | major | 320 | 480 | 1,600 | 64 / 96 / 320 |
| Curse | major | 360 | 540 | 1,800 | 72 / 108 / 360 |
| Divine Wrath | major | 600 | 900 | 3,000 | 120 / 180 / 600 |
| Parry | major | 400 | 600 | 2,000 | 80 / 120 / 400 |
| Dodge | major | 240 | 360 | 1,200 | 48 / 72 / 240 |
| Low Blow | major | 800 | 1,200 | 4,000 | 160 / 240 / 800 |
| Savage Blow | major | 800 | 1,200 | 4,000 | 160 / 240 / 800 |
| Carnage | major | 600 | 900 | 3,000 | 120 / 180 / 600 |
| Overpower | major | 600 | 900 | 3,000 | 120 / 180 / 600 |
| Overflux | major | 600 | 900 | 3,000 | 120 / 180 / 600 |
| Cripple, Adrenaline Burst, Numb, Cleanse, Vampiric Embrace, Void's Call, Fatal Hold, Void Inversion | minor (echoes) | 100 | 150 | 225 | 100 / 150 / 225 echoes (not scaled) |

Echoes: buying a major tier gives `25t² + 25t + 50` echoes (t = tier before buying): 50, 100, 200 (`iobestiary.cpp` ~479).

Why ÷5: our 139 creatures with a `Bestiary` block hold **3,215 charm points** in total (10 x 5, 51 x 15, 60 x 25,
18 x 50; bosses have none). Canary ships 844 non-boss monster files, so a real full bestiary is roughly 5x ours.
Scaling costs by 1/5 keeps the real proportion of "how much of the charm board a full bestiary buys". The one
scaled constant: `CHARM_COST_SCALE = 0.2`.

Kill thresholds: real `toKill` 250 / 500 / 1,000 / 2,500 (1-4 stars) → **÷10**: 25 / 50 / 100 / 250 kills over
all runs (`Save.kills` already counts them). First and second unlocks (`FirstUnlock`, `SecondUnlock`) ÷10 replace
today's fixed `BESTIARY_STAGES = [5, 25, 100]` in `data.ts` for the bestiary window's info reveals.

Assignment: one creature per charm (real); 2 slots to start (Tibia's free account), 6 with the "Charm Expansion"
unlock track (Tibia premium: 6, expansion: all; I stop at 6 to keep the choice). Reassigning between runs is free;
in a run, from the pause menu, for `level * 100` gold **(verify the real fee formula in iobestiary.cpp `charm_removal`)**.

### 3.4 Wheel revelation perks (per vocation, values from `player_wheel.cpp`)

Revelation stage by domain points: real 250 / 500 / 1,000; each stage also gives flat **+4 / +9 / +20 damage and
healing** (`Revelation.stats`).

| Domain | Knight | Paladin | Sorcerer | Druid |
|---|---|---|---|---|
| Green | Gift of Life: on a lethal hit, heal 20/25/30% max HP and cut all cooldowns by 60 s; cooldown 30/20/10 h | same | same | same |
| Red | Executioner's Throw: +100/125/150% damage to targets at ≤30% HP; 18 s cd | Divine Grenade: +30/60/100% damage | Beam Mastery: beams +10/12/14% damage; Great Death Beam | Blessing of the Grove: healing +6/9/12% (target ≤60%), +12/18/24% (≤30%) |
| Purple | Avatar of Steel | Avatar of Light | Avatar of Storm | Avatar of Nature |
| Blue | Combat Mastery: two-handed: crit damage +4/8/12%; one-handed: defense +10/20/30 | Divine Empowerment: +8/10/12% damage standing on its field | Drain Body: debuffed targets give mana leech +2/3/4% or life leech +3/4/5% (Sap Strength / Expose Weakness) | Twin Bursts: Terra/Ice Burst +20/40/60% damage on targets above 60% HP |

Avatars (`avatar_of_*.lua`, `checkAvatarSkill`): 15 s; 100% crit chance; crit damage +5/10/15% (stage 1/2/3);
damage reduction 5/10/15%; real cooldown 2 h base, cut by the Avatar cooldown supreme gem (-900 s).
**(verify the per-stage cooldown reduction, I remember 2 h / 1.5 h / 1 h)**.

Conviction perks used here: Battle Instinct (K, more shielding and melee when surrounded **(verify values)**),
Positional Tactics (P, distance bonus with nothing adjacent **(verify)**), Runic Mastery (S/D, rune damage and
healing up **(verify)**), Healing Link (D), Battle Healing (K: heals `shielding * 0.2`, x2 under 60% HP, x3 under
30%, from `checkBattleHealingAmount`), Ballistic Mastery (P, physical/holy damage bonus), Focus Mastery (S: after
a focus spell, the next damage +35%, `checkFocusMasteryDamage`).

### 3.5 Compressed Wheel

Real wheel: 36 slots, 4,000 points, 1 point per level from 51, revelation at 250/500/1,000 per domain. A level-1000
player has ~950 points + 50 from scrolls: one domain at stage 3 and change. **The real Wheel is never full, and
that is its design.**

Compressed (scale ÷5, so all sizes stay integers):

| Real | Compressed |
|---|---|
| slot sizes 50 / 75 / 100 / 150 / 200 | 10 / 15 / 20 / 30 / 40 |
| domain 1,000, wheel 4,000 | domain 200, wheel 800 |
| revelation 250 / 500 / 1,000 | 50 / 100 / 200 |
| 1 point per level from 51 | **4 points per level from 8** (vocation) |
| dedication HP / mana / capacity per real point | the same value per compressed point (knight GREEN_200: 3 HP + 1 mana per point), so the Wheel's share of your health pool at L60 matches Tibia's at high level; `DEDICATION_SCALE` = 1, see open question 8 |
| mitigation 0.03% per point | 0.15% per compressed point (percentages keep Tibia's per-slot total) |
| scrolls 3/5/9/13/20 (once each) | same face value, one per boss tier (zones 2, 4, 6, 8, 10+) |
| Gift of Life cd 30/20/10 h | 10 / 7 / 4 min |
| Avatar cd 2 h | 180 / 150 / 120 s by stage |
| gem grade multipliers 1.1/1.2/1.5 | same |

Why 4: the baseline campaign sim (section 7) ends 60-minute runs at a median L35-47 for knights and paladins over
their last 10 runs (boosts at level 7-9; best L62), and L18-27 for mages. The Wheel has to pay off inside that range.

Pacing (4 points per level from 8, no scrolls): first slot (10) at L11, revelation I (50) at L21, II (100) at L33,
III (200) at L58; with the two or three scrolls a L50 run has met (+17), III around L54. A second domain reaches
stage I around L71. Full wheel (800) needs L208: never in a normal run, same as Tibia.

### 3.6 Gems

Socketed one per domain (Tibia). Active when the domain's vessel slots are full: Lesser needs 1, Regular 2, Greater 3
**(verify against `PlayerWheel::processActiveGems` / vessel resonance)**. Lesser: 1 basic mod; Regular: 2 basic;
Greater: 2 basic + 1 supreme (`wheel_gems.cpp`). Sources: boss chests (quality by zone: zones 1-5 Lesser, 6-9
Regular, 10+ Greater; Luck shifts one step up with chance `luck / 2`%). Gem grades (Atelier, 0-3) come from
fragments; compressed: a duplicate gem of the same quality salvages into a grade (labelled shortcut).

Basic mod values (×1 at grade 0): physical / holy / death resistance 1%, fire / earth / ice / energy 2% (dual-element
mods split), mitigation multiplier (500), vocation HP (knight 300, paladin 200, mages 100 **(verify mage value)**),
vocation mana (knight 100, paladin 300, mages **(verify)**), capacity. Supreme: dodge 0.28%, crit damage 2%, life
leech 2%, mana leech 0.8%, revelation mastery +150 real domain points (= +30 compressed), spell augment mods (the
existing `spellGrades` third grade), cooldown mods (e.g. Executioner's Throw -2 s, Avatar of Steel -900 s, each
adding Momentum `0.33 * grade`, 1 at grade 3).

---

## 4. File-by-file changes

### tools/fetch_tibia_data.py
- `parse_items`: stop skipping `imbuementslot` (lines ~591-596 drop keys with spaces and `imbuementslot`). Parse the
  nested block into `imbue: { slots, allow }`, mapping `"life leech"`, `"mana leech"`, `"critical hit"`,
  `"elemental damage"`, `"elemental protection <el>"`, `"skillboost <skill>"`, `"increase speed"`,
  `"paralysis deflection"`, `"increase capacity"` to `ImbueCategory`.
- New `classification_ids()` next to `stackable_ids()`: same loop, `flags[48]` sub-field 1.
- `parse_monster`: read `monster.Bestiary` (`lua_block(src, r"monster\.Bestiary\s*=\s*\{")`) → `bestiary`.
- `parse_charms`: also read `points = { ... }` (currently the nested-table strip `re.sub(r"\{[^{}]*\}", "", e)` loses it).
- New `parse_imbuements()` (imbuements.xml), `parse_forge()` (item_tiers.lua + config.lua.dist), `parse_wheel_meta()`
  (scroll points, revelation stats, stage points); `src/tibia/wheel.ts` slot table is hand-transcribed with a hash check.
- Add the new spell scripts to the spell list so `parse_spell` picks them up.
- Make sure every item that can carry an imbuement material is included (`parse_items(ids, names)` takes loot ids,
  so materials dropped by our monsters are already present; add shrine-bought ones by name).

### src/tibia/db.ts
- `ItemData`: `imbue?`, `classification?`. `MonsterData`: `bestiary?`. `CharmData`: `points?: number[]`.
- Export `IMBUEMENT_BASES`, `FORGE`, `WHEEL_META`.

### src/tibia/imbuements.ts
- Keep `IMBUEMENTS` (values are right); add `category: ImbueCategory`, `materials: [id, count][][]` per tier, `scroll`.
- Drop `for(voc, weaponSkill)`: eligibility now comes from the item (`items[id].imbue.allow`), as in Tibia.
  A knight with a bow can put Precision on it; a sorcerer can't put Vampirism on a wand of inferno (no slots).

### src/gear.ts (new)
- `Gear` type, `gearOf`, `canImbue(g, imbId)`, `imbueCost(imbId, tier)`, `applyImbue(g, slotIdx, imbId, tier)`,
  `tierEffect(g, slot)`, `maxTier(g)` = classification cap, `fuse(a, b, useCore)`.

### src/character.ts
- `equipment: Partial<Record<Slot, Gear>>`. Every `this.equipment[slot]` read that expects a number becomes `.id`:
  `worn()`, `armor`, `weapon`, `shield`, `ammo`, `thrown`, `takeOffWeapon`, `wearFromBackpack`, `equip`, `offer`,
  `startWear`, `protects`, `shopUpgrades`, `carried`, `setVocation`. Mechanical but wide (about 40 call sites across
  character.ts, game.ts, hud.ts, ui.ts, sim.ts; `rg "equipment\\["`).
- **`imbued(kind, match)`**: same signature, new source: iterate worn `Gear.imbues` instead of `this.imbuements`.
  All callers (`speed`, `skill`, `ml`, `absorb`, game.ts crit and leech) keep working unchanged. That's the key to a
  small diff.
- Remove `imbuements` map, `slotsUsed`, `imbuementOptions()`, and the imbuement branch of `setVocation` (imbuements no
  longer vanish on vocation choice; they stay on the item).
- `rollChoices()`: new deck (see 5.1): `wheelChoices(2)` + one hunt card (prey or a filler) + luck's 4th card.
  Remove imbuement, grade, run bonus and luck-card pools. `withRarity()` only for prey (stars) and fillers stay x1
  (rarity is gone from fillers; see 6).
- `room()`: drop "imbue", "grade", "charm", "bonus", "luck" cases.
- `applyChoice()`: new `{ kind: "wheel"; slot: number; points: number }` → `wheel.place(slot, points)`.
- `gradeBonus(s)`: grade = number of the spell's two augment slots that are full (0-2), +1 if the domain's active
  Greater gem has its supreme augment mod; then `spellGrades(s).grades[g - 1]` exactly as now.
- `maxHp` / `maxMana`: `+ wheel.hp` / `+ wheel.mana`; `capacity` `+ wheel.cap`; skills: `+ wheel.skill(i)`; `ml`:
  `+ wheel.magic`.
- `score(it, slot)`: add the value of an item's imbuements and tier, so `offer()` doesn't swap a Powerful-Vampirism
  knight armor for a plain one with 1 more armor. Score uses `Gear`, not `ItemData`.
- `charmValue(name)` → `charmValue(name, creature)`: 0 unless `charmAssign[name] === creature`.

### src/wheel.ts (new)
- `WheelState` + `place(slot, n)`, `reachable()`, `domainPoints(d)`, `stage(d)`, `stats()` (cached on change):
  `{ hp, mana, cap, mitigation, lifeLeech, manaLeech, skills, convictions, revelations, momentum }`.
- `respec()` (free while paused, as in a protection zone).
- `presets[voc]`: an ordered slot path per vocation, used by the sim and by an "auto" button.

### src/picks.ts
- Spell grades: `spellGrades()` unchanged. Remove the non-Tibia `[5, 10, 15]` fallback grades: spells the Wheel
  doesn't touch don't get grades (one less "Not real" line).
- Charms: `CHARM_LIST` unchanged; `describeCharm` gains the creature. `charmChoices` deleted.
- Prey unchanged; add `wildcards` (reroll a prey's bonus type; boss chest drop, real "prey wildcard").

### src/upgrades.ts
- `MAX_SLOTS` removed (slots are on items). `RUN_BONUSES` removed (their job: XP/loot prey and boosts).
  `BOOSTS` unchanged.

### src/evolutions.ts
- Retired. `EvolutionId` and `Character.evolutions` go; their 8 checks in game.ts (`draken`, `bloodrage`,
  `avatarsteel`, `mastermind`, `elementalburst`, `weaponmastery`, `stamina`, `goldpouch`) are deleted. Draken boots
  stay a real item (draken boots L80, class 2, 1 slot, already in our loot data).

### src/game.ts (combat hooks)
| Function | Change |
|---|---|
| `damageMonster` (1228) | after prey: **Onslaught** `if (rand < weaponTier.onslaught * amp) dmg *= 1.6` (applies to weapon hits and spells, as `Combat::doCombatHealth`); crit chance: Strike stays, Low Blow only if assigned to `m.key`; **avatar active → crit chance 100%, crit damage + 5/10/15**; Combat Mastery crit damage; revelation flat `+4/9/20` per stage on spell damage; Executioner's Throw / Divine Grenade / Twin Bursts multipliers by target HP%; leech: imbued (now from gear) + Wheel leech + assigned Vampiric Embrace; floating text "(Onslaught)" in gold. Delete `bloodRage` lines. |
| `hurtPlayer` (1109) | **Ruse** dodge `rand < armorTier.ruse * amp` (before the Dodge charm, which now needs `m.key` assigned); avatar damage reduction 5/10/15%; Wheel mitigation into the mitigation step; delete `avatarsteel` 0.7. Gift of Life: if `ch.hp - dmg <= 0` and its timer is ready, heal 20/25/30% and `cutCooldowns(60)`. |
| `charmProcs` (1267) | iterate only charms assigned to `m.key`. |
| `killMonster` (1285) | bestiary: remove the `events.push({ type: "charm" })`; instead, when `killTotals[m.key]` crosses `bestiary.toKill / 10` for the first time ever, `charmPointsEarned += bestiary.charmPoints` and a banner. Carnage only if assigned. **Forge**: influenced monsters (see below) drop dust `uniform(stack, 3*stack)`. |
| `spawnMonster` (707) | 1 in 8 spawns past Rookgaard is *influenced* (1-5 stacks, real Forge system; small icon), drops dust; 1 in 400 is *fiendish* (drops slivers, more dust). **(compression knob)** |
| `update` (350) | every 2 s in fight: **Momentum** roll (helmet tier, amplified, + Wheel momentum) → `cutCooldowns(2)`; **Transcendence** roll (legs tier) → `avatar(7, 3)`. Avatar timer. Divine Empowerment field. |
| `cast` (1588) | `gradeBonus` source changes (see character.ts); revelation spells; avatar spells set `avatarUntil`, `avatarStage`. Cooldowns through a new `cutCooldowns(s)` helper that lowers `spellReady` and `groupReady.attack/healing`. Delete `mastermind`. |
| `manaCost` (1553) | delete the Mastermind half cost. |
| `weaponHit` (1519) | delete `elementalburst`; imbued elemental conversion now reads the weapon's own imbuement. |
| `openChest` (1558) | new loot: 1 promotion scroll (next unread), 1 gem (quality by zone), 1-2 exalted cores, 30% an imbuement scroll, 20% a prey wildcard, 35% blessing (kept). No evolutions. |
| `takeLoot` / `updateCorpses` | loot becomes `Gear` for non-stackables; Gold Pouch evolution logic deleted. |
| `describeChoice` (~1720) | `wheel` case. |

### src/autocast.ts
- `supportSpells`: cast the avatar when 4+ monsters are on screen or HP < 50% (like Blood Rage logic today);
  Divine Empowerment when the paladin stands still; Sap Strength / Expose Weakness on the target before a beam.
- `expected(g, s)`: include the revelation multipliers so autocast prefers Executioner's Throw on low-HP targets and
  Terra/Ice Burst on fresh ones (Twin Bursts), which makes the revelation perks *play* themselves: the player only steers.

### src/meta.ts
- `Save` fields of 2.3; `fresh()` sets them; `version: 4`.
- `migrate(s)`: from 3 to 4: `bestiaryDone` = every creature with `kills[k] >= bestiary.toKill / 10`;
  `charmPoints` = sum of their `CharmsPoints` (existing players get their charms on day one: a free "welcome back");
  `charmSlots = 2`, `charmTiers = {}`, `charmAssign = {}`, `charmEchoes = 0`.
- New track in `TRACKS`: "Charm Expansion" (souls; 3 tiers: 3, 4, 6 slots). New between-runs screen: the charm board.
- No run state is saved today, so `Gear` / `WheelState` need no migration.

### src/hud.ts
- Equipment window: imbuement pips under each item (filled = imbued, colour = tier), tier badge (Tibia shows tier as
  a small number on the item). Tooltip lists imbuements, tier effect and classification.
- `upgrades()` → **"Wheel" window** (`WinId` "upgrades" renamed): the compact wheel (four domain bars with stage
  marks), active convictions, revelation perks with their cooldown clocks, gems; prey below; charms with their creature.
- Bestiary window: per creature `kills / toKill÷10`, charm points it pays, assigned charm icon.
- Status bar: avatar active (15 s / 7 s) icon, Gift of Life ready icon, forge dust count.

### src/ui.ts
- `levelUp()`: Wheel cards (slot name, domain colour, "+4 points: +12 HP, +4 mana", "Completes: Front Sweep grade 1",
  "Revelation I at 50: Executioner's Throw" progress bar); an "Open Wheel" button with the full planner (place /
  remove, free while paused).
- `pause()`: new tabs **Imbuing** (pick a worn item → slot → imbuement → tier; shows materials you carry and cost)
  and **Forge** (pairs of identical items, tier, cost, success chance, core toggle).
- `chest()`: list real drops instead of evolutions.
- Title screen: **Charm board** (buy tiers, assign creatures, see points / echoes).
- `end()`: show charm points earned and entries completed this run.

### src/main.ts
- Remove the `"charm"` event case (lines ~176-186). Level-up flow unchanged otherwise.

### src/sim.ts
- `trade()`: after shopping, `autoImbue(g)` (cheapest Basic on empty allowed slots, Vampirism/Void/Strike priority,
  upgrade to Powerful when gold > 5x cost) and `autoForge(g)` (fuse any identical pair if gold allows).
- Level-up picks: follow `wheel.presets[voc]`.
- Output columns: wheel points per domain, revelation stages, items imbued, best tier per slot, Onslaught / Ruse /
  Momentum procs per minute, charm points earned.

### README.md, SKILLS.md
- README "What's real" gains Wheel, imbuement slots, Forge tiers, bestiary charm points; the "Not real" line loses
  "imbuements as level-up rewards", "charms working on every creature", "card rarity" and "spells without Wheel data
  getting a +5/10/15% grade". SKILLS.md is regenerated from the new tables.

---

## 5. The run loop after the change

### 5.1 Level-up deck
Every level from 8: +4 Wheel points banked, one choice screen (as now: `pendingChoices`, at most `MAX_PENDING` 5):

1. **Wheel card A** and **Wheel card B**: two different reachable slots (prefer slots that complete something or
   advance a domain toward a revelation), each placing all banked points (4, or 8-20 after several levels at once).
2. **Hunt card**: prey (if a free creature in the zone), else exercise weapon / potions / gold filler.
3. With luck: a 4th card (another Wheel slot).
Reroll unlock: unchanged.

Skill advances stop adding picks (`Game.advance` keeps the message, drops the `pendingChoices` bump). With training
boosts at x50 they add a card every 20 s, which dilutes decisions; levels carry the cadence now.

### 5.2 What you do with gold and loot
- NPC trade (as now), **Imbuing** (pause tab), **Forge** (pause tab). The shop stays the "pause menu" convenience
  already listed as not real.

### 5.3 What carries between runs
Souls, boosts, unlocks (as now) + charm points / tiers / assignments + bestiary completion. Not the Wheel (it's
per run, rebuilt from level 8 every time, which is the survivors part), not gear, not gems.

---

## 6. Rarity, re-defined

| Colour | Item (classification) | Gem | Prey stars | Charm tier |
|---|---|---|---|---|
| Common (grey) | class 1 (max tier 1) | – | 1-7 | – |
| Rare (blue) | class 2 (max tier 2) | Lesser | 6-8 | I |
| Epic (purple) | class 3 (max tier 3) | Regular | 8-9 | II |
| Legendary (orange) | class 4 (max tier 10) | Greater | 10 | III |

- Item names and backpack borders take the colour of their classification (all from appearances.dat).
- No multipliers. `rarity.ts` keeps `rollRarity(luck)` for gem quality and prey stars; `fitRarity`, `rarityMult`,
  `LUCK_STEP`, `RUN_LUCK_MAX` go. `extraCardChance` stays.
- Luck (boost only now): 4th card chance (luck/2 %), prey star band odds (as now), gem quality step-up chance (luck/2 %).

Caps (all Tibia's): 9 imbuement slots worn at most, each item's own list; tiers by classification; Wheel 800 of
which a run reaches ~200-300; charm slots 2/6; prey 3; gem one per domain. **Late-game depth** past ~L70: the second
and third domains, Greater gems (supreme mods), class 4 items climbing to tier 10 (Onslaught 9.05%, Momentum 24.05%,
Amplification 57.4%) fed by Loot Boost duplicates, and the charm board across runs.

---

## 7. Balancing plan (sim)

Baseline (current code, `npm run sim -- <voc> 30`, a 30-run campaign from a fresh account, 60 min cap per run) is
recorded in the pitch page:

| Vocation | Median level, last 10 runs | Median kills, last 10 | Best run | Boosts at run 30 |
|---|---|---|---|---|
| Knight | L46.5 | 801 | L62 (run 30, Minotaur Hills) | gold9 axe9 shielding9 club9 loot9 haste8 xp8 |
| Paladin | L35 | 750 | L48 (run 25, Ancient Tombs) | gold8 distance8 shielding8 club8 loot7 haste7 xp7 |
| Sorcerer | L18 | 227 | L33 (run 27, Minotaur Hills) | gold7 shielding7 club6 magic6 loot6 haste6 xp6 |
| Druid | L27 | 474 | L41 (run 27, Minotaur Hills) | gold7 shielding7 club7 magic7 loot7 haste7 xp7 |

Steps:

1. **Parity pass**: implement the Wheel only (imbuements still cards) and compare minute-by-minute dealt damage,
   level and zone reached vs baseline. Target: within ±15% at L20, L40, L60.
2. **Gear imbuement pass**: remove imbuement cards. Expect an early dip (no Vampirism from cards before gear has
   slots, e.g. a L20 knight with a barbarian axe has 2 slots, a L22 sorcerer with a wand of draconia 2). Tune
   compressed gold ÷10 and materials ÷5 until the median run imbues its first slot by ~L20 and has 4-6 slots by L60.
3. **Forge pass**: tune influenced rate (1/8) and dust to hit ~1 fusion per 10 min in zones 6+.
4. **Charm pass**: across a 30-run campaign, median charm points by run 10 ~ 400 (enough for 2-3 major I tiers).
5. Gates: no vocation's median zone reached at run 30 differs from the mean by more than one zone.

New sim outputs (5.x) make each knob visible. Gameplay feel (Onslaught visible, avatar triggers) checked by hand.

---

## 8. Phased rollout (one developer)

| Phase | Content | Effort | Shippable alone? |
|---|---|---|---|
| 0 | Data extraction: imbuement slots, classification, bestiary blocks, charm points, imbuements.xml, forge config; wheel.ts transcription; new spells | 4-5 days | yes (data only) |
| 1 | `Gear` instances, equipment refactor, Imbuing tab, scrolls, imbuement cards removed, evolutions retired | 7-9 days | yes |
| 2 | Wheel: state, cards, window, dedication/conviction, augments replace grade cards | 6-8 days | yes |
| 3 | Revelations: 4 x 4 perks, avatars, Gift of Life, autocast use | 5-7 days | with 2 |
| 4 | Forge: tiers, fusion, dust/influenced monsters, 5 tier effects | 4-6 days | yes |
| 5 | Charms meta: bestiary points, board, assignment, migration | 4-5 days | yes |
| 6 | Gems and vessels, rarity re-skin, sim balancing, README/SKILLS | 5-7 days | – |
| | **Total** | **35-47 dev-days (7-9 weeks)** | |

Order lets every phase merge to main behind no flag: the game is playable after each.

---

## 9. Open questions

1. Free respec while paused (true to Tibia's protection zone) vs locked points (more survivors-like tension). I lean free.
2. Forge proc chances at real values are subtle (Onslaught 1.05% on the typical class-2 weapon). Keep real and let
   Momentum/Amplification carry the feel, or add a `FORGE_SCALE` knob? I lean real, revisit after the sim.
3. Featherweight (capacity) and Vibrancy (paralysis deflection) imbuements: capacity matters here (`carried`), so
   Featherweight on backpacks could come back; Vibrancy needs paralysis removal (`slowDelta`). Phase 6+.
4. Should the bestiary charm points also reward bosses (Tibia's Bosstiary gives boss points, not charm points)?
5. Monk: Canary has the Monk's wheel too (`isMonk` branches). Out of scope until the game has monks.
6. Influenced/fiendish monsters change spawn feel. If it's too much, dust can drop from every kill at a low rate instead.
7. Sorcerer "focus spells" (`m_focusSpells`, `Any_Focus_Mage_Spell`): which spells exactly. **(verify against Canary)**
8. `DEDICATION_SCALE`: absolute dedication (HP, mana, capacity) uses Tibia's per-point value per compressed point.
   That keeps Tibia's proportion: a level-1000 knight's ~950 points add ~1,900 HP to ~15,000 (about 13%); here one full
   Red domain (200 points) adds ~300 HP to a L58 knight's ~935 (more, because a run commits harder). The sim sets the
   scale between 0.5 and 2; convictions, mitigation and revelations stay at real values.
