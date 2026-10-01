// SP-1 / SP-L7 — the door's keepalive as FielddClient takes it. The door sends
// `system.tick {at, intervalMs}` on every hello'd connection (fieldd
// `door-tick.test.ts`); a client that wants it says `onTick`, and a client that
// does not — or a notification nobody here knows — is the tolerant reader's:
// nothing logged, nothing thrown, routing undisturbed.
import { CONTRACTS_VERSION, PRODUCT_NOTIFICATIONS } from "@vibefield/contracts";
import { ProductApi } from "@vibefield/fieldd";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FielddClient, type WsLike } from "../src/client";

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
  cleanup = [];
  vi.restoreAllMocks();
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(fn: () => boolean, ms = 4_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > deadline) throw new Error("until: condition timeout");
    await sleep(10);
  }
}

/** A door that answers hello and lets the test speak any frame at the client. */
class FakeDoor implements WsLike {
  static last: FakeDoor | null = null;
  readyState = 0;
  readonly sent: Array<Record<string, unknown>> = [];
  readonly #listeners = new Map<string, Set<(ev: unknown) => void>>();

  constructor(readonly url: string) {
    FakeDoor.last = this;
    queueMicrotask(() => {
      this.readyState = 1;
      this.#dispatch("open", {});
    });
  }

  addEventListener(type: "open" | "message" | "close" | "error", fn: (ev: unknown) => void): void {
    let set = this.#listeners.get(type);
    if (set === undefined) {
      set = new Set();
      this.#listeners.set(type, set);
    }
    set.add(fn);
  }

  send(data: string): void {
    const frame = JSON.parse(data) as Record<string, unknown>;
    this.sent.push(frame);
    const id = frame["id"];
    if (frame["method"] === "system.hello")
      queueMicrotask(() =>
        this.speak({
          jsonrpc: "2.0",
          id,
          result: { contractsVersion: CONTRACTS_VERSION, serverKind: "fieldd", grantedScopes: [] },
        }),
      );
    else if (frame["method"] === "system.health")
      queueMicrotask(() => this.speak({ jsonrpc: "2.0", id, result: { ok: true } }));
  }

  close(): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.#dispatch("close", {});
  }

  speak(frame: unknown): void {
    this.#dispatch("message", { data: JSON.stringify(frame) });
  }

  #dispatch(type: string, ev: unknown): void {
    for (const fn of [...(this.#listeners.get(type) ?? [])]) fn(ev);
  }
}

function clientOver(opts: { onTick?: (tick: { at: number; intervalMs: number }) => void }) {
  const client = new FielddClient({
    url: "ws://fake.door",
    token: "tk",
    webSocket: FakeDoor,
    ...(opts.onTick !== undefined ? { onTick: opts.onTick } : {}),
  });
  cleanup.push(() => client.close());
  return client;
}

const tick = (at: number, intervalMs = 120_000) => ({
  jsonrpc: "2.0",
  method: PRODUCT_NOTIFICATIONS.TICK,
  params: { at, intervalMs },
});

describe("FielddClient and system.tick (SP-L7)", () => {
  it("hands each tick to onTick as {at, intervalMs}", async () => {
    const ticks: Array<{ at: number; intervalMs: number }> = [];
    const client = clientOver({ onTick: (t) => ticks.push(t) });
    await client.ready();
    FakeDoor.last?.speak(tick(1_000));
    FakeDoor.last?.speak(tick(121_000, 120_000));
    expect(ticks).toEqual([
      { at: 1_000, intervalMs: 120_000 },
      { at: 121_000, intervalMs: 120_000 },
    ]);
  });

  it("takes an unknown notification, a malformed tick, and a tick with no onTick QUIETLY", async () => {
    const warn = vi.spyOn(console, "warn");
    const error = vi.spyOn(console, "error");
    const log = vi.spyOn(console, "log");
    const ticks: unknown[] = [];
    const client = clientOver({ onTick: (t) => ticks.push(t) });
    await client.ready();
    const door = FakeDoor.last;
    expect(() => {
      door?.speak({ jsonrpc: "2.0", method: "x.some.future.note", params: { anything: 1 } });
      door?.speak({ jsonrpc: "2.0", method: PRODUCT_NOTIFICATIONS.TICK, params: { at: "now" } });
      door?.speak({ jsonrpc: "2.0", method: PRODUCT_NOTIFICATIONS.TICK });
    }).not.toThrow();
    // a malformed tick is not a tick: the reader times by what it can read
    expect(ticks).toEqual([]);
    // and the client goes on: a call still routes
    await expect(client.request("system.health")).resolves.toEqual({ ok: true });
    expect(client.status).toBe("ready");

    const plain = clientOver({});
    await plain.ready();
    expect(() => FakeDoor.last?.speak(tick(5))).not.toThrow();
    await expect(plain.request("system.health")).resolves.toEqual({ ok: true });
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it("an onTick that throws breaks nothing", async () => {
    const client = clientOver({
      onTick: () => {
        throw new Error("a consumer's bug");
      },
    });
    await client.ready();
    expect(() => FakeDoor.last?.speak(tick(9))).not.toThrow();
    await expect(client.request("system.health")).resolves.toEqual({ ok: true });
  });

  it("over a real door: two ticks at the door's interval reach onTick", async () => {
    const api = new ProductApi({
      port: 0,
      tokens: {
        verify: (token) =>
          token === "tk-window" ? { tokenId: "tk-window", scopes: [], label: "window" } : null,
      },
      tickIntervalMs: 40,
    });
    const port = await api.listen();
    cleanup.push(() => api.close());
    const ticks: Array<{ at: number; intervalMs: number }> = [];
    const client = new FielddClient({
      url: `ws://127.0.0.1:${port}`,
      token: "tk-window",
      onTick: (t) => ticks.push(t),
    });
    cleanup.push(() => client.close());
    await client.ready();
    await until(() => ticks.length >= 2, 4_000);
    expect(ticks.every((t) => t.intervalMs === 40 && Number.isSafeInteger(t.at))).toBe(true);
    client.close();
    await until(() => api.liveTicks() === 0, 4_000);
  });
});
