import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  CONTRACTS_VERSION,
  DeviceGetParams,
  DocCreateParams,
  type DocListResult,
  DocOpenParams,
  type DocOpenResult,
  DocRenameParams,
  METHODS,
  type NativeHealth,
  PORTS,
  type ProductInfo,
  SCOPES,
  type Scope,
} from "@vibefield/contracts";
import type { WsCtor } from "@vibefield/fieldd-client";
import { DeviceService } from "./device-service";
import { DocLane } from "./doc-lane";
import { DocumentService } from "./doc-service";
import { MeshClient } from "./mesh-client";
import { NativeLink, RpcCallError } from "./native-link";
import { PeerLink } from "./peer-link";
import { ProductApi } from "./product-api";
import { TokenService } from "./token-service";

// fieldd bootstrap (design-02 §3.6, P0 slice): tokens → NativeLink (pair +
// health subscription) → ProductAPI listen → run files → ready. SUPERSEDED is
// fatal for this product plane: the API stops immediately (never a zombie
// serving cached truth). Bootstrap is transactional: any failure after pairing
// releases the native single-client slot before rejecting.
//
// Track A adds the shell bootstrap contract: after listen, fieldd writes
// <dataDir>/fieldd/run/shell.token (0600, all scopes — the shell is the trusted
// root that mints narrower per-window tokens via system.mintWindowToken) and
// product.json (port/pid/bootId discovery metadata for adopt-or-spawn).

export interface FielddConfig {
  dataDir: string;
  controlPort?: number; // default PORTS.FIELDD_WS_CONTROL; 0 = ephemeral (tests)
  // default 0 = ephemeral; bin.ts supplies PORTS.FIELDD_WS_DATA for the real
  // launch. Kept ephemeral-by-default so parallel test daemons never collide on
  // a fixed port — the bound port always travels in doc.open's laneUrl anyway.
  dataPort?: number;
  allowedOrigins?: string[];
  /** invoked when this fieldd must die (e.g. superseded by a newer boot) */
  onFatal?: (reason: string) => void;
  /** C5 test seam: the ws-ctor PeerLink dials peers with (tests inject a
   * sidecar-simulating wrapper — secret path + identity headers). */
  peerWebSocket?: WsCtor;
  /** pid of a field-native the caller spawned (recorded in product.json for cleanup tooling) */
  nativePid?: number;
}

export interface FielddHealth {
  fieldd: { state: "up"; bootId: string; contractsVersion: string; startedAt: number; pid: number };
  nativeConnected: boolean;
  native: NativeHealth | null;
  docs: { state: string; docCount: number };
  /** C3: the declared serves with their fused reconcile+runtime state. `url`
   * is the full CAPABILITY URL (base serve URL + the secret route path) —
   * the Settings mesh section is where the user reads it; never log it. */
  mesh: { serves: Array<{ name: string; status: string; url?: string; error?: string }> };
}

export interface FielddDaemon {
  bootId: string;
  controlPort: number;
  /** the bound :9411-class data lane port (0-config ⇒ ephemeral; tests read it here) */
  dataPort: number;
  tokens: TokenService;
  native: NativeLink;
  mesh: MeshClient;
  docs: DocumentService;
  devices: DeviceService;
  peers: PeerLink;
  /** the all-scopes token written to run/shell.token (tests read it here) */
  shellToken: string;
  health(): FielddHealth;
  nativeHealth(): NativeHealth | null;
  stop(): Promise<void>;
}

/** The daemon's own version, published in the device slice (package version). */
const FIELDD_VERSION = "0.1.0";

