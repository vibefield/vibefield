// Item 467 (2026-11-16) — `useSubscription` opened one wire subscription per
// mounted hook and shared nothing, so one window held the same feeds five and
// six times over and fieldd's per-connection budget (32, EL7) refused the
// 33rd for good. The hook is now a line over `attachSubscription` (feeds.ts):
// with no options, hooks asking the same method and params HOLD one shared
// subscription. These rows drive `attachSubscription` — the hook's own entry —
// against a real FielddClient over a fake socket; the hook's React wiring is
// pinned where a DOM renderer is installed: field-app's
// shared-subscription-hook.test.tsx (the hook's own sharing) and
// use-subscription-options.test.tsx (its options bag).
import { afterEach, describe, expect, it, vi } from "vitest";
import { FielddClient, type SubscribeOptions, type Subscription } from "../src/client";
import { attachSubscription, feedKey, type SubscriptionState } from "../src/feeds";
import { type FakeDaemon, fakeDaemon, settle, until } from "./fake-daemon";

type State = SubscriptionState<unknown>;

let cleanup: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanup.reverse()) fn();
  cleanup = [];
});

function clientOn(): { client: FielddClient; daemon: FakeDaemon } {
  const { daemon, ctor } = fakeDaemon();
  const client = new FielddClient({
    url: "ws://127.0.0.1:9",
    token: "t",
    webSocket: ctor,
    maxBackoffMs: 1,
  });
  cleanup.push(() => client.close());
  return { client, daemon };
}

interface Holder {
  seen: State[];
  last: () => State | undefined;
  release: () => void;
}

/** One holder, as one mounted hook: every state it heard, and its release. */
function hold(
  client: FielddClient,
  params: unknown,
  choices?: SubscribeOptions,
  method = "thing.subscribe",
): Holder {
  const seen: State[] = [];
  const release = attachSubscription(client, method, params, (state) => seen.push(state), choices);
  return { seen, last: () => seen.at(-1), release };
}

/** The install id the fake daemon put in a snapshot; a state that holds none is the row's fault. */
function subIdOf(state: State | undefined): string {
  const data = state?.data as { install?: unknown } | null | undefined;
  if (typeof data?.install !== "string") throw new Error("the state holds no install id");
  return data.install;
}

