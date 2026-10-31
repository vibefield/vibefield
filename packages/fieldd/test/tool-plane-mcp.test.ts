import { describe, expect, it } from "vitest";
import { MCP_ERRORS, MCP_MODERN, McpConnection, type McpTool } from "../src/tool-plane/mcp";

// CP-1b — the `vibefield` server's protocol (the compose plane, version 2). The modern frames are the ones Claude Code
// 2.1.312 sent in the 2026-10-29 measurement (the study's §16.1): `server/discover` first, then `tools/list`, each with
// `_meta` carrying the revision and the client's capabilities.

const META = {
  "io.modelcontextprotocol/protocolVersion": MCP_MODERN,
  "io.modelcontextprotocol/clientInfo": { name: "claude-code", version: "2.1.312" },
  "io.modelcontextprotocol/clientCapabilities": {
    roots: { listChanged: true },
    elicitation: { form: {}, url: {} },
  },
};
const TOOL: McpTool = {
  name: "agents_list",
  description: "List the agent sessions under your profiles.",
  inputSchema: { type: "object", properties: {} },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};

function server(tools: readonly McpTool[] = [TOOL], ttl?: () => number | undefined) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const conn = new McpConnection({
    serverInfo: { name: "vibefield", version: "0.1.0" },
    instructions: () => "VibeField's tools for sparks.",
    tools: () => tools,
    ...(ttl ? { listTtlMs: ttl } : {}),
    call: async (name, args) => {
      calls.push({ name, args });
      if (args.fail) throw new Error("the index is building");
      return { structured: { sessions: [] }, text: '{"sessions":[]}' };
    },
  });
  const ask = async (msg: unknown) => {
    const out = await conn.receive(typeof msg === "string" ? msg : JSON.stringify(msg));
    return out === undefined ? undefined : JSON.parse(out);
  };
  return { ask, calls };
}

