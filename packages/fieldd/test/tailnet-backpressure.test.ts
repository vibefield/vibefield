import { MESH_CONTROL_LIMITS, PRODUCT_API_LIMITS } from "@vibefield/contracts";
import { describe, expect, it, vi } from "vitest";
import { ProductApi, type SubscriptionHandler } from "../src/product-api";

/**
 * PG-1c — a phone's queue on the door (`PRODUCT_API_LIMITS.TAILNET_QUEUED_BYTES`).
 *
 * A `tailnet` principal's subscription whose producer can resync is sent no
 * more deltas once the connection's queue reaches the cap, and ONE fresh
 * snapshot when the queue drains to half of it. Snapshots are never held.
 * Every other caller, and every subscription without a resync, keeps the
 * 128 MiB shed. A subscription's own snapshots (its open, each resync) never
 * count toward holding it while they are queued. Driven through the door's
 * own install (`execute`, its open answered through `sendBounded` as the door
 * answers it) on a socket whose `bufferedAmount` the test sets, and whose
 * writes complete when the test says (each write's callback is the door's
 * drain check).
 */

const CAP = PRODUCT_API_LIMITS.TAILNET_QUEUED_BYTES;
const SHED = MESH_CONTROL_LIMITS.PRODUCT_QUEUED_BYTES;
const METHOD = "agent.subscribe";

const PHONE = {
  principal: { kind: "tailnet", login: "james@example.com", self: true },
  transport: "ws-tailnet",
  receivedAt: 0,
};
const PEER = {
  principal: { kind: "peer-fieldd", deviceId: "dev-b" },
  transport: "ws-tailnet",
  receivedAt: 0,
};
const WINDOW = {
  principal: { kind: "local-token", tokenId: "tk_window", scopes: [] },
  transport: "ws-loopback",
  receivedAt: 0,
};

type Frame = { method?: string; params?: { subId: string; payload: unknown } };

/** A socket the test drives: its queue, its sent frames and their bytes, and its pending writes. */
function socket() {
  const sent: Frame[] = [];
  const sizes: number[] = [];
  const pending: Array<(error?: Error) => void> = [];
  const ws = {
    readyState: 1,
    bufferedAmount: 0,
    close: vi.fn(),
    terminate: vi.fn(),
    send: vi.fn((data: string, cb: (error?: Error) => void) => {
      sent.push(JSON.parse(data) as Frame);
      sizes.push(Buffer.byteLength(data, "utf8"));
      pending.push(cb);
    }),
  };
  /** the oldest pending write lands, with the queue at `queued` */
  const land = (queued: number): void => {
    ws.bufferedAmount = queued;
    pending.shift()?.();
  };
  const frames = (kind: "delta" | "snapshot") =>
    sent.filter((frame) => frame.method === `agent.${kind}`).map((frame) => frame.params?.payload);
  const revisions = (kind: "delta" | "snapshot") =>
    frames(kind).map((payload) => (payload as { revision: number }).revision);
  return { ws, sent, sizes, pending, land, frames, revisions };
}

/** A producer the test drives: its emit, and how often the door asked it to resync.
 * `pad` makes its open or its resync's snapshot that many bytes larger. */
function producer(withResync: boolean, pad: { open?: number; resync?: number } = {}) {
  const p = {
    emit: null as ((payload: unknown, kind?: "delta" | "snapshot") => void) | null,
    resyncs: 0,
    disposed: 0,
    revision: 1,
  };
  const padded = (revision: number, bytes: number | undefined) =>
    bytes === undefined ? { revision } : { revision, pad: "x".repeat(bytes) };
  const handler: SubscriptionHandler = (_ctx, _params, emit) => {
    p.emit = emit;
    return {
      snapshot: padded(p.revision, pad.open),
      dispose: () => {
        p.disposed += 1;
      },
      ...(withResync
        ? {
            resync: () => {
              p.resyncs += 1;
              emit(padded(p.revision, pad.resync), "snapshot");
            },
          }
        : {}),
    };
  };
  /** the producer moves one revision and emits its delta */
  const delta = (): void => {
    p.revision += 1;
    p.emit?.({ since: p.revision - 1, revision: p.revision });
  };
  return { p, handler, delta };
}

