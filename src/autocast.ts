// The character fights by itself, the way a Tibia player works their hotkeys: keep a target,
// auto attack every 2 s, cast the best class spell or rune off cooldown, heal, and drink potions.
// You only steer. Everything goes through Game, so mana, charges, cooldowns and formulas are real.
import { cheb, type Game, type Monster } from "./game";
import { canWear, item, POTIONS, SPELLS, spellFormula, type Element, type SpellData } from "./tibia/db";

const HEAL_AT = 0.6; // heal spells below 60% HP
const POTION_AT = 0.45; // health potion below 45% HP
const MANA_POTION_AT = 0.4;

export function autoCombat(g: Game) {
  if (g.over) return;
  const ch = g.ch, p = g.player;
  const hpPct = ch.hp / ch.maxHp, manaPct = ch.mana / ch.maxMana;

  // Potions (1 s exhaust, separate from spells).
  if (g.time >= g.potionReady) {
    if (hpPct < POTION_AT) drinkBest(g, "health");
    else if (manaPct < MANA_POTION_AT && (ch.voc.id !== "knight" || hpPct > 0.7)) drinkBest(g, "mana");
  }

  // Healing spells (healing group, 1 s).
  if (hpPct < HEAL_AT && g.time >= g.groupReady.healing) {
    const heal = knownSpells(g, "healing").filter((s) => ready(g, s) && ch.mana >= g.manaCost(s))
      .sort((a, b) => expected(g, b) - expected(g, a))[0];
    if (heal) g.cast(heal, p.dir);
  }

  // Magic shield (utamo vita): keep it up.
  if (g.time >= g.groupReady.support) {
    const shield = SPELLS.find((s) => s.file === "magic_shield" && ch.known.has(s.file));
    const low = g.time >= g.manaShieldUntil - 5 || g.manaShield < g.manaShieldMax * 0.5;
    if (shield && low && ready(g, shield) && ch.mana >= (shield.mana ?? 0) + 50) g.cast(shield, p.dir);
  }

  // Keep a target: the current one while it lives and stays near, else the closest one our weapon can hurt
  // (a knight's sword does nothing to a ghost).
  const weaponEl = ch.weapon?.weapontype === "wand" ? (ch.weapon.wandtype as Element) ?? "energy" : "physical";
  const hurtable = (m: Monster) => (m.data.elements[weaponEl] ?? 0) < 100;
  // A target you picked yourself stays until it dies or leaves the screen.
  const picked = g.manualTarget ? g.monsters.find((m) => m.id === g.targetId && !m.dead && cheb(m.tx, m.ty, p.tx, p.ty) <= 10) : undefined;
  if (!picked) g.manualTarget = false;
  let target = picked ?? g.monsters.find((m) => m.id === g.targetId && !m.dead && hurtable(m) && cheb(m.tx, m.ty, p.tx, p.ty) <= 7);
  const adjacent = g.monstersInRange(1).filter(hurtable);
  if (!picked && ch.attackRange === 1 && adjacent.length && (!target || cheb(target.tx, target.ty, p.tx, p.ty) > 1)) target = adjacent[0];
  if (!picked && target && cheb(target.tx, target.ty, p.tx, p.ty) > ch.attackRange) {
    // Out of weapon range (a fleeing monster, say): switch to one we can hit now.
    const inRange = g.monstersInRange(ch.attackRange).filter(hurtable)[0];
    if (inRange) target = inRange;
  }
  if (!target) {
    target = g.monstersInRange(7).filter(hurtable).sort((a, b) => cheb(a.tx, a.ty, p.tx, p.ty) - cheb(b.tx, b.ty, p.tx, p.ty))[0];
  }
  g.targetId = target?.id ?? 0;
  if (!target) return;

  // Weapon: every attackSpeed (2000 ms).
  // Weapon Mastery halves it.
  if (g.time >= g.nextWeapon && g.weaponAttack(target)) {
    g.nextWeapon = g.time + (ch.vd.attackSpeed / 1000) * (ch.evolutions.has("weaponmastery") ? 0.5 : 1);
  }

  // Attack spells and runes share the attack group cooldown.
  if (g.time < g.groupReady.attack) return;
  const reserve = Math.min(ch.maxMana * 0.25, 2 * Math.max(0, ...knownSpells(g, "healing").map((s) => s.mana ?? 0)));
  let best: { s: SpellData; dir: number; target?: Monster; value: number } | null = null;
  for (const s of [...knownSpells(g, "attack"), ...ch.usableRunes()]) {
    if (!ready(g, s)) continue;
    if (s.kind === "rune" ? (ch.supplies.get(s.runeId!) ?? 0) <= 0 : ch.mana - g.manaCost(s) < (ch.voc.id === "knight" ? 0 : reserve)) continue;
    const per = expected(g, s);
    const dirs = s.needDirection ? [0, 1, 2, 3] : [p.dir];
    const targets: (Monster | undefined)[] = s.needTarget || s.kind === "rune" ? [target, ...g.monstersInRange(g.spellRange(s))] : [undefined];
    for (const t of targets) {
      if (t && cheb(t.tx, t.ty, p.tx, p.ty) > g.spellRange(s)) continue;
      for (const dir of dirs) {
        let value = 0;
        for (const [tx, ty] of g.spellTiles(s, dir, t)) {
          const m = g.monsterAt(tx, ty);
          if (m) value += Math.min(m.hp, per * (100 - (m.data.elements[s.element] ?? 0)) / 100);
        }
        // Runes cost money, mana is free: prefer spells a little.
        if (s.kind === "rune") value *= 0.9;
        if (value > (best?.value ?? 0)) best = { s, dir, target: t, value };
      }
    }
  }
  if (best && best.value >= 1) g.cast(best.s, best.dir, best.target);
}

function knownSpells(g: Game, group: SpellData["group"]): SpellData[] {
  const ch = g.ch;
  return SPELLS.filter((s) => s.kind === "instant" && s.group === group && ch.known.has(s.file));
}

function ready(g: Game, s: SpellData) {
  return g.time >= (g.spellReady.get(s.file) ?? 0);
}

function expected(g: Game, s: SpellData): number {
  const ch = g.ch;
  const [lo, hi] = spellFormula(s)(ch.level, ch.ml, ch.skill(ch.weaponSkill), ch.attackValue);
  return (lo + hi) / 2;
}

/** The strongest potion of a kind this vocation and level may drink. */
function drinkBest(g: Game, kind: "health" | "mana") {
  const ch = g.ch;
  let best = 0, bestValue = 0;
  for (const [id, n] of ch.supplies) {
    const pot = POTIONS[id];
    if (!pot || n <= 0 || !pot[kind]) continue;
    if (pot.level && ch.level < pot.level) continue;
    if (pot.voc && !pot.voc.includes(ch.voc.id)) continue;
    const it = item(id);
    if (it && !canWear(it, ch.voc.id, ch.level)) continue;
    const v = (pot[kind]![0] + pot[kind]![1]) / 2;
    if (v > bestValue) { best = id; bestValue = v; }
  }
  if (best) g.usePotion(best);
}
