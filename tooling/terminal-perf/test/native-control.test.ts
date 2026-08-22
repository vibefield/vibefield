import { describe, expect, it } from "vitest";
import {
  compareControl,
  type EchoRecord,
  type InjectRecord,
  pairProbes,
  parseJsonl,
  renderControlReport,
  summarizeArm,
} from "../src/native-control.ts";

// The control's reducer is where a cross-terminal claim is made or refused, so
// every refusal below is a row. In particular: the macOS clock trap has a test,
// because it is silent, it is plausible, and it produced a sixteen-hour error in
// this rig's first version.

const START = (originNs: bigint): EchoRecord => ({
  kind: "start",
  monotonicOriginNs: originNs.toString(),
  wallMs: 1_700_000_000_000,
  cols: 120,
  rows: 30,
});

const inject = (index: number, probeId: string, injectedNs: bigint): InjectRecord => ({
  kind: "inject",
  index,
  probeId,
  injectedNs: Number(injectedNs),
});

const key = (
  index: number,
  probeId: string,
  receivedNs: bigint,
  fixtureNs = 20_000n,
): EchoRecord => ({
  kind: "key",
  index,
  probeId,
  receivedNs: receivedNs.toString(),
  echoedNs: (receivedNs + fixtureNs).toString(),
  fixtureNs: fixtureNs.toString(),
});

describe("parseJsonl", () => {
  it("keeps every whole line and drops a truncated tail", () => {
    const parsed = parseJsonl<{ a: number }>('{"a":1}\n{"a":2}\n{"a":3');
    expect(parsed).toEqual([{ a: 1 }, { a: 2 }]);
  });
});

describe("pairProbes", () => {
  const origin = 1_000_000_000_000n;

  it("computes the input path across two processes' clocks", () => {
    // Injected at origin+5ms; the child read it 3ms later.
    const injects = [inject(0, "a", origin + 5_000_000n)];
    const echoes = [START(origin), key(0, "a", 8_000_000n)];
    const result = pairProbes(injects, echoes);
    expect(result.paired).toHaveLength(1);
    expect(result.paired[0]?.inputPathMs).toBeCloseTo(3, 6);
    expect(result.paired[0]?.fixtureMs).toBeCloseTo(0.02, 6);
    expect(result.lost).toBe(0);
  });

  it("REJECTS a negative interval instead of reporting it", () => {
    // This is the macOS clock trap in miniature: an injector reading
    // mach_absolute_time (CLOCK_UPTIME_RAW) against a fixture reading
    // mach_continuous_time (CLOCK_MONOTONIC_RAW) is behind by the machine's
    // total sleep. Here the injector's stamp is far in the future of the
    // fixture's, so the interval comes out negative — and a rig that reported
    // it, or that quietly took an absolute value, would publish nonsense.
    const injects = [inject(0, "a", origin + 60_000_000_000_000n)];
    const echoes = [START(origin), key(0, "a", 8_000_000n)];
    const result = pairProbes(injects, echoes);
    expect(result.paired).toHaveLength(0);
    expect(result.rejected).toBe(1);
    expect(result.rejectionReasons.join(" ")).toContain("NEGATIVE");
    expect(result.rejectionReasons.join(" ")).toContain("mach_continuous_time");
  });

  it("rejects an implausibly large interval as focus loss, not latency", () => {
    const injects = [inject(0, "a", origin)];
    const echoes = [START(origin), key(0, "a", 5_000_000_000n)]; // 5 seconds later
    const result = pairProbes(injects, echoes);
    expect(result.paired).toHaveLength(0);
    expect(result.rejected).toBe(1);
  });

  it("counts keys that never arrived rather than shortening the run", () => {
    const injects = [inject(0, "a", origin), inject(1, "b", origin + 40_000_000n)];
    const echoes = [START(origin), key(0, "a", 3_000_000n)];
    const result = pairProbes(injects, echoes);
    expect(result.injected).toBe(2);
    expect(result.received).toBe(1);
    expect(result.lost).toBe(1);
  });

  it("counts an id mismatch instead of pairing across a gap", () => {
    const injects = [inject(0, "a", origin), inject(1, "b", origin + 40_000_000n)];
    // The 'a' echo was dropped; 'b' arrives first and would otherwise be paired
    // with the 'a' injection, inventing a latency from two different keystrokes.
    const echoes = [START(origin), key(0, "b", 3_000_000n)];
    const result = pairProbes(injects, echoes);
    expect(result.paired).toHaveLength(0);
    expect(result.mismatched).toBe(1);
  });

  it("refuses everything when the fixture wrote no clock origin", () => {
    const result = pairProbes([inject(0, "a", origin)], [key(0, "a", 3_000_000n)]);
    expect(result.paired).toHaveLength(0);
    expect(result.rejectionReasons[0]).toContain("no `start` header");
  });

  it("carries the DSR round trip when the fixture recorded one", () => {
    const injects = [inject(0, "a", origin)];
    const echoes: EchoRecord[] = [
      START(origin),
      key(0, "a", 3_000_000n),
      { kind: "dsr", index: 0, probeId: "a", echoToReplyNs: "450000" },
    ];
    const result = pairProbes(injects, echoes);
    expect(result.paired[0]?.emulatorMs).toBeCloseTo(0.45, 6);
  });
});

