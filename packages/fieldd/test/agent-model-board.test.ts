import type { AgentMonitorState } from "@vibecook/puppeteer-core";
import {
  AGENT_FIELD,
  AgentDeskRow,
  AgentDeskTerminalRow,
  type AgentModelBoardRow,
  AgentModelDelta,
  AgentModelSnapshot,
  AgentSubscribeParams,
  MonitorAgentRow,
} from "@vibefield/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createFieldSubscription,
  deskProjector,
  peerMonitorRow,
  projectDeskRow,
  refuseBoardAsk,
  windowMonitorRow,
} from "../src/agent-field";
import { createModelSubscription } from "../src/agent-model-board";
import { upstreamFloor, upstreamProjection } from "../src/mesh-board";
import { managedSummary as summary } from "./agent-field-summary";
import { floorTerminal, stateOf, testMonitor } from "./agent-monitor-fixture";

// MV-3a — THE WIRE (MV-D18, L8, L12, M16, M21): the model's row rides the desk
// row; this desktop's own windows read the `model` board — every run's row
// whole, every bare terminal as a row of its own kind, at the fold's tick with
// urgent changes ahead of it; peers read the desk cut — no colour sequence,
// texts bounded — at the desk's floor; the phone reads neither. EL9: every
// frame here is parsed with the contracts' schemas, as the window's adapter
// parses it.

const working = summary({
  runtimeRunId: "run-working",
  status: "working",
  cumulativeTokens: 900,
  contextPercent: 41,
  lastAssistantText: "Keeping it greyed; wiring the filter now.",
  git: { branch: "ds/c" },
});
const blocked = summary({ runtimeRunId: "run-blocked", status: "blocked", permissionTool: "Bash" });

const ask = (projection: string, scope?: string) =>
  AgentSubscribeParams.parse({ projection, ...(scope !== undefined ? { scope } : {}) });

afterEach(() => {
  vi.useRealTimers();
});

describe("the model board — this desktop's windows' cut", () => {
  it("every run is a desk row carrying the model's row whole, every bare terminal a row of its own kind; the frames parse on both sides", async () => {
    const monitor = await testMonitor({
      summaries: [working, blocked],
      terminals: [floorTerminal(), floorTerminal({ sessionId: "run-working-pty", cwd: "/repo" })],
    });
    monitor.rows();
    const frames: unknown[] = [];
    const board = createModelSubscription({
      fold: monitor.fold,
      monitor: monitor.service,
      emit: (delta) => frames.push(delta),
      epoch: "boot.1",
    });
    const snapshot = AgentModelSnapshot.parse(board.snapshot);
    expect(snapshot.epoch).toBe("boot.1");
    expect(snapshot.rows.map((row) => `${row.kind}:${row.runtimeRunId}`)).toEqual([
      "claude:run-working",
      "claude:run-blocked",
      "terminal:pty-bare",
    ]);
    const run = AgentDeskRow.parse(snapshot.rows[0]);
    // the field half says what it always said; the model's row rides beside it, whole
    expect(run.status).toBe("working");
    expect(run.lastAssistantMessage?.text).toBe("Keeping it greyed; wiring the filter now.");
    expect(run.monitorRow).toMatchObject({
      id: "run-working",
      kind: "agent",
      status: "working",
      project: { name: "repo", branch: "ds/c", seq: 0 },
      reply: { text: "Keeping it greyed; wiring the filter now." },
      device: { id: "this-device", name: "Studio", os: "mac" },
    });
    expect(run.monitorRow !== undefined && "self" in run.monitorRow.device).toBe(false);
    // the terminal row: the model's id is the board key, the pane join is the floor session
    const terminal = AgentDeskTerminalRow.parse(snapshot.rows[2]);
    expect(terminal).toMatchObject({
      runtimeRunId: "pty-bare",
      kind: "terminal",
      device: "this-device",
      terminal: { hosted: "local", runtimeSessionId: "pty-bare", workloadClass: "interactive" },
      monitorRow: { id: "pty-bare", kind: "terminal", detail: "/Users/me/notes" },
    });
    for (const row of snapshot.rows)
      MonitorAgentRow.parse((row as { monitorRow: unknown }).monitorRow);
    board.dispose();
    monitor.service.dispose();
  });

  it("a run's model row that has not been assembled yet leaves the desk row without one; the next tick carries it", async () => {
    const monitor = await testMonitor({ summaries: [working] });
    // before the backend's first tick there is no model row
    const board = createModelSubscription({
      fold: monitor.fold,
      monitor: monitor.service,
      emit: () => undefined,
    });
    const first = AgentDeskRow.parse(board.snapshot.rows[0]);
    expect(first.monitorRow).toBeUndefined();
    board.dispose();
    monitor.service.dispose();
  });
});

