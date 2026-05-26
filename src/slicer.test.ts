import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateCutSequence, mapToSliceDefinitions, type BlockEvent } from "./slicer.js";
import { BBCutProc11 } from "./bbcut/BBCutProc11.js";
import { ChooseCutProc } from "./bbcut/ChooseCutProc.js";
import { BBCPPermute } from "./bbcut/BBCPPermute.js";
import { ThrashCutProc1 } from "./bbcut/ThrashCutProc1.js";
import type { ExtendedCut } from "./bbcut/types.js";

beforeEach(() => {
  let seed = 42;
  vi.spyOn(Math, "random").mockImplementation(() => {
    seed = (seed * 16807 + 0) % 2147483647;
    return (seed - 1) / 2147483646;
  });
});

describe("generateCutSequence", () => {
  it("generates blocks that sum to requested total (BBCutProc11)", () => {
    const proc = new BBCutProc11({ sdiv: 8, barlength: 4, phrasebars: 1 });
    const blocks = generateCutSequence(proc, 16, 4);
    const total = blocks.reduce((s, b) => s + b.blocklength, 0);
    expect(total).toBeCloseTo(16, 5);
  });

  it("generates blocks that sum to requested total (ChooseCutProc)", () => {
    const proc = new ChooseCutProc({ phraselength: 4 });
    const blocks = generateCutSequence(proc, 8, 4);
    const total = blocks.reduce((s, b) => s + b.blocklength, 0);
    expect(total).toBeCloseTo(8, 5);
  });

  it("captures setoffset from BBCPPermute", () => {
    const proc = new BBCPPermute({ phraselength: 4, subdivfunc: 4 });
    const blocks = generateCutSequence(proc, 4, 4);
    for (const block of blocks) {
      expect(block.offset).toBeGreaterThanOrEqual(0);
    }
  });

  it("handles ExtendedCut from ThrashCutProc1", () => {
    const proc = new ThrashCutProc1({ phraselength: 4 });
    const blocks = generateCutSequence(proc, 4, 4);
    const total = blocks.reduce((s, b) => s + b.blocklength, 0);
    expect(total).toBeCloseTo(4, 5);
    for (const block of blocks) {
      for (const cut of block.cuts) {
        expect(Array.isArray(cut)).toBe(true);
      }
    }
  });

  it("all cuts within a SimpleCut block have equal duration", () => {
    const proc = new BBCutProc11({ sdiv: 8, barlength: 4, phrasebars: 2 });
    const blocks = generateCutSequence(proc, 8, 8);
    for (const block of blocks) {
      if (typeof block.cuts[0] === "number") {
        const first = block.cuts[0] as number;
        for (const cut of block.cuts) {
          expect(cut as number).toBeCloseTo(first, 10);
        }
      }
    }
  });
});

