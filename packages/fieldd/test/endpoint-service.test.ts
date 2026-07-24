// P6 — endpoint adoption (plugin spec §17.3). EndpointService is instantiated
// DIRECTLY here (no daemon bootstrap): register/unregister are synchronous law
// (ownership, duplicate, exposure, schema), and the mandatory health loop is
// exercised against a REAL node:http server so the unknown → healthy → unhealthy
// → healthy path is the actual fetch path, not a mocked one.
//
// Cadence note: the poll period is max(intervalMs, minIntervalMs) (§17.3). The
// pinned contract floors health.intervalMs at 1_000, so minIntervalMs (the test
// seam) can only RAISE the floor — it cannot pull the period below 1_000ms.
// The health tests therefore poll at ~1_000ms and widen their vi.waitFor
// windows accordingly; the first probe fires immediately on register (§17.3
// rule 6), so unknown → {healthy,unhealthy} does not wait a full period.
import { createServer, type Server } from "node:http";
import type { ServicesHealthResult } from "@vibefield/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EndpointService, type EndpointServiceConfig } from "../src/endpoint-service";

const PLUGIN = "vibefield.fixture.svc";
const OTHER = "vibefield.fixture.other";

const services: EndpointService[] = [];
const servers: Server[] = [];

function mkService(cfg: EndpointServiceConfig = {}): EndpointService {
  const svc = new EndpointService(cfg);
  services.push(svc);
  return svc;
}

function svcId(name: string, plugin = PLUGIN): string {
  return `x.${plugin}.${name}`;
}

function params(port: number, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    serviceId: svcId("api"),
    endpoint: { protocol: "http", port },
    health: { path: "/health", intervalMs: 1_000 },
    expose: { app: true, mesh: false, mcp: false },
    ...over,
  };
}

/** an injected fetch that always answers 200 and counts its calls */
function countingFetch(counter: { n: number }, status = 200): typeof fetch {
  return (async () => {
    counter.n += 1;
    return { status, body: null } as unknown as Response;
  }) as unknown as typeof fetch;
}

const okFetch = countingFetch({ n: 0 });

/** run fn (expected to throw an RpcCallError) and surface its wire-visible bits */
function caught(fn: () => unknown): {
  kind: string;
  message: string;
  details: Record<string, unknown>;
} {
  try {
    fn();
  } catch (e) {
    const err = e as { kind?: unknown; message?: unknown; details?: unknown };
    return {
      kind: typeof err.kind === "string" ? err.kind : "",
      message: typeof err.message === "string" ? err.message : "",
      details:
        err.details !== null && typeof err.details === "object"
          ? (err.details as Record<string, unknown>)
          : {},
    };
  }
  throw new Error("expected the call to throw");
}

