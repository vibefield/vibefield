// DS-D15's client half (DS wave 2, w2-readers, 2026-10-01): a window's keyed
// forwarded mutation. The window's own daemon is a REAL product door
// (ProductApi — its envelope block judges the key a window may carry); its
// forwarder plays the peer link and the owner, whose journal is fieldd's REAL
// OwnerForwardJournal. What is pinned is the client's half: ONE key per
// logical call, minted only for a keyed forward routed by `device`; an
// outcome-unknown (the owner's answer lost, or this client's own socket cut
// after the request left) hands the caller that key; the retry echoing it
// applies once and reads the journaled answer.
import { KEYED_FORWARD_METHODS } from "@vibefield/contracts";
import {
  forwardDigest,
  OwnerForwardJournal,
  ProductApi,
  RpcCallError,
  TokenService,
} from "@vibefield/fieldd";
import { afterEach, describe, expect, it } from "vitest";
import {
  FielddClient,
  FielddRpcError,
  forwardReceiptOf,
  type WsCtor,
  type WsLike,
} from "../src/client";

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
  cleanup = [];
});

const SPAWN = { device: "dev-b", provider: "claude-code", cwd: "/work/app" };

/** The window's daemon (A) on a real door; the owner (B) behind its forwarder. */
async function desktops(opts: { resultBytes?: number } = {}) {
  const tokens = new TokenService();
  const grant = tokens.mint(["agent.spawn"], "window");
  const api = new ProductApi({ port: 0, tokens });
  const servedHere: unknown[] = [];
  api.register("agent.spawn", (_ctx, params) => {
    servedHere.push(params);
    return { runtimeRunId: "run-here" };
  });
  const journal = new OwnerForwardJournal({
    device: () => "dev-b",
    ...(opts.resultBytes !== undefined ? { resultBytes: opts.resultBytes } : {}),
  });
  const keys: Array<string | undefined> = [];
  let applied = 0;
  /** how the next forward ends after the owner ran it */
  let next: "answer" | "lose-answer" | "cut-window" = "answer";
  api.setDeviceRouting(
    () => "dev-a",
    async (device, method, params, _ctx, envelope) => {
      const key = envelope?.idempotencyKey;
      keys.push(key);
      if (key === undefined) throw new Error("a forwarded mutation must carry a key");
      const result = await journal.run(
        { peer: "dev-a", key, method, digest: forwardDigest(params) },
        async () => {
          applied += 1;
          return { runtimeRunId: `run-${applied}`, note: "x".repeat(200) };
        },
      );
      const how = next;
      next = "answer";
      if (how === "lose-answer") {
        // PeerLink's own words when the owner's answer was lost in flight
        throw new RpcCallError(
          "UNAVAILABLE",
          "the forward was cut before an answer; its outcome is unknown",
          true,
          { service: "peer-link", device, state: "outcome-unknown", idempotencyKey: key },
        );
      }
      if (how === "cut-window") api.dropConnections(); // the window's socket dies first
      return result;
    },
  );
  const port = await api.listen();
  cleanup.push(() => api.close());
  const client = new FielddClient({
    url: `ws://127.0.0.1:${port}`,
    token: grant.token,
    maxBackoffMs: 50,
  });
  cleanup.push(() => client.close());
  return {
    client,
    keys,
    servedHere,
    applied: () => applied,
    loseNextAnswer: () => {
      next = "lose-answer";
    },
    cutWindowNext: () => {
      next = "cut-window";
    },
  };
}

async function failure(promise: Promise<unknown>): Promise<FielddRpcError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof FielddRpcError) return error;
    throw error;
  }
  throw new Error("expected the call to fail");
}

