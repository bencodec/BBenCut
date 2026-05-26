import { BBCutProc } from './BBCutProc.js';
import { normalizeSum, resolve, sum } from './helpers.js';
import type { Resolvable } from './types.js';

export interface CageCutOptions {
  /** Total phrase length in beats (default 8.0) */
  phraselength?: Resolvable<number>;
  /** Returns the proportional form of the phrase given phraseLength.
   *  Values are normalised to sum to 1 before use.
   *  Default: [0.5, 0.25, 0.25] — three uneven blocks. */
  subdivfunc?: Resolvable<number[]>;
  /** Permutes each block's cut array before it is played.
   *  Default: identity (no permutation). */
  permutefunc?: (cuts: number[]) => number[];
}

/**
 * John Cage square-root form in miniature.
 *
 * Each phrase is divided into a proportional "form" (e.g. [0.5, 0.25, 0.25]).
 * Each section of the form is itself divided by the same proportions, giving
 * a fractal/self-similar subdivision.  The permutefunc can reorder cuts within
 * each block.
 */
export class CageCut extends BBCutProc {
  private readonly _subdivfunc: Resolvable<number[]>;
  private readonly _permutefunc: (cuts: number[]) => number[];

  private _blockarray: number[][] = [];

  constructor({
    phraselength = 8.0,
    subdivfunc = [0.5, 0.25, 0.25],
    permutefunc = (a) => a,
  }: CageCutOptions = {}) {
    super(0.5, phraselength);
    this._subdivfunc = subdivfunc;
    this._permutefunc = permutefunc;
  }

  chooseblock(): void {
    // New phrase?
    if (this.phrasepos >= this.currphraselength - 0.001) {
      this.newPhraseAccounting();

      // Normalise the form and build the block array.
      // Each block's cuts are the phrase length × (form proportions × block proportion).
      const form = normalizeSum(resolve(this._subdivfunc));
      this._blockarray = form.map(
        (blockProp) =>
          form.map((cutProp) => this.currphraselength * blockProp * cutProp),
      );
    }

    const beatsleft = this.currphraselength - this.phrasepos;

    // Apply the permutation function to this block's cuts
    let cuts = this._permutefunc(
      (this._blockarray[this.block] ?? [beatsleft]).slice(),
    );
    this.blocklength = sum(cuts);

    // Trim if permutation changed the length beyond what's left
    if (this.blocklength > beatsleft) {
      let accumulated = 0;
      let cutoffIndex = 0;

      for (let i = 0; i < cuts.length; i++) {
        accumulated += cuts[i]!;
        if (accumulated > beatsleft - 0.001) {
          cutoffIndex = i;
          break;
        }
      }

      cuts = cuts.slice(0, cutoffIndex + 1);
      cuts[cutoffIndex] = (cuts[cutoffIndex] ?? 0) - (accumulated - beatsleft);
      if (cuts.length < 1) cuts = [beatsleft];
      this.blocklength = beatsleft;
    }

    this.cuts = cuts;

    this._listener?.chooseoffset?.(
      this.phrasepos,
      this.beatspersubdiv,
      this.currphraselength,
    );
    this.updateblock();
    this.endBlockAccounting();
  }
}
