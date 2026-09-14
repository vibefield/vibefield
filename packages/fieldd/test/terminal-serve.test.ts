import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PORTS, SOCKETS, type TerminalRouteSnapshot } from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { bootstrap } from "../src/index";
import type { ServeSpec } from "../src/mesh-client";
import {
  cellDoorPort,
  cellRoutesFor,
  serveAllowGlob,
  TERMINAL_SERVE_ID,
  TerminalServeDriver,
  terminalServeSignature,
  terminalServeSpec,
} from "../src/terminal-serve";
import { MockMgmtServer } from "../src/testing/mock-mgmt";
import { nativeEndpoint } from "./native-harness";

// TM-2 (thinking-terminal-mesh-cells.md §3 T, TM-D2) — THE TERMINAL ROUTES.
//
// Two halves, deliberately:
//   · the POLICY, pure — which readings produce which serve, and what the
//     change key is. Everything security-load-bearing is decided here.
//   · the WIRING, against the mock floor — that daemon.ts actually drives the
//     policy off the hello and the route stream, and that a route change is
//     the remove-then-add the truffle API forces. A policy nothing calls is
//     the failure mode this second half exists to catch (the tests lens,
//     2026-09-13, which found exactly that shape in the field publisher).

const LOGIN = "james@github";
const OTHER = "/mock/native/run";

function cell(bootId: string, port: number | undefined, extra: Record<string, unknown> = {}) {
  return {
    cellInstanceId: 1,
    cellBootId: bootId,
    pid: 4242,
    endpoints: {
      controlSocket: `${OTHER}/termctl.1.sock`,
      frameSocket: `${OTHER}/termframe.1.sock`,
      authToken: "per-boot-token",
    },
    tokenGeneration: 1,
    ...(port === undefined
      ? {}
      : {
          doors: {
            controlUrl: `ws://127.0.0.1:${port}/control`,
            framesUrl: `ws://127.0.0.1:${port}/frames`,
          },
        }),
    ...extra,
  };
}

const snapshot = (revision: number, cells: ReturnType<typeof cell>[]): TerminalRouteSnapshot =>
  ({ revision, cells }) as TerminalRouteSnapshot;

describe("TM-2 — which readings publish a terminal route, and which refuse", () => {
  const base = {
    routes: snapshot(3, [cell("cb-1", 51001)]),
    published: true,
    linkedLogin: LOGIN,
  };

  it("publishes one stripping route per cell on the registry's own listener", () => {
    const spec = terminalServeSpec({
      ...base,
      routes: snapshot(3, [cell("cb-1", 51001), cell("cb-2", 51002)]),
    });
    expect(spec).toEqual({
      serveId: TERMINAL_SERVE_ID,
      name: TERMINAL_SERVE_ID,
      listenPort: PORTS.TERMINAL_CELLS_SERVE,
      target: { kind: "routes" },
      tls: false,
      allow: [LOGIN],
      routes: [
        { prefix: "/cell/cb-1", targetPort: 51001 },
        { prefix: "/cell/cb-2", targetPort: 51002 },
      ],
    } satisfies ServeSpec);
  });

  it("REFUSES without a linked login — an empty allow list is the whole tailnet", () => {
    // truffle RFC 023 §9.7: `allow: []` means every node the tailnet ACLs
    // admit. The product door survives that (scopes + the guest choke are
    // behind it); a cell door's only other wall is the grant.
    expect(terminalServeSpec({ ...base, linkedLogin: null })).toBeNull();
  });

  it("REFUSES when the floor has not published its doors (MF-1l)", () => {
    expect(terminalServeSpec({ ...base, published: false })).toBeNull();
  });

  it("REFUSES when there is nothing routable — no snapshot, no cells, no doors", () => {
    expect(terminalServeSpec({ ...base, routes: undefined })).toBeNull();
    expect(terminalServeSpec({ ...base, routes: snapshot(4, []) })).toBeNull();
    // a keyless-bootstrap / pre-TP cell reports no doors: a route to nothing
    // answers a dial with a refused connection instead of a 404
    expect(
      terminalServeSpec({ ...base, routes: snapshot(4, [cell("cb-1", undefined)]) }),
    ).toBeNull();
  });

  it("drops only the unroutable cell, never the whole serve", () => {
    const spec = terminalServeSpec({
      ...base,
      routes: snapshot(5, [cell("cb-1", undefined), cell("cb-2", 51002)]),
    });
    expect(spec?.routes).toEqual([{ prefix: "/cell/cb-2", targetPort: 51002 }]);
  });

  it("skips a cell whose two doors disagree about the port", () => {
    // one route carries one target; a cell serves both paths on one listener
    // by construction, so a row that disagrees is a floor this build does not
    // understand — and sending frames to the control port would be silent.
    const split = cell("cb-1", 51001);
    split.doors = {
      controlUrl: "ws://127.0.0.1:51001/control",
      framesUrl: "ws://127.0.0.1:9/frames",
    };
    expect(cellDoorPort(split)).toBeUndefined();
    expect(cellRoutesFor(snapshot(6, [split]))).toEqual([]);
  });

  it("escapes a login's glob metacharacters, in one shared spelling", () => {
    // the sidecar matches with Go path.Match; a `?` in an address would
    // otherwise widen the gate by one character
    expect(serveAllowGlob("a?b*c[d\\e@x")).toBe("a\\?b\\*c\\[d\\\\e@x");
    expect(terminalServeSpec({ ...base, linkedLogin: "a?b@x" })?.allow).toEqual(["a\\?b@x"]);
  });

  it("keys change on what the SERVE carries, not on the snapshot's revision", () => {
    // re-declaring costs every live connection on the listener, and the route
    // revision moves on facts this serve does not carry (a token rotation, a
    // pid) and resets across floor boots
    const at = (revision: number) =>
      terminalServeSignature(
        terminalServeSpec({ ...base, routes: snapshot(revision, [cell("cb-1", 51001)]) }),
      );
    expect(at(3)).toBe(at(9));
    expect(at(3)).not.toBe(
      terminalServeSignature(
        terminalServeSpec({ ...base, routes: snapshot(3, [cell("cb-1", 51002)]) }),
      ),
    );
    expect(at(3)).not.toBe(
      terminalServeSignature(terminalServeSpec({ ...base, linkedLogin: "b@x" })),
    );
    expect(terminalServeSignature(null)).toBe("none");
  });
});

