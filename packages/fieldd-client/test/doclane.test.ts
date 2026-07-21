import {
  type DocOpenResult,
  decodeJsonPayload,
  decodeLaneFrame,
  encodeJsonFrame,
  encodeLaneFrame,
  LANE_FRAME,
  type LaneFrame,
} from "@vibefield/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FielddRpcError } from "../src/client";
import { DocLaneClient, type LaneWsLike } from "../src/doclane";

// DocLaneClient against a scripted in-memory socket — the client half of the
// :9411 protocol, deterministic (fake timers, no network). The server half +
// the real end-to-end run live in packages/fieldd/test and apps/desktop/test.

const DOC_ID = "1f0d7a2e-3c44-4b8a-9e51-6d2f8c0a7b19";

type Handler = (ws: FakeLaneWs, frame: LaneFrame) => void;

class FakeLaneWs implements LaneWsLike {
  static instances: FakeLaneWs[] = [];
  static handler: Handler = () => {};
  binaryType = "blob";
  readyState = 0;
  sent: LaneFrame[] = [];
  private listeners = new Map<string, Set<(ev: unknown) => void>>();

  constructor(public url: string) {
    FakeLaneWs.instances.push(this);
    queueMicrotask(() => {
      if (this.readyState === 0) {
        this.readyState = 1;
        this.fire("open", {});
      }
    });
  }

  addEventListener(type: string, fn: (ev: unknown) => void): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(fn);
  }

  send(data: Uint8Array): void {
    const frame = decodeLaneFrame(data);
    this.sent.push(frame);
    // Reply on a microtask — a real message event never lands inside the
    // sender's own sync block (the client installs its waiter right after send).
    queueMicrotask(() => FakeLaneWs.handler(this, frame));
  }

  receive(frame: Uint8Array): void {
    // Deliver as ArrayBuffer, the browser/undici binaryType="arraybuffer" shape.
    const buf = frame.buffer.slice(frame.byteOffset, frame.byteOffset + frame.byteLength);
    this.fire("message", { data: buf });
  }

  close(): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.fire("close", {});
  }

  /** Server-initiated drop (fieldd restart). */
  drop(): void {
    this.close();
  }

  private fire(type: string, ev: unknown): void {
    for (const fn of this.listeners.get(type) ?? []) fn(ev);
  }
}

interface MemoryDoc {
  bytes: Uint8Array | null;
  updates?: Uint8Array[];
  revisionId?: string;
}

/** The well-behaved server script: HELLO→HELLO_OK, GET→DOC+updates, PUT→PUT_OK. */
function happyServer(store: MemoryDoc): Handler {
  let pendingPut: {
    byteLength: number;
    revisionId: string;
    kind?: "checkpoint" | "update";
    baseRevisionId?: string;
  } | null = null;
  return (ws, frame) => {
    if (frame.kind === LANE_FRAME.HELLO) {
      ws.receive(
        encodeJsonFrame(LANE_FRAME.HELLO_OK, 0, {
          docId: DOC_ID,
          hasDoc: store.bytes !== null,
          ...(store.bytes !== null && store.revisionId !== undefined
            ? {
                meta: {
                  engineSchema: 2,
                  savedAt: 1,
                  byteLength: store.bytes.byteLength,
                  baseEpoch: 0,
                  revisionId: store.revisionId,
                  journalEntries: store.updates?.length ?? 0,
                },
              }
            : {}),
        }),
      );
    } else if (frame.kind === LANE_FRAME.GET) {
      if (store.bytes === null)
        ws.receive(encodeJsonFrame(LANE_FRAME.ERR, 0, { kind: "NOT_FOUND", message: "no doc" }));
      else {
        ws.receive(encodeLaneFrame(LANE_FRAME.DOC, 0, store.bytes));
        const sendUpdate = (index: number): void => {
          const update = store.updates?.[index];
          if (update === undefined) return;
          queueMicrotask(() => {
            ws.receive(encodeLaneFrame(LANE_FRAME.DOC_UPDATE, 0, update));
            sendUpdate(index + 1);
          });
        };
        sendUpdate(0);
      }
    } else if (frame.kind === LANE_FRAME.PUT_META) {
      pendingPut = decodeJsonPayload(frame.payload) as typeof pendingPut;
    } else if (frame.kind === LANE_FRAME.PUT) {
      if (pendingPut === null || pendingPut.byteLength !== frame.payload.byteLength) {
        ws.receive(
          encodeJsonFrame(LANE_FRAME.ERR, 0, {
            kind: "PRECONDITION_FAILED",
            message: "meta mismatch",
          }),
        );
      } else {
        if ((pendingPut.kind ?? "checkpoint") === "update") {
          if (pendingPut.baseRevisionId !== store.revisionId) {
            ws.receive(
              encodeJsonFrame(LANE_FRAME.ERR, 0, {
                kind: "PRECONDITION_FAILED",
                message: "stale update base",
              }),
            );
            pendingPut = null;
            return;
          }
          store.updates = [...(store.updates ?? []), frame.payload];
        } else {
          store.bytes = frame.payload;
          store.updates = [];
        }
        store.revisionId = pendingPut.revisionId;
        ws.receive(
          encodeJsonFrame(LANE_FRAME.PUT_OK, 0, {
            revisionId: pendingPut.revisionId,
            byteLength: frame.payload.byteLength,
          }),
        );
      }
      pendingPut = null;
    }
  };
}

