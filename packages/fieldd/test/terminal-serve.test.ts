import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PORTS,
  ServeConfig,
  SOCKETS,
  TerminalRouteSnapshot,
  type TerminalRouteSnapshot as TerminalRouteSnapshotType,
} from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { bootstrap, type FielddDaemon } from "../src/index";
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

const snapshot = (revision: number, cells: ReturnType<typeof cell>[]): TerminalRouteSnapshotType =>
  ({ revision, cells }) as TerminalRouteSnapshotType;

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

/** A golden fixture from the contracts package, read the way the EL9 law means
 * it: ONE file, parsed on both sides. */
const contractsFixture = (name: string): unknown =>
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL(`../../contracts/fixtures/${name}`, import.meta.url)),
      "utf8",
    ),
  );

describe("TM-2 (F-H3) — the EL9 golden IS the spec this driver sends", () => {
  it("builds serve-config.routes.json out of terminal-routes.doors.json", () => {
    // The golden is not hand-written beside the code: it is what THIS function
    // produces from the route snapshot the floor's own fixture pins, so a
    // change to either side that drifts from the other reds here and in
    // field-native's `fixture_parity` at the same time.
    const spec = terminalServeSpec({
      routes: TerminalRouteSnapshot.parse(contractsFixture("terminal-routes.doors.json")),
      published: true,
      linkedLogin: "james@github",
    });
    expect(spec).toEqual(contractsFixture("serve-config.routes.json"));
  });

  it("and the contract can describe it — which is the whole of F-H3", () => {
    const parsed = ServeConfig.safeParse(contractsFixture("serve-config.routes.json"));
    expect(parsed.success, JSON.stringify(parsed.success ? "" : parsed.error.issues)).toBe(true);
  });
});

