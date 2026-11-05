/**
 * A WAV the system plays (SD-2): 24-bit linear PCM, little-endian, the channels interleaved. Each sound is mastered
 * with true peaks at −13 dBFS or under on the desktop and its tail falls to −72 dBFS (DESIGN.md §14 "The masters"),
 * well inside 24 bits' 144 dB; a sample past full scale is clamped, never wrapped.
 */
import { SR } from "./dsp.ts";

const FULL_SCALE = 8388607; // 2^23 − 1
const HEADER = 44;

/** Encode channels of equal length as a 24-bit PCM WAV file. */
export function encodeWav(channels: readonly Float32Array[], sampleRate: number = SR): Uint8Array {
  const count = channels.length;
  const frames = channels[0]?.length ?? 0;
  const blockAlign = count * 3;
  const dataBytes = frames * blockAlign;
  const bytes = new Uint8Array(HEADER + dataBytes);
  const dv = new DataView(bytes.buffer);
  const ascii = (at: number, text: string): void => {
    for (let i = 0; i < text.length; i++) bytes[at + i] = text.charCodeAt(i);
  };
  ascii(0, "RIFF");
  dv.setUint32(4, HEADER - 8 + dataBytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true); // PCM
  dv.setUint16(22, count, true);
  dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, sampleRate * blockAlign, true);
  dv.setUint16(32, blockAlign, true);
  dv.setUint16(34, 24, true);
  ascii(36, "data");
  dv.setUint32(40, dataBytes, true);
  let at = HEADER;
  for (let i = 0; i < frames; i++) {
    for (const channel of channels) {
      const x = channel[i] ?? 0;
      const v = Math.round(Math.max(-1, Math.min(1, Number.isFinite(x) ? x : 0)) * FULL_SCALE);
      const u = v < 0 ? v + 0x1000000 : v;
      bytes[at] = u & 0xff;
      bytes[at + 1] = (u >> 8) & 0xff;
      bytes[at + 2] = (u >> 16) & 0xff;
      at += 3;
    }
  }
  return bytes;
}
