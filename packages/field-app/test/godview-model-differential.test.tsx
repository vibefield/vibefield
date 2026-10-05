// @vitest-environment happy-dom
/**
 * MV-3b (M24) — THE DIFFERENTIAL AGAINST THE ORACLE, end to end.
 *
 * mv0-vf recorded what TODAY's seam (`GodviewAgentsProvider` + the pre-MV
 * `useMonitorAgents`, with its ledgers, its projection and its localStorage,
 * under a fake clock) produced for each deterministic corpus: one `MonitorAgent[]`
 * per corpus frame, preserved read-only at `/Volumes/SamsungRed/lanes/mv/oracle/`
 * (`README.md` there; regenerate at the pre-MV ref, never here). This test drives
 * the NEW path from the same corpora and compares, frame by frame, what the
 * views would read of every row (`viewReadProjection`, the legacy shim's audit
 * of the four views' reads):
 *
 *   corpus fold frames → the runtime's states and fieldd's host facts
 *     → fieldd's hosted backend and its board projection (`model-board-fixture.ts`,
 *       the real `agent-monitor.ts` / `agent-model-board.ts` on scripted sources)
 *     → the door's model port → mv3a's window adapter (`model-replica.ts`)
 *     → the replica, with the window-local facts the oracle run had (the corpus's
 *       panes and floor) → the legacy shim (`window-rows.ts`) → `useMonitorAgents`
 *
 * Rows are paired by what each side names them by — a run for an agent row, the
 * floor session for a bare terminal — never by `id`: the backend deals a row the
 * shell's id when the floor lists its PTY (M22), which is invisible.
 *
 * Every difference is either fixed or NAMED below (`ACCEPTED`), with its cause
 * and why it is invisible; an unnamed difference fails. The cost rate compares
 * under a float tolerance (M27 rounds it once).
 *
 * PEERS (MV-3d, M39). The corpus's mesh frames are the pre-MV desk wire
 * (`deskRowOf(foldRowOf(peer))`, no `monitorRow`): the oracle drew each peer from
 * them through the pre-MV seam (`monitorAgentFromMesh`), and nothing in them can
 * feed the new path, which draws a peer from the model row its OWNER's backend
 * computed. So the peer gets that owner here: the corpus generator's own peer
 * fold rows (`CorpusTick.peer`, its mirrors — what the corpus's desk rows were
 * cut from) run through a peer desktop's own fieldd backend and desk cut
 * (`model-board-fixture.ts` `peer`, the real `agent-monitor.ts` and
 * `projectDeskRow`), and its board reaches the window at exactly the corpus
 * frames where the oracle's mesh moved (the open and each of the peer's desk
 * deltas). The rows are read through JSON once the corpus is complete, as the
 * B arm's model stream reads them (`perf/lib/model-stream.ts`). Peers are paired
 * by their run and tallied apart from this desktop's rows; every difference is
 * fixed or named (`PEER_ACCEPTED`). The oracle needs no regenerating: the corpus
 * is unchanged, so its peer rows are the pre-MV seam's rendering of these very
 * frames.
 *
 * The seeded oracles (`*-seeded`) replayed with a localStorage usage cache the
 * pre-MV seam carried; L11 retired it (a ruled difference), so they are skipped.
 *
 * Skips with its reason when the oracle directory is absent (another machine).
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import {
  type AccountUsagePort,
  type HistoryPort,
  useMonitorPalette,
  type MonitorAgent as ViewsMonitorAgent,
} from "@vibecook/puppeteer-views";
import { type MonitorAgentViewReads, viewReadProjection } from "@vibecook/puppeteer-views/legacy";
import type { TerminalInfo } from "@vibefield/contracts";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentSessionSummary } from "../src/godview/monitor/facet-types";
import {
  GodviewAgentsProvider,
  useMonitorFeed,
} from "../src/godview/monitor/GodviewAgentsProvider";
import {
  type Corpus,
  type CorpusRecipe,
  type CorpusTick,
  generateCorpus,
} from "../src/godview/monitor/perf/corpus";
import type { RecordedFrame } from "../src/godview/monitor/perf/frame-recorder";
import type { MonitorDoor } from "../src/godview/monitor/remote-door";
import { type MonitorPaneFacts, useMonitorAgents } from "../src/godview/monitor/useMonitorAgents";
import { type ScriptedModelBoard, scriptedModelBoard, terminalInfoOf } from "./model-board-fixture";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ORACLE_DIR = process.env["VF_GODVIEW_ORACLE_DIR"] ?? "/Volumes/SamsungRed/lanes/mv/oracle";

interface OracleMeta {
  kind: "oracle-meta";
  corpus: string;
  source: string;
  seededCache: boolean;
  recipe: CorpusRecipe;
  here: string;
}

/** The pre-MV seam's row, as the oracle wrote it: the views' shape plus the two
 * facts this differential pairs rows by. */
