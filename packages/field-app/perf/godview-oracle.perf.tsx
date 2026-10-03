// @vitest-environment happy-dom
/**
 * THE ORACLE (MV-0, step 4): a corpus replayed through TODAY'S seam —
 * `GodviewAgentsProvider` + `useMonitorAgents` with their real dependencies
 * (the package's ledgers, the projection, the usage cache on localStorage)
 * under a fake clock — writing each output `MonitorAgent[]` to JSONL gz. That
 * file is the differential's ground truth for MV-3: the backend, fed the same
 * frames, must produce the same facts.
 *
 * It also COUNTS the seam's work per input frame, which §2 of the design only
 * read from the code: how often `agents` is rebuilt (every object new), how
 * often each ledger runs, and how often the usage cache writes localStorage —
 * the "likely writes on almost every frame" claim, measured. Two arms for that
 * last one: the cache as a fresh install has it (empty), and the cache SEEDED
 * with a record per agent, as a second session finds it.
 *
 *   VF_GODVIEW_RECIPE="n=10,duration=8000,seed=1"   (default)   or
 *   VF_GODVIEW_CORPUS=/path/to/corpus.jsonl.gz        (recorded or generated)
 *   VF_GODVIEW_ORACLE_OUT=<dir>                       (default .vibefield/perf/godview/oracle)
 *   pnpm --filter @vibefield/field-app perf:godview:oracle
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { loadavg } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { readMonitorPalette, type UsageLedgerRecord } from "@vibecook/puppeteer-views";
import { act, type ReactElement, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GodviewAgentsProvider } from "../src/godview/monitor/GodviewAgentsProvider";
import {
  CORPUS_HERE,
  type Corpus,
  generateCorpus,
  parseRecipe,
  recipeName,
} from "../src/godview/monitor/perf/corpus";
import { asGeneratedCorpus } from "../src/godview/monitor/perf/corpus-codec";
import type { RecordedFrame } from "../src/godview/monitor/perf/frame-recorder";
import { createReplayDoor, type ReplayDoor } from "../src/godview/monitor/perf/replay-door";
import type { MonitorAgent } from "../src/godview/monitor/types";
import { type MonitorPaneFacts, useMonitorAgents } from "../src/godview/monitor/useMonitorAgents";
import { readCorpusGz } from "./lib/corpus-io";

// THE COUNTERS, on the seam's own doors: the package's ledgers and the local
// projection, each wrapped to count and otherwise untouched.
const counters = vi.hoisted(() => ({
  reconcileUsage: 0,
  reconcileUnread: 0,
  observeStatuses: 0,
  exportUsage: 0,
  assemble: 0,
  dealProjectSeqs: 0,
}));
vi.mock("@vibecook/puppeteer-views", async (original) => {
  const views = await original<typeof import("@vibecook/puppeteer-views")>();
  const counted = <A extends unknown[], R>(key: keyof typeof counters, fn: (...args: A) => R) => {
    return (...args: A): R => {
      counters[key] += 1;
      return fn(...args);
    };
  };
  return {
    ...views,
    reconcileUsage: counted("reconcileUsage", views.reconcileUsage),
    reconcileUnread: counted("reconcileUnread", views.reconcileUnread),
    observeStatuses: counted("observeStatuses", views.observeStatuses),
    exportUsage: counted("exportUsage", views.exportUsage),
  };
});
vi.mock("../src/godview/monitor/agents", async (original) => {
  const agents = await original<typeof import("../src/godview/monitor/agents")>();
  return {
    ...agents,
    assembleMonitorAgents: (...args: Parameters<typeof agents.assembleMonitorAgents>) => {
      counters.assemble += 1;
      return agents.assembleMonitorAgents(...args);
    },
  };
});
vi.mock("../src/godview/monitor/project-ledger", async (original) => {
  const ledger = await original<typeof import("../src/godview/monitor/project-ledger")>();
  return {
    ...ledger,
    dealProjectSeqs: (...args: Parameters<typeof ledger.dealProjectSeqs>) => {
      counters.dealProjectSeqs += 1;
      return ledger.dealProjectSeqs(...args);
    },
  };
});

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** The seam's own storage keys (`useMonitorAgents.ts`), matched by name. */
const USAGE_CACHE_KEY = "vf-godview-usage-history-v1";
const PROJECT_LEDGER_KEY = "vf-godview-projects-v1";