describe("mapToSliceDefinitions", () => {
  it("maps SimpleCut blocks to one clip per cut", () => {
    const blocks: BlockEvent[] = [
      { offset: 0, cuts: [1, 1], blocklength: 2, isStutter: false },
      { offset: 2, cuts: [0.5, 0.5, 0.5, 0.5], blocklength: 2, isStutter: true },
    ];
    const { slices } = mapToSliceDefinitions(blocks, 10, 0, 4, "/test.wav");
    // 2 + 4 = 6 clips (one per cut, all >= 0.25 beats)
    expect(slices).toHaveLength(6);
    expect(slices[0]!.arrangementStartTime).toBe(10);
    expect(slices[0]!.duration).toBe(1);
    expect(slices[1]!.arrangementStartTime).toBe(11);
    expect(slices[1]!.duration).toBe(1);
    expect(slices[2]!.arrangementStartTime).toBe(12);
    expect(slices[2]!.duration).toBe(0.5);
  });

  it("sets loop markers based on block offset and cut duration", () => {
    const blocks: BlockEvent[] = [
      { offset: 2.0, cuts: [0.5, 0.5, 0.5], blocklength: 1.5, isStutter: false },
    ];
    const { slices } = mapToSliceDefinitions(blocks, 0, 0, 4, "/test.wav");
    expect(slices[0]!.loopSettings.startMarker).toBe(2.0);
    expect(slices[0]!.loopSettings.endMarker).toBe(2.5);
  });

  it("accounts for clipLoopStart offset", () => {
    const blocks: BlockEvent[] = [
      { offset: 1.0, cuts: [2.0], blocklength: 2.0, isStutter: false },
    ];
    const { slices } = mapToSliceDefinitions(blocks, 0, 4, 8, "/test.wav");
    expect(slices[0]!.loopSettings.startMarker).toBe(5.0); // 4 + 1
    expect(slices[0]!.loopSettings.endMarker).toBe(7.0); // 4 + 1 + 2
  });

  it("wraps offsets that exceed loop length", () => {
    const blocks: BlockEvent[] = [
      { offset: 5.0, cuts: [1.0], blocklength: 1.0, isStutter: false },
    ];
    const { slices } = mapToSliceDefinitions(blocks, 0, 0, 4, "/test.wav");
    expect(slices[0]!.loopSettings.startMarker).toBe(1.0); // 5 % 4 = 1
    expect(slices[0]!.loopSettings.endMarker).toBe(2.0);
  });

  it("sends tiny cuts to rollGroups for pre-rendering", () => {
    const blocks: BlockEvent[] = [
      { offset: 0, cuts: [0.1, 0.1, 0.1, 0.1], blocklength: 0.4, isStutter: true },
    ];
    const { slices, rollGroups } = mapToSliceDefinitions(blocks, 0, 0, 4, "/test.wav");
    // All cuts < 0.25 → one roll group
    expect(rollGroups).toHaveLength(1);
    expect(rollGroups[0]!.cuts).toHaveLength(4);
    expect(rollGroups[0]!.totalDuration).toBeCloseTo(0.4, 5);
    // One placeholder slice for the roll
    const rollSlice = slices.find((s) => s.filePath.startsWith("__ROLL_GROUP_"));
    expect(rollSlice).toBeDefined();
    expect(rollSlice!.duration).toBeCloseTo(0.4, 5);
  });

  it("maps ExtendedCut blocks to clips", () => {
    const extCuts: ExtendedCut[] = [
      [1.0, 0.8, 0.0, 1.0],
      [1.0, 0.8, 0.5, 1.0],
    ];
    const blocks: BlockEvent[] = [
      { offset: -1, cuts: extCuts, blocklength: 2.0, isStutter: false },
    ];
    const { slices } = mapToSliceDefinitions(blocks, 0, 0, 4, "/test.wav");
    expect(slices).toHaveLength(2);
    expect(slices[0]!.arrangementStartTime).toBe(0);
    expect(slices[0]!.duration).toBe(1.0);
    expect(slices[1]!.arrangementStartTime).toBe(1.0);
    // Second cut has offset 0.5 (proportion) -> 0.5 * 4 = 2.0 beats
    expect(slices[1]!.loopSettings.startMarker).toBe(2.0);
  });

  it("fills silent ExtendedCut entries (amp=0) with source audio", () => {
    const extCuts: ExtendedCut[] = [
      [1.0, 1.0, 0.0, 1.0],
      [1.0, 1.0, 0.0, 0.0], // silent — now filled with source audio
      [1.0, 1.0, 0.0, 1.0],
    ];
    const blocks: BlockEvent[] = [
      { offset: -1, cuts: extCuts, blocklength: 3.0, isStutter: false },
    ];
    const { slices } = mapToSliceDefinitions(blocks, 0, 0, 4, "/test.wav");
    expect(slices).toHaveLength(3);
    expect(slices[0]!.arrangementStartTime).toBe(0);
    expect(slices[1]!.arrangementStartTime).toBe(1.0);
    expect(slices[2]!.arrangementStartTime).toBe(2.0);
  });
});
