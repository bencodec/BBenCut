import { BBCutProc } from './BBCutProc.js';
import { normalizeSum, resolve, sum } from './helpers.js';
import type { Resolvable } from './types.js';

export interface TimelineCutOptions {
  /** Total phrase length in beats (default 4.0) */
  phraselength?: Resolvable<number>;
  /** Returns proportional block sizes given phraseLength.
   *  Values are normalised to sum to 1 before use.
   *  Default: [3, 3, 2] — the classic 3+3+2 clave pattern. */
  timelinefunc?: Resolvable<number[]>;
  /** Converts a block duration and block index into an array of cut durations.
   *  Default: one cut equal to the full block duration. */
  blockfunc?: (duration: number, blockIndex: number) => number[];
  /** When true the block layout is frozen and not recalculated each phrase.
   *  Can be a Resolvable<boolean>. Default: false. */
  freeze?: Resolvable<boolean>;
}

/**
 * Timeline-based cut procedure.
 *
 * Divides a phrase according to a proportional timeline (e.g. [3,3,2] gives
 * 37.5%/37.5%/25% blocks in a phrase).  Each block can be further subdivided
 * by blockfunc.  When freeze is true the timeline is computed only once and
 * reused across subsequent phrases.
 */
export class TimelineCut extends BBCutProc {
  private readonly _timelinefunc: Resolvable<number[]>;
  private readonly _blockfunc: (duration: number, blockIndex: number) => number[];
  private readonly _freeze: Resolvable<boolean>;

  private _blockarray: number[][] | null = null;

  constructor({
    phraselength = 4.0,
    timelinefunc = [3, 3, 2],
    blockfunc = (dur, _i) => [dur],
    freeze = false,
  }: TimelineCutOptions = {}) {
    super(0.5, phraselength);
    this._timelinefunc = timelinefunc;
    this._blockfunc = blockfunc;
    this._freeze = freeze;
  }

  chooseblock(): void {
    // New phrase?
    if (this.phrasepos >= this.currphraselength - 0.001) {
      this.newPhraseAccounting();

      // Only recompute if not frozen (or if first time)
      if (!resolve(this._freeze) || this._blockarray === null) {
        const form = normalizeSum(resolve(this._timelinefunc));
        this._blockarray = form.map((prop, i) =>
          this._blockfunc(this.currphraselength * prop, i),
        );
      }
    }

    const beatsleft = this.currphraselength - this.phrasepos;

    let cuts = (this._blockarray![this.block] ?? [beatsleft]).slice();
    this.blocklength = sum(cuts);

    // Trim if block exceeds remaining beats
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
