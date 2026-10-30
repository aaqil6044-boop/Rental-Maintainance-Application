"use strict";
// Small seedable random generator (mulberry32). The same seed always produces the same sequence,
// so a load test can be repeated with comparable traffic.
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const mix = (seed, n) => { let h = (seed ^ Math.imul(n + 1, 0x9E3779B1)) >>> 0; h = Math.imul(h ^ (h >>> 16), 0x85EBCA6B); h = Math.imul(h ^ (h >>> 13), 0xC2B2AE35); return (h ^ (h >>> 16)) >>> 0; };

class Rng {
  constructor(seed) { this.seed = seed >>> 0; this._n = mulberry32(this.seed); }
  next() { return this._n(); }
  /** an independent stream for virtual user n, derived from this seed */
  fork(n) { return new Rng(mix(this.seed, n)); }
  range(a, b) { return a + (b - a) * this.next(); }
  int(a, b) { return Math.floor(this.range(a, b + 1)); }
  chance(p) { return this.next() < p; }
  pick(arr) { return arr.length ? arr[Math.floor(this.next() * arr.length)] : undefined; }
  shuffle(arr) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(this.next() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  /** items: array; weightOf(item) -> number >= 0. Returns undefined when every weight is 0. */
  weighted(items, weightOf) {
    let total = 0; for (const it of items) total += Math.max(0, weightOf(it));
    if (total <= 0) return undefined;
    let r = this.next() * total;
    for (const it of items) { r -= Math.max(0, weightOf(it)); if (r < 0) return it; }
    return items[items.length - 1];
  }
}
module.exports = { Rng, mulberry32, mix };
