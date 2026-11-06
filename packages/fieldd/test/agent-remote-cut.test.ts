import {
  AGENT_FIELD,
  AgentDeskTerminalRow,
  AgentModelMeshFrame,
  AgentRemoteDelta,
  AgentRemoteRow,
  AgentRemoteSnapshot,
  type AgentSessionSummary,
  MonitorAgentRow,
} from "@vibefield/contracts";
import type { AgentMonitorState } from "@vibefield/puppeteer-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  boardFloor,
  peerMonitorRow,
  projectRemoteRow,
  remoteUrgentMs,
  routedBoardAsk,
} from "../src/agent-field";
import { createRemoteSubscription } from "../src/agent-model-board";
import { managedSummary as summary } from "./agent-field-summary";
import { floorTerminal, stateOf, testMonitor } from "./agent-monitor-fixture";

// PG-2 (PG-L1, PG-D1 (a), PG-D2 (a), PG-D5 (a), PG-D8 (a);
// `thinking-phone-godview.md` §4) — THE REMOTE CUT, as its owner cuts it: the
// model's row for every other screen (a peer's windows and the phone) and the
// joins a screen elsewhere acts by, never the field half beside it; a bare
// terminal's directory by its folder; the doors' gate on every promise; and the
// floors by the caller's kind, the phone's 1 s with its urgent edge at 250 ms.
// EL9: every frame is parsed with the contracts' schemas, as the phone's door
// and a peer window's door read it.

const working = summary({
  runtimeRunId: "run-working",
  status: "working",
  cumulativeTokens: 900,
  lastAssistantText: "x".repeat(AGENT_FIELD.DESK_TEXT_CHARS + 50),
  git: { branch: "ds/c" },
});
const blocked = summary({ runtimeRunId: "run-blocked", status: "blocked", permissionTool: "Bash" });

/** The field half's keys: none of them rides a remote row (§3 item 2). */
const FIELD_HALF = ["kind", "label", "tier", "status", "blockers", "usage", "lastAssistantMessage"];

afterEach(() => {
  vi.useRealTimers();
});

