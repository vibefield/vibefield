import type {
  JsonSchemaObject,
  McpContribution,
  McpServerRecord,
  McpServerState,
  McpServersListResult,
  McpToolRecord,
  McpToolsCallResult,
  McpToolsListResult,
  UserMcpTransport,
} from "@vibefield/contracts";
import {
  McpContributeSetParams,
  McpServersAddParams,
  McpServersRemoveParams,
  McpToolsCallParams,
} from "@vibefield/contracts";
import { createNoopLogger, type Logger } from "@vibefield/logging";
import { RpcCallError } from "./native-link";

// McpService — the P6 §17.4 MCP layer, in two halves that never touch bytes on
// JSON-RPC (EL2): CONTRIBUTE projects a plugin's already-declared x.* methods as
// aggregated tools (the tool never invents its own schema — §8.7), and CONSUME
// runs MCP client sessions (stdio children / streamable-http) whose remote tools
// join the same aggregated list. Provenance is legible in every row: the calling
// name is `plugin:<pluginId>:<name>` or `server:<serverKey>:<name>`, and `available`
// tells the honest truth — a projected tool whose provider crashed, or a server
// whose child exited, is retained and VISIBLE as unavailable, never silently dropped.
//
// This service owns policy/state only. The daemon backs the seams: `callDynamic`
// routes into the ServiceRegistry (which is the authority on output validation, so
// this layer never re-validates), `providerUp` reports live namespace health for the
// crash/disable withdrawal, `spawn` is ProcessService, and setting resolution for
// declared servers happens at START time through a caller-supplied resolver (secrets
// never live in this table). autoStart is a flag here; scheduling is the daemon's job.

const MCP_PROTOCOL_VERSION = "2025-06-18";
const CLIENT_INFO = { name: "vibefield", version: "0.1.0" } as const;
const INITIALIZE_PARAMS = {
  protocolVersion: MCP_PROTOCOL_VERSION,
  clientInfo: CLIENT_INFO,
  capabilities: {},
} as const;
/** One request may not hold a session hostage — §17.4 honest UNAVAILABLE past this. */
const REQUEST_TIMEOUT_MS = 10_000;

/** The spawn seam's process handle (orchestrator backs it with ProcessService). */
interface McpSpawnHandle {
  stdin: NodeJS.WritableStream;
  stdout: NodeJS.ReadableStream;
  stderr: NodeJS.ReadableStream;
  kill: () => void;
  onExit: (cb: (code: number | null) => void) => void;
}

export interface McpServiceConfig {
  logger?: Logger;
  /** resolve a plugin's manifest-declared mcp contribution + granted caps + enabled state */
  registry: {
    get(pluginId: string):
      | {
          enabled: boolean;
          grantedCapabilities: readonly string[];
          mcp?: {
            tools?: Array<{ name: string; title: string; description: string; method: string }>;
          };
          declaredMethods?: ReadonlyMap<string, { kind: string; input: object; output?: object }>;
        }
      | undefined;
    list(): string[];
  };
  /** call a dynamic x.* method AS an internal mcp caller; throws RpcCallError on gate failure */
  callDynamic: (method: string, params: unknown) => Promise<unknown>;
  /** whether the provider namespace is currently up (crash/disable withdrawal — §17.4) */
  providerUp: (namespace: string) => boolean;
  /** test seam for stdio children; orchestrator backs it with ProcessService */
  spawn?: (req: {
    executable: string;
    args: string[];
    cwd?: string;
    env?: Record<string, string>;
  }) => McpSpawnHandle;
  fetchImpl?: typeof fetch;
}

/** A manifest-declared server entry (the §8.7 shape), passed to addDeclaredServer. */
type DeclaredMcpServer = NonNullable<McpContribution["servers"]>[number];

/** A projected plugin tool. `inputSchema` is the DECLARED METHOD's schema, never
 * re-derived; `namespace` feeds providerUp so `available` tracks live health. */
