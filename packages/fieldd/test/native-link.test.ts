// NativeLink concurrency regressions, reproduced deterministically against the
// scripted mock mgmt server (review findings 2026-07-21):
// - a delta arriving in the SAME socket chunk as the subscribe response;
// - exactly-one reconnect after connection loss (no duplicate timers);
// - a rejected subscription cannot poison later reconnects;
// - close is terminal, including before a connection attempt starts.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  isPipeEndpoint,
  SOCKETS,
  type TerminalRouteCell,
  type TerminalRouteSnapshot,
  type TerminalWorkloadClass,
} from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { NativeLink, type NativeLinkOptions } from "../src/native-link";
import { MockMgmtServer } from "../src/testing/mock-mgmt";
import { nativeEndpoint } from "./native-harness";

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
  cleanup = [];
});

/** Where the mock binds under a fresh temp root, by the WIN-D1 law: a
 * `native/run/mgmt.sock` path on unix — created here, since no field-native ran
 * to create it — and a root-scoped pipe name on win32, which has no directory
 * to make and would fail `listen()` if handed a filesystem path at all. */
function mockEndpoint(dir: string): string {
  const endpoint = nativeEndpoint(dir, SOCKETS.MGMT);
  if (!isPipeEndpoint(endpoint)) mkdirSync(dirname(endpoint), { recursive: true });
  return endpoint;
}

async function setup(
  options: Pick<NativeLinkOptions, "maxFrameBytes" | "reconnect"> = {},
): Promise<{ mock: MockMgmtServer; link: NativeLink }> {
  const dir = mkdtempSync(join(tmpdir(), "vf-mock-"));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  const pairingFile = join(dir, "pairing");
  writeFileSync(pairingFile, "ab".repeat(32));
  const endpoint = mockEndpoint(dir);
  const mock = new MockMgmtServer(endpoint);
  await mock.start();
  cleanup.push(() => mock.stop());
  const link = new NativeLink({
    socketPath: endpoint,
    pairingFile,
    bootId: "test-boot",
    ...options,
  });
  cleanup.push(() => link.close());
  return { mock, link };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const ROUTES_SUBSCRIBE = "native.lifecycle.terminal.routes.subscribe";

/** The NF-D8 endpoints a PRE-TC-S2 floor puts on the hello ack, and the same
 * ones a TC-S2 floor keeps there as the legacy single-cell mirror. */
const LEGACY_ENDPOINTS = {
  controlSocket: "/mock/native/run/termctl.sock",
  frameSocket: "/mock/native/run/termframe.sock",
  authToken: "legacy-mirror-token",
};

/** The route stream is armed just AFTER the dial completes — the same instant
 * the daemon arms its observed subscription — so a row that drives deltas waits
 * for the subscribe to land before pushing one. The wait is also the assertion
 * that the arm happened at all. */
async function awaitRoutesArmed(mock: MockMgmtServer, count = 1): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (mock.subscriptionRequests.filter((m) => m === ROUTES_SUBSCRIBE).length >= count) return;
    await sleep(10);
  }
  throw new Error(`the terminal routes subscription was never armed (${count})`);
}

/** A one-cell TC-D15 snapshot in the floor's own shape. The socket names carry
 * the cell's ordinal (`termctl.<n>.sock`) because a cell restart is never a
 * rebind, so a REPLACEMENT moves the paths as well as the identity — which is
 * what makes "did the endpoints follow the new cell?" an assertable question. */
function routes(revision: number, instance: number, cellBootId: string): TerminalRouteSnapshot {
  return { revision, cells: [cellRow(instance, cellBootId)] };
}

function cellRow(instance: number, cellBootId: string): TerminalRouteCell {
  return {
    cellInstanceId: instance,
    cellBootId,
    pid: 4000 + instance,
    tokenGeneration: instance,
    endpoints: {
      controlSocket: `/mock/native/run/termctl.${instance}.sock`,
      frameSocket: `/mock/native/run/termframe.${instance}.sock`,
      authToken: `token-${cellBootId}`,
    },
  };
}

