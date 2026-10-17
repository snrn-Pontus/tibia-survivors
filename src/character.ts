// The player's character sheet: level, experience, skills, equipment and supplies, with Tibia's rules.
import { expRate, MAGIC_RATE, SKILL_RATE, START_GOLD, START_LEVEL, type VocationDef } from "./data";
import { canWear, item, itemId, POTIONS, PRICES, SPELLS, VOCATION_DATA, wornItem, type Element, type ItemData, type SpellData, type VocationData } from "./tibia/db";
import { IMBUEMENTS, imbuement, type ImbuementKind } from "./tibia/imbuements";
import type { EvolutionId } from "./evolutions";
import { BOOSTS, boostRate, hasteBonus, MAX_SLOTS, type BoostId } from "./upgrades";
import { expForLevel, maxHealthAt, maxManaAt, reqMana, reqSkillTries, SKILL, SKILL_NAMES } from "./tibia/rules";

export type LevelChoice =
  | { kind: "spell"; spell: SpellData }
  | { kind: "imbue"; id: string }
  | { kind: "boost"; id: BoostId }
  | { kind: "train"; skill: number | "magic" } // an exercise weapon session
  | { kind: "supply"; id: number; n: number }; // a backpack of potions

export type Slot = "head" | "necklace" | "armor" | "legs" | "feet" | "ring" | "weapon" | "shield" | "ammo";
export const SLOTS: Slot[] = ["head", "necklace", "weapon", "armor", "shield", "legs", "ring", "feet", "ammo"];

const SKILL_ATTR = ["skillfist", "skillclub", "skillsword", "skillaxe", "skilldist", "skillshield"];
const WEAPON_SKILL: Record<string, number> = { sword: SKILL.sword, axe: SKILL.axe, club: SKILL.club };

export class Character {
  vd: VocationData;
  level = START_LEVEL;
  exp = expForLevel(START_LEVEL);
  hp: number;
  mana: number;
  skills: { level: number; tries: number }[];
  magicLevel: number;
  manaSpent = 0;
  gold = START_GOLD;
  equipment: Partial<Record<Slot, number>> = {};
  supplies = new Map<number, number>(); // potions, runes, ammo
  known = new Set<string>(); // spell files
  backpack = new Map<number, number>(); // loot we can't use: item id -> count
  imbuements = new Map<string, number>(); // id -> tier (1 Basic, 2 Intricate, 3 Powerful)
  boosts = new Map<BoostId, number>(); // id -> level
  evolutions = new Set<EvolutionId>();
  blessings = 0; // Tibia blessings: each one saves you from a death

  constructor(public voc: VocationDef) {
    this.vd = VOCATION_DATA[voc.id];
    this.skills = voc.skills.map((level) => ({ level, tries: 0 }));
    this.magicLevel = voc.magicLevel;
    for (const name of voc.equipment) this.equip(itemId(name));
    for (const [name, n] of Object.entries(voc.supplies)) this.supplies.set(itemId(name), n);
    if (voc.ammo) this.equipment.ammo = itemId(voc.ammo);
    for (const s of this.learnable()) this.known.add(s.file); // spells up to level 8 come with the vocation
    this.hp = this.maxHp;
    this.mana = this.maxMana;
  }

  get maxHp() { return maxHealthAt(this.vd, this.level); }
  get maxMana() { return maxManaAt(this.vd, this.level); }

  private worn(): ItemData[] {
    return Object.values(this.equipment).map((id) => wornItem(id!)).filter((x): x is ItemData => !!x);
  }

  private bonus(attr: string): number {
    return this.worn().reduce((s, it) => s + (Number(it[attr]) || 0), 0);
  }

  /** Base speed 110 + (level - 1), plus boots of haste, time ring... */
  get speed() { return this.vd.baseSpeed + (this.level - 1) + this.bonus("speed") + this.imbued("speed") + hasteBonus(this.boostLevel("haste")) + (this.evolutions.has("draken") ? 60 : 0); }

  boostLevel(id: BoostId) { return this.boosts.get(id) ?? 0; }
  /** Rate multiplier from a boost (x1 when not picked). */
  rate(id: BoostId) { return boostRate(this.boostLevel(id)); }
  get slotsUsed() { return this.imbuements.size; } // boosts are bought between runs and take no slot
  skill(i: number) { return this.skills[i].level + this.bonus(SKILL_ATTR[i]) + this.imbued("skill", (d) => d.skill === i); }
  get ml() { return this.magicLevel + this.bonus("magiclevelpoints") + this.imbued("magic"); }

