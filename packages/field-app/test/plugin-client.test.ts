import { describe, expect, it } from "vitest";
import {
  PluginClientLeaseBroker,
  type PluginLeaseObservation,
} from "../src/plugin-host/plugin-client";

const PLUGIN_ID = "com.example.notes";
const HASH = `sha256:${"a".repeat(64)}`;

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function observation(grantGeneration: number): PluginLeaseObservation {
  return { manifestHash: HASH, grantGeneration };
}

function lease(token: string, grantGeneration: number, expiresAt = 1_000_000): unknown {
  return { token, scopes: ["doc.read"], pluginId: PLUGIN_ID, grantGeneration, expiresAt };
}

class FakeConnection {
  readonly rotations: string[] = [];
  readonly requests: string[] = [];
  connects = 0;
  closes = 0;
  readyCalls = 0;

  constructor(readonly initialToken: string) {}

  connect(): void {
    this.connects += 1;
  }

  rotateCredential(token: string): void {
    this.rotations.push(token);
  }

  async ready(): Promise<void> {
    this.readyCalls += 1;
  }

  close(): void {
    this.closes += 1;
  }

  async request(method: string): Promise<unknown> {
    this.requests.push(method);
    return { method };
  }

  async subscribe(): Promise<{
    subId: string;
    snapshot: unknown;
    unsubscribe(): void;
  }> {
    return { subId: "sub", snapshot: {}, unsubscribe() {} };
  }
}

interface FakeBackend {
  readonly url: string;
  request(method: string, params?: unknown): Promise<unknown>;
  push(response: unknown): void;
}

function harness(now = 0): {
  broker: PluginClientLeaseBroker;
  clients: FakeConnection[];
  backend: FakeBackend;
  requests: Array<{ method: string; params: unknown }>;
  setNow(value: number): void;
} {
  let clock = now;
  const clients: FakeConnection[] = [];
  const requests: Array<{ method: string; params: unknown }> = [];
  const responses: unknown[] = [];
  const backend: FakeBackend = {
    url: "ws://fieldd",
    async request(method: string, params?: unknown): Promise<unknown> {
      requests.push({ method, params });
      const response = responses.shift();
      if (response instanceof Promise) return await response;
      return response;
    },
    push(response: unknown): void {
      responses.push(response);
    },
  };
  const broker = new PluginClientLeaseBroker({
    now: () => clock,
    createClient: ({ token }) => {
      const client = new FakeConnection(token);
      clients.push(client);
      return client;
    },
  });
  return {
    broker,
    clients,
    backend,
    requests,
    setNow(value) {
      clock = value;
    },
  };
}

