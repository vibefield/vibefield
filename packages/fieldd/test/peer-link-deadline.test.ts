// DS-2b (2026-10-01; the DS wave 1 review's DS-2 list) — a call's deadline is
// the CALL's verdict, never the shared link's. PeerLink used to drop the whole
// link when any one call timed out, on the theory that a stale socket was the
// usual suspect, so one slow call cut every sibling: a keyed forward in flight
// beside it read outcome-unknown, and every standing subscription heard onDrop.
// Now the timed-out call alone fails (outcome-unknown when it was a keyed
// forward that left), and the LINK is judged by its transport: a live socket is
// asked for a no-op round trip, and only a probe that goes unanswered too drops
// it — the stale socket the old drop was for is still caught.
//
// A REAL PeerLink against a scripted door (scripted-door.ts): the door holds
// what the row tells it to, and answers the rest.
import type { WsCtor } from "@vibefield/fieldd-client";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { RpcCallError } from "../src/native-link";
import { PeerLink } from "../src/peer-link";
import { answer, scriptedDoor } from "./scripted-door";
import { until } from "./ws-rpc";

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
  cleanup = [];
});

async function door(...args: Parameters<typeof scriptedDoor>) {
  const opened = await scriptedDoor(...args);
  cleanup.push(() => opened.close());
  return opened;
}

/** A plain dial that counts its sockets (one link = one socket). */
function counting(): { ctor: WsCtor; dials: () => number } {
  let count = 0;
  class Counted extends WebSocket {
    constructor(url: string) {
      super(url);
      count += 1;
    }
  }
  return { ctor: Counted, dials: () => count };
}

function linkTo(
  url: string,
  ctor: WsCtor,
  opts: { callTimeoutMs: number; forwardTimeoutMs?: number },
): PeerLink {
  const link = new PeerLink({
    ownDeviceId: () => "dev-a",
    endpointFor: () => url,
    webSocket: ctor,
    callTimeoutMs: opts.callTimeoutMs,
    ...(opts.forwardTimeoutMs !== undefined ? { forwardTimeoutMs: opts.forwardTimeoutMs } : {}),
  });
  cleanup.push(() => link.dispose());
  return link;
}

const delta = (subId: string, payload: unknown) =>
  JSON.stringify({ jsonrpc: "2.0", method: "device.delta", params: { subId, payload } });

const runOf = (params: Record<string, unknown> | undefined): unknown => params?.["runtimeRunId"];

