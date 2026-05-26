import { BBCutProc } from './BBCutProc.js';
import { coin, choose, resolve } from './helpers.js';
import type { Resolvable } from './types.js';

export interface ChooseCutProcOptions {
  /** Returns a cut size in beats. Receives (phrasepos, phraseLength).
   *  Default: randomly picks 1.0 or 1.5 beats. */
  cutsizefunc?: (phrasepos: number, phraseLength: number) => number;
  /** Returns the number of times to repeat the cut size.
   *  Receives (cutsize, phrasepos, phraseLength).
   *  Default: randomly picks 1 or 2. */
  repeatfunc?: (
    cutsize: number,
    phrasepos: number,
    phraseLength: number,
  ) => number;
  /** Returns a cuts array to fill the remaining beats at phrase end (roll).
   *  Receives (beatsLeft).
   *  Default: 4× subdivisions of beatsLeft. */
  rollfunc?: (beatsLeft: number) => number[];
  /** Total phrase length in beats (default 16.0) */
  phraselength?: Resolvable<number>;
  /** Probability of triggering a roll near phrase end (default 0.1) */
  rollchance?: Resolvable<number>;
  /** Roll is only allowed when fewer than this many beats remain (default 2.0) */
  rollallowed?: Resolvable<number>;
  /** Beats per subdivision (default 0.5) */
  bpsd?: number;
}

/**
 * Probabilistic cut procedure.
 * Chooses random cut sizes and repeat counts. Near the end of a phrase
 * there is a chance of a "roll" — a rapid burst of smaller cuts.
 */
export class ChooseCutProc extends BBCutProc {
  private readonly _cutsizefunc: (
    phrasepos: number,
    phraseLength: number,
  ) => number;
  private readonly _repeatfunc: (
    cutsize: number,
    phrasepos: number,
    phraseLength: number,
  ) => number;
  private readonly _rollfunc: (beatsLeft: number) => number[];
  private readonly _rollchance: Resolvable<number>;
  private readonly _rollallowed: Resolvable<number>;

  private _rollon = 0;

  constructor({
    cutsizefunc,
    repeatfunc,
    rollfunc,
    phraselength = 16.0,
    rollchance = 0.1,
    rollallowed = 2.0,
    bpsd = 0.5,
  }: ChooseCutProcOptions = {}) {
    super(bpsd, phraselength);
    this._cutsizefunc =
      cutsizefunc ?? ((_pos, _len) => choose([1.0, 1.5]));
    this._repeatfunc =
      repeatfunc ?? ((_size, _pos, _len) => choose([1, 2]));
    this._rollfunc =
      rollfunc ??
      ((blocksize) => {
        const reps = Math.round(blocksize * 4);
        const cutsize = blocksize / reps;
        return Array.from({ length: reps }, () => cutsize);
      });
    this._rollchance = rollchance;
    this._rollallowed = rollallowed;
  }

  chooseblock(): void {
    // New phrase?
    if (this.phrasepos >= this.currphraselength) {
      this.newPhraseAccounting();
    }

    const beatsleft = this.currphraselength - this.phrasepos;

    if (
      coin(resolve(this._rollchance)) &&
      beatsleft < resolve(this._rollallowed)
    ) {
      // ROLL — fill remaining beats with rapid cuts
      this._rollon = 1;
      this.blocklength = beatsleft;
      this.cuts = this._rollfunc(beatsleft);
    } else {
      // NORMAL
      this._rollon = 0;
      let cutsize = this._cutsizefunc(this.phrasepos, this.currphraselength);
      if (cutsize > beatsleft) cutsize = beatsleft;

      let repeats = this._repeatfunc(
        cutsize,
        this.phrasepos,
        this.currphraselength,
      );
      let proj = repeats * cutsize + this.phrasepos;

      while (proj > this.currphraselength) {
        repeats -= 1;
        if (repeats <= 1) {
          repeats = 1;
          cutsize = beatsleft;
        }
        proj = repeats * cutsize + this.phrasepos;
      }

      this.cuts = Array.from({ length: repeats }, () => cutsize);
      this.blocklength = repeats * cutsize;
    }

    this._listener?.chooseoffset?.(
      this.phrasepos,
      this.beatspersubdiv,
      this.currphraselength,
    );
    this.updateblock(this._rollon);
    this.endBlockAccounting();
  }
}
