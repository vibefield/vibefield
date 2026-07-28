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
  NAMESPACES,
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

/** Returns the snapshot plus a dispose; `emit` pushes deltas until dispose.
 * MAY be async (P5 — settings snapshots read files); the dispatcher awaits. */
export type SubscriptionHandler = (
  ctx: CallerContext,
  params: unknown,
  /** A producer reboot may replace the stream with a fresh snapshot. */
  emit: (payload: unknown, kind?: "delta" | "snapshot") => void,
) =>
  | { snapshot: unknown; dispose: () => void }
  | Promise<{ snapshot: unknown; dispose: () => void }>;

export interface ProductApiOptions {
  port: number; // 0 = ephemeral (tests)
  tokens: TokenServiceLike;
  /** Origin allowlist for browser clients. Non-browser clients send no Origin — allowed. */
  allowedOrigins?: string[];
  /** C3: the serve route secret. Unset ⇒ the tailnet door is closed entirely. */
  tailnetPathSecret?: string;
  /** T1 §1: map a sidecar-injected Tailscale node id (WhoIs `Node.StableID`)
   * to the roster's ULID deviceId — DeviceService's registry correlation.
   * Unset, or a miss (peer not yet published / roster stale) ⇒ the C5 hello
   * claim remains the peer label (the mixed-fleet fallback; it dies with
   * fleet-v3). */
  correlateNodeId?: (nodeId: string) => string | undefined;
}

export type DeviceForwarder = (
  device: string,
  method: string,
  params: unknown,
  ctx: CallerContext,
) => Promise<unknown>;

/** C6-5/D35 — the subscription half of the `device?` convention: installs a
 * federated proxy (ref-counted upstream, re-snapshot on recovery) and returns
 * the upstream snapshot plus a dispose for this local subscriber. */
export type DeviceSubscriptionForwarder = (
  device: string,
  method: string,
  params: unknown,
  ctx: CallerContext,
  emit: (payload: unknown, kind?: "delta" | "snapshot") => void,
) => Promise<{ snapshot: unknown; dispose: () => void }>;

/** The slice of TokenService the API needs (keeps the dependency one-way). */
export interface TokenServiceLike {
  verify(
    token: string,
  ): { tokenId: string; scopes: Scope[]; label: string; pluginId?: string } | null;
}

/** P4 — the dynamic-method router (ServiceRegistry): any "x."-prefixed method
 * routes here instead of the static METHODS table (§14.6 exact map). */
export interface DynamicRouterLike {
  kindOf(method: string): "call" | "subscription" | undefined;
  call(ctx: CallerContext, method: string, params: unknown): Promise<unknown>;
  subscribe(
    ctx: CallerContext,
    method: string,
    params: unknown,
    emit: (payload: unknown) => void,
  ): Promise<{ snapshot: unknown; dispose: () => void }>;
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
  /** the sidecar-injected node id (v3+ sidecars only; T1 §1) — the caller's
   * transport-derived DEVICE identity. null on the same door means an older
   * sidecar proxied the request, never an anonymous caller. */
  tailnetNodeId: string | null;
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
  private subForwarder: DeviceSubscriptionForwarder | null = null;
  private dynamicRouter: DynamicRouterLike | null = null;
  /** live authed connections — the §15.4 revocation path closes by principal */
  private readonly liveConns = new Set<{ ws: WebSocket; state: ConnState }>();

  /** §15.4 — sever every connection whose principal IS this plugin: leases are
   * already revoked by the caller, so a reconnect dies at hello; live subs die
   * with the socket. */
  dropPluginConnections(pluginId: string): number {
    let dropped = 0;
    for (const conn of [...this.liveConns]) {
      const principal = conn.state.ctx?.principal;
      if (principal?.kind === "plugin" && principal.id === pluginId) {
        conn.ws.terminate();
        this.liveConns.delete(conn);
        dropped += 1;
      }
    }
    return dropped;
  }

  /** P4 — arm the x.* dynamic-method path (the ServiceRegistry). */
  setDynamicRouter(router: DynamicRouterLike): void {
    this.dynamicRouter = router;
  }

