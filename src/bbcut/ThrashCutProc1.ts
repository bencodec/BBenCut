import { BBCutProc } from './BBCutProc.js';
import { coin, resolve, scramble } from './helpers.js';
import type { ExtendedCut, Resolvable } from './types.js';

// Database entry shorthand:
//   [blockLen, type]
//   [blockLen, type, duty]
//   [blockLen, type, duty, amp]
//   [blockLen, 5, subdivCount, kickOrSnare]
//   [blockLen, 5, subdivCount, kickOrSnare, duty]
//   [blockLen, 5, subdivCount, kickOrSnare, duty, amp]
type RiffEntry = number[];

// type codes
const SINGLE_KICK = 0;
const SINGLE_SNARE = 1;
const ROLL_KICK = 2;
const ROLL_SNARE = 3;
const PRESCRIBED = 5;

type RiffSelector =
  | number
  | ((prev: number, size: number) => number);

export interface ThrashCutProc1Options {
  /** Offset (proportion 0–1) for kick hits. Default: 0.0 */
  kickoffset?: Resolvable<number>;
  /** Offset (proportion 0–1) for snare hits. Default: 0.125 */
  snareoffset?: Resolvable<number>;
  /** Total phrase length in beats (default 4.0) */
  phraselength?: Resolvable<number>;
  /** Proportions for triplet rolls within a block. Default: [0.34, 0.33, 0.33]. */
  blockdiv?: Resolvable<number[]>;
  /** Selects the next riff index from the database.
   *  A plain number always returns that fixed index.
   *  A function receives (prevIndex, databaseSize) and returns a new index.
   *  Default: 0. */
  chooseriff?: RiffSelector;
  /** Number of random swaps applied to the riff sequence each phrase.
   *  Default: 1. */
  shuffles?: Resolvable<number>;
  /** Returns true when the phrase should be a "fill" (kick/snare roles inverted).
   *  Default: () => coin(0.125). */
  filltest?: () => boolean;
  /** Probability of a randomly silent block within the phrase (default 0.125). */
  stopchance?: Resolvable<number>;
}

/**
 * Drum-machine style cut procedure.
 *
 * Selects kick/snare patterns from a built-in riff database, supports rolls,
 * fills (inverted kick/snare), random silences, and triplet subdivisions.
 * Outputs ExtendedCut arrays with explicit [ioi, duration, offset, amp].
 */
export class ThrashCutProc1 extends BBCutProc {
  private _kickoffset: Resolvable<number>;
  private _snareoffset: Resolvable<number>;
  private readonly _blockdiv: Resolvable<number[]>;
  private readonly _chooseriff: RiffSelector;
  private readonly _shuffles: Resolvable<number>;
  private readonly _filltest: () => boolean;
  private _stopchance: Resolvable<number>;

  // Mutable riff database — public so callers can extend it
  database: RiffEntry[][];

  private _whichriff: number;
  private _cutsequence: Array<[blockLen: number, cuts: ExtendedCut[]]> = [];
  private _fillflag = false;
  private _didstop = 0;

  // ── Default riff database (4 patterns) ──────────────────────────────────
  private static readonly DEFAULT_DB: RiffEntry[][] = [
    [
      [1.0, ROLL_KICK],
      [2.0, SINGLE_SNARE, 1.0],
      [1.0, ROLL_KICK],
      [4.0, PRESCRIBED, 4, SINGLE_KICK, 1.0, 1.0],
    ],
    [
      [0.5, ROLL_KICK],
      [1.0, SINGLE_SNARE, 0.25],
      [0.5, ROLL_KICK],
      [0.5, ROLL_KICK],
      [0.5, ROLL_KICK],
      [0.25, SINGLE_SNARE, 1.0, 0.0],
      [0.75, SINGLE_SNARE],
    ],
    [
      [0.5, ROLL_KICK],
      [0.5, ROLL_KICK],
      [0.5, ROLL_KICK],
      [0.5, ROLL_KICK],
      [0.5, SINGLE_SNARE],
      [0.5, ROLL_KICK],
      [0.5, SINGLE_SNARE],
      [0.5, ROLL_KICK],
    ],
    [
      [0.5, ROLL_KICK],
      [1.0, SINGLE_SNARE],
      [0.5, ROLL_KICK],
      [0.5, SINGLE_SNARE],
      [0.5, ROLL_KICK],
      [1.0, SINGLE_SNARE],
    ],
  ];

  constructor({
    kickoffset = 0.0,
    snareoffset = 0.125,
    phraselength = 4.0,
    blockdiv = [0.34, 0.33, 0.33],
    chooseriff = 0,
    shuffles = 1,
    filltest = () => coin(0.125),
    stopchance = 0.125,
  }: ThrashCutProc1Options = {}) {
    super(0.5, phraselength);
    this._kickoffset = kickoffset;
    this._snareoffset = snareoffset;
    this._blockdiv = blockdiv;
    this._chooseriff = chooseriff;
    this._shuffles = shuffles;
    this._filltest = filltest;
    this._stopchance = stopchance;

    this.database = ThrashCutProc1.DEFAULT_DB.map((riff) =>
      riff.map((entry) => entry.slice()),
    );
    this._whichriff = Math.floor(Math.random() * this.database.length);
  }

