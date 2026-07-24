// P6 §17.4 MCP layer — McpService's two halves exercised against fakes and a
// REAL fixture stdio process. The contribute half projects declared x.* methods
// as tools (schema comes from the DECLARED METHOD, provenance is legible, and
// `available` tracks providerUp live); the consume half runs stdio children over
// the spawn seam and http sessions over a fetch stub. Instantiated directly — no
// daemon — so every assertion is about the service's own policy and state machine.
import { spawn as nodeSpawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createNoopLogger } from "@vibefield/logging";
import { afterEach, describe, expect, it } from "vitest";
import { McpService, type McpServiceConfig } from "../src/mcp-service";
import { RpcCallError } from "../src/native-link";

const FIXTURE = fileURLToPath(new URL("./fixtures/mcp-stdio-server.mjs", import.meta.url));
const logger = createNoopLogger();

const tick = (ms = 25) => new Promise<void>((r) => setTimeout(r, ms));

// A registry entry shaped exactly like McpServiceConfig.registry.get returns.
type Entry = NonNullable<ReturnType<McpServiceConfig["registry"]["get"]>>;

function fakeRegistry(plugins: Record<string, Entry>): McpServiceConfig["registry"] {
  return {
    get: (id) => plugins[id],
    list: () => Object.keys(plugins),
  };
}

// Real child processes, captured so a test can kill one to simulate a crash.
function makeSpawner() {
  const children: ReturnType<typeof nodeSpawn>[] = [];
  const spawn: NonNullable<McpServiceConfig["spawn"]> = (req) => {
    const child = nodeSpawn(req.executable, req.args, {
      stdio: ["pipe", "pipe", "pipe"],
      ...(req.cwd !== undefined ? { cwd: req.cwd } : {}),
      ...(req.env !== undefined ? { env: { ...process.env, ...req.env } } : {}),
    });
    children.push(child);
    return {
      stdin: child.stdin,
      stdout: child.stdout,
      stderr: child.stderr,
      kill: () => child.kill(),
      onExit: (cb) => child.on("exit", cb),
    };
  };
  return { spawn, children };
}

const FORECAST_INPUT = {
  type: "object",
  properties: { city: { type: "string" } },
  required: ["city"],
  additionalProperties: false,
};
const ALERTS_INPUT = {
  type: "object",
  properties: { region: { type: "string" } },
  required: ["region"],
  additionalProperties: false,
};

function weatherEntry(overrides: Partial<Entry> = {}): Entry {
  return {
    enabled: true,
    grantedCapabilities: ["mcp.contribute"],
    mcp: {
      tools: [
        {
          name: "forecast",
          title: "Forecast",
          description: "the forecast",
          method: "x.weather.getForecast",
        },
        {
          name: "alerts",
          title: "Alerts",
          description: "active alerts",
          method: "x.weather.getAlerts",
        },
      ],
    },
    declaredMethods: new Map([
      ["x.weather.getForecast", { kind: "query", input: FORECAST_INPUT }],
      ["x.weather.getAlerts", { kind: "query", input: ALERTS_INPUT }],
    ]),
    ...overrides,
  };
}

const services: McpService[] = [];
function make(config: Omit<McpServiceConfig, "logger">): McpService {
  const svc = new McpService({ logger, ...config });
  services.push(svc);
  return svc;
}

afterEach(() => {
  for (const svc of services.splice(0)) svc.dispose();
});

