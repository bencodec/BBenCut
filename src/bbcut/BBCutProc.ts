import { resolve } from './helpers.js';
import type { Cut, Resolvable, BBCutListener } from './types.js';

/**
 * Base class for all cut procedures.
 * Also acts as the identity "NoCutProc" — one cut per phrase equal to the
 * entire phrase length.
 */
export class BBCutProc {
  // ── State visible to subclasses and callers ─────────────────────────────
  phrase = 0;
  block = 0;
  beatspersubdiv: number;
  phraselength: Resolvable<number>;
  phrasepos = 0.0;
  currphraselength = 0.0;
  totalbeatsdone = 0.0;

  /** The cut durations (in beats) produced by the last chooseblock() call. */
  cuts: Cut[] = [];

  /** Total beat length of the current block. */
  blocklength = 0;

  protected _listener: BBCutListener | null = null;

  constructor(
    beatsPerSubdiv: number = 0.5,
    phraseLength: Resolvable<number> = 4.0,
  ) {
    this.beatspersubdiv = beatsPerSubdiv;
    this.phraselength = phraseLength;
  }

  /** Attach a listener that receives phrase/block/offset callbacks. */
  attachListener(listener: BBCutListener): void {
    this._listener = listener;
  }

  /** Produce the next block of cuts. Updates this.cuts and this.blocklength. */
  chooseblock(): void {
    this.newPhraseAccounting();
    this.blocklength = this.currphraselength;
    this.cuts = [this.blocklength];
    this._listener?.chooseoffset?.(
      this.phrasepos,
      this.beatspersubdiv,
      this.currphraselength,
    );
    this.updateblock();
    this.endBlockAccounting();
  }

  /** Returns 1 when the current phrase is exhausted, 0 otherwise. */
  phraseover(): 0 | 1 {
    return this.currphraselength - this.phrasepos < 0.00001 ? 1 : 0;
  }

  // ── Protected accounting helpers ─────────────────────────────────────────

  protected updateblock(isroll = 0): void {
    this._listener?.updateblock?.(
      this.block,
      this.phrasepos / this.currphraselength,
      this.cuts,
      isroll,
    );
  }

  /** Begin a new phrase. Pass cpl to override the phraselength for this phrase. */
  protected newPhraseAccounting(cpl?: number): void {
    this.currphraselength = cpl ?? resolve(this.phraselength);
    this._listener?.updatephrase?.(this.phrase, this.currphraselength);
    this.phrasepos = 0.0;
    this.phrase += 1;
    this.block = 0;
  }

  protected endBlockAccounting(): void {
    this.phrasepos += this.blocklength;
    this.totalbeatsdone += this.blocklength;
    this.block += 1;
  }
}
