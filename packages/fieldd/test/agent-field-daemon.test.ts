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

// TWO CARRIERS AGAIN (UA-P-4), and these rows are about the DOOR one.
//
// The field has two: the `field.agents.v1` slice and the door's
// `agent.subscribe {projection: "field"}`. UA-P-0e turned the slice carrier off
// (a broadcast store carried every agent's label, project, branch, model,
// effort and blocker tool to other people's desktops); RFC 025's login gate
// brought it back scoped, and the daemon wiring for it is the UA-P-4 describe
// below. The door carrier was never touched: it answers the SAME rows, only to
// a caller whose WhoIs login matches the stored link, and it is what the phone
// reads today.
//
// The `agentFieldWrites` assertions in these two rows are NOT a claim that the
// bus is off — it is on. They hold because neither row ever opens the
// publisher's gate: `boot()` leaves the product serve as it finds it and these
// tests drive no `serves-changed` edge, so the carrier has nothing to publish
// yet. Stated plainly because an assertion that passes for a reason other than
// the one it names is how a suite stops meaning anything. The slice carrier's
// own behaviour — withdraw on gate close, re-publish, the fold subscription,
// the graceful empty slice — is asserted in `agent-field-publisher.test.ts`
// against a publisher driven directly, and its daemon wiring below.
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

    // the slice carrier's gate never opened in this row, so it has published
    // nothing — see the note above: this is not the bus being off
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

describe("UA-P-4 — the daemon's store carrier for the field is live again, scoped", () => {
  it("publishes the board at the gate's edges, and clears it on a graceful stop", async () => {
    // THE FLIP BACK. UA-P-0e constructed this publisher and never started it,
    // because `field.agents.v1` reached every VibeField node on the tailnet and
    // carried every agent's label, project, branch, model, effort and blocker
    // tool. RFC 025 gates the node on the account's login, so the store's
    // audience is the account (mesh-bus.ts carries the citations) and the
    // carrier is wired to the daemon's events again.
    //
    // What this row witnesses is the WIRING, not the publisher's own logic
    // (that is `agent-field-publisher.test.ts`): that the daemon starts it,
    // that the two `serves-changed` edges reach it, that a fold change reaches
    // it, and that a graceful stop clears the slice rather than leaving a dead
    // board on the bus.
    const { daemon, mock } = await boot();

    await poll(() =>
      daemon.agents.list().sessions.some((row) => row.runtimeRunId === RUN) ? true : undefined,
    );

    // the gate closing and opening again — the two `serves-changed` edges the
    // publisher's own suite drives it on, here driven through the real daemon
    await daemon.mesh.removeServe("product");
    await new Promise((resolve) => setTimeout(resolve, 400));
    await daemon.mesh.setServes([productServe(daemon)]);
    await poll(() => (mock.agentFieldWrites.length > 0 ? true : undefined));
    const published = mock.agentFieldWrites.at(-1) as { rows?: Array<Record<string, unknown>> };
    expect(published.rows?.some((r) => r["runtimeRunId"] === RUN)).toBe(true);

    // CONTENT-FREE ROWS (MF-1 §10.2): the board says an agent exists and how to
    // reach it, never what it is doing. The gate is why the store may carry a
    // board at all; it is not a reason to widen what a board says.
    const row = published.rows?.find((r) => r["runtimeRunId"] === RUN) as Record<string, unknown>;
    for (const content of ["branch", "model", "effort", "blocker", "project", "prompt"]) {
      expect(row, `a field row must not carry ${content}`).not.toHaveProperty(content);
    }

    // the FOLD moving on its own — an instant re-tag in the floor's inventory,
    // which is the one event only a live fold subscription could carry
    const before = mock.agentFieldWrites.length;
    mock.pushObserved(
      observed([{ sessionId: PANE, pid: 42, cell: { cellInstanceId: 2, cellBootId: "cell-b" } }]),
    );
    await poll(() => (mock.agentFieldWrites.length > before ? true : undefined));

    // the CONTROL: the board is live on the DOOR carrier too, so the store rows
    // above are a second carrier of a real board and not the only sign of one
    const rows = await fieldDoor(daemon);
    expect(rows.some((r) => r["runtimeRunId"] === RUN)).toBe(true);

    // and a graceful stop CLEARS the slice — a desktop that has gone away must
    // not leave its board standing on the bus for the account's other devices
    const atStop = mock.agentFieldWrites.length;
    await daemon.stop();
    expect(mock.agentFieldWrites.length).toBeGreaterThan(atStop);
    const last = mock.agentFieldWrites.at(-1) as { rows?: unknown[] };
    expect(last.rows ?? []).toEqual([]);
  }, 60_000);
});