describe("contribute half — projecting declared methods as tools", () => {
  it("projects one tool per declared tool, with the DECLARED METHOD's input schema and live availability", () => {
    let up = true;
    const svc = make({
      registry: fakeRegistry({ weather: weatherEntry() }),
      callDynamic: async () => ({}),
      providerUp: () => up,
    });
    svc.refreshContributed();

    const tools = svc.toolsList().tools;
    expect(tools).toHaveLength(2);
    const forecast = tools.find((t) => t.tool === "plugin:weather:forecast");
    expect(forecast).toBeDefined();
    expect(forecast?.source).toEqual({ kind: "plugin", pluginId: "weather" });
    expect(forecast?.title).toBe("Forecast");
    // the schema is the declared METHOD's input, never re-invented by the tool
    expect(forecast?.inputSchema).toEqual(FORECAST_INPUT);
    expect(forecast?.available).toBe(true);

    // available flips with providerUp, with no refresh
    up = false;
    expect(svc.toolsList().tools.find((t) => t.tool === "plugin:weather:forecast")?.available).toBe(
      false,
    );
  });

  it("does not project a disabled plugin or one missing mcp.contribute", () => {
    const svc = make({
      registry: fakeRegistry({
        off: weatherEntry({ enabled: false }),
        ungranted: weatherEntry({ grantedCapabilities: [] }),
      }),
      callDynamic: async () => ({}),
      providerUp: () => true,
    });
    svc.refreshContributed();
    expect(svc.toolsList().tools).toHaveLength(0);
  });

  it("skips a tool whose referenced method was never declared", () => {
    const svc = make({
      registry: fakeRegistry({
        weather: weatherEntry({
          declaredMethods: new Map([
            ["x.weather.getForecast", { kind: "query", input: FORECAST_INPUT }],
          ]),
        }),
      }),
      callDynamic: async () => ({}),
      providerUp: () => true,
    });
    svc.refreshContributed();
    const names = svc.toolsList().tools.map((t) => t.tool);
    expect(names).toEqual(["plugin:weather:forecast"]);
  });

  it("narrows live tools to a declared subset and refuses a non-subset", () => {
    const svc = make({
      registry: fakeRegistry({ weather: weatherEntry() }),
      callDynamic: async () => ({}),
      providerUp: () => true,
    });
    svc.refreshContributed();
    expect(svc.toolsList().tools).toHaveLength(2);

    svc.contributeSet("weather", { tools: ["forecast"] });
    expect(svc.toolsList().tools.map((t) => t.tool)).toEqual(["plugin:weather:forecast"]);

    // narrowing survives a later refresh (in-memory v1)
    svc.refreshContributed();
    expect(svc.toolsList().tools.map((t) => t.tool)).toEqual(["plugin:weather:forecast"]);

    expect(() => svc.contributeSet("weather", { tools: ["not-declared"] })).toThrowError(
      /not a declared mcp tool/,
    );
  });

  it("withdrawPlugin removes that plugin's projected tools", () => {
    const svc = make({
      registry: fakeRegistry({ weather: weatherEntry() }),
      callDynamic: async () => ({}),
      providerUp: () => true,
    });
    svc.refreshContributed();
    expect(svc.toolsList().tools.length).toBeGreaterThan(0);
    svc.withdrawPlugin("weather");
    expect(svc.toolsList().tools).toHaveLength(0);
  });
});

describe("contribute half — tool call routing", () => {
  it("routes a plugin tool through callDynamic with (method, args)", async () => {
    const calls: Array<[string, unknown]> = [];
    const svc = make({
      registry: fakeRegistry({ weather: weatherEntry() }),
      callDynamic: async (method, args) => {
        calls.push([method, args]);
        return { temp: 21 };
      },
      providerUp: () => true,
    });
    svc.refreshContributed();

    const res = await svc.toolsCall({ tool: "plugin:weather:forecast", args: { city: "nyc" } });
    expect(calls).toEqual([["x.weather.getForecast", { city: "nyc" }]]);
    expect(res.output).toEqual({ temp: 21 });
  });

  it("NOT_FOUND for an unknown tool", async () => {
    const svc = make({
      registry: fakeRegistry({ weather: weatherEntry() }),
      callDynamic: async () => ({}),
      providerUp: () => true,
    });
    svc.refreshContributed();
    await expect(svc.toolsCall({ tool: "plugin:weather:ghost" })).rejects.toMatchObject({
      kind: "NOT_FOUND",
    });
  });

  it("known tool whose provider is down → NOT_FOUND with the PLUGIN_PROVIDER_GONE discriminator", async () => {
    let up = true;
    const svc = make({
      registry: fakeRegistry({ weather: weatherEntry() }),
      callDynamic: async () => ({}),
      providerUp: () => up,
    });
    svc.refreshContributed();
    up = false;
    await expect(svc.toolsCall({ tool: "plugin:weather:forecast" })).rejects.toMatchObject({
      kind: "NOT_FOUND",
      details: { pluginKind: "PLUGIN_PROVIDER_GONE" },
    });
  });
});

