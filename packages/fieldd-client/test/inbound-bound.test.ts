// Item 60 (2026-10-26) — `maxInboundBytes`: a frame over it is COUNTED, never
// parsed. The socket closes with its reason, every call waiting on it fails
// RESOURCE_EXHAUSTED with the bound and the frame's size, and `onFrameRefused`
// hears it; the reconnect law is unchanged. A transport that refuses first
// (`ws`'s `maxPayload`: WS_ERR_UNSUPPORTED_MESSAGE_LENGTH, then close 1009) is
// read as the same refusal, without a count. It is an OPTION: with none set, a
// window reading its own fieldd takes the large answers it honestly gets.
import { CONTRACTS_VERSION } from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { FielddClient, FielddRpcError, type WsCtor, type WsLike } from "../src/client";

let cleanup: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanup.reverse()) fn();
  cleanup = [];
});

/** A door that answers hello, and lets the test answer every other call with
 * any raw frame it likes. Records how its sockets were closed. */
function fakeDoor(): {
  ctor: WsCtor;
  answer: (frameFor: (id: number) => string) => void;
  transportRefuses: () => void;
  closes: Array<{ code?: number; reason?: string }>;
  dials: () => number;
} {
  let frameFor: ((id: number) => string) | null = null;
  let current: Door | null = null;
  let dials = 0;
  const closes: Array<{ code?: number; reason?: string }> = [];
  class Door implements WsLike {
    readyState = 0;
    private readonly listeners = new Map<string, Array<(ev: unknown) => void>>();
    constructor(_url: string) {
      dials += 1;
      current = this;
      queueMicrotask(() => {
        this.readyState = 1;
        this.emit("open", {});
      });
    }
    send(data: string): void {
      const frame = JSON.parse(data) as { id: number; method: string };
      queueMicrotask(() => {
        if (frame.method === "system.hello")
          this.emit("message", {
            data: JSON.stringify({
              jsonrpc: "2.0",
              id: frame.id,
              result: {
                contractsVersion: CONTRACTS_VERSION,
                serverKind: "fieldd",
                grantedScopes: [],
              },
            }),
          });
        else if (frameFor !== null) this.emit("message", { data: frameFor(frame.id) });
      });
    }
    close(code?: number, reason?: string): void {
      if (this.readyState === 3) return;
      this.readyState = 3;
      closes.push({
        ...(code !== undefined ? { code } : {}),
        ...(reason !== undefined ? { reason } : {}),
      });
      queueMicrotask(() => this.emit("close", { code: code ?? 1005 }));
    }
    addEventListener(type: string, fn: (ev: unknown) => void): void {
      const list = this.listeners.get(type) ?? [];
      list.push(fn);
      this.listeners.set(type, list);
    }
    emit(type: string, ev: unknown): void {
      for (const fn of this.listeners.get(type) ?? []) fn(ev);
    }
  }
  return {
    ctor: Door as unknown as WsCtor,
    answer: (f) => {
      frameFor = f;
    },
    // what `ws` does for a frame past its maxPayload: the error, then 1009
    transportRefuses: () => {
      const door = current as Door;
      door.readyState = 3;
      door.emit("error", {
        error: Object.assign(new RangeError("Max payload size exceeded"), {
          code: "WS_ERR_UNSUPPORTED_MESSAGE_LENGTH",
        }),
      });
      door.emit("close", { code: 1009 });
    },
    closes,
    dials: () => dials,
  };
}

/** A result frame for `id` of exactly `bytes` UTF-8 bytes, its filler `unit`
 * (one code unit, `unitBytes` bytes in UTF-8), what is left padded in ASCII. */
function frameOf(id: number, bytes: number, unit = "r", unitBytes = 1): string {
  const head = `{"jsonrpc":"2.0","id":${id},"result":{"rows":"`;
  const tail = `"}}`;
  const room = bytes - head.length - tail.length;
  const units = Math.floor(room / unitBytes);
  return `${head}${unit.repeat(units)}${"r".repeat(room - units * unitBytes)}${tail}`;
}

function clientOver(
  door: ReturnType<typeof fakeDoor>,
  bound: number | undefined,
): { client: FielddClient; heard: Array<{ bytes?: number; maxInboundBytes?: number }> } {
  const heard: Array<{ bytes?: number; maxInboundBytes?: number }> = [];
  const client = new FielddClient({
    url: "ws://peer.example:9423",
    token: "",
    webSocket: door.ctor,
    maxBackoffMs: 50,
    ...(bound !== undefined ? { maxInboundBytes: bound } : {}),
    onFrameRefused: (refusal) => heard.push(refusal),
  });
  cleanup.push(() => client.close());
  return { client, heard };
}

