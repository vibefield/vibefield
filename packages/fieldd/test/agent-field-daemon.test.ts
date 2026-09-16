import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AGENT_SESSION_RECORD_FORMAT,
  AgentFieldSlice,
  type AgentSessionRecord,
  LAYOUT,
  SOCKETS,
  STORES,
} from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { bootstrap, type FielddDaemon, SessionRecordStore } from "../src/index";
import { MockMgmtServer } from "../src/testing/mock-mgmt";
import { TEST_LOGIN, writeLinkFixture } from "./link-fixture";
import { nativeEndpoint } from "./native-harness";
import { helloAs, WsRpc } from "./ws-rpc";

// MF-1 (§10.2) — the agent field's STORE publisher, as the DAEMON wires it.
//
// Why this file exists: `agent-field-publisher.test.ts` constructs the
// publisher itself, so it proves the publisher and nothing about daemon.ts.
// Deleting `agentField.start()` and the `serves-changed` hook left the whole
// fieldd suite green (the tests lens, 2026-09-13). What is under test here is
// exactly that seam: the daemon builds the publisher over the FOLD and the
// mesh client, gates it on this device's product serve, and withdraws the
// slice when it stops.
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

const slices = (mock: MockMgmtServer) =>
  mock.agentFieldWrites.map((raw) => AgentFieldSlice.parse(raw));

/** F-M4 — the OTHER carrier: a local reader on the product door. */
async function fieldDoor(daemon: FielddDaemon): Promise<Array<Record<string, unknown>>> {
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
  return sub.snapshot.rows;
}

// UA-P-0e (D2) — ONE CARRIER, not two.
//
// The field had two: the `field.agents.v1` slice and the door's
// `agent.subscribe {projection: "field"}`. James ruled the store scoped to the
// login identity, and truffle cannot do that — it broadcasts to every tailnet
// node whose hostname carries the app prefix — so the slice carrier is off.
// What it carried was not incidental: every agent's label, project, branch,
// model, effort and blocker tool, to other people's desktops.
//
// The door carrier is untouched, and it is the one the phone already reads.
// It answers the SAME rows, and it answers them only to a caller whose WhoIs
// login matches the stored link.
//
// What these rows used to assert about the slice — the withdraw-on-gate-close,
// the re-publish, the fold subscription, the graceful empty slice — is still
// asserted, in `agent-field-publisher.test.ts`, against a publisher driven
// directly. That is where it belongs while the daemon does not wire one: the
// publisher is correct code for a bus that can be scoped, and UA-P-4 is when it
// gets one.
describe("TM-2 (F-M4) — the board's surviving carrier answers the same question", () => {
  it("withholds the attach join while the doors are not published", async () => {
    const { daemon, mock } = await boot({ terminalMesh: false });
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

    // and the bus carried none of it
    expect(mock.agentFieldWrites).toEqual([]);
  });

  it("carries the attach join once the floor publishes its doors", async () => {
    const { daemon, mock } = await boot({ terminalMesh: true });
    await poll(() =>
      daemon.agents.list().sessions.some((row) => row.runtimeRunId === RUN) ? true : undefined,
    );

    const rows = await fieldDoor(daemon);
    expect(rows.find((r) => r["runtimeRunId"] === RUN)?.["terminal"]).toMatchObject({
      runtimeSessionId: PANE,
    });
    expect(mock.agentFieldWrites).toEqual([]);
  });
});

describe("UA-P-0e — the daemon's store carrier for the field is inert", () => {
  it("publishes no slice, through a full boot, a serve cycle and a graceful stop", async () => {
    const { daemon, mock } = await boot();

    // the fold has a row: MF-1f's exited-but-hosted run, re-listed by the first
    // inventory (no floor needed to reach it). Everything the publisher would
    // have reacted to happens below, and none of it reaches the bus.
    await poll(() =>
      daemon.agents.list().sessions.some((row) => row.runtimeRunId === RUN) ? true : undefined,
    );
    expect(mock.agentFieldWrites, "boot published nothing").toEqual([]);

    // the gate closing and opening again — the two `serves-changed` edges the
    // publisher's own suite drives it on
    await daemon.mesh.removeServe("product");
    await new Promise((resolve) => setTimeout(resolve, 400));
    await daemon.mesh.setServes([productServe(daemon)]);
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(mock.agentFieldWrites, "a serve cycle published nothing").toEqual([]);

    // the FOLD moving on its own — an instant re-tag in the floor's inventory,
    // which is the one event only a live fold subscription could carry
    mock.pushObserved(
      observed([{ sessionId: PANE, pid: 42, cell: { cellInstanceId: 2, cellBootId: "cell-b" } }]),
    );
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(mock.agentFieldWrites, "a fold change published nothing").toEqual([]);

    // the CONTROL: the board is genuinely live on the surviving carrier, so
    // these are absences and not a test of a daemon that never had a field
    const rows = await fieldDoor(daemon);
    expect(rows.some((r) => r["runtimeRunId"] === RUN)).toBe(true);

    // and a graceful stop has no empty slice to publish, because it published
    // no full one
    await daemon.stop();
    expect(mock.agentFieldWrites).toEqual([]);
  }, 60_000);
});