describe("shared feeds — one wire subscription per feed (item 467)", () => {
  it("three holders of one feed: ONE subscribe on the wire; each hears the snapshot and every later event", async () => {
    const { client, daemon } = clientOn();
    const holders = [1, 2, 3].map(() => hold(client, { a: 1 }));
    await settle();
    const line = daemon.line();
    expect(line.subscribes("thing.subscribe")).toHaveLength(1);
    for (const holder of holders) {
      expect(holder.last()).toMatchObject({ status: "live", data: { asked: { a: 1 } } });
    }
    line.push(subIdOf(holders[0]?.last()), { v: 2 });
    for (const holder of holders) {
      expect(holder.last()).toEqual({ status: "live", data: { v: 2 }, error: null });
    }
  });

  it("THE LATE HOLDER: mounting after events arrived, it is handed the feed's CURRENT state at once — the very state the first holder holds — and asks nothing", async () => {
    const { client, daemon } = clientOn();
    const early = hold(client, { a: 1 });
    await settle();
    const line = daemon.line();
    const subId = subIdOf(early.last());
    line.push(subId, { v: 6 });
    line.push(subId, { v: 7 });
    const late = hold(client, { a: 1 });
    // synchronously, before any turn: the reduced state, not a wait for the next event
    expect(late.seen).toEqual([{ status: "live", data: { v: 7 }, error: null }]);
    expect(late.seen[0]).toEqual(early.last());
    await settle();
    expect(line.subscribes("thing.subscribe")).toHaveLength(1);
    // and from there the two move together
    line.push(subId, { v: 8 });
    expect(late.last()).toEqual({ status: "live", data: { v: 8 }, error: null });
    expect(late.last()).toEqual(early.last());
  });

  it("EACH HOLDER IS SERVED: one holder's throw reaches no other and does not end the feed; a holder with options on the same feed is served on its own", async () => {
    const { client, daemon } = clientOn();
    // first in the fan-out: it throws on every state it is handed
    const thrower = attachSubscription(client, "thing.subscribe", { a: 1 }, () => {
      throw new Error("a holder's own failure");
    });
    const plain = hold(client, { a: 1 });
    const owned = hold(client, { a: 1 }, { params: () => ({ a: 1, since: 2 }) });
    await settle();
    const line = daemon.line();
    // the shared feed and the owner's own: two on the wire, never three
    expect(line.subscribes("thing.subscribe")).toHaveLength(2);
    expect(plain.last()?.status).toBe("live");
    expect(owned.last()?.status).toBe("live");
    const shared = subIdOf(plain.last());
    const own = subIdOf(owned.last());
    expect(shared).not.toBe(own);
    line.push(shared, { v: 1 });
    line.push(own, { v: 2 });
    expect(plain.last()?.data).toEqual({ v: 1 });
    expect(owned.last()?.data).toEqual({ v: 2 });
    // a holder that lets go from inside its own handler disturbs no other
    let selfRelease = (): void => undefined;
    const leaver: State[] = [];
    selfRelease = attachSubscription(client, "thing.subscribe", { a: 1 }, (state) => {
      leaver.push(state);
      if (state.data !== null && (state.data as { v?: number }).v === 3) selfRelease();
    });
    line.push(shared, { v: 3 });
    line.push(shared, { v: 4 });
    expect(plain.last()?.data).toEqual({ v: 4 });
    expect(leaver.map((state) => state.data)).toEqual([{ v: 1 }, { v: 3 }]);
    await settle();
    expect(line.subscribes("system.unsubscribe")).toHaveLength(0);
    expect(line.live.size).toBe(2);
    // a late holder that throws on the state it is handed AT ONCE still gets its release
    const lateThrower = attachSubscription(client, "thing.subscribe", { a: 1 }, () => {
      throw new Error("a late holder's own failure");
    });
    thrower();
    plain.release();
    lateThrower();
    await settle();
    // the last of the shared holders let go: its one unsubscribe; the owner's own stands
    expect(line.subscribes("system.unsubscribe")).toHaveLength(1);
    expect(line.live.size).toBe(1);
  });

  it("an earlier release sends no unsubscribe; the last sends exactly one; a second release of the same hold is nothing", async () => {
    const { client, daemon } = clientOn();
    const one = hold(client, { a: 1 });
    const two = hold(client, { a: 1 });
    await settle();
    const line = daemon.line();
    one.release();
    one.release();
    await settle();
    expect(line.subscribes("system.unsubscribe")).toHaveLength(0);
    expect(line.live.size).toBe(1);
    const heardBefore = one.seen.length;
    line.push(subIdOf(two.last()), { v: 3 });
    expect(two.last()).toMatchObject({ data: { v: 3 } });
    expect(one.seen).toHaveLength(heardBefore); // a released holder hears nothing
    two.release();
    await settle();
    expect(line.subscribes("system.unsubscribe")).toHaveLength(1);
    expect(line.live.size).toBe(0);
  });

  it("params share by a STABLE key: key order never splits a feed, other params never share, and undefined, null and {} are three feeds", async () => {
    const spelled = feedKey("m", { a: 1, b: { c: 2, d: 3 } });
    expect(feedKey("m", { b: { d: 3, c: 2 }, a: 1 })).toBe(spelled);
    expect(feedKey("m", { a: 1, b: undefined })).toBe(feedKey("m", { a: 1 })); // the wire drops it
    expect(feedKey("m", [1, 2])).not.toBe(feedKey("m", [2, 1])); // an array's order is its meaning
    expect(feedKey("m", { a: 1 })).not.toBe(feedKey("n", { a: 1 }));
    const three = [feedKey("m", undefined), feedKey("m", null), feedKey("m", {})];
    expect(new Set(three).size).toBe(3);

    const { client, daemon } = clientOn();
    hold(client, { a: 1, b: 2 });
    hold(client, { b: 2, a: 1 });
    hold(client, { a: 1, b: 3 });
    hold(client, undefined);
    hold(client, null);
    hold(client, {});
    await settle();
    const frames = daemon.line().subscribes("thing.subscribe");
    expect(frames).toHaveLength(5);
    // the frame is the first holder's own params; undefined sends no member at all
    expect(frames.map((frame) => ("params" in frame ? frame.params : "absent"))).toEqual([
      { a: 1, b: 2 },
      { a: 1, b: 3 },
      "absent",
      null,
      {},
    ]);
  });

  it("a refused shared subscribe reaches EVERY holder with the daemon's error; a newcomer asks again, and its answer reaches them all", async () => {
    const { client, daemon } = clientOn();
    let refusing = true;
    daemon.refuse = () =>
      refusing ? { kind: "FORBIDDEN_SCOPE", message: "not for this window" } : null;
    const holders = [hold(client, { a: 1 }), hold(client, { a: 1 })];
    await settle();
    const line = daemon.line();
    expect(line.subscribes("thing.subscribe")).toHaveLength(1);
    for (const holder of holders) {
      expect(holder.last()).toMatchObject({
        status: "error",
        data: null,
        error: { kind: "FORBIDDEN_SCOPE", message: "not for this window" },
      });
    }
    // a fresh mount always asked again; it still does, once, for the whole feed
    refusing = false;
    const newcomer = hold(client, { a: 1 });
    expect(newcomer.seen).toEqual([]); // it waits for the answer, not the old refusal
    await settle();
    expect(line.subscribes("thing.subscribe")).toHaveLength(2);
    for (const holder of [...holders, newcomer]) expect(holder.last()?.status).toBe("live");
  });
});

