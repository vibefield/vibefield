// CP-1b — the `vibefield` MCP server's protocol, one connection at a time (the compose plane, version 2; CP-L2, CP-D1).
// Transport-free: the door hands it one JSON-RPC line and writes back the line it answers. fieldd has no MCP library
// (its client, mcp-service.ts, is hand-written too), and this answers only what a spark needs: tools.
//
// Two eras on one connection, as the 2026-07-28 revision allows ("a dual-era server MAY serve both"):
// - 2026-07-28 (stateless): no handshake. Every request carries `_meta` with the protocol version and the client's
//   capabilities, or it is refused -32602; a version this server does not speak is refused -32022 with the versions it
//   does. `server/discover` is answered; every result says `resultType`, and list results their caching hints.
//   Measured 2026-10-29 (the study's §16.1): Claude Code 2.1.312 opens with `server/discover` on 2026-07-28.
// - Before it: an `initialize` selects the old semantics for the rest of the connection (`ping`, no `_meta`).
// It never writes anything that is not an MCP message, and a notification gets no answer.

/** The revision this server speaks natively, and the handshake revisions it still accepts. */
export const MCP_MODERN = "2026-07-28";
export const MCP_LEGACY = ["2025-11-25", "2025-06-18", "2025-03-26"] as const;

const META_VERSION = "io.modelcontextprotocol/protocolVersion";
const META_CAPABILITIES = "io.modelcontextprotocol/clientCapabilities";
const META_SERVER = "io.modelcontextprotocol/serverInfo";

/** JSON-RPC's and MCP's error codes (the spec's: -32022 UnsupportedProtocolVersion). */
export const MCP_ERRORS = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
  unsupportedVersion: -32022,
} as const;

/** A tool as `tools/list` shows it. */
export interface McpTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly outputSchema?: Readonly<Record<string, unknown>>;
  readonly annotations?: { readonly readOnlyHint?: boolean };
}

/** What a tool call answered: the structured result, and the words a model reads. */
export interface McpCallResult {
  readonly structured?: unknown;
  readonly text: string;
  readonly isError?: boolean;
}

export interface McpServerOptions {
  readonly serverInfo: { readonly name: string; readonly version: string };
  readonly instructions?: string;
  /** The caller's tools: every built verb for a spark, none for anything else (CP-L1). Read at each list. */
  tools(): readonly McpTool[];
  /** Run one tool the caller holds. A thrown error becomes a tool error the model reads, never a protocol error. */
  call(name: string, args: Record<string, unknown>): Promise<McpCallResult>;
  /** How long a client may keep the tool list. The list changes only when fieldd does. */
  readonly listTtlMs?: number;
}

