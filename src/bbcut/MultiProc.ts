import { BBCutProc } from './BBCutProc.js';
import type { BBCutListener } from './types.js';

export interface MultiProcOptions {
  /** The pool of cut procedures to choose from. */
  procs: BBCutProc[];
  /** Called when a phrase ends to select the next procedure.
   *  Receives no arguments; return an index into procs.
   *  Only used when blockfunc is not provided.
   *  Default: random index. */
  phrasefunc?: () => number;
  /** Called before every block to select a procedure.
   *  When provided, phrasefunc is ignored.
   *  Return an index into procs. */
  blockfunc?: () => number;
}

/**
 * Meta-procedure that switches between other cut procedures.
 *
 * In phrase mode (phrasefunc only): switches procedure at phrase boundaries.
 * In block mode (blockfunc): switches procedure before every block — the
 * notion of phrase completion is ignored.
 *
 * The listener is shared across all child procedures so callbacks reflect
 * whichever child is currently active.
 */
export class MultiProc extends BBCutProc {
  private readonly _procs: BBCutProc[];
  private readonly _phrasefunc: (() => number) | null;
  private readonly _blockfunc: (() => number) | null;

  private _currproc: BBCutProc;

  constructor({ procs, phrasefunc, blockfunc }: MultiProcOptions) {
    super();
    this._procs = procs;
    this._blockfunc = blockfunc ?? null;
    // Default phrasefunc: random
    this._phrasefunc =
      phrasefunc ?? (() => Math.floor(Math.random() * procs.length));

    // Start with a random procedure
    this._currproc =
      procs[Math.floor(Math.random() * procs.length)] ?? procs[0]!;
  }

  /** Attach the listener to every child procedure. */
  override attachListener(listener: BBCutListener): void {
    super.attachListener(listener);
    for (const proc of this._procs) {
      proc.attachListener(listener);
    }
  }

  override chooseblock(): void {
    if (this._blockfunc !== null) {
      // BLOCK mode — switch procedure before every block
      this._currproc = this._procs[this._blockfunc()]!;
    } else {
      // PHRASE mode — switch only at phrase boundaries
      if (this._currproc.phraseover() === 1) {
        const idx = this._phrasefunc!();
        this._currproc = this._procs[idx]!;
        // Manual phrase accounting (skip calling newPhraseAccounting to
        // avoid double-triggering updatephrase — the child will do it)
        this.phrasepos = 0.0;
        this.phrase += 1;
        this.block = 0;
      }
    }

    // Delegate cut generation to the current child procedure
    this._currproc.chooseblock();
    this.cuts = this._currproc.cuts;
    this.blocklength = this._currproc.blocklength;

    this.endBlockAccounting();
  }

  override phraseover(): 0 | 1 {
    return this._currproc.phraseover();
  }
}
