// @vitest-environment happy-dom
/**
 * THE POOL OPENS BY SESSION (TP-S1) — the slice's gate rows, in one fixture.
 *
 * The fossil this retires: `terminal.connectTicket` was a mint with NO session,
 * answering "the interactive cell by definition"
 * (`fieldd/src/terminal-service.ts:321-324`). It could not be routed, because
 * there was nothing to route BY. Every transport is now opened for a session —
 * `openTicket(sessionId)` to rejoin one, `create(class)` to make one — and the
 * `RouteBinding` each answers is what keys the transport table.
 *
 * The rows here are §15's S1 gate, stated as things that can fail:
 *
 *   1. ZERO `connectTicket` calls, across every path a window can take.
 *   2. `openTicket(sessionB)` returns cell B's route, and the pool keys by it.
 *   3. A session on ANOTHER cell shows the honest face while cell A's live
 *      connection is untouched — the bridge is never re-ticketed.
 *   4. Grants are HELD, and no attach is faked.
 *   5. A keyless floor's legacy answer still drives the bridge, recorded as
 *      `grantsLanded: false` rather than as a fabricated route.
 *   6. What the UI receives for its roster parses as `ProductSessionRosterItem`
 *      — which REFUSES a placement key.
 */

import { ProductSessionRosterItem, TERMINAL_PIPELINE } from "@vibefield/contracts";
import { FielddRpcError } from "@vibefield/fieldd-client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FieldHost } from "../src/host";
import { setHost } from "../src/host";
import { getRendererLogger, type RendererLogger, setRendererLogger } from "../src/logging";

let runtimesMade = 0;
/** A case's own floor read, in place of the runtime's `listSessions` answer. */
let listSessionsOverride: (() => Promise<unknown>) | null = null;
let runtimeOptions: unknown[] = [];
let registeredSessions: unknown[] = [];

