// THE NATIVE CONTROL'S ANALYSIS — TP-S0c / TP-D19 / TP-R13, pure.
//
// Pairs the OS-level injector's records with the raw-mode echo fixture's, and
// reduces them to the intervals a terminal can actually be graded on. It is the
// same reduction for Ghostty and for VibeField, because it is the same fixture
// and the same injector on both sides — which is the whole content of an A-vs-A
// control.
//
// WHAT THIS MEASURES, AND WHAT IT HONESTLY DOES NOT.
//
//   inputPath   inject (CGEvent posted) -> the child program read the byte.
//               For Ghostty: window server -> Ghostty -> its pty.
//               For VibeField: window server -> Chromium -> renderer -> control
//               WS -> cell -> vault -> pty. §18.1 rows 1–4 minus the shell.
//               COMPARABLE between the two, and the injector's own overhead
//               cancels in the difference because it is the same injector.
//
//   emulator    the fixture's echo -> the terminal's DSR reply arrives back.
//               The emulator had to PARSE the echoed byte to answer, so this
//               bounds byte -> model-applied. Also comparable. NOT byte ->
//               pixel: presenting is downstream of parsing, and nothing in a
//               pty can observe a photon.
//
//   photon      NOT MEASURED HERE, for either side, and not claimed. TP-R13's
//               headline is keystroke -> photon, and the software rig reaches
//               it on OUR side only (Chromium's `latencyInfo` frame-swap
//               component, read from a `trace`-mode recording). Ghostty exposes
//               no equivalent, so the cross-terminal photon comparison waits for
//               the OPTIONAL hardware pass (§18.10, never a gate) or a
//               display-sampling rig. Publishing an inputPath delta under the
//               name "keystroke to photon" would be the kind of quiet
//               substitution this file exists to refuse.

/** One line from `inject-keys.swift`. */
export interface InjectRecord {
  kind: string;
  index?: number;
  probeId?: string;
  injectedNs?: number;
  trusted?: boolean;
  posted?: number;
  monotonicNs?: number;
}

/** One line from `echo-probe.mjs`. Nanosecond fields are strings because they
 * are `BigInt` on the writing side and JSON has no bigint. */
export interface EchoRecord {
  kind: string;
  probeId?: string;
  index?: number;
  receivedNs?: string;
  echoedNs?: string;
  fixtureNs?: string;
  echoToReplyNs?: string;
  monotonicOriginNs?: string;
  wallMs?: number;
  cols?: number | null;
  rows?: number | null;
  keys?: number;
}

export function parseJsonl<T>(text: string): T[] {
  const out: T[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    try {
      out.push(JSON.parse(trimmed) as T);
    } catch {
      /* a truncated tail is what a killed run leaves */
    }
  }
  return out;
}

export interface PairedProbe {
  index: number;
  probeId: string;
  /** inject -> the child read it, milliseconds. */
  inputPathMs: number;
  /** the child's own read->write cost, milliseconds — subtract to isolate the
   * terminal from the fixture. */
  fixtureMs: number;
  /** echo -> DSR reply, milliseconds; null when the run did not ask for DSR. */
  emulatorMs: number | null;
}

export interface PairingResult {
  paired: PairedProbe[];
  injected: number;
  received: number;
  /** Keys posted that the fixture never read. On a control run this is the
   * number that decides whether the run is usable at all: a run that lost half
   * its keys measured focus, not latency. */
  lost: number;
  /** Pairs whose ids disagreed — reordering, or the 26-wide alphabet wrapping
   * against a lost key. Excluded from `paired` and counted here. */
  mismatched: number;
  /** Pairs rejected because the interval was negative or implausibly large.
   * A NEGATIVE interval means the two sides are not on the same clock, which is
   * a real and silent failure mode on macOS (mach_absolute_time vs
   * mach_continuous_time differ by the machine's accumulated sleep). */
  rejected: number;
  rejectionReasons: string[];
}

/** Anything past this is not a keystroke latency; it is a focus loss, a
 * scheduler stall the size of a coffee break, or two different clocks. One
 * second is far outside any plausible value and far inside "obviously wrong". */
const MAX_PLAUSIBLE_MS = 1_000;

