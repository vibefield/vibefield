// DS-1b (2026-10-01) — the production rewriter (src/egress-cell-rewriter.ts):
// a window's forwarded ticket rides ONE egress route per owner desktop to its
// cell serve, both doors re-homed onto the route's loopback listener with
// path and query kept; no road is `egress_unavailable`; the route comes down
// when the owner leaves the roster and at daemon stop.
import {
  type MeshEgressRouteAddParams,
  type MeshEgressRouteBound,
  type MeshEgressRouteTable,
  PORTS,
  type RemoteCellEndpointSet,
  remoteCellEndpointsFor,
} from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import {
  type EgressRoster,
  type EgressRouteFacade,
  EgressRoutes,
  FakeEgressRoutes,
} from "../src/egress";
import { EgressCellRewriter } from "../src/egress-cell-rewriter";
import { RpcCallError } from "../src/native-link";
import { loopbackCellEndpoints } from "../src/remote-cell-rewriter";

const CELLS = PORTS.TERMINAL_CELLS_SERVE;
const OWNER = "dev-a";
const OWNER_HOST = "desk-a.tail1234.ts.net";
const doorsOf = (host: string, cell: string) =>
  remoteCellEndpointsFor(`http://${host}:${CELLS}`, cell) as RemoteCellEndpointSet;
const OWNER_DOORS = doorsOf(OWNER_HOST, "cell-a");
const LISTEN = "127.0.0.1:61234";

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
  cleanup = [];
});

async function until(fn: () => boolean, ms = 4000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > deadline) throw new Error("until: timeout");
    await new Promise((r) => setTimeout(r, 10));
  }
}

function overFake(): { routes: FakeEgressRoutes; rewriter: EgressCellRewriter } {
  const routes = new FakeEgressRoutes();
  const rewriter = new EgressCellRewriter({ routes });
  cleanup.push(() => rewriter.dispose());
  return { routes, rewriter };
}

/** A floor whose route table the test reads: every add binds the next port. */
function scriptedFacade(): EgressRouteFacade & {
  adds: MeshEgressRouteAddParams[];
  removed: string[];
} {
  const adds: MeshEgressRouteAddParams[] = [];
  const removed: string[] = [];
  let port = 53_000;
  let revision = 0;
  return {
    adds,
    removed,
    egressRouteAdd: async (params): Promise<MeshEgressRouteBound> => {
      adds.push(params);
      revision += 1;
      return { id: params.id, listen: `127.0.0.1:${port++}`, revision, bootId: "floor-boot-1" };
    },
    egressRouteRemove: async (id) => {
      removed.push(id);
      return { id };
    },
    subscribeEgressRoutes: async () => ({
      snapshot: { routes: [], revision: 0, bootId: "floor-boot-1" } as MeshEgressRouteTable,
      dispose: () => {},
    }),
  };
}

function roster(hosts: Record<string, string>): EgressRoster & { changed(): void } {
  const listeners = new Set<() => void>();
  return {
    hostFor: (id) => hosts[id],
    onChange: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    changed: () => {
      for (const fn of listeners) fn();
    },
  };
}