  /** Sum of active imbuement values of a kind (optionally filtered). */
  imbued(kind: ImbuementKind, match: (d: (typeof IMBUEMENTS)[number]) => boolean = () => true): number {
    let v = 0;
    for (const [id, tier] of this.imbuements) {
      const d = imbuement(id);
      if (d.kind === kind && match(d)) v += d.values[tier - 1];
    }
    return v;
  }

  /** Three level-up choices: a new class spell when one has unlocked, the rest imbuements. */
  rollChoices(): LevelChoice[] {
    const spells = this.learnable().sort((a, b) => (b.level ?? 0) - (a.level ?? 0));
    const out: LevelChoice[] = spells.slice(0, 1).map((spell) => ({ kind: "spell", spell }));
    // Imbuements use MAX_SLOTS; once full, only the ones you have can be upgraded. (Boosts are bought between runs.)
    const full = this.slotsUsed >= MAX_SLOTS;
    const ups: LevelChoice[] = this.imbuementOptions().filter((d) => !full || this.imbuements.has(d.id))
      .map((d) => ({ kind: "imbue", id: d.id }) as LevelChoice).sort(() => Math.random() - 0.5);
    for (const u of ups) {
      if (out.length >= 3) break;
      out.push(u);
    }
    // Repeatable fillers, so every level has a choice.
    const fillers: LevelChoice[] = [this.trainChoice(), this.supplyChoice()];
    for (const f of fillers) if (out.length < 3) out.push(f);
    return out;
  }

  /** Exercise weapon for the vocation's main skill (magic level for mages). */
  trainChoice(): LevelChoice {
    if (this.voc.id === "sorcerer" || this.voc.id === "druid") return { kind: "train", skill: "magic" };
    return { kind: "train", skill: this.voc.id === "paladin" ? SKILL.distance : this.weaponSkill };
  }

  /** 25 of the best potion this vocation and level may drink: health for knights, mana for the others. */
  supplyChoice(): LevelChoice {
    const kind = this.voc.id === "knight" ? "health" : "mana";
    let best = 0, bestV = 0;
    for (const [k, pot] of Object.entries(POTIONS)) {
      const range = pot[kind];
      if (!range || (pot.level && this.level < pot.level) || (pot.voc && !pot.voc.includes(this.voc.id))) continue;
      if (pot.health && pot.mana) continue; // spirit potions only via the shop
      if (range[0] + range[1] > bestV) { bestV = range[0] + range[1]; best = Number(k); }
    }
    return { kind: "supply", id: best, n: 25 };
  }

  applyChoice(c: LevelChoice) {
    if (c.kind === "spell") this.known.add(c.spell.file);
    else if (c.kind === "imbue") this.imbuements.set(c.id, (this.imbuements.get(c.id) ?? 0) + 1);
    else if (c.kind === "boost") this.boosts.set(c.id, this.boostLevel(c.id) + 1);
    else if (c.kind === "train") {
      if (c.skill === "magic") this.magicLevel++;
      else this.skills[c.skill].level++;
    } else this.supplies.set(c.id, (this.supplies.get(c.id) ?? 0) + c.n);
  }

  /** Imbuements that can be added or upgraded right now. */
  imbuementOptions() {
    // Like on a real weapon, only one elemental damage imbuement at a time.
    const convert = [...this.imbuements.keys()].find((id) => imbuement(id).kind === "convert");
    return IMBUEMENTS.filter((d) => d.for(this.voc.id, this.weaponSkill) && (this.imbuements.get(d.id) ?? 0) < 3
      && !(d.kind === "convert" && convert && convert !== d.id));
  }

  /** Player::getArmor: armor of everything but the hands. */
  get armor() {
    let a = 0;
    for (const slot of ["head", "necklace", "armor", "legs", "feet", "ring", "ammo"] as Slot[]) {
      const id = this.equipment[slot];
      if (id) a += wornItem(id)?.armor ?? 0;
    }
    return Math.floor(a * this.vd.armor);
  }

  /** Percent of damage of an element absorbed by equipment ("poison" is Tibia's name for earth here). */
  absorb(el: Element): number {
    const key = el === "earth" ? "absorbpercentpoison" : `absorbpercent${el}`;
    return Math.min(100, this.bonus(key) + this.bonus("absorbpercentall") + this.imbued("protect", (d) => d.element === el));
  }