describe("consume half — stdio", () => {
  const emptyRegistry = fakeRegistry({});

  it("starts a child, lists its tools, and round-trips a tools/call", async () => {
    const { spawn } = makeSpawner();
    const svc = make({
      registry: emptyRegistry,
      callDynamic: async () => ({}),
      providerUp: () => true,
      spawn,
    });

    const added = svc.serversAdd({
      id: "calc",
      transport: { kind: "stdio", executable: process.execPath, args: [FIXTURE] },
    });
    expect(added.serverKey).toBe("user/calc");
    expect(added.state).toBe("stopped");

    const started = await svc.startServer("user/calc");
    expect(started.state).toBe("running");
    expect(started.toolCount).toBe(1);

    const addTool = svc.toolsList().tools.find((t) => t.tool === "server:user/calc:add");
    expect(addTool).toBeDefined();
    expect(addTool?.source).toEqual({ kind: "server", serverKey: "user/calc" });
    expect(addTool?.available).toBe(true);

    const res = await svc.toolsCall({ tool: "server:user/calc:add", args: { a: 2, b: 3 } });
    expect(res.output).toMatchObject({ content: [{ type: "text", text: "5" }] });

    const stopped = svc.stopServer("user/calc");
    expect(stopped.state).toBe("stopped");
  });

  it("a crash during startup lands the session failed without throwing", async () => {
    const { spawn } = makeSpawner();
    const svc = make({
      registry: emptyRegistry,
      callDynamic: async () => ({}),
      providerUp: () => true,
      spawn,
    });
    svc.serversAdd({
      id: "boom",
      transport: {
        kind: "stdio",
        executable: process.execPath,
        args: [FIXTURE, "--crash-after-init"],
      },
    });
    const rec = await svc.startServer("user/boom");
    expect(rec.state).toBe("failed");
    expect(rec.lastError).toBeTruthy();
  });

  it("an unexpected child exit lands failed and RETAINS the tools as unavailable", async () => {
    const { spawn, children } = makeSpawner();
    const svc = make({
      registry: emptyRegistry,
      callDynamic: async () => ({}),
      providerUp: () => true,
      spawn,
    });
    svc.serversAdd({
      id: "calc2",
      transport: { kind: "stdio", executable: process.execPath, args: [FIXTURE] },
    });
    await svc.startServer("user/calc2");
    expect(svc.toolsList().tools.filter((t) => t.tool === "server:user/calc2:add")).toHaveLength(1);

    // simulate a crash: kill the underlying child directly (not via stopServer)
    const child = children[children.length - 1];
    if (child === undefined) throw new Error("expected a spawned child");
    await new Promise<void>((resolve) => {
      child.on("exit", () => resolve());
      child.kill("SIGKILL");
    });
    await tick();

    const rec = svc.serversList().servers.find((s) => s.serverKey === "user/calc2");
    expect(rec?.state).toBe("failed");
    const retained = svc.toolsList().tools.filter((t) => t.tool === "server:user/calc2:add");
    expect(retained).toHaveLength(1);
    expect(retained[0]?.available).toBe(false);
  });
});