describe("DS-1b — EgressCellRewriter, the swap", () => {
  it("re-homes BOTH legs onto the route's loopback listener, the path kept", async () => {
    const { routes, rewriter } = overFake();
    routes.route(OWNER, CELLS, LISTEN);
    expect(await rewriter.rewrite(OWNER, OWNER_DOORS)).toEqual({
      controlUrl: `ws://${LISTEN}/cell/cell-a/control`,
      framesUrl: `ws://${LISTEN}/cell/cell-a/frames`,
    });
    expect(routes.asked).toEqual([{ peerDeviceId: OWNER, port: CELLS }]);
  });

  it("holds ONE route per owner desktop, however many tickets — and another owner gets its own", async () => {
    const { routes, rewriter } = overFake();
    routes.route(OWNER, CELLS, LISTEN);
    routes.route("dev-c", CELLS, "127.0.0.1:61235");
    await rewriter.rewrite(OWNER, OWNER_DOORS);
    await rewriter.rewrite(OWNER, doorsOf(OWNER_HOST, "cell-a2")); // another cell, same desktop
    await Promise.all([rewriter.rewrite(OWNER, OWNER_DOORS), rewriter.rewrite(OWNER, OWNER_DOORS)]);
    expect(routes.refs(OWNER, CELLS), "one reference, not one per ticket").toBe(1);
    expect(await rewriter.rewrite("dev-c", doorsOf("desk-c.tail1234.ts.net", "cell-c"))).toEqual({
      controlUrl: "ws://127.0.0.1:61235/cell/cell-c/control",
      framesUrl: "ws://127.0.0.1:61235/cell/cell-c/frames",
    });
    expect(routes.refs("dev-c", CELLS)).toBe(1);
    expect(rewriter.holders().sort()).toEqual([OWNER, "dev-c"]);
  });

  it("answers egress_unavailable when there is no road, and holds nothing", async () => {
    const { routes, rewriter } = overFake(); // no route: unsupported, mesh down, not in the roster
    expect(await rewriter.rewrite(OWNER, OWNER_DOORS)).toEqual({
      unavailable: { service: "terminal", state: "egress_unavailable", device: OWNER },
      message: "this desktop has no egress route to that desktop's terminal cells yet",
    });
    expect(routes.refs(OWNER, CELLS)).toBe(0);
    expect(rewriter.holders()).toEqual([]);
  });

  it("never answers a half pair: two serves, another port, a pair that is not a cell's", async () => {
    const { routes, rewriter } = overFake();
    routes.route(OWNER, CELLS, LISTEN);
    const split = {
      ...OWNER_DOORS,
      framesUrl: doorsOf("desk-z.tail1234.ts.net", "cell-a").framesUrl,
    };
    const elsewhere = remoteCellEndpointsFor(
      `http://${OWNER_HOST}:9500`,
      "cell-a",
    ) as RemoteCellEndpointSet;
    const notACell = {
      controlUrl: `ws://${OWNER_HOST}:${CELLS}/x`,
      framesUrl: `ws://${OWNER_HOST}:${CELLS}/y`,
    };
    for (const doors of [split, elsewhere, notACell]) {
      const answer = await rewriter.rewrite(OWNER, doors as RemoteCellEndpointSet);
      expect(answer, JSON.stringify(doors)).toMatchObject({
        unavailable: { state: "egress_unavailable", device: OWNER },
      });
    }
    expect(routes.asked, "nothing was ensured for a pair it could not carry").toEqual([]);
  });

  it("keeps the query rather than dropping it: a query the loopback contract refuses is refused whole", () => {
    // both endpoint contracts refuse a query today; the swap changes only the
    // authority, so a door carrying one is never handed out without it
    expect(
      loopbackCellEndpoints(
        {
          controlUrl: `ws://${OWNER_HOST}:${CELLS}/cell/cell-a/control?grant=g`,
          framesUrl: `ws://${OWNER_HOST}:${CELLS}/cell/cell-a/frames?grant=g`,
        },
        LISTEN,
      ),
    ).toBeUndefined();
  });

  it("keeps its one reference through a floor reset; the next ticket rebinds", async () => {
    const { routes, rewriter } = overFake();
    routes.route(OWNER, CELLS, LISTEN);
    await rewriter.rewrite(OWNER, OWNER_DOORS);
    routes.drop(OWNER, CELLS, "reset"); // the floor's table lost the listener
    routes.route(OWNER, CELLS, "127.0.0.1:61299"); // the next ensure binds anew
    expect(await rewriter.rewrite(OWNER, OWNER_DOORS)).toMatchObject({
      controlUrl: "ws://127.0.0.1:61299/cell/cell-a/control",
    });
    expect(routes.refs(OWNER, CELLS)).toBe(1);
  });
});

