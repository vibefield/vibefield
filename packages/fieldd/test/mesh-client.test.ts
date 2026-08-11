// MeshClient (C2): declarative serve replay-set + honest UNAVAILABLE handling,
// against the scripted mock (no cargo, no tailnet).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { isPipeEndpoint, PORTS, SOCKETS } from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { MeshClient, type ServeState } from "../src/mesh-client";
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
