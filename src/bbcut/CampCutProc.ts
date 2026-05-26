import { BBCutProc } from './BBCutProc.js';
import { resolve, series, swap } from './helpers.js';
import type { Resolvable } from './types.js';

/** A campanological permutation stream.
 *  bells: the number of bells (= number of blocks per phrase).
 *  next(): returns an array of swap-with-neighbour operations to apply
 *          to the current offset ordering.  Each value v means "swap
 *          offsetlist[v] with offsetlist[v+1]". */
export interface CampStream {
  readonly bells: number;
  next(): number[];
}

export interface CampCutProcOptions {
  campstream: CampStream;
  /** Total phrase length in beats (default 4.0) */
  phraselength?: Resolvable<number>;
}

/**
 * Campanological (bell-ringing) cut procedure.
 *
 * Divides a phrase into equal blocks and reorders the source offsets each
 * phrase by applying a bell-ringing permutation sequence.  The offset for
 * each block is communicated via the listener's setoffset callback.
 */
export class CampCutProc extends BBCutProc {
  private readonly _campstream: CampStream;
  private readonly _bells: number;
  private _offsetlist: number[];

  constructor({ campstream, phraselength = 4.0 }: CampCutProcOptions) {
    super(0.5, phraselength);
    this._campstream = campstream;
    this._bells = campstream.bells;
    this._offsetlist = series(this._bells); // [0, 1, 2, …, bells-1]
    // Start at bells so the first chooseblock() triggers a new phrase
    this.block = this._bells;
  }

  chooseblock(): void {
    // New phrase?
    if (this.block === this._bells) {
      this.newPhraseAccounting();

      // Fixed block length: phrase / bells
      // (stored here so endBlockAccounting can accumulate phrasepos correctly)

      // Apply the campstream permutation to the offset list
      const perm = this._campstream.next();
      for (const v of perm) {
        this._offsetlist = swap(this._offsetlist, v, v + 1);
      }
    }

    const blocklength = this.currphraselength / this._bells;
    this.blocklength = blocklength;
    this.cuts = [blocklength];

    // Communicate the permuted offset (as a proportion 0–1) to the listener
    const offsetProp = (this._offsetlist[this.block] ?? 0) / this._bells;
    this._listener?.setoffset?.(offsetProp);

    this.updateblock();
    this.endBlockAccounting();
  }
}