vi.mock("@vibecook/ghosttea-react", () => ({
  createGhostteaTerminalRuntime: (options: unknown) => {
    runtimesMade += 1;
    runtimeOptions.push(options);
    const events = new EventTarget();
    return {
      addEventListener: events.addEventListener.bind(events),
      removeEventListener: events.removeEventListener.bind(events),
      connect: () => Promise.resolve(),
      startPerformanceMeasurement: () => Promise.resolve(),
      finishPerformanceMeasurement: () => Promise.resolve({ backend: "test" }),
      listSessions: () => listSessionsOverride?.() ?? Promise.resolve(sessionSummaries),
      registerSession: (session: unknown) => registeredSessions.push(session),
      dispose: () => undefined,
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

const LEGACY = { controlSocket: "/a/control.sock", frameSocket: "/a/frame.sock", token: "tok" };

/** A ticket as a floor that mints grants answers it: the end-state fields spread
 * beside the legacy trio the pre-T1 bridge still dials. */
function routedTicket(cellBootId: string, sessionId: string, sockets = LEGACY) {
  return {
    ...sockets,
    route: { cellBootId, routeRevision: 3, leaseEpoch: 7 },
    // `endpoints` is deliberately ABSENT — the contract says it stays absent
    // until the cell serves its T1 doors at TP-S3a, and a `unix:` URL here
    // would be a detour (TP-L-F).
    transportGrant: {
      protected: {
        v: 1,
        typ: "CellTransportGrant",
        iss: "fieldd",
        alg: "HS256",
        kid: { cellBootId, keyGeneration: 1 },
      },
      claims: {
        audienceCellBootId: cellBootId,
        clientId: "client-1",
        connectionSetId: `set-${cellBootId}`,
        allowedChannels: ["control", "frames"],
        transportGrantGeneration: 2,
        issuedAt: 1_000,
        expiresAt: 61_000,
        nonce: `nonce-${sessionId}`,
      },
      mac: "bWFj",
    },
    attachGrant: {
      protected: {
        v: 1,
        typ: "SessionAttachGrant",
        iss: "fieldd",
        alg: "HS256",
        kid: { cellBootId, keyGeneration: 1 },
      },
      claims: {
        audienceCellBootId: cellBootId,
        clientId: "client-1",
        sessionId,
        leaseEpoch: 7,
        routeRevision: 3,
        grantGeneration: 5,
        rights: ["input", "read"],
        issuedAt: 1_000,
        expiresAt: 61_000,
      },
      mac: "bWFj",
    },
  };
}

function directTicket(cellBootId: string, sessionId: string) {
  return {
    ...routedTicket(cellBootId, sessionId),
    endpoints: {
      controlUrl: "ws://127.0.0.1:43101/control",
      framesUrl: "ws://127.0.0.1:43101/frames",
    },
  };
}

function runtimeSummary(sessionId: string) {
  return {
    id: sessionId,
    handle: "1",
    executable: "/bin/zsh",
    cols: 80,
    rows: 24,
    exited: false,
    readWrite: true,
    title: null,
    cwd: "/Users/test",
    bellCount: 0,
    pid: 123,
    createdAtMs: 1_000,
    exitCode: null,
    exitSignal: null,
    requestedTermination: null,
    exitOutcome: null,
    ownerId: null,
    persistence: "keep-until-exit",
    activity: {
      kind: "unknown",
      source: "unsupported",
      confidence: "heuristic",
      rootProcessGroupId: null,
      foregroundProcessGroupId: null,
      observedAtMs: 1_000,
    },
  };
}

/** Which cell each session sits on, per case. */
let cellOf: Record<string, string> = {};
/** Sessions the runtime's own `listSessions` reports. */
let sessionSummaries: Array<{ id: string }> = [];
/** What `terminal.roster` answers. */
let rosterRows: unknown[] = [];
let requests: string[] = [];
/** Every ticket main was actually handed, in order. */
let connectedSockets: string[] = [];

const fieldd = {
  request: (method: string, params?: unknown) => {
    requests.push(method);
    if (method === "terminal.terminate") return Promise.resolve({ terminated: true });
    if (method === "terminal.roster") return Promise.resolve({ items: rosterRows });
    if (method === "terminal.openTicket") {
      const sessionId = (params as { sessionId: string }).sessionId;
      const cell = cellOf[sessionId];
      if (cell === undefined) {
        return Promise.reject(new Error(`NOT_FOUND: ${sessionId} is not observed`));
      }
      // TP-S3e: every conforming answer carries the doors.
      return Promise.resolve(directTicket(cell, sessionId));
    }
    if (method === "terminal.create") {
      const sessionId = `born-${Object.keys(cellOf).length + 1}`;
      cellOf[sessionId] = "cell-a-boot-1";
      sessionSummaries = [...sessionSummaries, { id: sessionId }];
      return Promise.resolve({
        sessionId,
        session: runtimeSummary(sessionId),
        ...directTicket("cell-a-boot-1", sessionId),
      });
    }
    return Promise.reject(new Error(`unexpected method ${method}`));
  },
} as unknown as PoolClient;

async function settle(): Promise<void> {
  for (let index = 0; index < 16; index += 1) await Promise.resolve();
}

beforeEach(() => {
  runtimesMade = 0;
  listSessionsOverride = null;
  runtimeOptions = [];
  registeredSessions = [];
  requests = [];
  connectedSockets = [];
  rosterRows = [];
  sessionSummaries = [];
  cellOf = {};
  pool.disposeTerminalPool();
  pool.configureTerminalPool({
    transport: "routed",
    defaultShell: "/bin/zsh",
    home: "/Users/test",
  });
  setHost({
    logger: {
      child: () => ({ info: () => undefined, error: () => undefined, debug: () => undefined }),
    },
  } as unknown as FieldHost);
});

afterEach(() => pool.disposeTerminalPool());

describe("the window bootstrap selects the production G23 path", () => {
  it("uses a routed runtime, never invokes the bridge, and owns exact birth/termination inverses", async () => {
    const sessionId = "direct-1";
    const summary = runtimeSummary(sessionId);
    const opened = directTicket("cell-direct-1", sessionId);
    const directRequests: string[] = [];
    let observedForOpen = false;
    const directFieldd = {
      request: (method: string) => {
        directRequests.push(method);
        if (method === "terminal.create") {
          return Promise.resolve({
            sessionId,
            ticket: LEGACY,
            ...opened,
            session: summary,
          });
        }
        if (method === "terminal.openTicket") {
          if (!observedForOpen) return Promise.reject(new Error("session not observed yet"));
          return Promise.resolve(opened);
        }
        if (method === "terminal.terminate") return Promise.resolve({ terminated: true });
        return Promise.reject(new Error(`unexpected method ${method}`));
      },
    } as unknown as PoolClient;

    pool.configureTerminalPool({
      transport: "routed",
      defaultShell: "/bin/zsh",
      home: "/Users/test",
    });
    pool.openTerminalPool(directFieldd, { sessionIds: [] });
    await settle();

    expect(pool.terminalPoolSnapshot().phase).toBe("dormant");
    const options = runtimeOptions[0] as {
      transport?: string;
      host?: {
        openTicket(sessionId: string): Promise<unknown>;
        createSession?(options: unknown): Promise<unknown>;
        terminate?(sessionId: string, source: "user"): Promise<void>;
      };
    };
    expect(options.transport).toBe("routed");
    expect(options.host).toBeDefined();
    expect(
      pool.terminalPoolSnapshot().shell,
      "G23 can mount the workspace before any session exists",
    ).toEqual({
      defaultShell: "/bin/zsh",
      home: "/Users/test",
    });

    expect(
      await options.host?.createSession?.({
        executable: "/bin/zsh",
        args: [],
        cols: 100,
        rows: 30,
        persistence: "terminate-with-app",
        programKind: "interactive-shell",
      }),
      "the workspace's own empty-layout fallback rides terminal.create",
    ).toEqual(summary);
    expect(registeredSessions).toEqual([summary]);
    expect(await pool.terminalSessionSummary(sessionId, 1)).toEqual(summary);
    expect(pool.terminalPoolSnapshot().shell).toEqual({
      defaultShell: "/bin/zsh",
      home: "/Users/test",
    });
    expect(connectedSockets, "main's legacy utility bridge was never touched").toEqual([]);

    await options.host?.openTicket(sessionId);
    expect(
      directRequests,
      "the create ticket is consumed before observation-gated openTicket",
    ).toEqual(["terminal.create"]);
    expect(pool.terminalPoolCellCount()).toBe(1);
    expect(pool.terminalSessionGrants(sessionId)).toBeDefined();

    observedForOpen = true;
    await options.host?.openTicket(sessionId);
    expect(directRequests).toEqual(["terminal.create", "terminal.openTicket"]);

    await options.host?.terminate?.(sessionId, "user");
    expect(pool.terminalPoolCellCount()).toBe(0);
    expect(pool.terminalSessionGrants(sessionId)).toBeUndefined();
    expect(await pool.terminalSessionSummary(sessionId, 1)).toBeNull();
    expect(connectedSockets).toEqual([]);
    expect(directRequests).toEqual([
      "terminal.create",
      "terminal.openTicket",
      "terminal.terminate",
    ]);
  });

  // ("refuses to reinterpret an already-live runtime under another transport"
  // RETIRED at TP-S3e: the selector is the literal "routed" — there is no
  // other transport to reinterpret INTO, and configure only stores policy.)
});

describe("the sessionless door is gone (TP-D3)", () => {
  it("never asks for connectTicket — not to rejoin, not to create, not to recover", async () => {
    cellOf = { "saved-1": "cell-a-boot-1" };

    pool.openTerminalPool(fieldd, { sessionIds: ["saved-1"] });
    await settle();
    expect(pool.terminalPoolSnapshot().phase).toBe("open");

    await pool.createTerminalSession({ workloadClass: "interactive" });
    await settle();
    pool.retryTerminalPool(["saved-1"]);
    await settle();

    expect(requests, "the retired door is never called").not.toContain("terminal.connectTicket");
    // The one-runtime law under the new acquisition: rejoining, creating and
    // recovering are three transports and ONE window, and the only thing that
    // may build a second runtime is a recovery replacing the first.
    expect(runtimesMade, "one runtime, plus the one the recovery replaced it with").toBe(2);
  });

  it("claims saved panes without asking fieldd anything — honesty is per-activation", async () => {
    // TP-S3e: a routed claim with pane ids is immediately mountable, and the
    // pool asks fieldd NOTHING at claim — whether a saved pane's shell is gone
    // is learned (and shown) per activation when G23 mints for it. With no
    // sessionless door there is still no connection to reach for.
    cellOf = {};
    pool.openTerminalPool(fieldd, { sessionIds: ["ghost-1"] });
    await settle();

    expect(pool.terminalPoolSnapshot().phase).toBe("open");
    expect(requests).toEqual([]);
    expect(pool.terminalPoolSnapshot().fault, "a dead saved pane is not a fault").toBeNull();
    expect(pool.terminalPoolCellCount()).toBe(0);
    expect(pool.terminalPoolSnapshot().runtime).not.toBeNull();
  });

  it("opens on a session a consumer creates when there is nothing to rejoin", async () => {
    pool.openTerminalPool(fieldd, { sessionIds: [] });
    await settle();
    expect(pool.terminalPoolSnapshot().phase).toBe("dormant");

    const created = await pool.createTerminalSession({ workloadClass: "interactive" });
    await settle();

    expect(created.availability).toEqual({ ready: true });
    expect(pool.terminalPoolSnapshot().phase).toBe("open");
    expect(pool.terminalPoolSnapshot().shell).toEqual({
      defaultShell: "/bin/zsh",
      home: "/Users/test",
    });
  });
});

describe("the shell policy on the snapshot keeps its identity (AR-7)", () => {
  it("hands on the SAME shell object through every publication that does not change main's answer — the deck's monitor door keys on it", async () => {
    // The godview smoke's typed-agent row found a typed run in the fold and
    // nowhere on the stage: each publication built a fresh `{defaultShell,
    // home}`, the deck's door memo keys on it, and every rebuilt door
    // restarted the monitor's fold subscription before its first frame.
    const shells: unknown[] = [];
    const stop = pool.subscribeTerminalPool(() => shells.push(pool.terminalPoolSnapshot().shell));
    pool.openTerminalPool(fieldd, { sessionIds: [] });
    await settle();
    const dormant = pool.terminalPoolSnapshot().shell;
    expect(dormant).toEqual({ defaultShell: "/bin/zsh", home: "/Users/test" });
    // a birth, then its ticket: publications that change nothing about the shell
    await pool.createTerminalSession({ workloadClass: "interactive" });
    await settle();
    const host = (runtimeOptions[0] as { host?: { openTicket(id: string): Promise<unknown> } })
      .host;
    await host?.openTicket("born-1");
    stop();
    expect(pool.terminalPoolSnapshot().phase).toBe("open");
    const exposed = shells.filter((shell) => shell !== null);
    expect(exposed.length, "the pool published more than once with a shell").toBeGreaterThan(1);
    for (const shell of exposed) expect(shell).toBe(dormant);
    // a CHANGED answer is a new object — identity follows the value, nothing else
    pool.configureTerminalPool({
      transport: "routed",
      defaultShell: "/bin/bash",
      home: "/Users/test",
    });
    expect(pool.terminalPoolSnapshot().shell).not.toBe(dormant);
    expect(pool.terminalPoolSnapshot().shell).toEqual({
      defaultShell: "/bin/bash",
      home: "/Users/test",
    });
  });
});

describe("the route is the key (TP-L-C)", () => {
  it("keys the cell ledger by the cellBootId the ROUTED ticket answered", async () => {
    cellOf = { "b-1": "cell-b-boot-9" };
    pool.openTerminalPool(fieldd, { sessionIds: ["b-1"] });
    await settle();
    expect(pool.terminalPoolSnapshot().phase).toBe("open");
    expect(pool.terminalPoolCellCount(), "no mint yet, no cell yet").toBe(0);

    // G23 mints when the activation mounts; the pool records the cell the
    // ticket actually named.
    const host = (runtimeOptions[0] as { host?: { openTicket(id: string): Promise<unknown> } })
      .host;
    await host?.openTicket("b-1");
    expect(pool.terminalPoolCellCount()).toBe(1);
    expect(pool.terminalSessionAvailability("b-1")).toEqual({ ready: true });
  });

  it("holds tickets for TWO cells at once — the single-cell pin died with the bridge", async () => {
    // THE ROW, inverted deliberately at TP-S3e. The bridge served one cell per
    // window, so a second cell's session got a face instead of a transport;
    // G23 dials per cell, and the whole point of the direct doors is that
    // both sessions are live at once.
    cellOf = { "a-1": "cell-a-boot-1", "b-1": "cell-b-boot-9" };
    pool.openTerminalPool(fieldd, { sessionIds: ["a-1", "b-1"] });
    await settle();
    const host = (runtimeOptions[0] as { host?: { openTicket(id: string): Promise<unknown> } })
      .host;
    await host?.openTicket("a-1");
    await host?.openTicket("b-1");

    expect(pool.terminalPoolCellCount()).toBe(2);
    expect(pool.terminalPoolSnapshot().phase).toBe("open");
    expect(pool.terminalSessionAvailability("a-1")).toEqual({ ready: true });
    expect(pool.terminalSessionAvailability("b-1")).toEqual({ ready: true });
  });

  it("never names a cell to a consumer (TP-L-C holds without the pin)", async () => {
    cellOf = { "a-1": "cell-a-boot-1", "b-1": "cell-b-boot-9" };
    pool.openTerminalPool(fieldd, { sessionIds: ["a-1", "b-1"] });
    await settle();
    const host = (runtimeOptions[0] as { host?: { openTicket(id: string): Promise<unknown> } })
      .host;
    await host?.openTicket("b-1");

    // Placement is recorded transport-side and NEVER escapes: availability is
    // ready (there is no other-cell face to show any more) and carries nothing
    // a consumer could read a cell from.
    const availability = pool.terminalSessionAvailability("b-1");
    expect(availability).toEqual({ ready: true });
    expect(JSON.stringify(availability)).not.toContain("cell-b-boot-9");
    expect(pool.terminalSessionGrants("b-1")).toBeDefined();
  });
});

describe("grants are HELD, and nothing is faked", () => {
  it("keeps both grants, their expiry and their generation, and attaches nothing", async () => {
    cellOf = { "a-1": "cell-a-boot-1" };
    pool.openTerminalPool(fieldd, { sessionIds: ["a-1"] });
    await settle();
    const host = (runtimeOptions[0] as { host?: { openTicket(id: string): Promise<unknown> } })
      .host;
    await host?.openTicket("a-1");

    const grants = pool.terminalSessionGrants("a-1");
    expect(grants).toBeDefined();
    expect(grants?.transportGrant.protected.typ).toBe("CellTransportGrant");
    expect(grants?.attachGrant.protected.typ).toBe("SessionAttachGrant");
    // Recorded so TP-S3 can schedule `renewAttach` against them — and NOT acted
    // on: nothing renews, verifies or dials with a grant at S1.
    expect(grants?.attachExpiresAt).toBe(61_000);
    expect(grants?.grantGeneration).toBe(5);
    expect(pool.terminalPoolGrantedSessions()).toEqual(["a-1"]);
    expect(pool.terminalPoolSnapshot().grantsLanded).toBe(true);
    expect(requests, "no renewal, no attach").not.toContain("terminal.renewAttach");
  });

  it("surfaces a keyless floor's UNAVAILABLE refusal instead of a resurrected trio", async () => {
    // TP-S3e: a floor that mints no grants no longer answers the bare legacy
    // trio — fieldd refuses UNAVAILABLE upstream, the host propagates it, and
    // nothing is recorded as if a route existed.
    const keyless = {
      request: (method: string) => {
        requests.push(method);
        if (method === "terminal.openTicket") {
          const refusal = new Error(
            "the terminal cell hosting this session mints no grants (keyless bootstrap)",
          );
          (refusal as Error & { kind: string }).kind = "UNAVAILABLE";
          (refusal as Error & { details: unknown }).details = {
            service: "terminal",
            state: "grants_not_landed",
          };
          return Promise.reject(refusal);
        }
        return Promise.reject(new Error(`unexpected method ${method}`));
      },
    } as unknown as PoolClient;

    pool.openTerminalPool(keyless, { sessionIds: ["old-1"] });
    await settle();
    expect(pool.terminalPoolSnapshot().phase).toBe("open");
    const host = (runtimeOptions[0] as { host?: { openTicket(id: string): Promise<unknown> } })
      .host;
    await expect(host?.openTicket("old-1")).rejects.toThrow("mints no grants");
    expect(pool.terminalSessionGrants("old-1")).toBeUndefined();
    expect(pool.terminalPoolGrantedSessions()).toEqual([]);
    expect(pool.terminalPoolCellCount()).toBe(0);
  });
});

describe("the cold-open stations the pool stamps (TP-S1m)", () => {
  /** A trace that records the order stations were reached in. The pool takes it
   * structurally (`TransportTrace`), which is what keeps Godview out of the
   * pool — so a test can hand it a list and read the path back. */
  function recorder(): { marks: string[]; mark: (phase: string) => void } {
    const marks: string[] = [];
    return { marks, mark: (phase: string) => marks.push(phase) };
  }

  it("stamps the CREATE path, which is the one a first run takes", async () => {
    // The instrumentation gap TP-S0c published a number through: with nothing
    // saved the pool rests dormant and the deck reaches the floor via `create`,
    // and `create` stamped no station at all — so the trace carried no `ticket`
    // and no `connected` for the very open it was measuring. It does now, and
    // `mintAsk` is stamped BEFORE the request so the interval is the round trip
    // rather than the round trip plus whatever preceded it.
    const trace = recorder();
    pool.openTerminalPool(fieldd, { sessionIds: [], trace });
    await settle();
    expect(pool.terminalPoolSnapshot().phase, "nothing to rejoin rests dormant").toBe("dormant");

    await pool.createTerminalSession({ workloadClass: "interactive" }, trace);
    await settle();

    // TP-S3e: `connected` was the bridge's station; the routed create ends at
    // the ticket (the legs dial per activation, off this trace's path).
    expect(trace.marks).toEqual(["claim", "mintAsk", "ticket"]);
  });

  it("stamps the REJOIN path as claim alone — the routed claim asks nothing", async () => {
    cellOf = { "saved-1": "cell-a-boot-1" };
    const trace = recorder();
    pool.openTerminalPool(fieldd, { sessionIds: ["saved-1"], trace });
    await settle();

    expect(pool.terminalPoolSnapshot().phase).toBe("open");
    // TP-S3e: no mint at claim — G23 mints per activation when a pane mounts.
    expect(trace.marks).toEqual(["claim"]);
  });

  it("stamps the roster read as the mint's null arm — same client, no audit, no mint", async () => {
    // What makes the roster a control rather than a second measurement: it goes
    // through the same client and the same socket, immediately before the mint,
    // and fieldd answers it from memory. A `rosterAsk`/`roster` pair with no
    // mint between them is the interval the mint's own is read against.
    const trace = recorder();
    pool.openTerminalPool(fieldd, { sessionIds: [], trace });
    await settle();
    await pool.refreshTerminalRoster(trace);

    expect(trace.marks).toEqual(["claim", "rosterAsk", "roster"]);
    expect(requests).toContain("terminal.roster");
  });
});

describe("the roster the UI reads (TP-D4)", () => {
  it("publishes accepted closes separately from a stale live inventory", async () => {
    rosterRows = [{ sessionId: "fresh", workloadClass: "interactive", health: "live" }];
    pool.openTerminalPool(fieldd, { sessionIds: [] });
    await settle();
    await pool.refreshTerminalRoster();
    await pool.terminateTerminalSession("fresh");
    await pool.refreshTerminalRoster();
    expect(pool.terminalPoolSnapshot().closingSessionIds).toEqual(["fresh"]);
    expect(pool.terminalPoolSnapshot().roster[0]?.health).toBe("live");
    pool.disposeTerminalPool();
    expect(pool.terminalPoolSnapshot().closingSessionIds).toEqual([]);
  });

  it("hides a pending close synchronously and coalesces duplicate detach notifications", async () => {
    let accept!: (result: unknown) => void;
    const reply = new Promise((resolve) => {
      accept = resolve;
    });
    const request = vi.fn((method: string, params?: unknown) =>
      method === "terminal.terminate" ? reply : fieldd.request(method, params),
    );
    pool.openTerminalPool({ request } as unknown as PoolClient, { sessionIds: [] });
    await settle();
    const first = pool.terminateTerminalSession("fresh");
    const duplicate = pool.terminateTerminalSession("fresh");
    expect(first).toBe(duplicate);
    expect(pool.terminalPoolSnapshot().closingSessionIds).toEqual(["fresh"]);
    await settle();
    expect(request.mock.calls.filter(([method]) => method === "terminal.terminate")).toHaveLength(
      1,
    );
    accept({ terminated: true });
    await first;
    await pool.terminateTerminalSession("fresh");
    expect(request.mock.calls.filter(([method]) => method === "terminal.terminate")).toHaveLength(
      1,
    );
  });

  it("does not let an old rejection undo a new pool's pending close", async () => {
    let rejectOld!: (cause: unknown) => void;
    let acceptNew!: (result: unknown) => void;
    const oldReply = new Promise((_resolve, reject) => {
      rejectOld = reject;
    });
    const newReply = new Promise((resolve) => {
      acceptNew = resolve;
    });
    let currentReply = oldReply;
    const client = {
      request: (method: string, params?: unknown) =>
        method === "terminal.terminate" ? currentReply : fieldd.request(method, params),
    } as unknown as PoolClient;
    pool.openTerminalPool(client, { sessionIds: [] });
    await settle();
    const oldClose = pool.terminateTerminalSession("fresh");
    const rejected = expect(oldClose).rejects.toThrow("old refusal");
    await settle();
    pool.disposeTerminalPool();
    pool.openTerminalPool(client, { sessionIds: [] });
    await settle();
    currentReply = newReply;
    const newClose = pool.terminateTerminalSession("fresh");
    await settle();
    rejectOld(new Error("old refusal"));
    await rejected;
    expect(pool.terminalPoolSnapshot().closingSessionIds).toEqual(["fresh"]);
    acceptNew({ terminated: true });
    await newClose;
  });

  it("does not hide a shell when the close door refuses", async () => {
    const refusing = {
      request: async () => {
        throw new Error("denied");
      },
    };
    pool.openTerminalPool(refusing as unknown as typeof fieldd, { sessionIds: [] });
    await settle();
    await expect(pool.terminateTerminalSession("fresh")).rejects.toThrow("denied");
    expect(pool.terminalPoolSnapshot().closingSessionIds).toEqual([]);
  });

  it("hands consumers a placement-free projection, refused at parse if it were not", async () => {
    rosterRows = [
      { sessionId: "a-1", workloadClass: "interactive", health: "live", title: "zsh" },
      {
        sessionId: "g-1",
        workloadClass: "agent",
        health: "live",
        provenance: { kind: "agent", agentId: "claude-1" },
      },
    ];
    pool.openTerminalPool(fieldd, { sessionIds: [] });
    await settle();

    const sessions = await pool.refreshTerminalRoster();
    expect(pool.terminalPoolSnapshot().rosterState).toBe("observed");
    // CROSS-CLASS, which is the point: the roster is the one place a window sees
    // sessions it cannot open a transport to.
    expect(sessions.map((session) => session.workloadClass)).toEqual(["interactive", "agent"]);
    // What the UI receives is exactly the contract's shape — and that contract
    // REFUSES a placement key, so this is a law rather than a review note.
    for (const session of sessions) {
      expect(() => ProductSessionRosterItem.parse(session)).not.toThrow();
      expect(JSON.stringify(session)).not.toContain("cell");
    }
    expect(requests, "the transport-facing inventory is not what the UI reads").not.toContain(
      "terminal.list",
    );
  });

  it("refuses a roster row that carries placement, rather than passing it up", async () => {
    rosterRows = [
      { sessionId: "a-1", workloadClass: "interactive", health: "live", cellBootId: "cell-a" },
    ];
    pool.openTerminalPool(fieldd, { sessionIds: [] });
    await settle();

    const sessions = await pool.refreshTerminalRoster();
    expect(sessions, "a placement-carrying row never reaches a consumer").toEqual([]);
    expect(pool.terminalPoolSnapshot().rosterState).toBe("unavailable");
  });

  it("says which kind of empty a roster is", async () => {
    pool.openTerminalPool(fieldd, { sessionIds: [] });
    await settle();
    expect(pool.terminalPoolSnapshot().rosterState, "nothing read yet").toBe("unread");

    await pool.refreshTerminalRoster();
    expect(pool.terminalPoolSnapshot().rosterState, "an observed empty floor").toBe("observed");

    // fieldd's refusal as the CLIENT surfaces it: a `FielddRpcError` with
    // `kind` and `details`, not a sentence. The pool reads it structurally,
    // because an unarmed inventory that gets mistaken for an empty one is how a
    // restore came to offer to forget a layout whose sessions were alive.
    const refusal = Object.assign(new Error("terminal inventory not observed yet"), {
      kind: "UNAVAILABLE",
      details: { service: "terminal", state: "unobserved" },
    });
    const unobserved = { request: () => Promise.reject(refusal) } as unknown as PoolClient;
    pool.disposeTerminalPool();
    pool.openTerminalPool(unobserved, { sessionIds: [] });
    await settle();
    await pool.refreshTerminalRoster();
    // fieldd's own honest refusal before its first observation. An empty list
    // here would be a lie about the floor.
    expect(pool.terminalPoolSnapshot().rosterState).toBe("unobserved");
  });
});

describe("which shell was born under which Agent Profile (SB-3)", () => {
  /** fieldd after SB-2: a bound create is answered with the set it applied. */
  const binding = {
    request: async (method: string, params?: unknown) => {
      const answer = await fieldd.request(method, params);
      const profileSet = (params as { profileSet?: string } | undefined)?.profileSet;
      return method === "terminal.create" && profileSet !== undefined
        ? { ...(answer as Record<string, unknown>), profileSet }
        : answer;
    },
  } as unknown as PoolClient;

  it("records a bound create's answer and the roster's word for the rest, as one map that changes only when they do", async () => {
    pool.openTerminalPool(binding, { sessionIds: [] });
    await settle();
    const bound = await pool.createTerminalSession({
      workloadClass: "interactive",
      profileSet: "work",
    });
    const plain = await pool.createTerminalSession({ workloadClass: "interactive" });
    expect(bound.profileSet).toBe("work");
    expect(plain.profileSet).toBeUndefined();
    expect(pool.terminalSessionProfileSet(bound.sessionId)).toBe("work");
    expect([...pool.terminalPoolSnapshot().profileSets]).toEqual([[bound.sessionId, "work"]]);
    const before = pool.terminalPoolSnapshot().profileSets;
    // The roster names the set of a shell this window did not birth (another
    // window's, a restart's), and is the record for every shell it lists.
    rosterRows = [
      {
        sessionId: "elsewhere",
        workloadClass: "interactive",
        health: "live",
        profileSet: "personal",
      },
      {
        sessionId: bound.sessionId,
        workloadClass: "interactive",
        health: "live",
        profileSet: "work",
      },
    ];
    await pool.refreshTerminalRoster();
    expect(pool.terminalSessionProfileSet("elsewhere")).toBe("personal");
    expect(pool.terminalPoolSnapshot().profileSets).not.toBe(before);
    const same = pool.terminalPoolSnapshot().profileSets;
    await pool.refreshTerminalRoster();
    expect(pool.terminalPoolSnapshot().profileSets).toBe(same);
    // listed without one: under none; unlisted: what its create answered
    rosterRows = [{ sessionId: "elsewhere", workloadClass: "interactive", health: "live" }];
    await pool.refreshTerminalRoster();
    expect(pool.terminalSessionProfileSet("elsewhere")).toBeUndefined();
    expect(pool.terminalSessionProfileSet(bound.sessionId)).toBe("work");
    pool.disposeTerminalPool();
    expect(pool.terminalPoolSnapshot().profileSets.size).toBe(0);
  });

  it("knows a shell from an agent's PTY: a create's answer and the roster's interactive rows, never an adopted spawn", async () => {
    pool.openTerminalPool(binding, { sessionIds: [] });
    await settle();
    const bound = await pool.createTerminalSession({
      workloadClass: "interactive",
      profileSet: "work",
    });
    const plain = await pool.createTerminalSession({ workloadClass: "interactive" });
    expect(pool.terminalShellBirth(bound.sessionId)).toBe("work");
    // born unbound is an answer, not an unknown
    expect(pool.terminalShellBirth(plain.sessionId)).toBeNull();
    // an agent's PTY, handed over by a spawn, is no shell of the pool's
    const adopted = pool.adoptCreatedTerminal({
      sessionId: "agent-pty",
      session: runtimeSummary("agent-pty"),
      ...directTicket("cell-a-boot-1", "agent-pty"),
    });
    expect(pool.terminalShellBirth(adopted.sessionId)).toBeUndefined();
    rosterRows = [
      {
        sessionId: "other-window",
        workloadClass: "interactive",
        health: "live",
        profileSet: "demo",
      },
      { sessionId: "unbound-elsewhere", workloadClass: "interactive", health: "live" },
      { sessionId: "an-agent", workloadClass: "agent", health: "live" },
    ];
    await pool.refreshTerminalRoster();
    expect(pool.terminalShellBirth("other-window")).toBe("demo");
    expect(pool.terminalShellBirth("unbound-elsewhere")).toBeNull();
    expect(pool.terminalShellBirth("an-agent")).toBeUndefined();
    expect(pool.terminalShellBirth("never-heard-of")).toBeUndefined();
    pool.disposeTerminalPool();
    expect(pool.terminalShellBirth(bound.sessionId)).toBeUndefined();
  });

  it("hands a refused birth back to the asker and keeps its phase — but the opening birth and an unreachable fieldd fault", async () => {
    let answer: "answer" | "refuse" | "unreachable" = "answer";
    const client = {
      request: (method: string, params?: unknown) => {
        if (method === "terminal.create" && answer === "refuse") {
          return Promise.reject(
            new FielddRpcError(
              "PRECONDITION_FAILED",
              "Work could not be bound: its folder is gone",
              false,
              { set: "work" },
              -32009,
            ),
          );
        }
        if (method === "terminal.create" && answer === "unreachable") {
          return Promise.reject(new FielddRpcError("UNAVAILABLE", "not connected", true));
        }
        return fieldd.request(method, params);
      },
    } as unknown as PoolClient;
    pool.openTerminalPool(client, { sessionIds: [] });
    await settle();
    await pool.createTerminalSession({ workloadClass: "interactive" });
    expect(pool.terminalPoolSnapshot().phase).toBe("open");

    answer = "refuse";
    await expect(
      pool.createTerminalSession({ workloadClass: "interactive", profileSet: "work" }),
    ).rejects.toThrow("Work could not be bound: its folder is gone");
    expect(pool.terminalPoolSnapshot().fault).toBeNull();
    expect(pool.terminalPoolSnapshot().phase).toBe("open");

    // the deck's opening birth: nothing else would say why
    await expect(
      pool.createTerminalSession({ workloadClass: "interactive" }, undefined, { opening: true }),
    ).rejects.toThrow("Work could not be bound");
    expect(pool.terminalPoolSnapshot().fault?.plane).toBe("fieldd");

    pool.disposeTerminalPool();
    pool.configureTerminalPool({
      transport: "routed",
      defaultShell: "/bin/zsh",
      home: "/Users/test",
    });
    answer = "answer";
    pool.openTerminalPool(client, { sessionIds: [] });
    await settle();
    await pool.createTerminalSession({ workloadClass: "interactive" });
    answer = "unreachable";
    await expect(pool.createTerminalSession({ workloadClass: "interactive" })).rejects.toThrow(
      "not connected",
    );
    expect(pool.terminalPoolSnapshot().fault).toEqual({
      plane: "fieldd",
      message: "not connected",
    });
  });
});

// The debts lane (2026-10-12) — a floor read has ONE budget: the routed host
// refuses a `terminal.sessions` that never answered at its read's 5 s
// (`UNAVAILABLE {state: "timeout", timeoutMs}`), and that refusal is this
// read's lapse — said in the owner's name, and final for a lookup. Before,
// only the pool's own 10 s race was final: the host's refusal was retried,
// a fresh 5 s read each time.
describe("a floor read that does not answer has one budget, the routed host's", () => {
  const lapsed = (timeoutMs?: number) =>
    new FielddRpcError(
      "UNAVAILABLE",
      "terminal.sessions had no answer within 5000 ms",
      true,
      timeoutMs === undefined
        ? { service: "terminal", state: "timeout" }
        : { service: "terminal", state: "timeout", timeoutMs },
    );

  it("the host's 5 s refusal ends the lookup at once — one read, refused at 5 s in the floor's name, never five", async () => {
    vi.useFakeTimers();
    try {
      let reads = 0;
      listSessionsOverride = () => {
        reads += 1;
        return new Promise((_resolve, reject) => {
          setTimeout(() => reject(lapsed(5_000)), 5_000);
        });
      };
      pool.openTerminalPool(fieldd, { sessionIds: [] });
      await settle();
      const settled = vi.fn();
      const started = Date.now();
      pool.terminalSessionSummary("absent-1").then(settled, settled);
      await vi.advanceTimersByTimeAsync(5_000);
      expect(settled).toHaveBeenCalledTimes(1);
      expect(Date.now() - started).toBe(5_000);
      const refusal = settled.mock.calls[0]?.[0] as Error;
      expect(refusal).toBeInstanceOf(Error);
      expect(refusal.message).toBe("the floor did not answer in 5 s");
      // nothing more is asked after the refusal
      await vi.advanceTimersByTimeAsync(30_000);
      expect(reads).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("words the host's lapse in the owner's name, from its timeoutMs, and 5 s without one", async () => {
    await expect(pool.floorReadWithin(Promise.reject(lapsed(5_000)), "studio")).rejects.toThrow(
      /^studio did not answer in 5 s$/,
    );
    await expect(pool.floorReadWithin(Promise.reject(lapsed(3_000)), "studio")).rejects.toThrow(
      /^studio did not answer in 3 s$/,
    );
    await expect(pool.floorReadWithin(Promise.reject(lapsed()), "studio")).rejects.toThrow(
      /^studio did not answer in 5 s$/,
    );
    // any other refusal is the daemon's own words, carried whole
    const other = new FielddRpcError("UNAVAILABLE", "the terminal floor is not available", true, {
      service: "terminal",
      state: "absent",
    });
    await expect(pool.floorReadWithin(Promise.reject(other), "studio")).rejects.toBe(other);
  });

  it("keeps the pool's 10 s race as the outer guard for a read the host does not bound", async () => {
    vi.useFakeTimers();
    try {
      const settled = vi.fn();
      pool.floorReadWithin(new Promise(() => undefined), "studio").then(settled, settled);
      await vi.advanceTimersByTimeAsync(9_999);
      expect(settled).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(settled).toHaveBeenCalledWith(
        expect.objectContaining({ message: "studio did not answer in 10 s" }),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

// D6 — the routed host's word of a paste too large for one message reaches
// whoever says it (the line), from INSIDE the runtime's input call, and is in
// the log either way.
describe("a refused paste is said, never only dropped (D6)", () => {
  const tooLarge = {
    sessionId: "s-1",
    viewId: "v-1",
    activationId: "a-1",
    leaseEpoch: 7,
    inputSequence: 1,
    operation: { kind: "paste", text: "x".repeat(TERMINAL_PIPELINE.MAX_CONTROL_MESSAGE_BYTES) },
  };

  /** The pool's other lines (an open's own) are not this row's: only the refusal's are kept. */
  function recordingLogger(lines: string[]): RendererLogger {
    const keep = (line: string): void => {
      if (line.includes("input_refus")) lines.push(line);
    };
    const logger: RendererLogger = {
      child: () => logger,
      trace: () => undefined,
      debug: () => undefined,
      info: (event) => keep(`info ${event}`),
      warn: (event) => keep(`warn ${event}`),
      error: (event) => keep(`error ${event}`),
      fatal: () => undefined,
      isLevelEnabled: () => true,
    };
    return logger;
  }

  it("hands the refusal to each hearer as it happens, and logs it louder when no one heard", async () => {
    const previous = getRendererLogger();
    const lines: string[] = [];
    setRendererLogger(recordingLogger(lines));
    const heard: unknown[] = [];
    const stop = pool.hearTerminalInputRefusals((refusal) => heard.push(refusal));
    try {
      pool.openTerminalPool(fieldd, { sessionIds: [] });
      await settle();
      const host = (runtimeOptions[0] as { host?: { encodeInput?(context: unknown): unknown } })
        .host;

      expect(host?.encodeInput?.(tooLarge), "the runtime is handed nothing").toBeNull();
      expect(heard).toMatchObject([
        {
          sessionId: "s-1",
          kind: "paste",
          bytes: TERMINAL_PIPELINE.MAX_CONTROL_MESSAGE_BYTES,
        },
      ]);
      expect(lines).toEqual(["info renderer.terminal.input_refused"]);

      stop();
      expect(host?.encodeInput?.(tooLarge)).toBeNull();
      expect(heard, "an undone hearer hears nothing more").toHaveLength(1);
      expect(lines).toEqual([
        "info renderer.terminal.input_refused",
        "warn renderer.terminal.input_refused",
      ]);
    } finally {
      stop();
      setRendererLogger(previous);
    }
  });

  it("a hearer that throws cannot throw into the runtime's input call", async () => {
    const previous = getRendererLogger();
    const lines: string[] = [];
    const stops: Array<() => void> = [];
    setRendererLogger(recordingLogger(lines));
    try {
      pool.openTerminalPool(fieldd, { sessionIds: [] });
      await settle();
      const host = (runtimeOptions[0] as { host?: { encodeInput?(context: unknown): unknown } })
        .host;
      const heard: unknown[] = [];
      stops.push(
        pool.hearTerminalInputRefusals(() => {
          throw new Error("a broken line");
        }),
        pool.hearTerminalInputRefusals((refusal) => heard.push(refusal)),
      );

      expect(() => host?.encodeInput?.(tooLarge)).not.toThrow();
      expect(heard, "the next hearer is still told").toHaveLength(1);
      expect(lines).toEqual([
        "error renderer.terminal.input_refusal_unsaid",
        "info renderer.terminal.input_refused",
      ]);
    } finally {
      for (const stop of stops) stop();
      setRendererLogger(previous);
    }
  });
});
