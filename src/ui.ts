import type { Atlas } from "./atlas";
import { achievement, BOSS_MILESTONES, KILL_MILESTONES, ROOKIE, SHOP, VOCATIONS, ZONES, type VocationDef } from "./data";
import type { LevelChoice } from "./character";
import type { Game } from "./game";
import { imbuement, TIERS } from "./tibia/imbuements";
import { boost, BOOSTS, MAX_BOOST, MAX_SLOTS } from "./upgrades";
import { BLESSING_COST, boostCost, buyBlessing, buyBoost, buyTier, loadSave, tier, trackTier, TRACKS, writeSave, type Save } from "./meta";
import { EVOLUTIONS, evolution, evolutionsFor } from "./evolutions";
import type { ChestResult } from "./game";
import { canWear, item, itemId, MONSTERS, POTIONS, PRICES, SPELLS, wornItem, type ItemData, type SpellData } from "./tibia/db";
import { SKILL_NAMES } from "./tibia/rules";
import { charm, CHARM_TIERS, describeCharm, describeGrade, describePrey, PREY_SLOTS, spellGrades } from "./picks";

/** DOM overlay menus. Every screen is a list of focusable buttons, so keys and gamepads can drive it. */
/** Card icons for damage charms, by element (Tibia's hit effects). */
const CHARM_EFFECTS: Record<string, number> = { physical: 10, fire: 16, earth: 9, ice: 44, energy: 12, death: 39, holy: 40 }; // the charms' own effects

type ShopTab = "weapons" | "shields" | "helmets" | "armor" | "legs" | "boots" | "jewelry" | "ammo" | "potions" | "runes" | "sell";
/** Which equipment slots each gear tab lists. */
const GEAR_TABS: Partial<Record<ShopTab, string[]>> = {
  shields: ["shield"], helmets: ["head"], armor: ["armor"], legs: ["legs"], boots: ["feet"], jewelry: ["necklace", "ring"],
};

export class UI {
  private shopTab: ShopTab = "weapons";
  private buttons: HTMLElement[] = [];
  private focus = 0;
  private previews: { canvas: HTMLCanvasElement; sprite: string }[] = [];
  open = false;

  constructor(private root: HTMLElement, private atlas: Atlas) {}

  private screen(cls: string, html: string): HTMLElement {
    this.root.innerHTML = `<div class="panel ${cls}">${html}</div>`;
    this.root.hidden = false;
    this.open = true;
    this.previews = [];
    return this.root.firstElementChild as HTMLElement;
  }

  private setButtons(btns: HTMLElement[], actions: (() => void)[], focus = 0) {
    this.buttons = btns;
    btns.forEach((b, i) => {
      b.addEventListener("click", () => actions[i]());
      b.addEventListener("mouseenter", () => this.setFocus(i));
    });
    this.setFocus(focus);
  }

  private setFocus(i: number) {
    if (!this.buttons.length) return;
    this.focus = (i + this.buttons.length) % this.buttons.length;
    this.buttons.forEach((b, j) => b.classList.toggle("focus", j === this.focus));
  }

  nav(d: number) {
    if (!this.open) return;
    this.setFocus(this.focus + d);
    this.buttons[this.focus]?.scrollIntoView({ block: "nearest" });
  }
  activate() { if (this.open) this.buttons[this.focus]?.click(); }
  pick(i: number) { if (this.open && i < this.buttons.length) this.buttons[i].click(); }

  close() {
    this.root.hidden = true;
    this.root.innerHTML = "";
    this.open = false;
    this.buttons = [];
    this.previews = [];
  }

