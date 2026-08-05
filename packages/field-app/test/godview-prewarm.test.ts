// @vitest-environment happy-dom
/**
 * THE WARM TRANSPORT (GT-3p, GT-D14).
 *
 * GT-D14 splits GT-2's "no ⌘G ⇒ no bridge" by what a resource MEANS: the
 * transport warms at idle, the session does not. These hold that line and the
 * custody clause around it:
 *
 *   1. warming redeems a ticket, connects, and forces the render backend into
 *      existence — and creates NO session, which is the half of the law that a
 *      performance slice could most easily break;
 *   2. the deck claims it once; a second claim gets nothing;
 *   3. a bridge that dies before first use spends the attempt, and exactly ONE
 *      re-warm follows — never a ladder;
 *   4. PF6: a warm transport nobody opened schedules no recurring work.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FieldHost } from "../src/host";
import { setHost } from "../src/host";

/** Everything the warm path did to the runtime, in order. */
let runtimeCalls: string[] = [];
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
      finishPerformanceMeasurement: () => {
        runtimeCalls.push("performance-finish");
        return Promise.resolve({ backend: "webgpu" });
      },
      // Present so a call would be RECORDED rather than throwing: the claim
      // "the prewarm creates no session" needs a door that could have been
      // opened, not a missing method that makes the test pass by accident.
      createSession: () => {
        runtimeCalls.push("createSession");
        return Promise.resolve({ id: "should-never-happen" });
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

const warm = await import("../src/godview/warm-transport");

let requests: string[] = [];
let connects = 0;
const fieldd = {
  request: (method: string) => {
    requests.push(method);
    return Promise.resolve({ ticket: { token: "t", controlSocket: "c", frameSocket: "f" } });
  },
} as unknown as Parameters<typeof warm.prewarmGodviewTransport>[0];

/** Let the warm's promise chain settle without a real timer. */
async function settle(): Promise<void> {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
}

beforeEach(() => {
  runtimeCalls = [];
  requests = [];
  runtimesMade = 0;
  disposed = 0;
  connects = 0;
  warm.resetWarmTransportForTest();
  setHost({
    terminal: {
      connect: () => {
        connects += 1;
        return Promise.resolve({ defaultShell: "/bin/zsh", home: "/Users/test" });
      },
      onStatus: () => () => undefined,
    },
    logger: { child: () => ({ info: () => undefined, error: () => undefined }) },
  } as unknown as FieldHost);
});

afterEach(() => warm.resetWarmTransportForTest());

describe("warming the transport (GT-D14)", () => {
  it("redeems a ticket, connects, and forces a render backend — and creates NO session", async () => {
    warm.prewarmGodviewTransport(fieldd);
    await settle();

    expect(requests).toEqual(["terminal.connectTicket"]);
    expect(connects).toBe(1);
    // The device warm, and its close: an open measurement would accumulate
    // sample arrays for a deck that has not been opened.
    expect(runtimeCalls).toEqual(["connect", "performance-start", "performance-finish"]);
    expect(runtimeCalls).not.toContain("createSession");
    expect(warm.warmTransportState()).toBe("warm");
  });

  it("forks nothing a second time while a warm is already in flight or done", async () => {
    warm.prewarmGodviewTransport(fieldd);
    warm.prewarmGodviewTransport(fieldd);
    await settle();
    warm.prewarmGodviewTransport(fieldd);
    await settle();

    expect(runtimesMade).toBe(1);
    expect(connects).toBe(1);
  });

  it("hands the transport to the first claimer and nothing to the second", async () => {
    warm.prewarmGodviewTransport(fieldd);
    await settle();

    const first = warm.takeTransportForDeck();
    expect(first?.shell).toEqual({ defaultShell: "/bin/zsh", home: "/Users/test" });
    expect(warm.takeTransportForDeck()).toBeNull();
    expect(warm.warmTransportState()).toBe("claimed");
  });

  it("publishes a warm in flight, so nothing builds a second ports wait", async () => {
    expect(warm.pendingWarmTransport()).toBeNull();
    warm.prewarmGodviewTransport(fieldd);
    // THE one-runtime law's first half: a deck opening now must wait for THIS
    // runtime rather than building its own, because main posts the two ports
    // once and two waiters would both take them.
    expect(warm.pendingWarmTransport()).not.toBeNull();
    await settle();
    expect(warm.pendingWarmTransport()).toBeNull();
  });

  it("cannot start once the deck has taken over — the law's second half", async () => {
    // The deck opened before the idle callback ever fired, so there was nothing
    // in flight to wait for. Taking ownership has to be what stops the prewarm,
    // because a schedule that has not started is invisible to every other check
    // — this is the case that broke the smoke twice.
    expect(warm.takeTransportForDeck()).toBeNull();

    warm.prewarmGodviewTransport(fieldd);
    await settle();

    expect(runtimesMade).toBe(0);
    expect(connects).toBe(0);
    expect(warm.warmTransportState()).toBe("claimed");
  });

  it("disposes a warm that lands after the deck took over, rather than leaking it", async () => {
    warm.prewarmGodviewTransport(fieldd);
    // Mid-flight the deck opens and takes ownership.
    expect(warm.takeTransportForDeck()).toBeNull();
    await settle();

    // The warm ran to completion and then found itself superseded: its runtime
    // is disposed, not published, and the singleton still belongs to the deck.
    expect(runtimesMade).toBe(1);
    expect(disposed).toBe(1);
    expect(warm.warmTransportState()).toBe("claimed");
  });
});

describe("custody after a death (GT-D14's re-warm clause)", () => {
  it("discards a warm transport whose bridge died, and disposes its runtime", async () => {
    warm.prewarmGodviewTransport(fieldd);
    await settle();

    warm.discardWarmTransport("the bridge died before first use");
    expect(disposed).toBe(1);
    expect(warm.warmTransportState()).toBe("spent");
    expect(warm.takeTransportForDeck()).toBeNull();
  });

  it("re-warms exactly ONCE, never in a loop", async () => {
    warm.prewarmGodviewTransport(fieldd);
    await settle();
    warm.discardWarmTransport("died");

    warm.rewarmGodviewTransport(fieldd);
    await settle();
    expect(runtimesMade).toBe(2);

    // Every subsequent bridge-up — and there are many, the deck's own recovery
    // republishes them — must add nothing.
    warm.discardWarmTransport("died again");
    warm.rewarmGodviewTransport(fieldd);
    warm.rewarmGodviewTransport(fieldd);
    await settle();
    expect(runtimesMade).toBe(2);
  });

  it("leaves a CLAIMED transport alone — it belongs to the deck's own ladder", async () => {
    warm.prewarmGodviewTransport(fieldd);
    await settle();
    warm.takeTransportForDeck();

    warm.discardWarmTransport("a bridge-down the deck is already handling");
    // Not disposed: the deck is holding this runtime and recovering with it.
    expect(disposed).toBe(0);
    expect(warm.warmTransportState()).toBe("claimed");
  });

  it("spends the attempt when the warm itself fails, rather than retrying", async () => {
    setHost({
      terminal: undefined,
      logger: { child: () => ({ info: () => undefined, error: () => undefined }) },
    } as unknown as FieldHost);

    warm.prewarmGodviewTransport(fieldd);
    await settle();

    expect(warm.warmTransportState()).toBe("spent");
    expect(runtimesMade).toBe(0);
  });
});

describe("PF6: a warm transport nobody opened", () => {
  it("schedules no interval and no animation frame", async () => {
    const setInterval = vi.spyOn(globalThis, "setInterval");
    const setTimeout = vi.spyOn(globalThis, "setTimeout");
    const raf = vi.fn();
    vi.stubGlobal("requestAnimationFrame", raf);

    warm.prewarmGodviewTransport(fieldd);
    await settle();

    expect(warm.warmTransportState()).toBe("warm");
    expect(setInterval).not.toHaveBeenCalled();
    expect(setTimeout).not.toHaveBeenCalled();
    expect(raf).not.toHaveBeenCalled();

    setInterval.mockRestore();
    setTimeout.mockRestore();
    vi.unstubAllGlobals();
  });
});
