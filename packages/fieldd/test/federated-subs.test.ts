// C6-5 — the FederatedSubscriptionManager against a fake upstream link. What
// is provable here without a peer: the D35 ref-count (one standing upstream
// per {device, method, params}, however many local subscribers), the
// late-attach re-snapshot that keeps incremental topics correct, drop
// recovery with backoff, and the quiet-teardown rules. The real upstream leg
// (a peer daemon serving under its tailnet principal) lives in peer-link.e2e.
// The 23:47 ruling's two defects (fixed 2026-10-01) are pinned at the end:
// frames a source sends right behind its open answer, and re-subscribing with
// a reader's CURRENT params.
import { afterEach, describe, expect, it, vi } from "vitest";
import { FederatedSubscriptionManager, type UpstreamLink } from "../src/federated-subs";
import { RpcCallError } from "../src/native-link";

interface FakeSub {
  device: string;
  method: string;
  params: unknown;
  onEvent: (payload: unknown, kind: "snapshot" | "delta") => void;
  onDrop: () => void;
  /** what a socket blip's replay of this subscription would ask with */
  replay: (() => unknown) | undefined;
  closed: boolean;
  snapshot: unknown;
}

class FakeLink implements UpstreamLink {
  subs: FakeSub[] = [];
  failNext = 0;
  /** frames the source sends right behind its open answer: delivered before
   * the subscribe resolves, as FielddClient routes them (the reply installs
   * the route, the frames in its tick follow, THEN the awaiting caller runs) */
  early: Array<[unknown, "snapshot" | "delta"]> = [];
  /** while set, a subscribe waits on it before answering */
  gate: Promise<void> | null = null;
  inFlight = 0;
  #seq = 0;

