import { timingSafeEqual } from "node:crypto";
import { EventEmitter } from "node:events";
import type { IncomingMessage } from "node:http";
import {
  type CallerContext,
  CONTRACTS_VERSION,
  type ErrorKind,
  Hello,
  METHODS,
  type MethodDef,
  RPC_ERROR_CODES,
  type Scope,
  TAILNET_SCOPES,
} from "@vibefield/contracts";
import { type WebSocket, WebSocketServer } from "ws";
import { RpcCallError } from "./native-link";

// ProductAPI — the fabric's control binding (design-02 §3.3, D27): loopback WS
// :9410, JSON text frames, hello-gated with scoped bearer tokens, per-method
// scope checks from the generated method registry. Subscriptions follow the
// mgmt-channel convention (P5): subscribe → {subId, snapshot}, then
// `<base>.delta {subId, payload}` notifications until system.unsubscribe or
// connection close. The :9411 binary data-lane socket is served separately by
// DocLane + DocumentService (doc.open mints the one-shot tickets that gate it).
//
// C3 — ONE stack, two doors (thinking-c3 §1): the same listener also backs the
// tailnet serve. Provenance, not headers, decides trust: only upgrades on the
// secret route path `/t/<tailnetPathSecret>` — a path known solely to fieldd
// and the sidecar's route config — may mint a tailnet principal from the
// sidecar-injected Tailscale-User-* headers. Headers on ANY other path are
// ignored outright: EL7's same-uid adversary can dial 127.0.0.1 and type
// headers, but cannot know the secret. On the secret path a non-empty login
// header is REQUIRED (the serve's allow-glob is the proxy-side belt; this is
// the suspenders), and the hello credential becomes optional — a verified
// token still wins (its scopes are a real local grant), else the caller gets
// the D32 TAILNET_SCOPES preset.

const WS_OPEN = 1;

export type Handler = (ctx: CallerContext, params: unknown) => Promise<unknown> | unknown;

/** Returns the snapshot plus a dispose; `emit` pushes deltas until dispose. */
export type SubscriptionHandler = (
  ctx: CallerContext,
  params: unknown,
  emit: (payload: unknown) => void,
) => { snapshot: unknown; dispose: () => void };

export interface ProductApiOptions {
  port: number; // 0 = ephemeral (tests)
  tokens: TokenServiceLike;
  /** Origin allowlist for browser clients. Non-browser clients send no Origin — allowed. */
  allowedOrigins?: string[];
  /** C3: the serve route secret. Unset ⇒ the tailnet door is closed entirely. */
  tailnetPathSecret?: string;
}

export type DeviceForwarder = (
  device: string,
  method: string,
  params: unknown,
  ctx: CallerContext,
) => Promise<unknown>;

/** The slice of TokenService the API needs (keeps the dependency one-way). */
export interface TokenServiceLike {
  verify(token: string): { tokenId: string; scopes: Scope[]; label: string } | null;
}

interface ConnState {
  authed: boolean;
  ctx: CallerContext | null;
  /** effective grant for THIS connection (a tailnet principal carries no
   * scopes field — the grant is connection state, not identity) */
  scopes: Scope[];
  /** non-null ⇒ the upgrade arrived on the secret route path with a verified
   * login header — the sidecar-proxied door */
  tailnetLogin: string | null;
  /** live subscriptions on this connection: subId → dispose */
  subs: Map<string, () => void>;
}

export class ProductApi extends EventEmitter {
  private wss: WebSocketServer | null = null;
  private handlers = new Map<string, Handler>();
  private subHandlers = new Map<string, SubscriptionHandler>();
  private nextSubId = 1;
  private ownDeviceId: (() => string) | null = null;
  private forwarder: DeviceForwarder | null = null;

  constructor(private readonly opts: ProductApiOptions) {
    super();
  }

  /** C5/D35 — arm the `device?` routing pair (set post-construction: PeerLink
   * and DeviceService are built after the api). A call whose params carry a
   * foreign `device` forwards WHOLE over PeerLink — the LOCAL scope check runs
   * first, so local restrictions never launder through a peer; the remote end
   * enforces its own. `device` = own id strips and serves locally. Un-armed ⇒
   * `device` is inert extra params (tolerant reader). */
  setDeviceRouting(ownDeviceId: () => string, forwarder: DeviceForwarder): void {
    this.ownDeviceId = ownDeviceId;
    this.forwarder = forwarder;
  }

  register(method: string, handler: Handler): void {
    const def = this.lookup(method);
    if (def.subscription)
      throw new Error(`subscription method needs registerSubscription: ${method}`);
    this.handlers.set(method, handler);
  }

  registerSubscription(method: string, handler: SubscriptionHandler): void {
    const def = this.lookup(method);
    if (!def.subscription) throw new Error(`not a subscription method in the registry: ${method}`);
    this.subHandlers.set(method, handler);
  }