interface ProjectedTool {
  pluginId: string;
  name: string;
  title: string;
  description: string;
  method: string;
  namespace: string;
  inputSchema: JsonSchemaObject;
}

/** A tool discovered on a connected server session. */
interface DiscoveredTool {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchemaObject;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

type TransportSource =
  | { source: "user"; transport: UserMcpTransport }
  | {
      source: "declared";
      ownerPluginId: string;
      server: DeclaredMcpServer;
      resolveSetting: (key: string) => string | undefined;
    };

interface ServerSession {
  serverKey: string;
  id: string;
  ownerPluginId?: string;
  transportKind: "stdio" | "http";
  autoStart: boolean;
  state: McpServerState;
  tools: Map<string, DiscoveredTool>;
  lastError?: string;
  src: TransportSource;
  // stdio runtime
  child?: McpSpawnHandle;
  stdoutBuf: string;
  pending: Map<number, PendingRequest>;
  nextRpcId: number;
  /** an intentional stop lands `stopped`; an unexpected exit lands `failed` */
  stopping: boolean;
  // http runtime
  httpUrl?: string;
  httpAuth?: string;
  httpSessionId?: string;
}

/** The namespace of an `x.<pluginId>.<name>` method is its first two segments. */
function namespaceOf(method: string): string {
  const parts = method.split(".");
  return parts.length >= 2 ? `${parts[0]}.${parts[1]}` : method;
}

export class McpService {
  private readonly logger: Logger;
  /** projected plugin tools, keyed by calling name `plugin:<pluginId>:<name>` */
  private readonly contributed = new Map<string, ProjectedTool>();
  /** per-plugin narrowing of live tools (subset of declared; in-memory v1) */
  private readonly narrowing = new Map<string, Set<string>>();
  private readonly servers = new Map<string, ServerSession>();

  constructor(private readonly config: McpServiceConfig) {
    this.logger = (config.logger ?? createNoopLogger()).child({ component: "plugin.mcp" });
  }

  // --- contribute half (§17.4) ---------------------------------------------------

  /** Rebuild the projected-tool table from the registry. A plugin contributes
   * only when ENABLED and holding `mcp.contribute`; each tool projects its
   * declared method's input schema (never a re-invented one — §8.7). `available`
   * is computed live at read time, so it tracks providerUp without a refresh. */
  refreshContributed(): void {
    this.contributed.clear();
    for (const pluginId of this.config.registry.list()) {
      const entry = this.config.registry.get(pluginId);
      if (entry === undefined || !entry.enabled) continue;
      if (!entry.grantedCapabilities.includes("mcp.contribute")) continue;
      const declaredTools = entry.mcp?.tools;
      if (declaredTools === undefined) continue;
      const narrow = this.narrowing.get(pluginId);
      for (const decl of declaredTools) {
        if (narrow !== undefined && !narrow.has(decl.name)) continue;
        const method = entry.declaredMethods?.get(decl.method);
        if (method === undefined) {
          this.logger.warn(
            "fieldd.plugin.mcp.tool_method_undeclared",
            "An MCP tool references a method the plugin never declared; skipping projection",
            { pluginId, tool: decl.name, method: decl.method },
          );
          continue;
        }
        const callingName = `plugin:${pluginId}:${decl.name}`;
        this.contributed.set(callingName, {
          pluginId,
          name: decl.name,
          title: decl.title,
          description: decl.description,
          method: decl.method,
          namespace: namespaceOf(decl.method),
          inputSchema: method.input as JsonSchemaObject,
        });
      }
    }
    this.logger.debug(
      "fieldd.plugin.mcp.contributed_refreshed",
      "Rebuilt the projected MCP tool table",
      { tools: this.contributed.size },
    );
  }

