// Does the TypeScript port actually reproduce the TC spike's Rust corpus?
//
// This is not a self-pin. The BASE-1 run's own result file records the byte
// length of every trace it fed the emulator (`streamBytes`, per row of
// `draft/terminal-custody-spike/results/base1/base1-corpus-s1-20260817T222014.json`,
// captured at `scale: 4`), and those eleven numbers were produced by the Rust
// generators in `probes/base1/src/traces.rs`. The port has to hit them exactly.
//
// It does, for all eleven — including `fragmenter`, whose splitmix64 stream is
// wrapping-u64 arithmetic that a double cannot represent and that the port runs
// in BigInt, and including every scale-dependent generator, whose lengths are
// NOT linear in scale (the frame index appears in the printed text, so its digit
// count changes). Matching those by accident is not available.
//
// The CRCs beneath pin the byte CONTENT at scale 1, which is what the corpus
// capture actually replays; the lengths pin the port against the spike.
import { describe, expect, it } from "vitest";
import { base1Corpus, crc32, formatRecord } from "../src/byte-traces";

/** `streamBytes` from the BASE-1 corpus run, scale 4. */
const RUST_STREAM_BYTES_AT_SCALE_4: Record<string, number> = {
  "mode-setter": 2189,
  "alternate-screen-active": 1387,
  "alternate-screen-exited": 1412,
  query: 271,
  fragmenter: 2618,
  counter: 3013,
  "bulk-styled": 262153,
  "redraw-heavy": 407216,
  "alt-animation": 1237301,
  "alt-animation-exited": 367326,
  softwrap: 42061,
};

/** [name, byteLength, crc32] at seed 1, scale 1 — the capture's own input. */
const SCALE_1_DIGESTS: readonly (readonly [string, number, number])[] = [
  ["mode-setter", 2189, 3323811349],
  ["alternate-screen-active", 1387, 762391714],
  ["alternate-screen-exited", 1412, 236181231],
  ["query", 271, 3277984497],
  ["fragmenter", 2618, 4121635240],
  ["counter", 3013, 2512148543],
  ["bulk-styled", 65561, 819164199],
  ["redraw-heavy", 100982, 1152145759],
  ["alt-animation", 311165, 1388480421],
  ["alt-animation-exited", 96250, 3730191787],
  ["softwrap", 10451, 1029836246],
];

describe("the BASE-1 byte-trace port", () => {
  it("reproduces the Rust generators' stream lengths at the spike's own scale", () => {
    const traces = base1Corpus(1n, 4);
    expect(traces.length).toBe(11);
    for (const trace of traces) {
      expect(trace.bytes.byteLength, `${trace.name} at scale 4`).toBe(
        RUST_STREAM_BYTES_AT_SCALE_4[trace.name],
      );
    }
  });

  it("is byte-stable at the scale the corpus is captured from", () => {
    const traces = new Map(base1Corpus(1n, 1).map((trace) => [trace.name, trace.bytes]));
    for (const [name, byteLength, digest] of SCALE_1_DIGESTS) {
      const bytes = traces.get(name);
      expect(bytes, `${name} is missing`).toBeDefined();
      expect(bytes!.byteLength, `${name} length`).toBe(byteLength);
      expect(crc32(bytes!), `${name} content`).toBe(digest);
    }
  });

  it("computes the record CRC the way the spike's replayer reads it", () => {
    // `traces.rs:28-32`: `REC <seq> <ts> <payload> <crc32(body)>\n`, where the
    // body is everything between "REC " and the checksum.
    const record = formatRecord(7, 1_007, "payloadxxxx");
    expect(record.startsWith("REC 7 1007 payloadxxxx ")).toBe(true);
    expect(record.endsWith("\n")).toBe(true);
    const body = "7 1007 payloadxxxx";
    expect(record.trim().split(" ").at(-1)).toBe(String(crc32(new TextEncoder().encode(body))));
  });

  it("agrees with a known CRC-32 vector", () => {
    // "123456789" -> 0xCBF43926 is the standard CRC-32/ISO-HDLC check value; a
    // port whose CRC is subtly wrong would still be self-consistent above.
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });
});