describe("the two cuts of the model's row (M16, M21)", () => {
  it("a peer's cut drops the colour sequence and bounds every text at the desk's bound; the window's keeps both", async () => {
    const long = "x".repeat(AGENT_FIELD.DESK_TEXT_CHARS + 120);
    const monitor = await testMonitor({
      summaries: [summary({ runtimeRunId: "run-long", lastAssistantText: long })],
    });
    const row = monitor.row("run-long");
    // M21 — fieldd passes the backend no bound; the backend at pin 1afaff7 still
    // applies its own default (280, which mv1-fix lifts), so the window's cut is
    // proved as a pass-through of whatever the row carries
    const text = row.reply?.text ?? "";
    expect(text.length).toBeGreaterThan(40);
    const peer = peerMonitorRow(row, 40);
    expect(peer.project.seq).toBeUndefined();
    expect(peer.reply?.text.length).toBe(40);
    expect(peer.reply?.text.endsWith("…")).toBe(true);
    expect(peer.detail.length).toBeLessThanOrEqual(40);
    expect("self" in peer.device).toBe(false);
    // the default bound is the desk's
    expect(peerMonitorRow(row).reply?.text.length).toBeLessThanOrEqual(AGENT_FIELD.DESK_TEXT_CHARS);
    const window = windowMonitorRow(row);
    expect(window.project.seq).toBe(0);
    expect(window.reply?.text).toBe(text);
    // the desk projector joins the peer's cut onto the desk row
    const desk = AgentDeskRow.parse({
      ...deskProjector((id) => monitor.service.rowForRun(id))(monitor.fold.list().sessions[0]!),
      revision: 1,
    });
    expect(desk.monitorRow?.project.seq).toBeUndefined();
    expect(desk.monitorRow?.id).toBe("run-long");
    // and the window's projection the whole row
    const asWindow = projectDeskRow(monitor.fold.list().sessions[0]!, undefined, row, "window");
    expect(
      (asWindow as { monitorRow?: { project: { seq?: number } } }).monitorRow?.project.seq,
    ).toBe(0);
    MonitorAgentRow.parse(peer);
    MonitorAgentRow.parse(window);
    monitor.service.dispose();
  });

  it("the desk projector without a backend row carries none (an older daemon's shape)", () => {
    const row = deskProjector(() => undefined)(working);
    expect("monitorRow" in row).toBe(false);
  });
});

describe("who may ask the model board (MV-D18, M16, L8)", () => {
  it("is refused to a peer daemon and to a phone, like `full`; a window asks it at either scope", () => {
    expect(refuseBoardAsk("peer-fieldd", ask("model"))?.kind).toBe("FORBIDDEN_SCOPE");
    expect(refuseBoardAsk("tailnet", ask("model"))?.kind).toBe("FORBIDDEN_SCOPE");
    expect(refuseBoardAsk("peer-fieldd", ask("model", "mesh"))?.kind).toBe("FORBIDDEN_SCOPE");
    expect(refuseBoardAsk("local-token", ask("model"))).toBeNull();
    expect(refuseBoardAsk("local-token", ask("model", "mesh"))).toBeNull();
    // the heartbeat is still asked of one desktop's board only
    expect(
      refuseBoardAsk(
        "local-token",
        AgentSubscribeParams.parse({ projection: "model", scope: "mesh", heartbeatMs: 1000 }),
      )?.kind,
    ).toBe("PRECONDITION_FAILED");
  });

  it("a model hub asks its peers for their desk boards at the desk's floor", () => {
    expect(upstreamProjection("model")).toBe("desk");
    expect(upstreamProjection("desk")).toBe("desk");
    expect(upstreamProjection("field")).toBe("field");
    expect(upstreamFloor("model", AGENT_FIELD.FULL_TICK_MS)).toBe(AGENT_FIELD.DESK_MIN_INTERVAL_MS);
    expect(upstreamFloor("model", 250)).toBe(250);
    expect(upstreamFloor("desk", AGENT_FIELD.DESK_MIN_INTERVAL_MS)).toBe(
      AGENT_FIELD.DESK_MIN_INTERVAL_MS,
    );
  });
});