  get weapon(): ItemData | undefined { return this.equipment.weapon ? item(this.equipment.weapon) : undefined; }
  get shield(): ItemData | undefined { return this.equipment.shield ? item(this.equipment.shield) : undefined; }
  get ammo(): ItemData | undefined { return this.equipment.ammo ? item(this.equipment.ammo) : undefined; }

  /** The skill the current weapon trains and uses. */
  get weaponSkill(): number {
    const t = this.weapon?.weapontype;
    if (t === "distance" || t === "missile") return SKILL.distance;
    return t && t in WEAPON_SKILL ? WEAPON_SKILL[t] : SKILL.fist;
  }

  /** Attack value for formulas: weapon attack, plus ammunition for bows. */
  get attackValue(): number {
    const w = this.weapon;
    if (!w) return 7;
    if (w.weapontype === "distance") return (w.attack ?? 0) + (this.ammo?.attack ?? 0);
    return (w.attack ?? 0) + Number(w.elementfire ?? 0) + Number(w.elementice ?? 0) + Number(w.elementearth ?? 0) + Number(w.elementenergy ?? 0);
  }

  get attackRange(): number {
    const w = this.weapon;
    if (!w) return 1;
    if (w.weapontype === "wand" || w.weapontype === "distance" || w.weapontype === "missile") return w.range ?? 1;
    return 1;
  }

  // ---------- progression ----------

  /** Returns the levels gained. */
  addExp(raw: number): { gained: number; amount: number } {
    const amount = Math.round(raw * expRate(this.level) * this.rate("xp") * (this.evolutions.has("stamina") ? 4 : 1));
    this.exp += amount;
    let gained = 0;
    while (this.exp >= expForLevel(this.level + 1)) {
      const hp0 = this.maxHp, mana0 = this.maxMana;
      this.level++;
      gained++;
      this.hp = Math.min(this.maxHp, this.hp + this.maxHp - hp0);
      this.mana = Math.min(this.maxMana, this.mana + this.maxMana - mana0);
    }
    return { gained, amount };
  }

  /** Skill tries (scaled by the server's skill rate). Returns advancement messages. */
  train(skill: number, tries = 1): string[] {
    const msgs: string[] = [];
    const s = this.skills[skill];
    const b = BOOSTS.find((d) => d.skill === skill);
    s.tries += tries * SKILL_RATE * (b ? this.rate(b.id) : 1);
    while (s.tries >= this.reqTries(skill, s.level)) {
      s.tries -= this.reqTries(skill, s.level);
      s.level++;
      msgs.push(`You advanced to ${SKILL_NAMES[skill].toLowerCase()} level ${s.level}.`);
    }
    return msgs;
  }

  spendMana(n: number): string[] {
    const msgs: string[] = [];
    this.mana -= n;
    this.manaSpent += n * MAGIC_RATE * this.rate("train_magic");
    while (this.manaSpent >= reqMana(this.vd, this.magicLevel)) {
      this.manaSpent -= reqMana(this.vd, this.magicLevel);
      this.magicLevel++;
      msgs.push(`You advanced to magic level ${this.magicLevel}.`);
    }
    return msgs;
  }

  skillPercent(i: number) { return this.skills[i].tries / this.reqTries(i, this.skills[i].level); }

  /** Tries for the next skill level. Rookies (Tibia's "None", multiplier 2.0) learn like a vocation as they
   *  level that skill's training boost: the multiplier drops by 0.09 per boost level, to 1.1 at level 10. */
  reqTries(skill: number, level: number) {
    let mult = this.vd.skillMultipliers[skill];
    const b = BOOSTS.find((d) => d.skill === skill);
    if (this.voc.id === "none" && b) mult = Math.max(1.1, mult - 0.09 * this.boostLevel(b.id));
    return reqSkillTries(this.vd, skill, level, mult);
  }
  mlPercent() { return this.manaSpent / reqMana(this.vd, this.magicLevel); }
  levelPercent() { return (this.exp - expForLevel(this.level)) / (expForLevel(this.level + 1) - expForLevel(this.level)); }

  // ---------- spells ----------

  /** Instant spells of this vocation the character has the level for but hasn't learned. */
  learnable(): SpellData[] {
    return SPELLS.filter((s) => s.kind === "instant" && s.vocations.includes(this.voc.id) && (s.level ?? 0) <= this.level && !this.known.has(s.file));
  }

