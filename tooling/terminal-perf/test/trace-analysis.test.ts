import { describe, expect, it } from "vitest";
import {
  analyzeTrace,
  asyncDurationsMs,
  renderTraceAnalysis,
  type TraceEvent,
} from "../src/trace-analysis";

// Two of these rows encode traps the rig actually hit against a 1,036,772-event
// Chromium 150 recording: the async pairs carry no `dur`, and the keyboard row
// is named RawKeyDown rather than KeyDown.

const pair = (name: string, id: string, from: number, to: number, pid = 1): TraceEvent[] => [
  { name, ph: "b", ts: from, pid, id2: { local: id }, cat: "benchmark,latencyInfo" },
  { name, ph: "e", ts: to, pid, id2: { local: id }, cat: "benchmark,latencyInfo" },
];

describe("asyncDurationsMs", () => {
  it("derives duration from the timestamps, because async events carry no dur", () => {
    const events = [...pair("InputLatency::RawKeyDown", "0x1", 1_000, 16_690)];
    expect(events.every((e) => e.dur === undefined)).toBe(true);
    expect(asyncDurationsMs(events, "InputLatency::RawKeyDown")).toEqual([15.69]);
  });

  it("never joins two processes' events into one impossible duration", () => {
    const events = [
      { name: "X", ph: "b", ts: 0, pid: 1, id2: { local: "0x1" } },
      { name: "X", ph: "e", ts: 5_000_000, pid: 2, id2: { local: "0x1" } },
    ];
    expect(asyncDurationsMs(events, "X")).toEqual([]);
  });

  it("drops an unmatched begin rather than closing it at the end of the trace", () => {
    const events = [
      ...pair("X", "0x1", 0, 1_000),
      { name: "X", ph: "b", ts: 2_000, pid: 1, id2: { local: "0x2" } },
    ];
    expect(asyncDurationsMs(events, "X")).toEqual([1]);
  });
});

describe("analyzeTrace", () => {
  it("names the RawKeyDown trap when the row is empty", () => {
    const analysis = analyzeTrace([{ name: "InputLatency::KeyDown", ph: "b", ts: 0, pid: 1 }]);
    expect(analysis.rows.find((r) => r.name === "InputLatency::RawKeyDown")?.count).toBe(0);
    expect(analysis.notes.join(" ")).toContain("RawKeyDown, never KeyDown");
  });

  it("splits EventLatency by its declared type and refuses to sum the halves", () => {
    const analysis = analyzeTrace([
      ...pair("InputLatency::RawKeyDown", "0x1", 0, 15_690),
      {
        name: "EventLatency",
        ph: "b",
        ts: 0,
        pid: 1,
        id2: { local: "0x9" },
        args: { event_latency: { event_type: "KEY_PRESSED" } },
      },
      { name: "EventLatency", ph: "e", ts: 1_428, pid: 1, id2: { local: "0x9" } },
    ]);
    expect(analysis.eventLatencyByType).toEqual([{ type: "KEY_PRESSED", count: 1 }]);
    expect(analysis.notes.join(" ")).toContain("must never be summed");
  });

  it("renders without inventing a row it has no pairs for", () => {
    const markdown = renderTraceAnalysis(analyzeTrace([]), "/tmp/trace.json");
    expect(markdown).toContain("InputLatency::RawKeyDown");
    expect(markdown).toContain("| 0 | **—** | — | — | — |");
  });
});
