import { stackPattern, type Atlas, type CreatureAnim } from "./atlas";
import { TILE, type Game, type LootDest } from "./game";
import { PRICES } from "./tibia/db";

/** Coins are worth their face value (the corpse marker shows the most valuable thing inside). */
const COIN_VALUE: Record<number, number> = { 3031: 1, 3035: 100, 3043: 10000 };
import { tileCenter } from "./movement";
import { hash } from "./world";

const FONT = "Verdana, sans-serif";
/** The Tibia client shows 15 x 11 tiles. */
export const VIEW_TILES_X = 15;
export const VIEW_TILES_Y = 11;

/** The world on a canvas; everything around it (windows, names, bars) is HTML (see hud.ts). */
export class Renderer {
  scale = 2;
  private icons = new Map<string, HTMLCanvasElement>();
  /** The world-to-canvas transform and the 15 x 11 game rectangle from the last frame, in canvas pixels. */
  view = { ox: 0, oy: 0, S: 2, left: 0, top: 0, gw: 0, gh: 0 };

  constructor(private ctx: CanvasRenderingContext2D, private atlas: Atlas) {}

  private creatureFrame(anim: CreatureAnim, dir: number, moving: boolean, dist: number, t: number): number {
    if (moving) {
      const w = anim.walk[dir];
      return w[Math.floor(dist / 4) % w.length];
    }
    const idle = anim.idle[dir];
    return idle[Math.floor(t * 5) % idle.length];
  }

