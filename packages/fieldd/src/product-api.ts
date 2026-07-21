import { EventEmitter } from "node:events";
import type { IncomingMessage } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import {
  CONTRACTS_VERSION,
  Hello,
  METHODS,
  RPC_ERROR_CODES,
  type CallerContext,
  type ErrorKind,
  type Scope,
} from "@vibefield/contracts";
import { RpcCallError } from "./native-link";
import type { TokenService } from "./token-service";

// ProductAPI — the fabric's control binding (design-02 §3.3, D27): loopback WS
// :9410, JSON text frames, hello-gated with scoped bearer tokens, per-method
// scope checks from the generated method registry. The :9411 binary data-lane
// socket lands with DocumentService (nothing mints doc tickets yet).

export type Handler = (ctx: CallerContext, params: unknown) => Promise<unknown> | unknown;

export interface ProductApiOptions {
  port: number; // 0 = ephemeral (tests)
  tokens: TokenService;
  /** Origin allowlist for browser clients. Non-browser clients send no Origin — allowed. */
  allowedOrigins?: string[];
}

interface ConnState {
  authed: boolean;
  ctx: CallerContext | null;
}

export class ProductApi extends EventEmitter {
  private wss: WebSocketServer | null = null;
  private handlers = new Map<string, Handler>();

  constructor(private readonly opts: ProductApiOptions) {
    super();
  }

  register(method: string, handler: Handler): void {
    const def = METHODS.find((m) => m.method === method && m.surface === "product");
    if (!def) throw new Error(`method not in the registry (D36 — unregistered doesn't ship): ${method}`);
    this.handlers.set(method, handler);
  }

  async listen(): Promise<number> {
    const wss = new WebSocketServer({ port: this.opts.port, host: "127.0.0.1" });
    this.wss = wss;
    wss.on("connection", (ws, req) => this.onConnection(ws, req));
    await new Promise<void>((resolve, reject) => {
      wss.once("listening", resolve);
      wss.once("error", reject);
    });
    const addr = wss.address();
    return typeof addr === "object" && addr ? addr.port : this.opts.port;
  }

  private onConnection(ws: WebSocket, req: IncomingMessage): void {
    const origin = req.headers.origin;
    if (origin !== undefined && !(this.opts.allowedOrigins ?? []).includes(origin)) {
      ws.close(1008, "origin not allowed");
      return;
    }
    const state: ConnState = { authed: false, ctx: null };
    ws.on("message", (raw) => {
      void this.onMessage(ws, state, raw.toString());
    });
  }

  private async onMessage(ws: WebSocket, state: ConnState, raw: string): Promise<void> {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw);
    } catch {
      ws.send(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }));
      return;
    }
    const id = msg["id"];
    const method = String(msg["method"] ?? "");
    const params = msg["params"];
    const reply = (v: unknown) => {
      if (id !== undefined && id !== null) ws.send(JSON.stringify(v));
    };

    if (method === "system.hello") {
      // full contract hello: shape-validated, version-gated (mirrors field-native)
      const parsed = Hello.safeParse(params);
      if (!parsed.success) {
        reply(this.err(id, "PRECONDITION_FAILED", "malformed hello", false));
        ws.close(1008, "bad hello");
        return;
      }
      const oursMajor = CONTRACTS_VERSION.split(".")[0];
      if (String(parsed.data.contractsVersion).split(".")[0] !== oursMajor) {
        reply(
          this.err(id, "INCOMPATIBLE", "contracts major mismatch", false, {
            server: CONTRACTS_VERSION,
            client: parsed.data.contractsVersion,
          }),
        );
        ws.close(1008, "incompatible");
        return;
      }
      const token = parsed.data.credential;
      const grant = typeof token === "string" ? this.opts.tokens.verify(token) : null;
      if (!grant) {
        reply(this.err(id, "UNAUTHORIZED", "invalid token", false));
        ws.close(1008, "unauthorized");
        return;
      }
      state.authed = true;
      state.ctx = {
        principal: { kind: "local-token", tokenId: grant.tokenId, scopes: grant.scopes },
        transport: "ws-loopback",
        receivedAt: Date.now(),
      };
      reply({
        jsonrpc: "2.0",
        id,
        result: { contractsVersion: CONTRACTS_VERSION, serverKind: "fieldd", grantedScopes: grant.scopes },
      });
      return;
    }

    if (!state.authed || !state.ctx) {
      reply(this.err(id, "UNAUTHORIZED", "hello required first", false));
      return;
    }

    const def = METHODS.find((m) => m.method === method && m.surface === "product");
    const handler = this.handlers.get(method);
    if (!def || !handler) {
      reply(this.err(id, "NOT_FOUND", "method not found", false, undefined, -32601));
      return;
    }
    if (def.scope !== null) {
      const scopes = (state.ctx.principal as { scopes?: Scope[] }).scopes ?? [];
      if (!scopes.includes(def.scope)) {
        reply(this.err(id, "FORBIDDEN_SCOPE", `requires ${def.scope}`, false, { required: def.scope }));
        return;
      }
    }
    try {
      const result = await handler(state.ctx, params);
      reply({ jsonrpc: "2.0", id, result });
    } catch (e) {
      if (e instanceof RpcCallError) {
        reply(this.err(id, e.kind as ErrorKind, e.message, e.retryable, e.details));
      } else {
        reply(this.err(id, "INTERNAL", e instanceof Error ? e.message : "internal error", false));
      }
    }
  }

  private err(
    id: unknown,
    kind: ErrorKind | string,
    message: string,
    retryable: boolean,
    details?: unknown,
    codeOverride?: number,
  ): unknown {
    const code = codeOverride ?? RPC_ERROR_CODES[kind as ErrorKind] ?? -32000;
    const data: Record<string, unknown> = { kind, retryable };
    if (details !== undefined) data["details"] = details;
    return { jsonrpc: "2.0", id: id ?? null, error: { code, message, data } };
  }

  close(): void {
    for (const client of this.wss?.clients ?? []) client.terminate();
    this.wss?.close();
  }
}