  /** Runes this vocation conjures (and so may use here), with enough level and magic level. */
  usableRunes(): SpellData[] {
    return SPELLS.filter((s) => s.kind === "rune" && s.vocations.includes(this.voc.id) && (s.level ?? 0) <= this.level && (s.magicLevel ?? 0) <= this.ml);
  }

  // ---------- equipment ----------

  /** Start on the main continent instead of Rookgaard: level 8 with the vocation's usual skills. */
  startAsMain(v: VocationDef) {
    this.level = 8;
    this.exp = expForLevel(8);
    this.skills = v.skills.map((level) => ({ level, tries: 0 }));
    this.magicLevel = v.magicLevel;
    this.setVocation(v);
    this.hp = this.maxHp;
    this.mana = this.maxMana;
  }

/** Leaving Rookgaard: the vocation's kit and starting spells; upgrades the new class can't use are dropped. */
  setVocation(v: VocationDef) {
    this.voc = v;
    this.vd = VOCATION_DATA[v.id];
    const old = Object.values(this.equipment).filter((id): id is number => !!id);
    this.equipment = {};
    for (const name of v.equipment) this.equip(itemId(name));
    // Keep rookie gear that beats the vocation's kit (unlocked starting gear, loot); the rest goes in the bag.
    for (const id of old) if (!this.offer(id)) this.stash(id);
    if (v.ammo) this.equipment.ammo = itemId(v.ammo);
    for (const [name, n] of Object.entries(v.supplies)) {
      const id = itemId(name);
      this.supplies.set(id, (this.supplies.get(id) ?? 0) + n);
    }
    for (const s of this.learnable()) if ((s.level ?? 0) <= 8) this.known.add(s.file);
    for (const id of [...this.imbuements.keys()]) if (!imbuement(id).for(v.id, this.weaponSkill)) this.imbuements.delete(id);
  }

  /** Which slot an item goes in for this vocation, or null if the class doesn't use it. */
  slotFor(it: ItemData): Slot | null {
    const v = this.voc.id;
    const wt = it.weapontype;
    // Bows and wands carry no "slot" attribute in items.xml, only a weapon type.
    const slot = it.slot ?? (wt && ["sword", "axe", "club", "distance", "missile", "wand"].includes(wt) ? "hand"
      : wt === "shield" || wt === "spellbook" ? "shield" : wt === "ammo" || wt === "ammunition" ? "ammo" : undefined);
    switch (slot) {
      case "head": case "necklace": case "armor": case "legs": case "feet": case "ring":
        return slot as Slot;
      case "ammo":
        return v === "paladin" && (it.ammotype === "arrow" || it.ammotype === "bolt") ? "ammo" : null;
      case "shield":
        if (wt === "spellbook") return v === "sorcerer" || v === "druid" ? "shield" : null;
        return v === "knight" || v === "none" ? "shield" : null;
      case "hand":
        if ((v === "knight" || v === "none") && wt && wt in WEAPON_SKILL) return "weapon";
        if (v === "paladin" && wt === "distance" && (it.ammotype === "arrow" || it.ammotype === "bolt")) return "weapon";
        if ((v === "sorcerer" || v === "druid") && wt === "wand") return "weapon";
        return null;
    }
    return null;
  }

  /** How good an item is in its slot, for auto-equipping loot. */
  score(it: ItemData, slot: Slot): number {
    const w = wornItem(it.id) ?? it;
    if (slot === "weapon") {
      if (w.weapontype === "wand") return ((w.fromdamage ?? 0) + (w.todamage ?? 0)) / 2;
      if (w.weapontype === "distance") return (w.attack ?? 0) + (w.range ?? 0) + (Number(w.hitchance) || 0);
      const skill = this.skills[WEAPON_SKILL[w.weapontype!] ?? 0].level;
      return ((w.attack ?? 0) + Number(w.elementfire ?? 0) + Number(w.elementice ?? 0) + Number(w.elementearth ?? 0) + Number(w.elementenergy ?? 0)) * skill
        + (w.defense ?? 0) * 0.5;
    }
    if (slot === "ammo") return w.attack ?? 0;
    let s = (w.armor ?? 0) * 4 + (w.defense ?? 0) * 2 + (Number(w.speed) || 0) * 0.5 + (Number(w.magiclevelpoints) || 0) * 6;
    for (const k of Object.keys(w)) {
      if (k.startsWith("absorbpercent")) s += Number(w[k]) * 0.5;
      if (k.startsWith("skill")) s += Number(w[k]) * 3;
    }
    if (w.healthticks) s += ((w.healthgain ?? 0) * 6000) / w.healthticks;
    if (w.manaticks) s += ((w.managain ?? 0) * 3000) / w.manaticks;
    return s;
  }

