// FielddClient against a REAL fieldd (bootstrap over the mock mgmt server —
// no cargo build): hello, requests, live subscription, reconnect-with-replay,
// terminal auth failure.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ProductApi, TokenService, bootstrap, type FielddDaemon, type FielddHealth } from "@vibefield/fieldd";
import { MockMgmtServer } from "@vibefield/fieldd/testing";
import { FielddClient } from "../src/client";

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
  cleanup = [];
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until(fn: () => boolean, ms = 4000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > deadline) throw new Error("until: condition timeout");
    await sleep(25);
  }
}

async function fullStack(): Promise<{ daemon: FielddDaemon; mock: MockMgmtServer }> {
  const dataDir = mkdtempSync(join(tmpdir(), "vf-client-"));
  cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
  mkdirSync(join(dataDir, "native", "run"), { recursive: true });
  writeFileSync(join(dataDir, "native", "pairing"), "ab".repeat(32));
  const mock = new MockMgmtServer(join(dataDir, "native", "run", "mgmt.sock"));
  await mock.start();
  cleanup.push(() => mock.stop());
  const daemon = await bootstrap({ dataDir, controlPort: 0 });
  cleanup.push(() => daemon.stop());
  return { daemon, mock };
}

function clientFor(port: number, token: string): FielddClient {
  const client = new FielddClient({ url: `ws://127.0.0.1:${port}`, token });
  cleanup.push(() => client.close());
  return client;
}

describe("FielddClient", () => {
  it("connects through the full spine and requests health", async () => {
    const { daemon } = await fullStack();
    const client = clientFor(daemon.controlPort, daemon.shellToken);
    await client.ready();
    expect(client.status).toBe("ready");
    expect(client.grantedScopes).toContain("tokens.mint");

    const health = (await client.request("system.health")) as FielddHealth;
    expect(health.nativeConnected).toBe(true);
    expect(health.fieldd.state).toBe("up");
  });

  it("streams subscription deltas and stops after unsubscribe", async () => {
    const { daemon, mock } = await fullStack();
    const client = clientFor(daemon.controlPort, daemon.shellToken);

    const events: FielddHealth[] = [];
    const sub = await client.subscribe("system.health.subscribe", {}, (payload) => {
      events.push(payload as FielddHealth);
    });
    expect((sub.snapshot as FielddHealth).nativeConnected).toBe(true);

    mock.pushDelta("health.subscribe", { n: 42 });
    await until(() => events.some((e) => (e.native as { n?: number } | null)?.n === 42));

    sub.unsubscribe();
    await sleep(100); // let the unsubscribe reach the server
    const count = events.length;
    mock.pushDelta("health.subscribe", { n: 43 });
    await sleep(200);
    expect(events.length).toBe(count);
  });

  it("reconnects after a dropped socket and replays with a fresh snapshot", async () => {
    // minimal live server the test can sever without killing it
    const tokens = new TokenService();
    const grant = tokens.mint([], "t");
    const api = new ProductApi({ port: 0, tokens });
    api.register("system.health", () => ({ ok: true }));
    api.registerSubscription("system.health.subscribe", (_ctx, _params, _emit) => ({
      snapshot: { v: 1 },
      dispose: () => {},
    }));
    const port = await api.listen();
    cleanup.push(() => api.close());

    const client = clientFor(port, grant.token);
    const statuses: string[] = [];
    client.onStatusChange(() => statuses.push(client.status));

    const snapshots: unknown[] = [];
    await client.subscribe("system.health.subscribe", {}, (p, kind) => {
      if (kind === "snapshot") snapshots.push(p);
    });

    api.dropConnections();
    await until(() => client.status === "ready" && snapshots.length === 1, 6000);
    expect(statuses).toContain("reconnecting");
    expect(snapshots).toEqual([{ v: 1 }]); // replayed sub got its fresh snapshot

    // still exactly one live connection semantics: another request round-trips
    expect(await client.request("system.health")).toEqual({ ok: true });
  });

  it("a bad token is terminal — status failed, no retry loop", async () => {
    const { daemon } = await fullStack();
    const client = clientFor(daemon.controlPort, "tok_forged");
    await expect(client.ready()).rejects.toMatchObject({ kind: "UNAUTHORIZED" });
    expect(client.status).toBe("failed");
    await sleep(700); // longer than the first backoff — must NOT have redialed
    expect(client.status).toBe("failed");
  });
});