const failure = (p: Promise<unknown>) =>
  p.then(
    () => {
      throw new Error("the call was answered");
    },
    (e: unknown) => e as FielddRpcError,
  );

describe("FielddClient — maxInboundBytes (item 60)", () => {
  it("a frame one byte over the bound is counted, never parsed: the call fails RESOURCE_EXHAUSTED with the bound and the size, the socket closes with its reason", async () => {
    const door = fakeDoor();
    door.answer((id) => frameOf(id, 1025));
    const { client, heard } = clientOver(door, 1024);
    const error = await failure(client.request("big.read", {}));
    expect(error).toBeInstanceOf(FielddRpcError);
    expect(error.kind).toBe("RESOURCE_EXHAUSTED");
    expect(error.retryable).toBe(false);
    expect(error.code).toBeUndefined(); // the client's own refusal, never a remote answer
    expect(error.details).toEqual({ reason: "frame_refused", maxInboundBytes: 1024, bytes: 1025 });
    expect(error.message).toContain("1025 bytes");
    expect(heard).toEqual([{ bytes: 1025, maxInboundBytes: 1024 }]);
    expect(door.closes).toEqual([
      { code: 1000, reason: "an inbound frame was over this client's bound" },
    ]);
  });

  it("a frame that is not even JSON is refused the same way: nothing was parsed", async () => {
    const door = fakeDoor();
    door.answer(() => "x".repeat(4096));
    const { client, heard } = clientOver(door, 1024);
    const error = await failure(client.request("big.read", {}));
    expect(error.details).toMatchObject({ reason: "frame_refused", maxInboundBytes: 1024 });
    expect(heard).toHaveLength(1);
  });

  it("counts UTF-8 bytes, not UTF-16 units: a frame under the bound in units but over it in bytes is refused, with its byte count", async () => {
    const door = fakeDoor();
    // "é" is one UTF-16 unit and two UTF-8 bytes: 1,024 + 16 bytes, ~530 units
    door.answer((id) => frameOf(id, 1040, "é", 2));
    const { client, heard } = clientOver(door, 1024);
    const error = await failure(client.request("big.read", {}));
    expect(error.details).toEqual({ reason: "frame_refused", maxInboundBytes: 1024, bytes: 1040 });
    expect(heard).toEqual([{ bytes: 1040, maxInboundBytes: 1024 }]);
  });

  it("a frame AT the bound is read", async () => {
    const door = fakeDoor();
    door.answer((id) => frameOf(id, 1024, "é", 2));
    const { client, heard } = clientOver(door, 1024);
    const answer = (await client.request("big.read", {})) as { rows: string };
    expect(answer.rows.startsWith("é")).toBe(true);
    expect(heard).toEqual([]);
    expect(door.closes).toEqual([]);
  });

  it("with no bound set, the same large frame is read: the renderer's own fieldd answers honestly larger", async () => {
    const door = fakeDoor();
    door.answer((id) => frameOf(id, 64 * 1024));
    const { client, heard } = clientOver(door, undefined);
    const answer = (await client.request("big.read", {})) as { rows: string };
    expect(answer.rows.length).toBeGreaterThan(60 * 1024);
    expect(heard).toEqual([]);
  });

  it("the transport's own refusal (ws: WS_ERR_UNSUPPORTED_MESSAGE_LENGTH, then 1009) fails the waiting call the same way, without a count, and the client re-dials", async () => {
    const door = fakeDoor();
    const { client, heard } = clientOver(door, 1024);
    await client.ready();
    door.answer(() => {
      queueMicrotask(() => door.transportRefuses());
      return "{}"; // never delivered whole: the transport refused it
    });
    const error = await failure(client.request("big.read", {}));
    expect(error.kind).toBe("RESOURCE_EXHAUSTED");
    expect(error.details).toEqual({ reason: "frame_refused", maxInboundBytes: 1024 });
    expect(heard).toEqual([{ maxInboundBytes: 1024 }]);
    // not terminal: the next call rides a fresh dial
    door.answer((id) => JSON.stringify({ jsonrpc: "2.0", id, result: { small: true } }));
    expect(await client.request("small.read", {})).toEqual({ small: true });
    expect(door.dials()).toBe(2);
  });
});
