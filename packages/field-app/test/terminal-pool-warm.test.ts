// @vitest-environment happy-dom
/**
 * THE POOL'S WARM TRANSPORT AND ITS LADDER (TP-S0b; GT-D14 promoted).
 *
 * GT-D14 splits GT-2's "no ⌘G ⇒ no bridge" by what a resource MEANS: the
 * transport warms at idle, the session does not. Those claims are unchanged by
 * the promotion — what changed is who holds them. The warm state machine and the
 * recovery ladder used to be two modules and a component: `warm-transport` owned
 * the prewarm, `GodviewOverlay` owned the custody clause (discard on death, one
 * lazy re-warm), and `GodviewDeck` owned the replacement, each with its own idea
 * of what counted as news from the bridge. The pool owns all three, and this
 * file drives the LADDER through the seam it actually rides — the host's bridge
 * status — rather than through functions a test can call directly:
 *
 *   1. warming redeems a ticket, connects, and forces the render backend into
 *      existence — and creates NO session, which is the half of the law that a
 *      performance slice could most easily break;
 *   2. the first consumer claims it; nothing prewarms behind a claim;
 *   3. a bridge that dies before first use spends the attempt, and exactly ONE
 *      re-warm follows — never a ladder;
 *   4. a bridge that dies AFTER a claim is the consumer's fault to show, and its
 *      transport is not discarded under it;
 *   5. PF6: a warm transport nobody opened schedules no recurring work.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FieldHost } from "../src/host";
import { setHost } from "../src/host";

/** Everything the warm path did to the runtime, in order. */
let runtimeCalls: string[] = [];
/** What the device warm answers. Replaced per case to make a warm slow or fail. */
let deviceWarm: () => Promise<{ backend: string }> = () => Promise.resolve({ backend: "webgpu" });
let runtimesMade = 0;
let disposed = 0;

vi.mock("@vibecook/ghosttea-react", () => ({
  createGhostteaTerminalRuntime: () => {
    runtimesMade += 1;
    return {
      connect: () => {
        runtimeCalls.push("connect");
        return Promise.resolve();
      },
      startPerformanceMeasurement: () => {
        runtimeCalls.push("performance-start");
        return Promise.resolve();
      },
      // The warm's ONE await since TP-S1, so it is also the only place a warm
      // can be made slow or made to fail. The prewarm no longer touches fieldd
      // or the bridge, so a slow ticket cannot hold a warm open any more.
      finishPerformanceMeasurement: () => {
        runtimeCalls.push("performance-finish");
        return deviceWarm();
      },
      // Present so a call would be RECORDED rather than throwing: the claim
      // "the prewarm creates no session" needs a door that could have been
      // opened, not a missing method that makes the test pass by accident.
      createSession: () => {
        runtimeCalls.push("createSession");
        return Promise.resolve({ id: "should-never-happen" });
      },
      // Same reason, for TP-R1: the pool must take NO retain of its own, and a
      // stub without a pin door could not tell a pool that pinned from one that
      // did not.
      setSessionPinned: () => {
        runtimeCalls.push("setSessionPinned");
      },
      dispose: () => {
        disposed += 1;
      },
      rendererBackend: "webgpu",
    };
  },
  waitForGhostteaRendererPorts: () => new Promise(() => undefined),
}));

vi.mock("@vibecook/ghosttea-react/terminal-render.worker.js?worker", () => ({
  default: class {},
}));

const pool = await import("../src/terminal/pool");

type PoolClient = Parameters<typeof pool.prewarmTerminalPool>[0];

let requests: string[] = [];
let connects = 0;
let publishStatus: ((status: { state: string }) => void) | null = null;
const LEGACY = { controlSocket: "c", frameSocket: "f", token: "t" };
const fieldd = {
  request: (method: string) => {
    requests.push(method);
    if (method === "terminal.roster") return Promise.resolve({ items: [] });
    // The legacy trio, spread for `openTicket` and nested for `create`: this
    // fixture is about the WARM and the LADDER, and a keyless floor exercises
    // both without a grant in sight.
    return Promise.resolve({ ...LEGACY, sessionId: "s1", ticket: LEGACY });
  },
} as unknown as PoolClient;