describe("compareControl", () => {
  const origin = 1_000_000_000_000n;
  const arm = (terminal: string, offsetsMs: readonly number[], cols = 120, fontSize = 13) => {
    const injects = offsetsMs.map((_, i) =>
      inject(i, "abcdefghijklmnopqrstuvwxyz"[i % 26] as string, origin + BigInt(i) * 40_000_000n),
    );
    const echoes: EchoRecord[] = [
      { ...START(origin), cols },
      ...offsetsMs.map((offset, i) =>
        key(
          i,
          "abcdefghijklmnopqrstuvwxyz"[i % 26] as string,
          BigInt(i) * 40_000_000n + BigInt(Math.round(offset * 1e6)),
        ),
      ),
    ];
    return summarizeArm({
      terminal,
      cols,
      rows: 30,
      fontSize,
      refreshHz: 120,
      pairing: pairProbes(injects, echoes),
    });
  };

  it("refuses to call two different fixtures a control", () => {
    const comparison = compareControl([
      arm("Ghostty", [2, 2, 2], 120),
      // Different column count = a different fixture. TP-R13 names cols×rows,
      // font size and refresh explicitly, and a caveat is not a substitute.
      arm("VibeField", [3, 3, 3], 80),
    ]);
    expect(comparison.verdict).toBe("not-comparable");
    expect(comparison.identityDifferences.join(" ")).toContain("cols");
  });

  it("says awaiting-an-arm rather than reporting one side", () => {
    const comparison = compareControl([arm("VibeField", [3, 3, 3])]);
    expect(comparison.verdict).toBe("awaiting-an-arm");
    expect(Number.isNaN(comparison.inputPathDeltaP50Ms)).toBe(true);
  });

  it("compares matched arms and reports the delta", () => {
    const comparison = compareControl([arm("Ghostty", [2, 2, 2]), arm("VibeField", [3, 3, 3])]);
    expect(comparison.verdict).toBe("comparable");
    expect(comparison.inputPathDeltaP50Ms).toBeCloseTo(1, 3);
    // Under 100 paired probes, so the p99 must be called an anecdote.
    expect(comparison.notes.join(" ")).toContain("p99 is an anecdote");
  });

  it("never prints a photon row it does not have", () => {
    const markdown = renderControlReport(
      compareControl([arm("Ghostty", [2, 2, 2]), arm("VibeField", [3, 3, 3])]),
    );
    expect(markdown).toContain("This is not TP-R13");
    expect(markdown).toContain("inputPath p50");
    expect(markdown).not.toMatch(/\|\s*photon\s*\|/);
  });
});
