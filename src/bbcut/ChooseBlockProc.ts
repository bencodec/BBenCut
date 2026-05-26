import { BBCutProc } from './BBCutProc.js';
import { choose, resolve, wchoose } from './helpers.js';
import type { Resolvable } from './types.js';

export interface ChooseBlockProcOptions {
  /** Returns a block size in beats given (beatsLeft, phraseLength).
   *  Default: weighted choice of 0.5, 1, or 2 beats (50/40/10%). */
  blocksizefunc?: (beatsLeft: number, phraseLength: number) => number;
  /** Returns the number of equal cuts to divide the block into given (blocksize).
   *  Default: 4/8/16 for small blocks, 8/16/32 for larger. */
  numcutfunc?: (blocksize: number) => number;
  /** Total phrase length in beats (default 12.0) */
  phraselength?: Resolvable<number>;
  /** Beats per subdivision (default 0.5) */
  bpsd?: number;
}

/**
 * A simplified WarpCutProc1.
 * Chooses a block size then divides it into equal cuts.
 * No rolls; straightforward for learning and testing.
 */
export class ChooseBlockProc extends BBCutProc {
  private readonly _blocksizefunc: (
    beatsLeft: number,
    phraseLength: number,
  ) => number;
  private readonly _numcutfunc: (blocksize: number) => number;

  constructor({
    blocksizefunc,
    numcutfunc,
    phraselength = 12.0,
    bpsd = 0.5,
  }: ChooseBlockProcOptions = {}) {
    super(bpsd, phraselength);
    this._blocksizefunc =
      blocksizefunc ??
      ((left, _len) => wchoose([0.5, 1, 2], [0.5, 0.4, 0.1]));
    this._numcutfunc =
      numcutfunc ??
      ((size) =>
        size < 1.0 ? choose([4, 8, 16]) : choose([8, 16, 32]));
  }

  chooseblock(): void {
    // New phrase?
    if (this.phrasepos >= this.currphraselength) {
      this.newPhraseAccounting();
    }

    const beatsleft = this.currphraselength - this.phrasepos;

    this.blocklength = this._blocksizefunc(beatsleft, this.currphraselength);
    if (this.blocklength > beatsleft) this.blocklength = beatsleft;

    const repeats = this._numcutfunc(this.blocklength);
    const cutsize = this.blocklength / repeats;

    this.cuts = Array.from({ length: repeats }, () => cutsize);
    // Correct the last cut for floating-point drift
    this.cuts[repeats - 1] =
      cutsize + (this.blocklength - cutsize * repeats);

    this._listener?.chooseoffset?.(
      this.phrasepos,
      this.beatspersubdiv,
      this.currphraselength,
    );
    this.updateblock();
    this.endBlockAccounting();
  }
}
