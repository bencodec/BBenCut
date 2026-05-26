import type { Resolvable } from './types.js';

// ─── Random helpers (SC equivalents) ──────────────────────────────────────────

/** Random integer in [0, n) — SC's n.rand */
export const rand = (n: number): number => Math.floor(Math.random() * n);

/** Random integer in [lo, hi] inclusive — SC's rrand(lo, hi) */
export const rrand = (lo: number, hi: number): number =>
  lo + Math.floor(Math.random() * (hi - lo + 1));

/** True with given probability — SC's prob.coin */
export const coin = (prob: number): boolean => Math.random() < prob;

/** Integer division — SC's a.div(b) */
export const intDiv = (a: number, b: number): number => Math.floor(a / b);

// ─── Resolvable helper ────────────────────────────────────────────────────────

/** Resolve a Resolvable<T>: call it if it's a function, return it otherwise.
 *  Mirrors SC's .value on numbers and functions. */
export function resolve<T>(x: Resolvable<T>): T {
  return typeof x === 'function' ? (x as () => T)() : x;
}

// ─── Array helpers ────────────────────────────────────────────────────────────

/** Weighted random choice — SC's array.wchoose(weights) */
export function wchoose<T>(arr: readonly T[], weights: readonly number[]): T {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < arr.length; i++) {
    r -= weights[i]!;
    if (r <= 0) return arr[i]!;
  }
  return arr[arr.length - 1]!;
}

/** Uniformly random choice — SC's array.choose */
export const choose = <T>(arr: readonly T[]): T =>
  arr[Math.floor(Math.random() * arr.length)]!;

/** Fisher-Yates shuffle (returns new array) — SC's array.scramble */
export function scramble<T>(arr: readonly T[]): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}

/** Swap two elements (returns new array) — SC's array.swap(i, j) */
export function swap<T>(arr: readonly T[], i: number, j: number): T[] {
  const out = arr.slice();
  const tmp = out[i]!;
  out[i] = out[j]!;
  out[j] = tmp;
  return out;
}

/** Rotate array by n positions (negative = left) — SC's array.rotate(n) */
export function rotate<T>(arr: readonly T[], n: number): T[] {
  const len = arr.length;
  if (len === 0) return [];
  const shift = ((n % len) + len) % len;
  return [...arr.slice(shift), ...arr.slice(0, shift)];
}

/** Normalise so elements sum to 1 — SC's array.normalizeSum */
export function normalizeSum(arr: readonly number[]): number[] {
  const total = arr.reduce((a, b) => a + b, 0);
  return arr.map((x) => x / total);
}

/** Round x to the nearest multiple of quant.
 *  Returns x unchanged when quant === 0 — matches SC's x.round(0) behaviour. */
export function scRound(x: number, quant: number): number {
  if (quant === 0) return x;
  return Math.round(x / quant) * quant;
}

/** Group adjacent elements into sub-arrays, starting a new group after each
 *  element with probability `prob` — SC's array.curdle(prob). */
export function curdle<T>(arr: readonly T[], prob: number): T[][] {
  const result: T[][] = [];
  let current: T[] = [];
  for (const item of arr) {
    current.push(item);
    if (coin(prob)) {
      result.push(current);
      current = [];
    }
  }
  if (current.length > 0) result.push(current);
  return result;
}

/** Create [start, start+step, start+2*step, ...] of length n — SC's List.series */
export const series = (n: number, start = 0, step = 1): number[] =>
  Array.from({ length: n }, (_, i) => start + i * step);

/** Sum an array — SC's array.sum */
export const sum = (arr: readonly number[]): number =>
  arr.reduce((a, b) => a + b, 0);

/** Cyclic sequence iterator — SC's Pseq(arr, inf).asStream */
export function* cyclicSeq<T>(arr: T[]): Generator<T> {
  while (true) for (const item of arr) yield item;
}
