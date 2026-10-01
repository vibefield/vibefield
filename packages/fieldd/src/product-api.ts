import { randomBytes, timingSafeEqual } from "node:crypto";
import { EventEmitter } from "node:events";
import type { IncomingMessage } from "node:http";
import {
  type CallerContext,
  type ClientKind,
  CONTRACTS_VERSION,
  type ErrorKind,
  Hello,
  IdempotencyKey,
  MESH_CONTROL_LIMITS,
  METHODS,
  type MethodDef,
  NAMESPACES,
  PEER_FIELDD_SCOPES,
  PRODUCT_API_LIMITS,
  PRODUCT_NOTIFICATIONS,
  type RendererParticipantIdentity,
  RPC_ERROR_CODES,
  type Scope,
  type ShellClientProviderMethod,
  type ShellWebContentsCaptureArtifactPreviewParams,
  type ShellWebContentsCaptureArtifactPreviewResult,
  TAILNET_GUEST_SCOPES,
  TAILNET_SCOPES,
} from "@vibefield/contracts";
import { createNoopLogger, type Logger } from "@vibefield/logging";
import { type WebSocket, WebSocketServer } from "ws";
import {
  forwardProvenance,
  nonPeerEnvelopeRefusal,
  type OutboundEnvelope,
  readPeerEnvelope,
  splitForwardEnvelope,
} from "./forward-envelope";
import { forwardDigest, mintForwardKey, OwnerForwardJournal } from "./forward-receipts";
import { RpcCallError } from "./native-link";
import { ShellProviderBroker, type ShellProviderTransport } from "./shell-provider";

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
const PRODUCT_WS_MAX_INBOUND_BYTES = 4 * 1024 * 1024;
const PRODUCT_WS_MAX_OUTBOUND_BYTES = MESH_CONTROL_LIMITS.PRODUCT_FRAME_BYTES;
const PRODUCT_WS_MAX_BUFFERED_BYTES = MESH_CONTROL_LIMITS.PRODUCT_QUEUED_BYTES;
const SOURCE_LOCAL_ARTIFACT_METHODS = new Set([
  "artifact.publish",
  "artifact.update",
  "artifact.unpublish",
  "artifact.refreshPreview",
]);

export type Handler = (ctx: CallerContext, params: unknown) => Promise<unknown> | unknown;

/** Returns the snapshot plus a dispose; `emit` pushes deltas until dispose.
 * MAY be async (P5 — settings snapshots read files); the dispatcher awaits. */
export interface SubscriptionInstall {
  readonly snapshot: unknown;
  readonly dispose: () => void;
  /** Called only after ProductAPI installed disposal and sent the subscribe reply. Producers use
   * this to flush events that raced registration without delivering a delta before its subId. */
  readonly start?: () => void;
}

export type SubscriptionHandler = (
  ctx: CallerContext,
  params: unknown,
  /** A producer reboot may replace the stream with a fresh snapshot. */
  emit: (payload: unknown, kind?: "delta" | "snapshot") => void,
) => SubscriptionInstall | Promise<SubscriptionInstall>;

export interface ProductApiOptions {
  port: number; // 0 = ephemeral (tests)
  tokens: TokenServiceLike;
  /** Origin allowlist for browser clients. Non-browser clients send no Origin — allowed. */
  allowedOrigins?: string[];
  /** C3: the serve route secret. Unset ⇒ the tailnet door is closed entirely. */
  tailnetPathSecret?: string;
  /** T1 §1: map a sidecar-injected Tailscale node id (WhoIs `Node.StableID`)
   * to the roster's ULID deviceId — DeviceService's registry correlation.
   * *D1 (2026-10-01): unset, or a miss (peer not yet published / roster
   * stale), no longer falls back to the C5 hello claim — a hello asking for
   * the peer kind without a correlated node is admitted as `tailnet` (see the
   * hello's self arm). The claim used to stand in for this here.* */
  correlateNodeId?: (nodeId: string) => string | undefined;
  /** D1 (2026-10-01) — does the roster row of a CORRELATED device host
   * documents (`capabilities.docHost`, a desktop: DeviceService.isDocHost)?
   * The second transport fact `peer-fieldd` needs. Unset ⇒ no device is one,
   * so no hello is minted the peer kind (an embedded or unit door that wants a
   * peer says which devices are desktops). */
  isDocHost?: (deviceId: string) => boolean;
  /** the door's own lines (a demoted peer claim, a re-hello asked of one);
   * absent ⇒ silent */
  logger?: Logger;
  /** UA-2 — the user this daemon serves (users.json userId). Asserted in every
   * hello ack; a client hello carrying a DIFFERENT expectation is refused
   * INCOMPATIBLE. Unset for embedded/unit daemons (ack reports null). */
  userId?: string;
  /** UA-4 — the login recorded in link.json at link time (UA-D13), null while
   * unlinked or pre-capture. Read fresh at every hello, so a capture landing
   * mid-uptime activates the comparison law without a restart. */
  getLinkedLogin?: () => string | null;
  /** DS-2 — the owner's receipt journal for keyed forwarded mutations; tests
   * inject one to read it, a daemon takes the default. */
  forwardReceipts?: OwnerForwardJournal;
  /** SP-1 — the keepalive's interval (`system.tick`); tests shorten it. The
   * registry's `PRODUCT_API_LIMITS.TICK_INTERVAL_MS` by default. */
  tickIntervalMs?: number;
}

/** DS-L7/DS-D15 — `envelope` is what the forwarding hop adds beside the
 * method's params: `onBehalfOf`, built from the CALLING context (never from
 * the params), and on a mutation the `idempotencyKey` the owner journals its
 * receipt under. The forwarder puts it on the wire (PeerLink.request). */
