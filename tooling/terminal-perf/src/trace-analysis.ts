// THE PERFETTO TRACE, REDUCED — TP-S0c, §19.1 row 12, pure.
//
// `contentTracing` answers the half of the keystroke path that is the PLATFORM's:
// Chromium's own input router, its frame production, and the swap. It cannot
// follow our echo through DOM -> WS -> cell -> vault -> PTY (that is what the
// echo fixture's `probeId` is for), but it can say what a key cost INSIDE the
// browser, terminal component included — which is the only photon-side number a
// software rig gets without a camera.
//
// THE NAMES, and the hour they cost. §19.1 and the perf-tooling recipe both
// speak of `latencyInfo`, and a first pass looked for `InputLatency::KeyDown`
// and found none — 1,036,772 events and not one match, which reads exactly like
// "synthetic keys are not traced". They are. Chromium 150 emits:
//
//   InputLatency::RawKeyDown / ::Char / ::KeyUp   async b/e pairs, one per key
//   EventLatency                                  async, args.event_latency.event_type
//   PipelineReporter                              async, frame production
//   LatencyInfo.Flow                              instant flow steps, chrome_latency_info.trace_id
//
// There is no `KeyDown`, and the async pairs carry no `dur` — a reducer that
// reads `dur` gets nothing and reports zero. Both traps are why this file
// exists rather than a jq one-liner in a runbook.

export interface TraceEvent {
  name?: string;
  cat?: string;
  ph?: string;
  ts?: number;
  dur?: number;
  pid?: number;
  tid?: number;
  id?: string | number;
  id2?: { local?: string; global?: string };
  args?: Record<string, unknown>;
}

export interface TraceSummary {
  name: string;
  count: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

const at = (sorted: readonly number[], p: number): number =>
  sorted.length === 0
    ? Number.NaN
    : (sorted[
        Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))
      ] as number);

/** The identity an async pair is matched on. Chromium scopes async ids to the
 * process, and `id2.local` is per-process by definition — matching on the id
 * alone would join two processes' events into one impossible duration. */
const asyncKey = (event: TraceEvent): string =>
  `${event.pid ?? "?"}|${event.id2?.local ?? event.id2?.global ?? event.id ?? "?"}`;

/**
 * Duration of every complete async begin/end pair with this name, in ms.
 *
 * Async events (`ph: "b"` / `"e"`) carry NO `dur` — the duration is the
 * difference of two timestamps, and `ts` is microseconds. An unmatched begin
 * (the recording stopped mid-flight) is dropped rather than closed at the end of
 * the trace, which would manufacture a long tail out of the stop itself.
 */
export function asyncDurationsMs(events: readonly TraceEvent[], name: string): number[] {
  const open = new Map<string, number>();
  const durations: number[] = [];
  for (const event of events) {
    if (event.name !== name || event.ts === undefined) continue;
    const key = asyncKey(event);
    if (event.ph === "b") {
      open.set(key, event.ts);
    } else if (event.ph === "e") {
      const began = open.get(key);
      if (began === undefined) continue;
      open.delete(key);
      durations.push((event.ts - began) / 1000);
    }
  }
  return durations.sort((a, b) => a - b);
}

export function summarize(name: string, durations: readonly number[]): TraceSummary {
  return {
    name,
    count: durations.length,
    p50: at(durations, 0.5),
    p95: at(durations, 0.95),
    p99: at(durations, 0.99),
    max: durations.length === 0 ? Number.NaN : (durations[durations.length - 1] as number),
  };
}

/** The rows worth pulling out of a keystroke trace, in the order they are read.
 *
 * `InputLatency::RawKeyDown` is the headline: keyboard event in, terminal
 * component (the swap) out, measured by Chromium about its OWN pipeline. It is
 * the closest thing to photon-side the software rig has, and it is the number
 * TP-R13 would compare if the native terminal published one. */