type OracleAgent = ViewsMonitorAgent & {
  floorSessionId?: string;
  agent?: ViewsMonitorAgent["agent"] & { runtimeRunId?: string };
};

/** A frame line: the rows when they changed, else `sameAs` the seq that last wrote them. */
interface OracleFrame {
  kind: "oracle-frame";
  seq: number;
  t: number;
  agents?: OracleAgent[];
  sameAs?: number;
}

interface Oracle {
  meta: OracleMeta;
  /** every frame's rows, `sameAs` resolved */
  frames: Map<number, { seq: number; t: number; agents: OracleAgent[] }>;
}

function readOracle(path: string): Oracle {
  const text = gunzipSync(readFileSync(path)).toString("utf8");
  let meta: OracleMeta | undefined;
  const frames = new Map<number, { seq: number; t: number; agents: OracleAgent[] }>();
  for (const line of text.split("\n")) {
    if (line === "") continue;
    const parsed = JSON.parse(line) as { kind: string };
    if (parsed.kind === "oracle-meta") meta = parsed as OracleMeta;
    else if (parsed.kind === "oracle-frame") {
      const frame = parsed as OracleFrame;
      const agents =
        frame.agents ?? (frame.sameAs === undefined ? undefined : frames.get(frame.sameAs)?.agents);
      if (agents === undefined) throw new Error(`${path}: frame ${frame.seq} names no rows`);
      frames.set(frame.seq, { seq: frame.seq, t: frame.t, agents });
    }
  }
  if (meta === undefined) throw new Error(`${path}: no oracle-meta line`);
  return { meta, frames };
}

/**
 * Differences accepted by name: the path as the views read it, and why a person
 * sees no difference. Everything else fails.
 */
const ACCEPTED: Record<string, string> = {
  // The oracle recorded the hook's rows BEFORE the stage's `withProfileSets`, which
  // stamped every agent row `native` (This Mac) on its way to the views; the backend
  // stamps it on the row itself (`resolveProfileSet`), so the hook's rows carry it
  // already. The views read `native` on both paths (M27: accepted as invisible).
  profileSet:
    "the seam stamped `native` after the oracle's probe; the backend stamps it on the row",
};

/**
 * M39 — the peers' differences, accepted by name: the path as the views read it,
 * and why. Filled from the differential's own report (see the run's log), never
 * ahead of it.
 */
const PEER_ACCEPTED: Record<string, string> = {};

/** Field paths the differential compares around, never on: how each side names a row. */
const IDENTITY = new Set(["id", "visualId"]);
/** M27 — the burn rate is rounded once; a float ulp is not a difference. */
const COST_RATE = "agent.monitor.usage.costRatePerMin";
const COST_RATE_TOLERANCE = 1e-9;

type Flat = Map<string, unknown>;

function flatten(value: unknown, path: string, into: Flat): Flat {
  if (Array.isArray(value)) {
    into.set(`${path}.length`, value.length);
    value.forEach((item, index) => {
      flatten(item, `${path}[${index}]`, into);
    });
    return into;
  }
  if (typeof value === "object" && value !== null) {
    for (const [key, nested] of Object.entries(value)) {
      flatten(nested, path === "" ? key : `${path}.${key}`, into);
    }
    return into;
  }
  into.set(path, value);
  return into;
}

/** `a.b[0].c` → `a.b.c`: the tally groups by field, not by position. */
const fieldOf = (path: string): string => path.replace(/\[\d+\]/g, "");

interface Mismatch {
  field: string;
  count: number;
  example: { seq: number; key: string; path: string; oracle: unknown; replica: unknown };
}

class Tally {
  readonly mismatches = new Map<string, Mismatch>();
  compared = 0;
  rows = 0;
  /** M38 — oracle rows of the one shape the two paths decide differently (see `isM38Shape`) */
  m38Rows = 0;
  /** M38 — those of them the replica hides, accepted by name */
  m38Hidden = 0;
  missing: { seq: number; key: string }[] = [];
  extra: { seq: number; key: string }[] = [];

  note(seq: number, key: string, path: string, oracle: unknown, replica: unknown): void {
    const field = fieldOf(path);
    const held = this.mismatches.get(field);
    if (held !== undefined) {
      held.count += 1;
      return;
    }
    this.mismatches.set(field, {
      field,
      count: 1,
      example: { seq, key, path, oracle, replica },
    });
  }