/** TC-S3 — the same row, wearing its class and role. */
function classCell(
  instance: number,
  cellBootId: string,
  workloadClass: TerminalWorkloadClass,
  role: "class" | "solo",
): TerminalRouteCell {
  return { ...cellRow(instance, cellBootId), workloadClass, role };
}

describe("NativeLink concurrency", () => {
  it("retries until native is ready — including past a stale unix inode", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vf-stale-native-"));
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    const pairingFile = join(dir, "pairing");
    const endpoint = mockEndpoint(dir);
    writeFileSync(pairingFile, "ab".repeat(32));
    // The unix half of the premise: a dead daemon strands its socket inode, and
    // the dial must read that as not-yet rather than as gone. A named pipe has
    // no inode to strand, so on win32 the endpoint is simply unbound — which is
    // the same question asked of the pipe-aware guard in NativeLink, and the
    // only test here that asks it before the mock exists.
    if (!isPipeEndpoint(endpoint)) writeFileSync(endpoint, "stale socket inode");

    const link = new NativeLink({
      socketPath: endpoint,
      pairingFile,
      bootId: "test-boot",
      waitForDaemonMs: 1_500,
    });
    cleanup.push(() => link.close());
    const connecting = link.connect();

    await sleep(150);
    const mock = new MockMgmtServer(endpoint);
    await mock.start();
    cleanup.push(() => mock.stop());

    await connecting;
    expect(link.connected).toBe(true);
    expect(mock.connections).toBe(1);
  });

  it("does not retry a terminal initial hello rejection", async () => {
    const { mock, link } = await setup();
    mock.failNextHello = true;

    await expect(link.connect()).rejects.toMatchObject({
      kind: "UNAUTHORIZED",
      retryable: false,
    });
    expect(mock.connections).toBe(1);
  });

  it("applies the returned snapshot before a same-chunk delta", async () => {
    const { mock, link } = await setup();
    mock.deltaInSameChunk = true;
    await link.connect();
    const order: string[] = [];
    let state: unknown = null;
    const { snapshot } = await link.subscribe("x.y.subscribe", {}, (p, kind) => {
      order.push(kind);
      state = p;
    });
    order.push("returned-snapshot");
    state = snapshot;
    await sleep(50);
    expect(order).toEqual(["returned-snapshot", "delta"]);
    expect(state).toEqual({ n: 1 });
  });

  it("reconnects once and replays snapshot before a same-chunk delta", async () => {
    const { mock, link } = await setup();
    await link.connect();
    const events: Array<{ kind: string; payload: unknown }> = [];
    let state: unknown = null;
    await link.subscribe("x.y.subscribe", {}, (p, kind) => {
      events.push({ kind, payload: p });
      state = p;
    });
    expect(mock.connections).toBe(1);

    mock.deltaInSameChunk = true;
    mock.killClients();
    await sleep(900); // first backoff is 500ms
    expect(link.connected).toBe(true);
    expect(mock.connections).toBe(2); // exactly one reconnect
    expect(events).toEqual([
      { kind: "snapshot", payload: { n: 0 } },
      { kind: "delta", payload: { n: 1 } },
    ]);
    expect(state).toEqual({ n: 1 });

    await sleep(400);
    expect(mock.connections).toBe(2); // and it stays that way — no duplicate timers
  });

  it("a hello failure during reconnect converges to a single live connection", async () => {
    const { mock, link } = await setup();
    await link.connect();
    expect(mock.connections).toBe(1);

    mock.failNextHello = true; // the first reconnect attempt will be rejected at hello
    mock.killClients();

    await sleep(2500); // 500ms → failed hello → 1000ms → success
    expect(link.connected).toBe(true);
    expect(mock.connections).toBe(3); // initial + rejected + successful — sequential, never parallel

    await sleep(400);
    expect(mock.connections).toBe(3);
  });

  it("removes a rejected subscription so the next reconnect can recover", async () => {
    const { mock, link } = await setup();
    await link.connect();
    mock.rejectedSubscriptions.add("x.rejected.subscribe");

    await expect(link.subscribe("x.rejected.subscribe", {}, () => {})).rejects.toMatchObject({
      kind: "NOT_FOUND",
    });
    expect(link.connected).toBe(true);

    mock.killClients();
    await sleep(900);
    expect(link.connected).toBe(true);
    expect(mock.connections).toBe(2);
  });

  it("a disposed subscription is not replayed after reconnect", async () => {
    const { mock, link } = await setup();
    await link.connect();
    const subscription = await link.subscribe("x.disposed.subscribe", {}, () => {});
    expect(
      mock.subscriptionRequests.filter((method) => method === "x.disposed.subscribe"),
    ).toHaveLength(1);
    subscription.dispose();

    mock.killClients();
    await sleep(900);
    expect(link.connected).toBe(true);
    expect(
      mock.subscriptionRequests.filter((method) => method === "x.disposed.subscribe"),
    ).toHaveLength(1);
  });

  it("closes the native connection when one unterminated frame exceeds the cap", async () => {
    const { mock, link } = await setup({ maxFrameBytes: 128, reconnect: false });
    await link.connect();
    for (const socket of mock.sockets) socket.write("x".repeat(129));

    await sleep(50);
    expect(link.connected).toBe(false);
    expect(mock.sockets.size).toBe(0);
  });

  it("cancels an in-flight dial when close makes the link terminal", async () => {
    const { mock, link } = await setup();
    const connecting = link.connect();
    link.close();

    await expect(connecting).rejects.toThrow(/closed|dialing/);
    await sleep(50);
    expect(link.connected).toBe(false);
    expect(mock.sockets.size).toBe(0);
  });

  it("a refused REPLAY keeps the link alive; the kept sub retries next cycle (C3)", async () => {
    // The mesh case: serve.subscribe replays UNAVAILABLE while the node is
    // down — pre-fix that failed the whole dial and cycled the link forever,
    // health stream included.
    const { mock, link } = await setup();
    await link.connect();
    const events: string[] = [];
    await link.subscribe("x.keep.subscribe", {}, (_p, kind) => events.push(`keep:${kind}`));
    await link.subscribe("x.flaky.subscribe", {}, (_p, kind) => events.push(`flaky:${kind}`));
    expect(mock.connections).toBe(1);

    mock.rejectedSubscriptions.add("x.flaky.subscribe"); // its backend went down
    mock.killClients();
    await sleep(900); // first backoff is 500ms
    expect(link.connected).toBe(true); // the dial survived the refused replay
    expect(mock.connections).toBe(2);
    expect(events).toContain("keep:snapshot"); // the healthy sub replayed fine

    mock.rejectedSubscriptions.delete("x.flaky.subscribe"); // backend recovered
    mock.killClients();
    await sleep(900);
    expect(link.connected).toBe(true);
    expect(mock.connections).toBe(3);
    // the KEPT entry retried on the next cycle and recovered its stream
    expect(events.filter((e) => e === "flaky:snapshot").length).toBeGreaterThanOrEqual(1);
  });
});

