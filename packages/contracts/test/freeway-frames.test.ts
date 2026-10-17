// FW (thinking-freeway.md v0.3 §5.1) — the freeway link's frame BYTES (fixtures/freeway-frames.vector.json),
// held here to the registry that names them: every frame's first byte is its `FREEWAY_FRAME` value (with
// `FREEWAY_FRAGMENT_BIT` where it says so), then its stream id in LEB128, then its payload. The codecs —
// field-native's `freeway::frame`, the kit's freeway transport — decode and re-encode the same bytes and
// refuse the `refused` ones; this test is what keeps the vector and the registry one table.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FREEWAY_FRAGMENT_BIT, FREEWAY_FRAME } from "../src/registries";

interface FrameCase {
  name: string;
  frameType: keyof typeof FREEWAY_FRAME;
  fragment: boolean;
  streamId: number;
  payloadHex: string;
  frameHex: string;
}
interface RefusedCase {
  name: string;
  frameHex: string;
  why: string;
}

const vector = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "freeway-frames.vector.json"),
    "utf8",
  ),
) as { frames: FrameCase[]; refused: RefusedCase[] };

const leb128 = (value: number): string => {
  const bytes: number[] = [];
  let rest = value;
  do {
    const low = rest % 128;
    rest = Math.floor(rest / 128);
    bytes.push(rest > 0 ? low | 0x80 : low);
  } while (rest > 0);
  return bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

describe("FW — the frame vector is the registry's table, byte for byte", () => {
  it.each(vector.frames.map((frame) => [frame.name, frame] as const))("%s", (_, frame) => {
    const type = FREEWAY_FRAME[frame.frameType] | (frame.fragment ? FREEWAY_FRAGMENT_BIT : 0);
    const head = type.toString(16).padStart(2, "0") + leb128(frame.streamId);
    expect(frame.frameHex).toBe(head + frame.payloadHex);
    // LINK is stream 0's alone, and stream 0 carries nothing else.
    expect(frame.frameType === "LINK").toBe(frame.streamId === 0);
    // The FRAGMENT bit rides TEXT and BINARY only.
    if (frame.fragment) expect(["TEXT", "BINARY"]).toContain(frame.frameType);
  });

  it("covers every frame type, and refuses a type the table does not have", () => {
    const covered = new Set(vector.frames.map((frame) => frame.frameType));
    expect([...covered].sort()).toEqual(Object.keys(FREEWAY_FRAME).sort());
    const unknown = vector.refused.find((refused) => refused.why.startsWith("unknown frame type"));
    const byte = Number.parseInt(unknown?.frameHex.slice(0, 2) ?? "", 16);
    expect(Object.values(FREEWAY_FRAME)).not.toContain(byte & ~FREEWAY_FRAGMENT_BIT);
    for (const refused of vector.refused) expect(refused.frameHex).toMatch(/^([0-9a-f]{2})*$/);
  });
});