describe("consume half — server registration rules", () => {
  it("rejects a duplicate user server with CONFLICT", () => {
    const svc = make({
      registry: fakeRegistry({}),
      callDynamic: async () => ({}),
      providerUp: () => true,
    });
    svc.serversAdd({ id: "dup", transport: { kind: "http", url: "https://example.test/mcp" } });
    let thrown: unknown;
    try {
      svc.serversAdd({ id: "dup", transport: { kind: "http", url: "https://example.test/mcp" } });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(RpcCallError);
    expect((thrown as RpcCallError).kind).toBe("CONFLICT");
  });

  it("refuses removing a plugin-declared server via the user surface (PRECONDITION_FAILED)", () => {
    const svc = make({
      registry: fakeRegistry({}),
      callDynamic: async () => ({}),
      providerUp: () => true,
    });
    svc.addDeclaredServer(
      "acme",
      { id: "srv", transport: { kind: "http", urlSetting: "apiUrl" } },
      (k) => (k === "apiUrl" ? "https://acme.test/mcp" : undefined),
    );
    let thrown: unknown;
    try {
      svc.serversRemove({ serverKey: "acme/srv" });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(RpcCallError);
    expect((thrown as RpcCallError).kind).toBe("PRECONDITION_FAILED");
    // still present, still owned by its plugin
    expect(svc.serversList().servers.find((s) => s.serverKey === "acme/srv")?.ownerPluginId).toBe(
      "acme",
    );
  });
});

describe("consume half — http", () => {
  it("handshakes, lists, and calls over the fetch seam, echoing the session id", async () => {
    const requests: Array<{
      body: { method: string; id?: number };
      sessionHeader: string | undefined;
    }> = [];
    const fetchImpl = (async (_url: string | URL, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      const body = JSON.parse(String(init?.body)) as { method: string; id?: number };
      requests.push({ body, sessionHeader: headers["mcp-session-id"] });
      const json = (payload: unknown, extra: Record<string, string> = {}) =>
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { "content-type": "application/json", ...extra },
        });
      switch (body.method) {
        case "initialize":
          return json(
            {
              jsonrpc: "2.0",
              id: body.id,
              result: { protocolVersion: "2025-06-18", capabilities: {} },
            },
            { "mcp-session-id": "sess-abc" },
          );
        case "notifications/initialized":
          return new Response(null, { status: 202 });
        case "tools/list":
          return json({
            jsonrpc: "2.0",
            id: body.id,
            result: {
              tools: [{ name: "echo", description: "echoes", inputSchema: { type: "object" } }],
            },
          });
        case "tools/call":
          return json({
            jsonrpc: "2.0",
            id: body.id,
            result: { content: [{ type: "text", text: "hi" }] },
          });
        default:
          return json({ jsonrpc: "2.0", id: body.id, error: { code: -32601, message: "no" } });
      }
    }) as unknown as typeof fetch;

    const svc = make({
      registry: fakeRegistry({}),
      callDynamic: async () => ({}),
      providerUp: () => true,
      fetchImpl,
    });
    svc.serversAdd({ id: "remote", transport: { kind: "http", url: "https://example.test/mcp" } });
    const started = await svc.startServer("user/remote");
    expect(started.state).toBe("running");
    expect(started.toolCount).toBe(1);

    // the session id from initialize is echoed on tools/list and after
    const toolsListReq = requests.find((r) => r.body.method === "tools/list");
    expect(toolsListReq?.sessionHeader).toBe("sess-abc");

    const res = await svc.toolsCall({ tool: "server:user/remote:echo", args: { msg: "yo" } });
    expect(res.output).toMatchObject({ content: [{ text: "hi" }] });
  });

  it("an SSE-only response is an honest UNAVAILABLE, not a silent success", async () => {
    const fetchImpl = (async () =>
      new Response("event: message\ndata: {}\n\n", {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      })) as unknown as typeof fetch;
    const svc = make({
      registry: fakeRegistry({}),
      callDynamic: async () => ({}),
      providerUp: () => true,
      fetchImpl,
    });
    svc.serversAdd({ id: "sse", transport: { kind: "http", url: "https://example.test/sse" } });
    const rec = await svc.startServer("user/sse");
    expect(rec.state).toBe("failed");
    expect(rec.lastError).toMatch(/SSE|event stream/i);
  });

  it("resolves a declared http server's url from settings at start time", async () => {
    let resolvedUrl: string | URL | undefined;
    const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
      resolvedUrl = url;
      const body = JSON.parse(String(init?.body)) as { method: string; id?: number };
      const json = (payload: unknown) =>
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      if (body.method === "initialize")
        return json({ jsonrpc: "2.0", id: body.id, result: { capabilities: {} } });
      if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
      return json({ jsonrpc: "2.0", id: body.id, result: { tools: [] } });
    }) as unknown as typeof fetch;

    const svc = make({
      registry: fakeRegistry({}),
      callDynamic: async () => ({}),
      providerUp: () => true,
      fetchImpl,
    });
    svc.addDeclaredServer(
      "acme",
      { id: "api", transport: { kind: "http", urlSetting: "apiUrl" } },
      (k) => (k === "apiUrl" ? "https://acme.test/mcp" : undefined),
    );
    const rec = await svc.startServer("acme/api");
    expect(rec.state).toBe("running");
    expect(String(resolvedUrl)).toBe("https://acme.test/mcp");
  });
});
