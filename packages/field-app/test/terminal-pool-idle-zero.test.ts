// @vitest-environment happy-dom
/**
 * TP-R1, IDLE ZERO — at the seam, against the runtime the pool actually builds.
 *
 * The row: "after N quiet seconds... the terminal worker [performs] zero decodes
 * for sessions with no live view." The renderer's half of that is a mechanism
 * with three moving parts, and only one of them is ours:
 *
 *   - upstream refcounts ONE frame subscription per session handle across the
 *     surfaces mounted on it (`#retainFrameSubscription`, runtime.js:526);
 *   - when the last surface releases, it waits `frameSubscriptionGraceMs` and
 *     then drops the subscription AND posts `drop-session` to the render worker
 *     (`#scheduleFrameSubscriptionRelease`, runtime.js:570-596) — the worker's
 *     `drop-session` is what makes the decode count zero rather than merely
 *     unused;
 *   - the GRACE is the pool's, declared in `runtime-factory.ts`.
 *
 * So this file does NOT mock the runtime. It builds the real 0.10.1 class
 * through the pool's own factory, gives it a recording worker and a canvas that
 * can be transferred, and drives mount/release with fake timers. What it proves
 * is that the mechanism the pool's demand model rides on is real at the pinned
 * version, that the grace the pool declares is the grace that governs it, and
 * that a session with one view left is NOT dropped when another view goes.
 *
 * HONEST LIMITS, stated rather than implied:
 *   - the decode count itself is not observable here. `drop-session` is the
 *     message that causes it; counting decodes needs the real worker and TP-S0a's
 *     metrics-mode counters.
 *   - the surfaces are mounted BY the test, because the ghosttea workspace owns
 *     pane surfaces in production. What is proven is the runtime contract the
 *     pool depends on, not that the workspace mounts exactly one surface a pane.
 *   - the SOURCE is not silenced by this: `drop-session` is renderer-side, and
 *     the subscription sync that would reach the daemon needs the ports this
 *     fixture deliberately never delivers. Demand reaching the cell is TP-S3b.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FieldHost } from "../src/host";
import { setHost } from "../src/host";

/** Everything the runtime posted to its render worker, in order. */
let workerMessages: Array<Record<string, unknown>> = [];

class RecordingWorker {
  addEventListener(): void {}
  removeEventListener(): void {}
  postMessage(message: Record<string, unknown>): void {
    workerMessages.push(message);
  }
  terminate(): void {}
}

// The ONE mock: Vite's `?worker` import has no meaning in a test runner, and a
// render worker would want a GPU. Everything else — the runtime class, the
// subscription refcount, the release timer — is the vendored dist.
vi.mock("@vibecook/ghosttea-react/terminal-render.worker.js?worker", () => ({
  default: RecordingWorker,
}));

const pool = await import("../src/terminal/pool");

type PoolClient = Parameters<typeof pool.openTerminalPool>[0];

const fieldd = {
  request: () => Promise.resolve({ ticket: { token: "t", controlSocket: "c", frameSocket: "f" } }),
} as unknown as PoolClient;

/** A canvas is only ever asked for one thing on the mount path. */
function fakeCanvas(): HTMLCanvasElement {
  return { transferControlToOffscreen: () => ({}) } as unknown as HTMLCanvasElement;
}

async function settle(): Promise<void> {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
}

function droppedSessions(): string[] {
  return workerMessages
    .filter((message) => message["type"] === "drop-session")
    .map((message) => String(message["sessionHandle"]));
}

beforeEach(async () => {
  workerMessages = [];
  pool.disposeTerminalPool();
  setHost({
    terminal: {
      connect: () => Promise.resolve({ defaultShell: "/bin/zsh", home: "/Users/test" }),
      onStatus: () => () => undefined,
    },
    logger: { child: () => ({ info: () => undefined, error: () => undefined }) },
  } as unknown as FieldHost);
  vi.useFakeTimers();
  pool.openTerminalPool(fieldd);
  await settle();
});

afterEach(() => {
  pool.disposeTerminalPool();
  vi.useRealTimers();
});

