import type { Atlas } from "./atlas";
import { ROOKIE, SHOP, VOCATIONS, ZONES, type VocationDef } from "./data";
import type { LevelChoice } from "./character";
import type { Game } from "./game";
import { imbuement, TIERS } from "./tibia/imbuements";
import { boost, BOOSTS, MAX_BOOST, MAX_SLOTS } from "./upgrades";
import { BLESSING_COST, boostCost, buyBlessing, buyBoost, buyTier, loadSave, tier, trackTier, TRACKS, type Save } from "./meta";
import { EVOLUTIONS, evolution, evolutionsFor } from "./evolutions";
import type { ChestResult } from "./game";
import { canWear, item, itemId, POTIONS, PRICES, SPELLS, wornItem, type SpellData } from "./tibia/db";
import { SKILL_NAMES } from "./tibia/rules";

/** DOM overlay menus. Every screen is a list of focusable buttons, so keys and gamepads can drive it. */
export class UI {
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

  nav(d: number) { if (this.open) this.setFocus(this.focus + d); }
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
      <span class="price">${e.cost === null ? "max" : `${e.cost.toLocaleString("en-US")} souls`}</span></button>`;
    const gear: Entry[] = TRACKS.map((t) => {
      const cur = trackTier(save, t), next = t.tiers[tier(save, t.id) + 1];
      const icon = next?.item ?? cur.item ?? (t.id === "potions" ? 266 : t.id === "gold" ? 3031 : 3061);
      return { icon, label: t.name, sub: next ? `${cur.label} → ${next.label}` : cur.label, cost: next ? next.cost : null, buy: () => buyTier(save, t) };
    });
    const boosts: Entry[] = BOOSTS.map((b) => {
      const lvl = save.boosts[b.id] ?? 0, maxed = lvl >= MAX_BOOST;
      return { icon: b.icon, label: `${b.name} ${lvl}`, sub: b.desc(Math.min(MAX_BOOST, lvl + (maxed ? 0 : 1))),
        cost: maxed ? null : boostCost(b.id, lvl), buy: () => buyBoost(save, b.id) };
    });
    boosts.push({ icon: 3061, label: `Blessing (${save.blessings}/5)`, sub: "Survive one death in your next run.",
      cost: save.blessings >= 5 ? null : BLESSING_COST, buy: () => buyBlessing(save) });
    const best = save.best ? ` · best: ${ZONES[save.best.zone].name}, level ${save.best.level}` : "";
    const el = this.screen("title prepare", `
      <h1>Tibia <span>Survivors</span></h1>
      <p class="sub"><span class="souls">${save.souls.toLocaleString("en-US")} souls</span>${save.runs ? ` · ${save.runs} run${save.runs === 1 ? "" : "s"}` : ""}${best}</p>
      <div class="cards"><button class="card voc start"><canvas width="192" height="168"></canvas>
        <b>Enter Rookgaard</b><small>Real Tibia: level 1, ${trackTier(save, TRACKS[0]).label} in hand. Choose a vocation at level 8.
        Walk further out for harder zones. Every kill earns souls, kept when you die.</small></button></div>
      <h3>Starting gear</h3><div class="shop boosts">${gear.map(entry).join("")}</div>
      <h3>Boosts <small>(multiply experience, loot, gold or skill training in every run)</small></h3>
      <div class="shop boosts">${boosts.map(entry).join("")}</div>
      <p class="hint">WASD / arrows / gamepad to move; your character fights by itself. Battle list: click to attack. P / Esc pauses.</p>`);
    const card = el.querySelector<HTMLElement>(".start")!;
    this.previews.push({ canvas: card.querySelector("canvas")!, sprite: ROOKIE.sprite });
    el.querySelectorAll<HTMLElement>(".buy .ico").forEach((c) => c.appendChild(this.icon(Number(c.dataset.id))));
    const all = [...gear, ...boosts];
    const buys = all.map((e, i) => () => { if (e.buy()) this.title(loadSave(), onStart, 1 + i); });
    this.setButtons([card, ...el.querySelectorAll<HTMLElement>(".buy")], [onStart, ...buys], focus);
  }

  /** Level 8: leave Rookgaard and pick a vocation. */
  chooseVocation(onPick: (v: VocationDef) => void) {
    const el = this.screen("title", `
      <h2>You have reached level 8!</h2>
      <p class="sub">Choose your vocation. Your level, skills, gold and upgrades carry over; you get the vocation's gear and spells.</p>
      <div class="cards">${VOCATIONS.map((v, i) => `
        <button class="card voc"><canvas width="192" height="168"></canvas>
          <b>${i + 1}. ${v.name}</b><small>${v.blurb}</small></button>`).join("")}
      </div>`);
    const cards = [...el.querySelectorAll<HTMLElement>(".voc")];
    cards.forEach((c, i) => this.previews.push({ canvas: c.querySelector("canvas")!, sprite: VOCATIONS[i].sprite }));
    this.setButtons(cards, VOCATIONS.map((v) => () => onPick(v)));
  }

  /** New spells: the vocation's spells whose level requirement has been reached. */
  /** Level-up: pick a new class spell or an imbuement (new, or the next tier of one you have). */
  levelUp(g: Game, choices: LevelChoice[], onPick: (c: LevelChoice) => void, title?: string) {
    const ch = g.ch;
    const card = (c: LevelChoice, i: number) => {
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
      if (ch.kind === "boost") { c.appendChild(this.icon(boost(ch.id)!.icon, 2)); return; }
      if (ch.kind === "train") {
        const w = g.ch.weapon;
        if (w) { c.appendChild(this.icon(w.id, 2)); return; }
      }
      const effect = ch.kind === "spell" ? ch.spell.effect : ch.kind === "imbue" ? imbuement(ch.id).effect : 10;
      const anim = this.atlas.data.effects[effect] ?? this.atlas.data.effects[13];
      c.appendChild(this.atlas.icon(anim.frames[Math.floor(anim.frames.length / 2)], 32, 2));
    });
    const reroll = el.querySelector<HTMLElement>(".reroll");
    const actions = choices.map((c) => () => onPick(c));
    if (reroll) actions.push(() => {
      g.rerolls--;
      this.levelUp(g, g.ch.rollChoices(), onPick, title);
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

  pause(g: Game, onResume: () => void, onQuit: () => void, focus = 0) {
    const ch = g.ch;
    const loot = ch.lootValue();
    const skills = ch.skills.map((s, i) => `<tr><td>${SKILL_NAMES[i]}</td><td>${ch.skill(i)}</td></tr>`).join("");
    // Every buy button, in page order, with what it does.
    type Entry = { id: number; label: string; price: number; ok: boolean; buy: () => void };
    const sections: { title: string; entries: Entry[]; empty?: string }[] = [];
    const equipBuy = (id: number, price: number) => () => {
      ch.gold -= price;
      const it = item(id)!, slot = ch.slotFor(it)!;
      const old = ch.equipment[slot];
      if (old) ch.stash(old);
      ch.equip(id);
      ch.fitAmmo();
      g.msg(`You bought and equipped ${it.name}.`, "#80ff80");
    };
    sections.push({
      title: "Weapons", empty: "No NPC sells weapons for your class.",
      entries: ch.shopWeapons().map((w) => ({
        id: w.id, price: w.price, ok: w.usable && ch.equipment.weapon !== w.id,
        label: `${item(w.id)!.name}${ch.equipment.weapon === w.id ? " (equipped)" : ""} <small>${stats(w.id)}</small>`,
        buy: equipBuy(w.id, w.price),
      })),
    });
    const ammo = ch.shopAmmo();
    if (ammo.length) {
      sections.push({
        title: "Ammunition",
        entries: ammo.map((a) => ({
          id: a.id, price: a.price * 100, ok: a.usable, label: `100× ${item(a.id)!.name} <small>${stats(a.id)}</small>`,
          buy: () => {
            ch.gold -= a.price * 100;
            ch.supplies.set(a.id, (ch.supplies.get(a.id) ?? 0) + 100);
            if ((item(a.id)!.attack ?? 0) >= (ch.ammo?.attack ?? 0) || ch.ammo?.ammotype !== ch.weapon?.ammotype) ch.equipment.ammo = a.id;
          },
        })),
      });
    }
    sections.push({
      title: "Supplies",
      entries: SHOP.filter((s) => usable(g, s.name) && PRICES[itemId(s.name)]?.buy && !item(itemId(s.name))?.ammotype).map((s) => {
        const id = itemId(s.name), price = PRICES[id].buy! * s.count;
        return { id, price, ok: true, label: `${s.count}× ${item(id)!.name}`, buy: () => {
          ch.gold -= price;
          ch.supplies.set(id, (ch.supplies.get(id) ?? 0) + s.count);
        } };
      }),
    });
    sections.push({
      title: "Equipment upgrades", empty: "Nothing better for your class and level right now.",
      entries: ch.shopUpgrades().filter((e) => e.slot !== "weapon").slice(0, 12).map((e) => ({
        id: e.id, price: e.price, ok: true, label: `${item(e.id)!.name} <small>${stats(e.id)}</small>`, buy: equipBuy(e.id, e.price),
      })),
    });
    const entries = sections.flatMap((s) => s.entries);
    const html = (e: Entry) => `<button class="btn buy" ${!e.ok || ch.gold < e.price ? "disabled" : ""}>
      <span class="ico" data-id="${e.id}"></span>${e.label}<span class="price">${e.price.toLocaleString("en-US")}</span></button>`;
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
        <div><h3>NPC trade <span class="gold">${ch.gold.toLocaleString("en-US")} gold</span></h3>
          <button class="btn sell" ${loot ? "" : "disabled"}>Sell ${ch.backpackCount.toLocaleString("en-US")} looted items for ${loot.toLocaleString("en-US")} gold</button>
          ${sections.map((s) => `<h4>${s.title}</h4><div class="shop">${s.entries.length ? s.entries.map(html).join("") : `<p class="hint">${s.empty ?? ""}</p>`}</div>`).join("")}
        </div>
      </div>
      <div class="row"><button class="btn">Resume</button><button class="btn">Quit run</button></div>`);
    el.querySelectorAll<HTMLElement>(".buy .ico").forEach((c) => c.appendChild(this.icon(Number(c.dataset.id))));
    const reopen = (i: number) => this.pause(g, onResume, onQuit, i);
    const sell = () => {
      ch.gold += loot;
      g.msg(`You sold ${ch.backpackCount} items for ${loot} gold.`, "#ffd34d");
      ch.backpack.clear();
      reopen(2);
    };
    const buys = entries.map((e, i) => () => {
      if (!e.ok || ch.gold < e.price) return;
      e.buy();
      reopen(3 + i);
    });
    const btns = [...el.querySelectorAll<HTMLElement>(".row .btn"), el.querySelector<HTMLElement>(".sell")!, ...el.querySelectorAll<HTMLElement>(".buy")];
    this.setButtons(btns, [onResume, onQuit, sell, ...buys], focus);
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
function usable(g: Game, name: string): boolean {
  const ch = g.ch, id = itemId(name);
  const pot = POTIONS[id];
  if (pot) return !pot.voc || pot.voc.includes(ch.voc.id);
  const rune = SPELLS.find((s) => s.runeId === id);
  if (rune) return rune.vocations.includes(ch.voc.id);
  const it = item(id);
  if (it?.ammotype) return ch.voc.id === "paladin";
  return !!it && canWear(it, ch.voc.id, 999);
}

/** Short stat line for an item, like Tibia's look text: (Atk:24 Def:21) (Arm:12). */
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
