import "./style.css";
import { Atlas } from "./atlas";
import { ROOKIE } from "./data";
import { applyUnlocks } from "./unlocks";
import { loadSave, writeSave } from "./meta";
import { autoCombat } from "./autocast";
import { Game, type LootDest } from "./game";
import { HOTKEYS, HOTKEYS_ALT, Hud } from "./hud";
import { Renderer } from "./render";
import { installTooltips } from "./tooltip";
import { showMissingAssets, UI } from "./ui";
import { World } from "./world";
import { imbuement, TIERS } from "./tibia/imbuements";
import { boost } from "./upgrades";

const imbuementName = (g: Game, id: string) => `${TIERS[(g.ch.imbuements.get(id) ?? 1) - 1]} ${imbuement(id).name}`;

const canvas = document.getElementById("game") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const fxCanvas = document.getElementById("fx") as HTMLCanvasElement;
const fx = fxCanvas.getContext("2d")!;

const keys = new Set<string>();
let game: Game | null = null;
let paused = false;

async function boot() {
  const overlay = document.getElementById("overlay")!;
  let atlas: Atlas;
  try {
    atlas = await Atlas.load();
  } catch {
    showMissingAssets(overlay);
    return;
  }
  const ui = new UI(overlay, atlas);
  installTooltips();
  const renderer = new Renderer(ctx, atlas);
  const effectDur = (id: number) => (atlas.data.effects[id] ? atlas.effectDuration(id) : 0);
  const world = new World(atlas.data.decor);
  if (import.meta.env.DEV) {
    // Balance testing from the console: run whole games without rendering.
    import("./sim").then((sim) => {
      const keep: { g?: Game } = {};
      (window as unknown as { sim: unknown }).sim = { keep, run: (voc: number, seconds?: number) => sim.run(world, effectDur, voc, seconds, keep) };
    });
  }

  // The canvas fills the game view (what the side columns, hotbar and console leave); loot flies on a
  // second canvas over the whole window, so it can reach the side panel.
  let dpr = 1;
  const resize = () => {
    dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(canvas.clientWidth * dpr));
    canvas.height = Math.max(1, Math.round(canvas.clientHeight * dpr));
    fxCanvas.width = Math.round(innerWidth * dpr);
    fxCanvas.height = Math.round(innerHeight * dpr);
  };
  new ResizeObserver(resize).observe(canvas);
  addEventListener("resize", resize);
  resize();
  const hud = new Hud(atlas, {
    target: (id) => game?.setTarget(game.monsters.find((m) => m.id === id)),
    shop: () => togglePause(),
  });

  // A static scene behind the title screen.
  let backdrop = new Game(ROOKIE, world, effectDur);

  const showTitle = () => {
    game = null;
    paused = false;
    backdrop = new Game(ROOKIE, world, effectDur);
    hud.bind(null);
    ui.title(loadSave(), start);
  };

  /** Start a run: always in Rookgaard, with the unlocked starting gear, gold, potions, rerolls and boosts. */
  const start = () => {
    ui.close();
    const save = loadSave();
    const g = new Game(ROOKIE, world, effectDur);
    applyUnlocks(g, save);
    save.blessings = 0;
    save.runs++;
    writeSave(save);
    game = g;
    hud.bind(g, save.souls);
    paused = false;
    if (import.meta.env.DEV) (window as unknown as { game: Game }).game = game;
  };

  /** End of a run: the souls earned are banked (all of them, even on death). */
  const banked = new WeakMap<Game, number>(); // souls of a run already in the bank
  const bankRun = (g: Game): number => {
    const save = loadSave();
    save.souls += g.souls - (banked.get(g) ?? 0); // only what isn't banked yet (a page kept in the back/forward cache)
    banked.set(g, g.souls);
    save.zones = [...g.discovered];
    save.kills = { ...g.killTotals };
    save.maxLevel = Math.max(save.maxLevel ?? 0, g.ch.level);
    const b = save.best;
    if (!b || g.deepest > b.zone || (g.deepest === b.zone && g.ch.level > b.level)) {
      save.best = { zone: g.deepest, level: g.ch.level, kills: g.kills };
    }
    writeSave(save);
    return g.souls;
  };

  // Reloading or closing the page mid-run banks it, like quitting the run.
  addEventListener("pagehide", () => {
    if (game && !game.over) bankRun(game);
  });

  const togglePause = () => {
    if (!game || game.over) return;
    if (paused && ui.open) { ui.close(); paused = false; return; }
    if (ui.open) return; // a level-up choice is pending
    paused = true;
    ui.pause(game, () => { ui.close(); paused = false; }, () => { bankRun(game!); showTitle(); });
  };

  const handleEvents = (g: Game) => {
    if (ui.open) return;
    const ev = g.events.shift();
    if (!ev) return;
    switch (ev.type) {
      case "levelup": {
        if (g.pendingChoices <= 0) return;
        const choices = g.ch.rollChoices();
        if (!choices.length) { g.pendingChoices = 0; return; }
        paused = true;
        ui.levelUp(g, choices, (c) => {
          g.ch.applyChoice(c);
          g.msg(c.kind === "spell" ? `You learned ${c.spell.name} (${c.spell.words}).`
            : c.kind === "imbue" ? `Your equipment is imbued: ${imbuementName(g, c.id)}.`
            : c.kind === "boost" ? `${boost(c.id)!.name} is now level ${g.ch.boostLevel(c.id)}.`
            : c.kind === "train" ? "You finished a training session." : "You received a backpack of potions.", "#80c0ff");
          g.pendingChoices--;
          ui.close();
          paused = false;
          if (g.pendingChoices > 0) g.events.unshift({ type: "levelup" });
        });
        break;
      }
      case "vocation":
        paused = true;
        ui.chooseVocation((v) => {
          g.ch.setVocation(v);
          g.vocation = v;
          g.msg(`You are now a ${v.name.toLowerCase()}!`, "#ffd34d");
          g.addEffect(11, g.player.x, g.player.y);
          ui.close();
          paused = false;
        });
        break;
      case "chest":
        paused = true;
        ui.chest(g, ev.result, () => { ui.close(); paused = false; });
        break;
      case "dead":
        paused = true;
        ui.end(g, bankRun(g), showTitle);
        break;
    }
  };

  // ---------- input ----------
  // Right-click (or click) a creature in the game view to attack it, like Tibia.
  const toCanvas = (e: MouseEvent) => {
    const r = canvas.getBoundingClientRect();
    return [((e.clientX - r.left) * canvas.width) / r.width, ((e.clientY - r.top) * canvas.height) / r.height] as const;
  };
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  canvas.addEventListener("mousedown", (e) => {
    if (!game || ui.open) return;
    const [x, y] = toCanvas(e);
    const m = renderer.monsterAtScreen(game, x, y);
    if (m || e.button === 2) game.setTarget(m);
  });

  addEventListener("keydown", (e) => {
    keys.add(e.code);
    if (e.code === "Escape" || e.code === "KeyP") togglePause();
    if (e.code === "KeyC" && game && !ui.open) hud.setChase(!hud.chase);
    if (e.code === "KeyT" && game && !ui.open) hud.setTargeting(hud.targeting === "closest" ? "weakest" : "closest");
    // Hotbar: F1-F12, or the number row.
    const hk = Math.max(HOTKEYS.indexOf(e.code), HOTKEYS_ALT.indexOf(e.code));
    if (hk >= 0 && game && !ui.open && !paused) {
      e.preventDefault();
      if (!e.repeat) hud.use(hk);
      return;
    }
    if (e.code.startsWith("F") && /^F\d+$/.test(e.code) && game) e.preventDefault();
    if (ui.open) {
      if (e.code === "ArrowLeft" || e.code === "ArrowUp" || e.code === "KeyA" || e.code === "KeyW") ui.nav(-1);
      if (e.code === "ArrowRight" || e.code === "ArrowDown" || e.code === "KeyD" || e.code === "KeyS") ui.nav(1);
      if (e.code === "Enter" || e.code === "Space") { e.preventDefault(); ui.activate(); }
      const n = Number(e.key);
      if (n >= 1 && n <= 9) ui.pick(n - 1);
    }
  });
  addEventListener("keyup", (e) => keys.delete(e.code));
  addEventListener("blur", () => keys.clear());

  const padPrev = new Map<number, boolean>();
  const padEdge = (pad: Gamepad, i: number) => {
    const down = !!pad.buttons[i]?.pressed;
    const was = padPrev.get(i) ?? false;
    padPrev.set(i, down);
    return down && !was;
  };
  let stickLatch = false;

  function readInput(): [number, number] {
    let x = 0, y = 0;
    if (keys.has("KeyA") || keys.has("ArrowLeft")) x -= 1;
    if (keys.has("KeyD") || keys.has("ArrowRight")) x += 1;
    if (keys.has("KeyW") || keys.has("ArrowUp")) y -= 1;
    if (keys.has("KeyS") || keys.has("ArrowDown")) y += 1;
    if (x || y) { const l = Math.hypot(x, y); x /= l; y /= l; }

    const pad = [...(navigator.getGamepads?.() ?? [])].find((p) => p && p.connected);
    if (pad) {
      let ax = pad.axes[0] ?? 0, ay = pad.axes[1] ?? 0;
      if (pad.buttons[14]?.pressed) ax = -1;
      if (pad.buttons[15]?.pressed) ax = 1;
      if (pad.buttons[12]?.pressed) ay = -1;
      if (pad.buttons[13]?.pressed) ay = 1;
      if (Math.hypot(ax, ay) > 0.2) { x = ax; y = ay; }
      if (padEdge(pad, 9)) togglePause();
      if (ui.open) {
        if (padEdge(pad, 0)) ui.activate();
        if (padEdge(pad, 1) && paused && game && !game.over) togglePause();
        const mag = Math.max(Math.abs(ax), Math.abs(ay));
        if (mag > 0.6 && !stickLatch) { ui.nav((Math.abs(ax) > Math.abs(ay) ? ax : ay) > 0 ? 1 : -1); stickLatch = true; }
        if (mag < 0.3) stickLatch = false;
      }
    }
    return [x, y];
  }

  // ---------- loop ----------
  let last = performance.now();
  const frame = (now: number) => {
    const dt = Math.min(1 / 20, (now - last) / 1000);
    last = now;
    const [mx, my] = readInput();
    if (game) {
      if (!paused) {
        game.update(dt, mx, my);
        autoCombat(game);
      }
      handleEvents(game);
      renderer.draw(game);
      hud.update(game, renderer, dpr, dt);
      const r = canvas.getBoundingClientRect(), t = hud.lootTargets();
      for (const k in t) t[k as LootDest] = [t[k as LootDest][0] * dpr, t[k as LootDest][1] * dpr];
      renderer.drawLootFx(game, fx, [r.left * dpr, r.top * dpr], t);
    } else {
      backdrop.time += dt;
      renderer.draw(backdrop);
      fx.clearRect(0, 0, fxCanvas.width, fxCanvas.height);
    }
    ui.tick(now / 1000);
    requestAnimationFrame(frame);
  };
  showTitle();
  requestAnimationFrame(frame);
}

boot();