describe("shared feeds — THE RECONNECT replays a shared feed once (items 467, 469)", () => {
  it("three holders: the new socket is asked ONCE, every holder hears the fresh snapshot, and the last release leaves nothing on it", async () => {
    const { client, daemon } = clientOn();
    const holders = [hold(client, { a: 1 }), hold(client, { a: 1 }), hold(client, { a: 1 })];
    await settle();
    const first = daemon.line();
    const old = subIdOf(holders[0]?.last());
    first.drop();
    await until(() => daemon.lines.length === 2 && daemon.line().live.size === 1);
    await settle();
    const line = daemon.line();
    expect(line.subscribes("thing.subscribe")).toHaveLength(1);
    // the replay's own snapshot (P5: reconnect = re-snapshot), handed to all three
    expect(subIdOf(holders[0]?.last())).not.toBe(old);
    for (const holder of holders) {
      expect(holder.last()).toEqual(holders[0]?.last());
      expect(holder.last()?.status).toBe("live");
    }
    for (const holder of holders) holder.release();
    await settle();
    expect(line.subscribes("system.unsubscribe")).toHaveLength(1);
    expect(line.live.size).toBe(0);
  });

  it("a holder joining while the socket is down, on a feed already standing, asks nothing: the replay serves it", async () => {
    const { client, daemon } = clientOn();
    const before = hold(client, { a: 1 });
    await settle();
    daemon.line().drop();
    const during = hold(client, { a: 1 }); // handed the last state; the feed stands
    expect(during.seen).toHaveLength(1);
    await until(() => daemon.lines.length === 2 && daemon.line().live.size === 1);
    await settle();
    expect(daemon.line().subscribes("thing.subscribe")).toHaveLength(1);
    expect(during.last()).toEqual(before.last());
  });
});