describe("TM-2 — the driver declares only on a real change", () => {
  function driver(initial: {
    routes?: TerminalRouteSnapshotType | undefined;
    published?: boolean;
    linkedLogin?: string | null;
  }) {
    const state: {
      routes: TerminalRouteSnapshotType | undefined;
      published: boolean;
      linkedLogin: string | null;
    } = {
      routes: initial.routes,
      published: initial.published ?? true,
      linkedLogin: initial.linkedLogin ?? LOGIN,
    };
    const declared: Array<ServeSpec | null> = [];
    let fail = false;
    /** F-M5 — the bridge RESOLVES without landing. This is the shape the wired
     * closure really produces (a mesh that is not up, an add the node refused,
     * a removal that failed); the throwing `fail` beside it is the rarer one. */
    let unlanded = false;
    const d = new TerminalServeDriver({
      routes: () => state.routes,
      published: () => state.published,
      linkedLogin: () => state.linkedLogin,
      declare: async (spec) => {
        if (fail) throw new Error("mesh is down");
        declared.push(spec);
        return !unlanded;
      },
    });
    return {
      d,
      state,
      declared,
      setFail: (v: boolean) => (fail = v),
      setUnlanded: (v: boolean) => (unlanded = v),
    };
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

  it("a declaration that RESOLVED WITHOUT LANDING is not remembered either (F-M5)", async () => {
    // The wired bridge goes through MeshClient, which is deliberately
    // non-throwing: a mesh that is not up marks every serve pending and
    // resolves, and an add the node refused is recorded as an error state and
    // resolves. A driver reading resolution as success would record a signature
    // for routes nothing was serving, and then decline to retry because the
    // signature had not moved — the listener would stay missing until a CELL
    // changed, which is the one thing that has nothing to do with the failure.
    const { d, state, declared, setUnlanded } = driver({
      routes: snapshot(1, [cell("cb-1", 51001)]),
    });
    setUnlanded(true);
    await d.refresh();
    expect(declared, "it was attempted").toHaveLength(1);

    // the readings have NOT moved, and the retry must still happen
    setUnlanded(false);
    await d.refresh();
    expect(declared).toHaveLength(2);

    // …and once it lands, the idempotence is back
    await d.refresh();
    state.routes = snapshot(2, [cell("cb-1", 51001)]);
    await d.refresh();
    expect(declared).toHaveLength(2);
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

/** UA-P-0a — the MeshClient's first reconcile has run (it reads the node's
 * inventory there before deciding anything). The marker a "publishes NOTHING"
 * row waits on when there is no linked login, since such a desktop declares no
 * serve at all and the old marker was the product serve appearing. */
const reconciled = (mock: MockMgmtServer) => mock.meshCalls.includes("native.mesh.serve.list");

/** Every serve.add that declared the terminal listener, in order. */
const terminalAdds = (mock: MockMgmtServer) =>
  mock.meshAddParams.filter((p) => p["serveId"] === TERMINAL_SERVE_ID);

/** F-H2 — what this device most recently said about its terminal doors.
 *
 * UA-P-0e (D2): read from the SELF ROW of the daemon's own roster, not from the
 * `field.devices.v1` slice, because there is no slice — nothing content-bearing
 * rides the bus until truffle can scope a store to a login. The FACT is the
 * same one; a remote reader gets it through this desktop's door. */
const publishedTerminalMesh = (daemon: FielddDaemon): boolean | undefined =>
  daemon.devices.list().find((d) => d.self)?.capabilities?.terminalMesh;

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
    // UA-P-0e — the product door's TAILNET listener is the registry's fixed
    // port now, not the ephemeral loopback control port. A peer DERIVES the
    // coordinate (there is no published slice to learn one from), and a
    // derivation needs a number that is the same on every device.
    expect(product.listenPort).toBe(PORTS.FIELDD_PRODUCT_SERVE);
    expect(product.listenPort).not.toBe(daemon.controlPort);
    expect(mock.meshServes.get(TERMINAL_SERVE_ID)?.listenPort).toBe(PORTS.TERMINAL_CELLS_SERVE);
    // the two listeners are distinct — a collision would have been refused
    expect(product.listenPort).not.toBe(PORTS.TERMINAL_CELLS_SERVE);
    // F-H2 — with the serve really up and carrying a route, the capability a
    // remote reader reads says so
    await poll(() => (publishedTerminalMesh(daemon) === true ? true : undefined));
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
    const { daemon, mock } = await boot({ terminalMesh: true, login: null });
    // UA-P-0a — "the daemon got that far" can no longer be the product serve:
    // with no linked login there IS no product serve to wait for (an unlinked
    // desktop is offline, and the serve used to be declared allow-less, which
    // the sidecar reads as "anyone the tailnet verified"). The serve
    // SUBSCRIPTION is the marker instead — the MeshClient opens it on its first
    // reconcile whatever the desired set turns out to be.
    await poll(() => (reconciled(mock) ? true : undefined));
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(terminalAdds(mock)).toEqual([]);
    // F-H2 — and this device says so. The FLOOR's `terminalMesh` is true here;
    // the daemon's three gates still published nothing, and the capability a
    // remote reader draws its card from answers off what is SERVING.
    expect(publishedTerminalMesh(daemon), "a pre-capture desktop is not attachable").toBe(false);
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

  it("an add the NODE refused is not remembered, and the next change retries it (F-M5)", async () => {
    // MeshClient does not throw on a refused add — it records the serve in
    // `error` and resolves. A driver reading resolution as success would
    // remember the signature and then decline to retry, so the listener would
    // stay down until a CELL changed, which is the one event that has nothing
    // to do with the failure.
    const { mock } = await boot({ terminalMesh: true, login: LOGIN });
    await poll(() => terminalAdds(mock)[0]);

    mock.failNextServeAdd = true;
    mock.pushRoutesDelta(snapshot(2, [cell("cb-1", 51001), cell("cb-2", 51002)]));
    await poll(() => terminalAdds(mock)[1]);
    expect(mock.meshServes.has(TERMINAL_SERVE_ID), "the node refused it").toBe(false);

    // the READINGS have not moved — the same two cells, a new revision — and
    // the declaration must still be attempted again
    mock.pushRoutesDelta(snapshot(3, [cell("cb-1", 51001), cell("cb-2", 51002)]));
    const retried = await poll(() => terminalAdds(mock)[2]);
    expect(retried["routes"]).toEqual([
      { prefix: "/cell/cb-1", targetPort: 51001 },
      { prefix: "/cell/cb-2", targetPort: 51002 },
    ]);
    expect(mock.meshServes.has(TERMINAL_SERVE_ID)).toBe(true);
  });

  it("a removal that FAILED leaves the OLD routes declared, not the new ones (F-M5)", async () => {
    // truffle has no upsert, so a route change is remove-then-add. When the
    // remove fails the old proxy is still live — and MeshClient's reconcile
    // SKIPS a serveId the node already lists, so swapping the desired spec
    // would record the NEW routes as `active` over a listener serving the OLD
    // ones. `remoteEndpoints` mints off exactly that reading, so the daemon
    // would hand a phone a ticket for a path the sidecar answers 404 for.
    const { daemon, mock } = await boot({ terminalMesh: true, login: LOGIN });
    await poll(() => terminalAdds(mock)[0]);
    const addsBefore = terminalAdds(mock).length;

    mock.failNextServeRemove = true;
    mock.pushRoutesDelta(snapshot(2, [cell("cb-1", 51001), cell("cb-2", 51002)]));
    await poll(() => (mock.meshRemoveCalls > 0 ? true : undefined));
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(terminalAdds(mock).length, "nothing was added over the live proxy").toBe(addsBefore);
    const serve = daemon.mesh.serves().find((x) => (x.serveId ?? x.name) === TERMINAL_SERVE_ID);
    expect(
      serve?.routes?.map((r) => r.prefix),
      "the fused view still names what is really being served",
    ).toEqual(["/cell/cb-1"]);

    // and the next change retries the whole dance, now that the remove works
    mock.pushRoutesDelta(snapshot(3, [cell("cb-1", 51001), cell("cb-2", 51002)]));
    const landed = await poll(() => terminalAdds(mock)[addsBefore]);
    expect(landed["routes"]).toEqual([
      { prefix: "/cell/cb-1", targetPort: 51001 },
      { prefix: "/cell/cb-2", targetPort: 51002 },
    ]);
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

  // 2026-10-17 — on a fresh pair start (23:56Z and 00:33Z, James's dev app) the
  // floor's mesh node came up a second AFTER fieldd's boot, and fieldd never
  // published the terminal doors until fieldd alone was restarted: the phone
  // read "not publishing its terminal doors". The candidates are in
  // draft/handover/2026-10-17-focus-audit.md §3 (serve-driver); this row is
  // candidate (a): a declaration the down node refused, and nothing that
  // re-declares it when the node comes up.
  it("a declaration refused while the mesh node was down lands when the node comes up — and nothing else changed", async () => {
    const meshUnit = (state: string) => ({
      state: "up",
      bootId: "floor-boot-1",
      units: [{ unit: "mesh-gateway", state }],
    });
    const { daemon, mock } = await boot({
      terminalMesh: true,
      login: LOGIN,
      seed: (m) => {
        m.meshUnavailable = true;
        m.healthSnapshot = meshUnit("starting");
      },
    });
    // fieldd asked; the down node refused; nothing is published
    await poll(() => (mock.meshCalls.includes("native.mesh.serve.remove") ? true : undefined));
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(terminalAdds(mock)).toEqual([]);
    expect(publishedTerminalMesh(daemon)).toBe(false);

    // the node comes up — the ONLY change: no route moved, no link event
    mock.meshUnavailable = false;
    mock.pushHealth(meshUnit("up"));
    const landed = await poll(() => terminalAdds(mock)[0]);
    expect(landed["routes"]).toEqual([{ prefix: "/cell/cb-1", targetPort: 51001 }]);
    await poll(() => (publishedTerminalMesh(daemon) === true ? true : undefined));
  });
});