/** Subscribe through the door's install; the open is answered as the door answers it. */
async function subscribe(
  ctx: unknown,
  handler: SubscriptionHandler,
  s: ReturnType<typeof socket>,
): Promise<{ state: { subs: Map<string, () => void> }; subId: string }> {
  const api = new ProductApi({ port: 0, tokens: { verify: () => null } });
  const internals = api as unknown as {
    execute(
      ws: unknown,
      state: unknown,
      id: number,
      method: string,
      params: unknown,
      handler: undefined,
      subHandler: SubscriptionHandler,
      reply: (value: unknown, track?: unknown) => void,
    ): Promise<void>;
    sendBounded(ws: unknown, value: unknown, track?: unknown): boolean;
  };
  const state = { ctx, subs: new Map<string, () => void>() };
  let subId = "";
  await internals.execute(s.ws, state, 1, METHOD, {}, undefined, handler, (answer, track) => {
    subId = (answer as { result: { subId: string } }).result.subId;
    internals.sendBounded(s.ws, answer, track);
  });
  return { state, subId };
}

describe("PG-1c — a phone behind the door's cap gets the board as it is, not the backlog", () => {
  it("misses deltas past the cap, is never shed, and gets ONE snapshot when its queue drains to half", async () => {
    const s = socket();
    const { p, handler, delta } = producer(true);
    await subscribe(PHONE, handler, s);
    s.land(0); // the open lands

    // three deltas go out: three writes pending
    delta();
    delta();
    delta();
    expect(s.pending).toHaveLength(3);

    // the queue reaches the cap: the next delta is held, and the phone is not shed
    s.ws.bufferedAmount = CAP;
    delta();
    expect(s.revisions("delta")).toEqual([2, 3, 4]);
    expect(s.ws.close).not.toHaveBeenCalled();

    // a write lands above half: still held, and the hold sticks (a delta past
    // a missing one would break the phone's chain)
    s.land(CAP * 0.75);
    delta();
    expect(p.resyncs).toBe(0);
    expect(s.revisions("delta")).toEqual([2, 3, 4]);

    // a write lands at half: ONE snapshot, the board as it is now
    s.land(CAP / 2);
    expect(p.resyncs).toBe(1);
    expect(s.frames("snapshot")).toEqual([{ revision: 6 }]);

    // the chain goes on from the snapshot, and drains with nothing held ask nothing
    s.ws.bufferedAmount = 0;
    delta();
    expect(s.frames("delta")).toEqual([
      { since: 1, revision: 2 },
      { since: 2, revision: 3 },
      { since: 3, revision: 4 },
      { since: 6, revision: 7 },
    ]);
    while (s.pending.length > 0) s.land(0);
    expect(p.resyncs).toBe(1);
    expect(s.ws.close).not.toHaveBeenCalled();
    expect(s.ws.terminate).not.toHaveBeenCalled();
  });

  it("sends a snapshot while held, every page of it, so a paged run stays whole", async () => {
    const s = socket();
    const { p, handler, delta } = producer(true);
    await subscribe(PHONE, handler, s);
    s.land(0);
    s.ws.bufferedAmount = CAP;
    delta();
    p.emit?.({ page: 1, more: true }, "snapshot");
    p.emit?.({ page: 2, more: true }, "snapshot");
    p.emit?.({ page: 3 }, "snapshot");
    expect(s.frames("snapshot")).toEqual([
      { page: 1, more: true },
      { page: 2, more: true },
      { page: 3 },
    ]);
    expect(s.frames("delta")).toEqual([]);
  });

  it("a board past the cap never holds itself: its resync's own bytes leave the deltas flowing", async () => {
    const s = socket();
    const { p, handler, delta } = producer(true, { resync: CAP });
    await subscribe(PHONE, handler, s);
    s.land(0);
    delta();
    s.ws.bufferedAmount = CAP;
    delta();
    s.land(CAP / 2);
    expect(p.resyncs).toBe(1);
    const snapshotBytes = s.sizes.at(-1) ?? 0;
    expect(snapshotBytes).toBeGreaterThan(CAP);
    // the queue is the snapshot alone: the next delta goes out behind it
    s.ws.bufferedAmount = snapshotBytes;
    delta();
    expect(s.revisions("delta")).toEqual([2, 4]);
    while (s.pending.length > 0) s.land(0);
    expect(p.resyncs).toBe(1);
    expect(s.revisions("snapshot")).toEqual([3]);
  });

  it("an open past the cap never holds the first deltas, and the hold still stands behind it", async () => {
    const s = socket();
    const { p, handler, delta } = producer(true, { open: CAP });
    await subscribe(PHONE, handler, s);
    const openBytes = s.sizes.at(-1) ?? 0;
    expect(openBytes).toBeGreaterThan(CAP);
    // the queue is the open alone: a delta goes out behind it
    s.ws.bufferedAmount = openBytes;
    delta();
    expect(s.revisions("delta")).toEqual([2]);
    // what queues behind the open reaches the cap: held
    s.ws.bufferedAmount = openBytes + CAP;
    delta();
    expect(s.revisions("delta")).toEqual([2]);
    // the open lands and the queue is at half: ONE snapshot
    s.land(CAP / 2);
    expect(p.resyncs).toBe(1);
    expect(s.revisions("snapshot")).toEqual([3]);
  });

  it("holds again when what queues BEHIND its snapshot passes the cap, and resyncs at the next drain", async () => {
    const s = socket();
    const { p, handler, delta } = producer(true);
    await subscribe(PHONE, handler, s);
    s.land(0);
    delta();
    s.ws.bufferedAmount = CAP;
    delta();
    s.land(CAP / 2);
    expect(p.resyncs).toBe(1);
    // past the cap beyond the snapshot's own bytes: held again
    s.ws.bufferedAmount = CAP + (s.sizes.at(-1) ?? 0);
    delta();
    expect(s.revisions("delta")).toEqual([2]);
    // the snapshot's write lands, the queue empty: resync again
    s.land(0);
    expect(p.resyncs).toBe(2);
    expect(s.revisions("snapshot")).toEqual([3, 4]);
  });

  it("asks nothing of a subscription that ended while it was held", async () => {
    const s = socket();
    const { p, handler, delta } = producer(true);
    const { state, subId } = await subscribe(PHONE, handler, s);
    s.land(0);
    delta();
    s.ws.bufferedAmount = CAP;
    delta();
    expect(s.revisions("delta"), "the second delta was held").toEqual([2]);
    state.subs.get(subId)?.();
    state.subs.delete(subId);
    s.land(0);
    expect(p.resyncs).toBe(0);
    expect(p.disposed).toBe(1);
    expect(s.ws.terminate).not.toHaveBeenCalled();
  });

  it("closes the connection when a producer cannot restate its value, so the redial opens fresh", async () => {
    const s = socket();
    let emit: ((payload: unknown) => void) | null = null;
    const handler: SubscriptionHandler = (_ctx, _params, e) => {
      emit = e;
      return {
        snapshot: { revision: 1 },
        dispose: () => undefined,
        resync: () => {
          throw new Error("no current value");
        },
      };
    };
    await subscribe(PHONE, handler, s);
    s.land(0);
    const send = (payload: unknown): void =>
      (emit as ((payload: unknown) => void) | null)?.(payload);
    send({ since: 1, revision: 2 });
    s.ws.bufferedAmount = CAP;
    send({ since: 2, revision: 3 });
    s.land(0);
    expect(s.ws.terminate).toHaveBeenCalledOnce();
  });
});

