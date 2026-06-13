import type { BBCutProc } from "./bbcut/BBCutProc.js";
import type { Cut, ExtendedCut } from "./bbcut/types.js";
import type { RollRenderCut } from "./audio.js";

export interface BlockEvent {
  offset: number;
  cuts: Cut[];
  blocklength: number;
  isStutter: boolean;
}

export interface ClipLoopSettings {
  looping: boolean;
  startMarker: number;
  endMarker: number;
  loopStart: number;
  loopEnd: number;
}

export interface SliceDefinition {
  arrangementStartTime: number;
  duration: number;
  filePath: string;
  loopSettings: ClipLoopSettings;
}

/** A group of consecutive small cuts that need to be pre-rendered into one WAV */
export interface RollGroup {
  arrangementStartTime: number;
  totalDuration: number;
  cuts: RollRenderCut[];
}

/** Placeholder slice that will be replaced after rendering */
interface PendingRollSlice {
  type: "roll";
  arrangementStartTime: number;
  totalDuration: number;
  rollGroupIndex: number;
}

type SliceOrRoll = (SliceDefinition & { type: "clip" }) | PendingRollSlice;

function isExtendedCut(cut: Cut): cut is ExtendedCut {
  return Array.isArray(cut);
}

/** Minimum clip duration the SDK can create (in beats). */
const MIN_CLIP_BEATS = 0.25;

function clampOffset(offset: number, cutDuration: number, loopLength: number): number {
  if (cutDuration >= loopLength) return 0;
  const maxOffset = loopLength - cutDuration;
  if (offset > maxOffset) return offset % (maxOffset + 0.0001);
  return offset;
}

export function generateCutSequence(
  proc: BBCutProc,
  totalBeats: number,
  loopLengthBeats: number,
): BlockEvent[] {
  const blocks: BlockEvent[] = [];
  let pendingOffset = -1;

  proc.attachListener({
    chooseoffset(phrasepos: number) {
      pendingOffset = phrasepos;
    },
    setoffset(prop: number, phraseLength?: number) {
      const pl = phraseLength ?? loopLengthBeats;
      pendingOffset = prop * pl;
    },
    updateblock(_blockNum: number, _phraseProp: number, cuts: Cut[], isroll: number) {
      blocks.push({
        offset: pendingOffset,
        cuts: cuts.map((c) => (isExtendedCut(c) ? [...c] as ExtendedCut : c)),
        blocklength: proc.blocklength,
        isStutter: isroll === 1,
      });
      pendingOffset = -1;
    },
  });

  let generated = 0;
  while (generated < totalBeats - 0.00001) {
    proc.chooseblock();
    generated += proc.blocklength;
  }

  return blocks;
}

export interface SlicerResult {
  slices: SliceDefinition[];
  rollGroups: RollGroup[];
}

/**
 * Map blocks to SliceDefinitions + RollGroups.
 * Cuts >= MIN_CLIP_BEATS become normal clips.
 * Consecutive cuts < MIN_CLIP_BEATS are grouped for pre-rendering.
 */
