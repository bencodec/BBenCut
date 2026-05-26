import { BBCutProc } from './BBCutProc.js';
import { resolve } from './helpers.js';
import type { Resolvable } from './types.js';

export interface BBCPPermuteOptions {
  /** Total phrase length in beats (default 4.0) */
  phraselength?: Resolvable<number>;
  /** Number of subdivisions per phrase, or a function returning it.
   *  Default: 8. */
  subdivfunc?: Resolvable<number>;
  /** Maps (blockIndex, numSubdivisions) → offset index.
   *  Default: identity wrap (index % n). */
  permutefunc?: (index: number, n: number) => number;
  /** Number of times to repeat each subdivision unit, or a function of
   *  (blockIndex, numSubdivisions, phrasepos) returning it.
   *  Default: 1 (no repeats). */
  repeatsfunc?: Resolvable<number> | ((index: number, n: number, phrasepos: number) => number);
}

/**
 * Permutation-based cut procedure.
 *
 * Divides a phrase into equal subdivision units then steps through them in an
 * order determined by permutefunc.  repeatsfunc can repeat a unit multiple
 * times to create a repeats effect.  The offset for each block is set
 * explicitly via the listener's setoffset callback.
 */
export class BBCPPermute extends BBCutProc {
  private readonly _subdivfunc: Resolvable<number>;
  private readonly _permutefunc: (index: number, n: number) => number;
  private readonly _repeatsfunc:
    | Resolvable<number>
    | ((index: number, n: number, phrasepos: number) => number);

  private _subdiv = 0;
  private _stepIndex = 0; // steps through the phrase subdivision grid

  constructor({
    phraselength = 4.0,
    subdivfunc = 8,
    permutefunc = (index, n) => index % n,
    repeatsfunc = 1,
  }: BBCPPermuteOptions = {}) {
    super(0.5, phraselength);
    this._subdivfunc = subdivfunc;
    this._permutefunc = permutefunc;
    this._repeatsfunc = repeatsfunc;
  }

  chooseblock(): void {
    // New phrase?
    if (this.phrasepos >= this.currphraselength - 0.001) {
      this.newPhraseAccounting();

      this._subdiv = Math.round(resolve(this._subdivfunc));
      this.beatspersubdiv = this.currphraselength / this._subdiv;
      this._stepIndex = 0;
    }

    const beatsleft = this.currphraselength - this.phrasepos;

    this.blocklength = this.beatspersubdiv;
    if (this.blocklength > beatsleft - 0.001) this.blocklength = beatsleft;

    const repeats = Math.max(
      1,
      Math.round(
        typeof this._repeatsfunc === 'function'
          ? this._repeatsfunc(this._stepIndex, this._subdiv, this.phrasepos)
          : resolve(this._repeatsfunc),
      ),
    );

    const cutsize = this.blocklength / repeats;
    this.cuts = Array.from({ length: repeats }, () => cutsize);
    // Fix last cut for arithmetic drift
    this.cuts[repeats - 1] =
      cutsize + (this.blocklength - cutsize * repeats);

    // Compute permuted offset and hand it to the listener
    const permutedIndex = this._permutefunc(this._stepIndex, this._subdiv);
    const offsetProp = ((permutedIndex % this._subdiv) * (1.0 / this._subdiv));
    this._listener?.setoffset?.(offsetProp);

    this._stepIndex += 1;

    this.updateblock(repeats > 1 ? 1 : 0);
    this.endBlockAccounting();
  }
}
