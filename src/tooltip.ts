// Item tooltips: hover anything with data-item="id" (and data-n="count") in the HUD or a menu to see what it
// is, its stats, what it needs, how it compares with what you wear, and what NPCs pay for it.
import type { Character } from "./character";
import { canWear, item, POTIONS, PRICES, SPELLS, wornItem, type ItemData } from "./tibia/db";

let who: Character | null = null;
/** The character to check requirements and compare against (null on the title screen). */
export function tooltipCharacter(ch: Character | null) { who = ch; }

const COIN_VALUE: Record<number, number> = { 3031: 1, 3035: 100, 3043: 10000 };
const ELEMENTS: Record<string, string> = { fire: "fire", ice: "ice", poison: "earth", earth: "earth", energy: "energy", holy: "holy", death: "death", physical: "physical", lifedrain: "life drain", manadrain: "mana drain", drown: "drowning" };
const SLOT_NAMES: Record<string, string> = { head: "Helmet", necklace: "Amulet", armor: "Armor", legs: "Legs", feet: "Boots", ring: "Ring", shield: "Shield", ammo: "Ammunition" };
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

/** What kind of thing it is: "Sword (two-handed)", "Bow, shoots arrows", "Spear, thrown"... */
function kind(it: ItemData): string {
  const wt = it.weapontype;
  const hands = it.slottype === "two-handed" ? " (two-handed)" : "";
  if (wt === "distance") return `${it.ammotype === "bolt" ? "Crossbow" : "Bow"}${hands}, shoots ${it.ammotype}s`;
  if (wt === "missile") return "Thrown weapon";
  if (wt === "wand") return it.name.includes("rod") ? "Rod" : "Wand";
  if (wt === "spellbook") return "Spellbook";
  if (wt === "ammo" || wt === "ammunition") return `Ammunition (${it.ammotype}s)`;
  if (wt && ["sword", "axe", "club"].includes(wt)) return `${cap(wt)}${hands}`;
  if (it.containersize) return `Container (${it.containersize} slots)`;
  return SLOT_NAMES[it.slot ?? ""] ?? "";
}

/** The numbers that matter, as [label, value] pairs. */
function stats(id: number): [string, number, string?][] {
  const w = wornItem(id) ?? item(id)!;
  const out: [string, number, string?][] = [];
  const elem = ["fire", "ice", "earth", "energy"].map((e) => [e, Number(w[`element${e}`] ?? 0)] as const).filter(([, v]) => v);
  if (w.attack) out.push(["Attack", w.attack, elem.map(([e, v]) => ` + ${v} ${e}`).join("")]);
  if (w.fromdamage) out.push(["Damage", w.todamage ?? 0, ` (${w.fromdamage}-${w.todamage} ${w.wandtype ?? ""})`]);
  if (w.defense) out.push(["Defense", w.defense + (w.extradef ?? 0), w.extradef ? ` (${w.defense} ${signed(w.extradef)})` : ""]);
  if (w.armor) out.push(["Armor", w.armor]);
  if (w.range) out.push(["Range", w.range]);
  if (w.maxhitchance || w.hitchance) out.push(["Hit chance", Number(w.maxhitchance ?? w.hitchance), "%"]);
  if (w.breakchance) out.push(["Breaks", Number(w.breakchance), "% of throws"]);
  if (w.mana && w.weapontype === "wand") out.push(["Mana per shot", w.mana]);
  if (w.magiclevelpoints) out.push(["Magic level", w.magiclevelpoints]);
  for (const [k, label] of [["skillsword", "Sword"], ["skillaxe", "Axe"], ["skillclub", "Club"], ["skilldist", "Distance"], ["skillshield", "Shielding"], ["skillfist", "Fist"]]) {
    if (w[k]) out.push([`${label} fighting`, Number(w[k])]);
  }
  if (w.speed) out.push(["Speed", Number(w.speed)]);
  for (const k of Object.keys(w)) {
    if (!k.startsWith("absorbpercent") || !w[k]) continue;
    const e = k.slice("absorbpercent".length);
    out.push([`Protection ${ELEMENTS[e] ?? e}`, Number(w[k]), "%"]);
  }
  if (w.healthticks) out.push(["Regeneration", w.healthgain ?? 0, ` hp / ${(w.healthticks / 1000).toFixed(0)} s`]);
  if (w.manaticks) out.push(["Mana regeneration", w.managain ?? 0, ` / ${(w.manaticks / 1000).toFixed(0)} s`]);
  return out;
}

