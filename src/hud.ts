// The client around the game view, as HTML (the way Minibia and the Tibia client lay it out): window
// columns on the right (status, minimap, equipment with fight modes, skills, battle list, backpack, supplies),
// an F1-F12 hotbar and a tabbed console under the view, and names and health bars over the canvas.
// Windows can be minimized, closed, resized and dragged between columns; the layout is remembered.
import { stackPattern, type Atlas } from "./atlas";
import { SLOTS, type Slot } from "./character";
import { stackable, type Container } from "./container";
import { tooltipCharacter } from "./tooltip";
import { CHARM_TIERS, describeCharm, describeGrade, describePrey, PREY_SLOTS, spellGrades } from "./picks";
import { imbuement, TIERS } from "./tibia/imbuements";
import { MAX_SLOTS } from "./upgrades";
import { BESTIARY_STAGES, ZONES } from "./data";
import { mapColor, zoneAt } from "./map";
import { evolution } from "./evolutions";
import { cheb, ELEMENT_COLORS, type Channel, type Game, type LootDest, type Monster, type Targeting } from "./game";
import type { Renderer } from "./render";
import { item, MONSTERS, POTIONS, PRICES, SPELLS, type Element as DamageType, type SpellData } from "./tibia/db";
import { FIGHT_MODES, SKILL_NAMES, type FightMode } from "./tibia/rules";
import { boost, boostRate, formatRate, hasteBonus, luckBonus, RUN_BONUS_STEP, runBonus } from "./upgrades";

const LAYOUT_KEY = "tibia-survivors-ui-v1";
type WinId = "equipment" | "skills" | "battle" | "backpack" | "supplies" | "upgrades" | "bestiary";
const WINDOWS: { id: WinId; title: string; height?: number }[] = [
  { id: "equipment", title: "Equipment" },
  { id: "skills", title: "Skills", height: 230 },
  { id: "battle", title: "Battle", height: 220 },
  { id: "backpack", title: "Backpack", height: 238 },
  { id: "supplies", title: "Supplies", height: 110 },
  { id: "upgrades", title: "Upgrades", height: 200 },
  { id: "bestiary", title: "Bestiary", height: 240 },
];
interface Layout {
  cols: { a: WinId[]; b: WinId[] };
  min: Partial<Record<WinId, boolean>>;
  closed: Partial<Record<WinId, boolean>>;
  height: Partial<Record<WinId, number>>;
  fightMode: FightMode;
  chase: boolean;
  targeting: Targeting;
  zoom: number; // minimap pixels per tile
  runesOff: number[]; // runes auto-combat doesn't use (remembered between runs)
}
const DEFAULT_LAYOUT: Layout = {
  cols: { a: ["equipment", "skills", "upgrades"], b: ["battle", "backpack", "supplies", "bestiary"] },
  min: {}, closed: {}, height: {}, fightMode: "offensive", chase: true, targeting: "closest", zoom: 2, runesOff: [],
};