describe("NativeLink terminal routes (TC-D15)", () => {
  it("prefers the ack's route snapshot over the legacy mirror, and keeps its identity", async () => {
    // A TC-S2 floor sends BOTH: the snapshot and the single-cell `terminal`
    // mirror it keeps in lockstep for pre-routes readers. They are two readings
    // of one floor, so the reader picks — it never merges — and the snapshot is
    // the one carrying the identity every later comparison keys on.
    const { mock, link } = await setup();
    mock.helloTerminal = LEGACY_ENDPOINTS;
    mock.terminalRoutes = routes(7, 1, "cell-a");
    await link.connect();

    expect(link.terminalEndpoints?.authToken).toBe("token-cell-a");
    expect(link.terminalEndpoints?.controlSocket).toBe("/mock/native/run/termctl.1.sock");
    expect(link.terminalRoutes?.revision).toBe(7);
    expect(link.terminalRoutes?.cells[0]?.cellBootId, "the identity, not the token").toBe("cell-a");
    expect(link.terminalRoutes?.cells[0]?.pid, "diagnostics targeting, never authority").toBe(4001);
  });

  it("a pre-TC-S2 floor still delivers endpoints from the legacy mirror alone", async () => {
    // The floor that never heard of routes: no `terminalRoutes` on the ack, and
    // a routes subscribe it answers with something that is not a snapshot at
    // all (the mock's generic payload). Both readings must leave the pre-routes
    // behaviour byte-identical rather than blanking a live floor.
    const { mock, link } = await setup();
    mock.helloTerminal = LEGACY_ENDPOINTS;
    await link.connect();
    await sleep(50);

    expect(link.terminalEndpoints).toMatchObject(LEGACY_ENDPOINTS);
    expect(link.terminalRoutes, "an unparseable payload is never adopted").toBeUndefined();
  });

  it("a delta naming a NEW cell fires exactly one change and moves the endpoints", async () => {
    const { mock, link } = await setup();
    mock.terminalRoutes = routes(1, 1, "cell-a");
    await link.connect();
    await awaitRoutesArmed(mock);

    const seen: Array<string | undefined> = [];
    link.on("terminal-endpoints", () => seen.push(link.terminalEndpoints?.authToken));
    mock.pushRoutesDelta(routes(2, 2, "cell-b"));
    await sleep(50);

    expect(seen, "one change, one event").toEqual(["token-cell-b"]);
    expect(link.terminalEndpoints?.controlSocket).toBe("/mock/native/run/termctl.2.sock");
    expect(link.terminalRoutes?.cells[0]?.cellBootId).toBe("cell-b");
  });

  it("a delta at the SAME revision changes nothing — state transfer is idempotent", async () => {
    // The payload here is deliberately impossible from a correct floor (a
    // revision increments at every change), because that is what pins the KEY:
    // `revision`, not a deep-equal over the cells. Re-sending identical state
    // is something the reconnect path does on purpose, and consumers drop live
    // control connections on this event.
    const { mock, link } = await setup();
    mock.terminalRoutes = routes(3, 1, "cell-a");
    await link.connect();
    await awaitRoutesArmed(mock);

    const seen: string[] = [];
    link.on("terminal-endpoints", () => seen.push("changed"));
    mock.pushRoutesDelta(routes(3, 9, "cell-imposter"));
    await sleep(50);

    expect(seen).toEqual([]);
    expect(link.terminalRoutes?.cells[0]?.cellBootId).toBe("cell-a");
    expect(link.terminalEndpoints?.authToken).toBe("token-cell-a");
  });

  it("empty cells are an honest state: no endpoints, and the floor still said so", async () => {
    // "The floor is up and has no engine right now" is a reading, not a blank —
    // so the snapshot survives while the endpoints are absent, and a cell
    // coming up afterwards is a change like any other.
    const { mock, link } = await setup();
    mock.terminalRoutes = { revision: 4, cells: [] };
    await link.connect();
    await awaitRoutesArmed(mock);

    expect(link.terminalEndpoints).toBeUndefined();
    expect(link.terminalRoutes?.revision).toBe(4);

    mock.pushRoutesDelta(routes(5, 1, "cell-a"));
    await sleep(50);
    expect(link.terminalEndpoints?.authToken).toBe("token-cell-a");
  });

  it("a malformed delta keeps the last good snapshot (tolerant reader)", async () => {
    const { mock, link } = await setup();
    mock.terminalRoutes = routes(1, 1, "cell-a");
    await link.connect();
    await awaitRoutesArmed(mock);

    const seen: string[] = [];
    link.on("terminal-endpoints", () => seen.push("changed"));
    mock.pushDelta("terminal.routes.subscribe", { revision: "seven", cells: [] });
    await sleep(50);

    expect(seen, "garbage is never a change").toEqual([]);
    expect(link.terminalEndpoints?.authToken).toBe("token-cell-a");
    expect(link.terminalRoutes?.revision).toBe(1);
  });

  it("the legacy mirror is the INTERACTIVE class's create target (TC-S3)", async () => {
    // With K=2 cells the mirror is no longer "the floor's endpoints" — it is
    // one cell's, and the one every pre-routes reader means is the deck's. The
    // agent cell is listed FIRST so `cells[0]`, the pre-TC-S3 derivation, would
    // give the wrong answer here.
    const { mock, link } = await setup();
    mock.terminalRoutes = {
      revision: 2,
      cells: [
        classCell(2, "cell-agent", "agent", "class"),
        classCell(1, "cell-deck", "interactive", "class"),
      ],
    } satisfies TerminalRouteSnapshot;
    await link.connect();

    expect(link.terminalEndpoints?.authToken).toBe("token-cell-deck");
    expect(link.terminalRoutes?.cells, "both rows survive; only the mirror picks").toHaveLength(2);
  });

  it("a floor with only SOLO agent cells mirrors nothing — an honest blank", async () => {
    // No interactive cell means no deck host, and the mirror says so rather
    // than handing a pre-routes reader an agent isolation cell to attach to.
    // The snapshot is still a live reading, and routes-aware consumers use it.
    const { mock, link } = await setup();
    mock.terminalRoutes = {
      revision: 3,
      cells: [classCell(5, "solo-5", "agent", "solo")],
    } satisfies TerminalRouteSnapshot;
    await link.connect();

    expect(link.terminalEndpoints).toBeUndefined();
    expect(link.terminalRoutes?.revision).toBe(3);
  });

  it("reconnect re-reads the routes, and the stream is armed exactly once per dial", async () => {
    // TC-D15's reconnect half. The cell is replaced while the link is DOWN, so
    // the hello ack is what re-reads it; the replayed subscription then
    // delivers the same revision, which must be silent (P5 re-snapshots on
    // every reconnect by design).
    const { mock, link } = await setup();
    mock.terminalRoutes = routes(1, 1, "cell-a");
    await link.connect();
    await awaitRoutesArmed(mock);

    const seen: Array<string | undefined> = [];
    link.on("terminal-endpoints", () => seen.push(link.terminalEndpoints?.authToken));
    mock.terminalRoutes = routes(2, 2, "cell-b");
    mock.killClients();
    await sleep(900); // the first backoff is 500ms

    expect(link.connected).toBe(true);
    // GT-5b's clear, then the re-pair's fresh reading — and NOT a third event
    // from the replayed snapshot, which carries the revision already in hand
    expect(seen).toEqual([undefined, "token-cell-b"]);
    expect(link.terminalRoutes?.cells[0]?.cellBootId).toBe("cell-b");
    await awaitRoutesArmed(mock, 2);
    expect(
      mock.subscriptionRequests.filter((m) => m === ROUTES_SUBSCRIBE),
      "re-subscribed by the replay path, never armed twice per connect",
    ).toHaveLength(2);
  });
});