  equip(id: number): boolean {
    const it = item(id);
    if (!it) return false;
    const slot = this.slotFor(it);
    if (!slot) return false;
    this.equipment[slot] = id;
    if (it.slottype === "two-handed") delete this.equipment.shield;
    return true;
  }

  /** Equipment NPCs sell that this character can wear and that beats what it has, cheapest first per slot. */
  /** Class weapons NPCs sell, from what you could wield soon to what you can now, cheapest first. */
  shopWeapons(): { id: number; price: number; usable: boolean }[] {
    const out: { id: number; price: number; usable: boolean }[] = [];
    for (const [k, pr] of Object.entries(PRICES)) {
      const id = Number(k), it = item(id);
      if (!pr.buy || !it || this.slotFor(it) !== "weapon" || !canWear(it, this.voc.id, 9999)) continue;
      if ((it.level ?? 0) > this.level + 40) continue;
      out.push({ id, price: pr.buy, usable: canWear(it, this.voc.id, this.level) });
    }
    return out.sort((a, b) => (item(a.id)!.level ?? 0) - (item(b.id)!.level ?? 0) || a.price - b.price);
  }

  /** Ammunition for the equipped bow or crossbow. */
  shopAmmo(): { id: number; price: number; usable: boolean }[] {
    const type = this.weapon?.ammotype;
    if (!type) return [];
    return Object.entries(PRICES)
      .map(([k, pr]) => ({ id: Number(k), price: pr.buy ?? 0, it: item(Number(k)) }))
      .filter((x) => x.price && x.it && x.it.ammotype === type && x.it.weapontype !== "distance")
      .map((x) => ({ id: x.id, price: x.price, usable: canWear(x.it!, this.voc.id, this.level) }))
      .sort((a, b) => (item(a.id)!.attack ?? 0) - (item(b.id)!.attack ?? 0));
  }

  /** Make sure the ammo slot holds ammunition the weapon fires, picking the best we carry. */
  fitAmmo() {
    const type = this.weapon?.ammotype;
    if (!type || this.ammo?.ammotype === type && (this.supplies.get(this.equipment.ammo!) ?? 0) > 0) return;
    let best: number | undefined, bestAtk = -1;
    for (const [id, n] of this.supplies) {
      const it = item(id);
      if (n > 0 && it?.ammotype === type && it.weapontype !== "distance" && canWear(it, this.voc.id, this.level) && (it.attack ?? 0) > bestAtk) {
        best = id;
        bestAtk = it.attack ?? 0;
      }
    }
    if (best !== undefined) this.equipment.ammo = best;
  }

  shopUpgrades(): { id: number; slot: Slot; price: number }[] {
    const out: { id: number; slot: Slot; price: number }[] = [];
    for (const [k, pr] of Object.entries(PRICES)) {
      const id = Number(k), it = item(id);
      if (!pr.buy || !it || !canWear(it, this.voc.id, this.level)) continue;
      const slot = this.slotFor(it);
      if (!slot || slot === "ammo" || (slot === "shield" && this.weapon?.slottype === "two-handed")) continue;
      const cur = this.equipment[slot];
      if (cur && this.score(item(cur)!, slot) >= this.score(it, slot)) continue;
      out.push({ id, slot, price: pr.buy });
    }
    return out.sort((a, b) => a.price - b.price);
  }

  /** What NPCs pay for the loot in the backpack. */
  lootValue(): number {
    let v = 0;
    for (const [id, n] of this.backpack) v += (PRICES[id]?.sell ?? 0) * n;
    return v;
  }

  stash(id: number, n = 1) {
    this.backpack.set(id, (this.backpack.get(id) ?? 0) + n);
  }

  get backpackCount() {
    let c = 0;
    for (const n of this.backpack.values()) c += n;
    return c;
  }

  /** Equip an item if it fits this vocation and beats what's worn. */
  offer(id: number): boolean {
    const it = item(id);
    if (!it || !canWear(it, this.voc.id, this.level)) return false;
    const slot = this.slotFor(it);
    if (!slot) return false;
    if (slot === "shield" && this.weapon?.slottype === "two-handed") return false;
    const cur = this.equipment[slot];
    if (cur && this.score(item(cur)!, slot) >= this.score(it, slot)) return false;
    if (cur) this.stash(cur);
    this.equip(id);
    return true;
  }
}