  /** A plugin narrows which of its DECLARED tools are live (subset only — the
   * manifest stays the ceiling, §17.4). Persists in-memory across refresh. */
  contributeSet(pluginId: string, params: unknown): void {
    const { tools } = McpContributeSetParams.parse(params);
    const entry = this.config.registry.get(pluginId);
    if (entry === undefined)
      throw new RpcCallError("NOT_FOUND", `unknown plugin ${pluginId}`, false);
    const declared = new Set((entry.mcp?.tools ?? []).map((t) => t.name));
    for (const name of tools)
      if (!declared.has(name))
        throw new RpcCallError(
          "PRECONDITION_FAILED",
          `${name} is not a declared mcp tool of ${pluginId} (the manifest is the ceiling)`,
          false,
        );
    this.narrowing.set(pluginId, new Set(tools));
    this.refreshContributed();
  }

  /** The aggregated tool list: projected plugin tools + consumed server tools,
   * each carrying live `available`. */
  toolsList(): McpToolsListResult {
    const tools: McpToolRecord[] = [];
    for (const [callingName, p] of this.contributed) {
      tools.push({
        tool: callingName,
        title: p.title,
        description: p.description,
        source: { kind: "plugin", pluginId: p.pluginId },
        inputSchema: p.inputSchema,
        available: this.config.providerUp(p.namespace),
      });
    }
    for (const session of this.servers.values()) {
      const up = session.state === "running";
      for (const t of session.tools.values()) {
        tools.push({
          tool: `server:${session.serverKey}:${t.name}`,
          title: t.title,
          description: t.description,
          source: { kind: "server", serverKey: session.serverKey },
          inputSchema: t.inputSchema,
          available: up,
        });
      }
    }
    return { tools };
  }

  /** Route a tool call. Plugin tools go through callDynamic (the service registry
   * owns output validation downstream). An unknown tool is NOT_FOUND; a tool that
   * WAS projected but whose provider is currently down is the honest distinction —
   * NOT_FOUND with the PLUGIN_PROVIDER_GONE discriminator (§22.5). */
  async toolsCall(params: unknown): Promise<McpToolsCallResult> {
    const { tool, args } = McpToolsCallParams.parse(params);
    const projected = this.contributed.get(tool);
    if (projected !== undefined) {
      if (!this.config.providerUp(projected.namespace))
        throw new RpcCallError(
          "NOT_FOUND",
          `${tool} is currently unavailable (its provider is down)`,
          true,
          { pluginKind: "PLUGIN_PROVIDER_GONE" },
        );
      const output = await this.config.callDynamic(projected.method, args);
      return { output };
    }
    for (const session of this.servers.values()) {
      const prefix = `server:${session.serverKey}:`;
      if (!tool.startsWith(prefix)) continue;
      const mcpName = tool.slice(prefix.length);
      if (!session.tools.has(mcpName)) continue;
      if (session.state !== "running")
        throw new RpcCallError("UNAVAILABLE", `${session.serverKey} is not running`, true);
      const output = await this.request(session, "tools/call", {
        name: mcpName,
        arguments: args ?? {},
      });
      return { output };
    }
    throw new RpcCallError("NOT_FOUND", `unknown mcp tool ${tool}`, false);
  }

  /** Disable/quarantine path (§17.4): drop the plugin's projected tools AND stop
   * any servers it declared. Its narrowing is dropped with it. */
  withdrawPlugin(pluginId: string): void {
    for (const [callingName, p] of [...this.contributed])
      if (p.pluginId === pluginId) this.contributed.delete(callingName);
    this.narrowing.delete(pluginId);
    for (const [serverKey, session] of [...this.servers])
      if (session.ownerPluginId === pluginId) {
        this.teardown(session, "stopped");
        this.servers.delete(serverKey);
      }
    this.logger.info(
      "fieldd.plugin.mcp.plugin_withdrawn",
      "Withdrew a plugin's MCP tools and declared servers",
      { pluginId },
    );
  }

  // --- consume half (§17.4) ------------------------------------------------------