/** Open the pool the way a consumer does now — by naming a session (TP-S1). */
function openOn(sessionId = "s1"): void {
  pool.openTerminalPool(fieldd, { sessionIds: [sessionId] });
}

/** Let the pool's promise chain settle without a real timer. */
async function settle(): Promise<void> {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
}

/** The bridge, speaking. Only a TRANSITION is news (GT-2c) — the guard the pool
 * now holds once instead of the deck holding one per mount. */
function bridge(state: string): void {
  publishStatus?.({ state });
}

function installHost(terminal: unknown): void {
  setHost({
    terminal,
    logger: { child: () => ({ info: () => undefined, error: () => undefined }) },
  } as unknown as FieldHost);
}

beforeEach(() => {
  deviceWarm = () => Promise.resolve({ backend: "webgpu" });
  runtimeCalls = [];
  requests = [];
  runtimesMade = 0;
  disposed = 0;
  connects = 0;
  publishStatus = null;
  pool.disposeTerminalPool();
  installHost({
    connect: () => {
      connects += 1;
      return Promise.resolve({ defaultShell: "/bin/zsh", home: "/Users/test" });
    },
    onStatus: (handler: (status: { state: string }) => void) => {
      publishStatus = handler;
      return () => {
        publishStatus = null;
      };
    },
  });
});

afterEach(() => pool.disposeTerminalPool());