describe("cadence (L12): the window's own rows at the fold's tick, urgent changes ahead of it; peers at the desk floor", () => {
  it("a usage-only revision waits the 16 ms floor; a status flip with the floor elapsed goes out at once; inside the floor it waits the window out", async () => {
    vi.useFakeTimers();
    const monitor = await testMonitor({ summaries: [working] });
    monitor.rows();
    const frames: Array<{ at: number; delta: AgentModelDelta }> = [];
    const board = createModelSubscription({
      fold: monitor.fold,
      monitor: monitor.service,
      emit: (delta) => frames.push({ at: Date.now(), delta }),
      epoch: "boot.2",
    });
    expect(board.snapshot.revision).toBe(1);
    const base = stateOf(working);
    const t0 = Date.now();
    // the floor elapses after the open
    vi.advanceTimersByTime(AGENT_FIELD.FULL_TICK_MS + 4);
    // 1. a usage sample: not urgent — the trailing edge
    monitor.runtime.push({
      ...base,
      revision: base.revision + 1,
      usage: { ...base.usage, cumulativeTokens: 1_500 },
    } as AgentMonitorState);
    monitor.scheduler.flush();
    expect(frames).toHaveLength(0);
    vi.advanceTimersByTime(AGENT_FIELD.FULL_TICK_MS - 1);
    expect(frames).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(frames).toHaveLength(1);
    const first = AgentModelDelta.parse(frames[0]?.delta);
    expect(first.since).toBe(1);
    expect(first.upserts).toHaveLength(1);
    expect(
      (first.upserts[0] as { monitorRow: { tokens: { total: number } } }).monitorRow.tokens.total,
    ).toBe(1_500);
    // 2. the floor elapses; a status flip is urgent and goes out NOW, with no timer
    vi.advanceTimersByTime(AGENT_FIELD.FULL_TICK_MS);
    const before = frames.length;
    monitor.runtime.push({
      ...base,
      revision: base.revision + 2,
      status: "idle",
      statusSince: "2026-09-13T10:06:00.000Z",
    } as AgentMonitorState);
    expect(frames).toHaveLength(before + 1);
    const urgentUpsert = frames[before]?.delta.upserts[0] as
      | { monitorRow: { status: string } }
      | undefined;
    expect(urgentUpsert?.monitorRow.status).toBe("idle");
    // 3. a second urgent change inside the same floor waits the window out — one frame per floor
    monitor.runtime.push({
      ...base,
      revision: base.revision + 3,
      status: "working",
      statusSince: "2026-09-13T10:06:01.000Z",
    } as AgentMonitorState);
    expect(frames).toHaveLength(before + 1);
    vi.advanceTimersByTime(AGENT_FIELD.FULL_TICK_MS);
    expect(frames).toHaveLength(before + 2);
    // the chain is unbroken
    let revision = 1;
    for (const { delta } of frames) {
      expect(delta.since).toBe(revision);
      revision = delta.revision;
    }
    expect(frames.at(-1)?.at).toBeGreaterThan(t0);
    board.dispose();
    monitor.service.dispose();
  });

  it("the desk board (a peer's cut) keeps the desk's 100 ms floor, urgent or not", async () => {
    vi.useFakeTimers();
    const monitor = await testMonitor({ summaries: [working] });
    monitor.rows();
    const frames: unknown[] = [];
    const board = createFieldSubscription({
      list: () => monitor.fold.list(),
      subscribe: (fn) => {
        const offFold = monitor.fold.subscribe(fn);
        const offModel = monitor.service.subscribe(() => fn());
        return () => {
          offFold();
          offModel();
        };
      },
      emit: (delta) => frames.push(delta),
      project: deskProjector((id) => monitor.service.rowForRun(id)),
      minIntervalMs: AGENT_FIELD.DESK_MIN_INTERVAL_MS,
      epoch: "boot.3",
    });
    vi.advanceTimersByTime(AGENT_FIELD.DESK_MIN_INTERVAL_MS + 1);
    const base = stateOf(working);
    monitor.runtime.push({
      ...base,
      revision: base.revision + 1,
      status: "idle",
      statusSince: "2026-09-13T10:06:00.000Z",
    } as AgentMonitorState);
    // urgent at the backend, and still the desk floor on this subscriber: the
    // field subscription's signal says nothing of urgency
    expect(frames).toHaveLength(0);
    vi.advanceTimersByTime(AGENT_FIELD.DESK_MIN_INTERVAL_MS - 1);
    expect(frames).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(frames).toHaveLength(1);
    board.dispose();
    monitor.service.dispose();
  });
});

describe("EL9 — what the window's adapter parses is what fieldd sends", () => {
  it("a model delta with a terminal leaving and an agent's row changing parses as the contract says", async () => {
    const monitor = await testMonitor({
      summaries: [working],
      terminals: [floorTerminal()],
    });
    monitor.rows();
    const frames: AgentModelDelta[] = [];
    const board = createModelSubscription({
      fold: monitor.fold,
      monitor: monitor.service,
      emit: (delta) => frames.push(delta),
      epoch: "boot.4",
      minIntervalMs: 0,
    });
    monitor.terminals.observe([]);
    monitor.scheduler.flush();
    await new Promise((resolve) => setTimeout(resolve, 2));
    const delta = AgentModelDelta.parse(frames.at(-1));
    expect(delta.removed).toEqual(["pty-bare"]);
    const rows: AgentModelBoardRow[] = delta.upserts;
    expect(rows).toHaveLength(0);
    board.dispose();
    monitor.service.dispose();
  });
});