  // ── Internal: expand a riff entry into ExtendedCuts ─────────────────────

  private calcblock(entry: RiffEntry): [blockLen: number, cuts: ExtendedCut[]] {
    // Deep copy so fill-inversion mutations don't affect the source
    const next = entry.slice();
    const bl = next[0]!;
    let type = next[1]!;

    // Fill: invert kick ↔ snare roles
    if (this._fillflag) {
      if (type === SINGLE_KICK) type = SINGLE_SNARE;
      else if (type === SINGLE_SNARE) type = SINGLE_KICK;
      else if (type === ROLL_KICK) type = ROLL_SNARE;
      else if (type === ROLL_SNARE) type = ROLL_KICK;
      else if (type === PRESCRIBED) {
        // For prescribed blocks the kick/snare is in position 3
        if (next[3] === SINGLE_KICK) next[3] = SINGLE_SNARE;
        else if (next[3] === SINGLE_SNARE) next[3] = SINGLE_KICK;
      }
      next[1] = type;
    }

    let amp = 0.8;
    let duty = 1.0;
    let rawOffset: number;

    if (type < PRESCRIBED) {
      if (next.length === 4) amp = next[3]!;
      if (next.length > 2) duty = next[2]!;
      rawOffset = type % 2; // 0 → kick, 1 → snare
    } else {
      if (next.length === 6) amp = next[5]!;
      if (next.length > 4) duty = next[4]!;
      rawOffset = next[3]!; // explicit 0/1
    }

    // Random silent block
    if (this._didstop === 0 && coin(resolve(this._stopchance))) {
      this._didstop = 1;
      amp = 0.0;
    }

    const offset =
      rawOffset < 0.5
        ? resolve(this._kickoffset)
        : resolve(this._snareoffset);

    // Compute inter-onset durations
    let durs: number[];
    if (type > 1.5) {
      if (type === PRESCRIBED) {
        // Evenly divide bl into next[2] equal parts
        const count = next[2]!;
        durs = Array.from({ length: count }, () => bl / count);
      } else {
        // Roll: use blockdiv proportions
        const divs = resolve(this._blockdiv);
        durs = divs.map((p) => bl * p);
      }
    } else {
      durs = [bl]; // single hit
    }

    const cuts: ExtendedCut[] = durs.map((d, i) => [
      d,
      d * duty,
      offset,
      // Accent the first hit in any group
      i === 0 ? amp * 1.1 : amp,
    ]);

    return [bl, cuts];
  }

  chooseblock(): void {
    // New phrase — pre-compute the entire phrase's block sequence
    if (this.phrasepos >= this.currphraselength - 0.001) {
      this.newPhraseAccounting();

      this._fillflag = this._filltest();
      this._didstop = 0;

      // Select riff
      const prevRiff = this._whichriff;
      this._whichriff =
        typeof this._chooseriff === 'function'
          ? this._chooseriff(prevRiff, this.database.length)
          : this._chooseriff;

      let currriff = (
        this.database[this._whichriff % this.database.length] ??
        this.database[0]!
      ).map((e) => e.slice());

      // Shuffle
      const shuffleCount = Math.round(resolve(this._shuffles));
      for (let i = 0; i < shuffleCount; i++) {
        const a = Math.floor(Math.random() * currriff.length);
        const b = Math.floor(Math.random() * currriff.length);
        [currriff[a], currriff[b]] = [currriff[b]!, currriff[a]!];
      }

      // Expand entries into blocks that fill the phrase exactly
      this._cutsequence = [];
      let done = 0;
      let seqIdx = 0;

      while (done < this.currphraselength - 0.001) {
        const left = this.currphraselength - done;
        const entry = currriff[seqIdx % currriff.length]!;
        seqIdx++;

        let [blocklen, cuts] = this.calcblock(entry.slice());

        if (blocklen > left) {
          // Pad with silence to fill the remainder
          blocklen = left;
          cuts = [[left, left, 0, 0.0]];
        }

        this._cutsequence.push([blocklen, cuts]);
        done += blocklen;
      }
    }

    const beatsleft = this.currphraselength - this.phrasepos;
    const current = this._cutsequence[this.block];

    if (!current) {
      // Safety fallback
      this.cuts = [[beatsleft, beatsleft, 0, 1.0]];
      this.blocklength = beatsleft;
    } else {
      this.cuts = current[1];
      this.blocklength = Math.min(current[0], beatsleft);
    }

    this.updateblock(this.cuts.length > 1 ? 1 : 0);
    this.endBlockAccounting();
  }
}