  compare(seq: number, key: string, oracle: MonitorAgentViewReads, replica: MonitorAgentViewReads) {
    this.rows += 1;
    const left = flatten(oracle, "", new Map());
    const right = flatten(replica, "", new Map());
    for (const path of new Set([...left.keys(), ...right.keys()])) {
      if (IDENTITY.has(fieldOf(path))) continue;
      const a = left.get(path);
      const b = right.get(path);
      if (Object.is(a, b)) continue;
      if (
        fieldOf(path) === COST_RATE &&
        typeof a === "number" &&
        typeof b === "number" &&
        Math.abs(a - b) <= COST_RATE_TOLERANCE
      ) {
        continue;
      }
      this.compared += 1;
      this.note(seq, key, path, a, b);
    }
  }

  report(accepted: Record<string, string> = ACCEPTED): string {
    const lines = [
      `rows compared ${this.rows} · missing ${this.missing.length} · extra ${this.extra.length}`,
      `  M38 rows (no mirror, no PTY, not exited) in the oracle: ${this.m38Rows} · hidden by the one liveness rule: ${this.m38Hidden}`,
    ];
    for (const entry of [...this.mismatches.values()].sort((x, y) => y.count - x.count)) {
      const { seq, key, path, oracle, replica } = entry.example;
      lines.push(
        `  ${entry.field} ×${entry.count}${entry.field in accepted ? " (accepted)" : ""} — e.g. seq ${seq} ${key} ${path}: oracle ${JSON.stringify(oracle)} · replica ${JSON.stringify(replica)}`,
      );
    }
    for (const item of this.missing.slice(0, 5))
      lines.push(`  missing seq ${item.seq} ${item.key}`);
    for (const item of this.extra.slice(0, 5)) lines.push(`  extra seq ${item.seq} ${item.key}`);
    return lines.join("\n");
  }
}

/**
 * M38 — the one row shape the two paths decide differently: a managed run with
 * NO mirror (the runtime never spoke) and NO PTY, not exited. The seam drew it as
 * a "starting" body (its own copy of the drop rule dropped only `alive: false`
 * mirrors); fieldd's one liveness rule (ruled 2026-09-13, `hostRunFromSummary`)
 * says a run with neither is not alive, so the backend hides it. Such a row
 * missing from the replica is the accepted difference, counted, never a miss.
 */
function isM38Shape(agent: OracleAgent): boolean {
  return (
    agent.agent !== undefined &&
    agent.agent.monitor === undefined &&
    agent.session === undefined &&
    agent.floorSessionId === undefined
  );
}

/** What the oracle named a local row by: its run, or the floor session it stood for. */
function oracleKey(agent: OracleAgent): string {
  const run = agent.agent?.runtimeRunId;
  if (run !== undefined) return `run:${run}`;
  return `pty:${agent.session?.id ?? agent.floorSessionId ?? agent.id}`;
}

/** What the replica's row stands for: the board join's run, or its own id (a bare terminal's floor session). */
function replicaKey(row: ViewsMonitorAgent, runByRow: ReadonlyMap<string, string>): string {
  if (row.agent !== undefined) {
    const run = runByRow.get(row.id);
    return run === undefined ? `row:${row.id}` : `run:${run}`;
  }
  return `pty:${row.id}`;
}

const CHECKED_AT = "2026-10-03T12:00:00.000Z";
const noHistory: HistoryPort = {
  status: async () => ({ reachable: false, detail: "none", checkedAt: CHECKED_AT }),
  facts: async () => [],
  search: async () => ({
    status: { reachable: false, detail: "none", checkedAt: CHECKED_AT },
    answered: false,
    hits: [],
    clipped: false,
  }),
};
const noUsage: AccountUsagePort = {
  snapshot: async () => ({ refreshedAt: CHECKED_AT, entries: [] }),
  subscribe: () => () => undefined,
};

/** The floor as fieldd lists it for the corpus: the panes' sessions and the roster's PTYs. */
function floorOf(panes: MonitorPaneFacts): TerminalInfo[] {
  const listed = new Set((panes.sessions ?? []).map((session) => session.id));
  return [
    ...(panes.sessions ?? []).map((session) => terminalInfoOf(session)),
    ...(panes.floor ?? [])
      .filter((row) => !listed.has(row.sessionId))
      .map((row) =>
        terminalInfoOf(
          { id: row.sessionId, createdAtMs: 0, title: row.title } as never,
          row.workloadClass,
        ),
      ),
  ];
}

let latest: {
  agents: readonly ViewsMonitorAgent[];
  runByRow: ReadonlyMap<string, string>;
  /** a peer row's run, off the board row it rode in on */
  runOf: (id: string) => string | undefined;
} | null = null;