type Id = string | number;
interface RpcError {
  code: number;
  message: string;
  data?: unknown;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export class McpConnection {
  #legacy: string | null = null;

  constructor(private readonly opts: McpServerOptions) {}

  /** One line in, at most one line out (undefined for a notification). Never throws. */
  async receive(line: string): Promise<string | undefined> {
    let msg: unknown;
    try {
      msg = JSON.parse(line);
    } catch {
      return reply(null, undefined, { code: MCP_ERRORS.parse, message: "not JSON" });
    }
    if (!isRecord(msg) || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
      // A response to nothing we asked, or a batch (gone since 2025-06-18): neither is ours to answer.
      if (isRecord(msg) && msg.id !== undefined && msg.method === undefined) return undefined;
      return reply(null, undefined, {
        code: MCP_ERRORS.invalidRequest,
        message: "not a JSON-RPC request",
      });
    }
    const id = msg.id;
    if (id === undefined) return undefined; // a notification: notifications/initialized, cancelled
    if ((typeof id !== "string" && typeof id !== "number") || id === null)
      return reply(null, undefined, {
        code: MCP_ERRORS.invalidRequest,
        message: "an id is a string or an integer",
      });
    const params = isRecord(msg.params) ? msg.params : {};
    try {
      const result = await this.#dispatch(msg.method, params);
      return "error" in result
        ? reply(id, undefined, result.error)
        : reply(id, result.ok, undefined);
    } catch (err) {
      return reply(id, undefined, {
        code: MCP_ERRORS.internal,
        message: (err as Error).message ?? "failed",
      });
    }
  }

  async #dispatch(
    method: string,
    params: Record<string, unknown>,
  ): Promise<{ ok: unknown } | { error: RpcError }> {
    if (method === "initialize") {
      const asked =
        typeof params.protocolVersion === "string" ? params.protocolVersion : MCP_LEGACY[0];
      this.#legacy = (MCP_LEGACY as readonly string[]).includes(asked) ? asked : MCP_LEGACY[0];
      return {
        ok: {
          protocolVersion: this.#legacy,
          capabilities: { tools: {} },
          serverInfo: this.opts.serverInfo,
          ...(this.opts.instructions ? { instructions: this.opts.instructions } : {}),
        },
      };
    }
    const meta = isRecord(params._meta) ? params._meta : undefined;
    const modern = meta?.[META_VERSION] !== undefined || this.#legacy === null;
    if (modern) {
      const version = meta?.[META_VERSION];
      if (typeof version !== "string" || !isRecord(meta?.[META_CAPABILITIES]))
        return {
          error: {
            code: MCP_ERRORS.invalidParams,
            message: `every request carries _meta with ${META_VERSION} and ${META_CAPABILITIES}`,
          },
        };
      if (version !== MCP_MODERN)
        return {
          error: {
            code: MCP_ERRORS.unsupportedVersion,
            message: "Unsupported protocol version",
            data: { supported: [MCP_MODERN], requested: version },
          },
        };
    }
    const done = (body: Record<string, unknown>) =>
      modern
        ? {
            ok: { resultType: "complete", ...body, _meta: { [META_SERVER]: this.opts.serverInfo } },
          }
        : { ok: body };
    const ttlMs = this.opts.listTtlMs ?? 60 * 60 * 1000;

    switch (method) {
      case "server/discover":
        return done({
          supportedVersions: [MCP_MODERN],
          capabilities: { tools: {} },
          ...(this.opts.instructions ? { instructions: this.opts.instructions } : {}),
          ttlMs,
          cacheScope: "private",
        });
      case "ping":
        return { ok: {} };
      case "tools/list":
        return done({
          tools: this.opts.tools().map(listed),
          // The list is the caller's own (a spark's, or nothing), so no other caller may reuse it.
          ...(modern ? { ttlMs, cacheScope: "private" } : {}),
        });
      case "tools/call": {
        const name = params.name;
        if (typeof name !== "string" || !this.opts.tools().some((t) => t.name === name))
          return {
            error: { code: MCP_ERRORS.invalidParams, message: `no tool named ${String(name)}` },
          };
        const args = isRecord(params.arguments) ? params.arguments : {};
        let result: McpCallResult;
        try {
          result = await this.opts.call(name, args);
        } catch (err) {
          result = { text: (err as Error).message || "the call failed", isError: true };
        }
        return done({
          content: [{ type: "text", text: result.text }],
          ...(result.structured !== undefined ? { structuredContent: result.structured } : {}),
          ...(result.isError ? { isError: true } : {}),
        });
      }
      default:
        return {
          error: {
            code: MCP_ERRORS.methodNotFound,
            message: `the vibefield server answers no ${method}`,
          },
        };
    }
  }
}

const listed = (tool: McpTool) => ({
  name: tool.name,
  description: tool.description,
  inputSchema: tool.inputSchema,
  ...(tool.outputSchema ? { outputSchema: tool.outputSchema } : {}),
  ...(tool.annotations ? { annotations: tool.annotations } : {}),
});

function reply(id: Id | null, result: unknown, error: RpcError | undefined): string {
  return JSON.stringify(error ? { jsonrpc: "2.0", id, error } : { jsonrpc: "2.0", id, result });
}