describe("shared feeds — refused for want of room asks once more per release (item 467)", () => {
  /** A socket whose budget is filled by `client.subscribe`'s own (non-hook) callers. */
  async function full(limit: number) {
    const { client, daemon } = clientOn();
    daemon.limit = limit;
    const others: Subscription[] = [];
    for (let n = 0; n < limit; n += 1) {
      others.push(await client.subscribe("other.subscribe", { n }, () => {}));
    }
    return { client, daemon, others, line: daemon.line() };
  }

  it("each holder sees RESOURCE_EXHAUSTED; no timer re-asks; ONE ask per release; a second refusal waits for the next release", async () => {
    const { client, daemon, others, line } = await full(2);
    const asks = () => line.subscribes("thing.subscribe").length;
    const holders = [hold(client, { a: 1 }), hold(client, { a: 1 })];
    await settle();
    expect(asks()).toBe(1);
    for (const holder of holders) {
      expect(holder.last()).toMatchObject({
        status: "error",
        error: { kind: "RESOURCE_EXHAUSTED", details: { resource: "subscriptions" } },
      });
    }
    // a newcomer is handed the refusal at once: nothing has made room
    const newcomer = hold(client, { a: 1 });
    expect(newcomer.last()?.status).toBe("error");
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(asks()).toBe(1); // no timer, and no newcomer's ask

    // someone else takes the room first: the one re-ask is refused again
    daemon.limit = 1;
    others[0]?.unsubscribe();
    await settle();
    expect(asks()).toBe(2);
    const sent = line.sent.map((frame) => frame.method);
    const released = sent.lastIndexOf("system.unsubscribe");
    expect(released).toBeLessThan(sent.lastIndexOf("thing.subscribe")); // the release left first
    expect(holders[0]?.last()?.status).toBe("error");
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(asks()).toBe(2); // the second refusal waits for the next release

    daemon.limit = 2;
    others[1]?.unsubscribe();
    await settle();
    expect(asks()).toBe(3);
    for (const holder of [...holders, newcomer]) expect(holder.last()?.status).toBe("live");
    expect(line.live.size).toBe(1);
  });

  it("room made while the ask was out: the refusal is older than the room, so it asks again at once", async () => {
    const { client, others, line } = await full(1);
    const holder = hold(client, { a: 1 });
    // the subscribe has left (one turn for `ready`); its refusal has not landed
    await Promise.resolve();
    await Promise.resolve();
    expect(line.subscribes("thing.subscribe")).toHaveLength(1);
    others[0]?.unsubscribe();
    await settle();
    expect(line.subscribes("thing.subscribe")).toHaveLength(2);
    expect(holder.last()?.status).toBe("live");
    // never shown the stale refusal
    expect(holder.seen.map((state) => state.status)).toEqual(["live"]);
  });

  it("the client counts a release only for a subscription it had SENT, and tells its listeners after the unsubscribe left", async () => {
    const { client, daemon } = clientOn();
    const heard: string[] = [];
    const stop = client.onSubscriptionReleased(() => {
      heard.push(daemon.line().sent.at(-1)?.method ?? "");
    });
    const sub = await client.subscribe("thing.subscribe", { a: 1 }, () => {});
    expect(client.subscriptionsReleased).toBe(0);
    sub.unsubscribe();
    expect(client.subscriptionsReleased).toBe(1);
    expect(heard).toEqual(["system.unsubscribe"]);
    daemon.refuse = () => ({ kind: "NOT_FOUND", message: "no such thing" });
    await expect(client.subscribe("thing.subscribe", { a: 2 }, () => {})).rejects.toMatchObject({
      kind: "NOT_FOUND",
    });
    expect(client.subscriptionsReleased).toBe(1); // a refused subscribe held no room
    stop();
    sub.unsubscribe(); // a second unsubscribe of the same handle is nothing
    expect(client.subscriptionsReleased).toBe(1);
    expect(heard).toHaveLength(1);
  });
});

describe("shared feeds — the races at the last holder (item 467)", () => {
  it("the last holder leaves and a new one arrives in the same tick: no wire subscription leaks, the newcomer is live", async () => {
    const { client, daemon } = clientOn();
    const leaving = hold(client, { a: 1 });
    await settle();
    leaving.release();
    const arriving = hold(client, { a: 1 });
    await settle();
    const line = daemon.line();
    expect(line.subscribes("system.unsubscribe")).toHaveLength(1);
    expect(line.subscribes("thing.subscribe")).toHaveLength(2);
    expect(line.live.size).toBe(1); // subscribes minus unsubscribes: 1
    expect(arriving.last()?.status).toBe("live");
    line.push(subIdOf(arriving.last()), { v: 9 });
    expect(arriving.last()).toMatchObject({ data: { v: 9 } });
  });

  it("UNMOUNT THEN MOUNT IN ONE TICK (React's strict double mount), before the first answer: the feed ends LIVE and subscribes minus unsubscribes is 1", async () => {
    const { client, daemon } = clientOn();
    const mounted = hold(client, { a: 1 });
    mounted.release(); // strict mode's cleanup, in the same tick
    const remounted = hold(client, { a: 1 });
    await settle();
    const line = daemon.line();
    const subscribes = line.subscribes("thing.subscribe").length;
    const unsubscribes = line.subscribes("system.unsubscribe").length;
    expect(subscribes - unsubscribes).toBe(1);
    expect(line.live.size).toBe(1);
    expect(mounted.seen).toEqual([]);
    expect(remounted.last()?.status).toBe("live");
    line.push(subIdOf(remounted.last()), { v: 1 });
    expect(remounted.last()?.data).toEqual({ v: 1 });
  });

  it("a subscribe still out when its only holder leaves is given back when it lands, and the holder hears nothing", async () => {
    const { client, daemon } = clientOn();
    const gone = hold(client, { a: 1 });
    gone.release();
    await settle();
    const line = daemon.line();
    expect(line.subscribes("thing.subscribe")).toHaveLength(1);
    expect(line.subscribes("system.unsubscribe")).toHaveLength(1);
    expect(line.live.size).toBe(0);
    expect(gone.seen).toEqual([]);
  });

  it("a holder joining while the first ask is out hears its answer, after the first has left", async () => {
    const { client, daemon } = clientOn();
    const first = hold(client, { a: 1 });
    const second = hold(client, { a: 1 });
    first.release();
    await settle();
    expect(daemon.line().subscribes("thing.subscribe")).toHaveLength(1);
    expect(daemon.line().live.size).toBe(1);
    expect(second.last()?.status).toBe("live");
  });
});

