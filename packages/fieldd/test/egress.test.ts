// DS-1 — fieldd's face of egress (src/egress.ts, src/mesh-client.ts): the
// floor's answers classified honestly, the facade wrappers held to the
// contract over a REAL NativeLink to the scripted floor, and the EgressRoutes
// port lane ds-e consumes — ref counts, the DS-L6 refusal, the roster drop,
// the table reset, and the two ordering races the revision exists for.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  isPipeEndpoint,
  type MeshEgressRouteAddParams,
  type MeshEgressRouteBound,
  type MeshEgressRouteTable,
  PORTS,
  SOCKETS,
} from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import {
  EGRESS_PATH_DEADLINE_MS,
  type EgressRoster,
  type EgressRouteDrop,
  type EgressRouteFacade,
  EgressRoutes,
  egressRefusal,
  egressRouteId,
  FakeEgressRoutes,
  resolveEgressPath,
} from "../src/egress";
import { MeshClient } from "../src/mesh-client";
import { NativeLink, RpcCallError } from "../src/native-link";
import { MockMgmtServer, mockEgress } from "../src/testing/mock-mgmt";
import { nativeEndpoint } from "./native-harness";

const CELLS = PORTS.TERMINAL_CELLS_SERVE;
const B_HOST = "truffle-vibefield-b.tail1234.ts.net";

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
  cleanup = [];
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(fn: () => boolean, ms = 4000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > deadline) throw new Error("until: timeout");
    await sleep(10);
  }
}

async function floor(): Promise<{ mock: MockMgmtServer; link: NativeLink; mesh: MeshClient }> {
  const dir = mkdtempSync(join(tmpdir(), "vf-egress-"));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "pairing"), "ab".repeat(32));
  const endpoint = nativeEndpoint(dir, SOCKETS.MGMT);
  if (!isPipeEndpoint(endpoint)) mkdirSync(dirname(endpoint), { recursive: true });
  const mock = new MockMgmtServer(endpoint);
  await mock.start();
  cleanup.push(() => mock.stop());
  const link = new NativeLink({
    socketPath: endpoint,
    pairingFile: join(dir, "pairing"),
    bootId: "b",
  });
  cleanup.push(() => link.close());
  const mesh = new MeshClient(link);
  await link.connect();
  return { mock, link, mesh };
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

function routesOver(mesh: MeshClient, hosts: Record<string, string>) {
  const people = roster(hosts);
  const routes = new EgressRoutes({ facade: mesh, roster: people });
  cleanup.push(() => routes.dispose());
  const drops: EgressRouteDrop[] = [];
  routes.onDropped((drop) => drops.push(drop));
  return { routes, people, drops };
}

describe("DS-1 — the floor's answer, classified honestly", () => {
  const unavailable = (details: unknown) =>
    new RpcCallError("UNAVAILABLE", "no", false, details, -32006);

  it("reads the floor's two egress answers as themselves", () => {
    expect(egressRefusal(unavailable({ service: "mesh", state: "egress-unsupported" }))).toEqual({
      state: "egress-unsupported",
    });
    expect(
      egressRefusal(unavailable({ service: "mesh", state: "mesh-down", gatewayState: "starting" })),
    ).toEqual({ state: "mesh-down", detail: "starting" });
  });

  it("reads a floor older than DS-1 as unsupported, or as its node gate's mesh-down", () => {
    // a pre-DS-1 floor with a node answers `method not found` …
    expect(
      egressRefusal(new RpcCallError("NOT_FOUND", "method not found", false, undefined, -32601)),
    ).toEqual({ state: "egress-unsupported", detail: "the floor predates DS-1" });
    // … and without one, its node gate answers before it ever reads the method
    expect(egressRefusal(unavailable({ service: "mesh-gateway", state: "disabled" }))).toEqual({
      state: "mesh-down",
    });
  });

  it("names this side's failures as this side's", () => {
    expect(egressRefusal(new RpcCallError("UNAVAILABLE", "not connected", true)).state).toBe(
      "native-unavailable",
    );
    expect(egressRefusal(new RpcCallError("TIMEOUT", "late", true)).state).toBe("native-timeout");
    expect(egressRefusal(new RpcCallError("INTERNAL", "off-contract", false)).state).toBe(
      "egress-error",
    );
    expect(egressRefusal(new Error("boom")).state).toBe("egress-error");
  });
});

