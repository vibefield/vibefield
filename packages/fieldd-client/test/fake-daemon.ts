// Items 467 and 469 (2026-11-16) — a daemon that answers on its own, one
// macrotask after each frame (as a real socket would: never inside the send).
// It keeps, per socket, every frame the client sent and the subscriptions it
// INSTALLED (by subId), and refuses a subscribe the way fieldd does: for want
// of room when the socket already holds `limit` (product-api's
// `subscriptionBudgetRefusal`), or as `refuse` decides.
// *Corrected 2026-11-16 (item 476): since item 476 fieldd admits a subscription
// by its key, not from a pool of 32; `PRODUCT_API_LIMITS.SUBSCRIPTIONS_PER_CONNECTION`
// is retired and the door's function is `subscriptionAdmissionRefusal`, which
// refuses a key past its holders or a `bounded` method past its bound. This fake
// still counts one `limit` per socket: its refusal has fieldd's shape and words,
// which is all the client reads, and the client's park-and-ask-again still
// answers it, so no behaviour moves.*
import type { WsCtor, WsLike } from "../src/client";

export interface Frame {
  id: number;
  method: string;
  params?: unknown;
}

export interface Refusal {
  kind: string;
  message: string;
  details?: unknown;
  /** fieldd's own flag on the error (false when not said) */
  retryable?: boolean;
}

export class Line implements WsLike {
  readyState = 0;
  readonly sent: Frame[] = [];
  /** what this socket's daemon side holds: subId → the subscribe that made it */
  readonly live = new Map<string, Frame>();
  private readonly listeners = new Map<string, Array<(ev: unknown) => void>>();
  private readonly daemon: FakeDaemon;
  readonly url: string;

  constructor(daemon: FakeDaemon, url: string) {
    this.daemon = daemon;
    this.url = url;
    setTimeout(() => {
      if (this.readyState !== 0) return;
      this.readyState = 1;
      this.emit("open", {});
    }, 0);
  }

  send(data: string): void {
    const frame = JSON.parse(data) as Frame;
    this.sent.push(frame);
    setTimeout(() => this.answer(frame), 0);
  }

  close(): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.live.clear();
    this.emit("close", { code: 1000 });
  }

  /** the socket goes under, as `api.dropConnections()` does */
  drop(): void {
    this.close();
  }

  addEventListener(type: string, fn: (ev: unknown) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }

  /** every subscribe frame sent on this socket for `method` */
  subscribes(method: string): Frame[] {
    return this.sent.filter((frame) => frame.method === method);
  }

  /** a delta on an installed subscription */
  push(subId: string, payload: unknown): void {
    this.emit("message", {
      data: JSON.stringify({ jsonrpc: "2.0", method: "thing.delta", params: { subId, payload } }),
    });
  }

  private answer(frame: Frame): void {
    if (this.readyState !== 1) return;
    if (frame.method === "system.hello") {
      this.reply(frame.id, { grantedScopes: [] });
      return;
    }
    if (frame.method === "system.unsubscribe") {
      const subId = (frame.params as { subId?: unknown } | undefined)?.subId;
      this.reply(frame.id, { removed: typeof subId === "string" && this.live.delete(subId) });
      return;
    }
    if (!frame.method.endsWith(".subscribe")) {
      this.reply(frame.id, { ok: true });
      return;
    }
    const refusal: Refusal | null =
      this.live.size >= this.daemon.limit
        ? {
            kind: "RESOURCE_EXHAUSTED",
            message: "this connection holds too many live subscriptions",
            details: { resource: "subscriptions", limit: this.daemon.limit },
          }
        : this.daemon.refuse(frame);
    if (refusal !== null) {
      this.emit("message", {
        data: JSON.stringify({
          jsonrpc: "2.0",
          id: frame.id,
          error: {
            code: -32000,
            message: refusal.message,
            data: {
              kind: refusal.kind,
              retryable: refusal.retryable === true,
              details: refusal.details,
            },
          },
        }),
      });
      return;
    }
    this.daemon.installs += 1;
    const subId = `s${this.daemon.installs}`;
    this.live.set(subId, frame);
    this.reply(frame.id, { subId, snapshot: { asked: frame.params ?? null, install: subId } });
  }

  private reply(id: number, result: unknown): void {
    this.emit("message", { data: JSON.stringify({ jsonrpc: "2.0", id, result }) });
  }

  private emit(type: string, ev: unknown): void {
    for (const fn of this.listeners.get(type) ?? []) fn(ev);
  }
}

export class FakeDaemon {
  /** the per-connection budget (fieldd's is 32) */
  limit = 32;
  /** any other refusal of a subscribe, decided per frame */
  refuse: (frame: Frame) => Refusal | null = () => null;
  installs = 0;
  readonly lines: Line[] = [];

  /** the socket the client dialed last */
  line(): Line {
    const last = this.lines.at(-1);
    if (last === undefined) throw new Error("the client has not dialed");
    return last;
  }
}

/** A daemon, and the constructor a client dials it with. */
export function fakeDaemon(): { daemon: FakeDaemon; ctor: WsCtor } {
  const daemon = new FakeDaemon();
  const ctor = class extends Line {
    constructor(url: string) {
      super(daemon, url);
      daemon.lines.push(this);
    }
  };
  return { daemon, ctor: ctor as unknown as WsCtor };
}

/** Let every answer land: a few macrotask turns. */
export async function settle(turns = 8): Promise<void> {
  for (let i = 0; i < turns; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

/** Wait for a condition across a reconnect's timers (client.test.ts's `until`). */
export async function until(fn: () => boolean, ms = 4000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > deadline) throw new Error("until: condition timeout");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
