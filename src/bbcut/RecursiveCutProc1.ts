import { BBCutProc } from './BBCutProc.js';
import { rand, rrand, resolve } from './helpers.js';
import type { Resolvable } from './types.js';

type OffsetFn = (
  quantise: number,
  bpsubdiv: number,
  done: number,
  phraseLength: number,
) => number;

export interface RecursiveCutProc1Options {
  /** Returns a cut size in beats given (done, phraseLength).
   *  Default: wchoose of 1.5 or 1 beats (2:1 weighting). */
  cutfunc?: (done: number, phraseLength: number) => number;
  /** Returns the number of times to repeat a cut given (done, phraseLength).
   *  Default: 1 or 2 at random. */
  repeatfunc?: (done: number, phraseLength: number) => number;
  /** Returns a start offset in beats given (quantise, bpsubdiv, done, phraseLength).
   *  Default: random quantise position. */
  offsetfunc?: OffsetFn;
  /** Number of recursive subdivision passes (default 2). */
  reclevel?: Resolvable<number>;
  /** Total phrase length in beats (default 4.0) */
  phraselength?: Resolvable<number>;
  /** Beats per subdivision (default 0.5) */
  bpsd?: number;
}

// Internal: a computed block is [durationInBeats, startOffsetInBeats]
type ComputedBlock = [duration: number, offset: number];

/**
 * Recursive / fractal cut procedure.
 *
 * Begins with a single block covering the full phrase, then applies
 * reclevel iterations of a cut-and-repeat algorithm, each time
 * subdividing existing blocks by choosing intersections with a
 * randomly placed window.  The result is a phrase-length sequence of
 * (duration, offset) pairs with self-similar rhythmic structure.
 *
 * The source offset for each block is communicated via setoffset.
 */
export class RecursiveCutProc1 extends BBCutProc {
  private readonly _cutfunc: (done: number, phraseLength: number) => number;
  private readonly _repeatfunc: (done: number, phraseLength: number) => number;
  private readonly _offsetfunc: OffsetFn;
  private readonly _reclevel: Resolvable<number>;

  private _offsetlist: ComputedBlock[] = [];
  private _quantise = 0;

  constructor({
    cutfunc,
    repeatfunc,
    offsetfunc,
    reclevel = 2,
    phraselength = 4.0,
    bpsd = 0.5,
  }: RecursiveCutProc1Options = {}) {
    super(bpsd, phraselength);
    this._cutfunc =
      cutfunc ??
      ((_done, _len) => (Math.random() < 0.666 ? 1.5 : 1));
    this._repeatfunc = repeatfunc ?? (() => rand(2) + 1);
    this._offsetfunc =
      offsetfunc ??
      ((q, bpsubdiv) => rrand(0, q - 1) * bpsubdiv);
    this._reclevel = reclevel;
  }

  chooseblock(): void {
    // New phrase — triggered when block reaches the end of the computed list
    if (this._offsetlist.length === this.block) {
      this.newPhraseAccounting();

      this._quantise = Math.round(this.currphraselength / this.beatspersubdiv);

      // Start with the whole phrase as one block at offset 0
      let list: ComputedBlock[] = [[this.currphraselength, 0.0]];

      // Apply recursive subdivision
      const levels = resolve(this._reclevel);
      for (let lvl = 0; lvl < levels; lvl++) {
        list = this.calculatecuts(list);
      }

      this._offsetlist = list;
    }

    const entry = this._offsetlist[this.block]!;
    this.blocklength = entry[0];
    this.cuts = [this.blocklength];

    // Offset as a proportion of the phrase length
    const offsetProp = entry[1] / this.currphraselength;
    this._listener?.setoffset?.(offsetProp);

    this.updateblock();
    this.endBlockAccounting();
  }

  // ── Core recursive subdivision ───────────────────────────────────────────

  private calculatecuts(array: ComputedBlock[]): ComputedBlock[] {
    // Double the array to allow wrap-around without special-casing
    const doubled = [...array, ...array];
    const prepared = this.prepare(doubled);

    const out: ComputedBlock[] = [];
    let done = 0;

    while (done < this.currphraselength - 0.00001) {
      let cutsize = this._cutfunc(done, this.currphraselength);

      // Clamp to remaining phrase
      if (done + cutsize > this.currphraselength) {
        cutsize = this.currphraselength - done;
      }

      let repeats = this._repeatfunc(done, this.currphraselength);
      while (repeats * cutsize + done > this.currphraselength) repeats--;

      const offset = this._offsetfunc(
        this._quantise,
        this.beatspersubdiv,
        done,
        this.currphraselength,
      );
      const offend = offset + cutsize;

      for (let rep = 0; rep < repeats; rep++) {
        // Find all intervals in prepared that intersect [offset, offend)
        for (const interval of prepared) {
          const [start, end, , intervalOffset] = interval;

          if (start <= offset && end > offset) {
            // Interval straddles the window start
            const istart = offset;
            const iend = Math.min(end, offend);
            out.push([iend - istart, intervalOffset + (istart - start)]);
          } else if (start > offset && start < offend) {
            // Interval starts inside the window
            const istart = start;
            const iend = Math.min(end, offend);
            out.push([iend - istart, intervalOffset]);
          }
        }
        done += cutsize;
      }
    }

    return out;
  }

  // Convert [duration, offset][] to [start, end, duration, offset][]
  // with cumulative start positions.
  private prepare(
    array: ComputedBlock[],
  ): Array<[start: number, end: number, duration: number, offset: number]> {
    let cumul = 0;
    return array.map(([dur, offset]) => {
      const start = cumul;
      cumul += dur;
      return [start, cumul, dur, offset];
    });
  }
}