  /** User-added server (literal transport; `user/<id>` key). */
  serversAdd(params: unknown): McpServerRecord {
    const p = McpServersAddParams.parse(params);
    const serverKey = `user/${p.id}`;
    if (this.servers.has(serverKey))
      throw new RpcCallError("CONFLICT", `${serverKey} already exists`, false);
    const session = this.newSession({
      serverKey,
      id: p.id,
      transportKind: p.transport.kind,
      autoStart: p.autoStart ?? false,
      src: { source: "user", transport: p.transport },
    });
    this.servers.set(serverKey, session);
    this.logger.info("fieldd.plugin.mcp.server_added", "Registered a user MCP server", {
      serverKey,
      transportKind: session.transportKind,
    });
    return this.recordOf(session);
  }

  /** Manifest-declared server (`<pluginId>/<id>` key). Transport settings resolve
   * through `resolveSetting` at START time — never stored on the record. */
  addDeclaredServer(
    pluginId: string,
    server: DeclaredMcpServer,
    resolveSetting: (key: string) => string | undefined,
  ): McpServerRecord {
    const serverKey = `${pluginId}/${server.id}`;
    if (this.servers.has(serverKey))
      throw new RpcCallError("CONFLICT", `${serverKey} already exists`, false);
    const session = this.newSession({
      serverKey,
      id: server.id,
      ownerPluginId: pluginId,
      transportKind: server.transport.kind,
      autoStart: server.autoStart ?? false,
      src: { source: "declared", ownerPluginId: pluginId, server, resolveSetting },
    });
    this.servers.set(serverKey, session);
    this.logger.info(
      "fieldd.plugin.mcp.server_declared",
      "Registered a plugin-declared MCP server",
      {
        serverKey,
        transportKind: session.transportKind,
      },
    );
    return this.recordOf(session);
  }

  /** Remove a USER server. A plugin-declared one is manifest-owned — refuse and
   * point at disabling the plugin (§17.4). */
  serversRemove(params: unknown): void {
    const { serverKey } = McpServersRemoveParams.parse(params);
    const session = this.servers.get(serverKey);
    if (session === undefined)
      throw new RpcCallError("NOT_FOUND", `no mcp server ${serverKey}`, false);
    if (session.src.source === "declared")
      throw new RpcCallError(
        "PRECONDITION_FAILED",
        `${serverKey} is plugin-declared; disable the plugin to remove it`,
        false,
      );
    this.teardown(session, "stopped");
    this.servers.delete(serverKey);
    this.logger.info("fieldd.plugin.mcp.server_removed", "Removed a user MCP server", {
      serverKey,
    });
  }

  serversList(): McpServersListResult {
    return { servers: [...this.servers.values()].map((s) => this.recordOf(s)) };
  }

  /** Start a session: resolve transport, handshake (initialize → initialized →
   * tools/list), land `running`. A start failure — or a child that exits during
   * the handshake — lands `failed` with a one-line lastError; it never throws. */
  async startServer(serverKey: string): Promise<McpServerRecord> {
    const session = this.servers.get(serverKey);
    if (session === undefined)
      throw new RpcCallError("NOT_FOUND", `no mcp server ${serverKey}`, false);
    if (session.state === "running" || session.state === "starting") return this.recordOf(session);
    session.state = "starting";
    session.stopping = false;
    delete session.lastError;
    try {
      if (session.transportKind === "stdio") await this.startStdio(session);
      else await this.startHttp(session);
      // an exit during the handshake may already have flipped us to failed
      if (session.state === "starting") session.state = "running";
      this.logger.info("fieldd.plugin.mcp.server_started", "MCP server session is running", {
        serverKey,
        tools: session.tools.size,
      });
    } catch (e) {
      session.state = "failed";
      session.lastError = e instanceof Error ? e.message : String(e);
      this.logger.warn("fieldd.plugin.mcp.server_failed", "MCP server session failed to start", {
        serverKey,
        error: e,
      });
    }
    return this.recordOf(session);
  }

  /** Stop a session (intentional): kill any child, reject in-flight requests, land
   * `stopped`. Discovered tools are retained and become available:false. */
  stopServer(serverKey: string): McpServerRecord {
    const session = this.servers.get(serverKey);
    if (session === undefined)
      throw new RpcCallError("NOT_FOUND", `no mcp server ${serverKey}`, false);
    this.teardown(session, "stopped");
    this.logger.info("fieldd.plugin.mcp.server_stopped", "MCP server session stopped", {
      serverKey,
    });
    return this.recordOf(session);
  }