describe("DS-1 — MeshClient's egress verbs over the real link", () => {
  it("hears production's answer today: every verb egress-unsupported", async () => {
    const { mesh } = await floor();
    await expect(mesh.egressProxy()).rejects.toMatchObject({
      kind: "UNAVAILABLE",
      retryable: false,
      details: { service: "mesh", state: "egress-unsupported" },
    });
    expect(await resolveEgressPath(mesh)).toEqual({ kind: "direct", state: "egress-unsupported" });
  });

  it("returns the proxies, a bound route, the table and its stream, each held to the contract", async () => {
    const { mock, mesh } = await floor();
    const egress = mockEgress();
    mock.egress = egress;
    expect(await resolveEgressPath(mesh)).toEqual({
      kind: "proxy",
      address: "127.0.0.1:41641",
      username: "tsnet",
      credential: "mock-socks-credential",
    });
    expect((await mesh.egressHttpProxy()).address).toBe("127.0.0.1:41642");

    const tables: MeshEgressRouteTable[] = [];
    const sub = await mesh.subscribeEgressRoutes((table) => tables.push(table));
    expect(sub.snapshot).toEqual({ routes: [], revision: 0, bootId: "mock-native-boot" });
    const bound = await mesh.egressRouteAdd({ id: "r1", target: `${B_HOST}:${CELLS}` });
    expect(bound).toEqual({
      id: "r1",
      listen: "127.0.0.1:53000",
      revision: 1,
      bootId: "mock-native-boot",
    });
    await until(() => tables.length === 1);
    expect(tables[0]!.routes).toEqual([
      { id: "r1", target: `${B_HOST}:${CELLS}`, listen: "127.0.0.1:53000" },
    ]);
    expect((await mesh.egressRouteList()).routes).toHaveLength(1);
    expect(await mesh.egressRouteRemove("r1")).toEqual({ id: "r1" });
    await expect(mesh.egressRouteRemove("r1")).rejects.toMatchObject({ kind: "NOT_FOUND" });
    sub.dispose();
  });

  it("FAILS the dial within its own deadline when the floor is wedged — never the OS network (DS-1b)", async () => {
    const { mock, mesh } = await floor();
    mock.egress = mockEgress();
    mock.silentMethods.add("native.mesh.egress.proxy"); // connected, never answers
    const started = Date.now();
    expect(await resolveEgressPath(mesh)).toMatchObject({
      kind: "unavailable",
      state: "native-timeout",
    });
    const took = Date.now() - started;
    expect(took).toBeGreaterThanOrEqual(EGRESS_PATH_DEADLINE_MS - 50);
    // well under PeerLink's 8 s call deadline: the dial fails in time to say so
    expect(took).toBeLessThan(6_000);
  });

  it("refuses an answer outside the contract instead of trusting part of it", async () => {
    const { mock, mesh } = await floor();
    // a proxy named by a resolvable NAME: whoever answered the lookup would be
    // handed the credential, so the contract admits only literal loopback
    mock.egress = mockEgress({
      proxy: { address: "localhost:41641", username: "tsnet", credential: "c" },
    });
    await expect(mesh.egressProxy()).rejects.toMatchObject({ kind: "INTERNAL" });
    // DS-1b — and an answer nobody can trust is no road at all, never the OS network
    expect(await resolveEgressPath(mesh)).toMatchObject({
      kind: "unavailable",
      state: "egress-error",
    });
  });

  it("refuses an off-contract ask before it reaches the wire", async () => {
    const { mock, mesh } = await floor();
    mock.egress = mockEgress();
    await expect(
      mesh.egressRouteAdd({ id: "r1", target: `ws://${B_HOST}:${CELLS}` }),
    ).rejects.toMatchObject({ kind: "PRECONDITION_FAILED" });
    expect(mock.meshCalls).not.toContain("native.mesh.egress.route.add");
  });
});

