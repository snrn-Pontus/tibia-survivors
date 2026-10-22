# Skills and cards

Every pick in the game: the level-up cards, bestiary charms, boss chests, the boosts bought between runs, and evolutions. Values come from the code (`src/rarity.ts`, `src/character.ts`, `src/picks.ts`, `src/tibia/imbuements.ts`, `src/upgrades.ts`, `src/evolutions.ts`) and the extracted Tibia data.

## How rarity works

Every level-up card, charm card and chest pick rolls a rarity. A rarer card gives you more of the same pick.

| Rarity | Multiplier | Base odds |
|---|---|---|
| Common | x1 | 70% |
| Rare | x2 | 22% |
| Epic | x3 | 7% |
| Legendary | x5 | 1% |

- **The roll is capped by what the card has left.** If the multiplier is bigger than the tiers or picks left, the rarity drops until it fits (`fitRarity`). Imbuements, charms and spell grades have only 3 tiers, so **they can never be Legendary**: a Legendary roll shows up as Epic, or lower if you already hold some tiers.
- **Luck** makes rarer cards likelier. At 50 luck, Rare is twice as likely, Epic three times and Legendary five times. Luck also gives a 4th card on `luck / 2`% of level-ups, up to 50%.
- Luck comes from the **Luck boost** (+5 per level, up to +50) and **Luck cards** (up to +50 per run), so it tops out at 100.

| Luck | Common | Rare | Epic | Legendary | 4th card |
|---|---|---|---|---|---|
| 0 | 70.0% | 22.0% | 7.0% | 1.0% | 0% |
| 10 | 64.8% | 24.4% | 9.1% | 1.7% | 5% |
| 25 | 58.3% | 27.5% | 11.7% | 2.5% | 12.5% |
| 50 | 50.0% | 31.4% | 15.0% | 3.6% | 25% |
| 75 | 43.8% | 34.4% | 17.5% | 4.4% | 37.5% |
| 100 | 38.9% | 36.7% | 19.4% | 5.0% | 50% |

## Overview: what each card gives by rarity