function Probe({
  door,
  panes,
}: {
  door: MonitorDoor;
  panes: MonitorPaneFacts;
}): ReactElement | null {
  const palette = useMonitorPalette();
  const feed = useMonitorFeed();
  const { agents, runByRow } = useMonitorAgents({ palette, door, panes });
  latest = { agents, runByRow, runOf: (id) => feed?.held(id)?.board.runtimeRunId };
  return null;
}

let root: Root | null = null;
let container: HTMLElement | null = null;
let board: ScriptedModelBoard | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  board?.dispose();
  board = null;
  latest = null;
  vi.useRealTimers();
});

/** The frame's publication lands on the next animation frame (happy-dom's is a
 * `setImmediate`, left real under the fake clock); let it. */
async function frame(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setImmediate(resolve));
  });
}

/** What a peer is named by on both sides: its run on its own desktop. */
function peerKey(run: string | undefined, fallback: string): string {
  return `peer:${run ?? fallback}`;
}

async function replay(
  oracle: Oracle,
  corpus: Corpus,
  ticks: readonly CorpusTick[],
): Promise<{ tally: Tally; peers: Tally }> {
  vi.useFakeTimers({
    toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"],
  });
  const base = corpus.meta.recipe.baseWall;
  vi.setSystemTime(base);

  const panes: MonitorPaneFacts = {
    sessionIds: corpus.panes.sessionIds,
    ...(corpus.panes.activeSessionId !== undefined
      ? { activeSessionId: corpus.panes.activeSessionId }
      : {}),
    sessions: corpus.panes.sessions,
    floor: corpus.panes.floor,
  };
  const here = corpus.roster.find((device) => device.deviceId === corpus.meta.here);
  const first = corpus.frames.find((entry) => entry.kind === "fold");
  if (first === undefined || first.kind !== "fold")
    throw new Error("a corpus starts with a fold frame");
  let foldListener: ((rows: readonly AgentSessionSummary[]) => void) | null = null;
  board = scriptedModelBoard({
    rows: first.rows,
    terminals: floorOf(panes),
    device: {
      id: corpus.meta.here,
      ...(here?.name !== undefined ? { name: here.name } : {}),
      ...(here?.platform !== undefined ? { platform: here.platform } : {}),
    },
  });
  const held = board;
  const door: MonitorDoor = {
    model: held.port,
    // the mesh board's own port is unread by the window (MV-3b): peers ride the model port
    observeMesh: () => () => undefined,
    devices: {
      subscribe: (deliver) => {
        deliver(corpus.roster);
        return () => undefined;
      },
    },
    observe: ({ onFrame }) => {
      foldListener = onFrame;
      onFrame(first.rows);
      return () => {
        foldListener = null;
      };
    },
    attach: async () => ({ state: "no-pane" }),
    createTerminal: async () => ({ state: "no-pane" }),
    mountLocal: async () => ({ state: "no-pane" }),
    history: noHistory,
    usage: noUsage,
  };

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
  await frame();

  // M39 — the peer's own fold rows at each tick, and its desktop as the roster names it
  const peerRowsAt = new Map<number, readonly AgentSessionSummary[]>();
  for (const tick of ticks) if (tick.peer !== undefined) peerRowsAt.set(tick.tMs, tick.peer);
  const peerDevice = corpus.roster.find((device) => device.deviceId === corpus.meta.peer);
  let peerPlaced = false;
  const peerBoardAt = async (tMs: number): Promise<void> => {
    const rows = peerRowsAt.get(tMs);
    if (rows === undefined) throw new Error(`the corpus's peer has no rows at ${tMs} ms`);
    await act(async () => {
      // fieldd's mesh board places a desktop by its STATE first (`#setState`),
      // then relays its board: the window's standing for it comes from that
      // frame (a peer with no standing draws greyed, the pre-MV seam's rule)
      if (!peerPlaced) {
        peerPlaced = true;
        held.push({
          device: corpus.meta.peer,
          state: "live",
          asOf: new Date(Date.now()).toISOString(),
        });
      }
      held.peer({
        device: corpus.meta.peer,
        ...(peerDevice?.name !== undefined ? { name: peerDevice.name } : {}),
        ...(peerDevice?.platform !== undefined ? { platform: peerDevice.platform } : {}),
        state: "live",
        rows,
      });
    });
  };

  const tally = new Tally();
  const peers = new Tally();
  for (let index = 0; index < corpus.frames.length; index += 1) {
    const entry = corpus.frames[index] as RecordedFrame;
    const next = corpus.frames[index + 1];
    vi.setSystemTime(base + entry.t);
    if (entry.kind === "fold") {
      await act(async () => {
        foldListener?.(entry.rows);
        held.publish(entry.rows);
      });
    }
    // where the oracle's mesh moved, the peer's own board moves (M39)
    if (entry.kind === "mesh-open") await peerBoardAt(entry.t);
    if (entry.kind === "mesh-frame" && entry.frame.device === corpus.meta.peer) {
      await peerBoardAt(entry.t);
    }
    await frame();
    // the gap to the next frame passes on the fake clock, so the backend's
    // clocks (the 10 s now, the 30 s step) fire where the seam's did
    if (next !== undefined && next.t > entry.t) {
      await act(async () => {
        vi.advanceTimersByTime(next.t - entry.t);
      });
      await frame();
    }
    const expected = oracle.frames.get(entry.seq);
    if (expected === undefined) continue;
    const got = latest;
    if (got === null) throw new Error("the probe never rendered");
    const replicaRows = new Map<string, ViewsMonitorAgent>();
    const replicaPeers = new Map<string, ViewsMonitorAgent>();
    for (const row of got.agents) {
      if (row.remote !== undefined) {
        replicaPeers.set(peerKey(got.runOf(row.id), row.id), row);
        continue;
      }
      replicaRows.set(replicaKey(row, got.runByRow), row);
    }
    const seen = new Set<string>();
    const seenPeers = new Set<string>();
    for (const agent of expected.agents) {
      if (agent.remote !== undefined) {
        const key = peerKey(agent.agent?.runtimeRunId, agent.id);
        seenPeers.add(key);
        const row = replicaPeers.get(key);
        if (row === undefined) peers.missing.push({ seq: entry.seq, key });
        else peers.compare(entry.seq, key, viewReadProjection(agent), viewReadProjection(row));
        continue;
      }
      const key = oracleKey(agent);
      seen.add(key);
      const row = replicaRows.get(key);
      const m38 = isM38Shape(agent);
      if (m38) tally.m38Rows += 1;
      if (row === undefined) {
        if (m38) tally.m38Hidden += 1;
        else tally.missing.push({ seq: entry.seq, key });
        continue;
      }
      tally.compare(entry.seq, key, viewReadProjection(agent), viewReadProjection(row));
    }
    for (const key of replicaRows.keys()) {
      if (!seen.has(key)) tally.extra.push({ seq: entry.seq, key });
    }
    for (const key of replicaPeers.keys()) {
      if (!seenPeers.has(key)) peers.extra.push({ seq: entry.seq, key });
    }
  }
  return { tally, peers };
}

