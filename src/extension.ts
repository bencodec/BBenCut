import type { ArrangementSelection, NoteDescription } from "@ableton-extensions/sdk";
import {
  initialize,
  type ActivationContext,
  DataModelObject,
  AudioClip,
  AudioTrack,
  MidiClip,
  MidiTrack,
} from "@ableton-extensions/sdk";
import { generateCutSequence, mapToSliceDefinitions } from "./slicer.js";
import { renderAllRollGroups, ProtectedContentError } from "./audio.js";
import * as fs from "fs/promises";
import * as os from "os";
import { BBCutProc } from "./bbcut/BBCutProc.js";
import { BBCutProc11 } from "./bbcut/BBCutProc11.js";
import { ChooseCutProc } from "./bbcut/ChooseCutProc.js";
import { ChooseBlockProc } from "./bbcut/ChooseBlockProc.js";
import { WarpCutProc1 } from "./bbcut/WarpCutProc1.js";
import { SQPusher1 } from "./bbcut/SQPusher1.js";
import { CageCut } from "./bbcut/CageCut.js";
import { TimelineCut } from "./bbcut/TimelineCut.js";
import { BBCPPermute } from "./bbcut/BBCPPermute.js";
import { ThrashCutProc1 } from "./bbcut/ThrashCutProc1.js";
import { SQPusher2 } from "./bbcut/SQPusher2.js";
import { rrand } from "./bbcut/helpers.js";
import modalHtml from "./modal.html";
import protectedContentHtml from "./protected-content.html";

const CLIP_COLORS = [
  0xFF3636, 0xFF7A00, 0xFFD035, 0xA2FF00,
  0x00FF6B, 0x00FFCC, 0x00C2FF, 0x006AFF,
  0x8B00FF, 0xFF35B7, 0xFF6B35, 0xAAFF35,
  0x35FFD0, 0x35AAFF, 0xD035FF, 0xFF3580,
];

interface ModalResult {
  action: string;
  config?: {
    totalBars: number;
    loopBars: number;
    procType: string;
    params: Record<string, number>;
  };
}

function copyNotesForSlice(
  notes: NoteDescription[],
  sourceStart: number,
  sourceEnd: number,
): NoteDescription[] {
  const copied: NoteDescription[] = [];

  for (const note of notes) {
    const noteStart = note.startTime;
    const noteEnd = note.startTime + note.duration;
    const start = Math.max(noteStart, sourceStart);
    const end = Math.min(noteEnd, sourceEnd);

    if (end <= start) continue;

    copied.push({
      ...note,
      startTime: start - sourceStart,
      duration: end - start,
      selected: false,
    });
  }

  return copied;
}

function createProc(
  procType: string,
  params: Record<string, number>,
  loopLengthBeats: number,
): BBCutProc {
  const barlength = 4.0;
  const phrasebars = loopLengthBeats / barlength;

  switch (procType) {
    case "BBCutProc11": {
      const min = params.numrepeatsMin ?? 1;
      const max = params.numrepeatsMax ?? 2;
      return new BBCutProc11({
        sdiv: params.sdiv ?? 8,
        barlength,
        phrasebars,
        numrepeats: min === max ? min : () => rrand(min, max),
        repeatschance: params.repeatschance ?? 0.2,
        repeatsspeed: params.repeatsspeed ?? 2,
        repeatsarea: params.repeatsarea ?? 0.5,
      });
    }
    case "ChooseCutProc":
      return new ChooseCutProc({
        phraselength: loopLengthBeats,
        rollchance: params.rollchance ?? 0.1,
        rollallowed: params.rollallowed ?? 2.0,
      });
    case "ChooseBlockProc":
      return new ChooseBlockProc({
        phraselength: loopLengthBeats,
      });
    case "WarpCutProc1":
      return new WarpCutProc1({
        phraselength: loopLengthBeats,
        probs: [
          params.straightchance ?? 0.5,
          params.arithmeticchance ?? 0.7,
          params.accelchance ?? 0.6,
        ],
        accel: params.accel ?? 0.9,
      });
    case "SQPusher1":
      return new SQPusher1({
        activity: params.activity ?? 0.1,
        fillfreq: params.fillfreq ?? 4,
        fillscramble: params.fillscramble ?? 0.0,
      });
    case "CageCut":
      return new CageCut({
        phraselength: loopLengthBeats,
      });
    case "TimelineCut":
      return new TimelineCut({
        phraselength: loopLengthBeats,
      });
    case "BBCPPermute": {
      return new BBCPPermute({
        phraselength: loopLengthBeats,
        subdivfunc: params.subdiv ?? 8,
      });
    }
    case "ThrashCutProc1":
      return new ThrashCutProc1({
        phraselength: loopLengthBeats,
        kickoffset: params.kickoffset ?? 0.0,
        snareoffset: params.snareoffset ?? 0.125,
        stopchance: params.stopchance ?? 0.125,
      });
    case "SQPusher2":
      return new SQPusher2({
        scramble: params.scramble ?? 0.0,
        quant: params.quant ?? 0.0,
      });
    default:
      return new BBCutProc11({ barlength, phrasebars });
  }
}