describe("the hook's options keep a subscription the owner's own (DS-6b, unchanged by item 467)", () => {
  it("with choices, two holders of one feed are TWO wire subscriptions; a refused replay reaches its owner with the last data beside the error", async () => {
    const { client, daemon } = clientOn();
    const failures: unknown[] = [];
    const choices: SubscribeOptions = {
      params: () => ({ a: 1, since: 5 }),
      onReplayFailed: (error) => failures.push(error),
    };
    const owned = [hold(client, { a: 1 }, choices), hold(client, { a: 1 }, choices)];
    await settle();
    const first = daemon.line();
    expect(first.subscribes("thing.subscribe")).toHaveLength(2);
    const before = owned[0]?.last()?.data;
    expect(before).toMatchObject({ asked: { a: 1 } });

    daemon.refuse = () => ({ kind: "PRECONDITION_FAILED", message: "the cursor is gone" });
    first.drop();
    await until(() => failures.length === 2);
    // the replay asked with the supplier's params
    expect(daemon.line().subscribes("thing.subscribe")[0]?.params).toEqual({ a: 1, since: 5 });
    expect(owned[0]?.last()).toMatchObject({
      status: "error",
      data: before,
      error: { kind: "PRECONDITION_FAILED" },
    });
  });

  it("the shared call carries ONE choice of its own, onEnded; the owner's carries its own choices and no onEnded", async () => {
    const fourth: Array<string[] | undefined> = [];
    const client = {
      subscribe: vi.fn(async (...args: unknown[]) => {
        const choices = args[3] as Record<string, unknown> | undefined;
        fourth.push(choices === undefined ? undefined : Object.keys(choices).sort());
        return { subId: "s", snapshot: null, unsubscribe: () => undefined };
      }),
    } as unknown as FielddClient;
    attachSubscription(client, "thing.subscribe", { a: 1 }, () => undefined);
    attachSubscription(client, "thing.subscribe", { a: 2 }, () => undefined, {
      onReplayFailed: () => undefined,
    });
    await settle();
    expect(fourth).toEqual([["onEnded"], ["onReplayFailed"]]);
  });
});

describe("shared feeds on a stand-in client with `subscribe` alone (item 467)", () => {
  it("refused for room: every holder hears the error, nothing throws, nothing is left unhandled, and the next holder to join asks again", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    cleanup.push(() => process.off("unhandledRejection", onUnhandled));
    const refusal = Object.assign(new Error("this connection holds too many live subscriptions"), {
      kind: "RESOURCE_EXHAUSTED",
      details: { resource: "subscriptions", limit: 32 },
    });
    // no subscriptionsReleased, no onSubscriptionReleased: a test's fake
    const subscribe = vi.fn(async () => {
      throw refusal;
    });
    const client = { subscribe } as unknown as FielddClient;
    const holders = [hold(client, { a: 1 }), hold(client, { a: 1 })];
    await settle();
    expect(subscribe).toHaveBeenCalledTimes(1);
    for (const holder of holders) {
      expect(holder.last()).toEqual({ status: "error", data: null, error: refusal });
    }
    // nothing parked (there is no seam to park on): a newcomer asks once more
    const newcomer = hold(client, { a: 1 });
    expect(newcomer.seen).toEqual([]);
    await settle();
    expect(subscribe).toHaveBeenCalledTimes(2);
    expect(newcomer.last()?.status).toBe("error");
    expect(unhandled).toEqual([]);
    for (const holder of [...holders, newcomer]) holder.release();
  });
});