  tick(t: number) {
    for (const p of this.previews) {
      const frames = this.atlas.data.creatures[p.sprite].walk[2];
      const f = frames[Math.floor(t * 8) % frames.length];
      const ctx = p.canvas.getContext("2d")!;
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, p.canvas.width, p.canvas.height);
      const [sx, sy, w, h, ox, oy] = this.atlas.data.frames[f];
      const z = 3;
      ctx.drawImage(this.atlas.img, sx, sy, w, h, (32 + ox) * z, (44 + oy) * z, w * z, h * z);
    }
  }

  private icon(id: number, zoom = 1) {
    return this.atlas.itemIcon(id, 32, zoom);
  }

  /** Between runs: the bank, boosts bought with banked gold, blessings, and where to start. */
  /** Between runs: spend souls on starting gear and other permanent unlocks, then enter Rookgaard. */
  title(save: Save, onStart: () => void, focus = 0) {
    type Entry = { icon: number; label: string; sub: string; cost: number | null; buy: () => boolean };
    const entry = (e: Entry) => `<button class="btn buy" ${e.cost === null || save.souls < e.cost ? "disabled" : ""}>
      <span class="ico" data-id="${e.icon}"></span><span class="label">${e.label}<small>${e.sub}</small></span>
      <span class="price">${e.cost === null ? (e.sub.endsWith(" first") ? "locked" : "max") : `${e.cost.toLocaleString("en-US")} souls`}</span></button>`;
    const ROOK_ICONS: Record<string, number> = { rook_xp: 3061, rook_train: 3270, rook_regen: 3577, dawnport: 2853 };
    const trackEntry = (t: (typeof TRACKS)[number]): Entry => {
      const cur = trackTier(save, t), next = t.tiers[tier(save, t.id) + 1];
      const icon = next?.item ?? cur.item ?? ROOK_ICONS[t.id] ?? (t.id === "potions" ? 266 : t.id === "gold" ? 3031 : 3061);
      const lock = next ? t.locked?.(save) : null;
      return { icon, label: t.name, sub: lock ? `${next!.label}: ${lock.toLowerCase()} first` : next ? `${cur.label} → ${next.label}` : cur.label,
        cost: next && !lock ? next.cost : null, buy: () => buyTier(save, t) };
    };
    const gear = TRACKS.filter((t) => !t.rook).map(trackEntry);
    const rook = TRACKS.filter((t) => t.rook).map(trackEntry);
    const boosts: Entry[] = BOOSTS.map((b) => {
      const lvl = save.boosts[b.id] ?? 0, maxed = lvl >= MAX_BOOST;
      return { icon: b.icon, label: `${b.name} ${lvl}`, sub: b.desc(Math.min(MAX_BOOST, lvl + (maxed ? 0 : 1))),
        cost: maxed ? null : boostCost(b.id, lvl), buy: () => buyBoost(save, b.id) };
    });
    boosts.push({ icon: 3061, label: `Blessing (${save.blessings}/5)`, sub: "Survive one death in your next run.",
      cost: save.blessings >= 5 ? null : BLESSING_COST, buy: () => buyBlessing(save) });
    // A one-time notice after the starting-gear refund (meta.ts migrate).
    const refunded = save.refunded ?? 0;
    if (refunded) { save.refunded = 0; writeSave(save); }
    const best = save.best ? ` · best: ${ZONES[save.best.zone].name}, level ${save.best.level}` : "";
    const el = this.screen("title prepare", `
      <h1>Tibia <span>Survivors</span></h1>
      <p class="sub"><span class="souls">${save.souls.toLocaleString("en-US")} souls</span>${save.runs ? ` · ${save.runs} run${save.runs === 1 ? "" : "s"}` : ""}${best}</p>
      ${refunded ? `<p class="refund">Starting gear is now what Rookgaard's NPCs sell: the <span class="souls">${refunded.toLocaleString("en-US")} souls</span> you spent on the old gear are back.</p>` : ""}
      <div class="cards"><button class="card voc start"><canvas width="192" height="168"></canvas>
        <b>Enter Rookgaard</b><small>Real Tibia: level 1, ${trackTier(save, TRACKS[0]).label} in hand. Choose a vocation at level 8.
        Walk further out for harder zones. Every kill earns souls, kept when you die.</small></button></div>
      <h3>Starting gear</h3><div class="shop boosts">${gear.map(entry).join("")}</div>
      <h3>Rookgaard <small>(levels 1-8 go faster; these stop working when you choose a vocation)</small></h3>
      <div class="shop boosts">${rook.map(entry).join("")}</div>
      <h3>Boosts <small>(multiply experience, loot, gold or skill training in every run)</small></h3>
      <div class="shop boosts">${boosts.map(entry).join("")}</div>
      ${achievementsHtml(save)}
      <p class="hint">WASD / arrows / gamepad to move; your character fights by itself. Battle list: click to attack. P / Esc pauses.</p>`);
    const card = el.querySelector<HTMLElement>(".start")!;
    this.previews.push({ canvas: card.querySelector("canvas")!, sprite: ROOKIE.sprite });
    el.querySelectorAll<HTMLElement>(".buy .ico").forEach((c) => c.appendChild(this.icon(Number(c.dataset.id))));
    const all = [...gear, ...rook, ...boosts];
    const buys = all.map((e, i) => () => { if (e.buy()) this.title(loadSave(), onStart, 1 + i); });
    this.setButtons([card, ...el.querySelectorAll<HTMLElement>(".buy")], [onStart, ...buys], focus);
  }

  /** Level 8: leave Rookgaard and pick a vocation. */
  chooseVocation(onPick: (v: VocationDef) => void) {
    const el = this.screen("title", `
      <h2>You have reached level 8!</h2>
      <p class="sub">Choose your vocation. Your level, skills, gear, gold and upgrades carry over; you get its spells, and its weapon if you don't hold one of its kind.</p>
      <div class="cards">${VOCATIONS.map((v, i) => `
        <button class="card voc"><canvas width="192" height="168"></canvas>
          <b>${i + 1}. ${v.name}</b><small>${v.blurb}</small></button>`).join("")}
      </div>`);
    const cards = [...el.querySelectorAll<HTMLElement>(".voc")];
    cards.forEach((c, i) => this.previews.push({ canvas: c.querySelector("canvas")!, sprite: VOCATIONS[i].sprite }));
    this.setButtons(cards, VOCATIONS.map((v) => () => onPick(v)));
  }

  /** Level-up (or a bestiary stage, with charms): pick one of the cards. `roll` makes new ones for a reroll. */
  levelUp(g: Game, choices: LevelChoice[], onPick: (c: LevelChoice) => void, title?: string, roll = () => g.ch.rollChoices()) {
    const ch = g.ch;
    const card = (c: LevelChoice, i: number) => {
      if (c.kind === "grade") {
        const s = c.spell, { grades, wheel } = spellGrades(s), g0 = ch.grades.get(s.file) ?? 0;
        return `<button class="card choice"><div class="ico"></div>
          <b>${i + 1}. ${s.name} ${CHARM_TIERS[g0 + 1]}</b><em>Spell grade${wheel ? " (Wheel of Destiny)" : ""}</em>
          <small>${describeGrade(grades[g0])}${g0 ? `<br><i>now: ${describeGrade(grades[g0 - 1])}</i>` : ""}</small></button>`;
      }
      if (c.kind === "charm") {
        const t = (ch.charms.get(c.name) ?? 0) + 1;
        return `<button class="card choice"><div class="ico"></div>
          <b>${i + 1}. ${c.name} ${CHARM_TIERS[t]}</b><em>${t === 1 ? "New charm" : `Charm ${CHARM_TIERS[t - 1]} → ${CHARM_TIERS[t]}`}</em>
          <small>${describeCharm(c.name, t)}.</small></button>`;
      }
      if (c.kind === "prey") {
        const full = ch.prey.length >= PREY_SLOTS ? ch.prey[0] : null;
        return `<button class="card choice"><div class="ico"></div>
          <b>${i + 1}. Prey: ${MONSTERS[c.prey.creature]?.name ?? c.prey.creature}</b><em>${"★".repeat(c.prey.stars)}${"☆".repeat(10 - c.prey.stars)}</em>
          <small>${describePrey(c.prey)}.${full ? `<br><i>Replaces: ${describePrey(full)}</i>` : ""}</small></button>`;
      }
      if (c.kind === "spell") {
        const s = c.spell;
        return `<button class="card choice"><div class="ico"></div>
          <b>${i + 1}. ${s.name}</b><em>New spell: "${s.words}"</em>
          <small>Level ${s.level} · ${s.mana} mana · ${(s.cooldown ?? 2000) / 1000}s cooldown<br>${describe(s)}</small></button>`;
      }
      if (c.kind === "train") {
        const name = c.skill === "magic" ? "magic level" : SKILL_NAMES[c.skill].toLowerCase();
        const weapon = c.skill === "magic" ? (ch.voc.id === "druid" ? "rod" : "wand") : ["", "club", "sword", "axe", "bow"][c.skill] ?? "sword";
        return `<button class="card choice"><div class="ico"></div>
          <b>${i + 1}. Exercise ${weapon}</b><em>Training session</em><small>+1 ${name}.</small></button>`;
      }
      if (c.kind === "gold") {
        return `<button class="card choice"><div class="ico"></div>
          <b>${i + 1}. ${c.n.toLocaleString("en-US")} gold</b><em>Gold pouch</em><small>For the shop: supplies, runes and gear.</small></button>`;
      }
      if (c.kind === "supply") {
        return `<button class="card choice"><div class="ico"></div>
          <b>${i + 1}. ${c.n} ${item(c.id)!.name}s</b><em>Supplies</em><small>A backpack of potions.</small></button>`;
      }
      if (c.kind === "boost") {
        const b = boost(c.id)!, l = ch.boostLevel(c.id) + 1;
        return `<button class="card choice"><div class="ico"></div>
          <b>${i + 1}. ${b.name} ${l}</b><em>${l === 1 ? "New upgrade" : `Level ${l - 1} → ${l}`}</em>
          <small>${b.desc(l)}${evoHint(c.id)}</small></button>`;
      }
      if (c.kind !== "imbue") return "";
      const d = imbuement(c.id), tier = (ch.imbuements.get(c.id) ?? 0) + 1;
      return `<button class="card choice"><div class="ico"></div>
        <b>${i + 1}. ${TIERS[tier - 1]} ${d.name}</b><em>${tier === 1 ? "New imbuement" : `Upgrade from ${TIERS[tier - 2]}`}</em>
        <small>${d.desc(d.values[tier - 1])}${evoHint(c.id)}</small></button>`;
    };
    const el = this.screen("levelup", `
      <h2>${title ?? `Level ${ch.level}!`}</h2>
      <p class="sub">Upgrades ${ch.slotsUsed}/${MAX_SLOTS}${ch.slotsUsed >= MAX_SLOTS ? " (full: only upgrades to what you have)" : ""}</p>
      <div class="cards">${choices.map(card).join("")}</div>
      ${g.rerolls > 0 ? `<div class="row"><button class="btn reroll">Reroll (${g.rerolls} left)</button></div>` : ""}
      <p class="hint">1–${choices.length}, arrows + Enter, click, or gamepad A</p>`);
    el.querySelectorAll(".ico").forEach((c, i) => {
      const ch = choices[i];
      if (ch.kind === "supply") { c.appendChild(this.icon(ch.id, 2)); return; }
      if (ch.kind === "gold") { c.appendChild(this.icon(3035, 2)); return; }
      if (ch.kind === "prey") {
        const anim = this.atlas.data.creatures[ch.prey.creature];
        if (anim) { c.appendChild(this.atlas.icon(anim.idle[2][0], 32, 2)); return; }
      }
      if (ch.kind === "boost") { c.appendChild(this.icon(boost(ch.id)!.icon, 2)); return; }
      if (ch.kind === "train") {
        const w = g.ch.weapon;
        if (w) { c.appendChild(this.icon(w.id, 2)); return; }
      }
      const effect = ch.kind === "spell" || ch.kind === "grade" ? ch.spell.effect : ch.kind === "imbue" ? imbuement(ch.id).effect
        : ch.kind === "charm" ? CHARM_EFFECTS[charm(ch.name).element ?? ""] ?? 13 : 10;
      const anim = this.atlas.data.effects[effect] ?? this.atlas.data.effects[13];
      c.appendChild(this.atlas.icon(anim.frames[Math.floor(anim.frames.length / 2)], 32, 2));
    });
    const reroll = el.querySelector<HTMLElement>(".reroll");
    const actions = choices.map((c) => () => onPick(c));
    if (reroll) actions.push(() => {
      g.rerolls--;
      this.levelUp(g, roll(), onPick, title, roll);
    });
    this.setButtons([...el.querySelectorAll<HTMLElement>(".card"), ...(reroll ? [reroll] : [])], actions);
  }

  /** A boss chest: an evolution, or the upgrades it handed out. */
  chest(g: Game, r: ChestResult, onClose: () => void) {
    const evo = r.evolution ? evolution(r.evolution) : null;
    const el = this.screen("chest", evo ? `
      <h2>Evolution!</h2>
      <div class="ico"></div>
      <h3>${evo.name}</h3>
      <p>${evo.desc}</p>
      <p class="hint">${evo.recipe}</p>
      <button class="btn">Ok</button>` : `
      <h2>Treasure chest</h2>
      <div class="ico"></div>
      <ul>${r.gains.map((x) => `<li>${x}</li>`).join("") || "<li>Nothing left to upgrade.</li>"}</ul>
      <p class="hint">Max an upgrade and own its partner to evolve it from the next chest.</p>
      <button class="btn">Ok</button>`);
    el.querySelector(".ico")!.appendChild(this.icon(evo ? evo.icon : 2478, 3));
    this.setButtons([el.querySelector<HTMLElement>(".btn")!], [onClose]);
  }

  /** Pause: the character sheet, and NPC trade in tabs (weapons, armor, ammunition, potions, runes, selling).
   *  Every item row shows its stats and what it needs, hover it for the full tooltip, and has a buy button
   *  per pack size. */
  pause(g: Game, onResume: () => void, onQuit: () => void, focus = 0, tab = this.shopTab) {
    this.shopTab = tab;
    const ch = g.ch;
    const reopen = (f: number, t = tab) => this.pause(g, onResume, onQuit, f, t);
    const skills = ch.skills.map((s, i) => `<tr><td>${SKILL_NAMES[i]}</td><td>${ch.skill(i)}</td></tr>`).join("");
    const gold = (n: number) => n.toLocaleString("en-US");

    // ---- the rows of the open tab: an item, a note, and its pack buttons ----
    type Pack = { n: number; price: number; ok: boolean; label?: string; buy: () => void };
    type Row = { id: number; count?: number; note: string; packs: Pack[] };
    const rows: Row[] = [];
    const need = (it: ItemData) => {
      const out: string[] = [];
      if (it.level && ch.level < it.level) out.push(`level ${it.level}`);
      if (!canWear({ ...it, level: 0 }, ch.voc.id, 9999)) out.push("another vocation");
      return out.length ? `<span class="bad">needs ${out.join(", ")}</span>` : "";
    };
    const equip = (id: number, price: number) => () => {
      ch.gold -= price;
      const it = item(id)!, slot = ch.slotFor(it)!;
      const old = ch.equipment[slot];
      if (slot === "weapon") ch.takeOffWeapon();
      else if (old) ch.stash(old);
      ch.equip(id);
      ch.fitAmmo();
      g.msg(`You bought and equipped ${it.name}.`, "#80ff80");
      if (it.ammotype && ch.ammo?.ammotype !== it.ammotype) g.msg(`You have no ${it.ammotype}s for it: buy some under Ammunition.`, "#ff9c30");
    };
    const stock = (id: number, n: number, price: number, then?: () => void) => () => {
      ch.gold -= price;
      ch.supplies.set(id, (ch.supplies.get(id) ?? 0) + n);
      then?.();
      g.msg(`You bought ${n} ${item(id)!.name}${n > 1 ? "s" : ""}.`, "#80ff80");
    };
    const packs = (id: number, sizes: number[], then?: () => void, ok = true): Pack[] => {
      const each = PRICES[id]?.buy ?? 0;
      return sizes.map((n) => ({ n, price: each * n, ok, buy: stock(id, n, each * n, then) }));
    };
    const better = (id: number) => {
      const it = item(id)!, slot = ch.slotFor(it), cur = slot ? ch.equipment[slot] : undefined;
      if (!slot) return "";
      if (cur === id) return `<span class="tag on">equipped</span>`;
      if (!cur) return `<span class="tag up">empty slot</span>`;
      const d = ch.score(it, slot) - ch.score(item(cur)!, slot);
      return d > 0 ? `<span class="tag up">better</span>` : "";
    };
    const vocName = ch.voc.name.toLowerCase();
    if (tab === "weapons") {
      // Your vocation's own kind of weapon first, then everything else you may wield.
      const list = ch.shopWeapons().sort((a, b) => Number(ch.prefers(item(b.id)!)) - Number(ch.prefers(item(a.id)!)));
      for (const w of list) {
        const it = item(w.id)!, worn = ch.equipment.weapon === w.id;
        const note = [stats(w.id), better(w.id), need(it)].filter(Boolean).join(" ");
        if (it.weapontype === "missile") {
          // Thrown weapons come in stacks; topping up the stack in your hand is fine.
          rows.push({ id: w.id, count: worn ? ch.supplies.get(w.id) ?? 0 : undefined, note, packs: packs(w.id, [10, 25, 50], () => {
            if (ch.equipment.weapon !== w.id) {
              ch.takeOffWeapon();
              ch.equip(w.id);
            }
          }, w.usable) });
        } else rows.push({ id: w.id, note, packs: [{ n: 1, price: w.price, ok: w.usable && !worn, label: worn ? "equipped" : undefined, buy: equip(w.id, w.price) }] });
      }
    } else if (GEAR_TABS[tab]) {
      const slots = GEAR_TABS[tab]!;
      const list = Object.entries(PRICES).map(([k, pr]) => ({ id: Number(k), price: pr.buy ?? 0, it: item(Number(k)) }))
        .filter((x) => x.price && x.it && slots.includes(ch.slotFor(x.it) ?? "") && canWear(x.it, ch.voc.id, 9999) && (x.it.level ?? 0) <= ch.level + 40)
        .sort((a, b) => slots.indexOf(ch.slotFor(a.it!)!) - slots.indexOf(ch.slotFor(b.it!)!) || (a.it!.level ?? 0) - (b.it!.level ?? 0) || a.price - b.price);
      for (const x of list) {
        const worn = Object.values(ch.equipment).includes(x.id);
        rows.push({ id: x.id, note: [stats(x.id), better(x.id), need(x.it!)].filter(Boolean).join(" "),
          packs: [{ n: 1, price: x.price, ok: canWear(x.it!, ch.voc.id, ch.level) && !worn, label: worn ? "equipped" : undefined, buy: equip(x.id, x.price) }] });
      }
    } else if (tab === "ammo") {
      // All of it, whatever you hold: buying arrows before the bow is fine.
      for (const a of ch.shopAmmo()) {
        const it = item(a.id)!, fits = ch.weapon?.ammotype === it.ammotype;
        const note = [stats(a.id), ch.equipment.ammo === a.id ? `<span class="tag on">in use</span>` : fits ? "" : `<span class="hint">for ${it.ammotype === "bolt" ? "crossbows" : "bows"}</span>`, need(it)].filter(Boolean).join(" ");
        rows.push({ id: a.id, count: ch.supplies.get(a.id) || undefined, note, packs: packs(a.id, [10, 50, 100], () => ch.fitAmmo(), a.usable) });
      }
    } else if (tab === "potions" || tab === "runes") {
      for (const s of SHOP) {
        const id = itemId(s.name), isRune = SPELLS.some((r) => r.runeId === id);
        if (isRune !== (tab === "runes") || !PRICES[id]?.buy || item(id)?.ammotype) continue;
        const pot = POTIONS[id], rune = SPELLS.find((r) => r.runeId === id);
        if (pot?.voc && !pot.voc.includes(ch.voc.id)) continue; // potions are vocation-bound in Tibia
        const req: string[] = [];
        if (rune && ch.level < (rune.level ?? 0)) req.push(`level ${rune.level}`);
        if (rune && ch.ml < (rune.magicLevel ?? 0)) req.push(`magic level ${rune.magicLevel}`);
        if (pot?.level && ch.level < pot.level) req.push(`level ${pot.level}`);
        const what = pot ? [pot.health && `heals ${pot.health[0]}-${pot.health[1]}`, pot.mana && `${pot.mana[0]}-${pot.mana[1]} mana`].filter(Boolean).join(", ")
          : rune ? `${rune.group === "healing" ? "healing" : rune.element}${rune.needTarget ? ", single target" : ", area"}` : "";
        rows.push({ id, count: ch.supplies.get(id) || undefined, note: `<small>${what}</small>${req.length ? ` <span class="bad">needs ${req.join(", ")}</span>` : ""}`,
          packs: packs(id, isRune ? [5, 10, 25, 50] : [1, 5, 10, 25]) });
      }
    } else {
      // Sell: everything in the backpack, by item.
      const have = new Map<number, number>();
      for (const t of ch.backpack.all()) have.set(t.id, (have.get(t.id) ?? 0) + t.n);
      // Coins change at face value.
      const value = (id: number) => ({ 3031: 1, 3035: 100, 3043: 10000 } as Record<number, number>)[id] ?? PRICES[id]?.sell ?? 0;
      for (const [id, n] of [...have].sort((a, b) => value(b[0]) * b[1] - value(a[0]) * a[1])) {
        const each = value(id);
        rows.push({ id, count: n, note: each ? `<small>${gold(each)} gold each</small>` : `<span class="hint">no NPC buys this</span>`,
          packs: [{ n, price: -each * n, ok: true, label: each ? `sell · ${gold(each * n)}` : "throw away", buy: () => {
            if (!each) { ch.discard(id); return; }
            ch.sell(id);
            g.msg(`You sold ${n} ${item(id)!.name}${n > 1 ? "s" : ""} for ${gold(each * n)} gold.`, "#ffd34d");
          } }] });
      }
    }

    const TABS: [ShopTab, string][] = [["weapons", "Weapons"], ["shields", "Shields"], ["helmets", "Helmets"], ["armor", "Armor"], ["legs", "Legs"],
      ["boots", "Boots"], ["jewelry", "Jewelry"], ["ammo", "Ammunition"], ["potions", "Potions"], ["runes", "Runes"], ["sell", "Sell"]];
    const loot = ch.lootValue();
    const packBtn = (p: Pack) => `<button class="btn pk" ${!p.ok || ch.gold < p.price ? "disabled" : ""}>${p.label ?? `${p.n > 1 ? `${p.n}× · ` : ""}${gold(p.price)}`}</button>`;
    const rowHtml = (r: Row) => `<div class="srow" data-item="${r.id}" data-n="${r.count ?? 1}"><span class="ico" data-id="${r.id}"></span>
      <div class="info"><b>${item(r.id)!.name}${r.count ? ` <i>(${gold(r.count)})</i>` : ""}</b>${r.note}</div>
      <div class="packs">${r.packs.map(packBtn).join("")}</div></div>`;
    const boosts = [...ch.boosts].map(([id, l]) => `${boost(id)!.name} ${l} <i>(${boost(id)!.desc(l).replace(/\.$/, "")})</i>`);
    const imbues = [...ch.imbuements].map(([id, t]) => `${TIERS[t - 1]} ${imbuement(id).name}`);
    const el = this.screen("pause", `
      <h2>Paused</h2>
      <div class="cols">
        <div class="sheet"><h3>${ch.voc.name}, level ${ch.level}</h3>
          <table><tr><td>Magic Level</td><td>${ch.ml}</td></tr>${skills}
          <tr><td>Speed</td><td>${ch.speed}</td></tr><tr><td>Armor</td><td>${ch.armor}</td></tr></table>
          <h4>Upgrades ${ch.slotsUsed}/${MAX_SLOTS}</h4>
          <p class="spells">${[...boosts, ...imbues].join("<br>") || "None yet"}</p>
          <h4>Evolutions</h4>
          <p class="spells">${EVOLUTIONS.filter((e) => e.parts.some((p) => g.ch.boosts.has(p as never) || g.ch.imbuements.has(p)) || g.ch.evolutions.has(e.id))
            .map((e) => `${g.ch.evolutions.has(e.id) ? "&#10003; " : e.ready(g.ch) ? "&#9733; " : ""}${e.name} <i>${e.recipe}</i>`).join("<br>") || "Pick upgrades to discover recipes."}</p>
          ${g.ch.blessings ? `<p class="spells">Blessings: ${g.ch.blessings}</p>` : ""}
          <h4>Spells</h4>
          <p class="spells">${[...ch.known].map((f) => SPELLS.find((s) => s.file === f)!).map((s) => `${s.name} <i>${s.words}</i>`).join("<br>") || "None yet"}</p></div>
        <div class="trade"><h3>NPC trade <span class="gold">${gold(ch.gold)} gold</span></h3>
          <div class="stabs">${TABS.map(([t, name]) => `<button class="btn stab${t === tab ? " on" : ""}">${name}</button>`).join("")}</div>
          ${tab === "sell" ? `<button class="btn sell" ${loot ? "" : "disabled"}>Sell everything: ${gold(ch.backpackCount)} items for ${gold(loot)} gold</button>` : ""}
          <div class="slist">${rows.map(rowHtml).join("") || `<p class="hint">${tab === "sell" ? "Your backpack is empty." : "Nothing for sale here."}</p>`}</div>
        </div>
      </div>
      <div class="row"><button class="btn">Resume</button><button class="btn">Quit run</button></div>`);
    el.querySelectorAll<HTMLElement>(".srow .ico").forEach((c) => c.appendChild(this.icon(Number(c.dataset.id))));
    // Buttons in page order: resume, quit, the tabs, sell everything, then every pack button.
    const btns = [...el.querySelectorAll<HTMLElement>(".row .btn"), ...el.querySelectorAll<HTMLElement>(".stab")];
    const acts: (() => void)[] = [onResume, onQuit, ...TABS.map(([t]) => () => reopen(2 + TABS.findIndex(([x]) => x === t), t))];
    const sellAll = el.querySelector<HTMLElement>(".sell");
    if (sellAll) {
      btns.push(sellAll);
      acts.push(() => {
        const n = ch.backpackCount, got = ch.sell();
        if (!got) return;
        g.msg(`You sold ${gold(n)} items for ${gold(got)} gold.`, "#ffd34d");
        reopen(btns.indexOf(sellAll));
      });
    }
    const packBtns = [...el.querySelectorAll<HTMLElement>(".pk")];
    rows.flatMap((r) => r.packs).forEach((p, i) => {
      btns.push(packBtns[i]);
      const at = btns.length - 1;
      acts.push(() => {
        if (!p.ok || ch.gold < p.price) return;
        p.buy();
        reopen(at);
      });
    });
    this.setButtons(btns, acts, Math.min(focus, btns.length - 1));
    el.querySelector(".pk.focus, .stab.focus")?.scrollIntoView({ block: "nearest" });
  }

  end(g: Game, souls: number, onMenu: () => void) {
    const el = this.screen("dead", `
      <h2>You are dead.</h2>
      <p>Your soul returns to Rookgaard.</p>
      <table>
        <tr><td>Vocation</td><td>${g.vocation.name}</td></tr>
        <tr><td>Level</td><td>${g.ch.level}</td></tr>
        <tr><td>Deepest zone</td><td>${ZONES[g.deepest].name}</td></tr>
        <tr><td>Time</td><td>${fmt(g.time)}</td></tr>
        <tr><td>Kills</td><td>${g.kills}</td></tr>
        <tr><td>Souls banked</td><td class="banked souls">0</td></tr>
      </table>
      <div class="row"><button class="btn">Spend souls and go again</button></div>`);
    this.setButtons([...el.querySelectorAll<HTMLElement>(".btn")], [onMenu]);
    // Count the souls up.
    const cell = el.querySelector<HTMLElement>(".banked")!;
    const t0 = performance.now(), dur = Math.min(2000, 400 + souls * 5);
    const tick = (now: number) => {
      const k = Math.min(1, (now - t0) / dur);
      cell.textContent = Math.round(souls * (1 - Math.pow(1 - k, 3))).toLocaleString("en-US");
      if (k < 1 && cell.isConnected) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

}

/** Can this character use a shop item at all (class potions, class runes, its ammo)? */
/** Short stat line for an item, like Tibia's look text: (Atk:24 Def:21) (Arm:12). */
/** Achievements on the title screen: every creature you've killed, its milestones reached (stars), and
 *  how far the next one is and what it pays. */
function achievementsHtml(save: Save): string {
  const kills = Object.entries(save.kills ?? {}).filter(([, n]) => n > 0);
  if (!kills.length) return "";
  let done = 0, all = 0;
  const chips = kills.sort((a, b) => b[1] - a[1]).map(([key, n]) => {
    const boss = ZONES.some((z) => z.bosses.includes(key));
    const ms = boss ? BOSS_MILESTONES : KILL_MILESTONES;
    const reached = ms.filter((m) => n >= m).length;
    done += reached;
    all += ms.length;
    const next = ms.find((m) => n < m);
    const pay = next ? achievement(key, next)?.souls : 0;
    const name = MONSTERS[key]?.name ?? key;
    return `<div class="ach${boss ? " boss" : ""}" title="${next ? `${next - n} more for +${pay} souls` : "All milestones reached"}">`
      + `<span class="stars">${"★".repeat(reached)}${"☆".repeat(ms.length - reached)}</span> ${name} <i>${n.toLocaleString("en-US")}${next ? ` / ${next.toLocaleString("en-US")}` : ""}</i></div>`;
  });
  return `<h3>Achievements <small>(${done}/${all} · kill milestones per creature pay souls)</small></h3><div class="achs">${chips.join("")}</div>`;
}

function stats(id: number): string {
  const it = wornItem(id)!;
  const parts: string[] = [];
  if (it.attack) parts.push(`Atk:${it.attack}`);
  if (it.defense) parts.push(`Def:${it.defense}${it.extradef ? ` +${it.extradef}` : ""}`);
  if (it.armor) parts.push(`Arm:${it.armor}`);
  if (it.fromdamage) parts.push(`${it.fromdamage}-${it.todamage} ${it.wandtype}`);
  if (it.range) parts.push(`Range:${it.range}`);
  if (it.magiclevelpoints) parts.push(`ML +${it.magiclevelpoints}`);
  if (it.speed) parts.push(`speed +${it.speed}`);
  if (it.level) parts.push(`lvl ${it.level}`);
  return parts.length ? `(${parts.join(" ")})` : "";
}

function describe(s: SpellData): string {
  if (s.group === "healing") return "Heals you.";
  const el = s.element === "physical" ? "physical" : s.element;
  if (s.needDirection) return `A ${el} wave or beam in front of you.`;
  if (s.area) return `${el[0].toUpperCase() + el.slice(1)} damage all around you.`;
  return `${el[0].toUpperCase() + el.slice(1)} damage to your target (range ${s.range ?? 1}).`;
}

export function showMissingAssets(root: HTMLElement) {
  root.hidden = false;
  root.innerHTML = `<div class="panel title">
    <h1>Tibia <span>Survivors</span></h1>
    <p>No sprite atlas found. Extract it from your Tibia client first:</p>
    <pre>npm run extract</pre>
    <p class="hint">Reads %LOCALAPPDATA%\\Tibia\\packages\\Tibia\\assets and writes public/assets/.</p></div>`;
}

function fmt(t: number) {
  return `${Math.floor(t / 60).toString().padStart(2, "0")}:${Math.floor(t % 60).toString().padStart(2, "0")}`;
}

/** "Evolves: X" line for upgrade cards. */
function evoHint(id: string): string {
  const evos = evolutionsFor(id);
  return evos.length ? `<br><span class="evo">Evolves: ${evos.map((e) => e.name).join(", ")}</span>` : "";
}