export function activate(activation: ActivationContext) {
  const context = initialize(activation, "1.0.0");

  context.commands.registerCommand(
    "bbencut.open",
    (arg: unknown) =>
      void (async (selection: ArrangementSelection) => {
        const selectedTracks = selection.selected_lanes
          .map((handle) => context.getObjectFromHandle(handle, DataModelObject))
          .filter(
            (obj): obj is AudioTrack<"1.0.0"> | MidiTrack<"1.0.0"> =>
              obj instanceof AudioTrack || obj instanceof MidiTrack,
          );
        const audioTracks = selectedTracks.filter(
          (obj): obj is AudioTrack<"1.0.0"> => obj instanceof AudioTrack,
        );
        const midiTracks = selectedTracks.filter(
          (obj): obj is MidiTrack<"1.0.0"> => obj instanceof MidiTrack,
        );

        if (audioTracks.length + midiTracks.length !== 1) {
          console.log("[bbencut] Select exactly one arrangement audio or MIDI track.");
          return;
        }
        const track = audioTracks[0] ?? midiTracks[0]!;

        const selectionStart = selection.time_selection_start;
        const selectionEnd = selection.time_selection_end;
        if (!(selectionEnd > selectionStart)) {
          console.log("[bbencut] Select a non-empty arrangement time range.");
          return;
        }

        const clip = [...track.arrangementClips].find((c) =>
          c.startTime <= selectionStart && c.endTime >= selectionStart + 0.0001,
        );
        if (
          (track instanceof AudioTrack && !(clip instanceof AudioClip)) ||
          (track instanceof MidiTrack && !(clip instanceof MidiClip))
        ) {
          console.log(
            "[bbencut] No arrangement audio or MIDI clip found at the selection start.",
          );
          return;
        }

        const tempo = context.application.song!.tempo;
        const barlength = 4.0;

        const clipStartTime = selectionStart;
        const clipEndTime = selectionEnd;
        const totalBeats = clipEndTime - clipStartTime;
        const totalBars = totalBeats / barlength;

        let loopLengthBeats: number;
        if (clip.looping) {
          loopLengthBeats = clip.loopEnd - clip.loopStart;
        } else {
          loopLengthBeats = totalBeats;
        }
        const loopBars = loopLengthBeats / barlength;
        const selectionOffsetInClip = Math.max(0, selectionStart - clip.startTime);
        const clipLoopStart = clip.looping
          ? clip.loopStart + (selectionOffsetInClip % loopLengthBeats)
          : clip.startMarker + selectionOffsetInClip;

        const data = {
          clipName: `${track.name} [${selectionStart.toFixed(2)}-${selectionEnd.toFixed(2)}]`,
          totalBars: Math.round(totalBars * 100) / 100,
          loopBars: Math.round(loopBars * 100) / 100,
          tempo,
        };
        const json = JSON.stringify(data).replace(/</g, "\\u003c");
        const html = modalHtml.replace("__DATA__", json);

        let resultStr: string;
        try {
          resultStr = await context
            .ui.showModalDialog(`data:text/html,${encodeURIComponent(html)}`, 400, 423);
        } catch {
          return;
        }

        let result: ModalResult;
        try {
          result = JSON.parse(resultStr) as ModalResult;
        } catch {
          return;
        }

        if (result.action !== "apply" || !result.config) return;

        const cfg = result.config;
        const finalTotalBeats = cfg.totalBars * barlength;
        const finalLoopBeats = cfg.loopBars * barlength;

        try {
          await context.ui.withinProgressDialog(
            "BBenCut Slicing in Progress",
            {},
            async (update, abortSignal) => {
            // Phase 1: Generate cut sequence
            await update("Generating cuts...", 10);
            const proc = createProc(cfg.procType, cfg.params, finalLoopBeats);
            const blocks = generateCutSequence(
              proc,
              finalTotalBeats,
              finalLoopBeats,
            );

            if (track instanceof MidiTrack && clip instanceof MidiClip) {
              const { slices } = mapToSliceDefinitions(
                blocks,
                clipStartTime,
                clipLoopStart,
                finalLoopBeats,
                "",
                0,
              );
              const validSlices = slices.filter((s) => {
                if (s.duration < 0.01) return false;
                if (
                  s.loopSettings.endMarker <=
                  s.loopSettings.startMarker + 0.001
                )
                  return false;
                return true;
              });

              if (validSlices.length === 0) {
                console.log("[bbencut] No valid MIDI slices generated.");
                return;
              }

              await update(`Creating ${validSlices.length} MIDI clips...`, 60);
              console.log(
                `[bbencut] Rearranging "${clip.name}" with ${cfg.procType} into ${validSlices.length} MIDI clips.`,
              );

              const sourceNotes = clip.notes;
              await track.clearClipsInRange(
                clipStartTime,
                clipStartTime + finalTotalBeats,
              );

              const createdClips = await context.withinTransaction(() =>
                Promise.all(
                  validSlices.map((slice, i) =>
                    track
                      .createMidiClip(slice.arrangementStartTime, slice.duration)
                      .then((createdClip) => {
                        createdClip.notes = copyNotesForSlice(
                          sourceNotes,
                          slice.loopSettings.startMarker,
                          slice.loopSettings.endMarker,
                        );
                        return createdClip;
                      })
                      .catch((e: unknown) => {
                        console.error(
                          `[bbencut] MIDI clip #${i} failed: pos=${slice.arrangementStartTime.toFixed(3)} dur=${slice.duration.toFixed(3)} source=${slice.loopSettings.startMarker.toFixed(3)}-${slice.loopSettings.endMarker.toFixed(3)}`,
                          e,
                        );
                        return null;
                      }),
                  ),
                ),
              );
              context.withinTransaction(() => {
                createdClips.forEach((clip, i) => {
                  if (clip) clip.color = CLIP_COLORS[i % CLIP_COLORS.length]!;
                });
              });
              await update("Done", 100);
              return;
            }

            if (!(track instanceof AudioTrack) || !(clip instanceof AudioClip)) {
              return;
            }

            const { slices, rollGroups } = mapToSliceDefinitions(
              blocks,
              clipStartTime,
              clipLoopStart,
              finalLoopBeats,
              clip.filePath,
            );

            if (abortSignal.aborted) return;

            // Phase 2: Pre-render roll groups, then import into the project
            const tempDir = context.environment.tempDirectory ?? os.tmpdir();
            await fs.mkdir(tempDir, { recursive: true });
            if (rollGroups.length > 0) {
              await update(`Pre-rendering ${rollGroups.length} roll(s)...`, 20);
              // Bounce one loop's worth of the clip's audio into the
              // extension's temp dir; the host can read protected/factory
              // content the extension itself isn't allowed to fs.read.
              const renderedSourcePath =
                await context.resources.renderPreFxAudio(
                  track,
                  clipStartTime,
                  clipStartTime + finalLoopBeats,
                );
              const rendered = await renderAllRollGroups(
                renderedSourcePath,
                rollGroups,
                tempo,
                tempDir,
              );
              for (const [i, tempPath] of rendered) {
                const projectPath =
                  await context.resources.importIntoProject(tempPath);
                for (const slice of slices) {
                  if (slice.filePath === `__ROLL_GROUP_${i}__`) {
                    slice.filePath = projectPath;
                  }
                }
              }
            }

            if (abortSignal.aborted) return;

            // Phase 3: Filter and create clips
            const validSlices = slices.filter((s) => {
              if (s.duration < 0.01) return false;
              if (
                s.loopSettings.endMarker <=
                s.loopSettings.startMarker + 0.001
              )
                return false;
              if (s.filePath.startsWith("__ROLL_GROUP_")) return false;
              return true;
            });

            if (validSlices.length === 0) {
              console.log("[bbencut] No valid slices generated.");
              return;
            }

            await update(`Creating ${validSlices.length} clips...`, 60);
            console.log(
              `[bbencut] Rearranging "${clip.name}" with ${cfg.procType} into ${validSlices.length} clips (${rollGroups.length} pre-rendered rolls).`,
            );

            await track.clearClipsInRange(
              clipStartTime,
              clipStartTime + finalTotalBeats,
            );

            const createdClips = await context.withinTransaction(() =>
              Promise.all(
              validSlices.map((slice, i) =>
                track
                  .createAudioClip({
                    filePath: slice.filePath,
                    startTime: slice.arrangementStartTime,
                    duration: slice.duration,
                    isWarped: true,
                    loopSettings: slice.loopSettings,
                  })
                  .catch((e: unknown) => {
                    console.error(
                        `[bbencut] Clip #${i} failed: pos=${slice.arrangementStartTime.toFixed(3)} dur=${slice.duration.toFixed(3)} markers=${slice.loopSettings.startMarker.toFixed(3)}-${slice.loopSettings.endMarker.toFixed(3)}`,
                      e,
                    );
                    return null;
                  }),
              ),
              ),
            );
            context.withinTransaction(() => {
              createdClips.forEach((clip, i) => {
                if (clip) clip.color = CLIP_COLORS[i % CLIP_COLORS.length]!;
              });
            });
            await update("Done", 100);
            },
          );
        } catch (e) {
          if (e instanceof ProtectedContentError) {
            const json = JSON.stringify({ clipName: clip.name }).replace(
              /</g,
              "\\u003c",
            );
            const html = protectedContentHtml.replace("__DATA__", json);
            await context
              .ui.showModalDialog(`data:text/html,${encodeURIComponent(html)}`, 420, 240)
              .catch(() => {});
            return;
          }
          throw e;
        }
      })(arg as ArrangementSelection).catch((e) => console.error("[bbencut]", e)),
  );

  context.ui.registerContextMenuAction(
    "AudioTrack.ArrangementSelection",
    "Rearrange",
    "bbencut.open",
  );
  context.ui.registerContextMenuAction(
    "MidiTrack.ArrangementSelection",
    "Rearrange",
    "bbencut.open",
  );
}
