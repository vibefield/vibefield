// MeshClient (C2): declarative serve replay-set + honest UNAVAILABLE handling,
// against the scripted mock (no cargo, no tailnet).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ARTIFACT_SERVE_PREFIX, isPipeEndpoint, PORTS, SOCKETS } from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { MeshClient, meshNodeUp, type ServeSpec, type ServeState } from "../src/mesh-client";
import { NativeLink } from "../src/native-link";
import { MockMgmtServer } from "../src/testing/mock-mgmt";
import { nativeEndpoint } from "./native-harness";

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
    await sleep(25);
  }
}

async function setup(): Promise<{ mock: MockMgmtServer; link: NativeLink; mesh: MeshClient }> {
  const dir = mkdtempSync(join(tmpdir(), "vf-mesh-"));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "pairing"), "ab".repeat(32));
  // One resolution (WIN-D1) reused by both ends: a filesystem path on unix, a
  // root-scoped pipe name on win32. Resolving twice is how a bind and a dial
  // drift apart.
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

describe("MeshClient", () => {
  it("declares serves through the facade and captures URLs", async () => {
    const { mock, mesh } = await setup();
    const states = await mesh.setServes([
      { name: "site", target: { kind: "dir", path: "/tmp/site" } },
      { name: "api", target: { kind: "port", port: 3000 } },
    ]);
    expect(states.map((s) => s.status)).toEqual(["active", "active"]);
    expect(states[0]!.url).toBe("https://mock.ts.net:0");
    expect(mock.meshAddCalls).toBe(2);

    // dropping one from the desired set removes it at the node
    await mesh.setServes([{ name: "api", target: { kind: "port", port: 3000 } }]);
    expect(mock.meshRemoveCalls).toBe(1);
    expect(mock.meshServes.has("site")).toBe(false);
  });

  it("declares the TERMINAL listener's routes shape, which the contract now describes (F-H3)", async () => {
    const { mock, mesh } = await setup();
    const states = await mesh.setServes([
      {
        serveId: "terminal",
        name: "terminal",
        listenPort: PORTS.TERMINAL_CELLS_SERVE,
        target: { kind: "routes" },
        tls: false,
        allow: ["james@github"],
        routes: [{ prefix: "/cell/01JCELLBOOT0000000000000004", targetPort: 49152 }],
      },
    ]);
    expect(states[0]!.status).toBe("active");
    expect(mock.meshAddParams.at(-1)?.["routes"]).toEqual([
      { prefix: "/cell/01JCELLBOOT0000000000000004", targetPort: 49152 },
    ]);
  });

  it("REFUSES to send a spec the contract cannot describe, and says why (F-H3)", async () => {
    // The guard exists because the wire once moved without the contract. A
    // shape ServeConfig cannot describe never reaches the node at all: it lands
    // in the serve's own error state with the parse reason, where a reader can
    // see it, rather than becoming a live proxy nothing has a schema for.
    const { mock, mesh } = await setup();
    const states = await mesh.setServes([
      { name: "bogus", target: { kind: "webhook" } as never },
      { name: "api", target: { kind: "port", port: 3000 } },
    ]);
    const bogus = states.find((x) => x.name === "bogus") as ServeState;
    expect(bogus.status).toBe("error");
    expect(bogus.error).toContain("ServeConfig");
    expect(mock.meshServes.has("bogus"), "nothing was sent").toBe(false);
    // …and the well-formed serve beside it still landed
    expect(states.find((x) => x.name === "api")?.status).toBe("active");

    // the same wall on the routes shape itself: a trailing slash never matches
    // in the shipped sidecar, so it is refused here rather than published dead
    const bad = await mesh.setServes([
      {
        serveId: "terminal",
        name: "terminal",
        listenPort: PORTS.TERMINAL_CELLS_SERVE,
        target: { kind: "routes" },
        routes: [{ prefix: "/cell/x/", targetPort: 49152 }],
      },
    ]);
    expect(bad[0]!.status).toBe("error");
    expect(mock.meshServes.has("terminal")).toBe(false);
  });

  it("re-serving is re-creating: a fresh node gets the desired set replayed", async () => {
    const { mock, mesh } = await setup();
    mock.clearServesOnDisconnect = true; // serves live in the node; node dies with the conn
    await mesh.setServes([{ name: "site", target: { kind: "dir", path: "/tmp/site" } }]);
    expect(mock.meshAddCalls).toBe(1);

    mock.killClients(); // native restart
    await until(() => mock.meshAddCalls === 2, 6000); // reconnect → reconcile → re-add
    expect(mock.meshServes.has("site")).toBe(true);
    expect(mesh.serves()[0]!.status).toBe("active");
  });

  it("mesh UNAVAILABLE marks serves pending and emits, not throws", async () => {
    const { mock, mesh } = await setup();
    mock.meshUnavailable = true;
    let details: unknown = null;
    mesh.on("unavailable", (d) => (details = d));
    const states = await mesh.setServes([
      { name: "site", target: { kind: "dir", path: "/tmp/site" } },
    ]);
    expect(states[0]!.status).toBe("pending");
    expect((details as { state?: string } | null)?.state).toBe("starting");
  });

  // 2026-10-17 — the node's own word, from the floor's health: a turn to UP
  // places the desired set again (a down or restarted node holds none of it)
  // and says "node-up" once, for what could not even be declared while it was
  // down; a report that does not change the state does nothing.
  it("a turn to UP re-places the desired set and says node-up once", async () => {
    const { mock, mesh } = await setup();
    mock.meshUnavailable = true;
    await mesh.setServes([{ name: "site", target: { kind: "dir", path: "/tmp/site" } }]);
    expect(mesh.serves()[0]!.status).toBe("pending");
    let ups = 0;
    mesh.on("node-up", () => (ups += 1));
    mesh.noteNodeState(false);
    expect(ups).toBe(0);
    mock.meshUnavailable = false;
    mesh.noteNodeState(true);
    await until(() => mesh.serves()[0]?.status === "active");
    mesh.noteNodeState(true); // the same word again is not news
    expect(ups).toBe(1);
    expect(mock.meshAddCalls).toBe(1);
  });

  it("reads the node's state off the floor's health: the mesh-gateway unit at up", () => {
    const health = (state: string) => ({
      state: "up" as const,
      bootId: "f",
      units: [{ unit: "mesh-gateway", state: state as "up" }],
    });
    expect(meshNodeUp(health("up"))).toBe(true);
    expect(meshNodeUp(health("starting"))).toBe(false);
    expect(meshNodeUp({ state: "up", bootId: "f", units: [] })).toBe(false);
    expect(meshNodeUp(undefined)).toBe(false);
  });

  it("store passthrough returns the slice snapshot", async () => {
    const { mesh } = await setup();
    const snap = (await mesh.openStore("field.docs.v1")) as {
      storeId: string;
      slices: Record<string, unknown>;
    };
    expect(snap.storeId).toBe("field.docs.v1");
    expect(Object.keys(snap.slices)).toEqual(["dev-self"]);
  });

  it("retains a failed generic stray removal and retries it on the next reconcile", async () => {
    const { mock, mesh } = await setup();
    await mesh.setServes([{ name: "site", target: { kind: "port", port: 3_000 } }]);
    mock.failNextServeRemove = true;
    await mesh.setServes([]);
    expect(mock.meshRemoveCalls).toBe(1);
    expect(mock.meshServes.has("site")).toBe(true);

    await mesh.reconcile();
    expect(mock.meshRemoveCalls).toBe(2);
    expect(mock.meshServes.has("site")).toBe(false);
  });

  it("treats direct remove NOT_FOUND as converged success and exposes raw listener inventory", async () => {
    const { mesh } = await setup();
    await mesh.setServes([
      {
        serveId: "stable-id",
        name: "display-name",
        listenPort: 12_345,
        target: { kind: "port", port: 3_000, scheme: "https" },
        tls: true,
      },
    ]);
    expect(await mesh.observedServes()).toEqual([
      expect.objectContaining({
        serveId: "stable-id",
        name: "display-name",
        listenPort: 12_345,
      }),
    ]);
    await mesh.removeServe("stable-id");
    await expect(mesh.removeServe("stable-id")).resolves.toEqual({ removed: true });
  });

  // P0-S (2026-09-24) — the floor outlives fieldd, so a restarted fieldd's
  // MeshClient meets serves its PREDECESSOR placed. `serve.list` carries no
  // target, secret or allow, so adopting a listed serve kept the dead fieldd's
  // `product` door forever. *(2026-10-17, F1: it carries the declared target,
  // allow and tls — never the secret, which is per fieldd boot here, so this
  // row stands; the floor-owned freeway serve is adopted, below.)*
  it("REPLACES a desired serve a predecessor placed, instead of adopting it", async () => {
    const { mock, mesh } = await setup();
    // the node already holds `product`, aimed at a fieldd that no longer exists
    mock.meshServes.set("product", {
      serveId: "product",
      name: "product",
      listenPort: PORTS.FIELDD_PRODUCT_SERVE,
      target: { kind: "port", port: 50_001 },
      url: "http://mock.ts.net:9423",
    });
    const states = await mesh.setServes([
      {
        name: "product",
        listenPort: PORTS.FIELDD_PRODUCT_SERVE,
        target: { kind: "port", port: 50_002 },
        tls: false,
      },
    ]);
    expect(states[0]!.status).toBe("active");
    expect(mock.meshRemoveCalls).toBe(1);
    expect(mock.meshAddCalls).toBe(1);
    expect(mock.meshServes.get("product")?.target).toEqual({ kind: "port", port: 50_002 });
  });

  // F1 (FW-L10) — the freeway's serve is the FLOOR's: its listener and secret are the floor
  // boot's, and the floor admits no other freeway-door serve, so a restarted fieldd adopts the
  // one its predecessor declared when it is this spec — and every phone link on it stands.
  const freeway = (over: Partial<ServeSpec> = {}): ServeSpec => ({
    serveId: "freeway",
    name: "freeway",
    listenPort: PORTS.FREEWAY_SERVE,
    target: { kind: "port", port: 50_123 },
    tls: false,
    allow: ["person@example.com"],
    pathSecret: "ab".repeat(32),
    secretDoor: "freeway",
    ...over,
  });
  const listed = (spec: ServeSpec) => ({
    serveId: spec.serveId ?? spec.name,
    name: spec.name,
    listenPort: spec.listenPort ?? 0,
    target: spec.target,
    url: "http://mock.ts.net:9425",
    ...(spec.allow !== undefined ? { allow: spec.allow } : {}),
    ...(spec.tls !== undefined ? { tls: spec.tls } : {}),
  });

  it("ADOPTS a predecessor's freeway-door serve that is this spec — nothing removed, nothing added", async () => {
    const { mock, mesh } = await setup();
    mock.meshServes.set("freeway", listed(freeway()));
    const states = await mesh.setServes([freeway()]);
    expect(states[0]).toMatchObject({ status: "active", url: "http://mock.ts.net:9425" });
    expect(mock.meshRemoveCalls).toBe(0);
    expect(mock.meshAddCalls).toBe(0);
    // adopted means placed: the next reconcile against the same node is quiet too
    await mesh.reconcile();
    expect(mock.meshRemoveCalls + mock.meshAddCalls).toBe(0);
  });

  it("REPLACES a freeway-door serve that differs — another login, or another floor boot's port", async () => {
    const { mock, mesh } = await setup();
    mock.meshServes.set("freeway", listed(freeway({ allow: ["someone@else.com"] })));
    await mesh.setServes([freeway()]);
    expect([mock.meshRemoveCalls, mock.meshAddCalls]).toEqual([1, 1]);
    expect(mock.meshServes.get("freeway")?.allow).toEqual(["person@example.com"]);
    // PLACED by this client, then the floor's listener moves: placed is no licence to keep it
    await mesh.setServes([freeway({ target: { kind: "port", port: 50_124 } })]);
    expect([mock.meshRemoveCalls, mock.meshAddCalls]).toEqual([2, 2]);
    expect(mock.meshServes.get("freeway")?.target).toEqual({ kind: "port", port: 50_124 });
    expect(mock.meshAddParams.at(-1)).toMatchObject({ secretDoor: "freeway" });
  });

  it("ADOPTS a serve this client placed: a reconcile against the same node adds nothing", async () => {
    const { mock, mesh } = await setup();
    await mesh.setServes([{ name: "api", target: { kind: "port", port: 3_000 } }]);
    expect(mock.meshAddCalls).toBe(1);
    await mesh.reconcile();
    await mesh.reconcile();
    expect(mock.meshAddCalls).toBe(1);
    expect(mock.meshRemoveCalls).toBe(0);
  });

  it("still ADOPTS a predecessor's artifact serve — AH-1's durable queue owns those", async () => {
    const { mock, mesh } = await setup();
    const serveId = `${ARTIFACT_SERVE_PREFIX}01H`;
    mock.meshServes.set(serveId, {
      serveId,
      name: "artifact",
      listenPort: 8443,
      target: { kind: "port", port: 50_001 },
      url: "https://mock.ts.net:8443",
    });
    await mesh.setServes([
      { serveId, name: "artifact", listenPort: 8443, target: { kind: "port", port: 50_001 } },
    ]);
    expect(mock.meshRemoveCalls).toBe(0);
    expect(mock.meshAddCalls).toBe(0);
  });

  it("merges runtime events by serveId, not by the display name", async () => {
    const { mock, mesh } = await setup();
    await mesh.setServes([
      {
        serveId: "engine-v1",
        name: "artifact:stable-object",
        listenPort: 12_345,
        target: { kind: "port", port: 3_000 },
      },
    ]);
    mock.pushServeDelta({
      serveId: "engine-v1",
      status: "error",
      error: "[CONNECTION_REFUSED] source down",
    });
    await until(() => mesh.serves()[0]?.status === "error");
    expect(mesh.serves()[0]).toMatchObject({
      serveId: "engine-v1",
      name: "artifact:stable-object",
      error: "[CONNECTION_REFUSED] source down",
    });
  });

  // ---- C3: runtime status stream fused into serves() ----

  const productSpec = {
    name: "product",
    target: { kind: "port" as const, port: PORTS.FIELDD_WS_CONTROL },
  };
  const runtimeEntry = (over: Partial<Record<string, unknown>> = {}) => ({
    name: "product",
    target: { kind: "port", port: PORTS.FIELDD_WS_CONTROL },
    url: "https://dev.ts.net/product",
    status: "running",
    ...over,
  });

  it("a fresh serve snapshot marks a declared serve active with its url and replaces stale state", async () => {
    const { mock, mesh } = await setup();
    await mesh.setServes([productSpec]);

    // the node first reports a runtime failure (delta)
    mock.pushServeDelta(runtimeEntry({ status: "error", error: "CONNECTION_REFUSED" }));
    await until(() => mesh.serves()[0]?.status === "error");

    // then it recovers; a reconnect replays the subscription with a fresh
    // snapshot that must replace the stale error wholesale (P5)
    mock.serveSnapshot = [runtimeEntry({ status: "running" })];
    mock.killClients();
    await until(() => mesh.serves()[0]?.status === "active", 6000);
    const st = mesh.serves().find((s) => s.name === "product");
    expect(st?.status).toBe("active");
    expect(st?.url).toBe("https://dev.ts.net/product");
    expect(st?.error).toBeUndefined();
  });

  it("a runtime error delta flips a serve to error; a later running delta restores active", async () => {
    const { mock, mesh } = await setup();
    await mesh.setServes([productSpec]);
    await until(() => mesh.serves()[0]?.status === "active"); // reconcile verdict

    mock.pushServeDelta(runtimeEntry({ status: "error", error: "SERVE_ERROR" }));
    await until(() => mesh.serves()[0]?.status === "error");
    expect(mesh.serves()[0]?.error).toBe("SERVE_ERROR");

    mock.pushServeDelta(runtimeEntry({ status: "running" }));
    await until(() => mesh.serves()[0]?.status === "active");
    expect(mesh.serves()[0]?.url).toBe("https://dev.ts.net/product");
  });

  it("mesh UNAVAILABLE keeps declared serves pending and fires serves-changed on transition", async () => {
    const { mock, mesh } = await setup();
    mock.meshUnavailable = true;
    const seen: ServeState[][] = [];
    mesh.on("serves-changed", (s: ServeState[]) => seen.push(s));

    await mesh.setServes([productSpec]);
    expect(mesh.serves().find((s) => s.name === "product")?.status).toBe("pending");
    // the pending transition emitted at least once; the latest view is pending
    expect(seen.length).toBeGreaterThanOrEqual(1);
    expect(seen.at(-1)?.find((s) => s.name === "product")?.status).toBe("pending");
  });

  it("partial legacy deltas merge by name: stopped→pending keeps the last-known url", async () => {
    const { mock, mesh } = await setup();
    await mesh.setServes([productSpec]);
    mock.pushServeDelta(runtimeEntry({ status: "running" })); // runtime url supersedes the add url
    await until(() => mesh.serves()[0]?.url === "https://dev.ts.net/product");
    expect(mesh.serves()[0]?.status).toBe("active");

    // a Stopped delta is PARTIAL — {name, status} only, no url. The merge keeps
    // the last-known url; a stopped-but-desired serve is pending (reconcile
    // re-adds it), never a hard error.
    mock.pushServeDelta({ name: "product", status: "stopped" });
    await until(() => mesh.serves()[0]?.status === "pending");
    expect(mesh.serves()[0]?.url).toBe("https://dev.ts.net/product");
    expect(mesh.serves()[0]?.error).toBeUndefined();
  });

  it("a serve.snapshot notification replaces runtime state wholesale (broadcast-lag re-snapshot)", async () => {
    const { mock, mesh } = await setup();
    await mesh.setServes([productSpec]);
    mock.pushServeDelta(runtimeEntry({ status: "error", error: "[X] transient" }));
    await until(() => mesh.serves()[0]?.status === "error");

    // a full re-snapshot supersedes the missed-delta state, without a reconnect
    mock.pushServeSnapshot([runtimeEntry({ status: "running" })]);
    await until(() => mesh.serves()[0]?.status === "active");
    expect(mesh.serves()[0]?.url).toBe("https://dev.ts.net/product");
    expect(mesh.serves()[0]?.error).toBeUndefined();
  });
});