  /** The dynamic execution tail: the router owns gating and validation; this
   * owns only the wire protocol (subId minting + delta frames, P5 shape). */
  private async executeDynamic(
    ws: WebSocket,
    state: ConnState,
    id: unknown,
    method: string,
    params: unknown,
    reply: (v: unknown) => void,
  ): Promise<void> {
    const router = this.dynamicRouter;
    const ctx = state.ctx;
    if (router === null || !ctx) return;
    const kind = router.kindOf(method);
    if (kind === undefined) {
      reply(this.err(id, "NOT_FOUND", `no provider for ${method}`, false, undefined, -32601));
      return;
    }
    if (kind === "subscription") {
      const subId = `ps-${this.nextSubId++}`;
      let active = true;
      const emit = (payload: unknown) => {
        if (active && ws.readyState === WS_OPEN)
          ws.send(
            JSON.stringify({
              jsonrpc: "2.0",
              method: `${method}.delta`,
              params: { subId, payload },
            }),
          );
      };
      const { snapshot, dispose } = await router.subscribe(ctx, method, params, emit);
      state.subs.set(subId, () => {
        active = false;
        dispose();
      });
      reply({ jsonrpc: "2.0", id, result: { subId, snapshot } });
      return;
    }
    const result = await router.call(ctx, method, params);
    reply({ jsonrpc: "2.0", id, result });
  }

  constructor(private readonly opts: ProductApiOptions) {
    super();
  }