describe("PG-2 — the remote cut, as its owner cuts it", () => {
  it("every assembled run is the model's row for a peer and its joins; every bare terminal its window row, its directory by its folder", async () => {
    const monitor = await testMonitor({
      summaries: [working, blocked],
      terminals: [floorTerminal(), floorTerminal({ sessionId: "run-working-pty", cwd: "/repo" })],
    });
    monitor.rows();
    const board = createRemoteSubscription({
      fold: monitor.fold,
      monitor: monitor.service,
      emit: () => undefined,
      epoch: "boot.r1",
    });
    const snapshot = AgentRemoteSnapshot.parse(board.snapshot);
    expect(snapshot.epoch).toBe("boot.r1");
    expect(snapshot.rows.map((row) => row.runtimeRunId)).toEqual([
      "run-working",
      "run-blocked",
      "pty-bare",
    ]);
    const [run, , bare] = snapshot.rows;
    // the model's row as a peer reads it: no colour sequence (M16), texts bounded (M21)
    expect(run).toMatchObject({
      device: "this-device",
      terminal: { hosted: "local" },
      nativeSessionId: "run-working-native",
      monitorRow: { id: "run-working-pty", kind: "agent", project: { name: "repo" } },
    });
    expect(run?.monitorRow.project.seq).toBeUndefined();
    expect(run?.monitorRow.reply?.text.length).toBe(AGENT_FIELD.DESK_TEXT_CHARS);
    for (const key of [...FIELD_HALF, "local"]) expect(run, key).not.toHaveProperty(key);
    // a bare terminal rides it too (PG-D5): the window's terminal row, cut for a peer
    expect(AgentDeskTerminalRow.parse(bare)).toMatchObject({
      runtimeRunId: "pty-bare",
      kind: "terminal",
      terminal: { hosted: "local", runtimeSessionId: "pty-bare", workloadClass: "interactive" },
      monitorRow: { id: "pty-bare", kind: "terminal", detail: "notes", project: { name: "notes" } },
    });
    // EL7 B1 — no path leaves the owner: the backend's terminal detail was "/Users/me/notes"
    expect(JSON.stringify(snapshot)).not.toContain("/Users/");
    // the phone's door and a peer window's door read the same rows
    for (const row of snapshot.rows) MonitorAgentRow.parse(row.monitorRow);
    expect(
      AgentModelMeshFrame.safeParse({ device: "this-device", snapshot: board.snapshot }).success,
    ).toBe(true);
    board.dispose();
    monitor.service.dispose();
  });

  it("a peer's cut of a terminal names its folder; a terminal with no directory keeps the backend's word", async () => {
    const monitor = await testMonitor({
      terminals: [floorTerminal(), floorTerminal({ sessionId: "pty-nowhere", cwd: "" })],
    });
    const rows = monitor.rows();
    const notes = rows.find((row) => row.id === "pty-bare");
    const nowhere = rows.find((row) => row.id === "pty-nowhere");
    if (notes === undefined || nowhere === undefined) throw new Error("both terminals are rows");
    expect(notes.detail).toBe("/Users/me/notes");
    expect(peerMonitorRow(notes).detail).toBe("notes");
    expect(peerMonitorRow(nowhere).detail).toBe(nowhere.detail);
    expect(peerMonitorRow(nowhere).detail).not.toContain("/");
    monitor.service.dispose();
  });

  it("a run the backend has not assembled has no remote row; it joins the board once it has one", async () => {
    vi.useFakeTimers();
    const monitor = await testMonitor({ summaries: [working] });
    const frames: unknown[] = [];
    // before the backend's first tick there is no model row, so no remote row
    const board = createRemoteSubscription({
      fold: monitor.fold,
      monitor: monitor.service,
      emit: (frame) => frames.push(frame),
      epoch: "boot.r2",
    });
    expect(board.snapshot.rows).toEqual([]);
    monitor.scheduler.flush();
    vi.advanceTimersByTime(AGENT_FIELD.REMOTE_MIN_INTERVAL_MS);
    const delta = AgentRemoteDelta.parse(frames.at(-1));
    expect(delta.upserts.map((row) => row.runtimeRunId)).toEqual(["run-working"]);
    board.dispose();
    monitor.service.dispose();
  });

  it("ST-D5 — a held Stop rides the remote row; the chrome's facts never do", async () => {
    const stopped: AgentSessionSummary = {
      ...working,
      stopKey: "escape",
      spawnedBy: "user-shell",
      stop: { sentAt: "2026-09-13T10:06:00.000Z", stage: "heard", heardBy: "status" },
    };
    const monitor = await testMonitor({ summaries: [stopped] });
    const row = AgentRemoteRow.parse({
      ...projectRemoteRow(stopped, monitor.row("run-working")),
      revision: 1,
    });
    expect(row.stop).toEqual({
      sentAt: "2026-09-13T10:06:00.000Z",
      stage: "heard",
      heardBy: "status",
    });
    expect(row).not.toHaveProperty("local");
    for (const fact of ["stopKey", "user-shell", "/repo"])
      expect(JSON.stringify(row), fact).not.toContain(fact);
    monitor.service.dispose();
  });

  it("SP-1e2 — a spark's agent's crew rides the remote row's origin, so the phone's card finds its live members", async () => {
    const crewed: AgentSessionSummary = {
      ...working,
      origin: { by: "spark", spark: "sp-7k2m9q4x", crew: "cr-3n8w5t1v" },
    };
    const monitor = await testMonitor({ summaries: [crewed] });
    const row = AgentRemoteRow.parse({
      ...projectRemoteRow(crewed, monitor.row("run-working")),
      revision: 1,
    });
    expect(row.origin).toEqual({ by: "spark", spark: "sp-7k2m9q4x", crew: "cr-3n8w5t1v" });
    monitor.service.dispose();
  });

  it("F-M4 — an owner whose doors are down withholds every join and attach promise, a bare terminal's too; a gate flip re-presents the board as ONE snapshot at its revision", async () => {
    const monitor = await testMonitor({ summaries: [working], terminals: [floorTerminal()] });
    monitor.rows();
    const frames: Array<{ frame: unknown; kind: string }> = [];
    let published = true;
    const board = createRemoteSubscription({
      fold: monitor.fold,
      monitor: monitor.service,
      emit: (frame, kind) => frames.push({ frame, kind }),
      epoch: "boot.r3",
      terminalPublished: () => published,
    });
    const open = AgentRemoteSnapshot.parse(board.snapshot);
    for (const row of open.rows) {
      expect(row.terminal, row.runtimeRunId).toBeDefined();
      expect(row.monitorRow, row.runtimeRunId).toMatchObject({ attachable: true, writable: true });
    }
    published = false;
    board.represent();
    await new Promise((resolve) => setTimeout(resolve, AGENT_FIELD.REMOTE_MIN_INTERVAL_MS + 50));
    expect(frames).toHaveLength(1);
    expect(frames[0]?.kind).toBe("snapshot");
    const held = AgentRemoteSnapshot.parse(frames[0]?.frame);
    expect(held).toMatchObject({ epoch: "boot.r3", revision: open.revision });
    expect(held.rows.map((row) => row.runtimeRunId)).toEqual(["run-working", "pty-bare"]);
    for (const row of held.rows) {
      expect(row.terminal, row.runtimeRunId).toBeUndefined();
      expect(row.monitorRow, row.runtimeRunId).toMatchObject({
        attachable: false,
        writable: false,
      });
    }
    // nothing else of the model's row moves
    expect({ ...held.rows[0]?.monitorRow, attachable: true, writable: true }).toEqual(
      open.rows[0]?.monitorRow,
    );
    board.dispose();
    monitor.service.dispose();
  });

  it("vf-feed-2 — an app run the runtime removed leaves its pane listed exited, and the cut carries no row for it: no keyboard on a dead PTY", async () => {
    const live = summary({ runtimeRunId: "run-ended", status: "idle" });
    const pane = floorTerminal({ sessionId: "run-ended-pty", cwd: "/repo" });
    const monitor = await testMonitor({ summaries: [live], terminals: [pane, floorTerminal()] });
    monitor.rows();
    // the agent quits: MF-1g keeps its pane and the floor lists it exited (item 97), the
    // fold keeps the exited row (MF-1f), and puppeteer removes the run (`removeRunMonitor`)
    monitor.terminals.observe([{ ...pane, exited: true }, floorTerminal()]);
    monitor.fold.publish([summary({ runtimeRunId: "run-ended", status: "idle", exited: true })]);
    monitor.runtime.remove("run-ended", stateOf(live).runtimeEpoch);
    monitor.rows();
    const board = createRemoteSubscription({
      fold: monitor.fold,
      monitor: monitor.service,
      emit: () => undefined,
      epoch: "boot.husk",
    });
    const snapshot = AgentRemoteSnapshot.parse(board.snapshot);
    // the husk is no row a peer or the phone could attach to and type into; the live
    // shell beside it still rides the cut, attachable and writable
    expect(snapshot.rows.map((row) => row.runtimeRunId)).toEqual(["pty-bare"]);
    expect(snapshot.rows[0]?.monitorRow).toMatchObject({
      kind: "terminal",
      attachable: true,
      writable: true,
    });
    board.dispose();
    monitor.service.dispose();
  });
});