interface FrameWork {
  seq: number;
  t: number;
  kind: RecordedFrame["kind"];
  /** `agents` came back as a new array (every object in it new) */
  rebuilt: boolean;
  renders: number;
  assemble: number;
  reconcileUsage: number;
  reconcileUnread: number;
  observeStatuses: number;
  exportUsage: number;
  dealProjectSeqs: number;
  usageWrites: number;
  projectWrites: number;
  storageReads: number;
  agents: number;
}

export interface OracleSummary {
  corpus: string;
  source: string;
  seededCache: boolean;
  frames: { total: number; fold: number; mesh: number };
  durationS: number;
  rebuilds: { total: number; onFoldFrames: number; perFoldFrame: number };
  renders: { total: number; perFrame: number };
  ledgers: Record<keyof typeof counters, number>;
  localStorage: {
    usageWrites: number;
    usageWritesPerFoldFrame: number;
    usageWritesPerSecond: number;
    projectWrites: number;
    reads: number;
  };
  marks: number[];
  agentsOut: number;
  elapsedMs: number;
  loadavg: { before: number[]; after: number[] };
}

let probeRenders = 0;
let latest: readonly MonitorAgent[] | null = null;
let rebuilds = 0;

function Probe({
  door,
  panes,
}: {
  door: ReplayDoor;
  panes: MonitorPaneFacts;
}): ReactElement | null {
  const palette = readMonitorPalette(document.documentElement);
  const { agents } = useMonitorAgents({ palette, door, panes });
  probeRenders += 1;
  useLayoutEffect(() => {
    if (agents !== latest) {
      latest = agents;
      rebuilds += 1;
    }
  }, [agents]);
  return null;
}

function snapshotCounters(): Record<keyof typeof counters, number> {
  return { ...counters };
}

/** A `MonitorAgent[]` as JSON: Maps become objects, nothing else is touched. */
function agentsJson(agents: readonly MonitorAgent[]): string {
  return JSON.stringify(agents, (_key, value: unknown) =>
    value instanceof Map ? Object.fromEntries(value) : value,
  );
}

function loadCorpus(): { corpus: Corpus; name: string; source: string } {
  const path = process.env["VF_GODVIEW_CORPUS"];
  if (path !== undefined && path !== "") {
    const corpus = asGeneratedCorpus(readCorpusGz(path));
    return { corpus, name: recipeName(corpus.meta.recipe), source: path };
  }
  const text = process.env["VF_GODVIEW_RECIPE"] ?? "n=10,duration=8000,seed=1";
  const recipe = parseRecipe(text);
  return { corpus: generateCorpus(recipe), name: recipeName(recipe), source: `recipe ${text}` };
}

