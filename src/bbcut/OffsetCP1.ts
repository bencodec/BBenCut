import { BBCutProc } from './BBCutProc.js';
import { resolve, sum } from './helpers.js';
import type { Resolvable } from './types.js';

export interface OffsetCP1Options {
  /** Returns [cuts, offset] for the current block.
   *  cuts is an array of beat durations; offset is a 0–1 proportion.
   *  Receives (beatsLeft, phraseLength, blockIndex).
   *  Default: one cut equal to beatsLeft, offset 0. */
  dofunc?: (beatsLeft: number, phraseLength: number, block: number) => [number[], number];
  /** Scales the offset value returned by dofunc (default 1.0) */
  offsetscale?: Resolvable<number>;
  /** Scales the cut durations returned by dofunc (default 1.0) */
  durationscale?: Resolvable<number>;
  /** Total phrase length in beats (default 8.0) */
  phraselength?: Resolvable<number>;
  /** Beats per subdivision (default 0.5) */
  bpsd?: number;
}

/**
 * Combined duration + offset cut procedure.
 *
 * A single function (dofunc) returns both the cut durations and the playback
 * offset for each block, allowing tightly coupled duration/offset decisions.
 * The offset is communicated via the listener's setoffset callback.
 */
export class OffsetCP1 extends BBCutProc {
  private readonly _dofunc: (
    beatsLeft: number,
    phraseLength: number,
    block: number,
  ) => [number[], number];
  private readonly _offsetscale: Resolvable<number>;
  private readonly _durationscale: Resolvable<number>;

  constructor({
    dofunc,
    offsetscale = 1.0,
    durationscale = 1.0,
    phraselength = 8.0,
    bpsd = 0.5,
  }: OffsetCP1Options = {}) {
    super(bpsd, phraselength);
    this._dofunc =
      dofunc ?? ((left, _len, _block) => [[left], 0.0]);
    this._offsetscale = offsetscale;
    this._durationscale = durationscale;
  }

  chooseblock(): void {
    // New phrase?
    if (this.phrasepos >= this.currphraselength) {
      this.newPhraseAccounting();
    }

    const beatsleft = this.currphraselength - this.phrasepos;

    const [rawCuts, rawOffset] = this._dofunc(
      beatsleft,
      this.currphraselength,
      this.block,
    );

    const scale = resolve(this._durationscale);
    let cuts = rawCuts.map((c) => c * scale);
    this.blocklength = sum(cuts);

    // Trim if over the phrase end
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

    const offset = rawOffset * resolve(this._offsetscale);
    this._listener?.setoffset?.(offset, this.currphraselength);

    this.updateblock();
    this.endBlockAccounting();
  }
}
