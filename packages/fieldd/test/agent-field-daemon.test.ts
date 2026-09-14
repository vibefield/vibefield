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
import { bootstrap, type FielddDaemon, SessionRecordStore } from "../src/index";
import { MockMgmtServer } from "../src/testing/mock-mgmt";
import { nativeEndpoint } from "./native-harness";

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

async function boot(): Promise<{ daemon: FielddDaemon; mock: MockMgmtServer }> {
  const dataDir = mkdtempSync(join(tmpdir(), "vf-field-"));
  cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
  mkdirSync(join(dataDir, "native", "run"), { recursive: true });
  writeFileSync(join(dataDir, "native", "pairing"), "ab".repeat(32));
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
  mock.helloTerminalMesh = true;
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

describe("MF-1 — the daemon publishes its field into field.agents.v1", () => {
  it("carries the fold's rows, withdraws when the serve goes, and publishes again when it returns", async () => {
    const { daemon, mock } = await boot();

    // the fold has a row: MF-1f's exited-but-hosted run, re-listed by the
    // first inventory (no floor needed to reach it)
    await poll(() =>
      daemon.agents.list().sessions.some((row) => row.runtimeRunId === RUN) ? true : undefined,
    );

    // The daemon's own boot brings the product serve up (the artifact service
    // declares it), so the gate is OPEN here and the fold's row reaches the
    // mesh without anything in this test asking for it — which is precisely
    // the wiring under test: `agents.list` and `agents.subscribe` are the
    // publisher's sources because daemon.ts made them so.
    const published = await poll(() => slices(mock).find((slice) => slice.rows.length > 0));
    expect(published.v).toBe(1);
    expect(published.deviceId).toBe(daemon.devices.currentDeviceId());
    expect(published.expiresAt).toBeGreaterThan(published.publishedAt);
    expect(published.rows.map((row) => row.runtimeRunId)).toEqual([RUN]);
    expect(published.rows[0]).toMatchObject({ alive: false, kind: "scripted" });
    // content-free on the wire (§10.1)
    expect(Object.keys(published.rows[0] ?? {})).not.toContain("monitor");
    expect(mock.agentFieldWrites.length).toBeGreaterThan(0);

    // THE GATE, closing: the serve goes away and the field is WITHDRAWN rather
    // than left to age out of a reader on the expiry clock
    const before = slices(mock).length;
    await daemon.mesh.removeServe("product");
    const withdrawn = await poll(() => {
      const all = slices(mock);
      return all.length > before ? all[all.length - 1] : undefined;
    });
    expect(withdrawn.rows).toEqual([]);
    expect(withdrawn.expiresAt).toBeLessThanOrEqual(withdrawn.publishedAt);

    // and nothing more goes out while it stays shut
    const quiet = slices(mock).length;
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(slices(mock).length, "a shut gate published anyway").toBe(quiet);

    // THE GATE, opening again: the fold has NOT moved since, so the only thing
    // that can wake the publisher is the daemon's `serves-changed` hook
    await daemon.mesh.setServes([productServe(daemon)]);
    const again = await poll(() => {
      const all = slices(mock);
      return all.length > quiet ? all[all.length - 1] : undefined;
    });
    expect(again.rows.map((row) => row.runtimeRunId)).toEqual([RUN]);

    // THE FOLD, moving on its own — the witness for `agentField.start()`.
    //
    // The pane's cell tag changes in the floor's inventory. Nothing touches the
    // serve, so the ONLY path from this fact to the mesh is the fold
    // subscription `start()` opens. It is deliberately an INSTANT change (a
    // re-tag, not a withdrawal behind MF-1f's grace) so the window here is the
    // publisher's own 250 ms floor: a publisher that learned of it some other
    // way, seconds later, is a publisher that was never subscribed.
    const beforeFold = slices(mock).length;
    mock.pushObserved(
      observed([{ sessionId: PANE, pid: 42, cell: { cellInstanceId: 2, cellBootId: "cell-b" } }]),
    );
    const retagged = await poll(() => {
      const all = slices(mock);
      const last = all.length > beforeFold ? all[all.length - 1] : undefined;
      return last?.rows[0]?.terminal?.cellBootId === "cell-b" ? last : undefined;
    }, 4_000);
    expect(retagged.rows.map((row) => row.runtimeRunId)).toEqual([RUN]);
    // a changed projection is a NEW revision: the row moved, so the frame counts
    expect(retagged.rows[0]?.revision).toBeGreaterThan(published.rows[0]?.revision ?? 0);
  }, 60_000);

  it("a graceful stop publishes the empty slice", async () => {
    const { daemon, mock } = await boot();
    await poll(() =>
      daemon.agents.list().sessions.some((row) => row.runtimeRunId === RUN) ? true : undefined,
    );
    await daemon.mesh.setServes([productServe(daemon)]);
    await poll(() => (slices(mock).some((s) => s.rows.length > 0) ? true : undefined));

    await daemon.stop();
    const last = slices(mock).at(-1);
    expect(last?.rows).toEqual([]);
    // already past: a reader drops this desktop NOW rather than in thirty
    // seconds on the expiry clock
    expect(last?.expiresAt).toBeLessThanOrEqual(last?.publishedAt ?? 0);
  }, 60_000);
});