  private lookup(method: string): MethodDef {
    const def = METHODS.find((m) => m.method === method && m.surface === "product");
    if (!def)
      throw new Error(`method not in the registry (D36 — unregistered doesn't ship): ${method}`);
    return def;
  }

  async listen(): Promise<number> {
    const wss = new WebSocketServer({ port: this.opts.port, host: "127.0.0.1" });
    this.wss = wss;
    wss.on("connection", (ws, req) => this.onConnection(ws, req));
    wss.once("close", () => {
      if (this.wss === wss) this.wss = null;
    });
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        wss.off("listening", onListening);
        wss.off("error", onError);
        wss.off("close", onClose);
        fn();
      };
      const onListening = () => finish(resolve);
      const onError = (error: Error) => finish(() => reject(error));
      const onClose = () =>
        finish(() => reject(new Error("Product API closed before it started listening")));
      wss.once("listening", onListening);
      wss.once("error", onError);
      wss.once("close", onClose);
    });
    const addr = wss.address();
    if (typeof addr !== "object" || !addr)
      throw new Error("Product API closed before startup completed");
    return addr.port;
  }

  private onConnection(ws: WebSocket, req: IncomingMessage): void {
    const origin = req.headers.origin;
    if (origin !== undefined && !(this.opts.allowedOrigins ?? []).includes(origin)) {
      ws.close(1008, "origin not allowed");
      return;
    }
    const door = this.classifyDoor(req);
    if (door === "reject") {
      // a wrong/partial secret path, or the secret path without an identity
      // header — probing or a misconfigured proxy; nothing to negotiate
      ws.close(1008, "unauthorized");
      return;
    }
    const state: ConnState = {
      authed: false,
      ctx: null,
      scopes: [],
      tailnetLogin: door,
      subs: new Map(),
    };
    ws.on("message", (raw) => {
      void this.onMessage(ws, state, raw.toString());
    });
    ws.on("close", () => {
      for (const dispose of state.subs.values()) dispose();
      state.subs.clear();
    });
  }

  /** Which door did this upgrade come through? null = the ordinary local door
   * (token-gated; any Tailscale-User-* headers are IGNORED — a same-uid local
   * caller can type headers but cannot know the route secret). A login string
   * = the sidecar-proxied door. "reject" = drop the socket. */
  private classifyDoor(req: IncomingMessage): string | null | "reject" {
    const secret = this.opts.tailnetPathSecret;
    const path = req.url ?? "/";
    if (secret === undefined || secret.length === 0) return null;
    if (!path.startsWith("/t/")) return null;
    const candidate = path.slice(3).split(/[/?#]/, 1)[0] ?? "";
    const a = Buffer.from(candidate);
    const b = Buffer.from(secret);
    const match = a.length === b.length && timingSafeEqual(a, b);
    if (!match) return "reject";
    const login = req.headers["tailscale-user-login"];
    // The sidecar strips inbound Tailscale-* then injects verified values, so
    // on the secret path this header is trustworthy — and REQUIRED (a tagged
    // node / WhoIs miss arrives headerless and has no identity to grant).
    if (typeof login !== "string" || login.length === 0) return "reject";
    return login;
  }

  private async onMessage(ws: WebSocket, state: ConnState, raw: string): Promise<void> {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw);
    } catch {
      ws.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id: null,
          error: { code: -32700, message: "parse error" },
        }),
      );
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
      if (grant) {
        // a verified token is a real local grant — it wins on either door
        state.authed = true;
        state.scopes = grant.scopes;
        state.ctx = {
          principal: { kind: "local-token", tokenId: grant.tokenId, scopes: grant.scopes },
          transport: state.tailnetLogin !== null ? "ws-tailnet" : "ws-loopback",
          receivedAt: Date.now(),
          clientKind: parsed.data.clientKind, // §11.2 kind gate reads it (restrict-only)
        };
      } else if (state.tailnetLogin !== null) {
        // the sidecar-proxied door: identity is the WhoIs-verified login; the
        // grant is the D32 tailnet preset (design-04 — tokens.mint/native.*/
        // push.manage/plugins.manage never federate). A peer fieldd may CLAIM
        // its deviceId (C5) — a label inside the same-user trust domain, same
        // grant either way, so it cannot escalate; honored ONLY here (the
        // provenance-proven door), never on the local path. Retires when the
        // sidecar injects the node id (truffle petition).
        const claim = parsed.data.deviceId;
        const peer =
          parsed.data.clientKind === "peer-fieldd" && typeof claim === "string" && claim.length > 0;
        state.authed = true;
        state.scopes = [...TAILNET_SCOPES];
        state.ctx = {
          principal: peer
            ? { kind: "peer-fieldd", deviceId: claim as string }
            : { kind: "tailnet", login: state.tailnetLogin },
          transport: "ws-tailnet",
          receivedAt: Date.now(),
        };
      } else {
        reply(this.err(id, "UNAUTHORIZED", "invalid token", false));
        ws.close(1008, "unauthorized");
        return;
      }
      reply({
        jsonrpc: "2.0",
        id,
        result: {
          contractsVersion: CONTRACTS_VERSION,
          serverKind: "fieldd",
          grantedScopes: state.scopes,
        },
      });
      return;
    }

    if (!state.authed || !state.ctx) {
      reply(this.err(id, "UNAUTHORIZED", "hello required first", false));
      return;
    }

    // built-in: dropping a subscription needs the connection's own sub table
    if (method === "system.unsubscribe") {
      const subId = (params as { subId?: unknown } | undefined)?.subId;
      const dispose = typeof subId === "string" ? state.subs.get(subId) : undefined;
      if (dispose) {
        dispose();
        state.subs.delete(subId as string);
      }
      reply({ jsonrpc: "2.0", id, result: { removed: dispose !== undefined } });
      return;
    }

    const def = METHODS.find((m) => m.method === method && m.surface === "product");
    const handler = this.handlers.get(method);
    const subHandler = this.subHandlers.get(method);
    if (!def || (!handler && !subHandler)) {
      reply(this.err(id, "NOT_FOUND", "method not found", false, undefined, -32601));
      return;
    }
    if (def.scope !== null) {
      // the grant lives on the CONNECTION (a tailnet principal has no scopes
      // field — its preset was fixed at hello)
      if (!state.scopes.includes(def.scope)) {
        reply(
          this.err(id, "FORBIDDEN_SCOPE", `requires ${def.scope}`, false, { required: def.scope }),
        );
        return;
      }
    }
    try {
      // C5/D35 — the `device?` convention: route AFTER the local scope check
      // (above), BEFORE execution. Own id strips and serves locally; a foreign
      // id forwards whole; a device on a subscription refuses (federated
      // subscriptions are P2).
      const device = (params as { device?: unknown } | null | undefined)?.device;
      const forwarder = this.forwarder;
      if (typeof device === "string" && forwarder !== null) {
        if (device !== this.ownDeviceId?.()) {
          if (def.subscription) {
            reply(
              this.err(id, "PRECONDITION_FAILED", "federated subscriptions are P2", false, {
                device,
              }),
            );
            return;
          }
          const result = await forwarder(device, method, params, state.ctx);
          reply({ jsonrpc: "2.0", id, result });
          return;
        }
        // device === self: strip the routing key, serve locally
        const { device: _self, ...rest } = params as Record<string, unknown>;
        await this.execute(ws, state, id, method, rest, handler, subHandler, reply);
        return;
      }
      await this.execute(ws, state, id, method, params, handler, subHandler, reply);
    } catch (e) {
      if (e instanceof RpcCallError) {
        reply(this.err(id, e.kind as ErrorKind, e.message, e.retryable, e.details));
      } else {
        reply(this.err(id, "INTERNAL", e instanceof Error ? e.message : "internal error", false));
      }
    }
  }

  /** The execution tail (subscription install / handler call), shared by the
   * direct path and the device-stripped self path. Throws propagate to
   * onMessage's error mapping. */
  private async execute(
    ws: WebSocket,
    state: ConnState,
    id: unknown,
    method: string,
    params: unknown,
    handler: Handler | undefined,
    subHandler: SubscriptionHandler | undefined,
    reply: (v: unknown) => void,
  ): Promise<void> {
    const ctx = state.ctx;
    if (!ctx) return; // unreachable past the authed gate; keeps the type honest
    if (subHandler) {
      const subId = `ps-${this.nextSubId++}`;
      const base = method.replace(/\.subscribe$/, "");
      let active = true;
      const emit = (payload: unknown) => {
        if (active && ws.readyState === WS_OPEN)
          ws.send(
            JSON.stringify({
              jsonrpc: "2.0",
              method: `${base}.delta`,
              params: { subId, payload },
            }),
          );
      };
      const { snapshot, dispose } = subHandler(ctx, params, emit);
      state.subs.set(subId, () => {
        active = false;
        dispose();
      });
      reply({ jsonrpc: "2.0", id, result: { subId, snapshot } });
      return;
    }
    const result = await handler!(ctx, params);
    reply({ jsonrpc: "2.0", id, result });
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

  /** Sever every live client but keep listening (reconnect drills, ops kick). */
  dropConnections(): void {
    for (const client of this.wss?.clients ?? []) client.terminate();
  }

  close(): void {
    for (const client of this.wss?.clients ?? []) client.terminate();
    this.wss?.close();
  }
}