function listen(handler: Parameters<typeof createServer>[1]): Promise<Server> {
  const server = createServer(handler);
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

function portOf(server: Server): number {
  const addr = server.address();
  if (addr === null || typeof addr === "string") throw new Error("no bound port");
  return addr.port;
}

function closeServer(server: Server): Promise<void> {
  server.closeAllConnections?.();
  return new Promise((resolve) => server.close(() => resolve()));
}

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

afterEach(async () => {
  for (const svc of services) svc.dispose();
  services.length = 0;
  await Promise.all(servers.map(closeServer));
  servers.length = 0;
});

// --- registration law (synchronous, §17.3) -----------------------------------

describe("EndpointService registration", () => {
  it("returns a provenance-first record in the unknown state", () => {
    const svc = mkService({ fetchImpl: okFetch });
    const rec = svc.register(PLUGIN, params(9000));
    expect(rec.serviceId).toBe(svcId("api"));
    expect(rec.pluginId).toBe(PLUGIN);
    expect(rec.endpoint).toEqual({ protocol: "http", port: 9000 });
    expect(rec.expose).toEqual({ app: true, mesh: false, mcp: false });
    expect(rec.health.state).toBe("unknown");
    expect(rec.health.consecutiveFailures).toBe(0);
    expect(rec.health.lastCheckedAt).toBeUndefined();
  });

  it("refuses a serviceId outside the plugin's namespace (FORBIDDEN_SCOPE)", () => {
    const svc = mkService({ fetchImpl: okFetch });
    const e = caught(() => svc.register(PLUGIN, params(9001, { serviceId: `x.${OTHER}.api` })));
    expect(e.kind).toBe("FORBIDDEN_SCOPE");
    expect(e.details.pluginKind).toBe("PLUGIN_CAPABILITY_DENIED");
    expect(svc.snapshot().endpoints).toHaveLength(0);
  });

  it("uses the exact x.<id>. prefix and never a split-derived owner", () => {
    const svc = mkService({ fetchImpl: okFetch });
    // plugin "a.b" must not adopt x.a.bc.* — the trailing dot in the prefix
    // stops "a.b" from swallowing "a.bc".
    const e = caught(() => svc.register("a.b", params(9002, { serviceId: "x.a.bc.foo" })));
    expect(e.kind).toBe("FORBIDDEN_SCOPE");
  });

  it("first registration of a serviceId wins; the duplicate is CONFLICT", () => {
    const svc = mkService({ fetchImpl: okFetch });
    svc.register(PLUGIN, params(9003));
    const e = caught(() => svc.register(PLUGIN, params(9003)));
    expect(e.kind).toBe("CONFLICT");
    expect(e.details.pluginKind).toBe("PLUGIN_INVALID");
    expect(svc.snapshot().endpoints).toHaveLength(1);
  });

  it("rejects params that fail the pinned schema (PLUGIN_SCHEMA_VIOLATION)", () => {
    const svc = mkService({ fetchImpl: okFetch });
    const e = caught(() =>
      svc.register(PLUGIN, params(9004, { endpoint: { protocol: "http", port: 0 } })),
    );
    expect(e.kind).toBe("PRECONDITION_FAILED");
    expect(e.details.pluginKind).toBe("PLUGIN_SCHEMA_VIOLATION");
  });

  it("refuses mesh exposure with an honest deferral message", () => {
    const svc = mkService({ fetchImpl: okFetch });
    const e = caught(() =>
      svc.register(PLUGIN, params(9005, { expose: { app: true, mesh: true, mcp: false } })),
    );
    expect(e.kind).toBe("PRECONDITION_FAILED");
    expect(e.message).toMatch(/mesh serve lands with the mesh track/);
    expect(svc.snapshot().endpoints).toHaveLength(0);
  });

  it("refuses mcp exposure with an honest deferral message", () => {
    const svc = mkService({ fetchImpl: okFetch });
    const e = caught(() =>
      svc.register(PLUGIN, params(9006, { expose: { app: true, mesh: false, mcp: true } })),
    );
    expect(e.kind).toBe("PRECONDITION_FAILED");
    expect(e.message).toMatch(/MCP endpoint projection lands with the MCP projection slice/);
  });

  it("refuses an endpoint that exposes nothing to the app", () => {
    const svc = mkService({ fetchImpl: okFetch });
    const e = caught(() =>
      svc.register(PLUGIN, params(9007, { expose: { app: false, mesh: false, mcp: false } })),
    );
    expect(e.kind).toBe("PRECONDITION_FAILED");
    expect(e.message).toMatch(/must expose to the app/);
  });
});

// --- mandatory health loop (real server, §17.3) ------------------------------

describe("EndpointService health", () => {
  it("unknown → healthy → unhealthy (rising failures) → healthy, staying registered", async () => {
    let status = 200;
    const server = await listen((_req, res) => {
      res.setHeader("connection", "close");
      res.statusCode = status;
      res.end();
    });
    servers.push(server);
    const svc = mkService({ minIntervalMs: 50 });
    const id = svcId("api");
    const rec = svc.register(PLUGIN, params(portOf(server)));
    expect(rec.health.state).toBe("unknown");

    // first probe fires immediately (§17.3 rule 6)
    await vi.waitFor(() => expect(svc.get(id)?.health.state).toBe("healthy"), {
      timeout: 5_000,
      interval: 20,
    });
    expect(svc.get(id)?.health.consecutiveFailures).toBe(0);
    expect(typeof svc.get(id)?.health.lastCheckedAt).toBe("number");

    // the server goes bad — the endpoint becomes unhealthy and failures climb,
    // but the row is RETAINED (a dead endpoint is visible, not dropped)
    status = 500;
    await vi.waitFor(() => expect(svc.get(id)?.health.state).toBe("unhealthy"), {
      timeout: 5_000,
      interval: 20,
    });
    await vi.waitFor(
      () => expect(svc.get(id)?.health.consecutiveFailures ?? 0).toBeGreaterThanOrEqual(2),
      { timeout: 5_000, interval: 20 },
    );
    expect(svc.snapshot().endpoints).toHaveLength(1);

    // recovery resets the failure counter
    status = 200;
    await vi.waitFor(() => expect(svc.get(id)?.health.state).toBe("healthy"), {
      timeout: 5_000,
      interval: 20,
    });
    expect(svc.get(id)?.health.consecutiveFailures).toBe(0);
  }, 20_000);

  it("a refused connection is unhealthy and the endpoint stays registered", async () => {
    // bind then immediately release a port so connects are refused
    const probe = await listen((_req, res) => res.end());
    const deadPort = portOf(probe);
    await closeServer(probe);

    const svc = mkService({ minIntervalMs: 50 });
    const id = svcId("api");
    svc.register(PLUGIN, params(deadPort));
    await vi.waitFor(() => expect(svc.get(id)?.health.state).toBe("unhealthy"), {
      timeout: 5_000,
      interval: 20,
    });
    expect(svc.get(id)).toBeDefined();
    expect(svc.get(id)?.health.consecutiveFailures ?? 0).toBeGreaterThanOrEqual(1);
  }, 15_000);
});

// --- removal stops the loop (§18.2) ------------------------------------------

describe("EndpointService removal", () => {
  it("unregister validates ownership, removes the row, and stops polling", async () => {
    const counter = { n: 0 };
    const svc = mkService({ fetchImpl: countingFetch(counter), minIntervalMs: 50 });
    const id = svcId("api");
    svc.register(PLUGIN, params(9100));
    await vi.waitFor(() => expect(svc.get(id)?.health.state).toBe("healthy"), {
      timeout: 5_000,
      interval: 20,
    });

    // another plugin cannot withdraw it
    const cross = caught(() => svc.unregister(OTHER, { serviceId: id }));
    expect(cross.kind).toBe("FORBIDDEN_SCOPE");
    // an unknown (but owned-prefix) id is NOT_FOUND
    const missing = caught(() => svc.unregister(PLUGIN, { serviceId: svcId("nope") }));
    expect(missing.kind).toBe("NOT_FOUND");

    const genBefore = svc.snapshot().generation;
    expect(svc.unregister(PLUGIN, { serviceId: id })).toEqual({ ok: true });
    expect(svc.get(id)).toBeUndefined();
    expect(svc.snapshot().endpoints).toHaveLength(0);
    expect(svc.snapshot().generation).toBeGreaterThan(genBefore);

    // no probe fires after removal, even across a full period
    await delay(50);
    const frozen = counter.n;
    await delay(1_200);
    expect(counter.n).toBe(frozen);
  }, 15_000);

  it("withdrawPlugin drops all of a plugin's endpoints and stops their probes; others survive", async () => {
    const mineCount = { n: 0 };
    const otherCount = { n: 0 };
    // one service, two fetch impls keyed by the row's port would be ideal;
    // instead give each plugin its own counting fetch via separate services is
    // not possible (one service owns all rows) — so count by port through a
    // single fetch that inspects the URL.
    const fetchImpl = (async (url: string | URL) => {
      const u = typeof url === "string" ? url : url.toString();
      if (u.includes(":7001/")) mineCount.n += 1;
      else otherCount.n += 1;
      return { status: 200, body: null } as unknown as Response;
    }) as unknown as typeof fetch;
    const svc = mkService({ fetchImpl, minIntervalMs: 50 });

    svc.register(PLUGIN, {
      serviceId: svcId("a"),
      endpoint: { protocol: "http", port: 7001 },
      health: { path: "/h", intervalMs: 1_000 },
      expose: { app: true, mesh: false, mcp: false },
    });
    svc.register(PLUGIN, {
      serviceId: svcId("b"),
      endpoint: { protocol: "http", port: 7001 },
      health: { path: "/h", intervalMs: 1_000 },
      expose: { app: true, mesh: false, mcp: false },
    });
    svc.register(OTHER, {
      serviceId: `x.${OTHER}.c`,
      endpoint: { protocol: "http", port: 7002 },
      health: { path: "/h", intervalMs: 1_000 },
      expose: { app: true, mesh: false, mcp: false },
    });

    await vi.waitFor(
      () => {
        expect(mineCount.n).toBeGreaterThanOrEqual(2);
        expect(otherCount.n).toBeGreaterThanOrEqual(1);
      },
      { timeout: 5_000, interval: 20 },
    );

    expect(svc.withdrawPlugin(PLUGIN)).toBe(2);
    expect(svc.snapshot().endpoints.map((e) => e.serviceId)).toEqual([`x.${OTHER}.c`]);
    expect(svc.get(svcId("a"))).toBeUndefined();
    expect(svc.get(`x.${OTHER}.c`)).toBeDefined();

    await delay(50);
    const frozenMine = mineCount.n;
    const otherBefore = otherCount.n;
    await delay(1_200);
    expect(mineCount.n).toBe(frozenMine); // withdrawn rows stopped probing
    expect(otherCount.n).toBeGreaterThan(otherBefore); // survivor keeps probing
  }, 15_000);
});

// --- generation + change stream ----------------------------------------------

describe("EndpointService change stream", () => {
  it("generation is monotonic and 'changed' carries the full snapshot", async () => {
    const svc = mkService({ fetchImpl: okFetch, minIntervalMs: 50 });
    const gens: number[] = [];
    const snaps: ServicesHealthResult[] = [];
    svc.on("changed", (snap: ServicesHealthResult) => {
      gens.push(snap.generation);
      snaps.push(snap);
    });

    const g0 = svc.snapshot().generation;
    const rec = svc.register(PLUGIN, params(9200, { serviceId: svcId("a") }));
    expect(rec.serviceId).toBe(svcId("a"));
    const g1 = svc.snapshot().generation;
    expect(g1).toBeGreaterThan(g0);
    // register emitted a changed carrying the new row
    expect(snaps.at(-1)?.endpoints.some((e) => e.serviceId === svcId("a"))).toBe(true);

    // the first health flip is another mutation
    await vi.waitFor(() => expect(svc.get(svcId("a"))?.health.state).toBe("healthy"), {
      timeout: 5_000,
      interval: 20,
    });
    const g2 = svc.snapshot().generation;
    expect(g2).toBeGreaterThan(g1);

    svc.unregister(PLUGIN, { serviceId: svcId("a") });
    expect(svc.snapshot().generation).toBeGreaterThan(g2);

    // every emitted generation strictly increased
    for (let i = 1; i < gens.length; i += 1) expect(gens[i]).toBeGreaterThan(gens[i - 1] as number);
  }, 10_000);
});
