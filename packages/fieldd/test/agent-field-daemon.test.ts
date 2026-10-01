import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AGENT_SESSION_RECORD_FORMAT,
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

// MF-1 (§10.2) — the agent field as the DAEMON serves it.
//
// This file used to witness the field's STORE publisher as the daemon wired it
// (`agent-field-publisher.test.ts` built the publisher by hand and so proved
// nothing about daemon.ts). DS-D14 (RULED `retire` 2026-09-30; built
// 2026-10-01, DS wave 3) retired that carrier: the mesh board (DS-3,
// `agent.subscribe {scope: "mesh"}`) answers every self desktop's board through
// one door, the desktop's Godview reads it, and the phone homes to a desktop and
// reads the same door (DS-8). What stands here now is the DOOR as the one
// carrier, and a mock-mgmt row that the daemon never writes `field.agents.v1`
// again — through the serve's edges, a fold change and a graceful stop.
//
// The fold is made non-empty WITHOUT a real floor, through MF-1f's own restart
// path: a signed record stamped with an exit, whose PTY the (mocked) floor
// still lists, is re-listed as an exited row by the first inventory. That
// keeps this file fast and leaves the real-floor witnesses where they belong.

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

const observed = (terminals: Array<Record<string, unknown>>) => ({
  generation: 0,
  bootId: "mock-boot",
  terminals,
  workers: [],
});

/** An exited managed run whose pane the floor still lists (MF-1f/MF-1g). The
 * record is written through the SIGNING store, because a hand-authored file
 * would not verify. */
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

async function boot(
  opts: { terminalMesh?: boolean } = {},
): Promise<{ daemon: FielddDaemon; mock: MockMgmtServer }> {
  const dataDir = mkdtempSync(join(tmpdir(), "vf-field-"));
  cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
  mkdirSync(join(dataDir, "native", "run"), { recursive: true });
  writeFileSync(join(dataDir, "native", "pairing"), "ab".repeat(32));
  // UA-P-0a (D1) — the desktop has an ACCOUNT. The posture derives from the
  // link now: without one there is no product serve and the tailnet door mints
  // a guest, which none of the rows below are about.
  writeLinkFixture(dataDir);
  writeExitedRecord(dataDir);

  const mock = new MockMgmtServer(nativeEndpoint(dataDir, SOCKETS.MGMT));
  await mock.start();
  cleanup.push(() => mock.stop());
  mock.helloTerminal = ENDPOINTS;
  // TM-2 (MF-1l): this floor PUBLISHES its doors, so the rows carry their
  // `terminal` join. MF-1's premise is a phone reading this board and tapping
  // a card, which is exactly the case the join is for — and the re-tag below
  // reads `terminal.cellBootId` as its witness that the fold subscription is
  // live. A floor with its doors off is the publisher test's row, not this
  // file's.
  mock.helloTerminalMesh = opts.terminalMesh ?? true;
  mock.observedState = observed([
    { sessionId: PANE, pid: 42, cell: { cellInstanceId: 1, cellBootId: "cell-a" } },
  ]);

  const daemon = await bootstrap({ dataDir, controlPort: 0, dataPort: 0 });
  cleanup.push(() => daemon.stop());
  return { daemon, mock };
}

/** The product serve, as the daemon's own `productServeSpec` shapes it. */
const productServe = (daemon: FielddDaemon) => ({
  name: "product",
  target: { kind: "port" as const, port: daemon.controlPort },
  tls: false,
  pathSecret: "0".repeat(32),
});

