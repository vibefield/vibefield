// SP-1 / SP-L7 (`thinking-sync-planes.md` §1.9 item 1) — the door's keepalive.
// truffle's sidecar reaps a served WebSocket silent for ten minutes, and an idle
// board sends nothing by design, so a quiet phone's door used to die unseen and
// show up only as its next call's transport error. Every hello'd connection —
// loopback and tailnet alike — now hears `system.tick` on an interval: one
// timer per connection, gone with the connection.
import {
  CONTRACTS_VERSION,
  PRODUCT_API_LIMITS,
  PRODUCT_NOTIFICATIONS,
  SystemTick,
} from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { ProductApi } from "../src/product-api";

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
  cleanup = [];
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(fn: () => boolean, ms = 4_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > deadline) throw new Error("until: condition timeout");
    await sleep(10);
  }
}

const LOGIN = "me@example.com";
const SECRET = "route-secret-for-the-tick-rows";

function door(tickIntervalMs?: number): ProductApi {
  const api = new ProductApi({
    port: 0,
    tokens: {
      verify: (token) =>
        token === "tk-window" ? { tokenId: "tk-window", scopes: [], label: "window" } : null,
    },
    tailnetPathSecret: SECRET,
    getLinkedLogin: () => LOGIN,
    ...(tickIntervalMs !== undefined ? { tickIntervalMs } : {}),
  });
  cleanup.push(() => api.close());
  return api;
}

interface Dialed {
  ws: WebSocket;
  frames: Array<Record<string, unknown>>;
  ticks: () => Array<Record<string, unknown>>;
  hello: (credential?: string) => Promise<Record<string, unknown>>;
}

async function dial(port: number, opts: { path?: string; login?: string } = {}): Promise<Dialed> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}${opts.path ?? ""}`, {
    ...(opts.login !== undefined ? { headers: { "tailscale-user-login": opts.login } } : {}),
  });
  cleanup.push(() => ws.terminate());
  const frames: Array<Record<string, unknown>> = [];
  ws.on("message", (raw) => frames.push(JSON.parse(String(raw)) as Record<string, unknown>));
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  let nextId = 1;
  return {
    ws,
    frames,
    ticks: () => frames.filter((frame) => frame["method"] === PRODUCT_NOTIFICATIONS.TICK),
    hello: async (credential?: string) => {
      const id = nextId++;
      ws.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id,
          method: "system.hello",
          params: {
            contractsVersion: CONTRACTS_VERSION,
            minCompatible: CONTRACTS_VERSION,
            clientKind: "renderer",
            ...(credential !== undefined ? { credential } : {}),
          },
        }),
      );
      await until(() => frames.some((frame) => frame["id"] === id));
      return frames.find((frame) => frame["id"] === id) as Record<string, unknown>;
    },
  };
}

describe("system.tick — the door's keepalive (SP-L7)", () => {
  it("a loopback connection hears it once hello'd: no id, {at, intervalMs}, one timer, gone with the socket", async () => {
    const api = door(50);
    const port = await api.listen();
    const client = await dial(port);

    // not before the hello: an unauthenticated socket is told nothing
    await sleep(200);
    expect(client.ticks()).toEqual([]);
    expect(api.liveTicks()).toBe(0);

    const ack = await client.hello("tk-window");
    expect(ack["result"]).toBeDefined();
    const before = Date.now();
    await until(() => client.ticks().length >= 2, 4_000);
    for (const tick of client.ticks()) {
      expect(tick).toEqual({
        jsonrpc: "2.0",
        method: "system.tick",
        params: { at: expect.any(Number), intervalMs: 50 },
      });
      expect("id" in tick).toBe(false);
      const params = SystemTick.parse(tick["params"]);
      expect(params.at).toBeGreaterThanOrEqual(before - 1_000);
      expect(params.at).toBeLessThanOrEqual(Date.now());
    }
    expect(api.liveTicks()).toBe(1);

    // a second hello on the same socket does not buy a second timer
    await client.hello("tk-window");
    expect(api.liveTicks()).toBe(1);

    client.ws.close();
    await until(() => api.liveTicks() === 0, 4_000);
    const heard = client.ticks().length;
    await sleep(200);
    expect(client.ticks().length).toBe(heard);
  });

  it("a tailnet connection hears it too — the phone's door and a guest's alike", async () => {
    const api = door(50);
    const port = await api.listen();
    const phone = await dial(port, { path: `/t/${SECRET}`, login: LOGIN });
    const guest = await dial(port, { path: `/t/${SECRET}`, login: "someone@else.example" });
    expect(
      ((await phone.hello())["result"] as { grantedScopes: string[] }).grantedScopes,
    ).not.toEqual([]);
    expect(((await guest.hello())["result"] as { grantedScopes: string[] }).grantedScopes).toEqual(
      [],
    );
    await until(() => phone.ticks().length >= 1 && guest.ticks().length >= 1, 4_000);
    expect(api.liveTicks()).toBe(2);
    phone.ws.terminate();
    await until(() => api.liveTicks() === 1, 4_000);
    guest.ws.terminate();
    await until(() => api.liveTicks() === 0, 4_000);
  });

  it("a refused hello is told nothing, and a closed door keeps no timer", async () => {
    const api = door(50);
    const port = await api.listen();
    const refused = await dial(port);
    const answer = await refused.hello("not-a-token");
    expect(answer["error"]).toBeDefined();
    const kept = await dial(port);
    await kept.hello("tk-window");
    await until(() => kept.ticks().length >= 1, 4_000);
    expect(refused.ticks()).toEqual([]);
    expect(api.liveTicks()).toBe(1);
    api.close();
    await until(() => api.liveTicks() === 0, 4_000);
  });

  it("ticks at the registry's interval unless told otherwise", () => {
    expect(door().tickIntervalMs).toBe(PRODUCT_API_LIMITS.TICK_INTERVAL_MS);
    expect(door(75).tickIntervalMs).toBe(75);
  });
});
