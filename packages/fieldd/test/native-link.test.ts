// NativeLink concurrency regressions, reproduced deterministically against the
// scripted mock mgmt server (review findings 2026-07-21):
// - a delta arriving in the SAME socket chunk as the subscribe response;
// - exactly-one reconnect after connection loss (no duplicate timers);
// - a rejected subscription cannot poison later reconnects;
// - close is terminal, including before a connection attempt starts.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { isPipeEndpoint, SOCKETS } from "@vibefield/contracts";
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
