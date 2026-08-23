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
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      registerSession: () => undefined,
      listSessions: () => Promise.resolve([]),
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
const fieldd = {
  request: (method: string) => {
    requests.push(method);
    if (method === "terminal.roster") return Promise.resolve({ items: [] });
    // TP-S3e: a routed claim mints NOTHING (G23 mints per activation at real
    // pane mount) — any other ask from this fixture is a failure, loudly.
    return Promise.reject(new Error(`unexpected method ${method}`));
  },
} as unknown as PoolClient;

/** Open the pool the way a consumer does now — by naming a session (TP-S1). */
function openOn(sessionId = "s1"): void {
  pool.openTerminalPool(fieldd, { sessionIds: [sessionId] });
}

/** Let the pool's promise chain settle without a real timer. */
async function settle(): Promise<void> {
  for (let index = 0; index < 24; index += 1) await Promise.resolve();
}

function installHost(): void {
  setHost({
    logger: { child: () => ({ info: () => undefined, error: () => undefined }) },
  } as unknown as FieldHost);
}

beforeEach(() => {
  deviceWarm = () => Promise.resolve({ backend: "webgpu" });
  runtimeCalls = [];
  requests = [];
  runtimesMade = 0;
  disposed = 0;
  pool.disposeTerminalPool();
  pool.configureTerminalPool({
    transport: "routed",
    defaultShell: "/bin/zsh",
    home: "/Users/test",
  });
  installHost();
});

afterEach(() => {
  vi.useRealTimers();
  pool.disposeTerminalPool();
});

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
    expect(requests).toEqual([]);
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
    // TP-S3e: the one await a warm has is the DEVICE (a routed warm touches
    // fieldd not at all), so the in-flight case is a slow device warm.
    let releaseDevice: (value: { backend: string }) => void = () => undefined;
    deviceWarm = () =>
      new Promise((resolve) => {
        releaseDevice = resolve;
      });

    pool.prewarmTerminalPool(fieldd);
    await settle();
    expect(runtimesMade).toBe(1);

    openOn();
    await settle();
    expect(runtimesMade, "the claim built nothing while a warm was in flight").toBe(1);

    releaseDevice({ backend: "webgpu" });
    await settle();

    expect(runtimesMade).toBe(1);
    expect(disposed, "nothing was orphaned, so nothing had to be thrown away").toBe(0);
    expect(pool.terminalPoolSnapshot().phase).toBe("open");
    expect(pool.terminalPoolSnapshot().warm).toBe(true);
  });

  it("bounds a stuck render-worker warm so a waiting claim still takes the cold path", async () => {
    vi.useFakeTimers();
    deviceWarm = () => new Promise(() => undefined);

    pool.prewarmTerminalPool(fieldd);
    await settle();
    openOn();
    expect(pool.terminalPoolSnapshot().phase).toBe("opening");
    expect(runtimesMade).toBe(1);

    await vi.advanceTimersByTimeAsync(pool.TERMINAL_PREWARM_TIMEOUT_MS);
    await settle();

    expect(disposed, "the hung warm runtime was retired").toBe(1);
    expect(runtimesMade, "the claim continued with one cold runtime").toBe(2);
    expect(pool.terminalPoolSnapshot().phase).toBe("open");
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
  // The BRIDGE-EVENT LADDER (discard-on-death · the one re-warm · flapping ·
  // republish · claimed-alone · ticket-expired) RETIRED at TP-S3e with its
  // subject: there is no main-side transport process whose death can reach a
  // warm, no status channel to flap, and no ticket main holds to expire. What
  // survives of GT-D14 is below — a warm that FAILS still spends its one
  // attempt — and the claimed pool's replacement door is retryTerminalPool,
  // proven in the demand/routing suites.

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
    // TP-S3e: the transport-plane half of this row (a bridge that will not
    // connect) retired with the bridge; per-activation transport health is the
    // routed runtime's. What remains is the fieldd plane, whose honesty is the
    // GT-5c point: a refusal to MINT says nothing about the running shells.
    // A refused MINT for a saved session is the EXPECTED case
    // — that pane's shell is gone — so the pool rests dormant and lets the
    // consumer ask for a session instead. The fault appears at the ask that is
    // NOT supposed to fail: field-native holds the PTYs and outlives fieldd, so
    // a create this window cannot make says nothing about the shells running.
    const deaf = {
      request: () => Promise.reject(new Error("fieldd is not answering")),
    } as unknown as PoolClient;
    pool.disposeTerminalPool();
    pool.configureTerminalPool({
      transport: "routed",
      defaultShell: "/bin/zsh",
      home: "/Users/test",
    });
    pool.openTerminalPool(deaf, { sessionIds: ["s1"] });
    await settle();
    // TP-S3e: a routed claim with pane ids is immediately mountable ("open") —
    // the pool asked fieldd NOTHING, so there was no rejoin to refuse and no
    // fault to report; honesty arrives per activation.
    expect(pool.terminalPoolSnapshot().phase).toBe("open");
    expect(pool.terminalPoolSnapshot().fault).toBeNull();

    await expect(pool.createTerminalSession({})).rejects.toThrow("fieldd is not answering");
    expect(pool.terminalPoolSnapshot().fault?.plane).toBe("fieldd");
  });
});

describe("PF6: a warm transport nobody opened", () => {
  it("schedules only its bounded one-shot guard — no interval or animation frame", async () => {
    const setInterval = vi.spyOn(globalThis, "setInterval");
    const setTimeout = vi.spyOn(globalThis, "setTimeout");
    const raf = vi.fn();
    vi.stubGlobal("requestAnimationFrame", raf);

    pool.prewarmTerminalPool(fieldd);
    await settle();

    expect(pool.terminalPoolSnapshot().phase).toBe("warm");
    expect(setInterval).not.toHaveBeenCalled();
    expect(setTimeout).toHaveBeenCalledTimes(1);
    expect(setTimeout).toHaveBeenCalledWith(expect.any(Function), pool.TERMINAL_PREWARM_TIMEOUT_MS);
    expect(raf).not.toHaveBeenCalled();

    setInterval.mockRestore();
    setTimeout.mockRestore();
    vi.unstubAllGlobals();
  });
});