describe("NativeLink deadlines + ping (TC-D2)", () => {
  it("a request that outlives its deadline rejects TIMEOUT; the link stays usable", async () => {
    const { mock, link } = await setup();
    await link.connect();
    mock.silentMethods.add("x.hang"); // read, never answered — the wedge shape
    await expect(link.request("x.hang", {}, { deadlineMs: 80 })).rejects.toMatchObject({
      kind: "TIMEOUT",
      retryable: true,
    });
    // a late/never reply must not poison the connection for the next request
    const ok = await link.request("x.normal", {});
    expect(ok).toEqual({});
  });

  it("ping answers a PingAck riding the full control path", async () => {
    const { link } = await setup();
    await link.connect();
    const ack = await link.ping(1_000);
    expect(ack.bootId).toBe("mock-native-boot");
    expect(typeof ack.ts).toBe("number");
  });

  it("a wedged control path times ping out at its own tight deadline", async () => {
    const { mock, link } = await setup();
    await link.connect();
    mock.silentMethods.add("native.lifecycle.ping");
    const t0 = Date.now();
    await expect(link.ping(60)).rejects.toMatchObject({ kind: "TIMEOUT" });
    // the deadline is the probe's own, not the 10s request default
    expect(Date.now() - t0).toBeLessThan(2_000);
  });
});