export function pairProbes(
  injects: readonly InjectRecord[],
  echoes: readonly EchoRecord[],
): PairingResult {
  const start = echoes.find((record) => record.kind === "start");
  const origin = start?.monotonicOriginNs === undefined ? null : BigInt(start.monotonicOriginNs);
  const posted = injects.filter((record) => record.kind === "inject");
  const keys = echoes.filter((record) => record.kind === "key");
  const dsr = new Map<number, string>();
  for (const record of echoes) {
    if (record.kind === "dsr" && record.index !== undefined && record.echoToReplyNs !== undefined) {
      dsr.set(record.index, record.echoToReplyNs);
    }
  }

  const paired: PairedProbe[] = [];
  const reasons = new Set<string>();
  let mismatched = 0;
  let rejected = 0;

  if (origin === null) {
    return {
      paired,
      injected: posted.length,
      received: keys.length,
      lost: posted.length - keys.length,
      mismatched: 0,
      rejected: keys.length,
      rejectionReasons: ["the echo fixture wrote no `start` header, so its clock has no origin"],
    };
  }

  // Pair by ARRIVAL ORDER, checking the id. The id is 26 wide and wraps, so it
  // cannot be a primary key; what it can do is catch a lost or reordered probe,
  // and that is the job it is given here.
  const n = Math.min(posted.length, keys.length);
  for (let i = 0; i < n; i += 1) {
    const inject = posted[i] as InjectRecord;
    const key = keys[i] as EchoRecord;
    if (inject.probeId !== key.probeId) {
      mismatched += 1;
      continue;
    }
    if (inject.injectedNs === undefined || key.receivedNs === undefined) {
      rejected += 1;
      reasons.add("a record was missing its timestamp");
      continue;
    }
    const receivedAbsolute = origin + BigInt(key.receivedNs);
    const inputPathMs = Number(receivedAbsolute - BigInt(inject.injectedNs)) / 1e6;
    if (inputPathMs < 0) {
      rejected += 1;
      reasons.add(
        "a NEGATIVE interval — the injector and the fixture are not reading the same clock " +
          "(on macOS, mach_absolute_time and mach_continuous_time differ by total sleep time)",
      );
      continue;
    }
    if (inputPathMs > MAX_PLAUSIBLE_MS) {
      rejected += 1;
      reasons.add(
        `an interval over ${MAX_PLAUSIBLE_MS}ms — focus loss or a stalled host, not latency`,
      );
      continue;
    }
    const emulatorRaw = key.index === undefined ? undefined : dsr.get(key.index);
    paired.push({
      index: i,
      probeId: key.probeId as string,
      inputPathMs,
      fixtureMs: key.fixtureNs === undefined ? Number.NaN : Number(BigInt(key.fixtureNs)) / 1e6,
      emulatorMs: emulatorRaw === undefined ? null : Number(BigInt(emulatorRaw)) / 1e6,
    });
  }

  return {
    paired,
    injected: posted.length,
    received: keys.length,
    lost: Math.max(0, posted.length - keys.length),
    mismatched,
    rejected,
    rejectionReasons: [...reasons],
  };
}

export interface ControlArm {
  terminal: string;
  cols: number | null;
  rows: number | null;
  fontSize: number | null;
  refreshHz: number | null;
  pairing: PairingResult;
  inputPath: { p50: number; p95: number; p99: number; max: number; n: number };
  fixtureCost: { p50: number; max: number };
  emulator: { p50: number; p95: number; n: number } | null;
}

const at = (sorted: readonly number[], p: number): number =>
  sorted.length === 0
    ? Number.NaN
    : (sorted[
        Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))
      ] as number);

export function summarizeArm(input: {
  terminal: string;
  cols: number | null;
  rows: number | null;
  fontSize: number | null;
  refreshHz: number | null;
  pairing: PairingResult;
}): ControlArm {
  const inputPath = [...input.pairing.paired.map((p) => p.inputPathMs)].sort((a, b) => a - b);
  const fixture = [...input.pairing.paired.map((p) => p.fixtureMs).filter(Number.isFinite)].sort(
    (a, b) => a - b,
  );
  const emulator = [
    ...input.pairing.paired
      .map((p) => p.emulatorMs)
      .filter((value): value is number => value !== null && Number.isFinite(value)),
  ].sort((a, b) => a - b);
  return {
    terminal: input.terminal,
    cols: input.cols,
    rows: input.rows,
    fontSize: input.fontSize,
    refreshHz: input.refreshHz,
    pairing: input.pairing,
    inputPath: {
      p50: at(inputPath, 0.5),
      p95: at(inputPath, 0.95),
      p99: at(inputPath, 0.99),
      max: inputPath.length === 0 ? Number.NaN : (inputPath[inputPath.length - 1] as number),
      n: inputPath.length,
    },
    fixtureCost: {
      p50: at(fixture, 0.5),
      max: fixture.length === 0 ? Number.NaN : (fixture[fixture.length - 1] as number),
    },
    emulator:
      emulator.length === 0
        ? null
        : { p50: at(emulator, 0.5), p95: at(emulator, 0.95), n: emulator.length },
  };
}

export type ControlVerdict =
  | "comparable"
  | "not-comparable"
  | "insufficient-samples"
  | "awaiting-an-arm";

export interface ControlComparison {
  arms: ControlArm[];
  /** The fixture-identity check TP-R13 demands: same cols×rows, font size and
   * refresh. A run whose arms disagree on any of them is NOT an A-vs-A control
   * and is refused rather than reported with a caveat. */
  identical: boolean;
  identityDifferences: string[];
  verdict: ControlVerdict;
  notes: string[];
  /** VibeField's inputPath p50 minus the native's, in ms; NaN when either arm
   * is missing. This is the ONLY cross-terminal number this rig produces today. */
  inputPathDeltaP50Ms: number;
  inputPathDeltaP99Ms: number;
}

/** How many paired probes make a p99 worth printing. Below this the p99 IS the
 * max and reporting it as a quantile is a lie about a distribution. */
const MIN_SAMPLES_FOR_TAILS = 100;

