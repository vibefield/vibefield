// @vitest-environment happy-dom
/**
 * THE ROUTED DATA MODEL AND ITS DEMAND LEDGER (TP-S0b; TP-L-C, TP-L-E').
 *
 * Two laws, one fixture:
 *
 *   TP-L-C — "the session id is the only address... the routed transport may
 *   CACHE resolved placement (connections keyed by `cellBootId`), but placement
 *   never escapes the transport abstraction." So: the pool holds a transport
 *   table, and nothing a consumer can read names a cell.
 *
 *   TP-L-E' — "unmount does not silence the source directly; it atomically
 *   RELEASES that view's declared demand." The ledger lives in a MODULE now, and
 *   a module outlives React. That is the whole reason these rows can fail: a
 *   view's demand surviving its view is a leak nothing else in this app would
 *   notice, because before the promotion the state died with the component.
 */

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FieldHost } from "../src/host";
import { setHost } from "../src/host";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let runtimesMade = 0;
/** Every call the pool made ON the runtime. TP-R1 rests on what is NOT here. */
let runtimeCalls: string[] = [];

vi.mock("@vibecook/ghosttea-react", () => ({
  createGhostteaTerminalRuntime: () => {
    runtimesMade += 1;
    const id = runtimesMade;
    return {
      id,
      connect: () => Promise.resolve(),
      startPerformanceMeasurement: () => Promise.resolve(),
      finishPerformanceMeasurement: () => Promise.resolve({ backend: "test" }),
      setSessionPinned: (handle: string, pinned: boolean) => {
        runtimeCalls.push(`setSessionPinned:${handle}:${pinned}`);
      },
      setVisible: (handle: string, visible: boolean) => {
        runtimeCalls.push(`setVisible:${handle}:${visible}`);
      },
      dispose: () => runtimeCalls.push(`dispose:${id}`),
      rendererBackend: "test",
    };
  },
  waitForGhostteaRendererPorts: () => new Promise(() => undefined),
}));

vi.mock("@vibecook/ghosttea-react/terminal-render.worker.js?worker", () => ({
  default: class {},
}));

const pool = await import("../src/terminal/pool");

type PoolClient = Parameters<typeof pool.openTerminalPool>[0];

let publishStatus: ((status: { state: string }) => void) | null = null;
const fieldd = {
  request: () => Promise.resolve({ ticket: { token: "t", controlSocket: "c", frameSocket: "f" } }),
} as unknown as PoolClient;

let root: Root | null = null;
let container: HTMLElement | null = null;

async function settle(): Promise<void> {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
}

beforeEach(() => {
  runtimesMade = 0;
  runtimeCalls = [];
  publishStatus = null;
  pool.disposeTerminalPool();
  setHost({
    terminal: {
      connect: () => Promise.resolve({ defaultShell: "/bin/zsh", home: "/Users/test" }),
      onStatus: (handler: (status: { state: string }) => void) => {
        publishStatus = handler;
        return () => {
          publishStatus = null;
        };
      },
    },
    logger: { child: () => ({ info: () => undefined, error: () => undefined }) },
  } as unknown as FieldHost);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  pool.disposeTerminalPool();
});

describe("addressing by session id alone (TP-L-C)", () => {
  it("keeps ONE transport for the sessions it answers for, and never names it", async () => {
    pool.openTerminalPool(fieldd);
    await settle();
    expect(pool.terminalPoolCellCount(), "one cell today; the shape is the point").toBe(1);

    const a = pool.bindTerminalSessionView("session-a", pool.LIVE_SOURCE_DEMAND);
    const b = pool.bindTerminalSessionView("session-b", pool.LIVE_SOURCE_DEMAND);

    // Two sessions, one transport — which is exactly what a routed client looks
    // like from above at K=1, and what it will still look like at K=2.
    expect(pool.terminalPoolLiveSessions()).toEqual(["session-a", "session-b"]);
    expect(pool.terminalPoolCellCount()).toBe(1);

    // Placement never escapes. Not "is not read" — is not PRESENT: a consumer
    // cannot learn a cell from anything the pool exports, so the day sessions
    // sit in different cells, nothing above this door changes.
    for (const declared of pool.terminalPoolProjectedDemand()) {
      expect(Object.keys(declared).sort()).toEqual(["mode", "sessionId", "transportGeneration"]);
      expect(JSON.stringify(declared)).not.toContain("cell");
    }
    a.release();
    b.release();
  });

  it("HOLDS demand declared before a transport exists, and declares it on open", async () => {
    // A new activation declares demand afresh (§5.4). A view that bound while
    // the pool was still opening is not a view that wants nothing.
    const view = pool.bindTerminalSessionView("early", pool.LIVE_SOURCE_DEMAND);
    expect(pool.terminalSessionDemand("early")).toBe("live");
    expect(pool.terminalPoolProjectedDemand(), "nothing to declare it to yet").toEqual([]);

    pool.openTerminalPool(fieldd);
    await settle();

    expect(pool.terminalPoolProjectedDemand()).toEqual([
      { sessionId: "early", mode: "live", transportGeneration: 1 },
    ]);
    view.release();
  });

  it("re-declares against a REPLACED transport, because the views did not move", async () => {
    // A bridge rebuild replaces the runtime; it does not close a pane. Demand is
    // a fact about a session and its views, and the floor outlives fieldd — so
    // clearing the ledger here would say the views went away, which is the one
    // thing that did not happen.
    pool.openTerminalPool(fieldd);
    await settle();
    const view = pool.bindTerminalSessionView("survivor", pool.LIVE_SOURCE_DEMAND);
    expect(pool.terminalPoolProjectedDemand()[0]?.transportGeneration).toBe(1);

    publishStatus?.({ state: "bridge-up" });
    await settle();

    expect(pool.terminalSessionDemand("survivor"), "the view never went away").toBe("live");
    expect(pool.terminalPoolProjectedDemand()).toEqual([
      { sessionId: "survivor", mode: "live", transportGeneration: 2 },
    ]);
    view.release();
  });
});