describe("the subscription the pool's demand model rides on (TP-R1)", () => {
  it("builds a real runtime whose timers this fixture actually controls", () => {
    // The guard on the whole file: if the runtime were a stub, or if its
    // `window.setTimeout` were not the one the fake clock replaced, every
    // assertion below would pass by never running the release path at all.
    const runtime = pool.terminalPoolRuntime();
    expect(runtime).not.toBeNull();
    expect(runtime?.constructor.name).toBe("GhostteaTerminalRuntime");
    expect(window.setTimeout, "the runtime schedules on window").toBe(globalThis.setTimeout);
    expect(vi.isFakeTimers()).toBe(true);
    // A mount is what retains, and the worker hears about it.
    runtime?.mount("s1", "h1", "view-1", fakeCanvas()).dispose();
    expect(workerMessages.some((message) => message["type"] === "mount")).toBe(true);
  });

  it("drops a session's subscription one grace after its LAST view, and not before", () => {
    const runtime = pool.terminalPoolRuntime();
    if (runtime === null) throw new Error("the pool opened without a runtime");
    const grace = pool.TERMINAL_FRAME_SUBSCRIPTION_GRACE_MS;

    const first = runtime.mount("s1", "h1", "view-1", fakeCanvas());
    const second = runtime.mount("s1", "h1", "view-2", fakeCanvas());

    // One view leaves. The surface unmounts on its own 0ms hop; the session does
    // not go anywhere, because another view is still watching it.
    first.dispose();
    vi.advanceTimersByTime(grace * 2);
    expect(workerMessages.some((message) => message["type"] === "unmount")).toBe(true);
    expect(droppedSessions(), "a session with a live view is never dropped").toEqual([]);

    // The last one leaves. Nothing happens until the grace is actually spent —
    // which is what makes a pane closing and reopening, or a deck remounting
    // onto a replaced generation, cost nothing.
    second.dispose();
    vi.advanceTimersByTime(0);
    vi.advanceTimersByTime(grace - 1);
    expect(droppedSessions(), "inside the grace, the subscription is held").toEqual([]);

    vi.advanceTimersByTime(2);
    expect(droppedSessions(), "and then it is dropped, once").toEqual(["h1"]);
  });

  it("drops each session independently, so one closing pane cannot silence another", () => {
    const runtime = pool.terminalPoolRuntime();
    if (runtime === null) throw new Error("the pool opened without a runtime");
    const grace = pool.TERMINAL_FRAME_SUBSCRIPTION_GRACE_MS;

    const a = runtime.mount("s-a", "h-a", "view-a", fakeCanvas());
    runtime.mount("s-b", "h-b", "view-b", fakeCanvas());

    a.dispose();
    vi.advanceTimersByTime(grace + 10);
    expect(droppedSessions()).toEqual(["h-a"]);
  });

  it("keeps the pool's declared grace as the one that governs the release", () => {
    // The number is ours now (`runtime-factory.ts`) rather than a library
    // default nobody named. It matches 0.10.1's own default deliberately — the
    // promotion changes ownership, not behaviour — and this row is what would
    // catch the two drifting apart, in either direction.
    const runtime = pool.terminalPoolRuntime();
    if (runtime === null) throw new Error("the pool opened without a runtime");
    const grace = pool.TERMINAL_FRAME_SUBSCRIPTION_GRACE_MS;
    expect(grace).toBeGreaterThan(0);

    runtime.mount("s1", "h1", "view-1", fakeCanvas()).dispose();
    vi.advanceTimersByTime(0);
    vi.advanceTimersByTime(grace - 1);
    expect(droppedSessions()).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(droppedSessions()).toEqual(["h1"]);
  });

  it("declares no demand for a session the pool has released", () => {
    // The renderer-side half and the pool-side half, said together: the ledger
    // has nothing left to declare at the same moment the runtime has nothing
    // left to decode. They are separate mechanisms today — the join is TP-S3b's
    // `DeclareDemand` — and this is the honest statement of both.
    const runtime = pool.terminalPoolRuntime();
    if (runtime === null) throw new Error("the pool opened without a runtime");
    const view = pool.bindTerminalSessionView("s1", pool.LIVE_SOURCE_DEMAND);
    const lease = runtime.mount("s1", "h1", "view-1", fakeCanvas());
    expect(pool.terminalPoolLiveSessions()).toEqual(["s1"]);

    view.release();
    lease.dispose();
    vi.advanceTimersByTime(pool.TERMINAL_FRAME_SUBSCRIPTION_GRACE_MS + 10);

    expect(pool.terminalPoolLiveSessions()).toEqual([]);
    expect(pool.terminalPoolProjectedDemand()).toEqual([]);
    expect(droppedSessions()).toEqual(["h1"]);
  });
});
