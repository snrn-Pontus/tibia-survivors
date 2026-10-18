# Tibia Survivors

A survivors-style game with Tibia's real rules: sprites from your own Tibia client, and monsters, spells,
items, prices and formulas from the [Canary](https://github.com/opentibiabr/canary) server project.

## Setup

Needs Node 18+, Python 3 with Pillow (`pip install pillow`), and Tibia installed.

```sh
npm install
npm run fetch-data   # Canary data -> src/tibia/data.json (already included; rerun to refresh)
npm run extract      # sprites from %LOCALAPPDATA%\Tibia\packages\Tibia\assets -> public/assets/
npm run dev
```

If Tibia is somewhere else: `python tools/extract.py "D:\path\to\Tibia\packages\Tibia\assets"`.

## Playing

- Move with WASD / arrows / gamepad, one tile at a time. Everything else is automatic, like a Tibia
  player on hotkeys: your target (red square), weapon attacks every 2 s, spells, runes, healing and potions.
- **The client** is laid out like Tibia's (and Minibia's): two window columns on the right with the minimap
  (zone rings), health, mana and condition icons, then Equipment, Skills, Battle, Backpack and Supplies windows. Drag a
  window by its title to move it (also to the other column), resize it by its bottom edge, minimize or close
  it (the toolbar reopens it). The layout is remembered.
- **Battle window**: creatures on screen, nearest first; click one to attack it. **Right-click** a monster on
  the map to attack it too. A target you pick stays until it dies.
  The button in its title bar (or **T**) sets who auto-targeting picks: the *closest* creature, or the *weakest*
  (lowest health left, by percent); the list sorts the same way.
- **Fight modes** (next to the equipment, remembered between runs), with Canary's factors:
  *offensive* (damage x1, defense x0.5 right after a swing, mitigation x0.8), *balanced* (x0.75, x0.75, x1.0),
  *defensive* (x0.5, x1.0, x1.2); and *chase opponent* or *stand while fighting* (**C** toggles).
- **Hotbar** (F1-F12, or 1-0, -, =): your spells, runes and potions, filled in as you get them, with cooldown
  clocks and counts. Auto-combat keeps going; the hotbar lets you cast or drink on top of it.