describe("warming the transport (GT-D14, in the pool)", () => {
  it("forces a render backend and NOTHING else — no ticket, no bridge, no session", async () => {
    // TP-S1 moved this line. The warm used to redeem a ticket and fork the
    // bridge too, because the door was sessionless: `connectTicket` asked for
    // "this device's floor" and got coordinates with no session attached. There
    // is no such door any more — a transport is opened FOR a session, and at
    // idle there is no session — so the dead weight the warm may build stops at
    // the render worker and its GPU device.
    pool.prewarmTerminalPool(fieldd);
    await settle();

    expect(requests, "a warm asks the floor for nothing at all").toEqual([]);
    expect(connects, "and forks no bridge").toBe(0);
    // The device warm, and its close: an open measurement would accumulate
    // sample arrays for a deck that has not been opened.
    expect(runtimeCalls).toEqual(["performance-start", "performance-finish"]);
    expect(runtimeCalls).not.toContain("createSession");
    expect(pool.terminalPoolSnapshot().phase).toBe("warm");
    expect(pool.terminalPoolSnapshot().claimed, "warming is not claiming").toBe(false);
    expect(pool.terminalPoolSnapshot().runtime, "the runtime IS the warm").not.toBeNull();
    expect(pool.terminalPoolCellCount(), "and it holds no transport").toBe(0);
  });

  it("forks nothing a second time while a warm is already in flight or done", async () => {
    pool.prewarmTerminalPool(fieldd);
    pool.prewarmTerminalPool(fieldd);
    await settle();
    pool.prewarmTerminalPool(fieldd);
    await settle();

    expect(runtimesMade).toBe(1);
    expect(connects).toBe(0);
  });

  it("hands the transport to the first claimer, and the second gets the same one", async () => {
    pool.prewarmTerminalPool(fieldd);
    await settle();

    openOn();
    await settle();
    const first = pool.terminalPoolSnapshot();
    expect(first.shell).toEqual({ defaultShell: "/bin/zsh", home: "/Users/test" });
    expect(first.phase).toBe("open");
    expect(first.claimed).toBe(true);
    expect(first.warm, "it was inherited, not acquired").toBe(true);

    // A second consumer is not a second transport. The old `claimWarmTransport`
    // shape — where a second claimer got NULL and had to cope — was an artifact
    // of the transport being handed OVER rather than held.
    openOn();
    await settle();
    expect(runtimesMade).toBe(1);
    expect(pool.terminalPoolSnapshot().runtime).toBe(first.runtime);
  });

  it("publishes a warm in flight, so nothing builds a second ports wait", async () => {
    expect(pool.terminalPoolSnapshot().phase).toBe("cold");
    pool.prewarmTerminalPool(fieldd);
    // THE one-runtime law's first half: a consumer opening now must wait for
    // THIS runtime rather than building its own, because main posts the two
    // ports once and two waiters would both take them.
    expect(pool.terminalPoolSnapshot().phase).toBe("warming");
    await settle();
    expect(pool.terminalPoolSnapshot().phase).toBe("warm");
  });

  it("cannot start once a consumer has taken over — the law's second half", async () => {
    // The deck opened before the idle callback ever fired, so there was nothing
    // in flight to wait for. Taking ownership has to be what stops the prewarm,
    // because a schedule that has not started is invisible to every other check
    // — this is the case that broke the smoke twice. The claim is SYNCHRONOUS
    // for exactly that reason.
    openOn();
    expect(pool.terminalPoolSnapshot().claimed).toBe(true);

    pool.prewarmTerminalPool(fieldd);
    await settle();

    expect(runtimesMade, "the claim built one; the prewarm added none").toBe(1);
    expect(connects).toBe(1);
    expect(pool.terminalPoolSnapshot().phase).toBe("open");
    expect(pool.terminalPoolSnapshot().warm, "there was nothing to inherit").toBe(false);
  });

  it("INHERITS a warm that lands after the claim, rather than superseding it", async () => {
    // The behaviour that changed with the promotion, and deliberately. The old
    // `takeTransportForDeck` let a caller claim WITHOUT awaiting an in-flight
    // warm, which orphaned that warm's runtime — so it had to dispose itself on
    // landing. The deck never took that path (it awaited first), so the disposal
    // was a safety net for an API shape rather than a behaviour anyone wanted.
    // The pool's claim joins the flight instead, and the law holds by
    // construction: at no point do two runtimes wait for one port delivery.
    let releaseTicket: (value: unknown) => void = () => undefined;
    const slow = {
      request: () =>
        new Promise((resolve) => {
          releaseTicket = resolve;
        }),
    } as unknown as PoolClient;

    pool.prewarmTerminalPool(slow);
    await settle();
    expect(runtimesMade).toBe(1);

    openOn();
    await settle();
    expect(runtimesMade, "the claim built nothing while a warm was in flight").toBe(1);

    releaseTicket({ ticket: { token: "t", controlSocket: "c", frameSocket: "f" } });
    await settle();

    expect(runtimesMade).toBe(1);
    expect(disposed, "nothing was orphaned, so nothing had to be thrown away").toBe(0);
    expect(pool.terminalPoolSnapshot().phase).toBe("open");
    expect(pool.terminalPoolSnapshot().warm).toBe(true);
  });

  it("takes the cold path when the warm it was waiting for FAILS", async () => {
    // A prewarm is an optimization; its failure must not doom the open waiting
    // behind it. The warm's only await is the DEVICE now, so that is where a
    // failure has to be injected — and a device that will not come up is a real
    // case (no adapter, a lost GPU), not a contrived one.
    let failDevice: (reason: unknown) => void = () => undefined;
    deviceWarm = () =>
      new Promise((_resolve, reject) => {
        failDevice = reject;
      });

    pool.prewarmTerminalPool(fieldd);
    await settle();
    openOn();
    await settle();
    expect(runtimesMade, "the claim joined the warm rather than building").toBe(1);

    failDevice(new Error("no GPU adapter"));
    await settle();

    expect(runtimesMade, "the failed warm's runtime, then the cold one").toBe(2);
    expect(pool.terminalPoolSnapshot().phase).toBe("open");
    expect(pool.terminalPoolSnapshot().fault).toBeNull();
  });
});