export type DeviceForwarder = (
  device: string,
  method: string,
  params: unknown,
  ctx: CallerContext,
  /** Optional at the type since the landing of 2026-10-01: a wrapper (DS-4's
   * `forwardVia`) or a test may invoke a forwarder with no envelope, and
   * `withEnvelope` already takes `undefined` as "nothing to add". */
  envelope?: OutboundEnvelope,
) => Promise<unknown>;

/** C6-5/D35 — the subscription half of the `device?` convention: installs a
 * federated proxy (ref-counted upstream, re-snapshot on recovery) and returns
 * the upstream snapshot plus a dispose for this local subscriber — and, like a
 * local producer's `SubscriptionInstall.start`, a `start` this API calls once
 * its reply is sent: the proxy hands over what the upstream sent right behind
 * its open answer then (2026-10-01), since a frame emitted before the reply
 * has no subId the client can route. */
export type DeviceSubscriptionForwarder = (
  device: string,
  method: string,
  params: unknown,
  ctx: CallerContext,
  emit: (payload: unknown, kind?: "delta" | "snapshot") => void,
) => Promise<{ snapshot: unknown; dispose: () => void; start?: () => void }>;

/** The slice of TokenService the API needs (keeps the dependency one-way). */
export interface TokenServiceLike {
  verify(token: string): {
    tokenId: string;
    scopes: Scope[];
    label: string;
    pluginId?: string;
    shellMain?: true;
    rendererParticipant?: RendererParticipantIdentity;
  } | null;
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
  /** D1 (2026-10-01) — this connection's hello asked for the peer daemon's
   * kind and was admitted as `tailnet` because the transport did not show it
   * (no node id, an uncorrelated node, a row that is not a desktop). Logged
   * once; `reconsiderPeerClaims` closes the connection for a fresh hello when
   * the roster would admit it. */
  peerClaimDemoted: boolean;
  /** DS-D15 — an opaque id for this connection, minted at upgrade: the window
   * a forwarded call names when the grant carries no renderer participant. */
  connectionId: string;
  /** live subscriptions on this connection: subId → dispose */
  subs: Map<string, () => void>;
  abortController: AbortController;
  shellTransport: ShellProviderTransport;
  /** SP-1 — this connection's keepalive (`system.tick`), armed by its first
   * successful hello and cleared when it closes: one timer per connection. */
  tick: ReturnType<typeof setInterval> | null;
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
  private readonly shellProvider = new ShellProviderBroker();
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

  /** D1 (2026-10-01) — the roster moved: a connection whose hello asked for
   * the peer kind and was demoted (`peerClaimDemoted`) is CLOSED when its node
   * now correlates to a desktop (`correlateNodeId` + `isDocHost`), so its
   * client dials again and its next hello is minted the peer it is. The race
   * this closes: a desktop's PeerLink re-dials within a second of a restart,
   * often before this daemon's roster has the dialler's slice, and the
   * connection's principal is fixed at hello — demoted then, the link would
   * stay `tailnet` (its forwards refused as a non-peer's envelope, its replays
   * refused the peer's doors) for as long as it stood. A connection with no
   * node id can never be admitted and is left alone. Returns how many closed;
   * the daemon calls it on every roster change. */
  reconsiderPeerClaims(): number {
    let closed = 0;
    for (const conn of [...this.liveConns]) {
      const { state } = conn;
      if (!state.peerClaimDemoted || state.tailnetNodeId === null) continue;
      // still the demoted claim: a later hello on the socket (a verified
      // token wins on either door) made it something else
      if (state.ctx?.principal.kind !== "tailnet") continue;
      const derived = this.opts.correlateNodeId?.(state.tailnetNodeId);
      if (derived === undefined || this.opts.isDocHost?.(derived) !== true) continue;
      state.peerClaimDemoted = false; // one close per demotion, however often the roster moves
      this.logger.info(
        "fieldd.product_api.peer_claim_rehello",
        "The roster now shows a demoted peer claim's node as a desktop; its connection closes for a fresh hello",
        { nodeId: state.tailnetNodeId, deviceId: derived },
      );
      // 1012 "service restart": the client's reconnect is the re-hello
      conn.ws.close(1012, "peer admitted: hello again");
      closed += 1;
    }
    return closed;
  }