  async subscribe(
    device: string,
    method: string,
    params: unknown,
    onEvent: (payload: unknown, kind: "snapshot" | "delta") => void,
    onDrop: () => void,
    opts?: { params?: () => unknown },
  ): Promise<{ snapshot: unknown; unsubscribe: () => void }> {
    if (this.gate !== null) {
      this.inFlight += 1;
      await this.gate;
      this.inFlight -= 1;
    }
    if (this.failNext > 0) {
      this.failNext -= 1;
      throw new RpcCallError("UNAVAILABLE", "peer unreachable", true, {
        device,
        state: "unreachable",
      });
    }
    this.#seq += 1;
    const sub: FakeSub = {
      device,
      method,
      params,
      onEvent,
      onDrop,
      replay: opts?.params,
      closed: false,
      snapshot: { seq: this.#seq },
    };
    this.subs.push(sub);
    for (const [payload, kind] of this.early) onEvent(payload, kind);
    return {
      snapshot: sub.snapshot,
      unsubscribe: () => {
        sub.closed = true;
      },
    };
  }

  active(): FakeSub[] {
    return this.subs.filter((s) => !s.closed);
  }

  /** The link died under its subscriptions (a unary timeout's dropLink). */
  dropAll(): void {
    for (const sub of this.active()) {
      sub.closed = true;
      sub.onDrop();
    }
  }
}

type Ev = { payload: unknown; kind: string | undefined };
const recorder = (): {
  events: Ev[];
  emit: (payload: unknown, kind?: "delta" | "snapshot") => void;
} => {
  const events: Ev[] = [];
  return { events, emit: (payload, kind) => events.push({ payload, kind }) };
};

let managers: FederatedSubscriptionManager[] = [];
afterEach(() => {
  for (const m of managers) m.dispose();
  managers = [];
});

function manager(link: FakeLink, retryMinMs = 5): FederatedSubscriptionManager {
  const m = new FederatedSubscriptionManager({ link, retryMinMs, retryMaxMs: 20 });
  managers.push(m);
  return m;
}

describe("the D35 ref-count", () => {
  it("N subscribers, ONE standing upstream; params key order never splits it", async () => {
    const link = new FakeLink();
    const m = manager(link);
    const a = recorder();
    const b = recorder();
    await m.attach("dev-b", "device.subscribe", { device: "dev-b", x: 1 }, a.emit);
    await m.attach("dev-b", "device.subscribe", { x: 1, device: "dev-b" }, b.emit);
    expect(link.active()).toHaveLength(1); // the second attach SWAPPED, not stacked
    expect(link.subs).toHaveLength(2); // …via a fresh subscribe, old retired
    expect(link.subs[0]?.closed).toBe(true);
  });

  it("distinct params get their own upstream", async () => {
    const link = new FakeLink();
    const m = manager(link);
    await m.attach("dev-b", "device.subscribe", { device: "dev-b" }, recorder().emit);
    await m.attach("dev-b", "doc.sync.subscribe", { device: "dev-b" }, recorder().emit);
    expect(link.active()).toHaveLength(2);
  });

  it("a late attach re-snapshots EXISTING members — correct for incremental topics too", async () => {
    const link = new FakeLink();
    const m = manager(link);
    const first = recorder();
    await m.attach("dev-b", "device.subscribe", { device: "dev-b" }, first.emit);
    const second = recorder();
    const { snapshot } = await m.attach(
      "dev-b",
      "device.subscribe",
      { device: "dev-b" },
      second.emit,
    );
    // the newcomer's snapshot came from the FRESH upstream…
    expect(snapshot).toEqual({ seq: 2 });
    // …and the first member heard the same fresh snapshot as a stream event,
    // exactly once (its own attach snapshot was a return value, not an event)
    expect(first.events).toEqual([{ payload: { seq: 2 }, kind: "snapshot" }]);
    expect(second.events).toEqual([]);
  });

  it("events fan out to every member with kinds intact", async () => {
    const link = new FakeLink();
    const m = manager(link);
    const a = recorder();
    const b = recorder();
    await m.attach("dev-b", "device.subscribe", { device: "dev-b" }, a.emit);
    await m.attach("dev-b", "device.subscribe", { device: "dev-b" }, b.emit);
    link.active()[0]?.onEvent(["rows"], "delta");
    link.active()[0]?.onEvent(["fresh"], "snapshot");
    const tail = (events: Ev[]) => events.slice(-2);
    expect(tail(a.events)).toEqual([
      { payload: ["rows"], kind: "delta" },
      { payload: ["fresh"], kind: "snapshot" },
    ]);
    expect(tail(b.events)).toEqual(tail(a.events));
  });

  it("the LAST detach retires the upstream; a re-attach starts fresh", async () => {
    const link = new FakeLink();
    const m = manager(link);
    const a = await m.attach("dev-b", "device.subscribe", { device: "dev-b" }, recorder().emit);
    const b = await m.attach("dev-b", "device.subscribe", { device: "dev-b" }, recorder().emit);
    a.dispose();
    expect(link.active()).toHaveLength(1); // one member remains — upstream stands
    b.dispose();
    expect(link.active()).toHaveLength(0); // nobody listening ⇒ nothing upstream
    await m.attach("dev-b", "device.subscribe", { device: "dev-b" }, recorder().emit);
    expect(link.active()).toHaveLength(1);
  });
});

describe("link-death recovery", () => {
  it("re-subscribes and re-snapshots every member when the link is torn down", async () => {
    const link = new FakeLink();
    const m = manager(link);
    const a = recorder();
    await m.attach("dev-b", "device.subscribe", { device: "dev-b" }, a.emit);
    link.dropAll();
    await vi.waitFor(() => expect(link.active()).toHaveLength(1));
    // the recovery snapshot reached the member — no silent resurrection
    await vi.waitFor(() =>
      expect(a.events.at(-1)).toEqual({ payload: { seq: 2 }, kind: "snapshot" }),
    );
  });

  it("backs off while the peer stays gone, then recovers", async () => {
    const link = new FakeLink();
    const m = manager(link);
    const a = recorder();
    await m.attach("dev-b", "device.subscribe", { device: "dev-b" }, a.emit);
    link.failNext = 2; // the immediate re-subscribe AND the first retry fail
    link.dropAll();
    await vi.waitFor(() => expect(link.active()).toHaveLength(1), { timeout: 2000 });
    expect(a.events.at(-1)?.kind).toBe("snapshot");
  });

  it("stops retrying once the last member detaches — no ghost dials", async () => {
    const link = new FakeLink();
    const m = manager(link);
    const sub = await m.attach("dev-b", "device.subscribe", { device: "dev-b" }, recorder().emit);
    link.failNext = 1000;
    link.dropAll();
    sub.dispose();
    const attempts = link.subs.length;
    await new Promise((r) => setTimeout(r, 120));
    // a scheduled retry may have fired once mid-detach; it must not KEEP going
    expect(link.subs.length).toBeLessThanOrEqual(attempts + 1);
  });

  it("a failed swap leaves survivors on the retry path, never silent", async () => {
    const link = new FakeLink();
    const m = manager(link);
    const first = recorder();
    await m.attach("dev-b", "device.subscribe", { device: "dev-b" }, first.emit);
    link.failNext = 1; // the newcomer's fresh subscribe dies AFTER the old one was retired
    await expect(
      m.attach("dev-b", "device.subscribe", { device: "dev-b" }, recorder().emit),
    ).rejects.toThrow(/unreachable/);
    // recovery re-attached the surviving member
    await vi.waitFor(() => expect(link.active()).toHaveLength(1));
    await vi.waitFor(() => expect(first.events.at(-1)?.kind).toBe("snapshot"));
  });

  it("a RETIRED upstream's late drop is ignored — the standing one is never orphaned", async () => {
    const link = new FakeLink();
    const m = manager(link);
    await m.attach("dev-b", "device.subscribe", { device: "dev-b" }, recorder().emit);
    await m.attach("dev-b", "device.subscribe", { device: "dev-b" }, recorder().emit); // swap
    expect(link.subs[0]?.closed).toBe(true);
    link.subs[0]?.onDrop(); // the retired upstream's link death, heard late
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(link.subs).toHaveLength(2); // nothing re-subscribed…
    expect(link.active()).toHaveLength(1); // …and nothing leaked beside the standing one
  });

  it("a reader leaving while its upstream re-subscribes releases what the re-subscribe stood up", async () => {
    const link = new FakeLink();
    const m = manager(link);
    const sub = await m.attach("dev-b", "device.subscribe", { device: "dev-b" }, recorder().emit);
    let release: () => void = () => {};
    link.gate = new Promise((resolve) => {
      release = resolve;
    });
    link.dropAll();
    await vi.waitFor(() => expect(link.inFlight).toBe(1)); // the recovery is asking
    sub.dispose();
    link.gate = null;
    release();
    await vi.waitFor(() => expect(link.subs).toHaveLength(2));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(link.active()).toHaveLength(0);
    expect(m.size).toBe(0);
  });
});

// The 23:47 ruling (2026-09-30), fixed at the landing fix-up (2026-10-01).
describe("frames behind the open answer, and the CURRENT params on re-subscribe", () => {
  it("a frame the source sends in its reply's tick reaches the FIRST reader — after its snapshot, at start()", async () => {
    const link = new FakeLink();
    link.early = [
      [["page-2"], "snapshot"],
      [["catch-up"], "delta"],
    ];
    const m = manager(link);
    const a = recorder();
    const sub = await m.attach("dev-b", "index.catalog.subscribe", { device: "dev-b" }, a.emit);
    expect(sub.snapshot).toEqual({ seq: 1 });
    expect(a.events).toEqual([]); // nothing before the caller holds the snapshot
    sub.start();
    expect(a.events).toEqual([
      { payload: ["page-2"], kind: "snapshot" },
      { payload: ["catch-up"], kind: "delta" },
    ]);
    sub.start(); // idempotent
    link.active()[0]?.onEvent(["live"], "delta");
    expect(a.events).toHaveLength(3);
    expect(a.events.at(-1)).toEqual({ payload: ["live"], kind: "delta" });
  });

  it("without start(), what came behind the snapshot goes first at the next frame — never lost, never out of order", async () => {
    const link = new FakeLink();
    link.early = [[["behind"], "delta"]];
    const m = manager(link);
    const a = recorder();
    await m.attach("dev-b", "device.subscribe", { device: "dev-b" }, a.emit);
    link.active()[0]?.onEvent(["next"], "delta");
    expect(a.events).toEqual([
      { payload: ["behind"], kind: "delta" },
      { payload: ["next"], kind: "delta" },
    ]);
  });

  it("a swap: EXISTING members hear the fresh snapshot BEFORE what followed it; the newcomer hears it at start()", async () => {
    const link = new FakeLink();
    const m = manager(link);
    const first = recorder();
    await m.attach("dev-b", "device.subscribe", { device: "dev-b" }, first.emit);
    link.early = [[["behind"], "delta"]];
    const second = recorder();
    const sub = await m.attach("dev-b", "device.subscribe", { device: "dev-b" }, second.emit);
    expect(first.events).toEqual([
      { payload: { seq: 2 }, kind: "snapshot" },
      { payload: ["behind"], kind: "delta" },
    ]);
    expect(second.events).toEqual([]);
    sub.start();
    expect(second.events).toEqual([{ payload: ["behind"], kind: "delta" }]);
  });

  it("recovery re-subscribes with the reader's paramsForResubscribe, and a socket blip's replay asks the same", async () => {
    const link = new FakeLink();
    const m = manager(link);
    let cursor = { epoch: "e", revision: 1 };
    const a = recorder();
    await m.attach("dev-b", "index.catalog.subscribe", { device: "dev-b", since: cursor }, a.emit, {
      paramsForResubscribe: () => ({ device: "dev-b", since: cursor }),
    });
    expect(link.subs[0]?.params).toEqual({ device: "dev-b", since: { epoch: "e", revision: 1 } });
    cursor = { epoch: "e", revision: 7 }; // the reader moved on
    expect(link.subs[0]?.replay?.()).toEqual({
      device: "dev-b",
      since: { epoch: "e", revision: 7 },
    });
    link.dropAll();
    await vi.waitFor(() => expect(link.active()).toHaveLength(1));
    expect(link.subs[1]?.params).toEqual({ device: "dev-b", since: { epoch: "e", revision: 7 } });
    await vi.waitFor(() =>
      expect(a.events.at(-1)).toEqual({ payload: { seq: 2 }, kind: "snapshot" }),
    );
  });

  it("with no supplier, recovery re-subscribes with the params the entry was opened with", async () => {
    const link = new FakeLink();
    const m = manager(link);
    await m.attach("dev-b", "device.subscribe", { device: "dev-b", x: 1 }, recorder().emit);
    expect(link.subs[0]?.replay?.()).toEqual({ device: "dev-b", x: 1 });
    link.dropAll();
    await vi.waitFor(() => expect(link.active()).toHaveLength(1));
    expect(link.subs[1]?.params).toEqual({ device: "dev-b", x: 1 });
  });

  it("the first attach failing never drops the entry a queued reader is waiting on", async () => {
    const link = new FakeLink();
    const m = manager(link);
    link.failNext = 1;
    const first = m.attach("dev-b", "device.subscribe", { device: "dev-b" }, recorder().emit);
    const second = m.attach("dev-b", "device.subscribe", { device: "dev-b" }, recorder().emit);
    await expect(first).rejects.toThrow(/unreachable/);
    const standing = await second;
    expect(standing.snapshot).toEqual({ seq: 1 });
    expect(link.active()).toHaveLength(1);
    standing.dispose();
    expect(link.active()).toHaveLength(0); // released by its own reader, nothing leaked
    expect(m.size).toBe(0);
  });
});