  dispose(): void {
    for (const session of this.servers.values()) this.teardown(session, "stopped");
    this.servers.clear();
    this.contributed.clear();
    this.narrowing.clear();
  }

  // --- internals -----------------------------------------------------------------

  private newSession(base: {
    serverKey: string;
    id: string;
    ownerPluginId?: string;
    transportKind: "stdio" | "http";
    autoStart: boolean;
    src: TransportSource;
  }): ServerSession {
    return {
      serverKey: base.serverKey,
      id: base.id,
      ...(base.ownerPluginId !== undefined ? { ownerPluginId: base.ownerPluginId } : {}),
      transportKind: base.transportKind,
      autoStart: base.autoStart,
      state: "stopped",
      tools: new Map(),
      src: base.src,
      stdoutBuf: "",
      pending: new Map(),
      nextRpcId: 1,
      stopping: false,
    };
  }

  private recordOf(s: ServerSession): McpServerRecord {
    return {
      serverKey: s.serverKey,
      id: s.id,
      transportKind: s.transportKind,
      state: s.state,
      autoStart: s.autoStart,
      toolCount: s.tools.size,
      ...(s.ownerPluginId !== undefined ? { ownerPluginId: s.ownerPluginId } : {}),
      ...(s.lastError !== undefined ? { lastError: s.lastError } : {}),
    };
  }

  /** Tear a session's live resources down, settling to the given resting state.
   * Retained: the discovered tools (they stay visible as unavailable). */
  private teardown(session: ServerSession, resting: "stopped" | "failed"): void {
    session.stopping = resting === "stopped";
    for (const [, req] of session.pending) {
      clearTimeout(req.timer);
      req.reject(new RpcCallError("UNAVAILABLE", `${session.serverKey} session torn down`, true));
    }
    session.pending.clear();
    if (session.child !== undefined) {
      try {
        session.child.kill();
      } catch {
        // best-effort; the process may already be gone
      }
      delete session.child;
    }
    session.state = resting;
  }

  private async startStdio(session: ServerSession): Promise<void> {
    const spawn = this.config.spawn;
    if (spawn === undefined)
      throw new RpcCallError("UNAVAILABLE", "stdio transport requires a process spawner", false);
    let executable: string;
    let args: string[];
    let cwd: string | undefined;
    if (session.src.source === "user") {
      if (session.src.transport.kind !== "stdio")
        throw new RpcCallError("PRECONDITION_FAILED", "server is not a stdio transport", false);
      executable = session.src.transport.executable;
      args = session.src.transport.args;
    } else {
      const t = session.src.server.transport;
      if (t.kind !== "stdio")
        throw new RpcCallError("PRECONDITION_FAILED", "server is not a stdio transport", false);
      executable = t.executable;
      args = t.args ?? [];
      if (t.cwdSetting !== undefined) cwd = session.src.resolveSetting(t.cwdSetting);
    }

    const handle = spawn({ executable, args, ...(cwd !== undefined ? { cwd } : {}) });
    session.child = handle;
    session.stdoutBuf = "";
    handle.stdout.setEncoding("utf8");
    handle.stdout.on("data", (d: unknown) => this.onStdioData(session, d));
    handle.stderr.on("data", () => {
      // drain stderr so a chatty child never blocks on a full pipe
    });
    handle.onExit((code) => this.onChildExit(session, code));

    await this.request(session, "initialize", INITIALIZE_PARAMS);
    await this.notify(session, "notifications/initialized", {});
    const listed = await this.request(session, "tools/list", {});
    this.populateTools(session, listed);
  }

