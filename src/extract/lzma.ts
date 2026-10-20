// A small LZMA ("alone" format) decoder, after the LZMA SDK's LzmaSpec.cpp. Enough for the client's sprite
// sheets: the whole output stays in memory, so it doubles as the dictionary.

class Range {
  range = 0xffffffff;
  code = 0;
  constructor(private buf: Uint8Array, public pos: number) {
    if (buf[pos++] !== 0) throw new Error("lzma: bad range coder start");
    for (let i = 0; i < 4; i++) this.code = this.code * 256 + buf[pos++];
    this.pos = pos;
  }

  private normalize() {
    if (this.range < 0x1000000) {
      this.range = this.range * 256;
      this.code = this.code * 256 + (this.buf[this.pos++] ?? 0);
    }
  }

  bit(probs: Uint16Array, i: number): number {
    const v = probs[i];
    const bound = (this.range >>> 11) * v;
    let bit: number;
    if (this.code < bound) {
      probs[i] = v + ((2048 - v) >>> 5);
      this.range = bound;
      bit = 0;
    } else {
      probs[i] = v - (v >>> 5);
      this.code -= bound;
      this.range -= bound;
      bit = 1;
    }
    this.normalize();
    return bit;
  }

  direct(n: number): number {
    let res = 0;
    for (; n > 0; n--) {
      this.range = this.range >>> 1;
      let b = 0;
      if (this.code >= this.range) {
        this.code -= this.range;
        b = 1;
      }
      res = res * 2 + b;
      this.normalize();
    }
    return res;
  }

  tree(probs: Uint16Array, off: number, bits: number): number {
    let m = 1;
    for (let i = 0; i < bits; i++) m = (m << 1) + this.bit(probs, off + m);
    return m - (1 << bits);
  }

  reverse(probs: Uint16Array, off: number, bits: number): number {
    let m = 1;
    let sym = 0;
    for (let i = 0; i < bits; i++) {
      const b = this.bit(probs, off + m);
      m = (m << 1) + b;
      sym |= b << i;
    }
    return sym;
  }
}

const probs = (n: number) => new Uint16Array(n).fill(1024);

class LenDecoder {
  choice = probs(2);
  low: Uint16Array;
  mid: Uint16Array;
  high = probs(256);
  constructor(posStates: number) {
    this.low = probs(posStates << 3);
    this.mid = probs(posStates << 3);
  }
  decode(rc: Range, posState: number): number {
    if (!rc.bit(this.choice, 0)) return rc.tree(this.low, posState << 3, 3);
    if (!rc.bit(this.choice, 1)) return 8 + rc.tree(this.mid, posState << 3, 3);
    return 16 + rc.tree(this.high, 0, 8);
  }
}

/** Decode raw LZMA: `props` is the 5-byte header (lc/lp/pb, dictionary size), `data` the range-coded stream.
 *  Stops at the end marker, at the end of the input, or once `sizeOf(out, n)` says the output is complete. */
export function lzmaDecode(props: Uint8Array, data: Uint8Array, start = 0, sizeOf?: (out: Uint8Array, n: number) => number): Uint8Array {
  let d = props[0];
  const lc = d % 9;
  d = (d / 9) | 0;
  const lp = d % 5;
  const pb = (d / 5) | 0;

  const rc = new Range(data, start);
  let out = new Uint8Array(1 << 20);
  let n = 0;
  const put = (b: number) => {
    if (n === out.length) {
      const grown = new Uint8Array(out.length * 2);
      grown.set(out);
      out = grown;
    }
    out[n++] = b;
  };

  const literals = probs(0x300 << (lc + lp));
  const isMatch = probs(12 << 4);
  const isRep = probs(12);
  const isRepG0 = probs(12);
  const isRepG1 = probs(12);
  const isRepG2 = probs(12);
  const isRep0Long = probs(12 << 4);
  const posSlot = probs(4 << 6);
  const posDec = probs(115);
  const align = probs(16);
  const lenDec = new LenDecoder(1 << pb);
  const repLenDec = new LenDecoder(1 << pb);
  const pbMask = (1 << pb) - 1;
  const lpMask = (1 << lp) - 1;

  let state = 0;
  let rep0 = 0, rep1 = 0, rep2 = 0, rep3 = 0;
  let expected = Infinity;

  while (rc.pos <= data.length) {
    if (sizeOf && expected === Infinity && n >= 16) expected = sizeOf(out, n);
    if (n >= expected) break;
    const posState = n & pbMask;
    if (!rc.bit(isMatch, (state << 4) + posState)) {
      const prev = n > 0 ? out[n - 1] : 0;
      const base = 0x300 * (((n & lpMask) << lc) + (prev >> (8 - lc)));
      let sym = 1;
      if (state >= 7) {
        let match = out[n - rep0 - 1];
        do {
          const mb = (match >> 7) & 1;
          match <<= 1;
          const b = rc.bit(literals, base + ((1 + mb) << 8) + sym);
          sym = (sym << 1) | b;
          if (mb !== b) break;
        } while (sym < 0x100);
      }
      while (sym < 0x100) sym = (sym << 1) | rc.bit(literals, base + sym);
      put(sym - 0x100);
      state = state < 4 ? 0 : state < 10 ? state - 3 : state - 6;
      continue;
    }
    let len: number;
    if (rc.bit(isRep, state)) {
      if (n === 0) throw new Error("lzma: rep at start");
      if (!rc.bit(isRepG0, state)) {
        if (!rc.bit(isRep0Long, (state << 4) + posState)) {
          state = state < 7 ? 9 : 11;
          put(out[n - rep0 - 1]);
          continue;
        }
      } else {
        let dist: number;
        if (!rc.bit(isRepG1, state)) dist = rep1;
        else {
          if (!rc.bit(isRepG2, state)) dist = rep2;
          else {
            dist = rep3;
            rep3 = rep2;
          }
          rep2 = rep1;
        }
        rep1 = rep0;
        rep0 = dist;
      }
      len = repLenDec.decode(rc, posState);
      state = state < 7 ? 8 : 11;
    } else {
      rep3 = rep2;
      rep2 = rep1;
      rep1 = rep0;
      len = lenDec.decode(rc, posState);
      state = state < 7 ? 7 : 10;
      const slot = rc.tree(posSlot, Math.min(len, 3) << 6, 6);
      if (slot < 4) rep0 = slot;
      else {
        const bits = (slot >> 1) - 1;
        let dist = (2 + (slot & 1)) * 2 ** bits;
        if (slot < 14) dist += rc.reverse(posDec, dist - slot, bits);
        else dist += rc.direct(bits - 4) * 16 + rc.reverse(align, 0, 4);
        rep0 = dist;
      }
      if (rep0 === 0xffffffff) break; // end marker
      if (rep0 >= n) throw new Error("lzma: distance past the start");
    }
    len += 2;
    for (let i = 0; i < len; i++) put(out[n - rep0 - 1]);
  }
  return out.subarray(0, Math.min(n, expected));
}