describe("DS-1 — EgressRoutes, the port the terminal rewriter consumes", () => {
  it("resolves undefined and takes no reference while the floor has no egress", async () => {
    const { mock, mesh } = await floor();
    const { routes } = routesOver(mesh, { "dev-b": B_HOST });
    expect(await routes.ensureRoute("dev-b", CELLS)).toBeUndefined();
    routes.release("dev-b", CELLS); // nothing held: a no-op, never a negative count
    expect(mock.meshCalls.filter((m) => m === "native.mesh.egress.route.add")).toHaveLength(1);
  });

  it("binds once per {peer, port}, shares the listener, and the LAST release takes it down", async () => {
    const { mock, mesh } = await floor();
    const egress = mockEgress();
    mock.egress = egress;
    const { routes } = routesOver(mesh, { "dev-b": B_HOST });
    const [a, b] = await Promise.all([
      routes.ensureRoute("dev-b", CELLS),
      routes.ensureRoute("dev-b", CELLS),
    ]);
    expect(a).toEqual({ listen: "127.0.0.1:53000" });
    expect(b).toEqual(a);
    expect(egress.adds).toEqual([{ id: "egress-dev-b-9422", target: `${B_HOST}:${CELLS}` }]);
    routes.release("dev-b", CELLS);
    await sleep(30);
    expect(egress.removed, "one holder still holds it").toEqual([]);
    routes.release("dev-b", CELLS);
    await until(() => egress.removed.length === 1);
    expect(egress.removed).toEqual(["egress-dev-b-9422"]);
  });

  it("routes only doors that demand their own grant (DS-L6) — the product door throws", async () => {
    const { mock, mesh } = await floor();
    mock.egress = mockEgress();
    const { routes } = routesOver(mesh, { "dev-b": B_HOST });
    await expect(routes.ensureRoute("dev-b", PORTS.FIELDD_PRODUCT_SERVE)).rejects.toMatchObject({
      kind: "PRECONDITION_FAILED",
    });
    await expect(routes.ensureRoute("dev-b", 9422.5)).rejects.toMatchObject({
      kind: "PRECONDITION_FAILED",
    });
    expect(mock.meshCalls).not.toContain("native.mesh.egress.route.add");
  });

  it("asks nothing of the floor for a peer the roster does not name", async () => {
    const { mock, mesh } = await floor();
    mock.egress = mockEgress();
    const { routes } = routesOver(mesh, {});
    expect(await routes.ensureRoute("dev-stranger", CELLS)).toBeUndefined();
    expect(mock.meshCalls).not.toContain("native.mesh.egress.route.add");
  });

  it("drops a route the floor's reset took, keeps the references, and rebinds on the next ensure", async () => {
    const { mock, mesh } = await floor();
    const egress = mockEgress();
    mock.egress = egress;
    const { routes, drops } = routesOver(mesh, { "dev-b": B_HOST });
    expect(await routes.ensureRoute("dev-b", CELLS)).toEqual({ listen: "127.0.0.1:53000" });
    mock.resetEgress();
    await until(() => drops.length === 1);
    expect(drops[0]).toEqual({
      peerDeviceId: "dev-b",
      port: CELLS,
      listen: "127.0.0.1:53000",
      reason: "reset",
    });
    // the holder re-ensures: a fresh binding, and now it holds two references
    expect(await routes.ensureRoute("dev-b", CELLS)).toEqual({ listen: "127.0.0.1:53001" });
    routes.release("dev-b", CELLS);
    await sleep(30);
    expect(egress.removed).toEqual([]);
    routes.release("dev-b", CELLS);
    await until(() => egress.removed.length === 1);
  });

  it("drops and takes down a route whose peer left the roster", async () => {
    const { mock, mesh } = await floor();
    const egress = mockEgress();
    mock.egress = egress;
    const hosts: Record<string, string> = { "dev-b": B_HOST };
    const { routes, people, drops } = routesOver(mesh, hosts);
    await routes.ensureRoute("dev-b", CELLS);
    delete hosts["dev-b"];
    people.changed();
    expect(drops.map((d) => d.reason)).toEqual(["peer-left"]);
    await until(() => egress.removed.length === 1);
    // the reference stands; the release that balances it is a no-op on the floor
    routes.release("dev-b", CELLS);
  });

  it("drops a route when the peer's tailnet name moves, and the next ensure aims at the new one", async () => {
    const { mock, mesh } = await floor();
    const egress = mockEgress();
    mock.egress = egress;
    const hosts: Record<string, string> = { "dev-b": B_HOST };
    const { routes, people, drops } = routesOver(mesh, hosts);
    await routes.ensureRoute("dev-b", CELLS);
    hosts["dev-b"] = "truffle-vibefield-b-1.tail1234.ts.net";
    people.changed();
    expect(drops.map((d) => d.reason)).toEqual(["peer-left"]);
    await until(() => egress.removed.length === 1);
    await routes.ensureRoute("dev-b", CELLS);
    expect(egress.adds.at(-1)).toEqual({
      id: "egress-dev-b-9422",
      target: `truffle-vibefield-b-1.tail1234.ts.net:${CELLS}`,
    });
  });

  it("re-binds over a predecessor's route aimed elsewhere (CONFLICT → remove → add)", async () => {
    const { mock, mesh } = await floor();
    const egress = mockEgress();
    egress.routes.set("egress-dev-b-9422", {
      id: "egress-dev-b-9422",
      target: `old-name.tail1234.ts.net:${CELLS}`,
      listen: "127.0.0.1:52999",
    });
    mock.egress = egress;
    const { routes } = routesOver(mesh, { "dev-b": B_HOST });
    expect(await routes.ensureRoute("dev-b", CELLS)).toEqual({ listen: "127.0.0.1:53000" });
    expect(egress.removed).toEqual(["egress-dev-b-9422"]);
  });

  it("takes no reference when the floor refuses the target", async () => {
    const { mock, mesh } = await floor();
    const egress = mockEgress({ refuseTargets: new Set([`${B_HOST}:${CELLS}`]) });
    mock.egress = egress;
    const { routes } = routesOver(mesh, { "dev-b": B_HOST });
    expect(await routes.ensureRoute("dev-b", CELLS)).toBeUndefined();
    routes.release("dev-b", CELLS);
    expect(egress.removed).toEqual([]);
  });

  it("reads a respawned floor's table as authoritative even though its revision restarted", async () => {
    const { mock, mesh } = await floor();
    const egress = mockEgress();
    mock.egress = egress;
    const { routes, drops } = routesOver(mesh, { "dev-b": B_HOST });
    await routes.ensureRoute("dev-b", CELLS);
    await routes.ensureRoute("dev-b", CELLS); // revision 1 → keep it above the new boot's 0
    // the floor dies and comes back: new boot, empty table, revision from zero
    egress.routes.clear();
    egress.revision = 0;
    egress.bootId = "mock-native-boot-2";
    mock.killClients();
    await until(() => drops.length === 1, 8000);
    expect(drops[0]!.reason).toBe("reset");
  });
});