describe("the ladder, driven by the bridge (GT-D14's re-warm clause, GT-2c's guard)", () => {
  it("discards a warm transport whose bridge died, and disposes its runtime", async () => {
    pool.prewarmTerminalPool(fieldd);
    await settle();

    bridge("bridge-down");
    expect(disposed).toBe(1);
    expect(pool.terminalPoolSnapshot().phase).toBe("spent");
    expect(pool.terminalPoolCellCount(), "a dead transport leaves the table").toBe(0);
  });

  it("re-warms exactly ONCE, never in a loop", async () => {
    pool.prewarmTerminalPool(fieldd);
    await settle();

    bridge("bridge-down");
    bridge("bridge-up");
    await settle();
    expect(runtimesMade).toBe(2);
    expect(pool.terminalPoolSnapshot().phase).toBe("warm");

    // Every subsequent bridge death and rebuild — and there are many — adds
    // nothing.
    bridge("bridge-down");
    bridge("bridge-up");
    await settle();
    expect(runtimesMade).toBe(2);
    expect(pool.terminalPoolSnapshot().phase).toBe("spent");
  });

  it("keeps ONE ports wait when a flapping bridge overlaps two warms", async () => {
    // The narrow one, and the reason it is here: a bridge that dies and returns
    // while a warm is still in flight DISCARDS that warm and starts the single
    // re-warm — so for a moment an old acquisition is still running while a new
    // one owns the slot. If the old one cleared the slot when it landed, a claim
    // arriving afterwards would see nothing in flight and arm a SECOND ports
    // wait against the live warm. Main posts the two MessagePorts once; two
    // waiters both resolve with the same pair and the deck that loses sits at
    // "starting" forever.
    let releaseFirst: (value: { backend: string }) => void = () => undefined;
    let warms = 0;
    deviceWarm = () => {
      warms += 1;
      if (warms === 1) {
        return new Promise((resolve) => {
          releaseFirst = resolve;
        });
      }
      return new Promise(() => undefined); // the re-warm stays in flight
    };

    pool.prewarmTerminalPool(fieldd);
    await settle();
    expect(runtimesMade).toBe(1);

    bridge("bridge-down"); // discards the warm in flight
    bridge("bridge-up"); // the one re-warm, which now owns the slot
    await settle();
    expect(runtimesMade, "the re-warm built its own").toBe(2);

    // The FIRST warm lands, late and superseded. It must dispose itself and
    // leave the slot alone.
    releaseFirst({ backend: "webgpu" });
    await settle();
    expect(disposed, "the discard disposed the superseded runtime").toBe(1);
    expect(pool.terminalPoolSnapshot().phase).toBe("warming");

    // ...and a claim now JOINS the live warm rather than building a third.
    openOn();
    await settle();
    expect(runtimesMade).toBe(2);
  });

  it("ignores a republished state, which is not a transition", async () => {
    // Main publishes on EVERY set, including unchanged — its own contract test
    // pins that. Treating a republish as news built the storm: each event minted
    // a runtime and a generation, each generation re-asked, and the deck
    // remounted itself to death.
    openOn();
    await settle();
    expect(runtimesMade).toBe(1);

    for (let index = 0; index < 5; index += 1) bridge("bridge-up");
    await settle();
    expect(runtimesMade, "the first bridge-up is a transition; the rest are echoes").toBe(2);
  });

  it("leaves a CLAIMED transport alone on a death — it is the consumer's to show", async () => {
    pool.prewarmTerminalPool(fieldd);
    await settle();
    openOn();
    await settle();

    bridge("bridge-down");
    // Not disposed: a rebuild is coming, and the consumer shows the honest face
    // meanwhile. The custody clause is for transports NOBODY has claimed.
    expect(disposed).toBe(0);
    expect(pool.terminalPoolSnapshot().claimed).toBe(true);
    expect(pool.terminalPoolSnapshot().fault).toEqual({
      plane: "transport",
      message: "the terminal bridge died — rebuilding",
    });

    // ...and the rebuild replaces the runtime, because a runtime holds its ports
    // for life and the old one's wait is spent.
    bridge("bridge-up");
    await settle();
    expect(runtimesMade).toBe(2);
    expect(disposed).toBe(1);
    expect(pool.terminalPoolSnapshot().fault).toBeNull();
    expect(pool.terminalPoolSnapshot().phase).toBe("open");
  });

  it("treats ticket-expired as a rebuild, because only a fresh redeem will do", async () => {
    openOn();
    await settle();
    bridge("ticket-expired");
    await settle();
    expect(runtimesMade).toBe(2);
    expect(requests.filter((method) => method === "terminal.openTicket")).toHaveLength(2);
  });

  it("spends the attempt when the warm itself fails, rather than retrying", async () => {
    deviceWarm = () => Promise.reject(new Error("no GPU adapter"));

    pool.prewarmTerminalPool(fieldd);
    await settle();

    expect(pool.terminalPoolSnapshot().phase).toBe("spent");
    expect(pool.terminalPoolSnapshot().spentReason).toContain("no GPU adapter");
    // The runtime it built is disposed rather than left holding a worker.
    expect(runtimesMade).toBe(1);
    expect(disposed).toBe(1);
    expect(pool.terminalPoolSnapshot().runtime).toBeNull();
  });

  it("reports the PLANE that refused, because they are opposite facts (GT-5c)", async () => {
    installHost({
      connect: () => Promise.reject(new Error("no bridge on this host")),
      onStatus: () => () => undefined,
    });
    openOn();
    await settle();
    expect(pool.terminalPoolSnapshot().fault?.plane).toBe("transport");
    expect(pool.terminalPoolSnapshot().fault?.message).toContain("no bridge on this host");

    pool.disposeTerminalPool();
    installHost({
      connect: () => Promise.resolve({ defaultShell: "/bin/zsh", home: "/Users/test" }),
      onStatus: () => () => undefined,
    });
    // THE FIELDD plane. A refused MINT for a saved session is the EXPECTED case
    // — that pane's shell is gone — so the pool rests dormant and lets the
    // consumer ask for a session instead. The fault appears at the ask that is
    // NOT supposed to fail: field-native holds the PTYs and outlives fieldd, so
    // a create this window cannot make says nothing about the shells running.
    const deaf = {
      request: () => Promise.reject(new Error("fieldd is not answering")),
    } as unknown as PoolClient;
    pool.openTerminalPool(deaf, { sessionIds: ["s1"] });
    await settle();
    expect(pool.terminalPoolSnapshot().phase, "a refused rejoin is not a fault").toBe("dormant");
    expect(pool.terminalPoolSnapshot().fault).toBeNull();

    await expect(pool.createTerminalSession({})).rejects.toThrow("fieldd is not answering");
    expect(pool.terminalPoolSnapshot().fault?.plane).toBe("fieldd");
  });
});

describe("PF6: a warm transport nobody opened", () => {
  it("schedules no interval and no animation frame", async () => {
    const setInterval = vi.spyOn(globalThis, "setInterval");
    const setTimeout = vi.spyOn(globalThis, "setTimeout");
    const raf = vi.fn();
    vi.stubGlobal("requestAnimationFrame", raf);

    pool.prewarmTerminalPool(fieldd);
    await settle();

    expect(pool.terminalPoolSnapshot().phase).toBe("warm");
    expect(setInterval).not.toHaveBeenCalled();
    expect(setTimeout).not.toHaveBeenCalled();
    expect(raf).not.toHaveBeenCalled();

    setInterval.mockRestore();
    setTimeout.mockRestore();
    vi.unstubAllGlobals();
  });
});
