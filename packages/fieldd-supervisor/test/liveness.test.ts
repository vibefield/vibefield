import { FielddRpcError } from "@vibefield/fieldd-client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FIELDD_LIVENESS,
  type FielddLiveness,
  type FielddLivenessOptions,
  type LivenessClient,
  watchLiveness,
} from "../src/index";

// Item 212 (RV #67, gap3-8) — the shell's liveness watch on its fieldd link (src/liveness.ts). A fieldd whose loop has
// stalled keeps its sockets open, so its client stays `ready` while nothing answers: the watch measures the silence of
// REPLIES, by the floor's rules (fieldd's native-supervisor.ts; WG-D1, WG-E1 to E3). Deterministic: fake timers move
// the asks, and the watch's clock is the fake clock plus a `stall` the test adds, which is how a stalled Electron main
// looks to it: its own tick fired late. The turn of I/O a verdict waits for (`afterIoTurn`, whose phase order
// io-turn.test.ts proves on real timers) runs on the REAL setImmediate, taken before the fake timers are installed; one
// row holds that turn open to put an answer in it, as a reply already waiting in the socket is read there.
// Why the real one (a9's rows, 2026-11-06, on the old mini): the fake clock dates a zero-delay timer made while a
// timer fires 1 ms later (fake-timers' `duringTick ? 1 : 0`), so a faked setImmediate queued by the tick ran only in
// the NEXT step, and every verdict landed one interval late. The async tick yields through the real setImmediate
// after each timer it fires, so a real one queued inside the tick runs first, at that tick's own fake time.

const ioTurn = vi.hoisted(() => ({
  held: null as Array<() => void> | null,
  setImmediate: globalThis.setImmediate,
}));
vi.mock("../src/io-turn", () => ({
  afterIoTurn: (fn: () => void) => {
    if (ioTurn.held === null) ioTurn.setImmediate(fn);
    else ioTurn.held.push(fn);
  },
}));

const OPTS: FielddLivenessOptions = { intervalMs: 100, missThreshold: 2, confirmMs: 1_000 };

interface Ask {
  readonly method: string;
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: unknown) => void;
}

/** A client the test answers: each ask is a call it settles, or leaves unanswered. A client that leaves `ready` fails
 * the call in flight, as fieldd-client's own close does. */
function fakeClient() {
  let status = "ready";
  const statusListeners = new Set<() => void>();
  const asks: Ask[] = [];
  const request = vi.fn(
    (method: string) =>
      new Promise<unknown>((resolve, reject) => {
        asks.push({ method, resolve, reject });
      }),
  );
  const client = {
    get status() {
      return status;
    },
    request,
    onStatusChange(listener: () => void) {
      statusListeners.add(listener);
      return () => statusListeners.delete(listener);
    },
  };
  return {
    client: client as unknown as LivenessClient,
    asks,
    request,
    statusListeners,
    setStatus(next: string): void {
      if (next !== "ready") {
        for (const ask of asks) {
          ask.reject(new FielddRpcError("UNAVAILABLE", "connection closed", true));
        }
      }
      status = next;
      for (const listener of [...statusListeners]) listener();
    },
  };
}

let stall = 0;
const clock = { now: () => Date.now() + stall };

function watch(fake: ReturnType<typeof fakeClient>, opts: FielddLivenessOptions = OPTS) {
  const heard: FielddLiveness[] = [];
  const watcher = watchLiveness(
    fake.client,
    { ...opts, onChange: (liveness) => heard.push(liveness) },
    clock,
  );
  return { heard, watcher };
}

/** One interval: the watch's tick, and the turn of I/O its verdict waits for. */
const step = () => vi.advanceTimersByTimeAsync(OPTS.intervalMs);

beforeEach(() => {
  vi.useFakeTimers();
  stall = 0;
  ioTurn.held = null;
});
afterEach(() => vi.useRealTimers());