describe("a shared feed that dies at a replay does not poison later holders (item 467)", () => {
  it("the client tells `onEnded` once a replay is refused for good — after `onReplayFailed` — and its entry is gone", async () => {
    const { client, daemon } = clientOn();
    const told: string[] = [];
    const sub = await client.subscribe("thing.subscribe", { a: 1 }, () => {}, {
      onReplayFailed: () => told.push("onReplayFailed"),
      onEnded: (error) => told.push(`onEnded ${error.kind}`),
    });
    daemon.refuse = () => ({ kind: "NOT_FOUND", message: "the thing is gone" });
    daemon.line().drop();
    await until(() => told.length === 2);
    expect(told).toEqual(["onReplayFailed", "onEnded NOT_FOUND"]);
    // gone from the client: its unsubscribe sends nothing and frees nothing
    const released = client.subscriptionsReleased;
    sub.unsubscribe();
    await settle();
    expect(daemon.line().subscribes("system.unsubscribe")).toHaveLength(0);
    expect(client.subscriptionsReleased).toBe(released);
  });

  it("a RETRYABLE refusal with no owner is still the client's to re-ask: onEnded is not told", async () => {
    const { client, daemon } = clientOn();
    const ended: unknown[] = [];
    const snapshots: unknown[] = [];
    await client.subscribe(
      "thing.subscribe",
      { a: 1 },
      (payload, kind) => kind === "snapshot" && snapshots.push(payload),
      { onEnded: (error) => ended.push(error) },
    );
    let refusing = 1;
    daemon.refuse = () => {
      if (refusing === 0) return null;
      refusing -= 1;
      return { kind: "UNAVAILABLE", message: "the service is starting", retryable: true };
    };
    daemon.line().drop();
    await until(() => snapshots.length === 1);
    expect(daemon.line().subscribes("thing.subscribe")).toHaveLength(2); // refused, re-asked
    expect(ended).toEqual([]);
  });

  it("a reconnect whose replay is refused for good: EVERY holder hears the end with the last data; the next mount subscribes AFRESH on the wire; granted, all are live", async () => {
    const { client, daemon } = clientOn();
    const holders = [hold(client, { a: 1 }), hold(client, { a: 1 })];
    await settle();
    const first = daemon.line();
    first.push(subIdOf(holders[0]?.last()), { v: 5 });
    const lastData = holders[0]?.last()?.data;
    expect(lastData).toEqual({ v: 5 });

    daemon.refuse = () => ({ kind: "PRECONDITION_FAILED", message: "the feed is closed" });
    first.drop();
    await until(() => holders.every((holder) => holder.last()?.status === "error"));
    for (const holder of holders) {
      expect(holder.last()).toMatchObject({
        status: "error",
        data: lastData,
        error: { kind: "PRECONDITION_FAILED" },
      });
    }
    const line = daemon.line();
    expect(line).not.toBe(first);
    expect(line.subscribes("thing.subscribe")).toHaveLength(1); // the refused replay
    expect(line.live.size).toBe(0);

    // the next mount is not handed the dead feed as live: it asks afresh
    daemon.refuse = () => null;
    const next = hold(client, { a: 1 });
    expect(next.seen).toEqual([]);
    await settle();
    expect(line.subscribes("thing.subscribe")).toHaveLength(2);
    expect(line.live.size).toBe(1);
    for (const holder of [...holders, next]) expect(holder.last()?.status).toBe("live");
    // and it is a live feed again: an event reaches all three
    line.push(subIdOf(next.last()), { v: 6 });
    for (const holder of [...holders, next]) expect(holder.last()?.data).toEqual({ v: 6 });
  });
});