describe("TM-2 — the driver declares only on a real change", () => {
  function driver(initial: {
    routes?: TerminalRouteSnapshot | undefined;
    published?: boolean;
    linkedLogin?: string | null;
  }) {
    const state = {
      routes: initial.routes,
      published: initial.published ?? true,
      linkedLogin: initial.linkedLogin ?? LOGIN,
    };
    const declared: Array<ServeSpec | null> = [];
    let fail = false;
    const d = new TerminalServeDriver({
      routes: () => state.routes,
      published: () => state.published,
      linkedLogin: () => state.linkedLogin,
      declare: async (spec) => {
        if (fail) throw new Error("mesh is down");
        declared.push(spec);
      },
    });
    return { d, state, declared, setFail: (v: boolean) => (fail = v) };
  }

  it("is idempotent across a re-pair that replays the same rows", async () => {
    const { d, state, declared } = driver({ routes: snapshot(1, [cell("cb-1", 51001)]) });
    await d.refresh();
    expect(declared).toHaveLength(1);
    // the floor re-pairs and re-sends: a NEW revision, the SAME cells
    state.routes = snapshot(2, [cell("cb-1", 51001)]);
    await d.refresh();
    await d.refresh();
    expect(declared, "a replayed snapshot must not bounce the listener").toHaveLength(1);
  });

  it("declares the WITHDRAWAL once when its first reading is nothing (F-H1)", async () => {
    // A fresh driver has declared nothing, which is not the same as having
    // declared "publish nothing": the floor outlives fieldd, so the listener a
    // predecessor left behind is still up and only this daemon will ever take
    // it down. The first refresh therefore declares even a null spec — and the
    // second, answering the same way, still must not bounce the node.
    const { d, state, declared } = driver({ routes: undefined });
    await d.refresh();
    expect(declared).toEqual([null]);
    state.published = false;
    await d.refresh();
    expect(declared, "the same answer twice is not news").toEqual([null]);
  });

  it("declares that withdrawal ONCE across all three refusals", async () => {
    // the floor's word, then the login, then routability: three different
    // reasons to publish nothing, one declaration between them
    const { d, state, declared } = driver({ published: false });
    await d.refresh();
    state.published = true;
    state.linkedLogin = null;
    await d.refresh();
    state.linkedLogin = LOGIN;
    state.routes = snapshot(1, []);
    await d.refresh();
    expect(declared).toEqual([null]);
  });

  it("withdraws when the last cell exits and re-declares when one returns", async () => {
    const { d, state, declared } = driver({ routes: snapshot(1, [cell("cb-1", 51001)]) });
    await d.refresh();
    state.routes = snapshot(2, []);
    await d.refresh();
    state.routes = snapshot(3, [cell("cb-2", 51005)]);
    await d.refresh();
    expect(declared.map((s) => s?.routes?.map((r) => r.prefix) ?? null)).toEqual([
      ["/cell/cb-1"],
      null,
      ["/cell/cb-2"],
    ]);
  });

  it("a failed declaration is NOT remembered as declared — the next change retries it", async () => {
    const { d, state, declared, setFail } = driver({ routes: snapshot(1, [cell("cb-1", 51001)]) });
    setFail(true);
    await d.refresh();
    expect(declared).toEqual([]);
    setFail(false);
    // the readings have not moved; only a re-armed retry can publish now
    state.routes = snapshot(2, [cell("cb-1", 51001)]);
    await d.refresh();
    expect(declared).toHaveLength(1);
  });

  it("stops reconciling once disposed", async () => {
    const { d, state, declared } = driver({ routes: snapshot(1, [cell("cb-1", 51001)]) });
    d.dispose();
    state.routes = snapshot(2, [cell("cb-9", 51009)]);
    await d.refresh();
    expect(declared).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The wiring: daemon.ts really drives this off the floor's hello + route stream.

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) {
    try {
      await fn();
    } catch {
      /* an already-stopped daemon is fine */
    }
  }
  cleanup = [];
});

async function poll<T>(fn: () => T | undefined, ms = 5_000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = fn();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`poll timed out after ${ms}ms`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function boot(opts: {
  terminalMesh: boolean | null;
  login: string | null;
  /** F-H1 — scripted NODE state to exist BEFORE this daemon connects: the
   * serve a previous fieldd left behind in the floor, which outlives it. The
   * mock keeps its serves across a disconnect by default, exactly as the floor
   * does. */
  seed?: (mock: MockMgmtServer) => void;
}) {
  const dataDir = mkdtempSync(join(tmpdir(), "vf-tm-serve-"));
  cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
  mkdirSync(join(dataDir, "native", "run"), { recursive: true });
  writeFileSync(join(dataDir, "native", "pairing"), "ab".repeat(32));
  if (opts.login !== null) {
    mkdirSync(join(dataDir, "fieldd"), { recursive: true });
    writeFileSync(
      join(dataDir, "fieldd", "link.json"),
      JSON.stringify({
        login: opts.login,
        tailnet: "tail1234.ts.net",
        linkedAt: "2026-09-14T00:00:00.000Z",
      }),
    );
  }
  const mock = new MockMgmtServer(nativeEndpoint(dataDir, SOCKETS.MGMT));
  await mock.start();
  cleanup.push(() => mock.stop());
  mock.helloTerminalMesh = opts.terminalMesh;
  mock.helloTerminal = {
    controlSocket: `${OTHER}/termctl.1.sock`,
    frameSocket: `${OTHER}/termframe.1.sock`,
    authToken: "per-boot-token",
  };
  mock.terminalRoutes = snapshot(1, [cell("cb-1", 51001)]);
  opts.seed?.(mock);

  const daemon = await bootstrap({ dataDir, controlPort: 0, dataPort: 0 });
  cleanup.push(() => daemon.stop());
  return { daemon, mock };
}

/** Every serve.add that declared the terminal listener, in order. */
const terminalAdds = (mock: MockMgmtServer) =>
  mock.meshAddParams.filter((p) => p["serveId"] === TERMINAL_SERVE_ID);

describe("TM-2 — daemon.ts drives the routes off the floor's own readings", () => {
  it("publishes the cell route beside the product door's secret path", async () => {
    const { daemon, mock } = await boot({ terminalMesh: true, login: LOGIN });
    const declared = await poll(() => terminalAdds(mock)[0]);
    expect(declared["listenPort"]).toBe(PORTS.TERMINAL_CELLS_SERVE);
    expect(declared["target"]).toEqual({ kind: "routes" });
    expect(declared["routes"]).toEqual([{ prefix: "/cell/cb-1", targetPort: 51001 }]);
    expect(declared["allow"]).toEqual([LOGIN]);
    expect(declared["tls"]).toBe(false);
    // …and the product serve is STILL THERE, on its own listener, with its own
    // secret path. One tailnet port would have been nicer; truffle has no
    // route update, and bouncing this one on cell churn is the price.
    const product = await poll(() => mock.meshServes.get("product"));
    expect(product.listenPort).toBe(daemon.controlPort);
    expect(mock.meshServes.get(TERMINAL_SERVE_ID)?.listenPort).toBe(PORTS.TERMINAL_CELLS_SERVE);
    // the two listeners are distinct — a collision would have been refused
    expect(product.listenPort).not.toBe(PORTS.TERMINAL_CELLS_SERVE);
  });

  it("publishes NOTHING when the floor says its doors are not on the tailnet", async () => {
    const { mock } = await boot({ terminalMesh: false, login: LOGIN });
    await poll(() => mock.meshServes.get("product")); // the daemon got that far
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(terminalAdds(mock)).toEqual([]);
  });

  it("publishes NOTHING against a floor that predates the field", async () => {
    // absence is read as NO: this plane outlives fieldd, so an older floor is
    // the ordinary case, and a tappable card for an unattachable PTY is the
    // failure the field exists to prevent
    const { mock } = await boot({ terminalMesh: null, login: LOGIN });
    await poll(() => mock.meshServes.get("product"));
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(terminalAdds(mock)).toEqual([]);
  });

  it("publishes NOTHING with no linked login, however many doors are up", async () => {
    const { mock } = await boot({ terminalMesh: true, login: null });
    await poll(() => mock.meshServes.get("product"));
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(terminalAdds(mock)).toEqual([]);
  });

  it("WITHDRAWS a listener this daemon inherited but no longer calls for (F-H1)", async () => {
    // The scenario the review named: fieldd died, the FLOOR kept serving — a
    // serve lives in the node and only an unlink-retire clears it there — and
    // the next fieldd boots with no captured login, so its policy publishes
    // nothing. A driver that remembered "none" from birth would recognise its
    // own answer and declare nothing at all, leaving 9422 listening on the
    // tailnet behind the PREDECESSOR's allow-list, routed at loopback ports the
    // OS has since handed to other programs.
    const { mock } = await boot({
      terminalMesh: true,
      login: null,
      seed: (m) =>
        m.meshServes.set(TERMINAL_SERVE_ID, {
          serveId: TERMINAL_SERVE_ID,
          name: TERMINAL_SERVE_ID,
          listenPort: PORTS.TERMINAL_CELLS_SERVE,
          target: { kind: "routes" },
          url: `http://mock.ts.net:${PORTS.TERMINAL_CELLS_SERVE}`,
        }),
    });
    await poll(() => (mock.meshRemovedServeIds.includes(TERMINAL_SERVE_ID) ? true : undefined));
    expect(mock.meshServes.has(TERMINAL_SERVE_ID), "the node is no longer serving it").toBe(false);
    expect(terminalAdds(mock), "and nothing was published in its place").toEqual([]);
  });

  it("a cell birth is a remove-then-add of the terminal serve alone", async () => {
    const { mock } = await boot({ terminalMesh: true, login: LOGIN });
    await poll(() => terminalAdds(mock)[0]);
    const productRemovesBefore = mock.meshRemovedServeIds.filter((id) => id === "product").length;

    mock.pushRoutesDelta(snapshot(2, [cell("cb-1", 51001), cell("cb-2", 51002)]));
    const second = await poll(() => terminalAdds(mock)[1]);
    expect(second["routes"]).toEqual([
      { prefix: "/cell/cb-1", targetPort: 51001 },
      { prefix: "/cell/cb-2", targetPort: 51002 },
    ]);
    // the terminal listener was taken down first (truffle has no upsert)…
    expect(mock.meshRemovedServeIds).toContain(TERMINAL_SERVE_ID);
    // …and the PRODUCT door was not touched, which is the whole reason the
    // cell routes live on a listener of their own
    expect(mock.meshRemovedServeIds.filter((id) => id === "product").length).toBe(
      productRemovesBefore,
    );
  });
});
