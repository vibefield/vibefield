// NativeLink concurrency regressions, reproduced deterministically against the
// scripted mock mgmt server (review findings 2026-07-21):
// - a delta arriving in the SAME socket chunk as the subscribe response;
// - exactly-one reconnect after connection loss (no duplicate timers);
// - a hello failure during reconnect still converges to a single live dial.
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
  it("delivers a delta that arrives in the same chunk as the subscribe response", async () => {
    const { mock, link } = await setup();
    mock.deltaInSameChunk = true;
    await link.connect();
    const deltas: unknown[] = [];
    const { snapshot } = await link.subscribe("x.y.subscribe", {}, (p, kind) => {
      if (kind === "delta") deltas.push(p);
    });
    expect(snapshot).toEqual({ n: 0 });
    await sleep(50);
    expect(deltas).toEqual([{ n: 1 }]); // pre-fix: dropped (route installed after await)
  });

  it("reconnects exactly once after connection loss and replays the subscription", async () => {
    const { mock, link } = await setup();
    await link.connect();
    const snapshots: unknown[] = [];
    await link.subscribe("x.y.subscribe", {}, (p, kind) => {
      if (kind === "snapshot") snapshots.push(p);
    });
    expect(mock.connections).toBe(1);

    mock.killClients();
    await sleep(900); // first backoff is 500ms
    expect(link.connected).toBe(true);
    expect(mock.connections).toBe(2); // exactly one reconnect
    expect(snapshots).toEqual([{ n: 0 }]); // fresh snapshot on reconnect (P5)

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
});