function loadLayout(): Layout {
  try {
    const l = { ...DEFAULT_LAYOUT, ...JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? "{}") } as Layout;
    // Windows added in a later version go to their default column.
    for (const w of WINDOWS) if (!l.cols.a.includes(w.id) && !l.cols.b.includes(w.id)) l.cols[DEFAULT_LAYOUT.cols.a.includes(w.id) ? "a" : "b"].push(w.id);
    return l;
  } catch {
    return structuredClone(DEFAULT_LAYOUT);
  }
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", html = "") => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};
const fmt = (n: number) => Math.floor(n).toLocaleString("en-US");
const clock = (t: number) => `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
/** Tibia's health colors, by fraction left. */
export const hpColor = (f: number) => (f > 0.92 ? "#00c000" : f > 0.6 ? "#60c060" : f > 0.3 ? "#c0c000" : f > 0.08 ? "#c03030" : "#600000");
const pct = (f: number) => `${Math.max(0, Math.min(100, f * 100)).toFixed(1)}%`;

/** Tibia's condition icons for damage over time, by the damage type it ticks. */
const CONDITION_ICONS: Partial<Record<DamageType, [string, string]>> = {
  earth: ["☠", "Poisoned"], fire: ["🔥", "Burning"], energy: ["ϟ", "Electrified"], drown: ["≈", "Drowning"],
  physical: ["✚", "Bleeding"], ice: ["❄", "Freezing"], holy: ["☀", "Dazzled"], death: ["✝", "Cursed"],
};

type HotEntry = { kind: "spell"; s: SpellData } | { kind: "potion"; id: number };
const entryKey = (e: HotEntry) => (e.kind === "spell" ? `s:${e.s.file}` : `p:${e.id}`);
export const HOTKEYS = ["F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12"];
/** Laptop-friendly alternatives: the number row. */
export const HOTKEYS_ALT = ["Digit1", "Digit2", "Digit3", "Digit4", "Digit5", "Digit6", "Digit7", "Digit8", "Digit9", "Digit0", "Minus", "Equal"];

export class Hud {
  private layout = loadLayout();
  private wins = new Map<WinId, { root: HTMLElement; head: HTMLElement; body: HTMLElement }>();
  private toolBtns = new Map<WinId, HTMLElement>();
  private colA = document.getElementById("col-a")!;
  private colB = document.getElementById("col-b")!;
  private urls = new Map<string, string>();
  private g: Game | null = null;
  private slow = 0; // throttle for the windows that don't need 60 updates a second
  private sig = new Map<string, string>(); // last-rendered content per part, to skip unchanged DOM work

  // status
  private hpBar!: HTMLElement;
  private manaBar!: HTMLElement;
  private shieldBar!: HTMLElement;
  private conds!: HTMLElement;
  // minimap
  private mm!: HTMLCanvasElement;
  private mmCap!: HTMLElement;
  private mmTiles = document.createElement("canvas");
  // equipment
  private slotEls = new Map<Slot, HTMLElement>();
  private modeBtns = new Map<string, HTMLElement>();
  private goldEl!: HTMLElement;
  private soulsEl!: HTMLElement;
  private capEl!: HTMLElement;
  private bankedSouls = 0; // in the bank when the run started
  private shownGold = 0;
  private goldPulse = 0;
  // backpack: the container window shows one container at a time, like Tibia's
  private bpSlot!: HTMLElement;
  private bpIcon = el("img", "win-ico");
  private bpTitle!: HTMLElement;
  private bpUp = el("button", "", "▲");
  private bpGrid = el("div", "grid box");
  private bpWorth = el("div", "loot-line");
  private bpSell = el("button", "bp-sell");
  private bestiaryOpen = new Set<string>(); // creatures whose details are shown
  private open: Container | null = null; // null: the main backpack
  // battle
  private rows = new Map<number, HTMLElement>();
  private battleEmpty = el("div", "empty-note", "No creatures in sight.");
  private targetBtn = el("button", "target-mode");
  // hotbar
  private hot: (HotEntry | null)[] = [];
  private hotEls: { root: HTMLElement; img: HTMLImageElement; cd: HTMLElement; count: HTMLElement }[] = [];
  // console
  private tabs = new Map<Channel, { tab: HTMLElement; lines: HTMLElement }>();
  private tab: Channel = "default";
  private lastLog = 0;
  // over the canvas
  private labels = document.getElementById("labels")!;
  private labelEls = new Map<number, { root: HTMLElement; name: HTMLElement; hp: HTMLElement; mana?: HTMLElement; key: string }>();
  private banner = document.getElementById("banner")!;
  private statusMsg = document.getElementById("status-msg")!;
  private statusTimer = 0;

  constructor(private atlas: Atlas, private actions: { target: (id: number) => void; shop: () => void }) {
    this.buildSide();
    this.buildHotbar();
    this.buildConsole();
  }

  // ---------- setup ----------

  private save() { localStorage.setItem(LAYOUT_KEY, JSON.stringify(this.layout)); }

  private url(k: string, make: () => HTMLCanvasElement) {
    let u = this.urls.get(k);
    if (!u) this.urls.set(k, (u = make().toDataURL()));
    return u;
  }
  private itemUrl(id: number, n = 1) {
    const pat = stackable(id) ? stackPattern(n) : 0;
    return this.url(`i${id}:${pat}`, () => this.atlas.itemIcon(id, 32, 1, n));
  }
  private spellUrl(s: SpellData) {
    return this.url(`s${s.file}`, () => {
      if (s.runeId) return this.atlas.itemIcon(s.runeId);
      const anim = this.atlas.data.effects[s.effect] ?? this.atlas.data.effects[13];
      return this.atlas.icon(anim.frames[Math.floor(anim.frames.length / 2)]);
    });
  }

  private buildSide() {
    // Toolbar: open and close windows, and the shop.
    const bar = el("div", "toolbar");
    for (const w of WINDOWS) {
      const b = el("button", "tool", w.title);
      b.title = `Show or hide the ${w.title.toLowerCase()} window`;
      b.addEventListener("click", () => this.setClosed(w.id, !this.layout.closed[w.id]));
      this.toolBtns.set(w.id, b);
      bar.append(b);
    }
    const shop = el("button", "tool shop", "Shop (P)");
    shop.title = "Pause: sell loot and buy supplies and gear";
    shop.addEventListener("click", () => this.actions.shop());
    bar.append(shop);

    // Minimap, with its zoom buttons in a column beside it (Tibia's top right).
    const mm = el("div", "minimap");
    this.mm = el("canvas");
    this.mm.width = this.mm.height = 148; // drawn 1:1 (style.css), leaving room for the buttons and a scrollbar
    const btns = el("div", "mm-btns");
    for (const [label, d] of [["+", 1], ["−", -1]] as const) {
      const b = el("button", "mm-btn", label);
      b.title = d > 0 ? "Zoom in" : "Zoom out";
      b.addEventListener("click", () => {
        this.layout.zoom = Math.max(1, Math.min(8, this.layout.zoom * (d > 0 ? 2 : 0.5)));
        this.save();
        this.drawMinimap();
      });
      btns.append(b);
    }
    // Click the minimap to walk there, as in Tibia.
    this.mm.addEventListener("click", (e) => {
      const g = this.g;
      if (!g || g.over) return;
      const r = this.mm.getBoundingClientRect(), z = this.layout.zoom, size = this.mm.width;
      const px = ((e.clientX - r.left) * size) / r.width, py = ((e.clientY - r.top) * size) / r.height;
      g.walkToTile(g.player.tx + Math.floor((px - size / 2) / z + 0.5), g.player.ty + Math.floor((py - size / 2) / z + 0.5));
    });
    this.mmCap = el("div", "mm-cap");
    mm.append(el("div", "mm-row"), this.mmCap);
    mm.firstElementChild!.append(this.mm, btns);

    // Health, mana, magic shield (Tibia's slim bars, the number beside them), conditions.
    const st = el("div", "status");
    const bar2 = (cls: string) => el("div", `bar ${cls}`, "<i></i><b><s></s></b><span></span>");
    this.hpBar = bar2("hp");
    this.manaBar = bar2("mana");
    this.shieldBar = bar2("shield");
    this.conds = el("div", "conds");
    st.append(this.hpBar, this.manaBar, this.shieldBar, this.conds);

    // Tibia's order: minimap, health and mana, then the buttons, then the windows.
    this.colA.append(mm, st, bar);
    for (const w of WINDOWS) this.wins.set(w.id, this.makeWindow(w.id, w.title));
    this.placeWindows();
    this.buildEquipment();
    this.buildBackpack();
    // Right-click a rune you can conjure: conjure it.
    this.wins.get("supplies")!.body.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const id = Number((e.target as HTMLElement).closest<HTMLElement>(".slot[data-item]")?.dataset.item);
      const rune = SPELLS.find((s) => s.runeId === id && s.conjure);
      if (!this.g || !rune) return;
      this.status(this.g.conjure(rune) ?? `You conjure ${rune.conjure!.count} ${rune.name}s.`);
    });
    this.wins.get("supplies")!.body.addEventListener("click", (e) => {
      const id = Number((e.target as HTMLElement).closest<HTMLElement>(".slot[data-item]")?.dataset.item);
      if (id) this.pickSupply(id);
    });
    // Bestiary rows open and close on a click.
    this.wins.get("bestiary")!.body.addEventListener("click", (e) => {
      const key = (e.target as HTMLElement).closest<HTMLElement>(".be")?.dataset.key;
      if (!key || !this.g) return;
      if (!this.bestiaryOpen.delete(key)) this.bestiaryOpen.add(key);
      this.bestiary(this.g);
    });
    this.buildBattle();
    for (const c of [this.colA, this.colB]) {
      c.addEventListener("dragover", (e) => this.dragOver(e, c));
      c.addEventListener("drop", (e) => { e.preventDefault(); this.dragEnd(); });
    }
  }

  private makeWindow(id: WinId, title: string) {
    const root = el("div", "win");
    root.dataset.id = id;
    const head = el("div", "win-head", `<span>${title}</span>`);
    const min = el("button", "", "−");
    min.title = "Minimize";
    min.addEventListener("click", () => {
      this.layout.min[id] = !this.layout.min[id];
      root.classList.toggle("min", !!this.layout.min[id]);
      this.save();
    });
    const close = el("button", "", "×");
    close.title = "Close (reopen it from the toolbar)";
    close.addEventListener("click", () => this.setClosed(id, true));
    head.append(min, close);
    const body = el("div", "win-body");
    const h = this.layout.height[id] ?? WINDOWS.find((w) => w.id === id)!.height;
    if (h) body.style.height = `${h}px`;
    const foot = el("div", "win-foot");
    foot.title = "Drag to resize";
    // Resize by the footer.
    foot.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const y0 = e.clientY, h0 = body.getBoundingClientRect().height;
      const move = (ev: MouseEvent) => { body.style.height = `${Math.max(30, Math.round(h0 + ev.clientY - y0))}px`; };
      const up = () => {
        removeEventListener("mousemove", move);
        removeEventListener("mouseup", up);
        this.layout.height[id] = parseInt(body.style.height);
        this.save();
      };
      addEventListener("mousemove", move);
      addEventListener("mouseup", up);
    });
    // Drag by the header to move it, within a column or to the other one.
    head.draggable = true;
    head.addEventListener("dragstart", (e) => {
      if ((e.target as HTMLElement).tagName === "BUTTON") { e.preventDefault(); return; }
      e.dataTransfer!.effectAllowed = "move";
      e.dataTransfer!.setData("text/plain", id);
      root.classList.add("dragging");
    });
    head.addEventListener("dragend", () => this.dragEnd());
    root.append(head, body, foot);
    root.classList.toggle("min", !!this.layout.min[id]);
    return { root, head, body };
  }

  private dragOver(e: DragEvent, col: HTMLElement) {
    const dragging = document.querySelector<HTMLElement>(".win.dragging");
    if (!dragging) return;
    e.preventDefault();
    const after = [...col.querySelectorAll<HTMLElement>(".win:not(.dragging)")].find((w) => {
      const r = w.getBoundingClientRect();
      return e.clientY < r.top + r.height / 2;
    });
    if (after) col.insertBefore(dragging, after);
    else col.append(dragging);
  }

  private dragEnd() {
    document.querySelector(".win.dragging")?.classList.remove("dragging");
    const ids = (c: HTMLElement) => [...c.querySelectorAll<HTMLElement>(".win")].map((w) => w.dataset.id as WinId);
    this.layout.cols = { a: ids(this.colA), b: ids(this.colB) };
    this.save();
  }

  private placeWindows() {
    for (const [col, ids] of [[this.colA, this.layout.cols.a], [this.colB, this.layout.cols.b]] as const) {
      for (const id of ids) {
        const w = this.wins.get(id);
        if (w) col.append(w.root);
      }
    }
    for (const w of WINDOWS) this.setClosed(w.id, !!this.layout.closed[w.id], false);
  }

  private setClosed(id: WinId, closed: boolean, save = true) {
    this.layout.closed[id] = closed;
    this.wins.get(id)!.root.classList.toggle("closed", closed);
    this.toolBtns.get(id)?.classList.toggle("on", !closed);
    if (save) this.save();
  }

  private buildEquipment() {
    const body = this.wins.get("equipment")!.body;
    const wrap = el("div", "equip-win");
    const grid = el("div", "slots");
    // Tibia's inventory: amulet, helmet, backpack / weapon, armor, shield / ring, legs, ammo / soul, boots, cap.
    const layout: (Slot | "backpack" | "soul" | "cap")[] = ["necklace", "head", "backpack", "weapon", "armor", "shield", "ring", "legs", "ammo", "soul", "feet", "cap"];
    for (const slot of layout) {
      if (slot === "soul" || slot === "cap") {
        // Tibia's Soul and Cap boxes; here Soul counts your souls, the meta currency.
        const box = el("div", "slot stat", `<small>${slot === "soul" ? "Soul" : "Cap"}</small><b class="${slot === "soul" ? "souls" : "cap"}">0</b>`);
        if (slot === "soul") this.soulsEl = box.querySelector("b")!;
        else this.capEl = box.querySelector("b")!;
        grid.append(box);
        continue;
      }
      const s = el("div", "slot");
      if (slot === "backpack") {
        // Click the backpack to open it, like in Tibia.
        s.classList.add("bp");
        s.addEventListener("click", () => this.openBox(null));
        this.bpSlot = s;
        grid.append(s);
        continue;
      }
      s.dataset.slot = slot === "necklace" ? "amulet" : slot === "feet" ? "boots" : slot === "head" ? "helmet" : slot;
      this.slotEls.set(slot, s);
      grid.append(s);
    }
    const modes = el("div", "modes");
    const mode = (key: string, glyph: string, title: string, click: () => void) => {
      const b = el("button", `mode ${key}`, glyph);
      b.title = title;
      b.addEventListener("click", click);
      this.modeBtns.set(key, b);
      modes.append(b);
    };
    const describe = (m: FightMode) => {
      const f = FIGHT_MODES[m];
      return `${f.name}: damage x${f.attack}, defense x${m === "offensive" ? "0.5 (1.0 when not attacking)" : f.defense}, mitigation x${f.mitigation}`;
    };
    mode("offensive", "⚔", describe("offensive"), () => this.setFightMode("offensive"));
    mode("balanced", "⚖", describe("balanced"), () => this.setFightMode("balanced"));
    mode("defensive", "⛨", describe("defensive"), () => this.setFightMode("defensive"));
    mode("chase", "»", "Chase opponent (C)", () => this.setChase(true));
    mode("stand", "■", "Stand while fighting (C)", () => this.setChase(false));
    wrap.append(grid, modes);
    const purse = el("div", "purse", `<div>Gold</div><div class="v"><span class="gold-v">0</span></div>`);
    this.goldEl = purse.querySelector(".gold-v")!;
    body.append(wrap, purse);
  }

  private buildBackpack() {
    const { head, body } = this.wins.get("backpack")!;
    this.bpTitle = head.querySelector("span")!;
    head.prepend(this.bpIcon);
    this.bpUp.title = "Back to the container this one is in";
    this.bpUp.addEventListener("click", () => this.openBox(this.open?.parent ?? null));
    this.bpTitle.after(this.bpUp);
    body.append(this.bpGrid, this.bpWorth);
    // Selling from the backpack (no trip to the shop): a button for everything, right-click for one stack.
    this.bpSell.addEventListener("click", () => {
      const g = this.g;
      if (!g) return;
      const n = g.ch.backpackCount, gold = g.ch.sell();
      if (gold) { g.msg(`You sold ${fmt(n)} items for ${fmt(gold)} gold.`, "#ffd34d"); this.status(`Sold for ${fmt(gold)} gold.`); }
      this.sig.delete("backpack");
      this.backpack(g);
    });
    this.bpWorth.after(this.bpSell);
    this.bpGrid.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const g = this.g, i = Number((e.target as HTMLElement).closest<HTMLElement>(".slot")?.dataset.i);
      const t = this.shownBox()?.items[i];
      if (!g || !t || t.inner) return;
      const name = item(t.id)!.name, n = [...g.ch.backpack.all()].filter((x) => x.id === t.id).reduce((a, x) => a + x.n, 0);
      const gold = g.ch.sell(t.id);
      if (!gold) {
        // Nobody buys it: right-click throws it away instead.
        g.ch.discard(t.id);
        this.status(`You throw away ${n} ${name}${n > 1 ? "s" : ""}.`);
      } else {
        g.msg(`You sold ${n} ${name}${n > 1 ? "s" : ""} for ${fmt(gold)} gold.`, "#ffd34d");
        this.status(`Sold ${n} ${name}${n > 1 ? "s" : ""} for ${fmt(gold)} gold.`);
      }
      this.sig.delete("backpack");
      this.backpack(g);
    });
    // Click a container to open it in this window (Tibia's default); click anything else to look at it.
    this.bpGrid.addEventListener("click", (e) => {
      const i = Number((e.target as HTMLElement).closest<HTMLElement>(".slot")?.dataset.i);
      const t = this.shownBox()?.items[i];
      if (!t) return;
      if (t.inner) this.openBox(t.inner);
      else this.useItem(t.id, t.n);
    });
  }

  /** Click an item in the backpack: wear it if it can be worn (what it replaces goes in the backpack),
   *  otherwise look at it. */
  private useItem(id: number, n: number) {
    const g = this.g, it = item(id);
    if (!g || !it) return;
    if (!g.ch.slotFor(it)) { this.status(this.look(id, n)); return; }
    const err = g.ch.wearFromBackpack(id);
    if (err) { this.status(err); return; }
    g.ch.fitAmmo();
    g.msg(`You equip ${it.name}.`, "#80ff80");
    this.status(`You equip ${it.name}.`);
    this.sig.delete("backpack");
    this.backpack(g);
    this.equipment(g);
  }

  /** Tibia's "You see" text, with what an NPC pays. */
  private look(id: number, n: number) {
    const it = item(id)!, each = PRICES[id]?.sell ?? 0;
    const what = n > 1 ? `${n} ${it.name}s` : `${/^[aeiou]/.test(it.name) ? "an" : "a"} ${it.name}`;
    return `You see ${what}.${each ? ` NPCs pay ${fmt(each * n)} gold.` : ""}`;
  }

  /** Show a container in the backpack window (null: the main backpack), opening the window if needed. */
  private openBox(c: Container | null) {
    this.open = c;
    this.setClosed("backpack", false);
    if (this.layout.min.backpack) {
      this.layout.min.backpack = false;
      this.wins.get("backpack")!.root.classList.remove("min");
      this.save();
    }
    this.sig.delete("backpack");
    if (this.g) this.backpack(this.g);
  }

  /** The container on show, if it's still in the backpack (selling empties it, nested backpacks too). */
  private shownBox(): Container | null {
    const root = this.g?.ch.backpack ?? null;
    const c = this.open;
    if (!c || !root) return root;
    for (let x = c; x !== root; x = x.parent!) {
      if (!x.parent || !x.parent.items.some((t) => t.inner === x)) {
        this.open = null;
        return root;
      }
    }
    return c;
  }

  setFightMode(m: FightMode) {
    this.layout.fightMode = m;
    this.save();
    if (this.g) {
      this.g.fightMode = m;
      this.g.msg(`Fight mode: ${FIGHT_MODES[m].name.toLowerCase()}.`, "#80c0ff");
    }
    this.syncModes();
  }

  setChase(on: boolean) {
    this.layout.chase = on;
    this.save();
    if (this.g) {
      this.g.chase = on;
      this.g.msg(on ? "Fight mode: chase opponent." : "Fight mode: stand while fighting.", "#80c0ff");
    }
    this.syncModes();
  }

  get chase() { return this.layout.chase; }

  /** Battle window header: who auto-targeting goes for, closest or weakest. The list sorts the same way. */
  private buildBattle() {
    const head = this.wins.get("battle")!.head;
    this.targetBtn.addEventListener("click", () => this.setTargeting(this.layout.targeting === "closest" ? "weakest" : "closest"));
    head.querySelector("span")!.after(this.targetBtn);
  }

  setTargeting(t: Targeting) {
    this.layout.targeting = t;
    this.save();
    if (this.g) {
      this.g.targeting = t;
      this.g.msg(t === "closest" ? "Targeting: closest creature." : "Targeting: creature with the lowest health.", "#80c0ff");
    }
    this.syncModes();
  }

  get targeting() { return this.layout.targeting; }

  private syncModes() {
    for (const m of ["offensive", "balanced", "defensive"]) this.modeBtns.get(m)!.classList.toggle("on", this.layout.fightMode === m);
    this.modeBtns.get("chase")!.classList.toggle("on", this.layout.chase);
    this.modeBtns.get("stand")!.classList.toggle("on", !this.layout.chase);
    const weakest = this.layout.targeting === "weakest";
    this.targetBtn.textContent = weakest ? "♥ Weakest" : "◎ Closest";
    this.targetBtn.classList.toggle("weakest", weakest);
    this.targetBtn.title = `Auto-target the ${weakest ? "creature with the lowest health" : "closest creature"}. Click or T to switch.`;
  }

  private buildHotbar() {
    const bar = document.getElementById("hotbar")!;
    HOTKEYS.forEach((k, i) => {
      const root = el("div", "hk");
      const img = el("img");
      img.hidden = true;
      const cd = el("div", "cd");
      const key = el("span", "key", k);
      const count = el("span", "count");
      root.append(img, cd, key, count);
      root.addEventListener("click", () => this.use(i));
      bar.append(root);
      this.hotEls.push({ root, img, cd, count });
    });
  }

  private buildConsole() {
    const con = document.getElementById("console")!;
    const tabs = el("div", "tabs");
    con.append(tabs);
    for (const [ch, name] of [["default", "Server Log"], ["loot", "Loot"], ["combat", "Combat"]] as const) {
      const tab = el("button", "tab", name);
      const lines = el("div", "lines");
      lines.hidden = ch !== this.tab;
      tab.classList.toggle("on", ch === this.tab);
      tab.addEventListener("click", () => {
        this.tab = ch;
        for (const [c, t] of this.tabs) {
          t.tab.classList.toggle("on", c === ch);
          t.lines.hidden = c !== ch;
        }
        tab.classList.remove("new");
        lines.scrollTop = lines.scrollHeight;
      });
      tabs.append(tab);
      con.append(lines);
      this.tabs.set(ch, { tab, lines });
    }
  }

  // ---------- per run ----------

  /** A new run (or the title screen, with null). */
  bind(g: Game | null, bankedSouls = 0) {
    this.bankedSouls = bankedSouls;
    tooltipCharacter(g?.ch ?? null);
    this.g = g;
    document.body.classList.toggle("ingame", !!g);
    this.hot = new Array(12).fill(null);
    this.sig.clear();
    this.lastLog = 0;
    for (const t of this.tabs.values()) { t.lines.innerHTML = ""; t.tab.classList.remove("new"); }
    for (const r of this.rows.values()) r.remove();
    this.rows.clear();
    for (const l of this.labelEls.values()) l.root.remove();
    this.labelEls.clear();
    this.shownGold = 0;
    this.open = null;
    if (g) {
      g.fightMode = this.layout.fightMode;
      g.chase = this.layout.chase;
      g.targeting = this.layout.targeting;
      g.ch.runesOff = new Set(this.layout.runesOff);
    }
    this.syncModes();
  }

  /** Every frame. */
  update(g: Game, r: Renderer, dpr: number, dt: number) {
    this.labelsLayer(g, r, dpr);
    this.statusBars(g);
    this.hotbar(g);
    this.consoleLines(g);
    this.purse(g, dt);
    this.bannerText(g);
    this.statusTimer -= dt;
    if (this.statusTimer <= 0) this.statusMsg.classList.remove("on");
    this.slow -= dt;
    if (this.slow > 0) return;
    this.slow = 0.25;
    this.equipment(g);
    this.skills(g);
    this.battle(g);
    this.backpack(g);
    this.supplies(g);
    this.upgrades(g);
    this.bestiary(g);
    this.drawMinimap();
  }

  /** Where looted gold and items fly to, in window pixels. */
  lootTargets(): Record<LootDest, [number, number]> {
    const center = (e: Element | null | undefined): [number, number] | null => {
      if (!e) return null;
      const r = e.getBoundingClientRect();
      return r.width ? [r.left + r.width / 2, r.top + r.height / 2] : null;
    };
    const fallback = center(this.colA) ?? [innerWidth, innerHeight / 2];
    const win = (id: WinId) => {
      const w = this.wins.get(id)!;
      return center(w.root.classList.contains("min") ? w.root : w.body);
    };
    // Loot lands in the backpack's first slot (Tibia puts new items in front), else on the backpack itself.
    const bag = (this.wins.get("backpack")!.root.classList.contains("min") ? null : center(this.bpGrid.firstElementChild))
      ?? center(this.bpSlot) ?? fallback;
    return { gold: center(this.goldEl) ?? fallback, bag, supplies: win("supplies") ?? bag, worn: win("equipment") ?? fallback };
  }

  /** Tibia's white status message at the bottom of the game view. */
  status(text: string) {
    this.statusMsg.textContent = text;
    this.statusMsg.classList.add("on");
    this.statusTimer = 2.5;
  }

  /** Changed since last time? (cheap guard against rebuilding identical DOM) */
  private changed(part: string, sig: string) {
    if (this.sig.get(part) === sig) return false;
    this.sig.set(part, sig);
    return true;
  }

  // ---------- status ----------

  private statusBars(g: Game) {
    const ch = g.ch;
    const set = (bar: HTMLElement, cur: number, max: number, label: string) => {
      bar.querySelector("s")!.style.width = pct(cur / max);
      bar.querySelector("span")!.textContent = fmt(Math.max(0, Math.ceil(cur)));
      bar.title = `${label} ${fmt(Math.max(0, Math.ceil(cur)))} / ${fmt(max)}`;
    };
    set(this.hpBar, ch.hp, ch.maxHp, "HP");
    set(this.manaBar, ch.mana, ch.maxMana, "MP");
    const shield = g.manaShield > 0 && g.time < g.manaShieldUntil;
    this.shieldBar.hidden = !shield;
    if (shield) set(this.shieldBar, g.manaShield, g.manaShieldMax, "Shield");

    const p = g.player;
    const conds: [string, string, string][] = [];
    if (g.monsters.some((m) => !m.dead && cheb(m.tx, m.ty, p.tx, p.ty) <= 1) || g.time - g.lastAttack < 3) conds.push(["⚔", "#ff8080", "In battle"]);
    if (shield) conds.push(["MS", "#b090ff", `Magic shield: ${fmt(g.manaShield)} left, ${Math.ceil(g.manaShieldUntil - g.time)} s`]);
    // Damage over time, with Tibia's condition names.
    for (const [el, c] of g.conditions) {
      const [glyph, name] = CONDITION_ICONS[el] ?? ["!", "Hurt"];
      const left = c.ticks.reduce((a, b) => a + b, 0);
      conds.push([glyph, ELEMENT_COLORS[el], `${name}: ${left} damage left, ${c.ticks[0]} every ${c.every} s`]);
    }
    if (ch.slowDelta) conds.push(["⌛", "#ff9c30", `Paralyzed: speed ${ch.speed} for ${Math.ceil(g.paralyzedUntil - g.time)} s`]);
    else if (ch.hasteDelta) conds.push(["»", "#80ff80", `Hasted: speed ${ch.speed} for ${Math.ceil(g.hasteUntil - g.time)} s`]);
    else if (ch.boostLevel("haste") || ch.evolutions.has("draken")) conds.push(["»", "#80ff80", `Hasted: speed ${ch.speed}`]);
    if (ch.stance) conds.push(["✦", "#ffb060", `${ch.stance.name}: ${Math.ceil(g.stanceUntil - g.time)} s`]);
    if (g.recovery) conds.push(["♥", "#40ff60", `Recovery: ${g.recovery.hp} hit points every ${g.recovery.every} s, ${Math.ceil(g.recovery.until - g.time)} s left`]);
    if (ch.blessings) conds.push([`✝${ch.blessings}`, "#ffd34d", `${ch.blessings} blessing${ch.blessings > 1 ? "s" : ""}: saved from death`]);
    if (g.fightMode !== "offensive") conds.push([g.fightMode === "balanced" ? "⚖" : "⛨", g.fightMode === "balanced" ? "#ffd34d" : "#80b0ff", FIGHT_MODES[g.fightMode].name]);
    const sig = conds.map((c) => c.join()).join("|");
    if (this.changed("conds", sig)) {
      this.conds.innerHTML = conds.map(([t, c, title]) => `<span class="cond" style="color:${c}" title="${title}">${t}</span>`).join("");
    }
  }

  private purse(g: Game, dt: number) {
    const ch = g.ch;
    // Free capacity, as Tibia's inventory shows it; red when there's little left.
    const free = ch.capacity - ch.carried;
    this.capEl.textContent = fmt(Math.max(0, free));
    this.capEl.classList.toggle("low", free < 20);
    this.capEl.title = `Capacity ${fmt(ch.capacity)} oz, carrying ${ch.carried.toFixed(1)} oz`;
    // Gold rolls up and pulses when it grows.
    if (ch.gold < this.shownGold) this.shownGold = ch.gold;
    if (ch.gold > this.shownGold) {
      this.shownGold = Math.min(ch.gold, this.shownGold + Math.max(1, (ch.gold - this.shownGold) * dt * 6));
      this.goldPulse = 1;
    }
    this.goldPulse = Math.max(0, this.goldPulse - dt * 2);
    this.goldEl.textContent = fmt(this.shownGold);
    this.goldEl.style.transform = `scale(${1 + 0.3 * this.goldPulse})`;
    this.goldEl.style.color = this.goldPulse > 0 ? "#ffe680" : "";
    // Your total: what's banked plus what this run has earned (banked when it ends).
    this.soulsEl.textContent = fmt(this.bankedSouls + g.souls);
    this.soulsEl.title = `${fmt(this.bankedSouls)} banked + ${fmt(g.souls)} this run`;
  }

  private bannerText(g: Game) {
    const b = g.banner;
    if (this.changed("banner", b?.text ?? "")) this.banner.textContent = b?.text ?? "";
    this.banner.style.opacity = b ? String(Math.min(1, b.t)) : "0";
  }

  // ---------- minimap ----------

  private drawMinimap() {
    const g = this.g;
    if (!g) return;
    const z = this.layout.zoom, size = this.mm.width, n = Math.ceil(size / z) + 1;
    const p = g.player, x0 = p.tx - Math.floor(n / 2), y0 = p.ty - Math.floor(n / 2);
    const t = this.mmTiles;
    t.width = t.height = n;
    const tc = t.getContext("2d")!;
    const img = tc.createImageData(n, n);
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const tx = x0 + x, ty = y0 + y, zi = zoneAt(tx, ty);
        let [r, gg, b] = mapColor(tx, ty);
        // Where one zone opens into the next (a gap in the wall): a light line.
        if ((zoneAt(tx + 1, ty) !== zi || zoneAt(tx, ty + 1) !== zi) && !g.world.blocked(tx, ty)) [r, gg, b] = [230, 220, 170];
        const o = (y * n + x) * 4;
        img.data[o] = r; img.data[o + 1] = gg; img.data[o + 2] = b; img.data[o + 3] = 255;
      }
    tc.putImageData(img, 0, 0);
    const ctx = this.mm.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    // Center the player's tile.
    const off = size / 2 - (p.tx - x0 + 0.5) * z;
    ctx.drawImage(t, off, off, n * z, n * z);
    const dot = (tx: number, ty: number, c: string, s = Math.max(2, z)) => {
      ctx.fillStyle = c;
      ctx.fillRect(Math.round(off + (tx - x0 + 0.5) * z - s / 2), Math.round(off + (ty - y0 + 0.5) * z - s / 2), s, s);
    };
    dot(0, 0, "#fff", Math.max(3, z)); // where you started: the temple
    for (const c of g.corpses) if (!c.looted && c.loot.length) dot(c.tx, c.ty, "#40d040");
    for (const c of g.chests) dot(c.tx, c.ty, "#ffd34d", Math.max(4, z + 2));
    for (const m of g.monsters) if (!m.dead) dot(m.tx, m.ty, m.boss ? "#ffd34d" : "#ff3030");
    // You: a white cross.
    ctx.fillStyle = "#fff";
    const c = size / 2;
    ctx.fillRect(c - 4, c - 1, 8, 2);
    ctx.fillRect(c - 1, c - 4, 2, 8);
    const zone = ZONES[Math.max(0, g.zone)];
    const place = g.hunt ? g.hunt.name[0].toUpperCase() + g.hunt.name.slice(1) : zone.name;
    const floor = g.floor ? ` · floor -${g.floor}` : "";
    const cap = `${place}|${floor}|${zone.level}|${clock(g.time)}|${g.kills}`;
    if (this.changed("mmcap", cap)) this.mmCap.innerHTML = `${place}<small>${g.hunt ? `${zone.name}${floor} · ` : ""}level ${zone.level}+ · ${clock(g.time)} · ${fmt(g.kills)} kills</small>`;
  }

  // ---------- windows ----------

  private equipment(g: Game) {
    const ch = g.ch;
    for (const slot of SLOTS) {
      const s = this.slotEls.get(slot);
      if (!s) continue;
      const id = ch.equipment[slot];
      const n = id && (slot === "ammo" || id === ch.thrown) ? ch.supplies.get(id) ?? 0 : 0;
      // A ring's minutes or an amulet's charges left.
      const wear = ch.wear[slot];
      const left = wear ? (wear.timed ? `${Math.ceil(wear.left / 60)}m` : String(wear.left)) : "";
      if (!this.changed(`slot:${slot}`, `${id}:${n}:${left}`)) continue;
      s.classList.toggle("empty", !id);
      s.innerHTML = id ? `<img src="${this.itemUrl(id)}" alt=""><span class="count">${n || left}</span>` : "";
      if (id) { s.dataset.item = String(id); s.dataset.n = String(n || 1); } else { delete s.dataset.item; delete s.dataset.n; }
      if (wear) s.dataset.hint = wear.timed ? `${Math.ceil(wear.left / 60)} minutes left` : `${wear.left} charges left`;
      else delete s.dataset.hint;
    }
  }

  private skills(g: Game) {
    const ch = g.ch;
    const rows: string[] = [];
    const row = (label: string, value: string, frac?: number) => {
      rows.push(`<div class="k">${label}</div><div class="v">${value}</div>`);
      if (frac !== undefined) rows.push(`<div class="pct"><s style="width:${pct(frac)}"></s></div>`);
    };
    row("Level", String(ch.level), ch.levelPercent());
    row("Experience", fmt(ch.exp));
    row("Vocation", ch.vocName);
    row("Speed", String(ch.speed));
    row("Magic level", String(ch.ml), ch.mlPercent());
    rows.push(`<div class="sep"></div>`);
    SKILL_NAMES.forEach((name, i) => row(name, String(ch.skill(i)), ch.skillPercent(i)));
    rows.push(`<div class="sep"></div>`);
    row("Armor", String(ch.armor));
    row("Attack", String(ch.attackValue));
    if (ch.blessings) row("Blessings", String(ch.blessings));
    if (ch.luck) row("Luck", String(ch.luck));
    if (ch.boosts.size || ch.evolutions.size) {
      rows.push(`<div class="sep"></div><div class="hd">Boosts</div>`);
      for (const [id, l] of ch.boosts) {
        const b = boost(id)!;
        row(`${b.name} ${l}`, id === "haste" ? `+${hasteBonus(l)}` : id === "luck" ? `+${luckBonus(l)}` : `x${formatRate(boostRate(l))}`);
      }
      for (const id of ch.evolutions) row(`<span class="evo">${evolution(id).name}</span>`, "evolved");
    }
    const html = rows.join("");
    if (this.changed("skills", html)) this.wins.get("skills")!.body.innerHTML = `<div class="sk">${html}</div>`;
  }

  /** Tibia's battle window: creatures on screen, nearest first (or lowest health first, targeting the
   *  weakest). Click one to attack it. */
  private battle(g: Game) {
    const body = this.wins.get("battle")!.body;
    const p = g.player;
    const hw = g.viewW / 2 + 16, hh = g.viewH / 2 + 16;
    const near = (m: Monster) => Math.hypot(m.x - p.x, m.y - p.y);
    const list = g.monsters.filter((m) => !m.dead && Math.abs(m.x - p.x) < hw && Math.abs(m.y - p.y) < hh)
      .sort((a, b) => (g.targeting === "weakest" ? a.hp / a.maxHp - b.hp / b.maxHp : 0) || near(a) - near(b));
    const seen = new Set<number>();
    for (const m of list) {
      seen.add(m.id);
      let row = this.rows.get(m.id);
      if (!row) {
        row = this.battleRow(m);
        this.rows.set(m.id, row);
      }
      const frac = Math.max(0, m.hp / m.maxHp);
      const bar = row.querySelector<HTMLElement>(".hpb s")!;
      bar.style.width = pct(frac);
      bar.style.background = hpColor(frac);
      row.classList.toggle("target", m.id === g.targetId);
      row.classList.toggle("auto", m.id === g.targetId && !g.manualTarget);
      body.append(row); // appending in order sorts the rows
    }
    for (const [id, row] of this.rows) if (!seen.has(id)) { row.remove(); this.rows.delete(id); }
    if (list.length) this.battleEmpty.remove();
    else body.append(this.battleEmpty);
  }

  private battleRow(m: Monster) {
    const row = el("div", `brow${m.boss ? " boss" : ""}`);
    const anim = this.atlas.data.creatures[m.key];
    const icon = anim ? this.atlas.icon(anim.idle[2][0], 32) : el("canvas");
    const who = el("div", "who", `<b>${m.data.name}</b><div class="hpb"><s></s></div>`);
    row.append(icon, who);
    row.title = `Attack ${m.data.name}`;
    row.addEventListener("mousedown", (e) => { e.preventDefault(); this.actions.target(m.id); });
    row.addEventListener("contextmenu", (e) => e.preventDefault());
    return row;
  }

  /** Tibia's container window: every slot of the container, items first (newest in front), stack counts
   *  in the corner, and an up arrow when it's inside another one. */
  private backpack(g: Game) {
    const root = g.ch.backpack, box = this.shownBox()!;
    const worth = root.worth(), n = root.count();
    const sig = `${box === root}|${box.items.map((t) => `${t.id}:${t.n}:${t.inner?.items.length ?? ""}`).join()}|${worth}`;
    if (!this.changed("backpack", sig)) return;
    const title = (s: string) => s[0].toUpperCase() + s.slice(1);
    this.bpTitle.textContent = title(box.name);
    this.bpIcon.src = this.itemUrl(box.id);
    this.bpUp.hidden = box === root;
    const slots: string[] = [];
    for (let i = 0; i < box.cap; i++) {
      const t = box.items[i];
      if (!t) { slots.push(`<div class="slot"></div>`); continue; }
      const count = stackable(t.id) && t.n > 1 ? `<span class="count">${t.n}</span>` : "";
      // Containers say how full they are; everything else gets the item tooltip (and equips on a click).
      const tip = t.inner ? `title="${title(t.inner.name)} (${t.inner.items.length}/${t.inner.cap}): click to open"` : `data-item="${t.id}" data-n="${t.n}"`;
      const wearable = !t.inner && !!g.ch.slotFor(item(t.id)!);
      slots.push(`<div class="slot${t.inner ? " box" : ""}${wearable ? " wear" : ""}" data-i="${i}" ${tip}><img src="${this.itemUrl(t.id, t.n)}" alt="">${count}</div>`);
    }
    this.bpGrid.innerHTML = slots.join("");
    this.bpWorth.innerHTML = n ? `${fmt(n)} item${n === 1 ? "" : "s"}, worth <span class="gold">${fmt(worth)}</span> gold` : "Empty. Loot lands here.";
    this.bpSell.textContent = `Sell all · ${fmt(worth)} gold`;
    this.bpSell.disabled = !worth;
    this.bpSell.title = "Sell everything an NPC buys and throw away the junk (right-click an item to sell or throw away just that)";
    // The backpack in the equipment window.
    this.bpSlot.innerHTML = `<img src="${this.itemUrl(root.id)}" alt="">`;
    this.bpSlot.title = `${title(root.name)}: ${fmt(n)} items, worth ${fmt(worth)} gold. Click to open.`;
  }

  /** Everything you've picked this run (and the boosts you bought): spell grades, imbuements, charms, prey. */
  private upgrades(g: Game) {
    const ch = g.ch;
    const sec: string[] = [];
    const list = (title: string, rows: string[]) => { if (rows.length) sec.push(`<div class="up-h">${title}</div>${rows.join("")}`); };
    const row = (name: string, detail: string, tip = detail) => `<div class="up-r" title="${tip.replace(/"/g, "&quot;")}"><b>${name}</b><i>${detail}</i></div>`;
    list("Spells", [...ch.known].map((f) => SPELLS.find((s) => s.file === f)!).filter((s) => s.kind === "instant").map((s) => {
      const gr = ch.grades.get(s.file) ?? 0, max = spellGrades(s).grades.length;
      return row(`${s.name}${gr ? ` ${CHARM_TIERS[gr]}` : ""}`, gr ? describeGrade(ch.gradeBonus(s)) : `grade 0/${max}`, `${s.words}`);
    }));
    list(`Imbuements ${ch.slotsUsed}/${MAX_SLOTS}`, [...ch.imbuements].map(([id, t]) => row(`${TIERS[t - 1]} ${imbuement(id).name}`, imbuement(id).desc(imbuement(id).values[t - 1]))));
    list("Charms", [...ch.charms].map(([name, t]) => row(`${name} ${CHARM_TIERS[t]}`, describeCharm(name, t))));
    list(`Prey ${ch.prey.length}/${PREY_SLOTS}`, ch.prey.map((p) => row(`${MONSTERS[p.creature]?.name ?? p.creature} ${"★".repeat(p.stars)}`, describePrey(p))));
    list("Run bonuses", [...ch.runBonuses].map(([id, n]) => row(`${runBonus(id).name} +${n * RUN_BONUS_STEP}%`, `${runBonus(id).what}, this run only`)));
    list("Boosts", [...ch.boosts].map(([id, l]) => row(`${boost(id)!.name} ${l}`, boost(id)!.desc(l))));
    list("Evolutions", [...ch.evolutions].map((id) => row(evolution(id).name, evolution(id).desc)));
    const html = sec.join("") || `<div class="empty-note">Level up to pick spell grades, imbuements and prey; bestiary stages give charms.</div>`;
    if (this.changed("upgrades", html)) this.wins.get("upgrades")!.body.innerHTML = html;
  }

  /** Tibia's bestiary: every creature you've killed (over all runs), how far its stages are, and what you know
   *  about it: health and experience from 5 kills, resistances from 25, loot from 100. Click one to open it. */
  private bestiary(g: Game) {
    const body = this.wins.get("bestiary")!.body;
    const kills = Object.entries(g.killTotals).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
    const rows = kills.map(([key, total]) => {
      const m = MONSTERS[key];
      if (!m) return "";
      const run = g.bestiary.get(m.name) ?? 0, open = this.bestiaryOpen.has(key);
      const next = BESTIARY_STAGES.find((s) => run < s);
      const stage = BESTIARY_STAGES.filter((s) => run >= s).length;
      let details = "";
      if (open) {
        const facts: string[] = [];
        if (total >= 5) facts.push(`Health ${fmt(m.health)} · Experience ${fmt(m.experience)} · Speed ${m.speed} · Armor ${m.armor}`);
        else facts.push(`<i>Kill 5 to learn its health and experience.</i>`);
        if (total >= 25) {
          const el = Object.entries(m.elements).filter(([, v]) => v).map(([e, v]) => `<span class="${v! > 0 ? "res" : "weak"}">${e} ${v! > 0 ? "-" : "+"}${Math.abs(v!)}%</span>`);
          facts.push(el.length ? el.join(" ") : "No resistances or weaknesses.");
        } else facts.push(`<i>Kill 25 to learn its resistances.</i>`);
        if (total >= 100) facts.push(m.loot.slice().sort((a, b) => b.chance - a.chance).slice(0, 8).map((l) => `${item(l.id)?.name ?? l.id} ${(l.chance / 1000).toFixed(l.chance < 1000 ? 2 : 1)}%`).join(", "));
        else facts.push(`<i>Kill 100 to learn its loot.</i>`);
        details = `<div class="be-d">${facts.join("<br>")}</div>`;
      }
      return `<div class="be${open ? " open" : ""}" data-key="${key}"><img src="${this.creatureUrl(key)}" alt=""><div class="be-n"><b>${m.name}</b>`
        + `<i>${fmt(total)} kill${total === 1 ? "" : "s"} · this run ${run}${next ? `/${next}` : ""} ${"◆".repeat(stage)}${"◇".repeat(3 - stage)}</i></div></div>${details}`;
    });
    const html = rows.join("") || `<div class="empty-note">No creatures killed yet.</div>`;
    if (this.changed("bestiary", html)) body.innerHTML = html;
  }

  private creatureUrl(key: string) {
    return this.url(`c${key}`, () => {
      const anim = this.atlas.data.creatures[key];
      return anim ? this.atlas.icon(anim.idle[2][0], 32) : document.createElement("canvas");
    });
  }

  private supplies(g: Game) {
    const ch = g.ch;
    const sup = [...ch.supplies.entries()].filter(([id, n]) => n > 0 && (POTIONS[id] || SPELLS.some((s) => s.runeId === id) || !!item(id)?.ammotype || id === ch.thrown || id === 3147));
    const sig = `${sup.map(([id, n]) => `${id}:${n}`).join()}|${ch.equipment.ammo}|${[...ch.runesOff]}`;
    if (!this.changed("supplies", sig)) return;
    this.wins.get("supplies")!.body.innerHTML = `<div class="grid">${sup.map(([id, n]) => {
      const rune = SPELLS.some((s) => s.runeId === id), ammo = !!item(id)?.ammotype;
      const cls = rune && ch.runesOff.has(id) ? " off" : ammo && ch.equipment.ammo === id ? " inuse" : "";
      const spell = SPELLS.find((s) => s.runeId === id), conj = spell?.conjure && ch.conjurable().includes(spell)
        ? ` · right-click to conjure ${spell.conjure.count} (${spell.conjure.words}: ${spell.conjure.mana} mana and a blank rune)` : "";
      const hint = rune ? (ch.runesOff.has(id) ? "Auto-use off: click to turn it on" : "Click to stop auto-using it") + conj
        : ammo ? (ch.equipment.ammo === id ? "In use" : "Click to use it") : "";
      return `<div class="slot${rune || ammo ? " pick" : ""}${cls}" data-item="${id}" data-n="${n}" data-hint="${hint}"><img src="${this.itemUrl(id, n)}" alt=""><span class="count">${n}</span></div>`;
    }).join("")}</div>`;
  }

  /** Supplies window clicks: a rune toggles auto-use, arrows or bolts become your ammunition. */
  private pickSupply(id: number) {
    const g = this.g;
    if (!g) return;
    const ch = g.ch, it = item(id)!;
    if (SPELLS.some((s) => s.runeId === id)) {
      if (!ch.runesOff.delete(id)) ch.runesOff.add(id);
      this.layout.runesOff = [...ch.runesOff];
      this.save();
      this.status(ch.runesOff.has(id) ? `Auto-combat won't use ${it.name}s.` : `Auto-combat uses ${it.name}s.`);
    } else if (it.ammotype) {
      const fires = ch.weapon?.ammotype;
      if (fires && fires !== it.ammotype) { this.status(`Your ${ch.weapon!.name} fires ${fires}s.`); return; }
      ch.equipment.ammo = id;
      this.status(`Using ${it.name}s.`);
    } else return;
    this.sig.delete("supplies");
    this.supplies(g);
    this.equipment(g);
  }

  // ---------- hotbar ----------

  /** What the hotbar can hold right now: known spells, runes and potions you carry. */
  private hotEntries(g: Game): HotEntry[] {
    const ch = g.ch;
    const order = { attack: 0, healing: 1, support: 2 };
    const spells = SPELLS.filter((s) => s.kind === "instant" && ch.known.has(s.file)).sort((a, b) => order[a.group] - order[b.group]);
    const runes = ch.usableRunes().filter((s) => (ch.supplies.get(s.runeId!) ?? 0) > 0);
    const potions = [...ch.supplies.entries()].filter(([id, n]) => n > 0 && POTIONS[id]).map(([id]) => id);
    return [...spells.map((s) => ({ kind: "spell", s }) as HotEntry), ...runes.map((s) => ({ kind: "spell", s }) as HotEntry),
      ...potions.map((id) => ({ kind: "potion", id }) as HotEntry)];
  }

  private hotbar(g: Game) {
    // New things take the first free slot and keep it, like hotkeys you set once (an empty rune stays, greyed).
    const have = new Set(this.hot.filter(Boolean).map((e) => entryKey(e!)));
    for (const e of this.hotEntries(g)) {
      if (have.has(entryKey(e))) continue;
      const free = this.hot.indexOf(null);
      if (free < 0) break;
      this.hot[free] = e;
      have.add(entryKey(e));
    }
    const ch = g.ch;
    this.hot.forEach((e, i) => {
      const h = this.hotEls[i];
      if (!e) { h.img.hidden = true; h.count.textContent = ""; h.cd.style.background = ""; h.root.title = ""; return; }
      let src: string, count = "", usable: boolean, readyAt: number, total: number, title: string;
      if (e.kind === "spell") {
        const s = e.s;
        src = this.spellUrl(s);
        const own = g.spellReady.get(s.file) ?? 0, group = g.groupReady[s.group];
        readyAt = Math.max(own, group);
        total = (own >= group ? s.cooldown ?? 2000 : s.groupCooldown ?? 2000) / 1000;
        if (s.kind === "rune") {
          const n = ch.supplies.get(s.runeId!) ?? 0;
          count = String(n);
          usable = n > 0;
          title = `${s.name}: ${n} left`;
        } else {
          usable = ch.mana >= g.manaCost(s);
          title = `${s.name} (${s.words}), ${g.manaCost(s)} mana`;
        }
      } else {
        const n = ch.supplies.get(e.id) ?? 0;
        src = this.itemUrl(e.id);
        count = String(n);
        usable = n > 0;
        readyAt = g.potionReady;
        total = 1;
        title = `${item(e.id)?.name ?? "Potion"}: ${n} left`;
      }
      if (h.img.getAttribute("src") !== src) h.img.src = src;
      h.img.hidden = false;
      h.count.textContent = count;
      h.root.classList.toggle("off", !usable);
      const k = Math.min(1, Math.max(0, readyAt - g.time) / total);
      // A clock wipe: the dark part is the cooldown left.
      h.cd.style.background = k > 0 ? `conic-gradient(rgba(0, 0, 0, 0.7) ${k * 360}deg, transparent 0)` : "";
      h.root.title = `${HOTKEYS[i]}: ${title}`;
    });
  }

  /** Use a hotbar slot by hand: the auto-combat keeps going, this is on top. */
  use(i: number) {
    const g = this.g, e = this.hot[i], h = this.hotEls[i];
    if (!g || !e || !h) return;
    const err = e.kind === "spell" ? g.castByHand(e.s) : g.potionByHand(e.id);
    h.root.classList.remove("ok", "fail");
    void h.root.offsetWidth; // restart the animation
    h.root.classList.add(err ? "fail" : "ok");
    if (err) this.status(err);
  }

  // ---------- console ----------

  private consoleLines(g: Game) {
    const fresh = g.log.filter((l) => l.n > this.lastLog);
    if (!fresh.length) return;
    this.lastLog = fresh[fresh.length - 1].n;
    for (const l of fresh) {
      // Server Log has everything but the hit-by-hit combat lines, which get their own tab.
      const chans: Channel[] = l.channel === "combat" ? ["combat"] : l.channel === "loot" ? ["default", "loot"] : ["default"];
      for (const ch of chans) {
        const t = this.tabs.get(ch)!;
        const atBottom = t.lines.scrollTop + t.lines.clientHeight >= t.lines.scrollHeight - 4;
        const line = el("div");
        line.style.color = l.color;
        line.append(el("span", "ts", clock(l.t)), document.createTextNode(l.text));
        t.lines.append(line);
        while (t.lines.childElementCount > 300) t.lines.firstElementChild!.remove();
        if (atBottom) t.lines.scrollTop = t.lines.scrollHeight;
        if (ch !== this.tab) t.tab.classList.add("new");
      }
    }
  }

  // ---------- names and health bars over the canvas ----------

  private labelsLayer(g: Game, r: Renderer, dpr: number) {
    const { ox, oy, S, left, top, gw, gh } = r.view;
    const k = S / dpr; // world pixels to CSS pixels
    this.labels.style.setProperty("--bw", `${Math.round(27 * k)}px`);
    this.labels.style.setProperty("--fs", `${Math.max(10, Math.min(15, Math.round(5 * k)))}px`);
    const seen = new Set<number>();
    const place = (id: number, x: number, y: number, name: string, frac: number, mana?: number, target = false) => {
      const sx = (ox + x * S) / dpr, sy = (oy + y * S) / dpr;
      if (sx < left / dpr || sx > (left + gw) / dpr || sy < top / dpr || sy > (top + gh) / dpr) return;
      seen.add(id);
      let l = this.labelEls.get(id);
      if (!l) {
        const root = el("div", "lbl", `<b></b><i><s></s></i>${mana !== undefined ? "<i><s></s></i>" : ""}`);
        const bars = root.querySelectorAll("s");
        l = { root, name: root.querySelector("b")!, hp: bars[0] as HTMLElement, mana: bars[1] as HTMLElement | undefined, key: "" };
        if (l.mana) l.mana.style.background = "#3060e0";
        this.labels.append(root);
        this.labelEls.set(id, l);
      }
      frac = Math.max(0, Math.min(1, frac));
      const color = hpColor(frac);
      const key = `${name}|${color}|${target}`;
      if (l.key !== key) {
        l.key = key;
        l.name.textContent = name;
        l.name.style.color = color;
        l.hp.style.background = color;
        l.root.classList.toggle("target", target);
      }
      l.hp.style.width = pct(frac);
      if (l.mana && mana !== undefined) l.mana.style.width = pct(mana);
      l.root.style.transform = `translate(${Math.round(sx)}px, ${Math.round(sy)}px) translate(-50%, -100%)`;
    };
    for (const m of g.monsters) {
      if (m.dead) continue;
      place(m.id, m.x, m.y - (m.maxHp > 900 || m.boss ? 44 : 32), m.data.name, m.hp / m.maxHp, undefined, m.id === g.targetId);
    }
    place(-1, g.player.x, g.player.y - 32, g.vocation.name, g.ch.hp / g.ch.maxHp, g.ch.mana / g.ch.maxMana);
    for (const [id, l] of this.labelEls) if (!seen.has(id)) { l.root.remove(); this.labelEls.delete(id); }
  }
}