function outDir(): string {
  const dir =
    process.env["VF_GODVIEW_ORACLE_OUT"] ??
    join(import.meta.dirname, "..", "..", "..", ".vibefield", "perf", "godview", "oracle");
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** The cache as a SECOND session finds it: one version-2 record per agent, keyed
 * `{providerId: row.kind, nativeSessionId: row.sessionId}` as the seam keys its
 * `usageKeys`, with one run under the agent's run id. */
function seedUsageCache(corpus: Corpus): number {
  const first = corpus.frames.find((frame) => frame.kind === "fold");
  if (first === undefined || first.kind !== "fold") return 0;
  const records: UsageLedgerRecord[] = first.rows.map((row) => ({
    currency: "USD",
    providerId: row.kind,
    nativeSessionId: row.sessionId,
    savedAt: new Date(corpus.meta.recipe.baseWall - 60_000).toISOString(),
    runs: [{ runId: row.runtimeRunId, coverage: "complete", costUsd: 0.01, buckets: [] }],
  }));
  localStorage.setItem(USAGE_CACHE_KEY, JSON.stringify({ version: 2, records }));
  return records.length;
}

let root: Root | null = null;
let container: HTMLElement | null = null;

beforeEach(() => {
  probeRenders = 0;
  latest = null;
  rebuilds = 0;
  for (const key of Object.keys(counters) as (keyof typeof counters)[]) counters[key] = 0;
  localStorage.clear();
});

afterEach(async () => {
  if (root !== null) {
    const held = root;
    await act(async () => {
      held.unmount();
    });
    root = null;
  }
  container?.remove();
  container = null;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/**
 * Replay one corpus through the seam. Writes the output boards (JSONL gz), the
 * per-frame work and a summary beside them when `write` is set, and returns the
 * summary either way.
 */
async function replay(
  input: { corpus: Corpus; name: string; source: string },
  options: { seededCache: boolean; write: boolean },
): Promise<OracleSummary> {
  const { corpus, name, source } = input;
  const loadBefore = loadavg();
  if (options.seededCache) seedUsageCache(corpus);

  // THE CLOCK: the corpus's wall clock, advanced frame by frame. The hook
  // reads `Date.now()` for its ledgers and arms the 30 s usage step on
  // `setTimeout`/`setInterval`; both are the fake's.
  vi.useFakeTimers({
    toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"],
  });
  const base = corpus.meta.recipe.baseWall;
  vi.setSystemTime(base);

  const marks: number[] = [];
  const door = createReplayDoor({
    roster: corpus.roster,
    onMark: (frame) => marks.push(frame.seq),
  });
  const panes: MonitorPaneFacts = {
    sessionIds: corpus.panes.sessionIds,
    ...(corpus.panes.activeSessionId !== undefined
      ? { activeSessionId: corpus.panes.activeSessionId }
      : {}),
    sessions: corpus.panes.sessions,
    floor: corpus.panes.floor,
  };

  const setItem = vi.spyOn(localStorage, "setItem");
  const getItem = vi.spyOn(localStorage, "getItem");

  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <GodviewAgentsProvider door={door}>
        <Probe door={door} panes={panes} />
      </GodviewAgentsProvider>,
    );
  });
  expect(door.listeners().fold).toBe(1);
  expect(door.listeners().mesh).toBe(1);

  const lines: string[] = [];
  lines.push(
    JSON.stringify({
      kind: "oracle-meta",
      oracle: "vibefield-godview-oracle",
      version: 1,
      corpus: name,
      source,
      seededCache: options.seededCache,
      recipe: corpus.meta.recipe,
      marker: corpus.meta.marker,
      here: CORPUS_HERE,
      startedAt: new Date(Date.now()).toISOString(),
    }),
  );

  const work: FrameWork[] = [];
  let previousAgents: readonly MonitorAgent[] | null = null;
  let lastWrittenSeq = 0;
  const started = performance.now();
  for (let index = 0; index < corpus.frames.length; index += 1) {
    const frame = corpus.frames[index] as RecordedFrame;
    const next = corpus.frames[index + 1];
    vi.setSystemTime(base + frame.t);
    const before = snapshotCounters();
    const rendersBefore = probeRenders;
    const setBefore = setItem.mock.calls.length;
    const getBefore = getItem.mock.calls.length;
    const rebuildsBefore = rebuilds;
    await act(async () => {
      door.deliver(frame);
    });
    // the gap to the next frame passes on the fake clock, so a 30 s step
    // boundary or a mesh retry inside it fires where it would have
    if (next !== undefined && next.t > frame.t) {
      await act(async () => {
        vi.advanceTimersByTime(next.t - frame.t);
      });
    }
    const after = snapshotCounters();
    const writes = setItem.mock.calls.slice(setBefore).map((call) => String(call[0]));
    const agents = latest ?? [];
    work.push({
      seq: frame.seq,
      t: frame.t,
      kind: frame.kind,
      rebuilt: rebuilds !== rebuildsBefore,
      renders: probeRenders - rendersBefore,
      assemble: after.assemble - before.assemble,
      reconcileUsage: after.reconcileUsage - before.reconcileUsage,
      reconcileUnread: after.reconcileUnread - before.reconcileUnread,
      observeStatuses: after.observeStatuses - before.observeStatuses,
      exportUsage: after.exportUsage - before.exportUsage,
      dealProjectSeqs: after.dealProjectSeqs - before.dealProjectSeqs,
      usageWrites: writes.filter((key) => key === USAGE_CACHE_KEY).length,
      projectWrites: writes.filter((key) => key === PROJECT_LEDGER_KEY).length,
      storageReads: getItem.mock.calls.length - getBefore,
      agents: agents.length,
    });
    if (agents !== previousAgents) {
      previousAgents = agents;
      lastWrittenSeq = frame.seq;
      lines.push(
        `{"kind":"oracle-frame","seq":${frame.seq},"t":${frame.t},"agents":${agentsJson(agents)}}`,
      );
    } else {
      lines.push(
        JSON.stringify({
          kind: "oracle-frame",
          seq: frame.seq,
          t: frame.t,
          sameAs: lastWrittenSeq,
        }),
      );
    }
  }
  const elapsedMs = performance.now() - started;

  const folds = work.filter((entry) => entry.kind === "fold");
  const sum = (key: keyof FrameWork): number =>
    work.reduce((total, entry) => total + (entry[key] as number), 0);
  const foldsRebuilt = folds.filter((entry) => entry.rebuilt).length;
  const durationS = corpus.meta.recipe.durationMs / 1_000;
  const summary: OracleSummary = {
    corpus: name,
    source,
    seededCache: options.seededCache,
    frames: { total: work.length, fold: folds.length, mesh: work.length - folds.length - 1 },
    durationS,
    rebuilds: {
      total: rebuilds,
      onFoldFrames: foldsRebuilt,
      perFoldFrame: foldsRebuilt / folds.length,
    },
    renders: { total: probeRenders, perFrame: probeRenders / work.length },
    ledgers: {
      assemble: sum("assemble"),
      reconcileUsage: sum("reconcileUsage"),
      reconcileUnread: sum("reconcileUnread"),
      observeStatuses: sum("observeStatuses"),
      exportUsage: sum("exportUsage"),
      dealProjectSeqs: sum("dealProjectSeqs"),
    },
    localStorage: {
      usageWrites: sum("usageWrites"),
      usageWritesPerFoldFrame: sum("usageWrites") / folds.length,
      usageWritesPerSecond: sum("usageWrites") / durationS,
      projectWrites: sum("projectWrites"),
      reads: sum("storageReads"),
    },
    marks,
    agentsOut: work.at(-1)?.agents ?? 0,
    elapsedMs: Math.round(elapsedMs),
    loadavg: { before: loadBefore, after: loadavg() },
  };
  lines.push(JSON.stringify({ kind: "oracle-summary", ...summary }));

  if (options.write) {
    const dir = outDir();
    const suffix = options.seededCache ? "-seeded" : "";
    const outPath = join(dir, `oracle-${name}${suffix}.jsonl.gz`);
    writeFileSync(outPath, gzipSync(Buffer.from(`${lines.join("\n")}\n`, "utf8"), { level: 6 }));
    writeFileSync(
      join(dir, `oracle-${name}${suffix}.summary.json`),
      `${JSON.stringify(summary, null, 2)}\n`,
    );
    writeFileSync(join(dir, `oracle-${name}${suffix}.work.json`), `${JSON.stringify(work)}\n`);
    process.stdout.write(`${JSON.stringify({ outPath, ...summary })}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(summary)}\n`);
  }

  // the seam saw every frame, and the marker's flip reached the output
  expect(work.length).toBe(corpus.frames.length);
  expect(marks).toHaveLength(corpus.meta.counts.marks);
  const flipped = latest?.find((agent) => agent.id === corpus.meta.marker.runtimeRunId);
  expect(flipped?.status).toBe(corpus.meta.marker.to);
  expect(latest?.length ?? 0).toBeGreaterThanOrEqual(corpus.meta.recipe.n);
  return summary;
}

describe("the oracle", () => {
  it("replays the corpus through today's seam and writes every output board (fresh cache)", async () => {
    await replay(loadCorpus(), { seededCache: false, write: true });
  });

  it("replays the same corpus with the usage cache SEEDED, and writes that too", async () => {
    await replay(loadCorpus(), { seededCache: true, write: true });
  });
});
