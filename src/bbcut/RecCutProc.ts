import { BBCutProc } from './BBCutProc.js';
import type { Resolvable } from './types.js';

/** Data object providing recursive cut sequences.
 *  subdiv: the number of equal primitives the phrase is divided into.
 *  offsetseq: an ordered list of [blockCount, offsetIndex] pairs.
 *    blockCount × (phraseLength / subdiv) = block length in beats.
 *    offsetIndex / subdiv = the source offset proportion (0–1). */
export interface RCutData {
  readonly subdiv: number;
  readonly offsetseq: ReadonlyArray<readonly [blockCount: number, offsetIndex: number]>;
}

export interface RecCutProcOptions {
  rcd: RCutData;
  /** Total phrase length in beats (default 4.0) */
  phraselength?: Resolvable<number>;
}

/**
 * Recursive cut procedure (original proof-of-concept).
 *
 * Delegates all phrase structure to an external RCutData object.  Each entry
 * in offsetseq describes one block: how many primitives long it is, and which
 * primitive position to play from.  The offset is passed via setoffset.
 *
 * For the more capable generative version see RecursiveCutProc1.
 */
export class RecCutProc extends BBCutProc {
  private readonly _rcd: RCutData;
  private _offsetlist: ReadonlyArray<readonly [number, number]> = [];

  constructor({ rcd, phraselength = 4.0 }: RecCutProcOptions) {
    super(0.5, phraselength);
    this._rcd = rcd;
    // Start at 0 == empty offsetlist.length to trigger first phrase immediately
  }

  chooseblock(): void {
    // New phrase — triggered when block has advanced past the offsetlist
    if (this._offsetlist.length === this.block) {
      this.newPhraseAccounting();
      this._offsetlist = this._rcd.offsetseq;
    }

    const primitive = this.currphraselength / this._rcd.subdiv;
    const entry = this._offsetlist[this.block]!;

    this.blocklength = entry[0] * primitive;
    this.cuts = [this.blocklength];

    // Offset as a proportion of the source buffer
    const offsetProp = entry[1] / this._rcd.subdiv;
    this._listener?.setoffset?.(offsetProp);

    this.updateblock();
    this.endBlockAccounting();
  }
}