| Card | Common | Rare | Epic | Legendary |
|---|---|---|---|---|
| Imbuement | +1 tier | +2 tiers | +3 tiers (straight to Powerful) | — (Epic) |
| Spell grade | +1 grade | +2 grades | +3 grades | — (Epic) |
| Charm | +1 tier | +2 tiers | +3 tiers | — (Epic) |
| Run bonus | +20% | +40% | +60% | +100% (the run's cap) |
| Luck | +5 luck | +10 luck | +15 luck | +25 luck |
| Prey | 1–7 stars | 6–8 stars | 8–9 stars | 10 stars |
| Training (exercise weapon) | +1 skill level | +2 | +3 | +5 |
| Potions | 25 | 50 | 75 | 125 |
| Gold | 50 × level | 100 × level | 150 × level | 250 × level |

A level-up shows 3 cards (4 with luck), drawn from up to 2 imbuements, 2 spell grades, 1 prey, 2 run bonuses and 1 Luck card. Training, potions and gold fill the rest so there is always a choice.

---

## 1. Imbuements (level-up cards)

Tibia's imbuements, at their real Basic / Intricate / Powerful values. They take up the run's **6 slots**. Once the slots are full, you can only upgrade imbuements you already have. Only one elemental damage imbuement at a time.

The columns show what a card gives when you don't have the imbuement yet. If you already have tiers, the card adds tiers on top of those, up to Powerful.

### Leech and critical hits (every vocation)

| Imbuement | Effect | Common (Basic) | Rare (Intricate) | Epic (Powerful) |
|---|---|---|---|---|
| Vampirism | Life leech | 5% | 10% | 25% |
| Void | Mana leech | 3% | 5% | 8% |
| Strike | Extra damage on a critical hit (10% chance) | +5% | +15% | +40% |

### Elemental damage (knights and paladins, one at a time)

| Imbuement | Element | Common | Rare | Epic |
|---|---|---|---|---|
| Scorch | Fire | 10% | 25% | 50% |
| Frost | Ice | 10% | 25% | 50% |
| Electrify | Energy | 10% | 25% | 50% |
| Venom | Earth | 10% | 25% | 50% |
| Reap | Death | 10% | 25% | 50% |

The value is the share of weapon damage that turns into the element.

### Skills

| Imbuement | Skill | Who | Common | Rare | Epic |
|---|---|---|---|---|---|
| Bash | Club fighting | Knight with a club | +1 | +2 | +4 |
| Slash | Sword fighting | Knight with a sword | +1 | +2 | +4 |
| Chop | Axe fighting | Knight with an axe | +1 | +2 | +4 |
| Precision | Distance fighting | Paladin | +1 | +2 | +4 |
| Blockade | Shielding | Knight | +1 | +2 | +4 |
| Epiphany | Magic level | Sorcerer, Druid | +1 | +2 | +4 |

### Speed (every vocation)

| Imbuement | Common | Rare | Epic |
|---|---|---|---|
| Swiftness | Speed +10 | +15 | +30 |

### Protection (every vocation)

| Imbuement | Element | Common | Rare | Epic |
|---|---|---|---|---|
| Dragon Hide | Fire | 3% | 8% | 15% |
| Snake Skin | Earth | 3% | 8% | 15% |
| Quara Scale | Ice | 3% | 8% | 15% |
| Cloud Fabric | Energy | 3% | 8% | 15% |
| Demon Presence | Holy | 3% | 8% | 15% |
| Lich Shroud | Death | 3% | 8% | 15% |

---

## 2. Spell grades (level-up cards)

These are offered for instant spells you already know. The grades come from the Wheel of Destiny: Wheel grades first, then the supreme gem mod at x1.1 / x1.2 / x1.5 for the grades left. A spell the Wheel doesn't touch gets a non-Tibia +5 / 10 / 15% damage or healing. Each grade below is the **total** bonus at that grade.

A Common card moves the spell up 1 grade, a Rare card 2 and an Epic card 3. So from no grades, a Rare card jumps straight to grade 2 and an Epic card to grade 3. Spells with a single grade are always Common. Hastes, stances without Wheel data, Recovery, cures and lights have no grades.

### Knight

| Spell | Grade 1 | Grade 2 | Grade 3 |
|---|---|---|---|
| Brutal Strike | +5% damage | +10% damage | +15% damage |
| Whirlwind Throw | +5% damage | +10% damage | +15% damage |
| Groundshaker | +12% damage | +12% damage, -2 s cooldown | +21.8% damage, -2 s cooldown, +18% crit damage |
| Berserk | +5.5% damage, +13.2% crit damage | +6% damage, +14.4% crit damage | +7.5% damage, +18% crit damage |
| Front Sweep | 5% life leech | 5% life leech, +14% damage | 5% life leech, +26% damage, +18% crit damage |
| Fierce Berserk | -30 mana | -30 mana, +10% damage | -30 mana, +17.5% damage, +12% crit damage |
| Annihilation | +13.2% damage, +16.5% crit damage | +14.4% damage, +18% crit damage | +18% damage, +22.5% crit damage |
| Wound Cleansing | +5% healing | +10% healing | +15% healing |
| Intense Wound Cleansing | -300 s cooldown | — | — |
| Fair Wound Cleansing | +11% healing | +12% healing | +15% healing |

### Paladin

| Spell | Grade 1 | Grade 2 | Grade 3 |
|---|---|---|---|
| Ethereal Spear | +11% damage, +16.5% crit damage | +12% damage, +18% crit damage | +15% damage, +22.5% crit damage |
| Divine Missile | +8.8% damage, +13.2% crit damage | +9.6% damage, +14.4% crit damage | +12% damage, +18% crit damage |
| Divine Caldera | -20 mana | -20 mana, +8% damage | -20 mana, +15.5% damage, +18% crit damage |
| Strong Ethereal Spear | -2 s cooldown | -2 s cooldown, +9.6% damage, +14.4% crit damage | -2 s cooldown, +12% damage, +18% crit damage |
| Divine Healing | +5% healing | +10% healing | +15% healing |
| Salvation | +6.6% healing | +7.2% healing | +9% healing |
| Sharpshooter | -6 s cooldown | — | — |

### Sorcerer

| Spell | Grade 1 | Grade 2 | Grade 3 |
|---|---|---|---|
| Death Strike | +5% damage | +10% damage | +15% damage |
| Fire Wave | +5% damage | +10% damage | +15% damage |
| Energy Beam | +5% damage | +10% damage | +15% damage |
| Great Energy Beam | +11% damage, +16.5% crit damage | +12% damage, +18% crit damage | +15% damage, +22.5% crit damage |
| Energy Wave | +5% damage | +11% damage, -1.2 s cooldown, +14.4% crit damage | +12.5% damage, -1.5 s cooldown, +18% crit damage |
| Rage of the Skies | +8.8% damage, +13.2% crit damage | +9.6% damage, +14.4% crit damage | +12% damage, +18% crit damage |
| Hell's Core | +8.8% damage, +13.2% crit damage | +9.6% damage, +14.4% crit damage | +12% damage, +18% crit damage |
| Strong Flame Strike | +5% damage | +10% damage | +15% damage |
| Strong Energy Strike | +5% damage | +10% damage | +15% damage |
| Ultimate Flame Strike | +5% damage | +10% damage | +15% damage |
| Ultimate Energy Strike | +5% damage | +10% damage | +15% damage |
| Great Death Beam | +11% damage, +16.5% crit damage | +12% damage, +18% crit damage | +15% damage, +22.5% crit damage |

### Druid

| Spell | Grade 1 | Grade 2 | Grade 3 |
|---|---|---|---|
| Ice Wave | +5% damage | +10% damage | +15% damage |
| Terra Wave | +6% damage | +6% damage, 5% life leech | +13.5% damage, 5% life leech, +18% crit damage |
| Strong Ice Wave | 3% mana leech | 3% mana leech, +10% damage | 3% mana leech, +22% damage, +22.5% crit damage |
| Wrath of Nature | +5% damage | +10% damage | +15% damage |
| Eternal Winter | +8.8% damage, +13.2% crit damage | +9.6% damage, +14.4% crit damage | +12% damage, +18% crit damage |
| Strong Terra Strike | +5% damage | +10% damage | +15% damage |
| Strong Ice Strike | +5% damage | +10% damage | +15% damage |
| Ultimate Terra Strike | +5% damage | +10% damage | +15% damage |
| Ultimate Ice Strike | +5% damage | +10% damage | +15% damage |
| Mass Healing | +4% healing | +10% healing | +11.5% healing |

### Shared by sorcerers and druids

| Spell | Grade 1 | Grade 2 | Grade 3 |
|---|---|---|---|
| Flame Strike | +5% damage | +10% damage | +15% damage |
| Energy Strike | +5% damage | +10% damage | +15% damage |
| Ice Strike | +5% damage | +10% damage | +15% damage |
| Terra Strike | +5% damage | +10% damage | +15% damage |
| Ultimate Healing | +5.5% healing | +6% healing | +7.5% healing |
| Magic Shield | -6 s cooldown | — | — |

### Shared by several vocations

| Spell | Who | Grade 1 | Grade 2 | Grade 3 |
|---|---|---|---|---|
| Light Healing | Sorcerer, Druid, Paladin | +5% healing | +10% healing | +15% healing |
| Intense Healing | Sorcerer, Druid, Paladin | +5% healing | +10% healing | +15% healing |

---

## 3. Bestiary charms (charm cards)

You get 3 charm cards whenever a bestiary stage unlocks. They roll rarity the same way as level-up cards: Common +1 tier, Rare +2, Epic +3 (from nothing, straight to tier III). Bless, Scavenge and Gut are left out because they need death penalties and skinning.

### Elemental damage (major)

| Charm | Effect | I (Common) | II (Rare) | III (Epic) |
|---|---|---|---|---|
| Wound | Chance to deal 5% of its health as physical | 5% | 10% | 11% |
| Enflame | … as fire | 5% | 10% | 11% |
| Poison | … as earth | 5% | 10% | 11% |
| Freeze | … as ice | 5% | 10% | 11% |
| Zap | … as energy | 5% | 10% | 11% |
| Curse | … as death | 5% | 10% | 11% |
| Divine Wrath | … as holy | 5% | 10% | 11% |

### Offense (major)

| Charm | Effect | I | II | III |
|---|---|---|---|---|
| Low Blow | Critical hit chance | +4% | +8% | +9% |
| Savage Blow | Critical damage | +20% | +40% | +44% |
| Carnage | Chance a kill hits nearby creatures for 15% of its health | 10% | 20% | 22% |
| Overpower | Chance to hit for 5% of your health | 5% | 10% | 11% |
| Overflux | Chance to hit for 2.5% of your mana | 5% | 10% | 11% |

### Defense (major)

| Charm | Effect | I | II | III |
|---|---|---|---|---|
| Parry | Chance to reflect a hit | 5% | 10% | 11% |
| Dodge | Chance to dodge a hit | 5% | 10% | 11% |

### Minor

| Charm | Effect | I | II | III |
|---|---|---|---|---|
| Cripple | Chance a hit roots it for 10 s | 6% | 9% | 12% |
| Numb | Chance its attack roots it for 10 s | 6% | 9% | 12% |
| Fatal Hold | Chance a hit keeps it from fleeing for 30 s | 30% | 45% | 60% |
| Adrenaline Burst | Chance to run much faster for 10 s when hit | 6% | 9% | 12% |
| Cleanse | Chance a hit cleanses a condition | 6% | 9% | 12% |
| Vampiric Embrace | Life leech | 1.6% | 2.4% | 3.2% |
| Void's Call | Mana leech | 0.8% | 1.2% | 1.6% |
| Void Inversion | Chance mana drain gives you mana | 20% | 30% | 40% |

---

## 4. Prey (level-up card)

A prey bonus on a creature from the current zone (3 slots; a 4th replaces the oldest). The bonus type is random, and the rarity sets the stars (Canary's formulas).

| Bonus | Formula | Common (1–7★) | Rare (6–8★) | Epic (8–9★) | Legendary (10★) |
|---|---|---|---|---|---|
| Damage | 2 × stars + 5% | 7–19% | 17–21% | 21–23% | 25% |
| Defense (less damage taken) | 2 × stars + 10% | 12–24% | 22–26% | 26–28% | 30% |
| Experience | 3 × stars + 10% | 13–31% | 28–34% | 34–37% | 40% |
| Loot | 3 × stars + 10% | 13–31% | 28–34% | 34–37% | 40% |

---

## 5. Run bonuses and Luck (level-up cards, this run only)

Each pick adds +20%, up to 5 picks (+100%), on top of any boost.

| Card | Who | Common | Rare | Epic | Legendary |
|---|---|---|---|---|---|
| Experience | Everyone | +20% | +40% | +60% | +100% |
| Gold | Everyone | +20% | +40% | +60% | +100% |
| Loot (item drop chances) | Everyone | +20% | +40% | +60% | +100% |
| Skill training (weapons, shielding) | Knight, Paladin | +20% | +40% | +60% | +100% |
| Magic training | Sorcerer, Druid, Paladin | +20% | +40% | +60% | +100% |
| Luck | Everyone | +5 | +10 | +15 | +25 |

A Legendary card only shows up while all 5 picks (or 25 luck) still fit, which means no picks of that card yet (or 25 luck or less from Luck cards).

---

## 6. Fillers (level-up cards, always available)

| Card | What | Common | Rare | Epic | Legendary |
|---|---|---|---|---|---|
| Training | An exercise weapon session for your main skill (magic level for mages, distance for paladins, your weapon's skill for knights) | +1 level | +2 | +3 | +5 |
| Potions | The best potion your level and vocation can drink: health for knights, mana for the others. The other kind appears only as a 4th card | 25 | 50 | 75 | 125 |
| Gold | Gold for the shop | 50 × level | 100 × level | 150 × level | 250 × level |

---

## 7. Boss chests

A boss chest first checks the evolutions: if a recipe is complete, it evolves (see below). Otherwise it gives **1** (60%), **3** (30%) or **5** (10%) free level-up picks, each rolled with its own rarity, plus a **35%** chance of a blessing (which saves you from one death).

---

## 8. Boosts (bought between runs, no rarity)

These are bought with souls and stay between runs. They don't take a slot. Rates go x1, 2, 3, 5, 7, 10, 14, 19, 25, 35, 50 over levels 0–10.

| Boost | Who | Per level (1 → 10) |
|---|---|---|
| XP Boost | Everyone | Experience x2 → x50 |
| Loot Boost | Everyone | Item drop chances x2 → x50 |
| Gold Boost | Everyone | Gold dropped x2 → x50 |
| Haste | Everyone | Speed +30 → +180 |
| Luck | Everyone | Luck +5 → +50 |
| Sword / Axe / Club Training | Knight | Skill trains x2 → x50 faster |
| Distance Training | Paladin | Distance trains x2 → x50 faster |
| Shield Training | Anyone holding a shield or spellbook | Shielding trains x2 → x50 faster |
| Magic Training | Sorcerer, Druid, Paladin | Magic level trains x2 → x50 faster |

---

## 9. Evolutions (from boss chests, no rarity)

A boss chest turns a maxed upgrade plus a partner into a super upgrade. The maxed upgrade keeps working and keeps its slot.

| Evolution | Recipe | Effect |
|---|---|---|
| Stamina Bonus | XP Boost 10 + Gold Boost | Experience x4 on top of XP Boost |
| Gold Pouch | Gold Boost 10 + Loot Boost | Loot corpses from 3 tiles away; loot you can't use is sold on the spot |
| Draken Boots | Haste 10 + Swiftness | Speed +60, and you walk through monsters |
| Blood Rage | Powerful Vampirism + Strike | 30% critical hit chance, and critical hits heal you for the damage |
| Mastermind | Magic Training 10 + Void | Spells cost half mana and recharge 30% faster |
| Avatar of Steel | Shield Training 10 + any protection imbuement | Take 30% less damage |
| Elemental Burst | A Powerful elemental damage imbuement + a skill imbuement | Your weapon's element also hits every monster next to the target |
| Weapon Mastery | Sword, Axe, Club or Distance Training 10 + XP Boost | Weapon attacks come twice as fast |