describe("DS-1b — the route's life is the owner's presence (real EgressRoutes)", () => {
  function overRoutes(hosts: Record<string, string>) {
    const facade = scriptedFacade();
    const people = roster(hosts);
    const routes = new EgressRoutes({ facade, roster: people });
    cleanup.push(() => routes.dispose());
    const rewriter = new EgressCellRewriter({ routes });
    cleanup.push(() => rewriter.dispose());
    return { facade, people, routes, rewriter };
  }

  it("binds ONE route to the roster's name for the owner, and a re-add answers it", async () => {
    const { facade, rewriter } = overRoutes({ [OWNER]: OWNER_HOST });
    const first = await rewriter.rewrite(OWNER, OWNER_DOORS);
    const second = await rewriter.rewrite(OWNER, OWNER_DOORS);
    expect(second).toEqual(first);
    expect(facade.adds).toEqual([
      { id: `egress-${OWNER}-${CELLS}`, target: `${OWNER_HOST}:${CELLS}` },
    ]);
  });

  it("takes the route down when the owner leaves the roster, and binds afresh when it returns", async () => {
    const hosts: Record<string, string> = { [OWNER]: OWNER_HOST };
    const { facade, people, rewriter } = overRoutes(hosts);
    await rewriter.rewrite(OWNER, OWNER_DOORS);
    delete hosts[OWNER];
    people.changed();
    await until(() => facade.removed.length === 1);
    expect(facade.removed).toEqual([`egress-${OWNER}-${CELLS}`]);
    expect(rewriter.holders(), "the reference went back with the owner").toEqual([]);
    expect(await rewriter.rewrite(OWNER, OWNER_DOORS)).toMatchObject({
      unavailable: { state: "egress_unavailable" },
    });
    hosts[OWNER] = OWNER_HOST;
    people.changed();
    expect(await rewriter.rewrite(OWNER, OWNER_DOORS)).toMatchObject({
      controlUrl: "ws://127.0.0.1:53001/cell/cell-a/control",
    });
    expect(facade.adds).toHaveLength(2);
  });

  it("at daemon stop gives back every reference: the last release takes each route off the floor", async () => {
    const { facade, routes, rewriter } = overRoutes({
      [OWNER]: OWNER_HOST,
      "dev-c": "desk-c.tail1234.ts.net",
    });
    await rewriter.rewrite(OWNER, OWNER_DOORS);
    await rewriter.rewrite("dev-c", doorsOf("desk-c.tail1234.ts.net", "cell-c"));
    rewriter.dispose();
    await routes.dispose(); // resolves when the floor has answered the removals
    expect(facade.removed.sort()).toEqual([`egress-${OWNER}-${CELLS}`, `egress-dev-c-${CELLS}`]);
    const adds = facade.adds.length;
    expect(await rewriter.rewrite(OWNER, OWNER_DOORS)).toMatchObject({
      unavailable: { state: "egress_unavailable" },
      message: "this desktop's daemon is stopping",
    });
    expect(facade.adds, "a stopped rewriter ensures nothing").toHaveLength(adds);
  });

  it("a superseded daemon keeps its routes on the floor for its successor", async () => {
    const { facade, rewriter } = overRoutes({ [OWNER]: OWNER_HOST });
    await rewriter.rewrite(OWNER, OWNER_DOORS);
    rewriter.dispose({ keepFloorRoutes: true });
    await new Promise((r) => setTimeout(r, 30));
    expect(facade.removed).toEqual([]);
  });

  it("refuses honestly, holding nothing, when the floor cannot carry egress", async () => {
    const facade = scriptedFacade();
    facade.egressRouteAdd = async () => {
      throw new RpcCallError(
        "UNAVAILABLE",
        "egress is unsupported: this floor's tailnet sidecar predates RFC 026",
        false,
        { service: "mesh", state: "egress-unsupported" },
        -32006,
      );
    };
    const routes = new EgressRoutes({ facade, roster: roster({ [OWNER]: OWNER_HOST }) });
    cleanup.push(() => routes.dispose());
    const rewriter = new EgressCellRewriter({ routes });
    cleanup.push(() => rewriter.dispose());
    expect(await rewriter.rewrite(OWNER, OWNER_DOORS)).toMatchObject({
      unavailable: { service: "terminal", state: "egress_unavailable", device: OWNER },
    });
    expect(rewriter.holders()).toEqual([]);
  });
});
