import { BBCutProc } from './BBCutProc.js';
import { coin, intDiv, rand, rrand, resolve } from './helpers.js';
import type { Resolvable } from './types.js';

export interface BBCutProc11Options {
  /** Subdivisions per bar (default 8 = quavers in 4/4) */
  sdiv?: Resolvable<number>;
  /** Beats per bar (default 4.0) */
  barlength?: Resolvable<number>;
  /** Number of bars per phrase (default 3) */
  phrasebars?: Resolvable<number>;
  /** Number of times each unit block repeats.
   *  Defaults to () => rand(2) + 1  (1 or 2 repeats). */
  numrepeats?: Resolvable<number>;
  /** Probability of a repeats effect near phrase end (default 0.2) */
  repeatschance?: Resolvable<number>;
  /** Speed multiplier for repeats — integer, default 2 */
  repeatsspeed?: Resolvable<number>;
  /** Fraction of subdivisions at phrase tail where repeats is allowed (default 0.5) */
  repeatsarea?: Resolvable<number>;
}

/**
 * The classic BBCut algorithm ("BreakBeatx").
 *
 * Subdivides each bar into a grid of equal units. Each block selects an
 * odd-numbered count of consecutive units, repeats it 1–2 times, then
 * advances. Near the phrase end there is a chance of repeats: the
 * remaining units play at a faster subdivision speed.
 */
export class BBCutProc11 extends BBCutProc {
  private readonly _sdiv: Resolvable<number>;
  private readonly _barlength: Resolvable<number>;
  private readonly _phrasebars: Resolvable<number>;
  private readonly _numrepeats: Resolvable<number>;
  private readonly _repeatschance: Resolvable<number>;
  private readonly _repeatsspeed: Resolvable<number>;
  private readonly _repeatsarea: Resolvable<number>;

  // State persisting across blocks within a phrase
  private _subdiv = 0;
  private _unitsdone = 0;
  private _totalunits = 0;
  private _repeatson = 0;

  constructor({
    sdiv = 8,
    barlength = 4.0,
    phrasebars = 3,
    numrepeats = () => rand(2) + 1,
    repeatschance = 0.2,
    repeatsspeed = 2,
    repeatsarea = 0.5,
  }: BBCutProc11Options = {}) {
    super();
    this._sdiv = sdiv;
    this._barlength = barlength;
    this._phrasebars = phrasebars;
    this._numrepeats = numrepeats;
    this._repeatschance = repeatschance;
    this._repeatsspeed = repeatsspeed;
    this._repeatsarea = repeatsarea;
  }

  chooseblock(): void {
    let unitblock: number;
    let repeats: number;

    // ── New phrase? ────────────────────────────────────────────────────────
    if (this._unitsdone >= this._totalunits - 0.000001) {
      const subdiv = Math.round(resolve(this._sdiv));
      const sdivbeats = resolve(this._barlength);
      const numbarsnow = Math.round(resolve(this._phrasebars));

      this._subdiv = subdiv;
      this._totalunits = numbarsnow * subdiv;
      this.currphraselength = sdivbeats * numbarsnow;

      this.newPhraseAccounting(this.currphraselength);

      this.beatspersubdiv = sdivbeats / subdiv;
      this._unitsdone = 0;
    }

    const unitsleft = this._totalunits - this._unitsdone;

    // ── Repeats or normal block? ───────────────────────────────────────────
    if (
      coin(resolve(this._repeatschance)) &&
      unitsleft < resolve(this._repeatsarea) * this._subdiv
    ) {
      // REPEATS — rapid-fire repeats of a tiny slice filling the remainder
      const stutsp = Math.round(resolve(this._repeatsspeed));
      repeats = unitsleft * stutsp;
      unitblock = 1.0 / stutsp;
      this.blocklength = this.currphraselength - this.phrasepos; // remainder
      this._unitsdone = this._totalunits;
      this._repeatson = 1;
    } else {
      // NORMAL — odd-numbered unit blocks, 1–2 repeats
      this._repeatson = 0;

      // Maximum odd-block size: derived from subdiv via a halving chain
      let oddmax = intDiv(this._subdiv, 2);
      oddmax =
        oddmax % 2 === 0
          ? intDiv(oddmax - 2, 2)
          : intDiv(oddmax - 1, 2);

      // Pick a random odd block count (1, 3, 5, ... up to 2*oddmax+1)
      unitblock = rrand(0, oddmax);
      unitblock = 2 * unitblock + 1;

      // Shrink until it fits in remaining units
      while (unitblock > unitsleft) unitblock -= 2;

      repeats = Math.round(resolve(this._numrepeats));

      let unitproj = repeats * unitblock + this._unitsdone;
      while (unitproj > this._totalunits) {
        repeats -= 1;
        if (repeats <= 1) {
          repeats = 1;
          unitblock = unitsleft;
        }
        unitproj = repeats * unitblock + this._unitsdone;
      }

      this.blocklength = repeats * unitblock * this.beatspersubdiv;

      // Use remainder for final block to avoid floating-point drift
      if (unitproj === this._totalunits) {
        this.blocklength = this.currphraselength - this.phrasepos;
      }

      this._unitsdone += repeats * unitblock;
    }

    this._listener?.chooseoffset?.(
      this.phrasepos,
      this.beatspersubdiv,
      this.currphraselength,
    );

    // Each cut in the block is one repeat of unitblock-length
    const cutLength = unitblock * this.beatspersubdiv;
    this.cuts = Array.from({ length: repeats }, () => cutLength);

    this.updateblock(this._repeatson);
    this.endBlockAccounting();
  }
}
