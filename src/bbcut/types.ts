// A value that can be either a plain value or a zero-argument function
// returning that value — mirrors SC's .value dispatch.
export type Resolvable<T> = T | (() => T);

// Most cut procedures output plain beat durations (IOIs).
export type SimpleCut = number;

// Some procedures (ThrashCutProc1, SQPusher2) output the extended
// four-element form: [ioi, duration, offset | null, amp]
// where offset null means "let the renderer decide".
export type ExtendedCut = readonly [
  ioi: number,
  duration: number,
  offset: number | null,
  amp: number,
];

export type Cut = SimpleCut | ExtendedCut;

// Callback interface attached to a procedure.
// All methods are optional — implement only what you need.
export interface BBCutListener {
  /** Called at the start of each new phrase. */
  updatephrase?(phrase: number, phraseLength: number): void;

  /** Called at the start of each block with the cut schedule for that block.
   *  isroll = 1 when the block is a repeats / roll. */
  updateblock?(
    block: number,
    phraseProp: number,
    cuts: Cut[],
    isroll: number,
  ): void;

  /** Called so the renderer can pick a playback offset.
   *  phrasepos and phraseLength are in beats. */
  chooseoffset?(
    phrasepos: number,
    beatsPerSubdiv: number,
    phraseLength: number,
  ): void;

  /** Called by procedures that manage their own offsets (RecCutProc,
   *  RecursiveCutProc1, CampCutProc, BBCPPermute, OffsetCP1).
   *  prop is a proportion (0–1) through the source buffer. */
  setoffset?(prop: number, phraseLength?: number): void;
}
