// Tibia's containers, as the server and client keep them (Canary's Container, otclient's Container):
// a dense list with the newest item in front (push_front), `containersize` slots, stackable items
// stacking up to 100 per slot, and containers nesting inside each other.
import { item, PRICES } from "./tibia/db";

export const STACK_MAX = 100;
export const BACKPACK = 2854;
/** Coins count at face value. */
export const COIN_VALUE: Record<number, number> = { 3031: 1, 3035: 100, 3043: 10000 };

export interface Thing { id: number; n: number; inner?: Container }

export const stackable = (id: number) => !!item(id)?.stackable;

export class Container {
  items: Thing[] = [];
  constructor(public id: number, public parent: Container | null = null) {}

  get cap() { return Number(item(this.id)?.containersize ?? 20); }
  get name() { return item(this.id)?.name ?? "backpack"; }
  get full() { return this.items.length >= this.cap; }

  /** Put n of an item in, the way loot reaches the main backpack: stacks fill first, then a new slot in
   *  front; a full container passes the rest on to the first container inside it with room. When the
   *  whole chain is full, a fresh backpack takes this container's last slot and the item that was there
   *  goes in it (you never run out of backpacks, the one thing here that isn't Tibia). */
  add(id: number, n: number) {
    if (n <= 0) return;
    if (stackable(id)) {
      for (const t of this.items) {
        if (t.id !== id || t.n >= STACK_MAX) continue;
        const k = Math.min(n, STACK_MAX - t.n);
        t.n += k;
        n -= k;
        if (!n) return;
      }
    }
    while (n > 0 && !this.full) {
      const k = stackable(id) ? Math.min(n, STACK_MAX) : 1;
      this.items.unshift({ id, n: k });
      n -= k;
    }
    if (!n) return;
    const sub = this.items.find((t) => t.inner && t.inner.hasRoom())?.inner ?? this.items.find((t) => t.inner)?.inner ?? this.chain();
    sub.add(id, n);
  }

  /** Room anywhere in this container or the ones inside it. */
  hasRoom(): boolean {
    return !this.full || this.items.some((t) => t.inner?.hasRoom());
  }

  private chain(): Container {
    const inner = new Container(BACKPACK, this);
    const last = this.items.pop()!;
    if (last.inner) last.inner.parent = inner;
    inner.items.push(last);
    this.items.push({ id: BACKPACK, n: 1, inner });
    return inner;
  }

  /** Everything inside, nested containers included (but not the containers themselves). */
  *all(): Generator<Thing> {
    for (const t of this.items) {
      if (t.inner) yield* t.inner.all();
      else yield t;
    }
  }

  count() {
    let c = 0;
    for (const t of this.all()) c += t.n;
    return c;
  }

  /** What NPCs pay for everything inside. */
  worth() {
    let v = 0;
    for (const t of this.all()) v += (COIN_VALUE[t.id] ?? PRICES[t.id]?.sell ?? 0) * t.n;
    return v;
  }

  /** Take one of an item out (from wherever it is inside); false if there's none. */
  take(id: number): boolean {
    for (let i = 0; i < this.items.length; i++) {
      const t = this.items[i];
      if (t.inner) {
        if (t.inner.take(id)) return true;
      } else if (t.id === id) {
        if (--t.n <= 0) this.items.splice(i, 1);
        return true;
      }
    }
    return false;
  }

  /** Take every one of an item out (a stack of spears, say); returns how many. */
  takeAll(id: number): number {
    let n = 0;
    for (const t of [...this.items]) {
      if (t.inner) n += t.inner.takeAll(id);
      else if (t.id === id) { n += t.n; this.items.splice(this.items.indexOf(t), 1); }
    }
    return n;
  }

  clear() { this.items = []; }
}