  /** C5/D35 — arm the `device?` routing pair (set post-construction: PeerLink
   * and DeviceService are built after the api). A call whose params carry a
   * foreign `device` forwards WHOLE over PeerLink — the LOCAL scope check runs
   * first, so local restrictions never launder through a peer; the remote end
   * enforces its own. `device` = own id strips and serves locally. Un-armed ⇒
   * `device` is inert extra params (tolerant reader). C6-5: `subForwarder`
   * arms the subscription half (the federated proxy); without it, a device on
   * a subscription keeps the honest refusal. */
  setDeviceRouting(
    ownDeviceId: () => string,
    forwarder: DeviceForwarder,
    subForwarder?: DeviceSubscriptionForwarder,
  ): void {
    this.ownDeviceId = ownDeviceId;
    this.forwarder = forwarder;
    this.subForwarder = subForwarder ?? null;
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
      tailnetLogin: door?.login ?? null,
      tailnetNodeId: door?.nodeId ?? null,
      subs: new Map(),
    };
    const conn = { ws, state };
    this.liveConns.add(conn);
    ws.on("message", (raw) => {
      void this.onMessage(ws, state, raw.toString());
    });
    ws.on("close", () => {
      this.liveConns.delete(conn);
      for (const dispose of state.subs.values()) dispose();
      state.subs.clear();
    });
  }

  /** Which door did this upgrade come through? null = the ordinary local door
   * (token-gated; any Tailscale-* headers are IGNORED — a same-uid local
   * caller can type headers but cannot know the route secret). An identity
   * object = the sidecar-proxied door. "reject" = drop the socket. */
  private classifyDoor(
    req: IncomingMessage,
  ): { login: string; nodeId: string | null } | null | "reject" {
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
    // on the secret path these headers are trustworthy. login is REQUIRED (a
    // tagged node / WhoIs miss arrives headerless and has no identity to
    // grant); the node id arrives only from v3+ sidecars (T1 §1) — absent
    // means an older proxy, so it stays optional through the fleet upgrade.
    if (typeof login !== "string" || login.length === 0) return "reject";
    const nodeId = req.headers["tailscale-node-id"];
    return {
      login,
      nodeId: typeof nodeId === "string" && nodeId.length > 0 ? nodeId : null,
    };
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
        // a verified token is a real local grant — it wins on either door.
        // P4: a plugin-bound grant derives the {kind:"plugin"} principal (D20
        // — identity comes from the mint, never from the caller's claims).
        state.authed = true;
        state.scopes = grant.scopes;
        state.ctx = {
          principal:
            grant.pluginId !== undefined
              ? { kind: "plugin", id: grant.pluginId, scopes: grant.scopes }
              : { kind: "local-token", tokenId: grant.tokenId, scopes: grant.scopes },
          transport: state.tailnetLogin !== null ? "ws-tailnet" : "ws-loopback",
          receivedAt: Date.now(),
          clientKind: parsed.data.clientKind, // §11.2 kind gate reads it (restrict-only)
        };
      } else if (state.tailnetLogin !== null) {
        // the sidecar-proxied door: identity is the WhoIs-verified login; the
        // grant is the D32 tailnet preset (design-04 — tokens.mint/native.*/
        // push.manage/plugins.manage never federate). The peer-fieldd device
        // identity is TRANSPORT-DERIVED where the sidecar allows (T1 §1): a
        // v3+ sidecar injects the WhoIs node id, and the registry correlation
        // maps it to the roster deviceId — the caller's claim cannot move it
        // (a contradicting claim loses silently; same grant either way, so
        // nothing escalates). The C5 hello claim survives ONLY as the
        // mixed-fleet fallback — an absent node header means an older sidecar
        // proxied the hop, not an anonymous caller — and is deleted when the
        // fleet is v3. clientKind still decides the KIND: the node id proves
        // which device dialed, never what software did.
        const claimRaw = parsed.data.deviceId;
        const claim = typeof claimRaw === "string" && claimRaw.length > 0 ? claimRaw : undefined;
        const derived =
          state.tailnetNodeId !== null
            ? this.opts.correlateNodeId?.(state.tailnetNodeId)
            : undefined;
        const deviceId = derived ?? claim;
        const peer = parsed.data.clientKind === "peer-fieldd" && deviceId !== undefined;
        state.authed = true;
        state.scopes = [...TAILNET_SCOPES];
        state.ctx = {
          principal: peer
            ? { kind: "peer-fieldd", deviceId: deviceId as string }
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

    // P4 — dynamic services (§14): "x."-prefixed methods live in the
    // registered-namespace exact map, never in METHODS; the router runs its
    // own §14.4 pipeline (capability gate included — no static scope here).
    if (method.startsWith(NAMESPACES.DYNAMIC_PREFIX) && this.dynamicRouter !== null) {
      try {
        await this.executeDynamic(ws, state, id, method, params, reply);
      } catch (e) {
        if (e instanceof RpcCallError) {
          reply(this.err(id, e.kind as ErrorKind, e.message, e.retryable, e.details));
        } else {
          reply(this.err(id, "INTERNAL", e instanceof Error ? e.message : "internal error", false));
        }
      }
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
      // id forwards whole. C6-5: a device on a subscription installs the
      // federated proxy — same wire shape as a local subscription (subId +
      // <base>.delta/.snapshot frames), the payloads being the PEER's.
      const device = (params as { device?: unknown } | null | undefined)?.device;
      const forwarder = this.forwarder;
      if (typeof device === "string" && forwarder !== null) {
        if (device !== this.ownDeviceId?.()) {
          if (def.subscription) {
            const subForwarder = this.subForwarder;
            if (subForwarder === null) {
              reply(
                this.err(id, "PRECONDITION_FAILED", "federated subscriptions unavailable", false, {
                  device,
                }),
              );
              return;
            }
            const subId = `ps-${this.nextSubId++}`;
            const base = method.replace(/\.subscribe$/, "");
            let active = true;
            const emit = (payload: unknown, kind: "delta" | "snapshot" = "delta") => {
              if (active && ws.readyState === WS_OPEN)
                ws.send(
                  JSON.stringify({
                    jsonrpc: "2.0",
                    method: `${base}.${kind}`,
                    params: { subId, payload },
                  }),
                );
            };
            const { snapshot, dispose } = await subForwarder(
              device,
              method,
              params,
              state.ctx,
              emit,
            );
            state.subs.set(subId, () => {
              active = false;
              dispose();
            });
            reply({ jsonrpc: "2.0", id, result: { subId, snapshot } });
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
      const emit = (payload: unknown, kind: "delta" | "snapshot" = "delta") => {
        if (active && ws.readyState === WS_OPEN)
          ws.send(
            JSON.stringify({
              jsonrpc: "2.0",
              method: `${base}.${kind}`,
              params: { subId, payload },
            }),
          );
      };
      const { snapshot, dispose } = await subHandler(ctx, params, emit);
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
