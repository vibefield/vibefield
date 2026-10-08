import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { loadavg, tmpdir } from "node:os";
import { join } from "node:path";
import {
  AGENT_SESSION_RECORD_FORMAT,
  AgentDeskRow,
  AgentDeskTerminalRow,
  AgentFieldSnapshot,
  AgentModelDeskRow,
  AgentModelMeshOpen,
  AgentModelSnapshot,
  type AgentSessionRecord,
  LAYOUT,
  SOCKETS,
} from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { bootstrap, type FielddDaemon, SessionRecordStore } from "../src/index";
import { MockMgmtServer } from "../src/testing/mock-mgmt";
import { writeLinkFixture } from "./link-fixture";
import { nativeEndpoint } from "./native-harness";
import { helloAs, WsRpc } from "./ws-rpc";

// MV-3a (MV-D18, L5, L8) — the model board as the DAEMON serves it, and the
// report of what a window shows. The fold is made non-empty the way
// `agent-field-daemon.test.ts` does it: a signed record stamped with an exit
// whose PTY the (mocked) floor still lists. That one PTY is the witness for
// two things at once — the exited run's row (alive: false, claiming no PTY) and
// the same PTY as a bare TERMINAL row of the model's own kind, which only this
// desktop's windows receive.

const PANE = "pane-1";
const RUN = "run-daemon-1";

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) {
    try {
      await fn();
    } catch {
      /* an already-stopped daemon is fine */
    }
  }
  cleanup = [];
});

const ENDPOINTS = {
  controlSocket: "/mock/native/run/termctl.sock",
  frameSocket: "/mock/native/run/termframe.sock",
  authToken: "mock-per-boot-token",
};

function writeExitedRecord(dataDir: string): void {
  const at = "2026-09-13T12:00:00.000Z";
  const record: AgentSessionRecord = {
    format: AGENT_SESSION_RECORD_FORMAT,
    runtimeRunId: RUN,
    runtimeEpoch: 1,
    provider: "scripted",
    cwd: "/repo",
    title: "held open",
    terminalSessionId: PANE,
    continuation: {
      providerId: "scripted",
      nativeSessionId: "native-1",
      implementation: "native",
    },
    createdAt: at,
    updatedAt: at,
    exited: { at, exitCode: 0, signal: null, reason: "completed" },
  };
  new SessionRecordStore({
    dir: join(dataDir, ...LAYOUT.AGENT_SESSIONS_DIR),
    keyPath: join(dataDir, ...LAYOUT.AGENT_SESSIONS_KEY_FILE),
    now: () => new Date(at),
  }).write(record);
}

async function boot(): Promise<{ daemon: FielddDaemon; mock: MockMgmtServer }> {
  const dataDir = mkdtempSync(join(tmpdir(), "vf-model-"));
  cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
  mkdirSync(join(dataDir, "native", "run"), { recursive: true });
  writeFileSync(join(dataDir, "native", "pairing"), "ab".repeat(32));
  writeLinkFixture(dataDir);
  writeExitedRecord(dataDir);
  const mock = new MockMgmtServer(nativeEndpoint(dataDir, SOCKETS.MGMT));
  await mock.start();
  cleanup.push(() => mock.stop());
  mock.helloTerminal = ENDPOINTS;
  mock.helloTerminalMesh = true;
  mock.observedState = {
    generation: 0,
    bootId: "mock-boot",
    terminals: [
      {
        sessionId: PANE,
        pid: 42,
        createdAt: Date.parse("2026-09-13T11:59:00.000Z"),
        cwd: "/repo",
        cell: { cellInstanceId: 1, cellBootId: "cell-a", workloadClass: "agent" },
      },
    ],
    workers: [],
  };
  const daemon = await bootstrap({ dataDir, controlPort: 0, dataPort: 0 });
  cleanup.push(() => daemon.stop());
  return { daemon, mock };
}