const oracleFiles = existsSync(ORACLE_DIR)
  ? readdirSync(ORACLE_DIR)
      .filter((name) => name.endsWith(".jsonl.gz") && !name.includes("-seeded"))
      .sort()
  : [];

describe.skipIf(oracleFiles.length === 0)(
  `the differential against mv0-vf's oracle (${ORACLE_DIR}${oracleFiles.length === 0 ? " — absent on this machine, skipped" : ""})`,
  () => {
    for (const name of oracleFiles) {
      it(`${name}: every row the views read, frame by frame`, async () => {
        const oracle = readOracle(join(ORACLE_DIR, name));
        expect(oracle.meta.seededCache).toBe(false);
        const lived: CorpusTick[] = [];
        const corpus = generateCorpus(oracle.meta.recipe, (tick) => lived.push(tick));
        // through JSON once the corpus is complete, as the B arm's stream reads them
        const ticks = JSON.parse(JSON.stringify(lived)) as CorpusTick[];
        const { tally, peers } = await replay(oracle, corpus, ticks);
        const report = tally.report();
        const peerReport = peers.report(PEER_ACCEPTED);
        console.log(`[differential] ${name}\n${report}\n[peers] ${name}\n${peerReport}`);
        const unexplained = [...tally.mismatches.keys()].filter((field) => !(field in ACCEPTED));
        expect(unexplained, report).toEqual([]);
        expect(tally.missing, report).toEqual([]);
        expect(tally.extra, report).toEqual([]);
        expect(tally.rows).toBeGreaterThan(0);
        // M39 — the peers: the same membership, the same visible facts but the named ones
        const peersUnexplained = [...peers.mismatches.keys()].filter(
          (field) => !(field in PEER_ACCEPTED),
        );
        expect(peersUnexplained, peerReport).toEqual([]);
        expect(peers.missing, peerReport).toEqual([]);
        expect(peers.extra, peerReport).toEqual([]);
        expect(peers.rows).toBeGreaterThan(0);
      }, 600_000);
    }
  },
);