/** A facade double whose answers the test releases by hand — the only way to
 * stage the two orderings the revision exists for. */
function handFacade() {
  let onTable: ((table: MeshEgressRouteTable) => void) | undefined;
  const adds: Array<{
    params: MeshEgressRouteAddParams;
    resolve: (b: MeshEgressRouteBound) => void;
  }> = [];
  const facade: EgressRouteFacade = {
    egressRouteAdd: (params) =>
      new Promise((resolve) => {
        adds.push({ params, resolve });
      }),
    egressRouteRemove: async (id) => ({ id }),
    subscribeEgressRoutes: async (fn) => {
      onTable = fn;
      return { snapshot: { routes: [], revision: 0, bootId: "boot-1" }, dispose: () => {} };
    },
  };
  return { facade, adds, push: (table: MeshEgressRouteTable) => onTable?.(table) };
}

describe("DS-1 — the two orderings the table's revision settles", () => {
  const route = (listen: string) => ({
    id: "egress-dev-b-9422",
    target: `${B_HOST}:${CELLS}`,
    listen,
  });

  it("a STALE push (older revision, same boot) never drops a live binding", async () => {
    const hand = handFacade();
    const routes = new EgressRoutes({ facade: hand.facade, roster: roster({ "dev-b": B_HOST }) });
    cleanup.push(() => routes.dispose());
    const drops: EgressRouteDrop[] = [];
    routes.onDropped((d) => drops.push(d));
    const ensured = routes.ensureRoute("dev-b", CELLS);
    await until(() => hand.adds.length === 1);
    hand.adds[0]!.resolve({
      id: "egress-dev-b-9422",
      listen: "127.0.0.1:53000",
      revision: 3,
      bootId: "boot-1",
    });
    expect(await ensured).toEqual({ listen: "127.0.0.1:53000" });
    // the forwarder read the table at revision 2, before the add, and its push
    // lands after the add's answer
    hand.push({ routes: [], revision: 2, bootId: "boot-1" });
    expect(drops).toEqual([]);
    // a table at the binding's own revision that lacks it IS a drop
    hand.push({ routes: [], revision: 3, bootId: "boot-1" });
    expect(drops.map((d) => d.reason)).toEqual(["reset"]);
  });

  it("a reset that OVERTAKES the add's answer is caught: the dead binding is never handed out", async () => {
    const hand = handFacade();
    const routes = new EgressRoutes({ facade: hand.facade, roster: roster({ "dev-b": B_HOST }) });
    cleanup.push(() => routes.dispose());
    const ensured = routes.ensureRoute("dev-b", CELLS);
    await until(() => hand.adds.length === 1);
    // the floor bound it at revision 1, then a teardown emptied the table at
    // revision 2 — and that push reached us before the add's answer did
    hand.push({ routes: [], revision: 2, bootId: "boot-1" });
    hand.adds[0]!.resolve({
      id: "egress-dev-b-9422",
      listen: "127.0.0.1:53000",
      revision: 1,
      bootId: "boot-1",
    });
    await until(() => hand.adds.length === 2);
    hand.push({ routes: [route("127.0.0.1:53001")], revision: 3, bootId: "boot-1" });
    hand.adds[1]!.resolve({
      id: "egress-dev-b-9422",
      listen: "127.0.0.1:53001",
      revision: 3,
      bootId: "boot-1",
    });
    expect(await ensured).toEqual({ listen: "127.0.0.1:53001" });
  });
});