  draw(g: Game) {
    const { ctx, atlas } = this;
    const W = ctx.canvas.width, H = ctx.canvas.height;
    // The Tibia client's game window: exactly 15 x 11 tiles, your tile in the middle, scaled to fit.
    const S = Math.min(W / (TILE * VIEW_TILES_X), H / (TILE * VIEW_TILES_Y));
    this.scale = S;
    const gw = Math.round(TILE * VIEW_TILES_X * S), gh = Math.round(TILE * VIEW_TILES_Y * S);
    const left = Math.round((W - gw) / 2), topY = Math.round((H - gh) / 2);
    g.viewW = TILE * VIEW_TILES_X;
    g.viewH = TILE * VIEW_TILES_Y;
    const camX = g.player.x, camY = g.player.y;
    const ox = Math.round(left + gw / 2 - camX * S), oy = Math.round(topY + gh / 2 - camY * S);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.beginPath();
    ctx.rect(left, topY, gw, gh);
    ctx.clip();
    ctx.setTransform(S, 0, 0, S, ox, oy);

    const tx0 = Math.floor((camX - gw / S / 2) / TILE) - 1, tx1 = Math.ceil((camX + gw / S / 2) / TILE) + 2;
    const ty0 = Math.floor((camY - gh / S / 2) / TILE) - 1, ty1 = Math.ceil((camY + gh / S / 2) / TILE) + 2;

    const tall: { x: number; y: number; frame: number }[] = [];
    for (let ty = ty0; ty <= ty1; ty++)
      for (let tx = tx0; tx <= tx1; tx++) {
        const cx = tileCenter(tx), cy = tileCenter(ty);
        const gf = g.world.groundFrame(tx, ty);
        if (gf >= 0) atlas.draw(ctx, gf, cx, cy);
        for (const b of g.world.bordersAt(tx, ty)) atlas.draw(ctx, b, cx, cy);
        const d = g.world.decorAt(tx, ty);
        if (!d) continue;
        if (d.tall) tall.push({ x: cx, y: cy, frame: d.frame });
        else atlas.draw(ctx, d.frame, cx, cy);
      }

    // Corpses lie on the ground under everything that stands.
    for (const c of g.corpses) {
      const anim = atlas.data.items[c.item];
      if (!anim) continue;
      ctx.globalAlpha = Math.min(1, (c.until - g.time) / 5);
      atlas.draw(ctx, anim.frames[0], tileCenter(c.tx), tileCenter(c.ty));
      ctx.globalAlpha = 1;
    }

    // Magic fields burn on the ground, animated (only the ones on screen).
    for (const f of g.fields.values()) {
      if (f.tx < tx0 || f.tx > tx1 || f.ty < ty0 || f.ty > ty1) continue;
      const anim = atlas.data.items[f.id];
      if (anim) atlas.draw(ctx, atlas.animFrame(anim, g.time + f.tx * 0.37 + f.ty * 0.61), tileCenter(f.tx), tileCenter(f.ty));
    }

    // Boss treasure chests.
    const chest = atlas.data.items[2478];
    if (chest) for (const c of g.chests) atlas.draw(ctx, chest.frames[0], tileCenter(c.tx), tileCenter(c.ty));

    // Tibia's red target square.
    const target = g.monsters.find((m) => m.id === g.targetId);
    if (target) {
      ctx.strokeStyle = "#ff2020";
      ctx.lineWidth = 1;
      ctx.strokeRect(target.x - 15.5, target.y - 15.5, 31, 31);
    }

    // Y-sorted: trees, creatures, the player.
    type Item = { y: number; kind: 0 | 1 | 2; i: number };
    const list: Item[] = [];
    tall.forEach((d, i) => list.push({ y: d.y, kind: 0, i }));
    g.monsters.forEach((m, i) => list.push({ y: m.y, kind: 1, i }));
    list.push({ y: g.player.y, kind: 2, i: 0 });
    list.sort((a, b) => a.y - b.y || a.kind - b.kind);
    const p = g.player;
    for (const it of list) {
      if (it.kind === 0) atlas.draw(ctx, tall[it.i].frame, tall[it.i].x, tall[it.i].y);
      else if (it.kind === 1) {
        const m = g.monsters[it.i];
        const anim = atlas.data.creatures[m.key];
        if (anim) atlas.draw(ctx, this.creatureFrame(anim, m.dir, m.stepDur > 0, m.dist, g.time), m.x, m.y);
      } else {
        if (p.hurt > 0) ctx.globalAlpha = 0.6;
        atlas.draw(ctx, this.creatureFrame(atlas.data.creatures[g.vocation.sprite], p.dir, p.moving, p.dist, g.time), p.x, p.y);
        ctx.globalAlpha = 1;
      }
    }

    // Unlooted corpses: their best item floats above them, bobbing in a soft glow, over everything that stands.
    for (const c of g.corpses) {
      if (c.looted || !c.loot.length) continue;
      const worth = (l: { id: number; n: number }) => (COIN_VALUE[l.id] ?? PRICES[l.id]?.sell ?? 0) * l.n;
      const best = c.loot.reduce((a, b) => (worth(b) > worth(a) ? b : a));
      const anim = atlas.data.items[best.id];
      if (!anim) continue;
      const frame = anim.stack ? anim.stack[stackPattern(best.n)] : anim.frames[0];
      const x = tileCenter(c.tx), y = tileCenter(c.ty) - 22 + Math.sin(g.time * 3 + c.tx * 1.7 + c.ty) * 1.5;
      ctx.globalAlpha = Math.min(1, (c.until - g.time) / 5);
      ctx.fillStyle = "rgba(255, 220, 120, 0.28)";
      ctx.beginPath();
      ctx.arc(x, y, 9, 0, Math.PI * 2);
      ctx.fill();
      const [sx, sy, w, h] = atlas.data.frames[frame];
      const k = Math.min(1, 16 / Math.max(w, h));
      ctx.drawImage(atlas.img, sx, sy, w, h, Math.round(x - (w * k) / 2), Math.round(y - (h * k) / 2), w * k, h * k);
      ctx.globalAlpha = 1;
    }

    for (const m of g.missiles) {
      const k = m.t / m.dur;
      const f = atlas.missileFrame(m.id, m.tx - m.fx, m.ty - m.fy);
      if (f !== undefined) atlas.draw(ctx, f, m.fx + (m.tx - m.fx) * k, m.fy + (m.ty - m.fy) * k);
    }
    for (const e of g.effects) {
      const anim = atlas.data.effects[e.id];
      if (anim) atlas.draw(ctx, atlas.animFrame(anim, e.t, false), e.x, e.y);
    }

    this.drawLight(g, ox, oy, S, W, H);

    // ---- screen space: floating text (names and bars are HTML, see hud.ts) ----
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const scr = (x: number, y: number) => [ox + x * S, oy + y * S] as const;
    const fs = Math.max(10, Math.round(5.5 * S));
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.lineJoin = "round";
    // "+N gold" above you while loot keeps coming in.
    const since = g.time - g.goldGainedAt;
    if (g.goldGained > 0 && since < 1.5) {
      const [sx, sy] = scr(p.x, p.y - 70 - since * 12);
      ctx.globalAlpha = Math.min(1, (1.5 - since) * 2);
      this.outlined(`+${g.goldGained.toLocaleString("en-US")} gold`, sx, sy, "#ffd34d", `bold ${Math.round(fs * (1.3 + Math.max(0, 0.3 - since)))}px ${FONT}`, S);
      ctx.globalAlpha = 1;
    }
    for (const t of g.texts) {
      const [sx, sy] = scr(t.x, t.y);
      ctx.globalAlpha = Math.min(1, (t.dur - t.t) * 3);
      this.outlined(t.text, sx, sy, t.color, `bold ${fs}px ${FONT}`, S);
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    this.view = { ox, oy, S, left, top: topY, gw, gh };
  }

  /** Tibia's light: the world gets darker with the zone (Zone.ambient), and every light source cuts a soft
   *  circle out of the dark, its radius the brightness in tiles, tinted with its color: you (a light spell or
   *  something glowing you wear), creatures, fields, effects and missiles that glow in the client's data. */
  private drawLight(g: Game, ox: number, oy: number, S: number, W: number, H: number) {
    const dark = Math.min(0.9, (1 - g.ambient / 255) * 1.05);
    if (dark < 0.02) return;
    const L = this.atlas.data.light;
    const glow = (kind: "creatures" | "effects" | "missiles" | "items", key: string | number) => L?.[kind]?.[String(key)];
    const sources: [number, number, number, number][] = []; // world x, y, brightness, color
    const p = g.player;
    const own = g.playerLight((id) => glow("items", id)?.[0] ?? 0);
    sources.push([p.x, p.y, Math.max(1.5, own), 215]); // you always see a little around you
    for (const m of g.monsters) { const l = !m.dead && glow("creatures", m.key); if (l) sources.push([m.x, m.y, l[0], l[1]]); }
    for (const f of g.fields.values()) { const l = glow("items", f.id); if (l) sources.push([tileCenter(f.tx), tileCenter(f.ty), l[0], l[1]]); }
    for (const e of g.effects) { const l = glow("effects", e.id); if (l) sources.push([e.x, e.y, l[0] * (1 - e.t / e.dur), l[1]]); }
    for (const m of g.missiles) { const l = glow("missiles", m.id); if (l) { const k = m.t / m.dur; sources.push([m.fx + (m.tx - m.fx) * k, m.fy + (m.ty - m.fy) * k, l[0], l[1]]); } }
    const c = (this.lightCanvas ??= document.createElement("canvas"));
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    const lc = c.getContext("2d")!;
    lc.globalCompositeOperation = "source-over";
    lc.clearRect(0, 0, W, H);
    lc.fillStyle = `rgba(0, 0, 0, ${dark})`;
    lc.fillRect(0, 0, W, H);
    lc.globalCompositeOperation = "destination-out";
    for (const [x, y, b] of sources) {
      const sx = ox + x * S, sy = oy + y * S, r = (b + 0.5) * TILE * S;
      const grad = lc.createRadialGradient(sx, sy, 0, sx, sy, r);
      grad.addColorStop(0, "rgba(0,0,0,1)");
      grad.addColorStop(0.6, "rgba(0,0,0,0.75)");
      grad.addColorStop(1, "rgba(0,0,0,0)");
      lc.fillStyle = grad;
      lc.fillRect(sx - r, sy - r, r * 2, r * 2);
    }
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(c, 0, 0);
    // A faint tint in each light's color (Tibia's 6x6x6 palette: color = 36 r + 6 g + b).
    ctx.globalCompositeOperation = "lighter";
    for (const [x, y, b, col] of sources) {
      if (col === 215) continue; // plain warm light: no tint
      const sx = ox + x * S, sy = oy + y * S, r = (b + 0.5) * TILE * S;
      const rgb = `${Math.floor(col / 36) * 51}, ${(Math.floor(col / 6) % 6) * 51}, ${(col % 6) * 51}`;
      const grad = ctx.createRadialGradient(sx, sy, 0, sx, sy, r);
      grad.addColorStop(0, `rgba(${rgb}, ${0.22 * dark})`);
      grad.addColorStop(1, `rgba(${rgb}, 0)`);
      ctx.fillStyle = grad;
      ctx.fillRect(sx - r, sy - r, r * 2, r * 2);
    }
    ctx.globalCompositeOperation = "source-over";
  }
  private lightCanvas?: HTMLCanvasElement;

  /** The monster under a screen point (for right-click targeting), if any. */
  monsterAtScreen(g: Game, sx: number, sy: number) {
    const { ox, oy, S, left, top, gw, gh } = this.view;
    if (sx < left || sx > left + gw || sy < top || sy > top + gh) return undefined;
    const wx = (sx - ox) / S, wy = (sy - oy) / S;
    // Sprites stand up and to the left of their tile; accept a click on the body too.
    return g.monsters.filter((m) => !m.dead && Math.abs(wx - m.x) < 18 && wy > m.y - 40 && wy < m.y + 16)
      .sort((a, b) => Math.hypot(a.x - wx, a.y - wy) - Math.hypot(b.x - wx, b.y - wy))[0];
  }

  /** Loot hops out of the corpse, then flies across the window into the side panel: gold to the gold
   *  counter, items to the backpack, potions to supplies. Drawn on a full-window canvas; `at` is the game
   *  canvas's offset in that canvas, `to` the targets, all in its pixels. */
  drawLootFx(g: Game, fx: CanvasRenderingContext2D, at: [number, number], to: Record<LootDest, [number, number]>) {
    fx.setTransform(1, 0, 0, 1, 0, 0);
    fx.clearRect(0, 0, fx.canvas.width, fx.canvas.height);
    fx.imageSmoothingEnabled = false;
    const { ox, oy, S } = this.view;
    for (const f of g.lootFx) {
      const t = f.t - f.delay;
      if (t < 0) continue;
      const startX = at[0] + ox + f.x * S, startY = at[1] + oy + f.y * S;
      let x: number, y: number, size = 24 * S * 0.6;
      if (t < 0.3) {
        // hop: up and a little sideways
        const k = t / 0.3;
        x = startX + ((f.id % 7) - 3) * 4 * S * k;
        y = startY - Math.sin(k * Math.PI) * 18 * S - k * 6 * S;
      } else {
        const k = Math.min(1, (t - 0.3) / 0.6), e = k * k;
        const fromX = startX + ((f.id % 7) - 3) * 4 * S, fromY = startY - 6 * S;
        const [toX, toY] = to[f.to];
        x = fromX + (toX - fromX) * e;
        y = fromY + (toY - fromY) * e - Math.sin(k * Math.PI) * 30 * S;
        size *= 1 - 0.5 * k;
      }
      if (f.rare) {
        fx.fillStyle = "rgba(208, 128, 255, 0.35)";
        fx.beginPath();
        fx.arc(x, y, size * 0.8, 0, Math.PI * 2);
        fx.fill();
      }
      const pat = stackPattern(f.n);
      fx.drawImage(this.icon(`i${f.id}:${pat}`, () => this.atlas.itemIcon(f.id, 32, 1, f.n)), x - size / 2, y - size / 2, size, size);
    }
  }

  private outlined(text: string, x: number, y: number, color: string, font: string, S: number) {
    const { ctx } = this;
    ctx.font = font;
    ctx.lineWidth = Math.max(2, S * 1.2);
    ctx.strokeStyle = "#000";
    ctx.strokeText(text, x, y);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  }

  private icon(k: string, make: () => HTMLCanvasElement) {
    let c = this.icons.get(k);
    if (!c) this.icons.set(k, (c = make()));
    return c;
  }
}
