import { ProductApi, TokenService } from "@vibefield/fieldd";
import { afterEach, describe, expect, it } from "vitest";
import { FielddClient } from "../src/client";

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const dispose of cleanup.reverse()) await dispose();
  cleanup = [];
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function until(predicate: () => boolean, timeoutMs = 3_000): Promise<void> {
  const stopAt = performance.now() + timeoutMs;
  while (!predicate()) {
    if (performance.now() > stopAt) throw new Error("condition did not become true");
    await delay(10);
  }
}

function clientFor(port: number, token: string): FielddClient {
  const client = new FielddClient({
    url: `ws://127.0.0.1:${port}`,
    token,
    clientKind: "renderer",
    maxBackoffMs: 10,
  });
  cleanup.push(() => client.close());
  return client;
}

describe("FielddClient credential rotation", () => {
  it("preserves one client and replays established subscriptions with the new credential", async () => {
    const tokens = new TokenService();
    const oldGrant = tokens.mint(["doc.read"], "old", { pluginId: "com.example.notes" });
    const newGrant = tokens.mint(["doc.write"], "new", { pluginId: "com.example.notes" });
    const api = new ProductApi({ port: 0, tokens });
    let snapshotGeneration = 1;
    let attaches = 0;
    let disposes = 0;
    api.register("system.health", (ctx) => ({
      scopes: "scopes" in ctx.principal ? ctx.principal.scopes : [],
    }));
    api.registerSubscription("system.health.subscribe", (_ctx, _params, _emit) => {
      attaches += 1;
      return {
        snapshot: { generation: snapshotGeneration },
        dispose() {
          disposes += 1;
        },
      };
    });
    const port = await api.listen();
    cleanup.push(() => api.close());

    const client = clientFor(port, oldGrant.token);
    const snapshots: unknown[] = [];
    const subscription = await client.subscribe("system.health.subscribe", {}, (payload, kind) => {
      if (kind === "snapshot") snapshots.push(payload);
    });
    expect(subscription.snapshot).toEqual({ generation: 1 });
    expect(await client.request("system.health")).toEqual({ scopes: ["doc.read"] });

    snapshotGeneration = 2;
    tokens.revoke(oldGrant.tokenId);
    client.rotateCredential(newGrant.token);

    await until(() => client.status === "ready" && snapshots.length === 1);
    expect(client.grantedScopes).toEqual(["doc.write"]);
    expect(await client.request("system.health")).toEqual({ scopes: ["doc.write"] });
    expect(snapshots).toEqual([{ generation: 2 }]);
    expect(attaches).toBe(2);
    expect(disposes).toBe(1);

    subscription.unsubscribe();
    await until(() => disposes === 2);
  });

  it("keeps an established subscription across a second rotation while replay is pending", async () => {
    const tokens = new TokenService();
    const first = tokens.mint([], "first");
    const second = tokens.mint([], "second");
    const third = tokens.mint([], "third");
    const api = new ProductApi({ port: 0, tokens });
    let attaches = 0;
    let generation = 1;
    let releaseReplay: (() => void) | undefined;
    const replayGate = new Promise<void>((resolve) => {
      releaseReplay = resolve;
    });
    api.registerSubscription("system.health.subscribe", async () => {
      attaches += 1;
      const mine = generation;
      if (attaches === 2) await replayGate;
      return { snapshot: { generation: mine }, dispose() {} };
    });
    const port = await api.listen();
    cleanup.push(() => api.close());
    const client = clientFor(port, first.token);
    const snapshots: unknown[] = [];
    const subscription = await client.subscribe("system.health.subscribe", {}, (payload, kind) => {
      if (kind === "snapshot") snapshots.push(payload);
    });

    generation = 2;
    client.rotateCredential(second.token);
    await until(() => attaches === 2);
    generation = 3;
    client.rotateCredential(third.token);
    releaseReplay?.();
    await until(() => client.status === "ready" && snapshots.length === 1);

    expect(snapshots).toEqual([{ generation: 3 }]);
    expect(attaches).toBe(3);
    subscription.unsubscribe();
  });

  it("recovers the same client after the old credential reached terminal UNAUTHORIZED", async () => {
    const tokens = new TokenService();
    const oldGrant = tokens.mint([], "old", { pluginId: "com.example.notes" });
    const newGrant = tokens.mint(["doc.read"], "new", { pluginId: "com.example.notes" });
    const api = new ProductApi({ port: 0, tokens });
    api.register("system.health", () => ({ ok: true }));
    const port = await api.listen();
    cleanup.push(() => api.close());

    const client = clientFor(port, oldGrant.token);
    await client.ready();
    tokens.revoke(oldGrant.tokenId);
    api.dropConnections();
    await until(() => client.status === "failed");
    expect(client.lastError?.kind).toBe("UNAUTHORIZED");

    client.rotateCredential(newGrant.token);
    await client.ready();
    expect(client.status).toBe("ready");
    expect(client.lastError).toBeNull();
    expect(await client.request("system.health")).toEqual({ ok: true });
  });

  it("does not reopen a client its owner already closed", async () => {
    const tokens = new TokenService();
    const first = tokens.mint([], "first");
    const second = tokens.mint([], "second");
    const api = new ProductApi({ port: 0, tokens });
    const port = await api.listen();
    cleanup.push(() => api.close());
    const client = new FielddClient({ url: `ws://127.0.0.1:${port}`, token: first.token });
    await client.ready();
    client.close();

    client.rotateCredential(second.token);
    await delay(30);
    expect(client.status).toBe("closed");
    await expect(client.ready()).rejects.toMatchObject({ kind: "UNAVAILABLE" });
  });
});
