// CP-1b — the `vibefield` MCP server's protocol, one connection at a time (the compose plane, version 2; CP-L2, CP-D1).
// Transport-free: the door hands it one JSON-RPC line and writes back the line it answers. fieldd has no MCP library
// (its client, mcp-service.ts, is hand-written too), and this answers only what a caller needs: tools (the tool plane,
// MT-0: one server for every room, each caller listed its rows by their audience).
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
  /** All four, from the catalog's row (gen/tools.ts): every room is closed-world. */
  readonly annotations?: {
    readonly readOnlyHint: boolean;
    readonly destructiveHint: boolean;
    readonly idempotentHint: boolean;
    readonly openWorldHint: boolean;
  };
}

/** What a tool call answered: the structured result, and the words a model reads. */
export interface McpCallResult {
  readonly structured?: unknown;
  readonly text: string;
  readonly isError?: boolean;
}

export interface McpServerOptions {
  readonly serverInfo: { readonly name: string; readonly version: string };
  /** The caller's own paragraph, read at each handshake (MT-0, the MT lead's ruling 12: built from what it is listed). */
  instructions?(): string | undefined;
  /** The caller's rows, by their audience (MT-0). Read at each list; a settled caller's are the same for its whole
   * session (MT-D4), so no `listChanged` is ever announced. */
  tools(): readonly McpTool[];
  /** Run one tool. The service holds every call to the caller's own rows and answers a refusal as a tool result with a
   * fact the model can act on; a thrown error becomes a tool error too, never a protocol error. */
  call(name: string, args: Record<string, unknown>): Promise<McpCallResult>;
  /** How long a client may keep the tool list: 0 while the caller is not yet settled, so a harness that listed too
   * early asks again. The list of a settled caller changes only when fieldd does. */
  listTtlMs?(): number | undefined;
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
          ...instructions(this.opts),
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
    const ttlMs = this.opts.listTtlMs?.() ?? 60 * 60 * 1000;

    switch (method) {
      case "server/discover":
        return done({
          supportedVersions: [MCP_MODERN],
          capabilities: { tools: {} },
          ...instructions(this.opts),
          ttlMs,
          cacheScope: "private",
        });
      case "ping":
        return { ok: {} };
      case "tools/list":
        return done({
          tools: this.opts.tools().map(listed),
          // The list is the caller's own (its audience's rows, or nothing), so no other caller may reuse it.
          ...(modern ? { ttlMs, cacheScope: "private" } : {}),
        });
      case "tools/call": {
        const name = params.name;
        // A malformed call is the protocol's; a name the caller is not listed (unknown, or another audience's) is the
        // service's to refuse as a result the model reads (the study's §8; index.ts holds the call to the row).
        if (typeof name !== "string")
          return {
            error: { code: MCP_ERRORS.invalidParams, message: "a tool's name is a string" },
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

const instructions = (opts: McpServerOptions) => {
  const text = opts.instructions?.();
  return text ? { instructions: text } : {};
};

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
