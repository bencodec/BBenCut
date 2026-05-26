import * as fs from "fs/promises";
import * as path from "path";
import decodeAudio from "audio-decode";
import decodeAiff from "@audio/decode-aiff";

function isAiff(buf: Uint8Array): boolean {
  if (buf.length < 12) return false;
  // 'FORM' at offset 0
  if (buf[0] !== 0x46 || buf[1] !== 0x4f || buf[2] !== 0x52 || buf[3] !== 0x4d) return false;
  // 'AIFF' or 'AIFC' at offset 8
  const t0 = buf[8], t1 = buf[9], t2 = buf[10], t3 = buf[11];
  if (t0 !== 0x41 || t1 !== 0x49 || t2 !== 0x46) return false;
  return t3 === 0x46 || t3 === 0x43;
}

function isAifc(buf: Uint8Array): boolean {
  return isAiff(buf) && buf[11] === 0x43;
}

function fourCC(buf: Uint8Array, off: number): string {
  return String.fromCharCode(buf[off]!, buf[off + 1]!, buf[off + 2]!, buf[off + 3]!);
}

function readU32BE(buf: Uint8Array, off: number): number {
  return ((buf[off]! << 24) | (buf[off + 1]! << 16) | (buf[off + 2]! << 8) | buf[off + 3]!) >>> 0;
}

// AIFC compressionType codes that wrap uncompressed signed big-endian PCM.
// CoreAudio writes these instead of the literal "NONE"/"TWOS" that
// @audio/decode-aiff recognises, so rewrite the COMM chunk's compressionType
// to "NONE" before handing the buffer off.
const PCM_BE_ALIASES: ReadonlySet<string> = new Set(["in16", "in24", "in32", "lpcm"]);

// AIFC compressionType "able" tags Ableton-protected factory-pack content.
// The SSND payload is encrypted (statistically random, no recoverable PCM
// layout); Live decrypts it at playback and the SDK does not expose those
// bytes. Surface a specific error so the user knows why the clip is skipped.
const ABLE_TAG = "able";

export class ProtectedContentError extends Error {
  constructor(public readonly filePath: string) {
    super(`Protected Ableton factory content: ${filePath}`);
    this.name = "ProtectedContentError";
  }
}

function findCommCompOffset(buf: Uint8Array): { offset: number; comp: string } | null {
  if (buf.length < 12) return null;
  const formSize = readU32BE(buf, 4);
  const end = Math.min(8 + formSize, buf.length);
  let pos = 12;
  while (pos + 8 <= end) {
    const ckId = fourCC(buf, pos);
    const ckSize = readU32BE(buf, pos + 4);
    const ckData = pos + 8;
    if (ckId === "COMM" && ckSize >= 22 && ckData + 22 <= buf.length) {
      const compOff = ckData + 18;
      return { offset: compOff, comp: fourCC(buf, compOff) };
    }
    pos = ckData + ckSize + (ckSize & 1);
  }
  return null;
}

function normalizeAifcCompression(buf: Uint8Array): { buf: Uint8Array; originalComp: string | null } {
  if (!isAifc(buf)) return { buf, originalComp: null };
  const comm = findCommCompOffset(buf);
  if (!comm) return { buf, originalComp: null };
  if (!PCM_BE_ALIASES.has(comm.comp)) return { buf, originalComp: comm.comp };
  const out = new Uint8Array(buf);
  out[comm.offset] = 0x4e;     // 'N'
  out[comm.offset + 1] = 0x4f; // 'O'
  out[comm.offset + 2] = 0x4e; // 'N'
  out[comm.offset + 3] = 0x45; // 'E'
  return { buf: out, originalComp: comm.comp };
}

/**
 * Read and decode an audio file into channel Float32Arrays.
 */