describe("a call's deadline is the call's, never the shared link's (DS-2b)", () => {
  it("two keyed forwards in flight: one times out as outcome-unknown, the other still answers; the standing subscription and the socket survive", async () => {
    let probed = 0;
    let heldFast: number | undefined;
    const d = await door((msg, ws) => {
      if (msg.method === "device.subscribe") {
        answer(ws, msg.id, { subId: "s-1", snapshot: { n: 0 } });
        return;
      }
      if (msg.method === "system.unsubscribe") {
        // the liveness probe: only a deadline sends one, so what follows it is
        // ordered AFTER the slow forward's deadline whatever the host's load
        probed += 1;
        answer(ws, msg.id, { removed: false });
        if (heldFast !== undefined) answer(ws, heldFast, { accepted: true });
        heldFast = undefined;
        ws.send(delta("s-1", { n: 1 })); // and the standing subscription still flows
        return;
      }
      if (
        msg.method === "agent.interrupt" &&
        runOf(msg.params as Record<string, unknown>) === "run-fast"
      ) {
        // answered once the slow forward's deadline has passed: now, if it has
        if (probed > 0) answer(ws, msg.id, { accepted: true });
        else heldFast = msg.id;
      }
      // run-slow is never answered
    });
    const { ctor, dials } = counting();
    const link = linkTo(d.url, ctor, { callTimeoutMs: 4_000, forwardTimeoutMs: 2_000 });

    const events: unknown[] = [];
    let drops = 0;
    const sub = await link.subscribe(
      "dev-b",
      "device.subscribe",
      {},
      (payload) => events.push(payload),
      () => {
        drops += 1;
      },
    );
    expect(sub.snapshot).toEqual({ n: 0 });

    const slow = link
      .request(
        "dev-b",
        "agent.interrupt",
        { runtimeRunId: "run-slow" },
        { idempotencyKey: "fk_slow_key_0001" },
      )
      .catch((e: unknown) => e);
    // the fast one leaves well inside the slow one's deadline, so both are in
    // flight on the one link when that deadline passes
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    const fast = link
      .request(
        "dev-b",
        "agent.interrupt",
        { runtimeRunId: "run-fast" },
        { idempotencyKey: "fk_fast_key_0001" },
      )
      .catch((e: unknown) => e);

    const cut = await slow;
    expect(cut).toBeInstanceOf(RpcCallError);
    expect(cut).toMatchObject({
      kind: "UNAVAILABLE",
      retryable: true,
      details: {
        service: "peer-link",
        device: "dev-b",
        state: "outcome-unknown",
        idempotencyKey: "fk_slow_key_0001",
      },
    });
    // the sibling is answered on the same link — not cut to an outcome-unknown
    expect(await fast).toEqual({ accepted: true });
    expect(link.receipts.get("fk_slow_key_0001")?.state).toBe("outcome-unknown");
    expect(link.receipts.get("fk_fast_key_0001")?.state).toBe("applied");

    // the subscription standing on the link was never dropped, and still flows
    await until(() => events.some((p) => (p as { n?: number }).n === 1), 4_000);
    expect(drops).toBe(0);
    expect(probed).toBe(1); // the deadline asked the transport, once
    expect(link.linkState("dev-b")).toBe("connected");
    expect(link.doorState("dev-b")).toBe("answers");
    expect(dials()).toBe(1); // one socket throughout
    sub.unsubscribe();
  }, 20_000);

  it("a live socket whose door answers nothing — not even the probe — is dead: the link drops, its members hear it, the door is silent, the next call re-dials", async () => {
    let mute = false;
    const d = await door((msg, ws) => {
      if (mute) return; // half-open: frames go in, nothing comes back
      if (msg.method === "device.subscribe") answer(ws, msg.id, { subId: "s-1", snapshot: {} });
      else answer(ws, msg.id, { devices: [] });
    });
    const { ctor, dials } = counting();
    const link = linkTo(d.url, ctor, { callTimeoutMs: 600 });
    let drops = 0;
    await link.subscribe(
      "dev-b",
      "device.subscribe",
      {},
      () => {},
      () => {
        drops += 1;
      },
    );

    mute = true;
    await expect(link.request("dev-b", "device.list", {})).rejects.toMatchObject({
      kind: "UNAVAILABLE",
      details: { service: "peer-link", device: "dev-b", state: "unreachable" },
    });
    // the transport was asked, and its silence is the verdict
    await until(() => drops === 1, 4_000);
    expect(d.seen.filter((s) => s.method === "system.unsubscribe")).toHaveLength(1);
    expect(link.linkState("dev-b")).toBeUndefined();
    expect(link.doorState("dev-b")).toBe("silent");

    mute = false;
    await expect(link.request("dev-b", "device.list", {})).resolves.toEqual({ devices: [] });
    expect(dials()).toBe(2); // a fresh socket
    expect(link.doorState("dev-b")).toBe("answers");
  }, 20_000);

  it("a subscribe the deadline gave up on is released when its late answer lands — never left standing for an owner told it failed", async () => {
    const d = await door((msg, ws) => {
      if (msg.method === "device.subscribe") {
        // answered after the caller's deadline, a frame right behind it
        setTimeout(() => {
          answer(ws, msg.id, { subId: "s-late", snapshot: { n: 0 } });
          ws.send(delta("s-late", { n: 1 }));
        }, 900);
        return;
      }
      answer(ws, msg.id, { removed: false }); // a warm-up, the probe, the release
    });
    const { ctor } = counting();
    const link = linkTo(d.url, ctor, { callTimeoutMs: 400 });
    // the link is READY first, so the deadline measures the answer, not the dial
    await link.request("dev-b", "device.list", {});

    const events: unknown[] = [];
    let drops = 0;
    const failed = await link
      .subscribe(
        "dev-b",
        "device.subscribe",
        {},
        (payload) => events.push(payload),
        () => {
          drops += 1;
        },
      )
      .catch((e: unknown) => e);
    expect(failed).toMatchObject({ kind: "UNAVAILABLE", details: { state: "unreachable" } });

    // the late answer lands on the live link and is let go at once
    await until(
      () =>
        d.seen.some(
          (s) =>
            s.method === "system.unsubscribe" &&
            (s.params as { subId?: unknown } | undefined)?.subId === "s-late",
        ),
      4_000,
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(events).toEqual([]); // the owner told it failed hears none of its frames
    expect(drops).toBe(0);
    expect(link.linkState("dev-b")).toBe("connected");
  }, 20_000);
});