async function poll<T>(fn: () => T | undefined, ms = 5_000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = fn();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`poll timed out after ${ms}ms`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function window(daemon: FielddDaemon): Promise<WsRpc> {
  const ws = new WebSocket(`ws://127.0.0.1:${daemon.controlPort}`);
  cleanup.push(() => ws.close());
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  const rpc = new WsRpc(ws);
  await helloAs(rpc, daemon.tokens.mint(["agent.observe"], "mv3a").token);
  return rpc;
}

describe("MV-3a — the model board through the door, and the report of what a window shows", () => {
  it("answers a window the model's rows: the exited run's row and its PTY as a terminal row; the report clears through the board's screen", async () => {
    const { daemon, mock } = await boot();
    await poll(() =>
      daemon.agents.list().sessions.some((row) => row.runtimeRunId === RUN) ? true : undefined,
    );
    const rpc = await window(daemon);
    // a report before the board is open is refused: the board IS the screen
    await expect(rpc.call("agent.reportShown", { ids: [PANE] })).rejects.toBeDefined();
    const sub = (await rpc.call("agent.subscribe", { projection: "model" })) as {
      subId: string;
      snapshot: unknown;
    };
    const snapshot = AgentModelSnapshot.parse(sub.snapshot);
    expect(snapshot.epoch).toBeDefined();
    // the backend's first tick may land a beat after the open; the rows carry
    // the model once it has
    const rows = await poll(() => {
      const held = new Map(snapshot.rows.map((row) => [row.runtimeRunId, row]));
      for (const note of rpc.notifications) {
        if (!note.method.endsWith(".delta")) continue;
        const payload = note.params.payload as {
          upserts?: Array<{ runtimeRunId: string }>;
          removed?: string[];
        };
        for (const row of payload.upserts ?? []) held.set(row.runtimeRunId, row as never);
        for (const id of payload.removed ?? []) held.delete(id);
      }
      const run = held.get(RUN) as Record<string, unknown> | undefined;
      const pane = held.get(PANE);
      return run?.["monitorRow"] !== undefined && pane !== undefined ? { run, pane } : undefined;
    });
    const run = AgentDeskRow.parse(rows.run);
    expect(run).toMatchObject({ kind: "scripted", alive: false });
    expect(run.monitorRow).toMatchObject({
      id: RUN,
      kind: "agent",
      alive: false,
      attachable: false,
      provider: { id: "scripted" },
    });
    // MV-3d — the window's run row carries the chrome's facts beside the model:
    // the native session the record names, and the exit fieldd witnessed (no
    // mirror: nothing observed this run in this boot; no workspace, no directory)
    expect(AgentModelDeskRow.parse(rows.run).local).toEqual({
      nativeSessionId: "native-1",
      exited: true,
    });
    // …which no other board carries: not the desk cut a peer reads, nor the field row
    for (const projection of ["desk", "field"]) {
      const other = (await rpc.call("agent.subscribe", { projection })) as { snapshot: unknown };
      const otherRows = AgentFieldSnapshot.parse(other.snapshot).rows;
      expect(otherRows.some((row) => row.runtimeRunId === RUN)).toBe(true);
      for (const row of otherRows) expect("local" in row).toBe(false);
    }
    const pane = AgentDeskTerminalRow.parse(rows.pane);
    expect(pane).toMatchObject({
      runtimeRunId: PANE,
      kind: "terminal",
      terminal: {
        hosted: "local",
        runtimeSessionId: PANE,
        cellBootId: "cell-a",
        workloadClass: "agent",
      },
      monitorRow: { id: PANE, kind: "terminal", detail: "/repo", project: { name: "repo" } },
    });
    // with the board open, the connection's screen takes the report
    expect(await rpc.call("agent.reportShown", { ids: [PANE] })).toEqual({ reported: true });
    expect(await rpc.call("agent.reportShown", { ids: [] })).toEqual({ reported: true });
    // the mesh scope lists this desktop first, with the same rows
    const mesh = (await rpc.call("agent.subscribe", { projection: "model", scope: "mesh" })) as {
      snapshot: unknown;
    };
    const open = AgentModelMeshOpen.parse(mesh.snapshot);
    expect(open.devices[0]?.state).toBe("live");
    expect(open.devices[0]?.snapshot?.rows.map((row) => row.runtimeRunId).sort()).toEqual(
      [PANE, RUN].sort(),
    );
    // L12, the LIVE measurement: a floor change (a PTY born, then gone) to the
    // window's frame, through the mock floor's push, the backend's tick, the
    // model board's 16 ms floor and the socket. Recorded in the report; the
    // bound here is only a sanity ceiling on a loaded host.
    const latencies: number[] = [];
    for (let round = 0; round < 6; round += 1) {
      const sessionId = `pty-live-${round}`;
      const seen = (): boolean =>
        rpc.notifications.some((note) => {
          if (!note.method.endsWith(".delta")) return false;
          const payload = note.params.payload as { upserts?: Array<{ runtimeRunId: string }> };
          return (payload.upserts ?? []).some((row) => row.runtimeRunId === sessionId);
        });
      const started = performance.now();
      mock.pushObserved({
        generation: round + 1,
        bootId: "mock-boot",
        terminals: [
          {
            sessionId: PANE,
            pid: 42,
            createdAt: Date.parse("2026-09-13T11:59:00.000Z"),
            cwd: "/repo",
            cell: { cellInstanceId: 1, cellBootId: "cell-a", workloadClass: "agent" },
          },
          {
            sessionId,
            pid: 100 + round,
            createdAt: Date.now(),
            cwd: "/tmp",
            cell: { cellInstanceId: 1, cellBootId: "cell-a", workloadClass: "interactive" },
          },
        ],
        workers: [],
      });
      await poll(() => (seen() ? true : undefined));
      latencies.push(performance.now() - started);
    }
    latencies.sort((left, right) => left - right);
    const median = latencies[Math.floor(latencies.length / 2)] ?? Number.NaN;
    console.log(
      `MV-3a live cadence (floor change → window frame, ms): median ${median.toFixed(1)}, min ${latencies[0]?.toFixed(1)}, max ${latencies.at(-1)?.toFixed(1)}; load ${JSON.stringify(loadavg().map((value) => Math.round(value)))}`,
    );
    expect(median).toBeLessThan(2_000);
    // the board closes: the screen goes with it, and the report is refused again
    await rpc.call("system.unsubscribe", { subId: sub.subId });
    const second = await window(daemon);
    await expect(second.call("agent.reportShown", { ids: [PANE] })).rejects.toBeDefined();
  });
});