describe("PluginClientLeaseBroker", () => {
  it("coalesces concurrent lazy calls into one mint and one connection", async () => {
    const h = harness();
    h.backend.push(lease("token-1", 1));
    h.broker.setBackend({ windowClient: h.backend });
    const client = h.broker.createProductClient(PLUGIN_ID, observation(1));

    await Promise.all([client.request("doc.get"), client.request("doc.list")]);

    expect(h.requests).toEqual([
      {
        method: "plugins.openRendererSession",
        params: { pluginId: PLUGIN_ID, manifestHash: HASH, grantGeneration: 1 },
      },
    ]);
    expect(h.clients).toHaveLength(1);
    expect(h.clients[0]?.requests).toEqual(["doc.get", "doc.list"]);
  });

  it("keeps the plugin connection when boot and FieldView name the same window client", async () => {
    const h = harness();
    h.backend.push(lease("token-1", 1));
    h.broker.setBackend({ windowClient: h.backend });
    const client = h.broker.createProductClient(PLUGIN_ID, observation(1));
    await client.request("doc.get");

    // The wrapper object is new, as it is across boot preparation and the React effect; the
    // underlying window principal is the same and must not churn every plugin credential.
    h.broker.setBackend({ windowClient: h.backend });
    await client.request("doc.list");

    expect(h.requests).toHaveLength(1);
    expect(h.clients).toHaveLength(1);
    expect(h.clients[0]?.closes).toBe(0);
    expect(h.clients[0]?.requests).toEqual(["doc.get", "doc.list"]);
  });

  it("refreshes a semantic-equal observation by rotating the exact client", async () => {
    const h = harness();
    h.backend.push(lease("token-1", 1));
    h.backend.push(lease("token-2", 2));
    h.broker.setBackend({ windowClient: h.backend });
    const proxy = h.broker.createProductClient(PLUGIN_ID, observation(1));
    await proxy.request("doc.get");

    await h.broker.refresh(PLUGIN_ID, observation(2));
    await proxy.request("doc.list");

    expect(h.clients).toHaveLength(1);
    expect(h.clients[0]?.initialToken).toBe("token-1");
    expect(h.clients[0]?.rotations).toEqual(["token-2"]);
    expect(h.clients[0]?.readyCalls).toBe(1);
  });

  it("never installs an older mint that resolves after a newer observation", async () => {
    const h = harness();
    const oldMint = deferred<unknown>();
    h.backend.push(oldMint.promise);
    h.backend.push(lease("token-2", 2));
    h.broker.setBackend({ windowClient: h.backend });
    const proxy = h.broker.createProductClient(PLUGIN_ID, observation(1));
    const originalCall = proxy.request("doc.get");
    await Promise.resolve();

    await h.broker.refresh(PLUGIN_ID, observation(2));
    oldMint.resolve(lease("token-1", 1));
    await originalCall;

    expect(h.requests).toHaveLength(2);
    expect(h.clients).toHaveLength(1);
    expect(h.clients[0]?.initialToken).toBe("token-2");
    expect(h.clients[0]?.rotations).toEqual([]);
  });

  it("lets renderer close stop waiting on a credential refresh without admitting its late mint", async () => {
    const h = harness();
    const lateMint = deferred<unknown>();
    h.backend.push(lease("token-1", 1));
    h.backend.push(lateMint.promise);
    h.broker.setBackend({ windowClient: h.backend });
    const proxy = h.broker.createProductClient(PLUGIN_ID, observation(1));
    await proxy.request("doc.get");

    const close = new AbortController();
    const refreshing = h.broker.refresh(PLUGIN_ID, observation(2), close.signal);
    await Promise.resolve();
    close.abort();
    await expect(refreshing).rejects.toThrow("credential refresh aborted");
    h.broker.retire(PLUGIN_ID);

    lateMint.resolve(lease("token-2", 2));
    await Promise.resolve();
    await Promise.resolve();
    expect(h.clients).toHaveLength(1);
    expect(h.clients[0]?.rotations).toEqual([]);
    expect(h.clients[0]?.closes).toBe(1);
  });

  it("cannot resurrect a lease minted by a detached daemon backend", async () => {
    const h = harness();
    const staleMint = deferred<unknown>();
    h.backend.push(staleMint.promise);
    h.broker.setBackend({ windowClient: h.backend });
    const proxy = h.broker.createProductClient(PLUGIN_ID, observation(1));
    const call = proxy.request("doc.get");
    await Promise.resolve();

    h.broker.setBackend(null);
    staleMint.resolve(lease("stale", 1));
    await expect(call).rejects.toThrow("no fieldd connection");
    expect(h.clients).toEqual([]);
  });

  it("converges an older call when its superseded compare-and-mint rejects", async () => {
    const h = harness();
    const oldMint = deferred<unknown>();
    h.backend.push(oldMint.promise);
    h.backend.push(lease("token-2", 2));
    h.broker.setBackend({ windowClient: h.backend });
    const proxy = h.broker.createProductClient(PLUGIN_ID, observation(1));
    const originalCall = proxy.request("doc.get");
    await Promise.resolve();

    await h.broker.refresh(PLUGIN_ID, observation(2));
    oldMint.reject(new Error("CONFLICT: stale grant generation"));

    await expect(originalCall).resolves.toEqual({ method: "doc.get" });
    expect(h.clients).toHaveLength(1);
    expect(h.clients[0]?.initialToken).toBe("token-2");
  });

  it("refuses a legacy response that cannot prove the expected grant generation", async () => {
    const h = harness();
    h.backend.push({
      token: "legacy-token",
      scopes: ["doc.read"],
      pluginId: PLUGIN_ID,
      expiresAt: 1_000_000,
    });
    h.broker.setBackend({ windowClient: h.backend });
    const proxy = h.broker.createProductClient(PLUGIN_ID, observation(1));

    await expect(proxy.request("doc.get")).rejects.toThrow(
      "lease generation undefined does not match 1",
    );
    expect(h.clients).toEqual([]);
  });

  it("renews an expiring lease by rotating rather than replacing the connection", async () => {
    const h = harness(100);
    h.backend.push(lease("token-1", 1, 70_100));
    h.backend.push(lease("token-2", 1, 200_000));
    h.broker.setBackend({ windowClient: h.backend });
    const proxy = h.broker.createProductClient(PLUGIN_ID, observation(1));
    await proxy.request("doc.get");
    h.setNow(10_101);

    await proxy.request("doc.list");

    expect(h.clients).toHaveLength(1);
    expect(h.clients[0]?.rotations).toEqual(["token-2"]);
  });

  it("seeds candidate authority without a live-row mint, then renews normally after promotion", async () => {
    const h = harness(100);
    h.broker.setBackend({ windowClient: h.backend });
    expect(() =>
      h.broker.createSeededProductClient(PLUGIN_ID, observation(2), {
        token: "wrong-candidate-token",
        pluginId: PLUGIN_ID,
        manifestHash: `sha256:${"b".repeat(64)}`,
        grantGeneration: 2,
        expiresAt: 100_000,
      }),
    ).toThrow(/seed manifest/);
    const proxy = h.broker.createSeededProductClient(PLUGIN_ID, observation(2), {
      token: "candidate-token",
      pluginId: PLUGIN_ID,
      manifestHash: HASH,
      grantGeneration: 2,
      expiresAt: 100_000,
    });

    await proxy.request("doc.get");
    expect(h.requests).toEqual([]);
    expect(h.clients).toHaveLength(1);
    expect(h.clients[0]?.initialToken).toBe("candidate-token");

    // The coordinator has promoted the pointer by the time proactive renewal is needed, so the
    // same connection rotates through the normal exact-live comparison.
    h.backend.push(lease("live-token", 2, 300_000));
    h.setNow(40_001);
    await proxy.request("doc.list");
    expect(h.requests).toEqual([
      {
        method: "plugins.openRendererSession",
        params: { pluginId: PLUGIN_ID, manifestHash: HASH, grantGeneration: 2 },
      },
    ]);
    expect(h.clients[0]?.rotations).toEqual(["live-token"]);

    h.broker.retire(PLUGIN_ID);
    expect(h.clients[0]?.closes).toBe(1);
    await expect(proxy.request("doc.after-close")).rejects.toThrow("product client retired");
  });
});