async function poll<T>(fn: () => T | undefined, ms = 5_000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = fn();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`poll timed out after ${ms}ms`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/** F-M4 — a local reader on the product door: the field's snapshot rows, and
 * the connection that keeps the subscription open (its deltas land in
 * `rpc.notifications`). */
async function fieldSubscription(
  daemon: FielddDaemon,
): Promise<{ rows: Array<Record<string, unknown>>; rpc: WsRpc }> {
  const ws = new WebSocket(`ws://127.0.0.1:${daemon.controlPort}`);
  cleanup.push(() => ws.close());
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  const rpc = new WsRpc(ws);
  await helloAs(rpc, daemon.tokens.mint(["agent.observe"], "fm4").token);
  const sub = (await rpc.call("agent.subscribe", { projection: "field" })) as {
    snapshot: { rows: Array<Record<string, unknown>> };
  };
  return { rows: sub.snapshot.rows, rpc };
}

async function fieldDoor(daemon: FielddDaemon): Promise<Array<Record<string, unknown>>> {
  return (await fieldSubscription(daemon)).rows;
}

/** Whether the door's field subscription has carried RUN re-tagged to `cellBootId`. */
const retagged = (rpc: WsRpc, cellBootId: string): boolean =>
  rpc.notifications.some((note) => {
    if (!note.method.endsWith(".delta")) return false;
    const upserts = (note.params.payload as { upserts?: Array<Record<string, unknown>> })?.upserts;
    return (upserts ?? []).some(
      (row) =>
        row["runtimeRunId"] === RUN &&
        (row["terminal"] as { cellBootId?: string } | undefined)?.cellBootId === cellBootId,
    );
  });

// ONE CARRIER (DS-D14, 2026-10-01). The field had two: the `field.agents.v1`
// slice and the door's `agent.subscribe {projection: "field"}`. The slice
// retired with the mesh board's reader in place (DS-3 for the desktop, DS-8 for
// the phone), so the door is the board's only carrier, and the attach-join
// question (TM-r7's `attachableRows`) is asked of it alone.

describe("TM-2 (F-M4) — the door answers the attach-join question", () => {
  it("withholds the attach join while the doors are not published", async () => {
    const { daemon } = await boot({ terminalMesh: false });
    await poll(() =>
      daemon.agents.list().sessions.some((row) => row.runtimeRunId === RUN) ? true : undefined,
    );

    const rows = await fieldDoor(daemon);
    const row = rows.find((r) => r["runtimeRunId"] === RUN);
    // the ROW is there — the agent is real and working, and dropping it for a
    // transport reason would lose a live agent off a phone
    expect(row, "the door answered the board").toBeDefined();
    expect(row).toMatchObject({ kind: "scripted" });
    expect(row?.["terminal"], "the join is withheld").toBeUndefined();
  });

  it("carries the attach join once the floor publishes its doors", async () => {
    const { daemon } = await boot({ terminalMesh: true });
    await poll(() =>
      daemon.agents.list().sessions.some((row) => row.runtimeRunId === RUN) ? true : undefined,
    );

    const rows = await fieldDoor(daemon);
    expect(rows.find((r) => r["runtimeRunId"] === RUN)?.["terminal"]).toMatchObject({
      runtimeSessionId: PANE,
    });
  });
});

describe("DS-D14 — the daemon never writes the field's store slice", () => {
  it("publishes nothing into field.agents.v1 — through the serve's edges, a fold change and a graceful stop", async () => {
    // Every edge the retired publisher answered, driven through the real
    // daemon: the product serve's two `serves-changed` edges (the publisher's
    // gate), a fold change only a live fold subscription could carry, and a
    // graceful stop (where the publisher withdrew its slice). The floor must
    // be asked to store `field.agents.v1` at NONE of them.
    const { daemon, mock } = await boot();
    await poll(() =>
      daemon.agents.list().sessions.some((row) => row.runtimeRunId === RUN) ? true : undefined,
    );

    // the CONTROL: the board is live — on the door, which is its one carrier
    const { rows, rpc } = await fieldSubscription(daemon);
    expect(rows.some((r) => r["runtimeRunId"] === RUN)).toBe(true);

    await daemon.mesh.removeServe("product");
    await new Promise((resolve) => setTimeout(resolve, 400));
    await daemon.mesh.setServes([productServe(daemon)]);

    // the FOLD moving on its own — an instant re-tag in the floor's inventory —
    // witnessed on the door, so the silence below is a carrier that is gone and
    // not a fold that never moved
    mock.pushObserved(
      observed([{ sessionId: PANE, pid: 42, cell: { cellInstanceId: 2, cellBootId: "cell-b" } }]),
    );
    await poll(() => (retagged(rpc, "cell-b") ? true : undefined));
    // longer than the retired publisher's 250 ms coalescing floor, so a
    // publisher still wired would have flushed by now
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(mock.agentFieldWrites, "nothing written while the daemon runs").toEqual([]);

    await daemon.stop();
    expect(mock.agentFieldWrites, "nothing written at a graceful stop").toEqual([]);
  }, 60_000);
});