export async function readAudio(filePath: string): Promise<{
  channels: Float32Array[];
  sampleRate: number;
}> {
  const buf = await fs.readFile(filePath);
  if (isAiff(buf)) {
    const { buf: patched, originalComp } = normalizeAifcCompression(buf);
    if (originalComp === ABLE_TAG) {
      throw new ProtectedContentError(filePath);
    }
    try {
      const decoded = await decodeAiff(patched);
      return { channels: Array.from(decoded.channelData), sampleRate: decoded.sampleRate };
    } catch (e) {
      const comp = originalComp ?? findCommCompOffset(buf)?.comp ?? "?";
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`AIFF/AIFC decode failed (compressionType="${comp}"): ${msg}`);
    }
  }
  const decoded = await decodeAudio(buf);
  return { channels: Array.from(decoded.channelData), sampleRate: decoded.sampleRate };
}

/**
 * Convert a beat position to a sample offset using constant tempo.
 */
function beatToSample(beat: number, tempo: number, sampleRate: number): number {
  return Math.round((beat * 60 / tempo) * sampleRate);
}

/**
 * Extract audio samples for a list of cuts and concatenate them into one buffer.
 * Each cut plays from sourceOffsetBeat for cutDuration beats.
 */
function extractAndConcat(
  channels: Float32Array[],
  sampleRate: number,
  tempo: number,
  cuts: Array<{ sourceOffsetBeat: number; durationBeat: number }>,
): Float32Array[] {
  // Calculate total samples needed
  let totalSamples = 0;
  const segments: Array<{ start: number; length: number }> = [];

  for (const cut of cuts) {
    const start = beatToSample(cut.sourceOffsetBeat, tempo, sampleRate);
    const length = beatToSample(cut.durationBeat, tempo, sampleRate);
    segments.push({ start, length });
    totalSamples += length;
  }

  // Allocate output channels and copy segments
  const output = channels.map(() => new Float32Array(totalSamples));
  let writePos = 0;

  for (const seg of segments) {
    for (let ch = 0; ch < channels.length; ch++) {
      const src = channels[ch]!;
      const dst = output[ch]!;
      const end = Math.min(seg.start + seg.length, src.length);
      for (let i = seg.start; i < end; i++) {
        dst[writePos + (i - seg.start)] = src[i]!;
      }
    }
    writePos += seg.length;
  }

  return output;
}

/**
 * Write a WAV file from Float32Array channels.
 */
async function writeWav(
  filePath: string,
  channels: Float32Array[],
  sampleRate: number,
): Promise<void> {
  const numChannels = channels.length;
  const numSamples = channels[0]!.length;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const dataSize = numSamples * numChannels * bytesPerSample;
  const headerSize = 44;

  const buffer = Buffer.alloc(headerSize + dataSize);

  // RIFF header
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(headerSize + dataSize - 8, 4);
  buffer.write("WAVE", 8);

  // fmt chunk
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16); // chunk size
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * numChannels * bytesPerSample, 28);
  buffer.writeUInt16LE(numChannels * bytesPerSample, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);

  // data chunk
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);

  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, channels[ch]![i]!));
      const int16 = Math.round(sample * 32767);
      buffer.writeInt16LE(int16, offset);
      offset += 2;
    }
  }

  await fs.writeFile(filePath, buffer);
}

export interface RollRenderCut {
  sourceOffsetBeat: number;
  durationBeat: number;
}

/**
 * Render all roll groups from a single source file.
 * Reads the source audio once, then renders each group to a separate WAV.
 * Returns a map of group index → rendered file path.
 */
export async function renderAllRollGroups(
  sourceFilePath: string,
  groups: Array<{ cuts: RollRenderCut[] }>,
  tempo: number,
  outputDir: string,
): Promise<Map<number, string>> {
  const { channels, sampleRate } = await readAudio(sourceFilePath);
  const results = new Map<number, string>();
  const ts = Date.now();

  for (let i = 0; i < groups.length; i++) {
    const group = groups[i]!;
    const rendered = extractAndConcat(channels, sampleRate, tempo, group.cuts);
    if (rendered.length === 0 || (rendered[0]?.length ?? 0) === 0) continue;
    const outPath = path.join(outputDir, `bbcut-roll-${i}-${ts}.wav`);
    await writeWav(outPath, rendered, sampleRate);
    results.set(i, outPath);
  }

  return results;
}
