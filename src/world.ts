// The world's sprites: map.ts decides what is where (zones, walls, ponds, trees...); this picks the frames.
// Things that block movement stand up (drawn y-sorted with creatures); the rest lie on the ground.
import { tileAt } from "./map";
export { hash } from "./map";

export interface Decor { frame: number; block: boolean; tall: boolean }

/** The atlas's terrain frames by kind (tools/extract.py, from src/tibia/terrain.json). */
export interface TerrainFrames { ground: Record<string, number[]>; decor: Record<string, number[]> }

export class World {
  /** Without frames (the headless simulator) only the map is known. */
  constructor(private frames: TerrainFrames | null = null) {}

  /** The ground's frame: mostly the kind's first sprite, now and then one of the others. */
  groundFrame(tx: number, ty: number): number {
    const t = tileAt(tx, ty), f = this.frames?.ground[t.ground];
    if (!f?.length) return 0;
    return t.v < 0.7 || f.length === 1 ? f[0] : f[1 + Math.floor(((t.v - 0.7) / 0.3) * (f.length - 1))];
  }

  decorAt(tx: number, ty: number): Decor | null {
    const t = tileAt(tx, ty);
    if (!t.decor) return null;
    const f = this.frames?.decor[t.decor];
    if (!f?.length) return null;
    const frame = f[Math.floor(((t.v * 7919) % 1) * f.length)];
    return { frame, block: t.block, tall: t.block };
  }

  blocked(tx: number, ty: number): boolean {
    return tileAt(tx, ty).block;
  }
}