export async function bootstrap(config: FielddConfig): Promise<FielddDaemon> {
  const bootId = `fieldd-${randomBytes(8).toString("hex")}`;
  const startedAt = Date.now();
  const tokens = new TokenService();

  const native = new NativeLink({
    socketPath: join(config.dataDir, "native", "run", "mgmt.sock"),
    pairingFile: join(config.dataDir, "native", "pairing"),
    bootId,
  });
  await native.connect();

  // everything past pairing is transactional — never leak the client slot
  try {
    const mesh = new MeshClient(native);
    const docs = new DocumentService({ dataDir: config.dataDir });
    // C3 — the serve route secret (thinking-c3 §1): the provenance proof
    // shared by exactly two parties, this process and the sidecar's route
    // config. 192-bit; base64url is path-safe. Never logged, never in
    // serve.list responses (the Rust side redacts); rotation = restart.
    const servePathSecret = randomBytes(24).toString("base64url");
    const capabilityUrl = (base: string | undefined): string | undefined =>
      base === undefined ? undefined : `${base.replace(/\/+$/, "")}/t/${servePathSecret}`;
    // -- health aggregation: native deltas + link liveness, one stream out --
    let latestHealth: NativeHealth | null = null;
    const healthListeners = new Set<(h: FielddHealth) => void>();
    const health = (): FielddHealth => ({
      fieldd: {
        state: "up",
        bootId,
        contractsVersion: CONTRACTS_VERSION,
        startedAt,
        pid: process.pid,
      },
      nativeConnected: native.connected,
      native: latestHealth,
      docs: docs.health(),
      mesh: {
        // serves() is the FUSED view (reconcile ∘ runtime — mesh-client C3)
        serves: mesh.serves().map((s) => {
          const url = capabilityUrl(s.url);
          return {
            name: s.name,
            status: s.status,
            ...(url !== undefined ? { url } : {}),
            ...(s.error !== undefined ? { error: s.error } : {}),
          };
        }),
      },
    });
    const emitHealth = () => {
      const h = health();
      for (const fn of healthListeners) fn(h);
    };

    const { snapshot } = await native.subscribe(
      "native.lifecycle.health.subscribe",
      {},
      (payload) => {
        latestHealth = payload as NativeHealth; // deltas + reconnect re-snapshots (P5)
        emitHealth();
      },
    );
    latestHealth = snapshot as NativeHealth;
    // link down/up flips stream immediately (each backoff attempt re-emits; cheap and honest)
    native.on("reconnecting", emitHealth);
    native.on("connected", emitHealth);

    const api = new ProductApi({
      port: config.controlPort ?? PORTS.FIELDD_WS_CONTROL,
      tokens,
      ...(config.allowedOrigins ? { allowedOrigins: config.allowedOrigins } : {}),
      tailnetPathSecret: servePathSecret,
    });

    api.register("system.health", () => health());
    api.register("system.capabilities", () => ({
      methods: METHODS.filter((m) => m.surface === "product").map((m) => m.method),
    }));
    api.registerSubscription("system.health.subscribe", (_ctx, _params, emit) => {
      const fn = (h: FielddHealth) => emit(h);
      healthListeners.add(fn);
      return { snapshot: health(), dispose: () => healthListeners.delete(fn) };
    });
    api.register("system.mintWindowToken", (ctx, params) => {
      const p = params as { scopes?: unknown; label?: unknown } | undefined;
      const scopes = p?.scopes;
      const label = p?.label;
      if (
        !Array.isArray(scopes) ||
        !scopes.every((s) => typeof s === "string") ||
        typeof label !== "string"
      )
        throw new RpcCallError(
          "PRECONDITION_FAILED",
          "expected { scopes: string[], label: string }",
        );
      if (scopes.some((s) => !(SCOPES as readonly string[]).includes(s)))
        throw new RpcCallError("PRECONDITION_FAILED", "unknown scope requested");
      // no privilege escalation: minted ⊆ caller's own grant
      const callerScopes = (ctx.principal as { scopes?: string[] }).scopes ?? [];
      const outside = scopes.filter((s) => !callerScopes.includes(s));
      if (outside.length > 0)
        throw new RpcCallError(
          "FORBIDDEN_SCOPE",
          `cannot mint beyond own grant: ${outside.join(",")}`,
          false,
          {
            outside,
          },
        );
      const grant = tokens.mint(scopes as Scope[], label);
      return { token: grant.token, tokenId: grant.tokenId, scopes: grant.scopes };
    });

    // -- doc lane (the :9411-class binary data plane) + doc.* handlers --
    const docLane = new DocLane({ dataPort: config.dataPort ?? 0, docs });
    const dataPort = await docLane.listen();

    const requireLocalDocumentCaller = (ctx: { transport: string }): void => {
      if (ctx.transport !== "ws-loopback") {
        throw new RpcCallError(
          "FORBIDDEN_SCOPE",
          "document persistence methods are available only over loopback",
          false,
        );
      }
    };

    api.register("doc.create", async (ctx, params) => {
      requireLocalDocumentCaller(ctx);
      const parsed = DocCreateParams.safeParse(params);
      if (!parsed.success)
        throw new RpcCallError("PRECONDITION_FAILED", "expected { name: string }", false);
      const entry = await docs.create(parsed.data.name);
      emitHealth(); // docCount moved — reflect it on the aggregated stream
      return entry;
    });
    api.register("doc.list", (ctx) => {
      requireLocalDocumentCaller(ctx);
      const result: DocListResult = { docs: docs.list() };
      return result;
    });
    api.register("doc.open", (ctx, params) => {
      requireLocalDocumentCaller(ctx);
      const parsed = DocOpenParams.safeParse(params);
      if (!parsed.success)
        throw new RpcCallError("PRECONDITION_FAILED", "expected { docId: uuid }", false);
      const grant = docs.open(parsed.data.docId);
      const result: DocOpenResult = {
        docId: grant.docId,
        laneUrl: `ws://127.0.0.1:${dataPort}`,
        ticket: grant.ticket,
        hasDoc: grant.hasDoc,
      };
      return result;
    });
    api.register("doc.rename", async (ctx, params) => {
      requireLocalDocumentCaller(ctx);
      const parsed = DocRenameParams.safeParse(params);
      if (!parsed.success)
        throw new RpcCallError(
          "PRECONDITION_FAILED",
          "expected { docId: uuid, name: string }",
          false,
        );
      // label-only edit — docCount is unchanged, so no emitHealth here
      return docs.rename(parsed.data.docId, parsed.data.name);
    });

    // -- DeviceService (C4, design-04 D31): the device directory --
    const devices = new DeviceService({
      dataDir: config.dataDir,
      mesh,
      bootId,
      fielddVersion: FIELDD_VERSION,
      contractsVersion: CONTRACTS_VERSION,
      // The daemon owns the serve secret + the fused serve state, so IT
      // composes the endpoint: url only while the product serve is active.
      productEndpoint: () => {
        const s = mesh.serves().find((x) => x.name === "product");
        const url = s?.status === "active" ? capabilityUrl(s.url) : undefined;
        return { serve: "product", ...(url !== undefined ? { url } : {}) };
      },
    });
    api.register("device.list", () => ({ devices: devices.list() }));
    api.register("device.get", (_ctx, params) => {
      const parsed = DeviceGetParams.safeParse(params);
      if (!parsed.success)
        throw new RpcCallError("PRECONDITION_FAILED", "expected { deviceId: string }", false);
      const info = devices.get(parsed.data.deviceId);
      if (!info)
        throw new RpcCallError("NOT_FOUND", `no such device: ${parsed.data.deviceId}`, false);
      return info;
    });
    api.registerSubscription("device.subscribe", (_ctx, _params, emit) => {
      const fn = (roster: unknown) => emit(roster);
      devices.on("changed", fn);
      return { snapshot: devices.list(), dispose: () => devices.off("changed", fn) };
    });

    // -- PeerLink (C5, design-04 D32): the device?-routing substrate --
    const peers = new PeerLink({
      ownDeviceId: () => devices.currentDeviceId(),
      // endpoint truth = the peer's slice (the store, via the parsed roster)
      endpointFor: (deviceId) => devices.get(deviceId)?.productEndpoint?.url,
      ...(config.peerWebSocket !== undefined ? { webSocket: config.peerWebSocket } : {}),
    });
    api.setDeviceRouting(
      () => devices.currentDeviceId(),
      (device, method, params) => peers.request(device, method, params),
    );
    devices.attachPeerLink(peers); // C5/D32 — fold link state into the roster

    // SUPERSEDED = another fieldd owns the native plane now; this one is done.
    // The flag also closes the small gap where takeover happens before this
    // listener is attached or while ProductApi is still binding its port.
    let fatalReason: string | null = null;
    const stopForSupersession = () => {
      if (fatalReason) return;
      fatalReason = "superseded: another fieldd took over this device's native plane";
      api.close();
      docLane.close();
      docs.dispose();
      peers.dispose();
      devices.dispose();
      native.close();
      config.onFatal?.(fatalReason);
    };
    native.on("superseded", stopForSupersession);
    if (native.superseded) stopForSupersession();

    let controlPort: number;
    try {
      if (fatalReason) throw new Error(fatalReason);
      controlPort = await api.listen();
      if (fatalReason || native.superseded || native.closed)
        throw new Error(fatalReason ?? "native link closed during Product API startup");
    } catch (e) {
      api.close();
      docLane.close(); // release the lane port before the outer rollback runs
      docs.dispose();
      devices.dispose();
      throw e;
    }

    // C3 — the first real serve (design-00 §4.1 / foundations §2.9): fieldd's
    // own product API over the tailnet, plain-HTTP-in-WireGuard, gated by the
    // secret route the ProductApi's tailnet door verifies. Fire-and-forget:
    // with mesh disabled the entry sits `pending` honestly (never a stall);
    // the declarative set replays on every native (re)connect.
    void mesh.setServes([
      {
        name: "product",
        target: { kind: "port", port: controlPort },
        tls: false,
        pathSecret: servePathSecret,
      },
    ]);
    mesh.on("reconciled", emitHealth);
    mesh.on("serves-changed", emitHealth);
    // C4: first roster sync (identity + publish); later syncs ride the mesh
    // events DeviceService wires itself. Fire-and-forget — mesh-down is normal.
    void devices.sync();

    // -- run files (shell bootstrap contract) --
    const runDir = join(config.dataDir, "fieldd", "run");
    mkdirSync(runDir, { recursive: true });
    const shellGrant = tokens.mint([...SCOPES], "shell");
    const tokenPath = join(runDir, "shell.token");
    const productPath = join(runDir, "product.json");
    writeFileSync(tokenPath, shellGrant.token, { mode: 0o600 });
    chmodSync(tokenPath, 0o600); // umask-proof
    writeFileSync(
      productPath,
      JSON.stringify(
        {
          port: controlPort,
          pid: process.pid,
          bootId,
          contractsVersion: CONTRACTS_VERSION,
          startedAt,
          nativePid: config.nativePid ?? null,
        } satisfies ProductInfo, // the shell/supervisor adoption contract (shell.ts)
        null,
        2,
      ) + "\n",
    );

    return {
      bootId,
      controlPort,
      dataPort,
      tokens,
      native,
      mesh,
      docs,
      devices,
      peers,
      shellToken: shellGrant.token,
      health,
      nativeHealth: () => latestHealth,
      async stop() {
        api.close();
        docLane.close();
        docs.dispose();
        peers.dispose();
        devices.dispose();
        native.close();
        // a superseding fieldd rewrites these for the same dataDir — never
        // delete what is no longer ours
        if (!native.superseded) {
          rmSync(tokenPath, { force: true });
          rmSync(productPath, { force: true });
        }
      },
    };
  } catch (e) {
    native.close(); // rollback: release the mgmt client slot
    throw e;
  }
}