  /** A revoked window bearer must lose its already-authenticated socket too.
   * TokenService blocks reconnects; this closes the live half immediately. */
  dropTokenConnections(tokenId: string): number {
    let dropped = 0;
    for (const conn of [...this.liveConns]) {
      const principal = conn.state.ctx?.principal;
      if (
        (principal?.kind === "local-token" ||
          principal?.kind === "shell-main" ||
          principal?.kind === "plugin") &&
        principal.tokenId === tokenId
      ) {
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

  callShellProvider(
    ctx: CallerContext,
    method: ShellClientProviderMethod,
    params: unknown,
  ): Promise<unknown> {
    return this.shellProvider.call(ctx, method, params);
  }

  captureArtifactPreview(
    params: ShellWebContentsCaptureArtifactPreviewParams,
  ): Promise<ShellWebContentsCaptureArtifactPreviewResult> {
    return this.shellProvider.callInternal(
      "shell.webcontents.captureArtifactPreview",
      params,
    ) as Promise<ShellWebContentsCaptureArtifactPreviewResult>;
  }

  requestRendererReplacement(
    params: import("@vibefield/contracts").ShellRendererRequestReplacementParams,
  ): Promise<import("@vibefield/contracts").ShellRendererRequestReplacementResult> {
    return this.shellProvider.callInternal("shell.renderer.requestReplacement", params) as Promise<
      import("@vibefield/contracts").ShellRendererRequestReplacementResult
    >;
  }

  artifactPreviewCaptureAvailable(): boolean {
    return this.shellProvider.provides("shell.webcontents.captureArtifactPreview");
  }

  /** Show a path in the OS file manager — internal, like the capture door:
   * only fieldd's own services enter (the agent distribution service for a
   * path its inventory holds; GT-7's terminal service for the overlay path the
   * floor reports), with an explicit fieldd caller. */
  revealPath(
    params: import("@vibefield/contracts").ShellRevealPathParams,
  ): Promise<import("@vibefield/contracts").ShellRevealPathResult> {
    return this.shellProvider.callInternal("shell.revealPath", params) as Promise<
      import("@vibefield/contracts").ShellRevealPathResult
    >;
  }

  revealPathAvailable(): boolean {
    return this.shellProvider.provides("shell.revealPath");
  }

  /** GT-8a — a terminal link's web half: the default browser, for a URL the
   * `terminal.link.open` door has already classified (terminal-links.ts).
   * Internal, like revealPath: main sees fieldd, never the renderer that
   * clicked. */
  openLink(
    params: import("@vibefield/contracts").ShellOpenLinkParams,
  ): Promise<import("@vibefield/contracts").ShellOpenLinkResult> {
    return this.shellProvider.callInternal("shell.openLink", params) as Promise<
      import("@vibefield/contracts").ShellOpenLinkResult
    >;
  }

  /** GT-7 — a native open dialog for one file, locked to one purpose.
   * Internal: only the terminal service enters, and it reads the file the user
   * picked — main returns a path, never bytes. */
  pickFile(
    params: import("@vibefield/contracts").ShellDialogPickFileParams,
  ): Promise<import("@vibefield/contracts").ShellDialogPickFileResult> {
    return this.shellProvider.callInternal("shell.dialog.pickFile", params) as Promise<
      import("@vibefield/contracts").ShellDialogPickFileResult
    >;
  }

  /** GT-7 — a native save dialog, locked to one purpose; the terminal service
   * writes where it says. */
  saveFile(
    params: import("@vibefield/contracts").ShellDialogSaveFileParams,
  ): Promise<import("@vibefield/contracts").ShellDialogSaveFileResult> {
    return this.shellProvider.callInternal("shell.dialog.saveFile", params) as Promise<
      import("@vibefield/contracts").ShellDialogSaveFileResult
    >;
  }

  // DT-1 — the SurfaceService's typed doors to the main-side authority. Like
  // the capture door, these are deliberately not ProductAPI methods: only the
  // fieldd service enters, with an explicit fieldd caller (policy — scopes,
  // audit, idempotency — has already run in the service).
  surfacesEnumerate(
    params: import("@vibefield/contracts").ShellSurfacesEnumerateParams,
  ): Promise<import("@vibefield/contracts").ShellSurfacesEnumerateResult> {
    return this.shellProvider.callInternal("shell.surfaces.enumerate", params) as Promise<
      import("@vibefield/contracts").ShellSurfacesEnumerateResult
    >;
  }

  surfacesMint(
    params: import("@vibefield/contracts").ShellSurfacesMintParams,
  ): Promise<import("@vibefield/contracts").ShellSurfacesMintResult> {
    return this.shellProvider.callInternal("shell.surfaces.mint", params) as Promise<
      import("@vibefield/contracts").ShellSurfacesMintResult
    >;
  }

  surfacesRelease(
    params: import("@vibefield/contracts").ShellSurfacesReleaseParams,
  ): Promise<import("@vibefield/contracts").ShellSurfacesReleaseResult> {
    return this.shellProvider.callInternal("shell.surfaces.release", params) as Promise<
      import("@vibefield/contracts").ShellSurfacesReleaseResult
    >;
  }

  surfaceAuthorityAvailable(): boolean {
    return this.shellProvider.provides("shell.surfaces.mint");
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
    // DS-2b — this CALL's context: a peer's recorded provenance rides it
    callCtx?: CallerContext,
  ): Promise<void> {
    const router = this.dynamicRouter;
    const ctx = callCtx ?? state.ctx;
    if (router === null || !ctx) return;
    const kind = router.kindOf(method);
    if (kind === undefined) {
      reply(this.err(id, "NOT_FOUND", `no provider for ${method}`, false, undefined, -32601));
      return;
    }
    if (kind === "subscription") {
      const refusal = this.subscriptionBudgetRefusal(state, id);
      if (refusal !== null) {
        reply(refusal);
        return;
      }
      const subId = `ps-${this.nextSubId++}`;
      let active = true;
      const emit = (payload: unknown) => {
        if (active && ws.readyState === WS_OPEN)
          this.sendBounded(ws, {
            jsonrpc: "2.0",
            method: `${method}.delta`,
            params: { subId, payload },
          });
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

  /** DS-2 — every keyed forwarded mutation this daemon OWNS runs through it:
   * applied once per {calling peer, key}; a retry reads the outcome. */
  private readonly ownerReceipts: OwnerForwardJournal;
  private readonly logger: Logger;
  /** SP-1 — the keepalive's interval, and every live keepalive timer */
  readonly tickIntervalMs: number;
  private readonly ticks = new Set<ReturnType<typeof setInterval>>();

  constructor(private readonly opts: ProductApiOptions) {
    super();
    this.logger = opts.logger ?? createNoopLogger();
    this.tickIntervalMs = opts.tickIntervalMs ?? PRODUCT_API_LIMITS.TICK_INTERVAL_MS;
    this.ownerReceipts =
      opts.forwardReceipts ??
      new OwnerForwardJournal({ device: () => this.ownDeviceId?.() ?? "unknown" });
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
    const wss = new WebSocketServer({
      port: this.opts.port,
      host: "127.0.0.1",
      maxPayload: PRODUCT_WS_MAX_INBOUND_BYTES,
    });
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
    const identity = {};
    const shellTransport: ShellProviderTransport = {
      identity,
      notify: (method, params) => this.sendBounded(ws, { jsonrpc: "2.0", method, params }),
    };
    const state: ConnState = {
      authed: false,
      ctx: null,
      scopes: [],
      tailnetLogin: door?.login ?? null,
      tailnetNodeId: door?.nodeId ?? null,
      peerClaimDemoted: false,
      connectionId: `conn_${randomBytes(9).toString("base64url")}`,
      subs: new Map(),
      abortController: new AbortController(),
      shellTransport,
      tick: null,
    };
    const conn = { ws, state };
    this.liveConns.add(conn);
    ws.on("message", (raw) => {
      void this.onMessage(ws, state, raw.toString());
    });
    ws.on("close", () => {
      this.liveConns.delete(conn);
      this.disarmTick(state);
      state.abortController.abort();
      this.shellProvider.withdraw(state.shellTransport);
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
      this.sendBounded(ws, {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "parse error" },
      });
      return;
    }
    const id = msg["id"];
    const method = String(msg["method"] ?? "");
    const params = msg["params"];
    const reply = (v: unknown) => {
      if (id !== undefined && id !== null) this.sendBounded(ws, v);
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
      // UA-2 — identity threading: the client MAY carry its expectation of
      // which user this daemon serves; a configured daemon refuses a mismatch
      // the way it refuses a version mismatch. Restrict-only: the claim can
      // narrow a connection, never escalate one.
      const expectedUser = parsed.data.userId;
      if (
        expectedUser !== undefined &&
        this.opts.userId !== undefined &&
        expectedUser !== this.opts.userId
      ) {
        reply(
          this.err(id, "INCOMPATIBLE", "user mismatch", false, {
            server: this.opts.userId,
            client: expectedUser,
          }),
        );
        ws.close(1008, "user mismatch");
        return;
      }
      // DS-D15 — the connection's provenance, fixed at hello and carried on
      // every principal's context: read only to say who a call is for when
      // this daemon forwards it, never by a gate.
      const connection: { id: string; helloClientKind: ClientKind } = {
        id: state.connectionId,
        helloClientKind: parsed.data.clientKind,
      };
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
              ? {
                  kind: "plugin",
                  id: grant.pluginId,
                  scopes: grant.scopes,
                  tokenId: grant.tokenId,
                }
              : grant.shellMain === true &&
                  parsed.data.clientKind === "shell-main" &&
                  state.tailnetLogin === null
                ? { kind: "shell-main", tokenId: grant.tokenId, scopes: grant.scopes }
                : {
                    kind: "local-token",
                    tokenId: grant.tokenId,
                    scopes: grant.scopes,
                    ...(grant.rendererParticipant === undefined
                      ? {}
                      : { rendererParticipant: { ...grant.rendererParticipant } }),
                  },
          transport: state.tailnetLogin !== null ? "ws-tailnet" : "ws-loopback",
          receivedAt: Date.now(),
          clientKind: parsed.data.clientKind, // §11.2 kind gate reads it (restrict-only)
          signal: state.abortController.signal,
          connection,
        };
      } else if (state.tailnetLogin !== null) {
        // UA-4 — the stored-login comparison law (spec §7.3, UA-D5/UA-D13):
        // the peer's WhoIs-verified login against the login recorded in
        // link.json at link time — no live self-lookup per request. The
        // comparison, not the clientKind, decides — a peer-fieldd hello from
        // a colleague's login is a guest like any other.
        //
        // UA-P-0a (D1) — NO STORED LOGIN IS NO LONGER A FULL GRANT. It used to
        // be: an unlinked (or pre-capture, or corrupt-link) desktop handed the
        // whole `TAILNET_SCOPES` preset — canvas.write, agent.spawn,
        // agent.control, approval.respond, terminal.attach — to any login the
        // tailnet verified. James ruled the posture derives from the link, so
        // that state cannot arise any more: unlinked means no node and no
        // serve; capturing means a node with nothing declared. This branch is
        // therefore unreachable from the product's own paths.
        //
        // It is kept, as a GUEST mint, because "unreachable" is a claim about
        // the paths we know: a serve left live across a posture change (the C3
        // remove-then-add debt), a sidecar still holding an old route, a
        // future caller. The safe answer to "somebody reached the door and we
        // do not know which account we are" is zero scopes, not every scope.
        const storedLogin = this.opts.getLinkedLogin?.() ?? null;
        if (storedLogin === null || state.tailnetLogin !== storedLogin) {
          state.authed = true;
          state.scopes = [...TAILNET_GUEST_SCOPES];
          state.ctx = {
            principal: {
              kind: "tailnet-guest",
              login: state.tailnetLogin,
              // DS-D15 — the node that dialled, so a guest's refusals name it
              ...(state.tailnetNodeId !== null ? { tailscaleId: state.tailnetNodeId } : {}),
            },
            transport: "ws-tailnet",
            receivedAt: Date.now(),
            signal: state.abortController.signal,
            connection,
          };
        } else {
          // the sidecar-proxied door: identity is the WhoIs-verified login; the
          // grant is the D32 tailnet preset (design-04 — tokens.mint/native.*/
          // push.manage/plugins.manage never federate). The peer-fieldd device
          // identity is TRANSPORT-DERIVED (T1 §1): a v3+ sidecar injects the
          // WhoIs node id, and the registry correlation maps it to the roster
          // deviceId — the caller's claim cannot move it.
          //
          // D1 (2026-10-01, the DS wave 1 review) — AND SO IS THE KIND. The
          // `peer-fieldd` principal carries more than the phone's preset (the
          // `index.search` of PEER_FIELDD_SCOPES, the catalog door's admission,
          // the desk board), and it used to be minted from the hello's
          // self-declared `clientKind`, the C5 device claim standing in for a
          // node the roster could not correlate — so a self-login phone that
          // claimed the kind got what SP-D13 (open) and SP-L4 withhold. It is
          // minted now only when the transport says so twice: the node id
          // correlates to a roster device, AND that roster row hosts documents
          // (`capabilities.docHost` — a desktop, DS-D7; DeviceService.isDocHost).
          // The hello still has to ASK for the kind (a node names a device,
          // never the software that dialled), but asking no longer buys it. A
          // claim without both — no node header (an older sidecar proxied the
          // hop: the mixed fleet the C5 claim covered), a node the roster cannot
          // correlate yet, a node whose row is a phone — is admitted as the
          // `tailnet` principal the phone gets: logged once for the connection,
          // never refused, because the same login is still the person. The
          // claimed device id names nothing any more; it rides that log line
          // alone. A demoted connection is closed for a fresh hello the moment
          // the roster would admit it (`reconsiderPeerClaims`), so a desktop
          // that dialled before its slice arrived is not demoted for the life
          // of its link.
          const claimRaw = parsed.data.deviceId;
          const claim = typeof claimRaw === "string" && claimRaw.length > 0 ? claimRaw : undefined;
          const derived =
            state.tailnetNodeId !== null
              ? this.opts.correlateNodeId?.(state.tailnetNodeId)
              : undefined;
          const asksPeer = parsed.data.clientKind === "peer-fieldd";
          const peer = asksPeer && derived !== undefined && this.opts.isDocHost?.(derived) === true;
          if (asksPeer && !peer && !state.peerClaimDemoted) {
            this.logger.info(
              "fieldd.product_api.peer_claim_demoted",
              "A hello asked for the peer daemon's kind without the transport to show it; admitted as a tailnet principal",
              {
                reason:
                  state.tailnetNodeId === null
                    ? "no-node-id"
                    : derived === undefined
                      ? "node-not-in-roster"
                      : "not-a-doc-host",
                ...(claim !== undefined ? { claimedDeviceId: claim } : {}),
                ...(state.tailnetNodeId !== null ? { nodeId: state.tailnetNodeId } : {}),
                ...(derived !== undefined ? { deviceId: derived } : {}),
              },
            );
          }
          state.peerClaimDemoted = asksPeer && !peer;
          state.authed = true;
          // DS-D8 (search by asking) — a self peer DAEMON carries one scope the
          // phone's preset does not: `index.search`, so a person's desktops
          // can ask each other's history (PEER_FIELDD_SCOPES, derived from the
          // preset). A `tailnet` principal keeps the preset — SP-D13 is open.
          state.scopes = peer ? [...PEER_FIELDD_SCOPES] : [...TAILNET_SCOPES];
          state.ctx = {
            principal: peer
              ? {
                  kind: "peer-fieldd",
                  deviceId: derived as string,
                  // DS-D15 — the audit actor names the NODE: the id the
                  // sidecar injected, recorded beside the correlated device
                  ...(state.tailnetNodeId !== null ? { tailscaleId: state.tailnetNodeId } : {}),
                }
              : {
                  // UA-P-0a — reaching here means the login MATCHED the stored
                  // one, so `self` is unconditionally true. It used to be
                  // conditional because pre-capture also landed here; that
                  // state is a guest now, and a `tailnet` principal without
                  // `self` can no longer arise on a linked desktop.
                  kind: "tailnet",
                  login: state.tailnetLogin,
                  self: true,
                  // T1 §1 — the declared slot, filled from the transport fact
                  ...(state.tailnetNodeId !== null ? { tailscaleId: state.tailnetNodeId } : {}),
                },
            transport: "ws-tailnet",
            receivedAt: Date.now(),
            signal: state.abortController.signal,
            connection,
          };
        }
      } else {
        reply(this.err(id, "UNAUTHORIZED", "invalid token", false));
        ws.close(1008, "unauthorized");
        return;
      }
      const ackDevice =
        state.ctx?.principal.kind === "tailnet-guest" ? undefined : this.ownDeviceId?.();
      reply({
        jsonrpc: "2.0",
        id,
        result: {
          contractsVersion: CONTRACTS_VERSION,
          serverKind: "fieldd",
          grantedScopes: state.scopes,
          // UA-2 — the pair asserts which user it serves (null = unconfigured)
          userId: this.opts.userId ?? null,
          // DS-D15's client half (2026-10-01) — the device this daemon IS, so a
          // client can tell a call routed to its own daemon from one carried
          // to another desktop; a guest is told nothing
          ...(ackDevice !== undefined && ackDevice.length > 0 ? { deviceId: ackDevice } : {}),
        },
      });
      this.armTick(ws, state);
      return;
    }

    if (!state.authed || !state.ctx) {
      reply(this.err(id, "UNAUTHORIZED", "hello required first", false));
      return;
    }

    // UA-4 — the guest choke (spec §7.3, UA-D14): a tailnet-guest principal
    // passes ONLY methods that declare guestOk. Sits BEFORE every dispatch
    // path — the shell-provider built-ins, system.unsubscribe, the dynamic
    // router, and the registry choke — because the scope check alone would
    // pass scope:null methods (system.health tells its internals to no one).
    if (state.ctx.principal.kind === "tailnet-guest") {
      const def = METHODS.find((m) => m.method === method && m.surface === "product");
      if (def?.guestOk !== true) {
        reply(
          this.err(id, "FORBIDDEN_SCOPE", "guest access: method not available", false, { method }),
        );
        return;
      }
    }

    const def = METHODS.find((m) => m.method === method && m.surface === "product");
    // DS-L7 / DS-D15 (2026-09-30) — the forwarding envelope: ONE member,
    // `forward: {onBehalfOf?, idempotencyKey?}`, beside a method's params (a
    // method's own `idempotencyKey` — surface.open, artifact.publish/update —
    // is a param and never the envelope's). It is the PEER LINK's to add: a
    // `peer-fieldd` caller's is read (tolerantly — forward-envelope.ts),
    // stripped from the params, and the provenance rides this call's context so
    // the audit actor names the window behind the calling node. Authority does
    // not move: the principal stays the peer daemon, scoped by the preset it
    // was granted at hello. Any other caller carrying `onBehalfOf` is refused
    // before anything runs — a window cannot assert who it is acting for — and
    // may carry the key only on a mutation it routes to another device (DS-2,
    // below).
    //
    // DS-2b (2026-10-01; the review's DS-2 list) — "before anything runs" is
    // literal now: the block sits ahead of EVERY dispatch path. The
    // shell-provider built-ins, `system.unsubscribe` and the dynamic router
    // returned before it, so a caller that is not a peer daemon carried the
    // envelope there unrefused, and a peer's was never stripped (the dynamic
    // router got `forward` among its params, and no provenance). `def` is
    // undefined for those (and for an unknown name): no routed mutation, so a
    // non-peer's envelope is refused there whatever it carries.
    const baseCtx = state.ctx;
    if (!baseCtx) return; // unreachable past the authed gate; keeps the type honest
    let callCtx: CallerContext = baseCtx;
    let callParams: unknown = params;
    let inboundKey: string | undefined;
    const envelope = splitForwardEnvelope(params);
    if (envelope.carried && baseCtx.principal.kind !== "peer-fieldd") {
      // DS-2 — the ONE member a caller that is not a peer daemon may carry: the
      // key of a MUTATION it routes to another device. That key is what the
      // forward's receipt is bound to — the caller's own, or the one an
      // `outcome-unknown` answer handed back, which is how the retry reads the
      // owner's receipt instead of applying twice. `onBehalfOf` is never a
      // caller's to assert.
      //
      // NARROWED 2026-10-01 (the lead's ruling on DS-D15's client half — the
      // self-device trap): the refusal is for what ASSERTS — `onBehalfOf`,
      // authority by assertion — and for what cannot be read (a `forward`
      // that is not an object, a key the contract would not journal). A lone
      // well-formed key anywhere else used to be refused too, but a client
      // keys every call in the forwarded set it routes by `device` and cannot
      // always tell its own device from another, so a key on a call that turns
      // out to be served here, or on a read, is SET ASIDE (a debug line): the
      // call runs without it, and no receipt binds it anywhere (local
      // idempotency is outside DS-D15, named).
      if (envelope.malformed || envelope.hasOnBehalfOf) {
        const refusal = nonPeerEnvelopeRefusal(method);
        reply(this.err(id, refusal.kind, refusal.message, false, refusal.details));
        return;
      }
      if (envelope.hasIdempotencyKey) {
        const key = IdempotencyKey.safeParse(envelope.rawIdempotencyKey);
        if (!key.success) {
          reply(
            this.err(id, "PRECONDITION_FAILED", "malformed forwarding envelope", false, {
              method,
              reason: "malformed idempotencyKey",
            }),
          );
          return;
        }
        const target = (envelope.rest as { device?: unknown } | null | undefined)?.device;
        const routed =
          typeof target === "string" && this.forwarder !== null && target !== this.ownDeviceId?.();
        // a keyed forward: a mutation, never a subscription — `subscription`
        // read by PRESENCE (SP-1's descriptor makes it an object)
        if (routed && def?.idempotent === false && !def?.subscription) inboundKey = key.data;
        else
          this.logger.debug(
            "fieldd.product_api.forward_key_set_aside",
            "A caller's idempotency key rode a call that binds none; set aside",
            { method, reason: routed ? "not-a-mutation" : "served-here" },
          );
      }
      callParams = envelope.rest;
    } else if (envelope.carried) {
      const read = readPeerEnvelope(envelope);
      if (!read.ok) {
        reply(
          this.err(id, "PRECONDITION_FAILED", "malformed forwarding envelope", false, {
            method,
            reason: read.reason,
          }),
        );
        return;
      }
      callParams = envelope.rest;
      if (read.onBehalfOf !== undefined) callCtx = { ...baseCtx, onBehalfOf: read.onBehalfOf };
      inboundKey = read.idempotencyKey;
    }
    // AH-3 — these two lifecycle calls bind to this exact transport. They are
    // intercepted before the ordinary handler map because a CallerContext
    // alone intentionally carries no writable connection handle.
    if (method === "shell.provider.register" || method === "shell.provider.resolve") {
      try {
        const result =
          method === "shell.provider.register"
            ? this.shellProvider.register(callCtx, state.shellTransport, callParams)
            : this.shellProvider.resolve(callCtx, state.shellTransport, callParams);
        reply({ jsonrpc: "2.0", id, result });
      } catch (e) {
        if (e instanceof RpcCallError) {
          reply(this.err(id, e.kind as ErrorKind, e.message, e.retryable, e.details));
        } else {
          reply(this.err(id, "INTERNAL", "shell provider lifecycle failed", false));
        }
      }
      return;
    }

    // built-in: dropping a subscription needs the connection's own sub table
    if (method === "system.unsubscribe") {
      const subId = (callParams as { subId?: unknown } | undefined)?.subId;
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
        await this.executeDynamic(ws, state, id, method, callParams, reply, callCtx);
      } catch (e) {
        if (e instanceof RpcCallError) {
          reply(this.err(id, e.kind as ErrorKind, e.message, e.retryable, e.details));
        } else {
          reply(this.err(id, "INTERNAL", e instanceof Error ? e.message : "internal error", false));
        }
      }
      return;
    }

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
    // D36 (enforced 2026-09-13, AR-4b): the registry's `locality` column is
    // read here, not only declared. A `local` method is THIS device's: it is
    // never served for a peer (a peer-fieldd principal calling it is refused
    // outright, whatever scopes the tailnet preset grants) and never forwarded
    // to one (a foreign `device` on it is refused before the forwarder). The
    // gap this closes: every method declared local federated in fact, and the
    // agent doors — a spawn, a resume that terminates a PTY — were the first
    // declared local into it.
    if (def.locality === "local" && state.ctx?.principal.kind === "peer-fieldd") {
      reply(
        this.err(
          id,
          "FORBIDDEN_SCOPE",
          `${method} is local to its device; it does not federate`,
          false,
          {
            method,
            locality: def.locality,
          },
        ),
      );
      return;
    }
    try {
      // C5/D35 — the `device?` convention: route AFTER the local scope check
      // (above), BEFORE execution. Own id strips and serves locally; a foreign
      // id forwards whole. C6-5: a device on a subscription installs the
      // federated proxy — same wire shape as a local subscription (subId +
      // <base>.delta/.snapshot frames), the payloads being the PEER's.
      const device = (callParams as { device?: unknown } | null | undefined)?.device;
      // DS-2 — a PEER's keyed mutation served here runs through the owner's
      // receipt journal: applied once, its retry answered from the receipt
      const receiptKey =
        inboundKey !== undefined &&
        def.idempotent === false &&
        !def.subscription && // by presence: SP-1's descriptor makes it an object
        callCtx.principal.kind === "peer-fieldd"
          ? inboundKey
          : undefined;
      if (
        typeof device === "string" &&
        def.locality === "local" &&
        device !== this.ownDeviceId?.()
      ) {
        reply(
          this.err(
            id,
            "PRECONDITION_FAILED",
            `${method} is local to its device and rejects device routing`,
            false,
            { method, locality: def.locality },
          ),
        );
        return;
      }
      if (typeof device === "string" && SOURCE_LOCAL_ARTIFACT_METHODS.has(method)) {
        reply(
          this.err(
            id,
            "PRECONDITION_FAILED",
            `${method} is source-local and rejects device routing`,
            false,
            { method },
          ),
        );
        return;
      }
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
            const federatedRefusal = this.subscriptionBudgetRefusal(state, id);
            if (federatedRefusal !== null) {
              reply(federatedRefusal);
              return;
            }
            const subId = `ps-${this.nextSubId++}`;
            const base = method.replace(/\.subscribe$/, "");
            let active = true;
            const emit = (payload: unknown, kind: "delta" | "snapshot" = "delta") => {
              if (active && ws.readyState === WS_OPEN)
                this.sendBounded(ws, {
                  jsonrpc: "2.0",
                  method: `${base}.${kind}`,
                  params: { subId, payload },
                });
            };
            // DS-2 — a federated subscription carries no `onBehalfOf`: its
            // upstream is SHARED by every local reader (ref-counted per
            // {device, method, params}, PF6), so it is this daemon's own read
            const { snapshot, dispose, start } = await subForwarder(
              device,
              method,
              callParams,
              callCtx,
              emit,
            );
            state.subs.set(subId, () => {
              active = false;
              dispose();
            });
            reply({ jsonrpc: "2.0", id, result: { subId, snapshot } });
            // what the upstream sent behind its open answer, now that the
            // reply routes it (the local path's `start`, for the proxy)
            try {
              start?.();
            } catch {
              state.subs.get(subId)?.();
              state.subs.delete(subId);
              ws.terminate();
            }
            return;
          }
          // DS-L7 — who the call is for, from the CALLING context (a peer's
          // relayed call restates what that peer said); never from params
          // DS-2 — every forwarded MUTATION carries a key (the caller's, a
          // relaying peer's, else a fresh one); a read carries none
          const idempotencyKey =
            def.idempotent === false ? (inboundKey ?? mintForwardKey()) : undefined;
          const outbound: OutboundEnvelope = {
            onBehalfOf: forwardProvenance(callCtx, {
              deviceId: this.ownDeviceId?.() ?? "",
              userId: this.opts.userId,
            }),
            ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
          };
          const result = await forwarder(device, method, callParams, callCtx, outbound);
          reply({ jsonrpc: "2.0", id, result });
          return;
        }
        // device === self: strip the routing key, serve locally
        const { device: _self, ...rest } = callParams as Record<string, unknown>;
        await this.execute(ws, state, id, method, rest, handler, subHandler, reply, {
          ctx: callCtx,
          ...(receiptKey !== undefined ? { receiptKey } : {}),
        });
        return;
      }
      await this.execute(ws, state, id, method, callParams, handler, subHandler, reply, {
        ctx: callCtx,
        ...(receiptKey !== undefined ? { receiptKey } : {}),
      });
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
    // DS-2 — this CALL's context (a peer's recorded provenance rides it; the
    // connection's own context otherwise) and, for a peer's keyed mutation,
    // the key its receipt is journaled under. Trailing, so the positional
    // shape the lifecycle tests drive stays as it was.
    call: { ctx?: CallerContext; receiptKey?: string } = {},
  ): Promise<void> {
    const ctx = call.ctx ?? state.ctx;
    if (!ctx) return; // unreachable past the authed gate; keeps the type honest
    const receiptKey = call.receiptKey;
    if (subHandler) {
      const refusal = this.subscriptionBudgetRefusal(state, id);
      if (refusal !== null) {
        reply(refusal);
        return;
      }
      const subId = `ps-${this.nextSubId++}`;
      const base = method.replace(/\.subscribe$/, "");
      let active = true;
      const emit = (payload: unknown, kind: "delta" | "snapshot" = "delta") => {
        if (active && ws.readyState === WS_OPEN)
          this.sendBounded(ws, {
            jsonrpc: "2.0",
            method: `${base}.${kind}`,
            params: { subId, payload },
          });
      };
      const { snapshot, dispose, start } = await subHandler(ctx, params, emit);
      state.subs.set(subId, () => {
        active = false;
        dispose();
      });
      reply({ jsonrpc: "2.0", id, result: { subId, snapshot } });
      try {
        start?.();
      } catch {
        state.subs.get(subId)?.();
        state.subs.delete(subId);
        ws.terminate();
      }
      return;
    }
    const run = handler!;
    if (receiptKey !== undefined && ctx.principal.kind === "peer-fieldd") {
      const result = await this.ownerReceipts.run(
        {
          peer: ctx.principal.deviceId,
          key: receiptKey,
          method,
          digest: forwardDigest(params),
          ...(ctx.onBehalfOf !== undefined ? { onBehalfOf: ctx.onBehalfOf } : {}),
        },
        async () => await run(ctx, params),
      );
      reply({ jsonrpc: "2.0", id, result });
      return;
    }
    const result = await run(ctx, params);
    reply({ jsonrpc: "2.0", id, result });
  }

  /** SP-1 / SP-L7 (`thinking-sync-planes.md` §1.9 item 1) — the door's
   * keepalive. truffle's sidecar reaps a served WebSocket silent for ten
   * minutes, and an idle board sends nothing by design, so every hello'd
   * connection — loopback and tailnet alike, a guest's too — hears a
   * `system.tick` NOTIFICATION (no `id`) every `tickIntervalMs`: `{at,
   * intervalMs}`, the interval said so a reader sets its own dead-door
   * deadline from this door. One timer per connection; a second hello on the
   * same socket arms nothing; the close clears it. */
  private armTick(ws: WebSocket, state: ConnState): void {
    if (state.tick !== null || !state.authed) return;
    const intervalMs = this.tickIntervalMs;
    const tick = setInterval(() => {
      this.sendBounded(ws, {
        jsonrpc: "2.0",
        method: PRODUCT_NOTIFICATIONS.TICK,
        params: { at: Date.now(), intervalMs },
      });
    }, intervalMs);
    tick.unref?.();
    state.tick = tick;
    this.ticks.add(tick);
  }

  private disarmTick(state: ConnState): void {
    if (state.tick === null) return;
    clearInterval(state.tick);
    this.ticks.delete(state.tick);
    state.tick = null;
  }

  /** How many keepalive timers are live — one per hello'd connection that has
   * not closed (the witness that a timer dies with its connection). */
  liveTicks(): number {
    return this.ticks.size;
  }

  /** Bound both a single projection and the ws library's queued bytes. On
   * overload the connection is shed; reconnect gives state subscriptions a
   * fresh authoritative snapshot instead of retaining an unbounded delta tail. */
  private sendBounded(ws: WebSocket, value: unknown): boolean {
    if (ws.readyState !== WS_OPEN) return false;
    let encoded: string;
    try {
      encoded = JSON.stringify(value);
    } catch {
      ws.terminate();
      return false;
    }
    const bytes = Buffer.byteLength(encoded, "utf8");
    if (
      bytes > PRODUCT_WS_MAX_OUTBOUND_BYTES ||
      ws.bufferedAmount + bytes > PRODUCT_WS_MAX_BUFFERED_BYTES
    ) {
      ws.close(1013, "client is not keeping up");
      return false;
    }
    ws.send(encoded, (error) => {
      if (error) ws.terminate();
    });
    return true;
  }

  /** EL7 — a connection's subscription budget. A subscription is recurring WORK
   * (the field projection lists and encodes per subscriber per flush), so an
   * unbounded map let one socket buy the daemon's tick budget. Checked BEFORE
   * the subscribe runs at all three install sites — the local handler, the
   * federated proxy and a plugin provider's own method — so the refusal costs
   * nothing and disturbs nothing already live. */
  private subscriptionBudgetRefusal(state: ConnState, id: unknown): unknown | null {
    if (state.subs.size < PRODUCT_API_LIMITS.SUBSCRIPTIONS_PER_CONNECTION) return null;
    return this.err(
      id,
      "RESOURCE_EXHAUSTED",
      "this connection holds too many live subscriptions",
      // not retryable as-is: retrying the same call with the same map full
      // fails identically. The caller unsubscribes, or dials a second socket.
      false,
      {
        resource: "subscriptions",
        limit: PRODUCT_API_LIMITS.SUBSCRIPTIONS_PER_CONNECTION,
      },
    );
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
    this.shellProvider.dispose();
    for (const client of this.wss?.clients ?? []) client.terminate();
    this.wss?.close();
  }
}
