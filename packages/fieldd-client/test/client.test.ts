// FielddClient against a REAL fieldd (bootstrap over the mock mgmt server —
// no cargo build): hello, requests, live subscription, reconnect-with-replay,
// terminal auth failure; and (S3, 2026-10-01) a replay that is its
// subscription's own — refused alone, re-asked alone, asked with the owner's
// current params.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LAYOUT, pipeEndpointFor, SHELL_PROVIDER_METHODS, SOCKETS } from "@vibefield/contracts";
import {
  bootstrap,
  type FielddDaemon,
  type FielddHealth,
  ProductApi,
  RpcCallError,
  TokenService,
} from "@vibefield/fieldd";
import { MockMgmtServer } from "@vibefield/fieldd/testing";
import { afterEach, describe, expect, it } from "vitest";
import { FielddClient, type FielddRpcError } from "../src/client";

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
  // WIN-D1: the mock binds field-native's mgmt endpoint — a pipe name on win32,
  // the joined LAYOUT path on unix — exactly what bootstrap's NativeLink dials.
  const mock = new MockMgmtServer(
    process.platform === "win32"
      ? pipeEndpointFor(dataDir, SOCKETS.MGMT)
      : join(dataDir, ...LAYOUT.MGMT_SOCKET),
  );
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

  it("routes static shell-provider notifications and keeps listeners across reconnect", async () => {
    const tokens = new TokenService();
    const shellGrant = tokens.mint(["shell.open"], "shell", { shellMain: true });
    const pluginGrant = tokens.mint(["shell.open"], "browser", {
      pluginId: "vibefield.browser",
    });
    const api = new ProductApi({ port: 0, tokens });
    api.register("shell.openExternal", (ctx, params) =>
      api.callShellProvider(ctx, "shell.openExternal", params),
    );
    const port = await api.listen();
    cleanup.push(() => api.close());

    const provider = new FielddClient({
      url: `ws://127.0.0.1:${port}`,
      token: shellGrant.token,
      clientKind: "shell-main",
    });
    const caller = new FielddClient({
      url: `ws://127.0.0.1:${port}`,
      token: pluginGrant.token,
      clientKind: "renderer",
    });
    cleanup.push(() => provider.close());
    cleanup.push(() => caller.close());
    let notifications = 0;
    provider.onNotification("shell.provider.call", (raw) => {
      notifications += 1;
      const callId = (raw as { callId: string }).callId;
      void provider.request("shell.provider.resolve", {
        callId,
        outcome: { result: { opened: true } },
      });
    });
    await provider.ready();
    await caller.ready();
    await provider.request("shell.provider.register", {
      methods: [...SHELL_PROVIDER_METHODS],
    });
    await expect(
      caller.request("shell.openExternal", {
        url: "https://host.example.ts.net:12000/",
      }),
    ).resolves.toEqual({ opened: true });
    expect(notifications).toBe(1);

    api.dropConnections();
    await until(
      () => provider.status === "reconnecting" || caller.status === "reconnecting",
      2_000,
    );
    await until(() => provider.status === "ready" && caller.status === "ready", 6_000);
    await provider.request("shell.provider.register", {
      methods: [...SHELL_PROVIDER_METHODS],
    });
    await expect(
      caller.request("shell.openExternal", {
        url: "https://host.example.ts.net:12001/",
      }),
    ).resolves.toEqual({ opened: true });
    expect(notifications).toBe(2);
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

// S3 (the DS landing review, 2026-10-01) — a peer restart used to drop the
// whole shared link: the replay ran inside hello's try, so ONE replayed
// subscribe refused PRECONDITION_FAILED failed the client (terminal at hello)
// and one refused retryably closed the socket and replayed everything again.
describe("FielddClient — a replay is its subscription's own (S3)", () => {
  /** A live door whose `system.health.subscribe` answers per `n` in its params;
   * `refuse(n)` decides, per ask, whether that one is refused (and how). */
  async function door(refuse: (n: number | undefined) => RpcCallError | null) {
    const tokens = new TokenService();
    const grant = tokens.mint([], "t");
    const api = new ProductApi({ port: 0, tokens });
    const asked: Array<Record<string, unknown>> = [];
    api.register("system.health", () => ({ ok: true }));
    api.registerSubscription("system.health.subscribe", (_ctx, params) => {
      const ask = (params ?? {}) as Record<string, unknown>;
      asked.push(ask);
      const refusal = refuse(typeof ask["n"] === "number" ? ask["n"] : undefined);
      if (refusal !== null) throw refusal;
      return { snapshot: { n: ask["n"], ask: asked.length }, dispose: () => {} };
    });
    const port = await api.listen();
    cleanup.push(() => api.close());
    const askedFor = (n: number) => asked.filter((ask) => ask["n"] === n).length;
    return { api, port, token: grant.token, asked, askedFor };
  }

  it("a replay refused PRECONDITION_FAILED ends that subscription alone: the client stays ready, its owner hears why, the other replays, a later subscribe works", async () => {
    let refusing = false;
    const { api, port, token, askedFor } = await door((n) =>
      refusing && n === 1
        ? new RpcCallError("PRECONDITION_FAILED", "the catalog has not read the index yet", true, {
            service: "index",
            state: "waiting",
          })
        : null,
    );
    const client = clientFor(port, token);
    const statuses: string[] = [];
    client.onStatusChange(() => statuses.push(client.status));
    const refused: FielddRpcError[] = [];
    const one: unknown[] = [];
    const two: unknown[] = [];
    // n:1 is FIRST in the replay order — the old pass died on it before n:2
    await client.subscribe(
      "system.health.subscribe",
      { n: 1 },
      (payload, kind) => kind === "snapshot" && one.push(payload),
      { onReplayFailed: (error) => refused.push(error) },
    );
    await client.subscribe(
      "system.health.subscribe",
      { n: 2 },
      (payload, kind) => kind === "snapshot" && two.push(payload),
      { onReplayFailed: (error) => refused.push(error) },
    );

    refusing = true;
    api.dropConnections();
    await until(() => refused.length === 1 && two.length === 1, 6000);
    expect(refused[0]).toMatchObject({ kind: "PRECONDITION_FAILED", retryable: true });
    expect(client.status).toBe("ready");
    expect(statuses).not.toContain("failed");
    expect(one).toEqual([]); // refused: no snapshot, no route
    expect(two).toEqual([{ n: 2, ask: 4 }]);

    // the refused subscription is OVER on this client: the next replay pass
    // asks for n:2 only, and the owner hears nothing twice
    api.dropConnections();
    await until(() => two.length === 2, 6000);
    expect(askedFor(1)).toBe(2); // its first subscribe + the one refused replay
    expect(askedFor(2)).toBe(3);
    expect(refused).toHaveLength(1);

    // the client is whole: a request round-trips and a fresh subscribe stands
    expect(await client.request("system.health")).toEqual({ ok: true });
    refusing = false;
    const again = await client.subscribe("system.health.subscribe", { n: 1 }, () => {});
    expect(again.snapshot).toMatchObject({ n: 1 });
  });

  it("a replay asks with the owner's CURRENT params; the first subscribe sends the literal", async () => {
    const { api, port, token, asked } = await door(() => null);
    const client = clientFor(port, token);
    let cursor = { epoch: "e1", revision: 3 };
    const snapshots: unknown[] = [];
    await client.subscribe(
      "system.health.subscribe",
      { n: 1, since: cursor },
      (payload, kind) => kind === "snapshot" && snapshots.push(payload),
      { params: () => ({ n: 1, since: cursor }) },
    );
    cursor = { epoch: "e1", revision: 9 }; // the owner moved on before the blip
    api.dropConnections();
    await until(() => snapshots.length === 1, 6000);
    expect(asked).toEqual([
      { n: 1, since: { epoch: "e1", revision: 3 } },
      { n: 1, since: { epoch: "e1", revision: 9 } },
    ]);
  });

  it("a RETRYABLE replay refusal with no owner is re-asked by the client alone — no reconnect, the others asked once", async () => {
    let refusing = 0;
    const { api, port, token, askedFor } = await door((n) => {
      if (n !== 1 || refusing === 0) return null;
      refusing -= 1;
      return new RpcCallError("UNAVAILABLE", "the service is starting", true, {
        service: "x",
        state: "starting",
      });
    });
    const client = new FielddClient({ url: `ws://127.0.0.1:${port}`, token, maxBackoffMs: 40 });
    cleanup.push(() => client.close());
    const one: unknown[] = [];
    const two: unknown[] = [];
    await client.subscribe("system.health.subscribe", { n: 1 }, (payload, kind) => {
      if (kind === "snapshot") one.push(payload);
    });
    await client.subscribe("system.health.subscribe", { n: 2 }, (payload, kind) => {
      if (kind === "snapshot") two.push(payload);
    });
    await client.ready();
    const statuses: string[] = [];
    client.onStatusChange(() => statuses.push(client.status));

    refusing = 2; // the first replay and the client's first re-ask are refused
    api.dropConnections();
    await until(() => one.length === 1, 6000);
    expect(askedFor(1)).toBe(4); // subscribe, refused replay, refused re-ask, served re-ask
    expect(askedFor(2)).toBe(2); // subscribe + ONE replay: nobody else was disturbed
    expect(two).toHaveLength(1);
    expect(statuses).toEqual(["reconnecting", "ready"]); // one blip, no reconnect loop
    expect(client.status).toBe("ready");
  });
});
