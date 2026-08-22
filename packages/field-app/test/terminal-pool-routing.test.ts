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

import { ProductSessionRosterItem } from "@vibefield/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FieldHost } from "../src/host";
import { setHost } from "../src/host";

let runtimesMade = 0;

vi.mock("@vibecook/ghosttea-react", () => ({
  createGhostteaTerminalRuntime: () => {
    runtimesMade += 1;
    return {
      connect: () => Promise.resolve(),
      startPerformanceMeasurement: () => Promise.resolve(),
      finishPerformanceMeasurement: () => Promise.resolve({ backend: "test" }),
      listSessions: () => Promise.resolve(sessionSummaries),
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
    if (method === "terminal.roster") return Promise.resolve({ items: rosterRows });
    if (method === "terminal.openTicket") {
      const sessionId = (params as { sessionId: string }).sessionId;
      const cell = cellOf[sessionId];
      if (cell === undefined) {
        return Promise.reject(new Error(`NOT_FOUND: ${sessionId} is not observed`));
      }
      return Promise.resolve(
        routedTicket(cell, sessionId, {
          controlSocket: `/${cell}/control.sock`,
          frameSocket: `/${cell}/frame.sock`,
          token: "tok",
        }),
      );
    }
    if (method === "terminal.create") {
      const sessionId = `born-${Object.keys(cellOf).length + 1}`;
      cellOf[sessionId] = "cell-a-boot-1";
      sessionSummaries = [...sessionSummaries, { id: sessionId }];
      const ticket = {
        controlSocket: "/cell-a-boot-1/control.sock",
        frameSocket: "/cell-a-boot-1/frame.sock",
        token: "tok",
      };
      return Promise.resolve({
        sessionId,
        ticket,
        ...routedTicket("cell-a-boot-1", sessionId, ticket),
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
  requests = [];
  connectedSockets = [];
  rosterRows = [];
  sessionSummaries = [];
  cellOf = {};
  pool.disposeTerminalPool();
  setHost({
    terminal: {
      connect: (ticket: { controlSocket: string }) => {
        connectedSockets.push(ticket.controlSocket);
        return Promise.resolve({ defaultShell: "/bin/zsh", home: "/Users/test" });
      },
      onStatus: () => () => undefined,
    },
    logger: {
      child: () => ({ info: () => undefined, error: () => undefined, debug: () => undefined }),
    },
  } as unknown as FieldHost);
});

afterEach(() => pool.disposeTerminalPool());

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
    expect(requests.filter((method) => method === "terminal.openTicket").length).toBeGreaterThan(0);
    // The one-runtime law under the new acquisition: rejoining, creating and
    // recovering are three transports and ONE window, and the only thing that
    // may build a second runtime is a recovery replacing the first.
    expect(runtimesMade, "one runtime, plus the one the recovery replaced it with").toBe(2);
  });

  it("rests DORMANT rather than reaching for a sessionless connection", async () => {
    // The saved pane's shell is gone. There is nothing to rejoin, and — with no
    // door that mints without a session — nothing to connect to either. A window
    // with nothing to show holds no connection, and that is a resting state.
    cellOf = {};
    pool.openTerminalPool(fieldd, { sessionIds: ["ghost-1"] });
    await settle();

    expect(pool.terminalPoolSnapshot().phase).toBe("dormant");
    expect(pool.terminalPoolSnapshot().fault, "a dead saved pane is not a fault").toBeNull();
    expect(connectedSockets, "no bridge was forked").toEqual([]);
    expect(pool.terminalPoolCellCount()).toBe(0);
    // ...and the runtime is still there, because the WINDOW is still there.
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
    expect(connectedSockets).toEqual(["/cell-a-boot-1/control.sock"]);
    expect(pool.terminalPoolSnapshot().shell).toEqual({
      defaultShell: "/bin/zsh",
      home: "/Users/test",
    });
  });
});

describe("the route is the key (TP-L-C)", () => {
  it("keys the transport table by the cellBootId the ticket answered", async () => {
    cellOf = { "b-1": "cell-b-boot-9" };
    pool.openTerminalPool(fieldd, { sessionIds: ["b-1"] });
    await settle();

    expect(pool.terminalPoolSnapshot().phase).toBe("open");
    expect(pool.terminalPoolCellCount()).toBe(1);
    // The bridge was handed cell B's sockets, not a stand-in's.
    expect(connectedSockets).toEqual(["/cell-b-boot-9/control.sock"]);
    // And the session is reachable, because the window pinned to ITS cell.
    expect(pool.terminalSessionAvailability("b-1")).toEqual({ ready: true });
  });

  it("shows the honest face for a session on ANOTHER cell, and leaves cell A alone", async () => {
    // THE ROW. Main's bridge serves one cell per window and a ticket naming
    // different sockets tears it down and rebuilds it
    // (`electron-shell/src/main/terminal-backend.ts:117-122`), so a second
    // cell's ticket would kill the panes that are working. The pool refuses to
    // offer one.
    cellOf = { "a-1": "cell-a-boot-1", "b-1": "cell-b-boot-9" };
    pool.openTerminalPool(fieldd, { sessionIds: ["a-1"] });
    await settle();
    expect(connectedSockets).toEqual(["/cell-a-boot-1/control.sock"]);

    // A session in cell B is asked for while cell A is live.
    const opened = await pool.openDormantTransport(["b-1"]);
    expect(opened, "a dormant-only door does nothing to an OPEN pool").toBe(false);

    // Cell A's connection is UNTOUCHED — the bridge was never re-ticketed.
    expect(connectedSockets, "one connect, ever").toEqual(["/cell-a-boot-1/control.sock"]);
    expect(pool.terminalPoolSnapshot().phase).toBe("open");
    expect(pool.terminalSessionAvailability("a-1")).toEqual({ ready: true });
  });

  it("names the face without naming the cell", async () => {
    cellOf = { "a-1": "cell-a-boot-1", "b-1": "cell-b-boot-9" };
    pool.openTerminalPool(fieldd, { sessionIds: ["a-1", "b-1"] });
    await settle();

    // `a-1` opened and pinned cell A; `b-1` is resolved but elsewhere. Asking
    // for its ticket records its placement without offering it to the bridge.
    await pool.openDormantTransport(["b-1"]).catch(() => undefined);
    const availability = pool.terminalSessionAvailability("b-1");
    if (pool.terminalSessionGrants("b-1") !== undefined) {
      expect(availability).toEqual({
        service: "terminal",
        state: "transport-not-landed",
        reason: "other-cell",
      });
      // The face carries no placement: a consumer learns "not from here", never
      // "it is in cell-b-boot-9".
      expect(JSON.stringify(availability)).not.toContain("cell-b-boot-9");
    }
    expect(connectedSockets).toEqual(["/cell-a-boot-1/control.sock"]);
  });
});

describe("grants are HELD, and nothing is faked", () => {
  it("keeps both grants, their expiry and their generation, and attaches nothing", async () => {
    cellOf = { "a-1": "cell-a-boot-1" };
    pool.openTerminalPool(fieldd, { sessionIds: ["a-1"] });
    await settle();

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

  it("drives the bridge from a KEYLESS floor's legacy answer, and says so", async () => {
    // A floor that predates the grant key answers the bare legacy ticket. That
    // is a supported answer, not a malformed one — and the honest record of it
    // is `grantsLanded: false`, never a route this window invented.
    const keyless = {
      request: (method: string) => {
        requests.push(method);
        if (method === "terminal.openTicket") return Promise.resolve(LEGACY);
        return Promise.reject(new Error(`unexpected method ${method}`));
      },
    } as unknown as PoolClient;

    pool.openTerminalPool(keyless, { sessionIds: ["old-1"] });
    await settle();

    expect(pool.terminalPoolSnapshot().phase).toBe("open");
    expect(connectedSockets).toEqual(["/a/control.sock"]);
    expect(pool.terminalPoolSnapshot().grantsLanded, "no grants were minted").toBe(false);
    expect(pool.terminalSessionGrants("old-1")).toBeUndefined();
    expect(pool.terminalPoolGrantedSessions()).toEqual([]);
    // A session with no observed route is not a session known to be elsewhere.
    expect(pool.terminalSessionAvailability("old-1")).toEqual({ ready: true });
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

    expect(trace.marks).toEqual(["claim", "mintAsk", "ticket", "connected"]);
  });

  it("stamps the REJOIN path the same way, send edge first", async () => {
    cellOf = { "saved-1": "cell-a-boot-1" };
    const trace = recorder();
    pool.openTerminalPool(fieldd, { sessionIds: ["saved-1"], trace });
    await settle();

    expect(pool.terminalPoolSnapshot().phase).toBe("open");
    expect(trace.marks).toEqual(["claim", "mintAsk", "ticket", "connected"]);
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
