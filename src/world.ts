// The endless grassland: ground variants and decorations, generated from a hash of the tile position.
// Trees and bushes block movement (the client's "unpass" flag, recorded by tools/extract.py).

export function hash(x: number, y: number, seed = 0): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export interface Decor { frame: number; block: boolean; tall: boolean }

type DecorTable = Record<string, [number, boolean][]>;

export class World {
  private cache = new Map<number, Decor | null>();

  constructor(private decor: DecorTable) {}

  decorAt(tx: number, ty: number): Decor | null {
    const key = (tx + 0x8000) * 0x10000 + (ty + 0x8000);
    let d = this.cache.get(key);
    if (d !== undefined) return d;
    d = this.compute(tx, ty);
    if (this.cache.size > 200000) this.cache.clear();
    this.cache.set(key, d);
    return d;
  }

  private compute(tx: number, ty: number): Decor | null {
    if (Math.abs(tx) < 3 && Math.abs(ty) < 3) return null; // a clearing to start in
    const r = hash(tx, ty, 7);
    const pick = (kind: string, tall: boolean): Decor => {
      const arr = this.decor[kind];
      const [frame, block] = arr[Math.floor(hash(tx, ty, 11) * arr.length)];
      return { frame, block, tall };
    };
    // Small groves: trees cluster where a low-frequency hash is high.
    const grove = hash(Math.floor(tx / 6), Math.floor(ty / 6), 23);
    if (r < (grove > 0.8 ? 0.22 : 0.012)) return pick("trees", true);
    if (r < (grove > 0.8 ? 0.27 : 0.02)) return pick("bushes", true);
    if (r < 0.024 && grove <= 0.8) return pick("dead", true);
    if (r < 0.06) return pick("flowers", false);
    return null;
  }

  blocked(tx: number, ty: number): boolean {
    return this.decorAt(tx, ty)?.block ?? false;
  }
}
