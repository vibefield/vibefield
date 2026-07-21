// NativeLink concurrency regressions, reproduced deterministically against the
// scripted mock mgmt server (review findings 2026-07-21):
// - a delta arriving in the SAME socket chunk as the subscribe response;
// - exactly-one reconnect after connection loss (no duplicate timers);
// - a rejected subscription cannot poison later reconnects;
// - close is terminal, including before a connection attempt starts.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { NativeLink } from "../src/native-link";
import { MockMgmtServer } from "../src/testing/mock-mgmt";

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
  cleanup = [];
});

async function setup(): Promise<{ mock: MockMgmtServer; link: NativeLink }> {
  const dir = mkdtempSync(join(tmpdir(), "vf-mock-"));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  const pairingFile = join(dir, "pairing");
  writeFileSync(pairingFile, "ab".repeat(32));
  const socketPath = join(dir, "mgmt.sock");
  const mock = new MockMgmtServer(socketPath);
  await mock.start();
  cleanup.push(() => mock.stop());
  const link = new NativeLink({ socketPath, pairingFile, bootId: "test-boot" });
  cleanup.push(() => link.close());
  return { mock, link };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("NativeLink concurrency", () => {
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