  private async startHttp(session: ServerSession): Promise<void> {
    let url: string | undefined;
    let auth: string | undefined;
    if (session.src.source === "user") {
      if (session.src.transport.kind !== "http")
        throw new RpcCallError("PRECONDITION_FAILED", "server is not an http transport", false);
      url = session.src.transport.url;
    } else {
      const t = session.src.server.transport;
      if (t.kind !== "http")
        throw new RpcCallError("PRECONDITION_FAILED", "server is not an http transport", false);
      url = session.src.resolveSetting(t.urlSetting);
      if (url === undefined || url.length === 0)
        throw new RpcCallError(
          "PRECONDITION_FAILED",
          `mcp server ${session.serverKey}: url setting ${t.urlSetting} is unresolved`,
          false,
        );
      if (t.authSecretSetting !== undefined) {
        const secret = session.src.resolveSetting(t.authSecretSetting);
        if (secret !== undefined && secret.length > 0) auth = `Bearer ${secret}`;
      }
    }
    session.httpUrl = url;
    if (auth !== undefined) session.httpAuth = auth;

    await this.request(session, "initialize", INITIALIZE_PARAMS);
    await this.notify(session, "notifications/initialized", {});
    const listed = await this.request(session, "tools/list", {});
    this.populateTools(session, listed);
  }

  private populateTools(session: ServerSession, listed: unknown): void {
    const listedTools = (listed as { tools?: unknown } | undefined)?.tools;
    const rows = Array.isArray(listedTools) ? (listedTools as Array<Record<string, unknown>>) : [];
    session.tools.clear();
    for (const row of rows) {
      const name = typeof row.name === "string" ? row.name : undefined;
      if (name === undefined || name.length === 0) continue;
      const schema =
        row.inputSchema !== null && typeof row.inputSchema === "object"
          ? (row.inputSchema as JsonSchemaObject)
          : ({} as JsonSchemaObject);
      session.tools.set(name, {
        name,
        title: typeof row.title === "string" && row.title.length > 0 ? row.title : name,
        description: typeof row.description === "string" ? row.description : "",
        inputSchema: schema,
      });
    }
  }

  private request(session: ServerSession, method: string, params: unknown): Promise<unknown> {
    return session.transportKind === "http"
      ? this.httpRequest(session, method, params, false)
      : this.stdioRequest(session, method, params);
  }

  private async notify(session: ServerSession, method: string, params: unknown): Promise<void> {
    if (session.transportKind === "http") {
      await this.httpRequest(session, method, params, true);
      return;
    }
    this.stdioNotify(session, method, params);
  }

