import type { Atlas } from "./atlas";
import { extractAtlas, type AssetState } from "./assets";
import { achievement, BOSS_MILESTONES, KILL_MILESTONES, ROOKIE, SHOP, VOCATIONS, ZONES, type VocationDef } from "./data";
import { Character, type LevelChoice } from "./character";
import { RARITIES, rarityOdds } from "./rarity";
import type { Game } from "./game";
import { imbuement, TIERS } from "./tibia/imbuements";
import { boost, BOOSTS, MAX_BOOST, MAX_SLOTS, RUN_BONUS_MAX, RUN_BONUS_STEP, runBonus } from "./upgrades";
import { BLESSING_COST, boostCost, buyBlessing, buyBoost, buyTier, characters, createCharacter, currentCharacter, deleteCharacter, loadSave, selectCharacter, tier, trackTier, TRACKS, writeSave, type CharacterSave, type Save } from "./meta";
import { EVOLUTIONS, evolution, evolutionsFor } from "./evolutions";
import type { ChestResult } from "./game";
import { PROMOTED, PROMOTION_PRICE } from "./tibia/db";
import { buyPrice, canWear, item, itemId, MONSTERS, POTIONS, PRICES, SHOP_PRICES, SPELLS, wornItem, type ItemData, type SpellData } from "./tibia/db";
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

  /** The account's characters: pick one, make a new one (no name: a random one), or delete one (click twice). */
  characters(onPick: () => void, focus = 0) {
    const list = characters(), cur = currentCharacter();
    const el = this.screen("title chars", `
      <h1>Tibia <span>Survivors</span></h1>
      <p class="sub">Choose a character. Each has its own souls and upgrades, and the first vocation it chooses is its vocation for good.</p>
      <div class="cards">${list.map((c, i) => `<div class="char">
        <button class="card voc pick${i === cur ? " cur" : ""}"><canvas width="192" height="168"></canvas>
          <b>${esc(c.name)}</b><em>${vocationOf(c)?.name ?? "No vocation yet"}</em>
          <small><span class="souls">${c.souls.toLocaleString("en-US")} souls</span> · ${c.runs} run${c.runs === 1 ? "" : "s"}${c.best ? `<br>best: ${ZONES[c.best.zone].name}, level ${c.best.level}` : ""}</small></button>
        <button class="btn del">Delete</button></div>`).join("")}
        <div class="card new"><b>New character</b><small>Starts in Rookgaard with nothing unlocked.</small>
          <input class="name" maxlength="20" placeholder="Name" spellcheck="false"><button class="btn create">Create</button></div>
      </div>`);
    const picks = [...el.querySelectorAll<HTMLElement>(".pick")], dels = [...el.querySelectorAll<HTMLElement>(".del")];
    picks.forEach((c, i) => this.previews.push({ canvas: c.querySelector("canvas")!, sprite: vocationOf(list[i])?.sprite ?? ROOKIE.sprite }));
    const input = el.querySelector<HTMLInputElement>(".name")!, create = el.querySelector<HTMLElement>(".create")!;
    const make = () => {
      const taken = new Set(list.map((c) => c.name.toLowerCase()));
      const name = input.value.trim().replace(/\s+/g, " ") || RANDOM_NAMES.find((n) => !taken.has(n.toLowerCase())) || `Adventurer ${list.length + 1}`;
      createCharacter(name);
      onPick();
    };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") make(); });
    let armed = -1; // the character a first Delete click asked about
    const del = (i: number) => () => {
      if (armed !== i) { armed = i; dels.forEach((d, j) => (d.textContent = j === i ? "Really delete?" : "Delete")); return; }
      deleteCharacter(i);
      this.characters(onPick, Math.max(0, i - 1));
    };
    this.setButtons([...picks, create, ...dels], [...list.map((_, i) => () => { selectCharacter(i); onPick(); }), make, ...list.map((_, i) => del(i))],
      list.length ? Math.min(focus, list.length - 1) : 0);
  }

  /** Between runs: spend souls on starting gear and other permanent unlocks, then enter Rookgaard. */
  title(save: CharacterSave, onStart: () => void, onCharacters: () => void, focus = 0) {
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
    // A character with a vocation only sees its own training boosts.
    const boosts: Entry[] = BOOSTS.filter((b) => !save.vocation || b.for(save.vocation)).map((b) => {
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
    const voc = vocationOf(save);
    const el = this.screen("title prepare", `
      <h1>Tibia <span>Survivors</span></h1>
      <p class="who"><b>${esc(save.name)}</b> · ${voc ? voc.name : "no vocation yet"} <button class="btn chars">Characters</button></p>
      <p class="sub"><span class="souls">${save.souls.toLocaleString("en-US")} souls</span>${save.runs ? ` · ${save.runs} run${save.runs === 1 ? "" : "s"}` : ""}${best}</p>
      ${refunded ? `<p class="refund">Starting gear is now what Rookgaard's NPCs sell: the <span class="souls">${refunded.toLocaleString("en-US")} souls</span> you spent on the old gear are back.</p>` : ""}
      <div class="cards"><button class="card voc start"><canvas width="192" height="168"></canvas>
        <b>Enter Rookgaard</b><small>Real Tibia: level 1, ${trackTier(save, TRACKS[0]).label} in hand. ${voc ? `Becomes a ${voc.name.toLowerCase()} at level 8.` : "Choose a vocation at level 8: it stays this character's vocation."}
        Walk further out for harder zones. Every kill earns souls, kept when you die.</small></button></div>
      <h3>Starting gear</h3><div class="shop boosts">${gear.map(entry).join("")}</div>
      <h3>Rookgaard <small>(levels 1-8 go faster; these stop working when you choose a vocation)</small></h3>
      <div class="shop boosts">${rook.map(entry).join("")}</div>
      <h3>Boosts <small>(multiply experience, loot, gold or skill training, or add speed and luck, in every run)</small></h3>
      <div class="shop boosts">${boosts.map(entry).join("")}</div>
      ${achievementsHtml(save)}
      <p class="hint">WASD / arrows / gamepad to move; your character fights by itself. Battle list: click to attack. P / Esc pauses.</p>`);
    const card = el.querySelector<HTMLElement>(".start")!;
    this.previews.push({ canvas: card.querySelector("canvas")!, sprite: ROOKIE.sprite });
    el.querySelectorAll<HTMLElement>(".buy .ico").forEach((c) => c.appendChild(this.icon(Number(c.dataset.id))));
    const all = [...gear, ...rook, ...boosts];
    const buys = all.map((e, i) => () => { if (e.buy()) this.title(loadSave(), onStart, onCharacters, 1 + i); });
    this.setButtons([card, ...el.querySelectorAll<HTMLElement>(".buy"), el.querySelector<HTMLElement>(".chars")!], [onStart, ...buys, onCharacters], focus);
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
    // A rarer card wears its rarity: a colored frame and its name on top.
    const open = (c: LevelChoice) => `<button class="card choice${c.rarity ? ` r${c.rarity}` : ""}">${c.rarity ? `<span class="rarity">${RARITIES[c.rarity].name}</span>` : ""}<div class="ico"></div>`;
    const card = (c: LevelChoice, i: number) => {
      const k = Character.steps(c);
      if (c.kind === "grade") {
        const s = c.spell, { grades, wheel } = spellGrades(s), g0 = ch.grades.get(s.file) ?? 0, g1 = g0 + k;
        return `${open(c)}
          <b>${i + 1}. ${s.name} ${CHARM_TIERS[g1]}</b><em>Spell grade${wheel ? " (Wheel of Destiny)" : ""}</em>
          <small>${describeGrade(grades[g1 - 1])}${g0 ? `<br><i>now: ${describeGrade(grades[g0 - 1])}</i>` : ""}</small></button>`;
      }
      if (c.kind === "charm") {
        const t0 = ch.charms.get(c.name) ?? 0, t = t0 + k;
        return `${open(c)}
          <b>${i + 1}. ${c.name} ${CHARM_TIERS[t]}</b><em>${t0 === 0 ? "New charm" : `Charm ${CHARM_TIERS[t0]} → ${CHARM_TIERS[t]}`}</em>
          <small>${describeCharm(c.name, t)}.</small></button>`;
      }
      if (c.kind === "prey") {
        const full = ch.prey.length >= PREY_SLOTS ? ch.prey[0] : null;
        return `${open(c)}
          <b>${i + 1}. Prey: ${MONSTERS[c.prey.creature]?.name ?? c.prey.creature}</b><em>${"★".repeat(c.prey.stars)}${"☆".repeat(10 - c.prey.stars)}</em>
          <small>${describePrey(c.prey)}.${full ? `<br><i>Replaces: ${describePrey(full)}</i>` : ""}</small></button>`;
      }
      if (c.kind === "spell") {
        const s = c.spell;
        return `${open(c)}
          <b>${i + 1}. ${s.name}</b><em>New spell: "${s.words}"</em>
          <small>Level ${s.level} · ${s.mana} mana · ${(s.cooldown ?? 2000) / 1000}s cooldown<br>${describe(s)}</small></button>`;
      }
      if (c.kind === "train") {
        const name = c.skill === "magic" ? "magic level" : SKILL_NAMES[c.skill].toLowerCase();
        const weapon = c.skill === "magic" ? (ch.voc.id === "druid" ? "rod" : "wand") : ["", "club", "sword", "axe", "bow"][c.skill] ?? "sword";
        return `${open(c)}
          <b>${i + 1}. Exercise ${weapon}${k > 1 ? ` x${k}` : ""}</b><em>Training session${k > 1 ? "s" : ""}</em><small>+${k} ${name}.</small></button>`;
      }
      if (c.kind === "gold") {
        return `${open(c)}
          <b>${i + 1}. ${c.n.toLocaleString("en-US")} gold</b><em>Gold pouch</em><small>For the shop: supplies, runes and gear.</small></button>`;
      }
      if (c.kind === "supply") {
        return `${open(c)}
          <b>${i + 1}. ${c.n} ${item(c.id)!.name}s</b><em>Supplies</em><small>A backpack of potions.</small></button>`;
      }
      if (c.kind === "boost") {
        const b = boost(c.id)!, l = ch.boostLevel(c.id) + 1;
        return `${open(c)}
          <b>${i + 1}. ${b.name} ${l}</b><em>${l === 1 ? "New upgrade" : `Level ${l - 1} → ${l}`}</em>
          <small>${b.desc(l)}${evoHint(c.id)}</small></button>`;
      }
      if (c.kind === "bonus") {
        const b = runBonus(c.id), n = (ch.runBonuses.get(c.id) ?? 0) + k;
        return `${open(c)}
          <b>${i + 1}. ${b.name} +${k * RUN_BONUS_STEP}%</b><em>Run bonus ${n}/${RUN_BONUS_MAX}</em>
          <small>${b.what[0].toUpperCase() + b.what.slice(1)} +${n * RUN_BONUS_STEP}% for the rest of this run.</small></button>`;
      }
      if (c.kind === "luck") {
        return `${open(c)}
          <b>${i + 1}. Luck +${c.n}</b><em>Run bonus</em>
          <small>Luck ${ch.luck} → ${ch.luck + c.n} for the rest of this run: rarer cards, and now and then a fourth.</small></button>`;
      }
      if (c.kind !== "imbue") return "";
      const d = imbuement(c.id), t0 = ch.imbuements.get(c.id) ?? 0, tier = t0 + k;
      return `${open(c)}
        <b>${i + 1}. ${TIERS[tier - 1]} ${d.name}</b><em>${t0 === 0 ? "New imbuement" : `Upgrade from ${TIERS[t0 - 1]}`}</em>
        <small>${d.desc(d.values[tier - 1])}${evoHint(c.id)}</small></button>`;
    };
    const el = this.screen("levelup", `
      <h2>${title ?? `Level ${ch.level}!`}</h2>
      <p class="sub">Upgrades ${ch.slotsUsed}/${MAX_SLOTS}${ch.slotsUsed >= MAX_SLOTS ? " (full: only upgrades to what you have)" : ""}${ch.luck ? ` · <span title="${luckOdds(ch.luck)}">Luck ${ch.luck}</span>` : ""}</p>
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
      if (ch.kind === "bonus") { c.appendChild(this.icon(runBonus(ch.id).icon, 2)); return; }
      if (ch.kind === "luck") { c.appendChild(this.icon(LUCK_ICON, 2)); return; }
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
    const heavy = (id: number) => ch.fits(id) < 1;
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
      const each = buyPrice(id);
      // An NPC won't sell you what you can't carry.
      return sizes.map((n) => ({ n, price: each * n, ok: ok && ch.fits(id) >= n, label: ok && ch.fits(id) < n ? "too heavy" : undefined, buy: stock(id, n, each * n, then) }));
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
        } else rows.push({ id: w.id, note, packs: [{ n: 1, price: w.price, ok: w.usable && !worn && !heavy(w.id), label: worn ? "equipped" : heavy(w.id) ? "too heavy" : undefined, buy: equip(w.id, w.price) }] });
      }
    } else if (GEAR_TABS[tab]) {
      const slots = GEAR_TABS[tab]!;
      const list = Object.entries(SHOP_PRICES).map(([k, price]) => ({ id: Number(k), price, it: item(Number(k)) }))
        .filter((x) => x.price && x.it && slots.includes(ch.slotFor(x.it) ?? "") && canWear(x.it, ch.voc.id, 9999) && (x.it.level ?? 0) <= ch.level + 40)
        .sort((a, b) => slots.indexOf(ch.slotFor(a.it!)!) - slots.indexOf(ch.slotFor(b.it!)!) || (a.it!.level ?? 0) - (b.it!.level ?? 0) || a.price - b.price);
      for (const x of list) {
        const worn = Object.values(ch.equipment).includes(x.id);
        rows.push({ id: x.id, note: [stats(x.id), better(x.id), need(x.it!)].filter(Boolean).join(" "),
          packs: [{ n: 1, price: x.price, ok: canWear(x.it!, ch.voc.id, ch.level) && !worn && !heavy(x.id), label: worn ? "equipped" : heavy(x.id) ? "too heavy" : undefined, buy: equip(x.id, x.price) }] });
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
        const id = itemId(s.name), isRune = SPELLS.some((r) => r.runeId === id) || id === 3147; // blank runes too
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
        <div class="sheet"><h3>${ch.vocName}, level ${ch.level}</h3>
          <table><tr><td>Magic Level</td><td>${ch.ml}</td></tr>${skills}
          <tr><td>Speed</td><td>${ch.speed}</td></tr><tr><td>Armor</td><td>${ch.armor}</td></tr>
          <tr title="${luckOdds(ch.luck)}"><td>Luck</td><td>${ch.luck}</td></tr></table>
          <h4>Upgrades ${ch.slotsUsed}/${MAX_SLOTS}</h4>
          <p class="spells">${[...boosts, ...imbues].join("<br>") || "None yet"}</p>
          <h4>Evolutions</h4>
          <p class="spells">${EVOLUTIONS.filter((e) => e.parts.some((p) => g.ch.boosts.has(p as never) || g.ch.imbuements.has(p)) || g.ch.evolutions.has(e.id))
            .map((e) => `${g.ch.evolutions.has(e.id) ? "&#10003; " : e.ready(g.ch) ? "&#9733; " : ""}${e.name} <i>${e.recipe}</i>`).join("<br>") || "Pick upgrades to discover recipes."}</p>
          ${g.ch.blessings ? `<p class="spells">Blessings: ${g.ch.blessings}</p>` : ""}
          <h4>Spells</h4>
          <p class="spells">${[...ch.known].map((f) => SPELLS.find((s) => s.file === f)!).map((s) => `${s.name} <i>${s.words}</i>`).join("<br>") || "None yet"}</p></div>
        <div class="trade"><h3>NPC trade <span class="gold">${gold(ch.gold)} gold</span></h3>
          ${PROMOTED[ch.voc.id] && !ch.promoted ? `<button class="btn promo" ${ch.promotionBlocked() ? "disabled" : ""}>Promotion to ${cap(PROMOTED[ch.voc.id]!).replace(/ (\w)/, (m) => m.toUpperCase())}: faster health and mana regeneration · ${gold(PROMOTION_PRICE)} gold${ch.promotionBlocked() ? ` <small>(${ch.promotionBlocked()})</small>` : ""}</button>` : ""}
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
    const promo = el.querySelector<HTMLElement>(".promo");
    if (promo) {
      btns.push(promo);
      acts.push(() => {
        if (!ch.promote()) return;
        g.msg(`You are now ${/^[aeiou]/i.test(ch.vocName) ? "an" : "a"} ${ch.vocName}!`, "#ffd34d");
        g.banner = { text: `Promoted: ${ch.vocName}`, t: 3 };
        reopen(0);
      });
    }
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

  /** The end of a run (a death, or quitting): what killed you, the run in numbers, and the souls banked. */
  end(g: Game, souls: number, onMenu: () => void, died = true) {
    const st = g.stats, n = (v: number) => Math.round(v).toLocaleString("en-US");
    const last = st.lastHits.slice().reverse();
    const killer = died && last[0] ? last[0].source : "";
    const hurt = [...st.taken].sort((a, b) => b[1] - a[1]).slice(0, 4);
    const takenTotal = [...st.taken.values()].reduce((a, b) => a + b, 0);
    // Every creature killed, most first, for the parade; and what was picked this run.
    const keyOf = (name: string) => Object.keys(MONSTERS).find((k) => MONSTERS[k].name === name) ?? name;
    const kills = [...g.bestiary].sort((a, b) => b[1] - a[1]).map(([name, k]) => ({ key: keyOf(name), name, k }));
    const step = Math.min(70, 1400 / Math.max(1, kills.length)); // the whole parade in about 1.5 s
    const ch = g.ch;
    const picks: [string, string][] = [
      ...[...ch.grades].map(([f, t]) => ["grade", `${SPELLS.find((s) => s.file === f)?.name} ${CHARM_TIERS[t]}`] as [string, string]),
      ...[...ch.imbuements].map(([id, t]) => ["imbue", `${TIERS[t - 1]} ${imbuement(id).name}`] as [string, string]),
      ...[...ch.charms].map(([name, t]) => ["charm", `${name} ${CHARM_TIERS[t]}`] as [string, string]),
      ...ch.prey.map((p) => ["prey", `Prey: ${MONSTERS[p.creature]?.name ?? p.creature} ${"★".repeat(p.stars)}`] as [string, string]),
      ...[...ch.boosts].map(([id, l]) => ["boost", `${boost(id)!.name} ${l}`] as [string, string]),
      ...[...ch.evolutions].map((id) => ["evo", evolution(id).name] as [string, string]),
    ];
    const pickStart = kills.length * step + 250;
    const soulRows = ([["kills", "Kills"], ["zones", "New zones"], ["achievements", "Achievements"], ["fighting", "Time fighting"]] as const)
      .filter(([k]) => st.souls[k]).map(([k, label]) => `<tr><td>${label}</td><td class="souls">${n(st.souls[k])}</td></tr>`).join("");
    const el = this.screen("dead summary", `
      <h2>${died ? "You are dead." : "Run over."}</h2>
      <p>${killer ? `Killed by <b>${article(killer)}</b> after ${fmt(g.time)}.` : `You left after ${fmt(g.time)}.`} Your soul returns to Rookgaard.</p>
      <div class="cols">
        <div><h4>The run</h4><table>
          <tr><td>Vocation</td><td>${g.vocation.name}, level ${g.ch.level}</td></tr>
          <tr><td>Deepest zone</td><td>${ZONES[g.deepest].name}</td></tr>
          <tr><td>Kills</td><td>${n(g.kills)}</td></tr>
          <tr><td>Damage dealt</td><td>${n(st.dealt)}</td></tr>
          <tr><td>Damage taken</td><td>${n(takenTotal)}</td></tr>
          <tr><td>Healed</td><td>${n(st.healed)}</td></tr>
          ${st.bestLoot ? `<tr><td>Best loot</td><td>${st.bestLoot.n > 1 ? `${st.bestLoot.n} ` : ""}${item(st.bestLoot.id)?.name} <span class="gold">(${n(st.bestLoot.value)} gold)</span></td></tr>` : ""}
        </table></div>
        <div><h4>Who hurt you</h4><table>${hurt.map(([who, d]) => `<tr><td>${cap(who)}</td><td>${n(d)} <i>(${Math.round((100 * d) / Math.max(1, takenTotal))}%)</i></td></tr>`).join("") || "<tr><td>Nobody</td></tr>"}</table>
          ${died && last.length ? `<h4>Last hits</h4><table>${last.slice(0, 5).map((h) => `<tr><td>${cap(h.source)}</td><td>${n(h.dmg)} ${h.el} <i>${(g.time - h.t).toFixed(1)} s before</i></td></tr>`).join("")}</table>` : ""}</div>
        <div><h4>Souls</h4><table>${soulRows}<tr><td><b>Banked</b></td><td class="banked souls">0</td></tr></table></div>
      </div>
      <div class="row"><button class="btn">Spend souls and go again</button></div>`);
    // The parade: kills pop in one by one above the numbers, then the picks.
    const parade = document.createElement("div");
    parade.className = "parade";
    parade.innerHTML = `<h4>Killed <span class="kill-total">0</span></h4><div class="kills">${kills.map((x, i) =>
      `<div class="kill" style="animation-delay:${Math.round(i * step)}ms" title="${x.name}: ${x.k}"><span class="spr" data-key="${x.key}"></span><b>${x.k}</b></div>`).join("") || `<i>Nothing</i>`}</div>`
      + (picks.length ? `<h4>Picked</h4><div class="picks">${picks.map(([kind, label], i) =>
        `<span class="pick ${kind}" style="animation-delay:${Math.round(pickStart + i * 50)}ms">${label}</span>`).join("")}</div>` : "");
    el.querySelector(".cols")!.before(parade);
    parade.querySelectorAll<HTMLElement>(".spr").forEach((s) => {
      const anim = this.atlas.data.creatures[s.dataset.key!];
      if (anim) s.appendChild(this.atlas.icon(anim.idle[2][0], 32, 1));
    });
    // The kill counter runs with the parade.
    const totalEl = parade.querySelector<HTMLElement>(".kill-total")!, total = g.kills, t1 = performance.now(), paradeMs = kills.length * step + 200;
    const count = (now: number) => {
      const k = Math.min(1, (now - t1) / paradeMs);
      totalEl.textContent = Math.round(total * k).toLocaleString("en-US");
      if (k < 1 && totalEl.isConnected) requestAnimationFrame(count);
    };
    requestAnimationFrame(count);
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

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const vocationOf = (c: CharacterSave) => VOCATIONS.find((v) => v.id === c.vocation);
/** Names for a character created without one. */
const RANDOM_NAMES = ["Eremo", "Bozo", "Rowenna", "Asima", "Tibianus", "Kazzan", "Harsky", "Avar Tar", "Lynda", "Quentin",
  "Cipfried", "Dallheim", "Norma", "Amber", "Seymour", "Hyacinth", "Sam", "Obi", "Dixi", "Willie"];

/** Can this character use a shop item at all (class potions, class runes, its ammo)? */
/** Short stat line for an item, like Tibia's look text: (Atk:24 Def:21) (Arm:12). */
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const LUCK_ICON = boost("luck")!.icon;
/** Card odds at a luck, for tooltips: "Common 70% · Rare 22% · ...". */
const luckOdds = (luck: number) => rarityOdds(luck).map((p, i) => `${RARITIES[i].name} ${p < 10 ? p.toFixed(1) : Math.round(p)}%`).join(" · ");
const article = (s: string) => (/^[A-Z]/.test(s) ? s : `${/^[aeiou]/i.test(s) ? "an" : "a"} ${s}`);

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

/** No sprites yet: ask for the player's own Tibia client and build the atlas from it (src/assets.ts). Resolves
 *  once it's built. */
export function showAssetPicker(root: HTMLElement, state: AssetState): Promise<Atlas> {
  root.hidden = false;
  root.innerHTML = `<div class="panel title assets">
    <h1>Tibia <span>Survivors</span></h1>
    <p>${state === "outdated" ? "The game has changed since your sprites were read: pick your Tibia folder again." : "The game draws with the sprites of your own Tibia client. Pick its folder to read them."}</p>
    <button class="btn pick">Choose Tibia folder</button>
    <input type="file" webkitdirectory hidden>
    <div class="bar" hidden><div></div></div>
    <p class="status"></p>
    <p class="hint">The <b>assets</b> folder of your Tibia install (or any folder above it). On Windows:<br>
      <code>%LOCALAPPDATA%\\Tibia\\packages\\Tibia\\assets</code><br>
      Your browser may ask to "upload" the files: nothing leaves your computer. The sprites are read here
      and kept in this browser only.</p></div>`;
  const pick = root.querySelector<HTMLButtonElement>(".pick")!;
  const input = root.querySelector<HTMLInputElement>("input")!;
  const bar = root.querySelector<HTMLElement>(".bar")!;
  const status = root.querySelector<HTMLElement>(".status")!;
  pick.focus();
  return new Promise((resolve) => {
    pick.onclick = () => input.click();
    input.onchange = async () => {
      const files = [...(input.files ?? [])];
      input.value = "";
      if (!files.length) return;
      pick.disabled = true;
      bar.hidden = false;
      status.textContent = "Reading sprites...";
      try {
        const atlas = await extractAtlas(files, (done, total) => {
          (bar.firstElementChild as HTMLElement).style.width = `${(100 * done) / total}%`;
        });
        root.hidden = true;
        resolve(atlas);
      } catch (e) {
        status.textContent = e instanceof Error ? e.message : String(e);
        bar.hidden = true;
        pick.disabled = false;
      }
    };
  });
}

function fmt(t: number) {
  return `${Math.floor(t / 60).toString().padStart(2, "0")}:${Math.floor(t % 60).toString().padStart(2, "0")}`;
}

/** "Evolves: X" line for upgrade cards. */
function evoHint(id: string): string {
  const evos = evolutionsFor(id);
  return evos.length ? `<br><span class="evo">Evolves: ${evos.map((e) => e.name).join(", ")}</span>` : "";
}
