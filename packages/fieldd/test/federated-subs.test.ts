// C6-5 — the FederatedSubscriptionManager against a fake upstream link. What
// is provable here without a peer: the D35 ref-count (one standing upstream
// per {device, method, params}, however many local subscribers), the
// late-attach re-snapshot that keeps incremental topics correct, drop
// recovery with backoff, and the quiet-teardown rules. The real upstream leg
// (a peer daemon serving under its tailnet principal) lives in peer-link.e2e.
import { afterEach, describe, expect, it, vi } from "vitest";
import { FederatedSubscriptionManager, type UpstreamLink } from "../src/federated-subs";
import { RpcCallError } from "../src/native-link";

interface FakeSub {
  device: string;
  method: string;
  params: unknown;
  onEvent: (payload: unknown, kind: "snapshot" | "delta") => void;
  onDrop: () => void;
  closed: boolean;
  snapshot: unknown;
}

class FakeLink implements UpstreamLink {
  subs: FakeSub[] = [];
  failNext = 0;
  #seq = 0;

  async subscribe(
    device: string,
    method: string,
    params: unknown,
    onEvent: (payload: unknown, kind: "snapshot" | "delta") => void,
    onDrop: () => void,
  ): Promise<{ snapshot: unknown; unsubscribe: () => void }> {
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
      closed: false,
      snapshot: { seq: this.#seq },
    };
    this.subs.push(sub);
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
});