describe("PG-1c — every other caller keeps the 128 MiB shed", () => {
  it("a window on loopback queues past the phone's cap and is shed at 128 MiB, resync or not", async () => {
    const s = socket();
    const { p, handler, delta } = producer(true);
    await subscribe(WINDOW, handler, s);
    s.ws.bufferedAmount = CAP;
    delta();
    expect(s.revisions("delta")).toEqual([2]);
    while (s.pending.length > 0) s.land(0);
    expect(p.resyncs).toBe(0);
    s.ws.bufferedAmount = SHED;
    delta();
    expect(s.ws.close).toHaveBeenCalledWith(1013, "client is not keeping up");
  });

  it("a phone's subscription with no resync queues past the cap and is shed at 128 MiB", async () => {
    const s = socket();
    const { handler, delta } = producer(false);
    await subscribe(PHONE, handler, s);
    s.ws.bufferedAmount = CAP;
    delta();
    expect(s.revisions("delta")).toEqual([2]);
    s.ws.bufferedAmount = SHED;
    delta();
    expect(s.ws.close).toHaveBeenCalledWith(1013, "client is not keeping up");
  });

  it("a peer daemon on the same tailnet door keeps its deltas (its heartbeats ride them)", async () => {
    const s = socket();
    const { p, handler, delta } = producer(true);
    await subscribe(PEER, handler, s);
    s.ws.bufferedAmount = CAP;
    delta();
    delta();
    expect(s.revisions("delta")).toEqual([2, 3]);
    while (s.pending.length > 0) s.land(0);
    expect(p.resyncs).toBe(0);
  });
});