export function mapToSliceDefinitions(
  blocks: BlockEvent[],
  clipStartTime: number,
  clipLoopStart: number,
  loopLengthBeats: number,
  filePath: string,
  minClipBeats = MIN_CLIP_BEATS,
): SlicerResult {
  const items: SliceOrRoll[] = [];
  const rollGroups: RollGroup[] = [];
  let arrangementPos = clipStartTime;

  // Accumulator for consecutive small cuts
  let pendingSmall: { startPos: number; totalDur: number; cuts: RollRenderCut[] } | null = null;

  function flushSmall() {
    if (!pendingSmall || pendingSmall.cuts.length === 0) return;
    if (pendingSmall.totalDur < minClipBeats) {
      // Even the group is too short — extend previous clip
      pendingSmall = null;
      return;
    }
    const groupIdx = rollGroups.length;
    rollGroups.push({
      arrangementStartTime: pendingSmall.startPos,
      totalDuration: pendingSmall.totalDur,
      cuts: pendingSmall.cuts,
    });
    items.push({
      type: "roll",
      arrangementStartTime: pendingSmall.startPos,
      totalDuration: pendingSmall.totalDur,
      rollGroupIndex: groupIdx,
    });
    pendingSmall = null;
  }

  function addSmallCut(sourceOffset: number, duration: number) {
    if (!pendingSmall) {
      pendingSmall = { startPos: arrangementPos, totalDur: 0, cuts: [] };
    }
    pendingSmall.cuts.push({
      sourceOffsetBeat: sourceOffset,
      durationBeat: duration,
    });
    pendingSmall.totalDur += duration;
  }

  function addClip(duration: number, markerStart: number, markerEnd: number) {
    flushSmall();
    items.push({
      type: "clip",
      arrangementStartTime: arrangementPos,
      duration,
      filePath,
      loopSettings: {
        looping: true,
        startMarker: markerStart,
        endMarker: markerEnd,
        loopStart: markerStart,
        loopEnd: markerEnd,
      },
    });
  }

  for (const block of blocks) {
    const firstCut = block.cuts[0]!;

    if (isExtendedCut(firstCut)) {
      for (const cut of block.cuts as ExtendedCut[]) {
        const ioi = cut[0];
        let duration = cut[1];
        const cutOffset = cut[2];
        const amp = cut[3];

        if (duration < 0.001) {
          arrangementPos += ioi;
          continue;
        }

        // For silent cuts (amp=0), fill with source audio from the current
        // offset rather than leaving a gap — in arrangement context we want
        // continuous audio, not silence.
        if (amp === 0) {
          // Use the block offset (phrasepos) as source position
          const silenceOffset = block.offset >= 0
            ? block.offset % loopLengthBeats
            : 0;
          const clamped = clampOffset(silenceOffset, ioi, loopLengthBeats);
          const fillDur = Math.min(ioi, loopLengthBeats - clamped);

          if (ioi >= minClipBeats && fillDur >= minClipBeats) {
            addClip(ioi, clipLoopStart + clamped, clipLoopStart + clamped + fillDur);
          } else if (ioi >= minClipBeats) {
            // Offset clamping made it too short — just play from 0
            addClip(ioi, clipLoopStart, clipLoopStart + ioi);
          } else {
            addSmallCut(clamped, fillDur);
          }
          arrangementPos += ioi;
          continue;
        }

        let loopOffset: number;
        if (cutOffset !== null) {
          loopOffset = (cutOffset * loopLengthBeats) % loopLengthBeats;
        } else if (block.offset >= 0) {
          loopOffset = block.offset % loopLengthBeats;
        } else {
          loopOffset = 0;
        }

        loopOffset = clampOffset(loopOffset, duration, loopLengthBeats);
        duration = Math.min(duration, loopLengthBeats - loopOffset);

        if (ioi < minClipBeats) {
          addSmallCut(loopOffset, duration);
        } else {
          addClip(ioi, clipLoopStart + loopOffset, clipLoopStart + loopOffset + duration);
        }

        arrangementPos += ioi;
      }
    } else {
      let loopOffset: number;
      if (block.offset >= 0) {
        loopOffset = block.offset % loopLengthBeats;
      } else {
        loopOffset = 0;
      }

      for (const cut of block.cuts) {
        const originalDur = cut as number;

        const clamped = clampOffset(loopOffset, originalDur, loopLengthBeats);
        let cutDuration = Math.min(originalDur, loopLengthBeats - clamped);

        if (originalDur < minClipBeats) {
          addSmallCut(clamped, cutDuration);
          arrangementPos += originalDur;
          continue;
        }

        if (cutDuration < minClipBeats) {
          addSmallCut(clamped, cutDuration);
          arrangementPos += originalDur;
          continue;
        }

        addClip(cutDuration, clipLoopStart + clamped, clipLoopStart + clamped + cutDuration);
        arrangementPos += originalDur;
      }
    }
  }

  flushSmall();

  // Fill gaps between items by extending previous clip duration
  const allItems = items;
  for (let i = 0; i < allItems.length - 1; i++) {
    const curr = allItems[i]!;
    const next = allItems[i + 1]!;
    const currEnd = curr.arrangementStartTime +
      (curr.type === "clip" ? curr.duration : curr.totalDuration);
    const gap = next.arrangementStartTime - currEnd;
    if (gap > 0.001 && curr.type === "clip") {
      curr.duration += gap;
    }
  }

  // Build final slice list — roll placeholders will be resolved by extension.ts
  const slices: SliceDefinition[] = [];
  for (const item of allItems) {
    if (item.type === "clip") {
      const { type: _, ...slice } = item;
      slices.push(slice);
    } else {
      // Placeholder: filePath will be replaced after rendering
      slices.push({
        arrangementStartTime: item.arrangementStartTime,
        duration: item.totalDuration,
        filePath: `__ROLL_GROUP_${item.rollGroupIndex}__`,
        loopSettings: {
          looping: false,
          startMarker: 0,
          endMarker: item.totalDuration,
          loopStart: 0,
          loopEnd: item.totalDuration,
        },
      });
    }
  }

  return { slices, rollGroups };
}