describe("demand is released by the view, atomically (TP-L-E')", () => {
  it("folds MAX over a session's views and drops in ONE step", async () => {
    pool.openTerminalPool(fieldd);
    await settle();

    const watching = pool.bindTerminalSessionView("s", pool.NO_SOURCE_DEMAND);
    expect(pool.terminalSessionDemand("s")).toBe("none");

    const live = pool.bindTerminalSessionView("s", pool.LIVE_SOURCE_DEMAND);
    expect(pool.terminalSessionDemand("s"), "one live view makes the session live").toBe("live");
    expect(pool.terminalPoolViewCount()).toBe(2);

    // The `none` view leaving cannot silence a session another view is watching.
    watching.release();
    expect(pool.terminalSessionDemand("s")).toBe("live");

    live.release();
    expect(pool.terminalSessionDemand("s"), "the last live view left").toBe("none");
    expect(pool.terminalPoolLiveSessions()).toEqual([]);
    expect(pool.terminalPoolProjectedDemand(), "a withdrawal is an absence").toEqual([]);
    expect(pool.terminalPoolViewCount()).toBe(0);
  });

  it("survives a double release, because React cleanups can run late", async () => {
    pool.openTerminalPool(fieldd);
    await settle();
    const first = pool.bindTerminalSessionView("s", pool.LIVE_SOURCE_DEMAND);
    const second = pool.bindTerminalSessionView("s", pool.LIVE_SOURCE_DEMAND);

    first.release();
    first.release();
    expect(pool.terminalSessionDemand("s"), "the second view still wants it").toBe("live");
    expect(pool.terminalPoolViewCount()).toBe(1);

    second.release();
    // A declaration on a released handle is not a resurrection.
    first.declare(pool.LIVE_SOURCE_DEMAND);
    second.declare(pool.LIVE_SOURCE_DEMAND);
    expect(pool.terminalSessionDemand("s")).toBe("none");
    expect(pool.terminalPoolViewCount()).toBe(0);
  });

  it("releases every view when the CONSUMER unmounts — the module-outlives-React leak", async () => {
    // The row this slice makes possible to fail. Before the promotion the demand
    // would have been component state and would have died with the component;
    // now it lives in a module that outlives every remount, so "the views left"
    // has to be said out loud by the unmount path.
    pool.openTerminalPool(fieldd);
    await settle();

    function Panes({ ids, active }: { ids: string[]; active: boolean }): null {
      pool.useTerminalSessionViews(ids, active ? "live" : "none");
      return null;
    }

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(createElement(Panes, { ids: ["p1", "p2"], active: true }));
    });
    expect(pool.terminalPoolLiveSessions()).toEqual(["p1", "p2"]);

    // A pane closes: its view is released in the same pass that keeps the other.
    await act(async () => {
      root?.render(createElement(Panes, { ids: ["p2"], active: true }));
    });
    expect(pool.terminalPoolLiveSessions()).toEqual(["p2"]);
    expect(pool.terminalPoolViewCount()).toBe(1);

    // The overlay closes: the panes stay MOUNTED (PF6) and the demand goes to
    // `none` — the honest statement of what the source should be doing, and the
    // input TP-S3b turns into a warm tier.
    await act(async () => {
      root?.render(createElement(Panes, { ids: ["p2"], active: false }));
    });
    expect(pool.terminalPoolLiveSessions()).toEqual([]);
    expect(pool.terminalSessionDemand("p2")).toBe("none");
    expect(pool.terminalPoolViewCount(), "a `none` view is still a bound view").toBe(1);

    // And the deck itself goes away.
    await act(async () => root?.unmount());
    root = null;
    expect(pool.terminalPoolViewCount()).toBe(0);
    expect(pool.terminalPoolLiveSessions()).toEqual([]);
  });

  it("takes NO retain of its own on the runtime (TP-R1's precondition)", async () => {
    // The pool could trivially make TP-R1 unprovable from inside: a `pin` taken
    // when demand goes live and forgotten on release would hold the frame
    // subscription open past the last view. It takes none — the runtime's own
    // per-surface refcount is the only holder, and the pool owns the GRACE
    // rather than a reference.
    pool.openTerminalPool(fieldd);
    await settle();
    const view = pool.bindTerminalSessionView("s", pool.LIVE_SOURCE_DEMAND);
    view.declare(pool.NO_SOURCE_DEMAND);
    view.declare(pool.LIVE_SOURCE_DEMAND);
    view.release();

    expect(runtimeCalls.filter((call) => call.startsWith("setSessionPinned"))).toEqual([]);
    expect(runtimeCalls.filter((call) => call.startsWith("setVisible"))).toEqual([]);
  });

  it("clears the ledger when the WINDOW goes away, not before", async () => {
    pool.openTerminalPool(fieldd);
    await settle();
    pool.bindTerminalSessionView("s", pool.LIVE_SOURCE_DEMAND);
    expect(pool.terminalPoolViewCount()).toBe(1);

    pool.disposeTerminalPool();
    expect(pool.terminalPoolViewCount()).toBe(0);
    expect(pool.terminalPoolCellCount()).toBe(0);
    expect(pool.terminalPoolSnapshot().runtime).toBeNull();
  });
});