  private stdioRequest(session: ServerSession, method: string, params: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const child = session.child;
      if (child === undefined) {
        reject(new RpcCallError("UNAVAILABLE", `${session.serverKey} is not running`, true));
        return;
      }
      const id = session.nextRpcId++;
      const timer = setTimeout(() => {
        session.pending.delete(id);
        this.logger.warn("fieldd.plugin.mcp.request_timeout", "An MCP request timed out", {
          serverKey: session.serverKey,
          method,
        });
        reject(
          new RpcCallError(
            "UNAVAILABLE",
            `${method} timed out after ${REQUEST_TIMEOUT_MS}ms`,
            true,
          ),
        );
      }, REQUEST_TIMEOUT_MS);
      session.pending.set(id, { resolve, reject, timer });
      try {
        child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      } catch {
        clearTimeout(timer);
        session.pending.delete(id);
        reject(new RpcCallError("UNAVAILABLE", `write to ${session.serverKey} failed`, true));
      }
    });
  }

  private stdioNotify(session: ServerSession, method: string, params: unknown): void {
    const child = session.child;
    if (child === undefined) return;
    try {
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
    } catch {
      // notifications are best-effort; a dead pipe surfaces on the next request
    }
  }

  private async httpRequest(
    session: ServerSession,
    method: string,
    params: unknown,
    isNotification: boolean,
  ): Promise<unknown> {
    const fetchImpl = this.config.fetchImpl ?? fetch;
    const url = session.httpUrl;
    if (url === undefined)
      throw new RpcCallError("UNAVAILABLE", `${session.serverKey} has no resolved url`, false);
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    };
    if (session.httpSessionId !== undefined) headers["mcp-session-id"] = session.httpSessionId;
    if (session.httpAuth !== undefined) headers.authorization = session.httpAuth;
    const body = JSON.stringify(
      isNotification
        ? { jsonrpc: "2.0", method, params }
        : { jsonrpc: "2.0", id: session.nextRpcId++, method, params },
    );

    let res: Response;
    try {
      res = await withTimeout(
        fetchImpl(url, { method: "POST", headers, body }),
        REQUEST_TIMEOUT_MS,
      );
    } catch (e) {
      if (e instanceof RpcCallError) throw e;
      throw new RpcCallError("UNAVAILABLE", `${session.serverKey}: http transport error`, true);
    }

    // Streamable HTTP: echo the server-issued session id on every later request.
    const sid = res.headers.get("mcp-session-id");
    if (sid !== null && sid.length > 0) session.httpSessionId = sid;

    if (isNotification) return undefined;

    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.includes("text/event-stream"))
      throw new RpcCallError(
        "UNAVAILABLE",
        "streamable-http SSE responses land later; this server answered with an event stream",
        false,
      );
    if (!contentType.includes("application/json"))
      throw new RpcCallError("UNAVAILABLE", `${session.serverKey}: non-JSON response`, true);

    let msg: { result?: unknown; error?: { code?: number; message?: string } };
    try {
      msg = (await res.json()) as typeof msg;
    } catch {
      throw new RpcCallError(
        "UNAVAILABLE",
        `${session.serverKey}: malformed JSON-RPC response`,
        true,
      );
    }
    if (msg.error !== undefined)
      throw new RpcCallError(
        "INTERNAL",
        `mcp server ${session.serverKey} error: ${msg.error.message ?? "unknown"}`,
        false,
      );
    return msg.result;
  }

  private onStdioData(session: ServerSession, chunk: unknown): void {
    session.stdoutBuf += typeof chunk === "string" ? chunk : String(chunk);
    let idx: number;
    // biome-ignore lint/suspicious/noAssignInExpressions: canonical newline-split loop
    while ((idx = session.stdoutBuf.indexOf("\n")) >= 0) {
      const line = session.stdoutBuf.slice(0, idx);
      session.stdoutBuf = session.stdoutBuf.slice(idx + 1);
      if (line.trim()) this.onStdioLine(session, line);
    }
  }

  private onStdioLine(session: ServerSession, line: string): void {
    let msg: { id?: unknown; result?: unknown; error?: { message?: string } };
    try {
      msg = JSON.parse(line);
    } catch {
      return; // tolerant: garbage lines never fatal
    }
    const id = msg.id;
    if (typeof id !== "number") return; // server notification / unroutable — ignored in v1
    const req = session.pending.get(id);
    if (req === undefined) return;
    session.pending.delete(id);
    clearTimeout(req.timer);
    if (msg.error !== undefined) {
      req.reject(
        new RpcCallError("INTERNAL", `mcp server error: ${msg.error.message ?? "unknown"}`, false),
      );
      return;
    }
    req.resolve(msg.result);
  }

  private onChildExit(session: ServerSession, code: number | null): void {
    for (const [, req] of session.pending) {
      clearTimeout(req.timer);
      req.reject(new RpcCallError("UNAVAILABLE", "mcp server exited", true));
    }
    session.pending.clear();
    delete session.child;
    session.state = session.stopping ? "stopped" : "failed";
    if (!session.stopping) session.lastError = `server exited (code ${code ?? "unknown"})`;
    this.logger.info("fieldd.plugin.mcp.server_exit", "MCP stdio child exited", {
      serverKey: session.serverKey,
      code,
      intentional: session.stopping,
    });
  }
}

/** Bound any promise (used for fetch, whose own timeout is not guaranteed). */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new RpcCallError("UNAVAILABLE", `request timed out after ${ms}ms`, true)),
      ms,
    );
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}