- **Backpack**: a real Tibia container window holding the loot you pick up (20 slots, newest item in front,
  stackables stacking to 100 with Tibia's count sprites). When it fills up, a new backpack takes its last slot;
  click a backpack to open it, the arrow goes back up. Click gear to put it on (what it replaces goes in the
  backpack; a stack of spears or arrows goes whole), anything else to look at it; click the backpack in the
  Equipment window to open the window again.
- **Hover any item** (backpack, equipment, supplies, shop) for its stats, what it needs (red if you don't
  have it), how it compares with what you wear, and what NPCs pay.
- **Console** under the view: Server Log, Loot and Combat tabs (a tab blinks when it has news).
- **P / Esc** pauses: character sheet, and NPC trade in tabs: weapons, armor, ammunition, potions, runes (bought
  in packs: potions by 1, 5, 10 or 25), and selling, item by item or everything. Anyone can buy and use gear
  without a vocation requirement, as in Tibia (a paladin with spears and a shield); your vocation's own kind
  of weapon is listed first and is what it equips by itself.
- **Inside a run, everything is real Tibia** (x1 rates). Every run starts in Rookgaard at level 1 with a club and a
  coat and no gold; at level 8 you choose a vocation (level, skills and gear carry over).
- **The world is zones**, rings around where you start (Rookgaard Fields, Troll Woods, Orc Fortress, Cyclopolis,
  Dragon Lairs, ... Pits of Inferno). It doesn't follow your level: walk further out for tougher monsters.
  Each zone's real Tibia bosses appear after you've killed enough there, and drop treasure chests.
  The run is endless and ends when you die.
- **Souls** (the meta currency, like Project Ebonhold's Soul Ashes) come from kills (a tenth of the experience,
  a fifth for bosses), from your first kill ever in each zone of a creature that lives there (once per
  account, 10 x the zone number + 1), from **achievements** (killing 10, 100 and 1,000 of a creature over all
  your runs, or 1, 5 and 25 of a boss; listed on the title screen) and from surviving. They are all kept when you die and spent
  between runs on permanent unlocks: better **starting gear** (real items, tier by tier), starting gold and
  potions, rerolls for level-up choices, blessings, and the rate **boosts** (XP, Loot, Gold, Haste, skill
  training: x3, x6, x10 ... x256 per level).
- **Rookgaard unlocks** make levels 1-8 faster and stop working when you choose a vocation, so the mainland
  stays as it is: Rookgaard experience and training (x5 to x50; training keeps your skills at 8 where a slower
  run would have them), Rookgaard regeneration (x5 to x20), and Dawnport (start at level 8, once you've reached 8).
- New spells are learned when you reach their level. Auto-combat casts the best attack spell or rune, heals with
  spells or healing runes, and keeps a fleeing target (fleeing monsters run to the edge of the screen and stop).
  Unlooted corpses show their best item floating above them.
- In-run level-ups offer imbuements (6 slots), exercise weapons and potions; killing 5, 25 and
  100 of a creature (bestiary stages) and skill advances give choices too. Evolutions come from boss chests.
- Monsters leave their real corpse with the loot inside; walk onto or next to it to loot. Bodies rot
  after a minute. The view shows 15 x 11 tiles, like the Tibia client.

## What's real

| | Source |
|---|---|
| Movement | step time from speed (`110 + level - 1`) and ground speed; diagonal ×3 for monsters (you: ×1.41, see below); one creature per tile; trees and bushes block (the client's `unpass` flag) |
| Monsters | health, experience, speed, armor, defense, melee, spells (targeted, waves, bursts), element resistances, `targetDistance`, `runHealth`, loot tables (Canary monster files) |
| Conditions | poison, burning, electrified... from bites and condition spells: a total split into shrinking ticks (`ConditionDamage::generateDamageList`), a new one only replacing a weaker one, ticks reduced by equipment protection only |
| Fields | fire, poison and energy fields from monster field spells (`firefield` etc. leave `ITEM_FIREFIELD_PVP_FULL`...): damage, duration and decay from items.xml (a fire field burns 7 x 20, cools to 7 x 10, then goes out), hurt on stepping in, monsters walk around fields they aren't immune to, and so does chase autowalk |
| Summons | `monster.summon` (necromancers raise ghouls, giant spiders call poison spiders, demons fire elementals...): chance per interval, per-kind counts and `maxSummons` (`Monster::onThinkDefense`); no experience or corpse, and they die with their master |
| Player | HP/mana per level, regeneration, skill and magic level training (`Vocation::getReqSkillTries`, `getReqMana`) |
| Blocking | yours: 2 blocks at most, +1 per second (`Creature::blockHit`): shield defense only stops hits while a block is left, so crowds hurt more; then armor and mitigation (`PlayerWheel::calculateMitigation`). Monsters: armor, element modifiers and their mitigation percent (`Creature::mitigateDamage`), but not their defense value, which Canary still applies (a rat's defense of 5 cancels almost every hit of a new character; real Tibia's creatures only list armor and mitigation) |
| Damage | melee/distance/wand formulas (`weapons.cpp`), fight modes (`getAttackFactor`, `getDefenseFactor`), defense and armor (`Creature::blockHit`, `Player::getDefense`), equipment absorb |
| Spells and runes | words, level, mana, cooldowns, group cooldowns, areas (`register_spells.lua`), damage/heal formulas, Magic Shield; classes only get their own spells, runes, weapons and potions; rookies can use anything without a vocation requirement (spears, throwing stars, bows, clubs, swords, axes), thrown weapons breaking at their real `breakchance` |
| Items | attack, defense, armor, range, level and vocation requirements, ring regeneration, NPC buy/sell prices (all NPC shop lists) |
| Containers | slots (`containersize`), new items in front and stacks of 100 (Canary's `Container`), which items stack (the `cumulative` flag in Canary's appearances.dat), the count sprites 1, 2, 3, 4, 5+, 10+, 25+, 50+ (otclient's `Item::calculatePatterns`) |

Not real: the boosts, imbuements as level-up rewards, quick-looting corpses, a shop in the pause menu,
never running out of backpacks, your diagonal steps (and chase autowalk) costing their distance (x1.41) instead of x3, thrown spears coming back to you, fleeing monsters stopping at the screen's
edge, and monsters spawning around you.

## Code

- `tools/fetch_tibia_data.py`: parses Canary's Lua/XML into `src/tibia/data.json`.
- `tools/extract.py`, `tools/tibia_assets.py`: read the client's protobuf appearances and LZMA sprite sheets.
- `src/tibia/rules.ts` (formulas), `src/tibia/db.ts` (data, areas, spell formulas), `src/movement.ts` (walking).
- `src/game.ts` (world, monsters, combat, loot), `src/autocast.ts` (the hotkey "player"), `src/character.ts`.
- `src/render.ts` draws the world on a canvas; `src/hud.ts` is the HTML client around it (windows, hotbar,
  console, names and health bars); `src/ui.ts` the menus.
- `src/data.ts`: vocation kits, hunting grounds, bosses. `src/upgrades.ts`: boosts and slots. `npm run sim -- [voc] [runs] [seconds]` plays whole runs headless
  (0-3 = knight, paladin, sorcerer, druid), for balancing. `npm run sim:rook -- [runs] [voc]` compares
  Rookgaard unlock setups: time to level 8, skills at 8, and the mainland after.

## Assets

The sprites are CipSoft's. They're extracted locally from your own client and git-ignored;
don't commit or redistribute `public/assets/` (or a build containing it).