function makeClient(opts?: { opTimeoutMs?: number }) {
  const openLane = vi.fn(
    async (): Promise<DocOpenResult> => ({
      docId: DOC_ID,
      laneUrl: "ws://127.0.0.1:0",
      ticket: `ticket-${openLane.mock.calls.length}`,
      hasDoc: false,
    }),
  );
  const client = new DocLaneClient({
    openLane,
    webSocket: FakeLaneWs as unknown as new (url: string) => LaneWsLike,
    ...(opts?.opTimeoutMs !== undefined ? { opTimeoutMs: opts.opTimeoutMs } : {}),
  });
  return { client, openLane };
}

const envelope = (fill: number) => {
  const b = new Uint8Array(64);
  b.set([0x49, 0x43, 0x45, 0x31]); // "ICE1"
  b.fill(fill, 4);
  return b;
};

beforeEach(() => {
  vi.useFakeTimers();
  FakeLaneWs.instances = [];
  FakeLaneWs.handler = () => {};
});

afterEach(() => {
  vi.useRealTimers();
});

describe("DocLaneClient", () => {
  it("attaches, reads null on NOT_FOUND, round-trips a put", async () => {
    const store = { bytes: null as Uint8Array | null };
    FakeLaneWs.handler = happyServer(store);
    const { client } = makeClient();

    const { hasDoc } = await client.attach();
    expect(hasDoc).toBe(false);
    expect(client.status).toBe("attached");
    expect(await client.get()).toBeNull();

    const bytes = envelope(7);
    const receipt = await client.put(bytes, { engineSchema: 2, savedAt: 123 });
    expect(receipt.byteLength).toBe(bytes.byteLength);
    expect(receipt.revisionId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(client.lastPutAt).not.toBeNull();
    expect(Array.from(store.bytes ?? [])).toEqual(Array.from(bytes));
    expect(Array.from((await client.get()) ?? [])).toEqual(Array.from(bytes));
    client.close();
  });

  it("maps server LaneErr to a typed FielddRpcError", async () => {
    FakeLaneWs.handler = (ws, frame) => {
      if (frame.kind === LANE_FRAME.HELLO)
        ws.receive(encodeJsonFrame(LANE_FRAME.HELLO_OK, 0, { docId: DOC_ID, hasDoc: true }));
      else
        ws.receive(
          encodeJsonFrame(LANE_FRAME.ERR, 0, { kind: "UNAVAILABLE", message: "compacting" }),
        );
    };
    const { client } = makeClient();
    await client.attach();
    await expect(client.get()).rejects.toMatchObject({ kind: "UNAVAILABLE" });
    client.close();
  });

  it("transactionally attaches a checkpoint and its ordered update journal", async () => {
    const base = envelope(3);
    const updates = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5])];
    const store: MemoryDoc = {
      bytes: base,
      updates,
      revisionId: "120d7a2e-3c44-4b8a-9e51-6d2f8c0a7b19",
    };
    FakeLaneWs.handler = happyServer(store);
    const { client } = makeClient();

    const snapshot = await client.attachSnapshot();
    expect(Array.from(snapshot.initialBytes ?? [])).toEqual(Array.from(base));
    expect(snapshot.initialUpdates.map((update) => Array.from(update))).toEqual(
      updates.map((update) => Array.from(update)),
    );

    const next = new Uint8Array([6, 7, 8]);
    const receipt = await client.putUpdate(next, { engineSchema: 2, savedAt: 5 });
    expect(store.revisionId).toBe(receipt.revisionId);
    expect(Array.from(store.updates?.at(-1) ?? [])).toEqual(Array.from(next));
    client.close();
  });

  it("times an op out, closes the socket, and rejects TIMEOUT", async () => {
    FakeLaneWs.handler = (ws, frame) => {
      if (frame.kind === LANE_FRAME.HELLO)
        ws.receive(encodeJsonFrame(LANE_FRAME.HELLO_OK, 0, { docId: DOC_ID, hasDoc: true }));
      // GET is never answered — the deadline must fire
    };
    const { client } = makeClient({ opTimeoutMs: 1_000 });
    await client.attach();
    const get = client.get();
    const failed = expect(get).rejects.toBeInstanceOf(FielddRpcError);
    await vi.advanceTimersByTimeAsync(1_100);
    await failed;
    await expect(get).rejects.toMatchObject({ kind: "TIMEOUT" });
    expect(FakeLaneWs.instances[0]?.readyState).toBe(3);
    client.close();
  });

  it("a failed transactional attach leaves no reconnecting provisional lane", async () => {
    FakeLaneWs.handler = (ws, frame) => {
      if (frame.kind === LANE_FRAME.HELLO) {
        ws.receive(encodeJsonFrame(LANE_FRAME.HELLO_OK, 0, { docId: DOC_ID, hasDoc: true }));
      }
      // Initial GET is deliberately unanswered.
    };
    const { client, openLane } = makeClient({ opTimeoutMs: 1_000 });
    const opening = client.attachSnapshot();
    const failed = expect(opening).rejects.toMatchObject({ kind: "TIMEOUT" });
    await vi.advanceTimersByTimeAsync(1_100);
    await failed;
    expect(client.status).toBe("closed");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(openLane).toHaveBeenCalledTimes(1);
  });

  it("re-attaches after a drop with a FRESH ticket and re-puts the last envelope", async () => {
    const store = { bytes: null as Uint8Array | null };
    FakeLaneWs.handler = happyServer(store);
    const { client, openLane } = makeClient();

    await client.attach();
    const bytes = envelope(9);
    await client.put(bytes, { engineSchema: 2, savedAt: 456 });
    store.bytes = null; // the daemon "lost" it (restart with a wiped tmp dir)

    FakeLaneWs.instances[0]?.drop();
    expect(client.status).toBe("reconnecting");
    await vi.advanceTimersByTimeAsync(600); // first backoff step is 500ms

    expect(client.status).toBe("attached");
    expect(openLane).toHaveBeenCalledTimes(2); // one-shot tickets: every dial re-opens
    expect(FakeLaneWs.instances).toHaveLength(2);
    // The reconnect law: re-attach is PUT-only — lastPut re-synced the daemon.
    expect(Array.from(store.bytes ?? [])).toEqual(Array.from(bytes));
    const kinds = FakeLaneWs.instances[1]?.sent.map((f) => f.kind) ?? [];
    expect(kinds).not.toContain(LANE_FRAME.GET);
    client.close();
  });

  it("close() is terminal: no reconnect timer survives", async () => {
    const store = { bytes: null as Uint8Array | null };
    FakeLaneWs.handler = happyServer(store);
    const { client, openLane } = makeClient();
    await client.attach();
    client.close();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(openLane).toHaveBeenCalledTimes(1);
    expect(client.status).toBe("closed");
  });
});