describe("PG-2 — the remote board's floors and its urgent edge (PG-D8 (a))", () => {
  const flip = (monitor: Awaited<ReturnType<typeof testMonitor>>, bump: number, status: string) => {
    const base = stateOf(working);
    monitor.runtime.push({
      ...base,
      revision: base.revision + bump,
      status,
      statusSince: `2026-09-13T10:0${6 + bump}:00.000Z`,
    } as AgentMonitorState);
  };
  const usage = (monitor: Awaited<ReturnType<typeof testMonitor>>, bump: number) => {
    const base = stateOf(working);
    monitor.runtime.push({
      ...base,
      revision: base.revision + bump,
      usage: { ...base.usage, cumulativeTokens: 1_000 + bump },
    } as AgentMonitorState);
    monitor.scheduler.flush();
  };

  it("the phone's board: an ordinary change waits the 1 s floor; an urgent one leaves at the 250 ms edge", async () => {
    vi.useFakeTimers();
    const monitor = await testMonitor({ summaries: [working] });
    monitor.rows();
    const at: number[] = [];
    const floor = boardFloor("tailnet", { projection: "remote" });
    expect(floor).toBe(AGENT_FIELD.REMOTE_PHONE_MIN_INTERVAL_MS);
    expect(remoteUrgentMs(floor)).toBe(AGENT_FIELD.REMOTE_URGENT_MS);
    const board = createRemoteSubscription({
      fold: monitor.fold,
      monitor: monitor.service,
      emit: (frame) => {
        AgentRemoteDelta.parse(frame);
        at.push(Date.now());
      },
      epoch: "boot.phone",
      minIntervalMs: floor,
    });
    const t0 = Date.now();
    // a usage sample is not urgent: the trailing edge, a whole floor
    vi.advanceTimersByTime(300);
    usage(monitor, 1);
    vi.advanceTimersByTime(floor - 1);
    expect(at).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(at).toEqual([t0 + 300 + floor]);
    // a status flip right behind that frame is urgent: it waits only to the edge
    flip(monitor, 2, "idle");
    vi.advanceTimersByTime(AGENT_FIELD.REMOTE_URGENT_MS - 1);
    expect(at).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(at).toEqual([t0 + 300 + floor, t0 + 300 + floor + AGENT_FIELD.REMOTE_URGENT_MS]);
    // with the edge already passed, an urgent change goes out at once
    vi.advanceTimersByTime(AGENT_FIELD.REMOTE_URGENT_MS);
    flip(monitor, 3, "working");
    expect(at).toHaveLength(3);
    board.dispose();
    monitor.service.dispose();
  });

  it("a peer daemon's board at the local scope: the peer window's 100 ms floor is its own urgent edge (L12)", async () => {
    vi.useFakeTimers();
    const monitor = await testMonitor({ summaries: [working] });
    monitor.rows();
    const at: number[] = [];
    const floor = boardFloor("peer-fieldd", { projection: "remote" });
    expect(floor).toBe(AGENT_FIELD.REMOTE_MIN_INTERVAL_MS);
    expect(remoteUrgentMs(floor)).toBe(floor);
    const board = createRemoteSubscription({
      fold: monitor.fold,
      monitor: monitor.service,
      emit: () => at.push(Date.now()),
      epoch: "boot.peer",
      minIntervalMs: floor,
    });
    vi.advanceTimersByTime(floor);
    // the floor has passed since the open: an urgent flip goes out NOW
    flip(monitor, 1, "idle");
    expect(at).toHaveLength(1);
    // a second inside the same floor waits the window out — one frame per floor
    flip(monitor, 2, "working");
    expect(at).toHaveLength(1);
    vi.advanceTimersByTime(floor);
    expect(at).toHaveLength(2);
    board.dispose();
    monitor.service.dispose();
  });
});

