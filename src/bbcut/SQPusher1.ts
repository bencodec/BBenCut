import { BBCutProc } from './BBCutProc.js';
import { choose, coin, resolve, sum } from './helpers.js';
import type { Resolvable } from './types.js';

export interface SQPusher1Options {
  /** Controls the density of semiquaver (16th-note) activity (0–1, default 0.1). */
  activity?: Resolvable<number>;
  /** A fill is triggered every N phrases (default 4). */
  fillfreq?: Resolvable<number>;
  /** Probability of scrambling the fill's block order (default 0.0). */
  fillscramble?: Resolvable<number>;
  /** Per-quaver weighting that scales the probability of a 16th-note event.
   *  8 weights for quavers 0–7 within a bar.
   *  Default: [0, 0.3, 0, 0.5, 0.7, 0.8, 0.9, 0.6] */
  sqweights?: number[];
  /** Beats per subdivision (default 0.5) */
  bpsd?: number;
}

/**
 * Squarepusher-inspired breakbeat procedure.
 *
 * Standard bars feature probabilistic 8th- and 16th-note groupings weighted
 * towards the back of the bar.  Every fillfreq phrases a hand-transcribed fill
 * pattern is inserted instead.
 */
export class SQPusher1 extends BBCutProc {
  private readonly _activity: Resolvable<number>;
  private readonly _fillfreq: Resolvable<number>;
  private readonly _fillscramble: Resolvable<number>;
  private readonly _sqweights: number[];

  // Pre-computed fill patterns (authentic Squarepusher transcriptions)
  private static readonly FILLS: number[][][] = [
    [[0.75, 0.75, 0.75, 0.75], [1.0]],
    [[0.5, 1.0], [1.0], [1.0, 0.5]],
    [[0.5], [1.0, 1.0, 1.0], [0.5]],
    [
      [0.571429],
      [0.571429, 0.571429],
      [0.571429, 0.571429],
      [0.571429],
      [0.285714, 0.285716],
    ],
    [[1.0, 0.5], [1.0, 0.5], [0.5, 0.5]],
    [[0.5, 0.5], [0.66, 0.67, 0.67], [1.01]],
    [[0.34], [0.33, 0.33], [0.34, 0.33], [2.33]],
    [[1.4], [0.4, 0.4], [0.6, 0.2], [1.0]],
    [[0.167, 0.167, 0.166], [1.0, 1.0, 1.0], [0.5]],
    [[1.5, 0.5, 1.0], [0.25, 0.25, 0.25, 0.25]],
    [[0.2, 0.2], [0.4, 0.4], [0.4, 0.4], [2.0]],
    [[0.75, 0.75, 1.0], [0.25, 0.25, 0.25, 0.25, 0.25, 0.25]],
    [[0.5, 1.0], [0.5], [0.125, 0.125, 0.125, 0.125], [1.0], [0.167, 0.167, 0.166]],
  ];

  // Pre-computed block sequence for the current phrase
  private _cutsequence: number[][] = [];

  constructor({
    activity = 0.1,
    fillfreq = 4,
    fillscramble = 0.0,
    sqweights = [0.0, 0.3, 0.0, 0.5, 0.7, 0.8, 0.9, 0.6],
    bpsd = 0.5,
  }: SQPusher1Options = {}) {
    super(bpsd, 4.0); // phrase length is always 4 beats (one bar)
    this._activity = activity;
    this._fillfreq = fillfreq;
    this._fillscramble = fillscramble;
    this._sqweights = sqweights;
  }

  chooseblock(): void {
    // New phrase (always 4 beats = one bar)
    if (this.phrasepos >= this.currphraselength - 0.001) {
      this.newPhraseAccounting();

      if (this.phrase % resolve(this._fillfreq) === 0) {
        // ── FILL phrase ────────────────────────────────────────────────────
        let seq = choose(SQPusher1.FILLS);
        if (coin(resolve(this._fillscramble))) {
          // Scramble block order within the fill
          seq = seq.slice().sort(() => Math.random() - 0.5);
        }
        this._cutsequence = seq;
      } else {
        // ── STANDARD phrase ────────────────────────────────────────────────
        // Build a bar of 8th- and 16th-note groups weighted by activity
        this._cutsequence = [];
        let done = 0;

        while (done < 4.0) {
          const beatpos = (Math.round(done / 0.25) * 0.25) % 1.0;
          const quaver = (Math.round(done / 0.5) * 2) % 8;
          const sqchance = this._sqweights[quaver]! * resolve(this._activity);

          // At the half-beat, always use a single 8th note
          let groupLen: number;
          if (beatpos === 0.5) {
            groupLen = 1;
          } else {
            groupLen = Math.floor(Math.random() * 2) + 1; // 1 or 2
          }

          const cuts = coin(sqchance)
            ? Array.from({ length: groupLen * 2 }, () => 0.25) // 16th notes
            : Array.from({ length: groupLen }, () => 0.5); // 8th notes

          this._cutsequence.push(cuts);
          done += sum(cuts);
        }
      }
    }

    const beatsleft = this.currphraselength - this.phrasepos;
    let cuts = (this._cutsequence[this.block] ?? [beatsleft]).slice();
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

    this._listener?.chooseoffset?.(
      this.phrasepos,
      this.beatspersubdiv,
      this.currphraselength,
    );
    this.updateblock();
    this.endBlockAccounting();
  }
}