describe("DS-1 — FakeEgressRoutes, the double ds-e's tests take", () => {
  it("routes what a test declares, counts references, and drops on demand", async () => {
    const fake = new FakeEgressRoutes();
    expect(await fake.ensureRoute("dev-b", CELLS)).toBeUndefined();
    fake.route("dev-b", CELLS, "127.0.0.1:40001");
    expect(await fake.ensureRoute("dev-b", CELLS)).toEqual({ listen: "127.0.0.1:40001" });
    await fake.ensureRoute("dev-b", CELLS);
    expect(fake.refs("dev-b", CELLS)).toBe(2);
    const drops: EgressRouteDrop[] = [];
    fake.onDropped((d) => drops.push(d));
    fake.drop("dev-b", CELLS);
    expect(drops).toEqual([
      { peerDeviceId: "dev-b", port: CELLS, listen: "127.0.0.1:40001", reason: "reset" },
    ]);
    expect(await fake.ensureRoute("dev-b", CELLS)).toBeUndefined();
    fake.release("dev-b", CELLS);
    fake.release("dev-b", CELLS);
    expect(fake.refs("dev-b", CELLS)).toBe(0);
    expect(fake.asked).toHaveLength(4);
  });
});

describe("DS-1 — route ids", () => {
  it("keys a route by {peer, port} in the contract's charset, hashing what does not fit", () => {
    expect(egressRouteId("01ARZ3NDEKTSV4RRFFQ69G5FAV", CELLS)).toBe(
      "egress-01ARZ3NDEKTSV4RRFFQ69G5FAV-9422",
    );
    const odd = egressRouteId("dev b/with:odd", CELLS);
    expect(odd).toMatch(/^egress-h[0-9a-f]{32}-9422$/);
    expect(egressRouteId("dev b/with:odd", CELLS)).toBe(odd);
    expect(egressRouteId("dev b/with:odd2", CELLS)).not.toBe(odd);
  });
});
