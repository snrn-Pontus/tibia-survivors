// Tibia's walking rules, as implemented by the Canary server (opentibiabr/canary, creature.cpp/.hpp)
// and the OTClient (Creature::getStepDuration).

export const GROUND_SPEED_GRASS = 150; // from the grass appearances' "bank.waypoints" flag
export const SERVER_BEAT = 50; // ms; step times are rounded up to whole server beats
export const DIAGONAL_COST = 3; // a diagonal step takes three times as long

const SPEED_A = 857.36;
const SPEED_B = 261.29;
const SPEED_C = -4795.01;

/** Player base speed: vocation base (110 for every vocation) + 1 per level above 1. */
export function playerBaseSpeed(level: number): number {
  return 110 + (level - 1);
}

const cache = new Map<number, number>();

/** Milliseconds to walk one tile straight, for a creature of the given speed on the given ground. */
export function stepDuration(speed: number, groundSpeed = GROUND_SPEED_GRASS): number {
  const key = speed * 1000 + groundSpeed;
  let ms = cache.get(key);
  if (ms !== undefined) return ms;
  let calculated = 1;
  if (speed > -SPEED_B) calculated = Math.max(1, Math.floor(SPEED_A * Math.log(speed + SPEED_B) + SPEED_C + 0.5));
  const raw = Math.floor((1000 * groundSpeed) / calculated);
  ms = Math.max(SERVER_BEAT, Math.ceil(raw / SERVER_BEAT) * SERVER_BEAT);
  cache.set(key, ms);
  return ms;
}

export const TILE = 32;

/** Something that walks the tile grid: it stands on (tx, ty) and slides there from its previous tile. */
export interface Walker {
  tx: number;
  ty: number;
  x: number; // drawn position in pixels (centre of the tile, interpolated while stepping)
  y: number;
  fromX: number;
  fromY: number;
  stepT: number; // seconds into the current step
  stepDur: number; // seconds the current step takes; 0 when standing still
  dir: number; // 0 N, 1 E, 2 S, 3 W
  dist: number; // pixels walked, drives the walk animation
}

export const tileCenter = (t: number) => t * TILE + TILE / 2;

export function newWalker(tx: number, ty: number): Walker {
  const x = tileCenter(tx), y = tileCenter(ty);
  return { tx, ty, x, y, fromX: x, fromY: y, stepT: 0, stepDur: 0, dir: 2, dist: 0 };
}

export const isStepping = (w: Walker) => w.stepDur > 0;

/** Begin a step to the neighbouring tile (dx, dy). Like in Tibia, the walker occupies the new tile at once. */
export function startStep(w: Walker, dx: number, dy: number, seconds: number, carry = 0) {
  w.fromX = w.x;
  w.fromY = w.y;
  w.tx += dx;
  w.ty += dy;
  w.stepDur = seconds;
  w.stepT = carry;
  if (dx || dy) w.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : dy > 0 ? 2 : 0;
}

/** Advance the current step. Returns time left over in this frame after the step ended (or -1 if still stepping). */
export function advance(w: Walker, dt: number): number {
  if (!w.stepDur) return dt;
  w.stepT += dt;
  const k = Math.min(1, w.stepT / w.stepDur);
  const nx = w.fromX + (tileCenter(w.tx) - w.fromX) * k;
  const ny = w.fromY + (tileCenter(w.ty) - w.fromY) * k;
  w.dist += Math.hypot(nx - w.x, ny - w.y);
  w.x = nx;
  w.y = ny;
  if (k < 1) return -1;
  const left = w.stepT - w.stepDur;
  w.stepDur = 0;
  w.stepT = 0;
  return left;
}