describe("FielddClient — the client half of DS-D15", () => {
  it("the keyed set is the door's rule over the registry: the routable mutations, never a read or a subscription", () => {
    expect([...KEYED_FORWARD_METHODS].sort()).toEqual(
      expect.arrayContaining([
        "agent.interrupt",
        "agent.resume",
        "agent.spawn",
        "terminal.openTicket",
      ]),
    );
    for (const read of ["terminal.renewAttach", "index.search", "agent.list", "agent.subscribe"]) {
      expect(KEYED_FORWARD_METHODS.has(read)).toBe(false);
    }
  });

  it("an owner's answer lost in flight reads outcome-unknown WITH the call's key; the retry echoing it applies once and answers the journaled result", async () => {
    const world = await desktops();
    world.loseNextAnswer();
    const lost = await failure(world.client.request("agent.spawn", SPAWN));
    expect(lost).toMatchObject({ kind: "UNAVAILABLE", retryable: true });
    expect(lost.details).toMatchObject({ state: "outcome-unknown" });
    const key = lost.forward?.idempotencyKey;
    expect(key).toEqual(expect.any(String));
    expect(world.keys).toEqual([key]); // the key the window minted is the one the owner journaled
    expect(world.applied()).toBe(1); // it DID apply — the answer is what was lost

    const retried = await world.client.request("agent.spawn", SPAWN, { idempotencyKey: key });
    expect(retried).toMatchObject({ runtimeRunId: "run-1" });
    expect(world.applied()).toBe(1); // once
    expect(world.keys).toEqual([key, key]);

    // a NEW logical call is a new key, and applies
    expect(await world.client.request("agent.spawn", SPAWN)).toMatchObject({
      runtimeRunId: "run-2",
    });
    expect(world.keys).toHaveLength(3);
    expect(world.keys[2]).not.toBe(key);
    expect(world.servedHere).toEqual([]); // nothing routed elsewhere ran here
  });

  it("this client's own socket cut AFTER the request left is outcome-unknown too — the retry over the new socket applies once", async () => {
    const world = await desktops();
    world.cutWindowNext();
    const cut = await failure(world.client.request("agent.spawn", SPAWN));
    expect(cut).toMatchObject({ kind: "UNAVAILABLE", retryable: true });
    expect(cut.details).toMatchObject({ state: "outcome-unknown" });
    const key = cut.forward?.idempotencyKey;
    expect(key).toBe(world.keys[0]);
    expect(world.applied()).toBe(1);

    const retried = await world.client.request("agent.spawn", SPAWN, { idempotencyKey: key });
    expect(retried).toMatchObject({ runtimeRunId: "run-1" });
    expect(world.applied()).toBe(1);
  });

  it("a retry whose original answer was too large to journal reads the RECEIPT in its place — applied, the answer gone", async () => {
    const world = await desktops({ resultBytes: 64 });
    world.loseNextAnswer();
    const lost = await failure(world.client.request("agent.spawn", SPAWN));
    const key = lost.forward?.idempotencyKey;
    const answer = await world.client.request("agent.spawn", SPAWN, { idempotencyKey: key });
    expect(forwardReceiptOf(answer, key)).toMatchObject({
      idempotencyKey: key,
      method: "agent.spawn",
      device: "dev-b",
      state: "applied",
      resultOmitted: true,
    });
    expect(forwardReceiptOf({ runtimeRunId: "run-1" }, key)).toBeUndefined();
    expect(world.applied()).toBe(1);
  });
});

/** A socket that answers hello and records every other frame, answering each
 * with an empty result — the client's own rules, with no daemon behind them. */
function recordingSocket(sent: Array<{ method: string; params: unknown }>, ack: object = {}) {
  class Recording implements WsLike {
    readyState = 0;
    readonly #listeners = new Map<string, Array<(ev: unknown) => void>>();
    constructor(_url: string) {
      setTimeout(() => {
        this.readyState = 1;
        this.#emit("open", {});
      }, 0);
    }
    addEventListener(type: string, fn: (ev: unknown) => void): void {
      this.#listeners.set(type, [...(this.#listeners.get(type) ?? []), fn]);
    }
    send(data: string): void {
      const frame = JSON.parse(data) as { id: number; method: string; params: unknown };
      const result =
        frame.method === "system.hello"
          ? { contractsVersion: "0.0.0", serverKind: "fieldd", grantedScopes: [], ...ack }
          : {};
      if (frame.method !== "system.hello")
        sent.push({ method: frame.method, params: frame.params });
      setTimeout(
        () =>
          this.#emit("message", { data: JSON.stringify({ jsonrpc: "2.0", id: frame.id, result }) }),
        0,
      );
    }
    close(): void {
      this.readyState = 3;
      this.#emit("close", {});
    }
    #emit(type: string, ev: unknown): void {
      for (const fn of this.#listeners.get(type) ?? []) fn(ev);
    }
  }
  return Recording as unknown as WsCtor;
}

describe("FielddClient — a call that is not a keyed forward carries no key (DS-D15)", () => {
  it("no device, this daemon's own device, a read, or params that already carry the envelope: sent exactly as given", async () => {
    const sent: Array<{ method: string; params: unknown }> = [];
    const client = new FielddClient({
      url: "ws://fake",
      token: "t",
      webSocket: recordingSocket(sent),
      selfDeviceId: () => "dev-a",
    });
    cleanup.push(() => client.close());
    const peerEnvelope = { device: "dev-b", forward: { idempotencyKey: "fk_peer_built_it" } };
    await client.request("agent.spawn", { provider: "claude-code" });
    await client.request("agent.spawn", { device: "dev-a", provider: "claude-code" });
    await client.request("index.search", { device: "dev-b", q: "needle" });
    await client.request("agent.spawn", peerEnvelope);
    expect(sent).toEqual([
      { method: "agent.spawn", params: { provider: "claude-code" } },
      { method: "agent.spawn", params: { device: "dev-a", provider: "claude-code" } },
      { method: "index.search", params: { device: "dev-b", q: "needle" } },
      { method: "agent.spawn", params: peerEnvelope },
    ]);
    // …and a keyed one carries ONE key under `forward`, its own params untouched
    await client.request("agent.spawn", { device: "dev-b", provider: "claude-code" });
    expect(sent.at(-1)).toEqual({
      method: "agent.spawn",
      params: {
        device: "dev-b",
        provider: "claude-code",
        forward: { idempotencyKey: expect.stringMatching(/^.{8,128}$/) },
      },
    });
  });

  it("the daemon's own device read from its hello, when it says it", async () => {
    const sent: Array<{ method: string; params: unknown }> = [];
    const client = new FielddClient({
      url: "ws://fake",
      token: "t",
      webSocket: recordingSocket(sent, { deviceId: "dev-a" }),
    });
    cleanup.push(() => client.close());
    await client.request("agent.spawn", { device: "dev-a", provider: "claude-code" });
    expect(sent).toEqual([
      { method: "agent.spawn", params: { device: "dev-a", provider: "claude-code" } },
    ]);
  });
});