// S2 and PG-2 — a routed board ask is judged and paced for its CALLER at its
// home, because the owner sees only the home's `peer-fieldd` principal.
describe("PG-2 — a routed remote ask carries its caller's floor (routedBoardAsk)", () => {
  it("a phone's routed remote carries the phone's 1 s however it asked; a window's carries its own floor", () => {
    expect(routedBoardAsk("tailnet", { device: "dev-b", projection: "remote" })).toEqual({
      device: "dev-b",
      projection: "remote",
      minIntervalMs: AGENT_FIELD.REMOTE_PHONE_MIN_INTERVAL_MS,
    });
    expect(
      routedBoardAsk("tailnet", { device: "dev-b", projection: "remote", minIntervalMs: 100 }),
    ).toMatchObject({ minIntervalMs: AGENT_FIELD.REMOTE_PHONE_MIN_INTERVAL_MS });
    expect(
      routedBoardAsk("tailnet", { device: "dev-b", projection: "remote", minIntervalMs: 5_000 }),
    ).toMatchObject({ minIntervalMs: 5_000 });
    expect(routedBoardAsk("local-token", { device: "dev-b", projection: "remote" })).toEqual({
      device: "dev-b",
      projection: "remote",
      minIntervalMs: AGENT_FIELD.REMOTE_MIN_INTERVAL_MS,
    });
  });

  it("every other ask is carried whole, and a refusal is the caller's: the phone's model, anyone's desk", () => {
    const field = { device: "dev-b", projection: "field" };
    expect(routedBoardAsk("tailnet", field)).toBe(field);
    const refusal = (principal: "tailnet" | "local-token", params: unknown) => {
      try {
        routedBoardAsk(principal, params);
        return undefined;
      } catch (error) {
        return (error as { kind?: string }).kind;
      }
    };
    expect(refusal("tailnet", { device: "dev-b", projection: "model" })).toBe("FORBIDDEN_SCOPE");
    expect(refusal("tailnet", { device: "dev-b", projection: "desk" })).toBe("PRECONDITION_FAILED");
    expect(refusal("local-token", { device: "dev-b", projection: "desk" })).toBe(
      "PRECONDITION_FAILED",
    );
  });
});
