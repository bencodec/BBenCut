import { BBCutProc } from './BBCutProc.js';
import { choose, coin, resolve, wchoose } from './helpers.js';
import type { Resolvable } from './types.js';

export interface WarpCutProc1Options {
  /** Returns a block size in beats given (beatsLeft, phraseLength).
   *  Default: weighted choice of 0.5 / 1 / 2 beats. */
  blocksizefunc?: (beatsLeft: number, phraseLength: number) => number;
  /** Returns the number of roll subdivisions given (blocksize).
   *  Default: 4/8/16 for small blocks, 8/16/32 for larger. */
  rollfunc?: (blocksize: number) => number;
  /** Three probabilities:
   *   [0] chance of a straight (non-roll) section (default 0.5),
   *   [1] chance of a straight (arithmetic) roll vs geometric (default 0.7),
   *   [2] chance of acceleration (increasing) vs ritard (default 0.6).
   *  Each can be a Resolvable<number>. */
  probs?: [Resolvable<number>, Resolvable<number>, Resolvable<number>];
  /** Total phrase length in beats (default 12.0) */
  phraselength?: Resolvable<number>;
  /** Geometric acceleration factor for rolls (0 < accel < 1, default 0.9).
   *  Values closer to 1 give a more gradual acceleration. */
  accel?: Resolvable<number>;
  /** Beats per subdivision (default 0.5) */
  bpsd?: number;
}

/**
 * Warp cut procedure.
 * Produces blocks that can be straight single cuts, straight rolls
 * (arithmetic spacing), or warped rolls (geometric spacing — accelerating
 * or decelerating).
 */
export class WarpCutProc1 extends BBCutProc {
  private readonly _blocksizefunc: (
    beatsLeft: number,
    phraseLength: number,
  ) => number;
  private readonly _rollfunc: (blocksize: number) => number;
  private readonly _probs: [
    Resolvable<number>,
    Resolvable<number>,
    Resolvable<number>,
  ];
  private readonly _accel: Resolvable<number>;

  private _rollon = 0;

  constructor({
    blocksizefunc,
    rollfunc,
    probs = [0.5, 0.7, 0.6],
    phraselength = 12.0,
    accel = 0.9,
    bpsd = 0.5,
  }: WarpCutProc1Options = {}) {
    super(bpsd, phraselength);
    this._blocksizefunc =
      blocksizefunc ??
      ((left, _len) => wchoose([0.5, 1, 2], [0.5, 0.4, 0.1]));
    this._rollfunc =
      rollfunc ??
      ((size) =>
        size < 1.0 ? choose([4, 8, 16]) : choose([8, 16, 32]));
    this._probs = probs;
    this._accel = accel;
  }

  chooseblock(): void {
    // New phrase?
    if (this.phrasepos >= this.currphraselength - 0.0001) {
      this.newPhraseAccounting();
    }

    const beatsleft = this.currphraselength - this.phrasepos;

    this.blocklength = this._blocksizefunc(beatsleft, this.currphraselength);
    if (this.blocklength > beatsleft) this.blocklength = beatsleft;

    if (coin(resolve(this._probs[0]))) {
      // STRAIGHT — single cut
      this._rollon = 0;
      this.cuts = [this.blocklength];
    } else {
      // ROLL
      this._rollon = 1;
      const repeats = this._rollfunc(this.blocklength);

      if (coin(resolve(this._probs[1]))) {
        // Arithmetic roll (equal spacing)
        const cutsize = this.blocklength / repeats;
        this.cuts = Array.from({ length: repeats }, () => cutsize);
      } else {
        // Geometric roll (accelerating or decelerating)
        const acctemp = resolve(this._accel);
        const temp =
          (this.blocklength * (1 - acctemp)) /
          (1 - Math.pow(acctemp, repeats));
        let cuts = Array.from(
          { length: repeats },
          (_, i) => temp * Math.pow(acctemp, i),
        );
        // Coin decides accel (ascending) vs ritard (descending)
        if (coin(resolve(this._probs[2]))) {
          cuts = cuts.reverse();
        }
        this.cuts = cuts;
      }
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