describe("the shell's liveness watch on its fieldd link (item 212, RV #67)", () => {
  it("is armed at the house numbers: five seconds, two misses, and WG-D1's sixty-second bound", () => {
    expect(FIELDD_LIVENESS).toEqual({ intervalMs: 5_000, missThreshold: 2, confirmMs: 60_000 });
  });

  it("says unresponsive at the second miss in a row, and never asks twice while one ask is unanswered", async () => {
    const fake = fakeClient();
    const { heard, watcher } = watch(fake);
    await step(); // the first ask goes
    expect(fake.request).toHaveBeenCalledTimes(1);
    expect(fake.asks[0]?.method).toBe("system.health");
    await step(); // unanswered past its interval: the first miss
    expect(heard).toEqual([]);
    // the second: the silence counts from the last reply, here the watch's start on a client just ready
    await step();
    expect(heard).toEqual([{ kind: "unresponsive", silentMs: 300 }]);
    expect(watcher.liveness).toEqual({ kind: "unresponsive", silentMs: 300 });
    expect(fake.request).toHaveBeenCalledTimes(1);
    watcher.stop();
  });

  it("hears an answer, however late, as a reply: responsive again, and the clock starts over (WG-E2, WG-E3)", async () => {
    const fake = fakeClient();
    const { heard, watcher } = watch(fake);
    await step();
    await step();
    await step();
    // the ask that went at 100 ms is answered at 300 ms, two intervals past its own
    fake.asks[0]?.resolve({ ok: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(watcher.liveness).toEqual({ kind: "responsive" });
    await step(); // the next ask
    expect(fake.request).toHaveBeenCalledTimes(2);
    await step();
    await step();
    expect(heard).toEqual([
      { kind: "unresponsive", silentMs: 300 },
      { kind: "responsive" },
      { kind: "unresponsive", silentMs: 300 },
    ]);
    watcher.stop();
  });

  it("hears an error fieldd answered as a reply, and a call the client dropped as neither", async () => {
    const fake = fakeClient();
    const { heard, watcher } = watch(fake);
    await step();
    await step();
    await step();
    // fieldd's own refusal carries a JSON-RPC code: its loop turned and answered
    const refusal = new FielddRpcError("NOT_FOUND", "no such method", false, undefined, -32601);
    fake.asks[0]?.reject(refusal);
    await vi.advanceTimersByTimeAsync(0);
    expect(heard.map((liveness) => liveness.kind)).toEqual(["unresponsive", "responsive"]);
    await step(); // the next ask
    // the client's own failure (no code: the connection closed under the call) is no answer, and counts no miss
    fake.asks[1]?.reject(new FielddRpcError("UNAVAILABLE", "connection closed", true));
    await vi.advanceTimersByTimeAsync(0);
    await step(); // nothing in flight: a fresh ask, and no verdict
    expect(fake.request).toHaveBeenCalledTimes(3);
    expect(heard.map((liveness) => liveness.kind)).toEqual(["unresponsive", "responsive"]);
    watcher.stop();
  });

  it("gives its verdict after one turn of I/O: an answer read in that turn wins (WG-E1)", async () => {
    const fake = fakeClient();
    const { heard, watcher } = watch(fake, { ...OPTS, missThreshold: 1 });
    await step(); // the first ask goes
    const held: Array<() => void> = [];
    ioTurn.held = held;
    await step(); // its deadline: the tick fired, and its verdict waits for the turn of I/O
    expect(held).toHaveLength(1);
    // that turn's poll phase reads the answer already waiting in the socket, ahead of the verdict
    fake.asks[0]?.resolve({ ok: true });
    await vi.advanceTimersByTimeAsync(0);
    for (const verdict of held.splice(0)) verdict();
    expect(heard).toEqual([]);
    await step(); // the next ask
    await step(); // its deadline, with nothing waiting: the verdict counts the miss
    for (const verdict of held.splice(0)) verdict();
    expect(heard).toEqual([{ kind: "unresponsive", silentMs: 200 }]);
    watcher.stop();
  });

  it("counts no miss on a tick main itself fired late: a stalled Electron main is not a stalled fieldd (WG-E1)", async () => {
    const fake = fakeClient();
    const { heard, watcher } = watch(fake);
    await step(); // the ask goes
    // main's loop stalls across three intervals in one step: its next tick reads 300 ms late
    stall += 3 * OPTS.intervalMs;
    await step(); // late: no miss
    await step(); // on time: the first miss
    expect(heard).toEqual([]);
    await step(); // the second
    expect(heard).toEqual([{ kind: "unresponsive", silentMs: 700 }]);
    watcher.stop();
  });

  it("says wedged at the miss that finds confirmMs of reply silence, and says each state once", async () => {
    const fake = fakeClient();
    const { heard, watcher } = watch(fake);
    for (let interval = 0; interval < 10; interval += 1) await step();
    expect(heard).toEqual([
      { kind: "unresponsive", silentMs: 300 },
      { kind: "wedged", silentMs: 1_000 },
    ]);
    await step();
    await step();
    expect(heard).toHaveLength(2);
    expect(watcher.liveness.kind).toBe("wedged");
    watcher.stop();
  });

  it("counts no misses while the client is not ready, and hears its hello answered again as a reply", async () => {
    const fake = fakeClient();
    const { heard, watcher } = watch(fake);
    await step(); // the ask goes
    fake.setStatus("reconnecting"); // the socket dropped: the ask in flight fails, unanswered
    for (let interval = 0; interval < 5; interval += 1) await step();
    expect(heard).toEqual([]);
    expect(fake.request).toHaveBeenCalledTimes(1);
    fake.setStatus("ready"); // the hello was answered: a reply, and the clock starts again
    await step(); // the next ask
    expect(fake.request).toHaveBeenCalledTimes(2);
    await step();
    await step();
    expect(heard).toEqual([{ kind: "unresponsive", silentMs: 300 }]);
    watcher.stop();
  });

  it("stops when the client closes or fails, and when its owner stops it", async () => {
    for (const end of ["closed", "failed"]) {
      const fake = fakeClient();
      const { heard } = watch(fake);
      await step();
      fake.setStatus(end);
      expect(fake.statusListeners.size).toBe(0);
      for (let interval = 0; interval < 5; interval += 1) await step();
      expect(fake.request).toHaveBeenCalledTimes(1);
      expect(heard).toEqual([]);
    }
    const fake = fakeClient();
    const { watcher } = watch(fake);
    watcher.stop();
    expect(vi.getTimerCount()).toBe(0);
    expect(fake.statusListeners.size).toBe(0);
    await step();
    expect(fake.request).not.toHaveBeenCalled();
  });
});