export const KEYSTROKE_ROWS = [
  "InputLatency::RawKeyDown",
  "InputLatency::Char",
  "InputLatency::KeyUp",
  "EventLatency",
  "PipelineReporter",
] as const;

export interface TraceAnalysis {
  events: number;
  rows: TraceSummary[];
  /** `EventLatency` split by the event type its args declare, so a run's
   * keyboard latency is not diluted by whatever the pointer was doing. */
  eventLatencyByType: { type: string; count: number }[];
  /** Categories actually present, with counts — the artifact's own answer to
   * "what did this recording contain", which is not the same question as
   * `getCategories()`'s "what is available". */
  topCategories: { cat: string; count: number }[];
  notes: string[];
}

export function analyzeTrace(events: readonly TraceEvent[]): TraceAnalysis {
  const rows = KEYSTROKE_ROWS.map((name) => summarize(name, asyncDurationsMs(events, name)));
  const byType = new Map<string, number>();
  const cats = new Map<string, number>();
  for (const event of events) {
    if (event.cat !== undefined) cats.set(event.cat, (cats.get(event.cat) ?? 0) + 1);
    if (event.name === "EventLatency" && event.ph === "b") {
      const type = String(
        ((event.args?.["event_latency"] as { event_type?: unknown } | undefined)?.event_type ??
          "unknown") as string,
      );
      byType.set(type, (byType.get(type) ?? 0) + 1);
    }
  }
  const notes: string[] = [];
  const keyDown = rows.find((row) => row.name === "InputLatency::RawKeyDown");
  if (keyDown !== undefined && keyDown.count === 0) {
    notes.push(
      "no `InputLatency::RawKeyDown` pairs — either no keys were injected during the recording, " +
        "or the `benchmark`/`latencyInfo` categories were not enabled. Note the name: Chromium " +
        "emits RawKeyDown, never KeyDown, and looking for the latter finds nothing in a trace " +
        "that has everything.",
    );
  }
  if (keyDown !== undefined && keyDown.count > 0) {
    notes.push(
      "`InputLatency::RawKeyDown` measures Chromium's OWN pipeline end to end, terminal (swap) " +
        "component included. It does not cover our cell, vault or pty — the echo fixture's " +
        "`probeId` covers those — so the two are complementary halves and must never be summed.",
    );
  }
  return {
    events: events.length,
    rows,
    eventLatencyByType: [...byType.entries()]
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count),
    topCategories: [...cats.entries()]
      .map(([cat, count]) => ({ cat, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10),
    notes,
  };
}

export function renderTraceAnalysis(analysis: TraceAnalysis, tracePath: string): string {
  const fixed = (value: number): string => (Number.isFinite(value) ? value.toFixed(3) : "—");
  const lines: string[] = [];
  lines.push(
    "# Trace analysis — the platform's half of the keystroke (§19.1 row 12)",
    "",
    `Source: \`${tracePath}\` — ${analysis.events.toLocaleString("en-US")} events.`,
    "",
    "| row | n | p50 | p95 | p99 | max |",
    "|---|---:|---:|---:|---:|---:|",
  );
  for (const row of analysis.rows) {
    lines.push(
      `| \`${row.name}\` | ${row.count} | **${fixed(row.p50)}** | ${fixed(row.p95)} | ${fixed(row.p99)} | ${fixed(row.max)} |`,
    );
  }
  lines.push("", "All values milliseconds. Async begin/end pairs; unmatched begins dropped.", "");
  if (analysis.eventLatencyByType.length > 0) {
    lines.push(
      "`EventLatency` by declared event type: " +
        analysis.eventLatencyByType.map((e) => `${e.type}×${e.count}`).join(", "),
      "",
    );
  }
  lines.push("Categories actually present (top 10):", "");
  for (const c of analysis.topCategories) {
    lines.push(`- \`${c.cat}\` — ${c.count.toLocaleString("en-US")}`);
  }
  lines.push("");
  for (const note of analysis.notes) lines.push(`> ${note}`, "");
  return lines.join("\n");
}
