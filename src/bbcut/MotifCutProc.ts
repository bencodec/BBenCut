import { BBCutProc } from './BBCutProc.js';
import { rand, resolve, sum } from './helpers.js';
import type { Resolvable } from './types.js';

/** A motif is an array of blocks; each block is an array of cut durations. */
export type Motif = number[][];

export interface MotifCutProcOptions {
  /** Array of motifs to choose from.
   *  Default: one motif with two blocks — [1.5, 1.5] and [1.0]. */
  motiflist?: Motif[];
  /** Returns the index of the next motif to play, given the motiflist.
   *  Default: random index. */
  indexfunc?: (motiflist: Motif[]) => number;
  /** Total phrase length in beats (default 8.0) */
  phraselength?: Resolvable<number>;
  /** Beats per subdivision (default 0.5) */
  bpsd?: number;
}

/**
 * Motif-driven cut procedure.
 * Plays pre-defined sequences of cut patterns (motifs) in order,
 * cycling through a motif library one block at a time.
 * If a motif block doesn't fit in the remaining phrase beats it is
 * trimmed to fit.
 */
export class MotifCutProc extends BBCutProc {
  private readonly _motiflist: Motif[];
  private readonly _indexfunc: (motiflist: Motif[]) => number;

  private _motifpos = 0;
  private _motifsize = 0;
  private _currmotif: number[][] = [];

  constructor({
    motiflist,
    indexfunc,
    phraselength = 8.0,
    bpsd = 0.5,
  }: MotifCutProcOptions = {}) {
    super(bpsd, phraselength);
    this._motiflist = motiflist ?? [[[1.5, 1.5], [1.0]]];
    this._indexfunc = indexfunc ?? ((ml) => rand(ml.length));
  }

  chooseblock(): void {
    // New phrase?
    if (this.phrasepos >= this.currphraselength) {
      this.newPhraseAccounting();
      // Force advance to the next motif when a phrase ends
      this._motifpos = this._motifsize;
    }

    const beatsleft = this.currphraselength - this.phrasepos;

    // New motif?
    if (this._motifpos >= this._motifsize) {
      const idx = this._indexfunc(this._motiflist);
      this._currmotif = this._motiflist[idx] ?? this._motiflist[0]!;
      this._motifsize = this._currmotif.length;
      this._motifpos = 0;
    }

    // Fetch the next block from the motif
    let cuts = (this._currmotif[this._motifpos] ?? [beatsleft]).slice();
    this._motifpos += 1;

    this.blocklength = sum(cuts);

    // If the block doesn't fit in the remaining phrase beats, trim it
    if (this.blocklength > beatsleft) {
      let accumulated = 0;
      let cutoffIndex = 0;
      let overflow = 0;

      for (let i = 0; i < cuts.length; i++) {
        accumulated += cuts[i]!;
        if (accumulated >= beatsleft) {
          cutoffIndex = i;
          overflow = accumulated - beatsleft;
          break;
        }
      }

      cuts = cuts.slice(0, cutoffIndex + 1);
      cuts[cutoffIndex] = (cuts[cutoffIndex] ?? 0) - overflow;
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