describe("the vibefield server, 2026-07-28 (CP-1b)", () => {
  it("answers server/discover with its one revision, its tools capability and a private cache hint", async () => {
    const { ask } = server();
    const out = await ask({
      jsonrpc: "2.0",
      id: "server-discover-probe-1",
      method: "server/discover",
      params: { _meta: META },
    });
    expect(out.id).toBe("server-discover-probe-1");
    expect(out.result).toMatchObject({
      resultType: "complete",
      supportedVersions: [MCP_MODERN],
      capabilities: { tools: {} },
      instructions: "VibeField's tools for sparks.",
      cacheScope: "private",
    });
    expect(out.result.ttlMs).toBeGreaterThan(0);
    expect(out.result._meta["io.modelcontextprotocol/serverInfo"]).toEqual({
      name: "vibefield",
      version: "0.1.0",
    });
  });

  it("lists the caller's tools with a ttl, so a client stops asking again", async () => {
    const { ask } = server();
    const out = await ask({ jsonrpc: "2.0", id: 1, method: "tools/list", params: { _meta: META } });
    expect(out.result.resultType).toBe("complete");
    expect(out.result.tools).toEqual([
      {
        name: "agents_list",
        description: TOOL.description,
        inputSchema: TOOL.inputSchema,
        annotations: TOOL.annotations,
      },
    ]);
    expect(out.result.ttlMs).toBeGreaterThan(0);
    expect(out.result.cacheScope).toBe("private");
  });

  it("refuses a request without _meta (-32602) and a revision it does not speak (-32022, with what it does)", async () => {
    const { ask } = server();
    expect(
      (await ask({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })).error.code,
    ).toBe(MCP_ERRORS.invalidParams);
    const old = await ask({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/list",
      params: { _meta: { ...META, "io.modelcontextprotocol/protocolVersion": "1900-01-01" } },
    });
    expect(old.error).toEqual({
      code: MCP_ERRORS.unsupportedVersion,
      message: "Unsupported protocol version",
      data: { supported: [MCP_MODERN], requested: "1900-01-01" },
    });
  });

  it("runs a tool the caller holds, and a thrown error is the tool's answer, never a protocol error", async () => {
    const { ask, calls } = server();
    const ok = await ask({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { _meta: META, name: "agents_list", arguments: { ended: true } },
    });
    expect(ok.result).toMatchObject({
      resultType: "complete",
      content: [{ type: "text", text: '{"sessions":[]}' }],
      structuredContent: { sessions: [] },
    });
    expect(ok.result.isError).toBeUndefined();
    expect(calls).toEqual([{ name: "agents_list", args: { ended: true } }]);
    const failed = await ask({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: { _meta: META, name: "agents_list", arguments: { fail: true } },
    });
    expect(failed.result).toMatchObject({
      isError: true,
      content: [{ type: "text", text: "the index is building" }],
    });
  });

  it("says ttl 0 on discover and on the list while the caller is unsettled, so the client asks again", async () => {
    const { ask } = server([], () => 0);
    const discover = await ask({
      jsonrpc: "2.0",
      id: 1,
      method: "server/discover",
      params: { _meta: META },
    });
    expect(discover.result.ttlMs).toBe(0);
    const list = await ask({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: { _meta: META },
    });
    expect(list.result.ttlMs).toBe(0);
  });

  // MT-0: a name the caller is not listed is the service's to refuse, as a result with a fact (index.ts); only a
  // malformed call is the protocol's.
  it("hands a named call to the service whatever the list held, and refuses a call with no name (-32602)", async () => {
    const { ask, calls } = server([]);
    const list = await ask({
      jsonrpc: "2.0",
      id: 6,
      method: "tools/list",
      params: { _meta: META },
    });
    expect(list.result.tools).toEqual([]);
    const call = await ask({
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: { _meta: META, name: "agents_list" },
    });
    expect(call.result.resultType).toBe("complete");
    expect(calls.map((c) => c.name)).toEqual(["agents_list"]);
    const nameless = await ask({
      jsonrpc: "2.0",
      id: 8,
      method: "tools/call",
      params: { _meta: META },
    });
    expect(nameless.error.code).toBe(MCP_ERRORS.invalidParams);
    expect(calls).toHaveLength(1);
  });

  it("answers no notification, no stray response, and says so for a method it lacks or a line that is not JSON", async () => {
    const { ask } = server();
    expect(
      await ask({ jsonrpc: "2.0", method: "notifications/cancelled", params: {} }),
    ).toBeUndefined();
    expect(await ask({ jsonrpc: "2.0", id: 9, result: {} })).toBeUndefined();
    expect(
      (await ask({ jsonrpc: "2.0", id: 10, method: "resources/list", params: { _meta: META } }))
        .error.code,
    ).toBe(MCP_ERRORS.methodNotFound);
    expect((await ask("{not json")).error.code).toBe(MCP_ERRORS.parse);
  });
});

describe("the vibefield server, the handshake before 2026-07-28", () => {
  it("takes initialize, then serves that connection without _meta, ping included", async () => {
    const { ask } = server();
    const init = await ask({
      jsonrpc: "2.0",
      id: 0,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "older", version: "1" },
      },
    });
    expect(init.result).toMatchObject({
      protocolVersion: "2025-06-18",
      capabilities: { tools: {} },
      serverInfo: { name: "vibefield", version: "0.1.0" },
    });
    expect(await ask({ jsonrpc: "2.0", method: "notifications/initialized" })).toBeUndefined();
    expect((await ask({ jsonrpc: "2.0", id: 1, method: "ping" })).result).toEqual({});
    const list = await ask({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    expect(list.result.tools).toHaveLength(1);
    expect(list.result.resultType).toBeUndefined();
  });

  it("offers its newest handshake revision to a client that asks for one it does not know", async () => {
    const { ask } = server();
    const init = await ask({
      jsonrpc: "2.0",
      id: 0,
      method: "initialize",
      params: { protocolVersion: "2024-01-01" },
    });
    expect(init.result.protocolVersion).toBe("2025-11-25");
  });
});