/** The tooltip, as HTML. */
export function describeItem(id: number, n = 1): string {
  const it = item(id);
  if (!it) return "";
  const ch = who;
  const rows: string[] = [];
  rows.push(`<b>${n > 1 ? `${fmt(n)} ` : ""}${cap(it.name)}${n > 1 && !it.name.endsWith("s") ? "s" : ""}</b>`);
  const k = kind(it);
  if (k) rows.push(`<i>${k}</i>`);
  const st = stats(id);
  // Compared with what you wear in that slot.
  const slot = ch?.slotFor(it);
  const cur = slot && ch?.equipment[slot] !== id ? ch?.equipment[slot] : undefined;
  const curStats = new Map(cur ? stats(cur).map(([l, v]) => [l, v]) : []);
  for (const [label, v, extra] of st) {
    const diff = cur ? v - (curStats.get(label) ?? 0) : 0;
    const d = diff ? ` <span class="${diff > 0 ? "up" : "down"}">(${signed(diff)})</span>` : "";
    // Bonuses read as "+3"; plain stats as "3".
    const bonus = label.startsWith("Protection") || label.endsWith("fighting") || label === "Magic level" || label === "Speed";
    rows.push(`${label}: ${bonus ? signed(v) : v}${extra ?? ""}${d}`);
  }
  if (cur) for (const [label, v] of curStats) if (!st.some(([l]) => l === label)) rows.push(`${label}: - <span class="down">(-${v})</span>`);
  if (cur) rows.push(`<small>compared with your ${item(cur)!.name}</small>`);
  const pot = POTIONS[id];
  if (pot) {
    if (pot.health) rows.push(`Heals ${pot.health[0]}-${pot.health[1]} hit points`);
    if (pot.mana) rows.push(`Restores ${pot.mana[0]}-${pot.mana[1]} mana`);
  }
  const rune = SPELLS.find((s) => s.runeId === id);
  if (rune) rows.push(`${rune.group === "healing" ? "Heals" : `${cap(rune.element ?? "")} damage`}${rune.needTarget ? " on a target" : " in an area"}`);
  // Requirements, red when you don't meet them.
  const req: string[] = [];
  const lvl = rune?.level ?? pot?.level ?? it.level;
  if (lvl) req.push(`<span class="${ch && ch.level < lvl ? "bad" : ""}">level ${lvl}</span>`);
  if (rune?.magicLevel) req.push(`<span class="${ch && ch.ml < rune.magicLevel ? "bad" : ""}">magic level ${rune.magicLevel}</span>`);
  if (typeof it.vocation === "string" || pot?.voc) {
    const vocs = pot?.voc ?? [...new Set(String(it.vocation).toLowerCase().split(/[;,]\s*/).map((v) => v.replace(/true|master |elder |royal |elite /g, "").trim()).filter(Boolean))];
    const ok = !ch || (pot ? !pot.voc || pot.voc.includes(ch.voc.id) : canWear({ ...it, level: 0 }, ch.voc.id, 9999));
    req.push(`<span class="${ok ? "" : "bad"}">${vocs.map(cap).join(" or ")}</span>`);
  }
  if (req.length) rows.push(`Needs ${req.join(", ")}`);
  const price = COIN_VALUE[id] ?? PRICES[id]?.sell ?? 0;
  if (price) rows.push(`<span class="gold">${COIN_VALUE[id] ? "Worth" : "NPCs pay"} ${fmt(price * n)} gold${n > 1 ? ` (${fmt(price)} each)` : ""}</span>`);
  return rows.join("<br>");
}

/** One floating tooltip for the whole page, following the mouse over [data-item] elements. */
export function installTooltips() {
  const tip = document.createElement("div");
  tip.id = "tip";
  tip.hidden = true;
  document.body.append(tip);
  let over: HTMLElement | null = null;
  const place = (e: MouseEvent) => {
    const r = tip.getBoundingClientRect();
    let x = e.clientX + 14, y = e.clientY + 16;
    if (x + r.width > innerWidth - 4) x = e.clientX - r.width - 10;
    if (y + r.height > innerHeight - 4) y = innerHeight - r.height - 4;
    tip.style.transform = `translate(${Math.max(4, x)}px, ${Math.max(4, y)}px)`;
  };
  addEventListener("mouseover", (e) => {
    const el = (e.target as HTMLElement).closest?.<HTMLElement>("[data-item]") ?? null;
    if (el === over) return;
    over = el;
    if (!el) { tip.hidden = true; return; }
    tip.innerHTML = describeItem(Number(el.dataset.item), Number(el.dataset.n ?? 1));
    tip.hidden = !tip.innerHTML;
    place(e);
  });
  addEventListener("mousemove", (e) => { if (over) place(e); });
  // Contents can change under the mouse (an item equipped from the backpack): refresh or hide.
  addEventListener("click", () => setTimeout(() => {
    if (over && !over.isConnected) { over = null; tip.hidden = true; }
    else if (over) tip.innerHTML = describeItem(Number(over.dataset.item), Number(over.dataset.n ?? 1));
  }));
}