export function compareControl(arms: readonly ControlArm[]): ControlComparison {
  const notes: string[] = [];
  const differences: string[] = [];
  const [a, b] = arms;

  if (arms.length < 2) {
    return {
      arms: [...arms],
      identical: false,
      identityDifferences: [],
      verdict: "awaiting-an-arm",
      notes: [
        `only ${arms.length} arm(s) ran — a control needs both the native terminal and VibeField ` +
          "on the same display, same fixture, same host load",
      ],
      inputPathDeltaP50Ms: Number.NaN,
      inputPathDeltaP99Ms: Number.NaN,
    };
  }

  const left = a as ControlArm;
  const right = b as ControlArm;
  const compare = (name: string, x: unknown, y: unknown): void => {
    if (x !== y) differences.push(`${name}: ${String(x)} vs ${String(y)}`);
  };
  compare("cols", left.cols, right.cols);
  compare("rows", left.rows, right.rows);
  compare("fontSize", left.fontSize, right.fontSize);
  compare("refreshHz", left.refreshHz, right.refreshHz);

  for (const arm of arms) {
    if (arm.pairing.lost > 0) {
      notes.push(
        `${arm.terminal}: ${arm.pairing.lost} of ${arm.pairing.injected} keys never reached the ` +
          "fixture — the arm lost focus, or the events went to another window",
      );
    }
    if (arm.pairing.rejected > 0) {
      notes.push(
        `${arm.terminal}: ${arm.pairing.rejected} rejected — ${arm.pairing.rejectionReasons.join("; ")}`,
      );
    }
    if (arm.inputPath.n < MIN_SAMPLES_FOR_TAILS) {
      notes.push(
        `${arm.terminal}: ${arm.inputPath.n} paired probes is under ${MIN_SAMPLES_FOR_TAILS}, so its ` +
          "p99 is an anecdote and only the p50 is quotable",
      );
    }
  }

  const usable = arms.every((arm) => arm.inputPath.n > 0);
  const verdict: ControlVerdict = !usable
    ? "insufficient-samples"
    : differences.length > 0
      ? "not-comparable"
      : "comparable";

  return {
    arms: [...arms],
    identical: differences.length === 0,
    identityDifferences: differences,
    verdict,
    notes,
    inputPathDeltaP50Ms: right.inputPath.p50 - left.inputPath.p50,
    inputPathDeltaP99Ms: right.inputPath.p99 - left.inputPath.p99,
  };
}

/** The report, as markdown. Refuses to print a photon row it does not have. */
export function renderControlReport(comparison: ControlComparison): string {
  const fixed = (value: number, digits = 3): string =>
    Number.isFinite(value) ? value.toFixed(digits) : "—";
  const lines: string[] = [];
  lines.push("## The native control (TP-D19 / TP-R13)", "");
  lines.push(`**Verdict: \`${comparison.verdict}\`**`, "");
  lines.push(
    "| terminal | cols×rows | font | refresh | paired | inputPath p50 | p95 | p99 | max | fixture cost p50 | emulator DSR p50 |",
    "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
  );
  for (const arm of comparison.arms) {
    lines.push(
      `| ${arm.terminal} | ${arm.cols ?? "?"}×${arm.rows ?? "?"} | ${arm.fontSize ?? "?"} | ` +
        `${arm.refreshHz ?? "?"}Hz | ${arm.inputPath.n}/${arm.pairing.injected} | ` +
        `**${fixed(arm.inputPath.p50)}** | ${fixed(arm.inputPath.p95)} | ${fixed(arm.inputPath.p99)} | ` +
        `${fixed(arm.inputPath.max)} | ${fixed(arm.fixtureCost.p50)} | ` +
        `${arm.emulator === null ? "not run" : fixed(arm.emulator.p50)} |`,
    );
  }
  lines.push("", "All values milliseconds.", "");

  if (comparison.identityDifferences.length > 0) {
    lines.push(
      "> **The arms are not the same fixture**, so this is not an A-vs-A control:",
      ...comparison.identityDifferences.map((d) => `> - ${d}`),
      "",
    );
  }
  if (Number.isFinite(comparison.inputPathDeltaP50Ms)) {
    lines.push(
      `**inputPath delta (VibeField − native): p50 ${fixed(comparison.inputPathDeltaP50Ms)}ms · ` +
        `p99 ${fixed(comparison.inputPathDeltaP99Ms)}ms.**`,
      "",
    );
  }
  for (const note of comparison.notes) lines.push(`- ${note}`);
  lines.push(
    "",
    "> **This is not TP-R13.** TP-R13 grades keystroke → PHOTON within one display frame of the",
    "> native terminal's p50. What is above is keystroke → the child program read the byte, which",
    "> covers §18.1 rows 1–4 and stops there. The native terminal exposes no frame-swap timestamp,",
    "> so the photon half of the comparison waits for the optional hardware pass (§18.10) or a",
    "> display-sampling rig. VibeField's own keystroke → swap is measurable today from a",
    "> `trace`-mode `latencyInfo` recording and is reported separately — against itself, never as",
    "> a cross-terminal number it is not.",
  );
  return lines.join("\n");
}
