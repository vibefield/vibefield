import { spawn as spawnChild } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
  ArtifactPublishParams,
  ArtifactUnpublishParams,
  CONTRACTS_VERSION,
  DeviceGetParams,
  DocCreateParams,
  type DocListResult,
  DocOpenParams,
  type DocOpenResult,
  DocRenameParams,
  KvDeleteParams,
  KvGetParams,
  KvListParams,
  KvSetParams,
  LOG_STREAMS,
  METHODS,
  type NativeHealth,
  PluginsDisableParams,
  PluginsEnableParams,
  PluginsGetParams,
  PluginsGrantsSetParams,
  PluginsInstallParams,
  PluginsOpenRendererSessionParams,
  type PluginsOpenRendererSessionResult,
  PluginsReloadParams,
  PluginsUninstallParams,
  PORTS,
  ProcessStatParams,
  type ProcessSubEvent,
  type ProductInfo,
  SCOPES,
  type Scope,
  SettingsGetParams,
  SettingsResetParams,
  SettingsSetParams,
  SettingsSubscribeParams,
} from "@vibefield/contracts";
import type { AuditHealthV1 } from "@vibefield/contracts/diagnostics";
import type { LoggingHealthV1 } from "@vibefield/contracts/logging";
import type { WsCtor } from "@vibefield/fieldd-client";
import {
  createNodeLogging,
  createNoopLogger,
  type NodeLogging,
  PluginLogRouter,
  pluginLogProvenance,
} from "@vibefield/logging";
import { ArtifactService } from "./artifact-service";
import { AuditService, type AuditWriterTestHooks } from "./audit-service";
import { DeviceService } from "./device-service";
import { DiagnosticsService } from "./diagnostics-service";
import { DocLane } from "./doc-lane";
import { DocumentService } from "./doc-service";
import { DocSyncService, type LaneInfo } from "./doc-sync";
import { EndpointService } from "./endpoint-service";
import { FederatedSubscriptionManager } from "./federated-subs";
import { InstallSetReconciler } from "./install-reconciler";
import { McpService } from "./mcp-service";
import { MeshClient } from "./mesh-client";
import { MeshLaneLink } from "./mesh-lane";
import { NativeLink, RpcCallError } from "./native-link";
import { PeerLink } from "./peer-link";
import { RegistryInstallService } from "./plugin-install";
import { PluginRegistryService } from "./plugin-registry";
import { PluginSettingsService, type SecretStore } from "./plugin-settings";
import { PluginKvStore } from "./plugin-storage";
import { ProcessService, pluginChildEnv } from "./process-service";
import { ProductApi } from "./product-api";
import { type PluginServiceLogRecord, ServiceHost } from "./service-host";
import { ServiceRegistry } from "./service-registry";
import { SettingsDocService } from "./settings-doc";
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
  /** Invoked after fatal teardown has closed process-owned evidence. The
   * standalone host may terminate the process from this callback. */
  onFatal?: (reason: string) => void;
  /** C5 test seam: the ws-ctor PeerLink dials peers with (tests inject a
   * sidecar-simulating wrapper — secret path + identity headers). */
  peerWebSocket?: WsCtor;
  /** pid of a field-native the caller spawned (recorded in product.json for cleanup tooling) */
  nativePid?: number;
  /** PLUG-P2 — plugin discovery roots (§9.1): dirs whose children are plugin
   * dirs. Unset ⇒ an empty registry (honest, never a scan of guessed paths). */
  pluginRoots?: { bundled?: string[]; devLinked?: string[] };
  /** Platform-resolved diagnostic root. Omit only for embedded/unit use where
   * the caller deliberately supplies no process-owned evidence sink. */
  logRoot?: string;
  /** P4 — override for the bundled daemon (bin.cjs cannot resolve the .mjs
   * harness via import.meta); dev/tests use the in-package source path. */
  serviceHarnessPath?: string;
  /** P5 test seam — secret-scope settings backend (default: darwin keychain). */
  secretStore?: SecretStore;
  /** P7 §5.3.1 — the registry index.json location (file:// or https://) and
   * the shipped maintainer verify key. Unset ⇒ installs refuse honestly. */
  registryUrl?: string;
  registryPublicKey?: string;
  /** Test seam for observing the service host boundary without opening a
   * plugin writer. Production resolves install provenance and persists. */
  pluginLog?: (record: PluginServiceLogRecord) => void;
  /** LOG-L6 fault seam. Never configured by the production composition root. */
  auditTestHooks?: AuditWriterTestHooks;
}

export interface FielddHealth {
  fieldd: { state: "up"; bootId: string; contractsVersion: string; startedAt: number; pid: number };
  nativeConnected: boolean;
  native: NativeHealth | null;
  docs: { state: string; docCount: number };
  plugins: { count: number; enabled: number; invalid: number };
  logging: LoggingHealthV1 | null;
  audit: AuditHealthV1;
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
  /** C6-5/D35 — the federated subscription proxy (tests drive it directly;
   * the product path is a `device?` on any subscribe method). */
  federatedSubs: FederatedSubscriptionManager;
  /** C6-6 — the artifact hub (registry over the mesh serve facade). */
  artifacts: ArtifactService;
  plugins: PluginRegistryService;
  services: ServiceRegistry;
  logging: NodeLogging | null;
  pluginLogging: NodeLogging | null;
  audit: AuditService;
  diagnostics: DiagnosticsService;
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
  const [logging, pluginLogging] =
    config.logRoot === undefined
      ? [null, null]
      : await Promise.all([
          createNodeLogging({
            logRoot: config.logRoot,
            stream: LOG_STREAMS.SYSTEM_FIELDD,
            service: "fieldd",
            role: "daemon",
            bootId,
            instanceId: bootId,
            component: "bootstrap",
            aliases: {
              home: homedir(),
              temp: tmpdir(),
              logs: config.logRoot,
              data: config.dataDir,
            },
          }),
          createNodeLogging({
            logRoot: config.logRoot,
            stream: LOG_STREAMS.PLUGINS_SERVICE,
            service: "fieldd",
            role: "worker",
            bootId,
            instanceId: bootId,
            component: "plugin.service",
            aliases: {
              home: homedir(),
              temp: tmpdir(),
              logs: config.logRoot,
              data: config.dataDir,
            },
          }),
        ]);
  const pluginLogRouter =
    pluginLogging === null ? null : new PluginLogRouter({ sink: pluginLogging });
  const logger = logging?.logger ?? createNoopLogger();
  let loggingClosePromise: Promise<void> | null = null;
  const closeLogging = (): Promise<void> => {
    loggingClosePromise ??= (async () => {
      pluginLogRouter?.close();
      await Promise.all([logging?.close(), pluginLogging?.close()]);
    })();
    return loggingClosePromise;
  };
  logger.info("fieldd.lifecycle.boot_started", "fieldd boot started");
  const tokens = new TokenService();
  const audit = new AuditService({
    dataDir: config.dataDir,
    bootId,
    aliases: {
      home: homedir(),
      temp: tmpdir(),
      ...(config.logRoot !== undefined ? { logs: config.logRoot } : {}),
      data: config.dataDir,
    },
    ...(config.auditTestHooks !== undefined ? { hooks: config.auditTestHooks } : {}),
  });
  await audit.start();
  let detachHealthSources: (() => void) | null = null;

  const native = new NativeLink({
    socketPath: join(config.dataDir, "native", "run", "mgmt.sock"),
    pairingFile: join(config.dataDir, "native", "pairing"),
    bootId,
    logger: logger.child({ component: "native_link" }),
  });
  let diagnostics: DiagnosticsService | null = null;

  // everything past pairing is transactional — never leak the client slot
  try {
    await native.connect();
    logger.info("fieldd.native_link.connected", "The native management link connected");
    const diagnosticsService = new DiagnosticsService({
      native,
      logging,
      pluginLogging,
      ...(config.logRoot !== undefined ? { logRoot: config.logRoot } : {}),
      logger: logger.child({ component: "diagnostics" }),
    });
    diagnostics = diagnosticsService;
    await diagnosticsService.start();
    const mesh = new MeshClient(native);
    // C6-3g: sync is constructed after docs but has to be reachable from its
    // commit hook, so the hook reads a binding that is filled in below. It is
    // optional the whole way down — with the mesh off (the default) `docSync`
    // stays null and every commit takes the same path it always did.
    let docSync: DocSyncService | null = null;
    const docs = new DocumentService({
      dataDir: config.dataDir,
      logger: logger.child({ component: "docs.service" }),
      onCommit: (commit) => docSync?.onCommit(commit),
    });
    const laneLink = new MeshLaneLink({
      socketPath: join(config.dataDir, "native", "run", "meshdata.sock"),
      pairingFile: join(config.dataDir, "native", "pairing"),
      bootId,
      logger: logger.child({ component: "mesh.lane" }),
    });
    // PLUG-P2 — the plugin registry (§9): manifest-only discovery, pre-listen
    // so the first snapshot is warm. No module code loads here (§19.1).
    // P7 — the installed root is fieldd-OWNED: absent on first boot is the
    // normal empty state, so create it rather than report it as a problem
    const installedRoot = join(config.dataDir, "plugins", "installed");
    mkdirSync(installedRoot, { recursive: true });
    const plugins = new PluginRegistryService({
      dataDir: config.dataDir,
      roots: {
        bundled: config.pluginRoots?.bundled ?? [],
        devLinked: config.pluginRoots?.devLinked ?? [],
        installed: [installedRoot],
      },
    });
    await plugins.refresh();

    // C6-3g — cross-device doc sync. BEST EFFORT, and that is the honest shape:
    // the mesh is off by default, so the byte socket usually is not there at
    // all. A failure here must never fail boot — fieldd's local plane works
    // exactly the same without it, which is the whole point of the two-plane
    // split. The next daemon start retries; nothing degrades silently because
    // `lane.open` already answers UNAVAILABLE with the mesh unit's real state.
    docSync = new DocSyncService({
      docs,
      control: {
        open: async (req) => {
          await native.request("native.mesh.lane.open", req);
        },
        close: async (laneId) => {
          await native.request("native.mesh.lane.close", { laneId });
        },
        subscribe: async (onEvent) => {
          const { snapshot } = await native.subscribe("native.mesh.lane.subscribe", {}, onEvent);
          return (snapshot as { lanes: LaneInfo[] } | undefined) ?? { lanes: [] };
        },
      },
      bytes: laneLink,
      peers: async () => {
        const peers = (await mesh.peers()) as { id?: unknown; online?: unknown }[];
        return (
          peers
            .filter((p): p is { id: string; online?: unknown } => typeof p.id === "string")
            // A peer that does not SAY offline gets the attempt (tolerant
            // reader); a failed open records the truth either way.
            .map((p) => ({ id: p.id, online: p.online !== false }))
        );
      },
      logger: logger.child({ component: "doc.sync" }),
    });
    try {
      await laneLink.connect();
      await docSync.start();
      logger.info("fieldd.doc_sync.started", "Cross-device document sync is live");
    } catch (error) {
      docSync = null;
      laneLink.close();
      logger.info(
        "fieldd.doc_sync.unavailable",
        "Cross-device document sync is not available on this boot",
        { error: String(error) },
      );
    }
    // P7 §5.3.1 — fetch/verify/install (user-initiated only; no phone-home)
    const installer = new RegistryInstallService({
      dataDir: config.dataDir,
      plugins,
      ...(config.registryUrl !== undefined ? { registryUrl: config.registryUrl } : {}),
      ...(config.registryPublicKey !== undefined
        ? { registryPublicKey: config.registryPublicKey }
        : {}),
      logger: logger.child({ component: "plugin.install" }),
    });
    const emitPluginLog =
      config.pluginLog ??
      ((record: PluginServiceLogRecord): void => {
        const install = plugins.get(record.pluginId);
        if (install === undefined || pluginLogRouter === null) return;
        const provenance = pluginLogProvenance(install, "service");
        if (provenance === null) return;
        pluginLogRouter.accept(provenance, {
          level: record.level,
          message: record.message,
          ...(record.fields !== undefined ? { fields: record.fields } : {}),
          ...(record.event !== undefined ? { event: record.event } : {}),
        });
      });
    // P4 — the dynamic-method router (§14): grants resolve through the plugin
    // registry; providers arrive from the service host (worker port) below.
    const services = new ServiceRegistry({
      grantedCapabilities: (pluginId) => plugins.get(pluginId)?.grantedCapabilities,
      logger: logger.child({ component: "plugin.service.router" }),
    });
    // assigned after listen (workers dial the bound port); handlers guard null
    let serviceHost: ServiceHost | null = null;
    // P7 §16.6 — assigned at the bootstrap tail (needs serviceHost for
    // restarts); handlers guard null and publish local truth into the doc
    let reconciler: InstallSetReconciler | null = null;
    // P7/D29′ — the system settings doc: fieldd's first live Loro doc (user-
    // scope settings + spine preferences + the §16.6 install-set; provenance-
    // stamped, undoable, install-set outside the undo stack).
    const settingsDoc = new SettingsDocService({
      dataDir: config.dataDir,
      logger: logger.child({ component: "plugin.settings.doc" }),
    });
    // P5 — settings + KV storage (§16.2/§16.3); user scope rides the doc
    const settings = new PluginSettingsService({
      dataDir: config.dataDir,
      plugins,
      settingsDoc,
      logger: logger.child({ component: "plugin.settings" }),
      ...(config.secretStore !== undefined ? { secretStore: config.secretStore } : {}),
    });
    const kvStore = new PluginKvStore(config.dataDir);
    // P6 — §17.1 supervised children: fieldd owns the group, the env strip,
    // and the ladder; cwd stays inside the plugin's own directories.
    const processes = new ProcessService({
      logger: logger.child({ component: "plugin.process" }),
      allowedCwdRoots: (pluginId) => {
        const roots = [join(config.dataDir, "plugins", pluginId)];
        const install = plugins.rootPath(pluginId);
        if (install !== undefined) roots.push(install);
        return roots;
      },
    });
    // P6 — §17.3 endpoint adoption: mandatory health, dead = visible.
    const endpoints = new EndpointService({
      logger: logger.child({ component: "plugin.endpoints" }),
    });
    // P6 — §17.4 MCP: contribute projects DECLARED methods (schemas from the
    // daemon-internal declaration map — sanitized snapshots never carry them);
    // consume runs client sessions. Stdio children get the same env law as
    // every plugin-adjacent child (EL7), spawned daemon-side with pipes.
    const mcp = new McpService({
      logger: logger.child({ component: "plugin.mcp" }),
      registry: {
        get: (pluginId) => {
          const record = plugins.get(pluginId);
          if (record === undefined) return undefined;
          const contributes = plugins.declaredContributes(pluginId);
          const declaredMethods = new Map<
            string,
            { kind: string; input: object; output?: object }
          >();
          for (const svc of contributes?.services ?? [])
            for (const mth of svc.methods)
              declaredMethods.set(`${svc.namespace}.${mth.name}`, {
                kind: mth.kind,
                input: mth.input,
                ...(mth.kind !== "subscription" ? { output: mth.output } : {}),
              });
          const tools = contributes?.mcp?.tools;
          return {
            enabled: record.enabled,
            grantedCapabilities: record.grantedCapabilities,
            ...(tools !== undefined ? { mcp: { tools } } : {}),
            declaredMethods,
          };
        },
        list: () => plugins.list().map((r) => r.id),
      },
      callDynamic: (method, params) => services.callProjected(method, params),
      providerUp: (ns) => services.providerUp(ns),
      spawn: (req) => {
        const child = spawnChild(req.executable, req.args, {
          ...(req.cwd !== undefined ? { cwd: req.cwd } : {}),
          env: pluginChildEnv(req.env),
          stdio: ["pipe", "pipe", "pipe"],
        });
        return {
          stdin: child.stdin as NodeJS.WritableStream,
          stdout: child.stdout as NodeJS.ReadableStream,
          stderr: child.stderr as NodeJS.ReadableStream,
          kill: () => void child.kill(),
          onExit: (cb: (code: number | null) => void) => void child.on("exit", cb),
        };
      },
    });
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
      plugins: plugins.health(),
      logging: logging?.health() ?? null,
      audit: audit.health(),
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
    audit.on("health", emitHealth);

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
    detachHealthSources = () => {
      audit.off("health", emitHealth);
      native.off("reconnecting", emitHealth);
      native.off("connected", emitHealth);
      mesh.off("reconciled", emitHealth);
      mesh.off("serves-changed", emitHealth);
      plugins.off("changed", emitHealth);
    };

    const api = new ProductApi({
      port: config.controlPort ?? PORTS.FIELDD_WS_CONTROL,
      tokens,
      ...(config.allowedOrigins ? { allowedOrigins: config.allowedOrigins } : {}),
      tailnetPathSecret: servePathSecret,
    });
    diagnosticsService.register(api);
    api.register("audit.append", (ctx, params) => audit.appendFromCaller(ctx, params));

    api.register("system.health", () => health());
    api.register("system.capabilities", () => ({
      methods: METHODS.filter((m) => m.surface === "product").map((m) => m.method),
    }));
    api.registerSubscription("system.health.subscribe", (_ctx, _params, emit) => {
      const fn = (h: FielddHealth) => emit(h);
      healthListeners.add(fn);
      return { snapshot: health(), dispose: () => healthListeners.delete(fn) };
    });
    api.register("system.mintWindowToken", async (ctx, params) => {
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
      const tokenId = tokens.reserveTokenId();
      const grant = await audit.required(
        ctx,
        {
          action: "token.window.mint",
          target: { kind: "token", id: tokenId },
          attrs: { scopes: scopes as string[], scopeCount: scopes.length },
        },
        () => tokens.mint(scopes as Scope[], label, { tokenId }),
        (minted) => ({
          attrs: {
            grantId: minted.tokenId,
            scopeCount: minted.scopes.length,
          },
        }),
        (minted) => {
          tokens.revoke(minted.tokenId);
        },
      );
      return { token: grant.token, tokenId: grant.tokenId, scopes: grant.scopes };
    });

    // -- doc lane (the :9411-class binary data plane) + doc.* handlers --
    const docLane = new DocLane({
      dataPort: config.dataPort ?? 0,
      docs,
      logger: logger.child({ component: "docs.lane" }),
    });
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
    // C6-4 — per-doc sync standing. Registered even with sync unavailable
    // (mesh off, the default): the empty list is the honest snapshot then, and
    // the renderer reads it as "sync does not apply" rather than an error.
    api.registerSubscription("doc.sync.subscribe", (ctx, _params, emit) => {
      requireLocalDocumentCaller(ctx);
      if (docSync === null) return { snapshot: [], dispose: () => {} };
      const sync = docSync;
      const off = sync.onStatusChanged((statuses) => emit(statuses));
      return { snapshot: sync.statuses(), dispose: off };
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
    // C6-4 — doc sync folds roster liveness per doc-peer: offline flips
    // reachability promptly (the transport keep-alive beats the lane's own
    // minutes-late death, F-C6-22), and a RETURNING peer re-greets every doc
    // that was waiting on it.
    docSync?.attachLiveness({
      list: () =>
        devices
          .list()
          .filter((d) => !d.self)
          .map((d) => ({ id: d.deviceId, online: d.online })),
      on: (cb) => {
        devices.on("changed", cb);
        return () => devices.off("changed", cb);
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

    // -- PluginRegistry (PLUG-P2, plugin spec §21.3/§22.1) --
    api.register("plugins.list", () => plugins.snapshot());
    api.register("plugins.get", (_ctx, params) => {
      const parsed = PluginsGetParams.safeParse(params);
      if (!parsed.success)
        throw new RpcCallError("PRECONDITION_FAILED", "expected { id: pluginId }", false);
      const record = plugins.get(parsed.data.id);
      if (!record) throw new RpcCallError("NOT_FOUND", `no such plugin: ${parsed.data.id}`, false);
      return record;
    });
    api.registerSubscription("plugins.subscribe", (_ctx, _params, emit) => {
      const fn = (snap: unknown) => emit(snap);
      plugins.on("changed", fn);
      return { snapshot: plugins.snapshot(), dispose: () => plugins.off("changed", fn) };
    });
    api.register("plugins.enable", async (ctx, params) => {
      const parsed = PluginsEnableParams.safeParse(params);
      if (!parsed.success)
        throw new RpcCallError("PRECONDITION_FAILED", "expected { id: pluginId }", false);
      return await audit.required(
        ctx,
        {
          action: "plugin.enable",
          target: { kind: "plugin", id: parsed.data.id },
        },
        async () => {
          const record = await plugins.enable(parsed.data.id);
          void reconciler?.publish(record, "enable"); // §16.6
          // §18.3 — an explicit re-enable clears quarantine and restarts fresh
          void serviceHost?.restartFresh(parsed.data.id).catch((e) => {
            logger
              .child({ component: "plugin.service.host" })
              .error(
                "fieldd.plugin_service.enable_restart_failed",
                "Enabled plugin service failed to restart",
                e,
                { pluginId: parsed.data.id },
              );
          });
          return record;
        },
        (record) => ({
          attrs: {
            enabled: record.enabled,
            source: record.source,
            manifestHash: record.manifestHash,
          },
        }),
      );
    });
    api.register("plugins.disable", async (ctx, params) => {
      const parsed = PluginsDisableParams.safeParse(params);
      if (!parsed.success)
        throw new RpcCallError("PRECONDITION_FAILED", "expected { id: pluginId }", false);
      const result = await audit.required(
        ctx,
        {
          action: "plugin.disable",
          target: { kind: "plugin", id: parsed.data.id },
        },
        async () => {
          const record = await plugins.disable(parsed.data.id);
          await serviceHost?.stop(parsed.data.id); // §16.5 — deactivates providers, data untouched
          // §15.4 — revocation is LIVE: leases die at the mint table, live
          // plugin-principal connections sever; data stays (§16.5). P6 — the
          // plugin's supervised children die with it (§17.1).
          const revoked = tokens.revokeByPlugin(parsed.data.id);
          api.dropPluginConnections(parsed.data.id);
          await processes.killPlugin(parsed.data.id);
          endpoints.withdrawPlugin(parsed.data.id);
          mcp.withdrawPlugin(parsed.data.id);
          const after = plugins.get(parsed.data.id) ?? record;
          void reconciler?.publish(after, "disable"); // §16.6
          return { record: after, revoked };
        },
        ({ record, revoked }) => ({
          attrs: {
            enabled: record.enabled,
            source: record.source,
            revokedGrantCount: revoked.count,
            revokedGrantIds: revoked.tokenIds,
          },
        }),
      );
      return result.record;
    });
    api.register("plugins.reload", async (ctx, params) => {
      const parsed = PluginsReloadParams.safeParse(params ?? {});
      if (!parsed.success) throw new RpcCallError("PRECONDITION_FAILED", "expected { id? }", false);
      // no id — the legacy whole-registry rescan (dev convenience)
      if (parsed.data.id === undefined) {
        return await audit.required(
          ctx,
          {
            action: "plugin.registry.reload",
            target: { kind: "plugin-registry", id: "all" },
          },
          async () => {
            await plugins.refresh();
            return plugins.snapshot();
          },
          (snapshot) => ({ attrs: { generation: snapshot.generation } }),
        );
      }
      // §18.5 — the dev-linked reload sequence. Step order is the law:
      // validate WITHOUT disturbing the live version; only then deactivate,
      // recycle principals (no stale token survives a fresh module — §18.3),
      // swap the registry generation atomically, and reactivate.
      const id = parsed.data.id;
      const result = await audit.required(
        ctx,
        {
          action: "plugin.reload",
          target: { kind: "plugin", id },
        },
        async () => {
          const candidate = await plugins.validateReload(id);
          await serviceHost?.stop(id);
          const revoked = tokens.revokeByPlugin(id);
          api.dropPluginConnections(id);
          await processes.killPlugin(id);
          endpoints.withdrawPlugin(id);
          mcp.withdrawPlugin(id); // fresh module ⇒ fresh declarations re-project
          const record = plugins.applyReload(id, candidate);
          if (record.enabled) void serviceHost?.restartFresh(id).catch(() => undefined);
          return { record: plugins.get(id) ?? record, revoked };
        },
        ({ record, revoked }) => ({
          attrs: {
            version: record.version,
            source: record.source,
            manifestHash: record.manifestHash,
            revokedGrantCount: revoked.count,
            revokedGrantIds: revoked.tokenIds,
          },
        }),
      );
      return result.record;
    });
    // P3b — the renderer principal lease (§11.2): the scope gate above is
    // necessary, never sufficient. Only a LOCAL renderer/shell principal may
    // open plugin sessions — clientKind is a hello CLAIM, so it can only
    // RESTRICT here (an agent claiming "renderer" still needs plugins.read,
    // which agent tokens never carry).
    const LEASE_TTL_MS = 10 * 60_000;
    api.register("plugins.openRendererSession", async (ctx, params) => {
      const parsed = PluginsOpenRendererSessionParams.safeParse(params);
      if (!parsed.success)
        throw new RpcCallError(
          "PRECONDITION_FAILED",
          "expected { pluginId, manifestHash? }",
          false,
        );
      if (
        ctx.transport !== "ws-loopback" ||
        ctx.principal.kind !== "local-token" ||
        (ctx.clientKind !== "renderer" && ctx.clientKind !== "shell-main")
      )
        throw new RpcCallError(
          "FORBIDDEN_SCOPE",
          "renderer sessions open only for local renderer/shell principals (§11.2)",
          false,
        );
      const record = plugins.get(parsed.data.pluginId);
      if (!record)
        throw new RpcCallError("NOT_FOUND", `no such plugin: ${parsed.data.pluginId}`, false);
      if (record.state === "invalid")
        throw new RpcCallError("PRECONDITION_FAILED", `${record.id} failed validation`, false, {
          pluginKind: "PLUGIN_INVALID",
        });
      if (record.state === "incompatible")
        throw new RpcCallError(
          "PRECONDITION_FAILED",
          `${record.id} is incompatible with this device`,
          false,
          { pluginKind: "PLUGIN_INCOMPATIBLE" },
        );
      if (!record.enabled)
        throw new RpcCallError("PRECONDITION_FAILED", `${record.id} is disabled`, false, {
          pluginKind: "PLUGIN_DISABLED",
        });
      if (
        parsed.data.manifestHash !== undefined &&
        parsed.data.manifestHash !== record.manifestHash
      )
        throw new RpcCallError("CONFLICT", `manifest hash mismatch for ${record.id}`, false, {
          pluginKind: "PLUGIN_ARTIFACT_MISMATCH",
        });
      // token scopes = the plugin's granted CORE capabilities (custom x.* ids
      // are service-fabric grants, never bearer-token scopes)
      const scopes = record.grantedCapabilities.filter((c): c is Scope =>
        (SCOPES as readonly string[]).includes(c),
      );
      // P4: the lease is a PLUGIN-BOUND grant — hello with it derives the
      // {kind:"plugin"} principal, so custom-capability gates bind (D20).
      const tokenId = tokens.reserveTokenId();
      const grant = await audit.required(
        ctx,
        {
          action: "token.plugin_renderer.mint",
          target: { kind: "token", id: tokenId, parentId: record.id },
          attrs: {
            pluginId: record.id,
            manifestHash: record.manifestHash,
            scopeCount: scopes.length,
            ttlMs: LEASE_TTL_MS,
          },
        },
        () =>
          tokens.mint(scopes, `plugin:${record.id}`, {
            ttlMs: LEASE_TTL_MS,
            pluginId: record.id,
            tokenId,
          }),
        (minted) => ({
          attrs: {
            grantId: minted.tokenId,
            pluginId: record.id,
            expiresAt: minted.expiresAt ?? Date.now() + LEASE_TTL_MS,
          },
        }),
        (minted) => {
          tokens.revoke(minted.tokenId);
        },
      );
      const result: PluginsOpenRendererSessionResult = {
        token: grant.token,
        scopes: grant.scopes,
        pluginId: record.id,
        expiresAt: grant.expiresAt ?? Date.now() + LEASE_TTL_MS,
      };
      return result;
    });
    plugins.on("changed", emitHealth); // plugin counts fold into the aggregated stream

    // -- settings + KV storage (PLUG-P5, §16.2/§16.3): scope:null methods with
    // a HANDLER-ENFORCED caller matrix — plugin principals need storage.self
    // and are always self-scoped; the pane path needs plugins.manage + an
    // explicit pluginId; kv.* is plugin-only. --
    const settingsCaller = (
      ctx: { principal: { kind: string; id?: string; scopes?: string[] } },
      requested: string | undefined,
    ): { pluginId: string; ownerPlugin: boolean } => {
      const principal = ctx.principal as
        | { kind: "plugin"; id: string; scopes: string[] }
        | { kind: "local-token"; tokenId: string; scopes: string[] }
        | { kind: string };
      if (principal.kind === "plugin") {
        const own = principal as { id: string; scopes: string[] };
        if (!own.scopes.includes("storage.self"))
          throw new RpcCallError("FORBIDDEN_SCOPE", "requires storage.self", false);
        if (requested !== undefined && requested !== own.id)
          throw new RpcCallError("FORBIDDEN_SCOPE", "plugin settings are self-scoped", false);
        const record = plugins.get(own.id);
        if (record === undefined || !record.enabled)
          throw new RpcCallError("PRECONDITION_FAILED", `${own.id} is disabled`, false, {
            pluginKind: "PLUGIN_DISABLED",
          });
        return { pluginId: own.id, ownerPlugin: true };
      }
      if (principal.kind === "local-token") {
        const scopes = (principal as { scopes: string[] }).scopes;
        if (!scopes.includes("plugins.manage"))
          throw new RpcCallError("FORBIDDEN_SCOPE", "requires plugins.manage", false);
        if (requested === undefined)
          throw new RpcCallError("PRECONDITION_FAILED", "pluginId required", false);
        return { pluginId: requested, ownerPlugin: false };
      }
      throw new RpcCallError("FORBIDDEN_SCOPE", "settings are local surfaces", false);
    };
    const kvCaller = (ctx: { principal: { kind: string; id?: string; scopes?: string[] } }) => {
      if (ctx.principal.kind !== "plugin")
        throw new RpcCallError("FORBIDDEN_SCOPE", "kv storage is plugin-only", false);
      const principal = ctx.principal as { id: string; scopes: string[] };
      if (!principal.scopes.includes("storage.self"))
        throw new RpcCallError("FORBIDDEN_SCOPE", "requires storage.self", false);
      const record = plugins.get(principal.id);
      if (record === undefined || !record.enabled)
        throw new RpcCallError("PRECONDITION_FAILED", `${principal.id} is disabled`, false, {
          pluginKind: "PLUGIN_DISABLED",
        });
      return principal.id;
    };
    api.register("storage.settings.get", async (ctx, params) => {
      const parsed = SettingsGetParams.safeParse(params);
      if (!parsed.success)
        throw new RpcCallError("PRECONDITION_FAILED", "expected { pluginId?, key }", false);
      const caller = settingsCaller(ctx, parsed.data.pluginId);
      return settings.get(caller.pluginId, parsed.data.key, { ownerPlugin: caller.ownerPlugin });
    });
    api.register("storage.settings.set", async (ctx, params) => {
      const parsed = SettingsSetParams.safeParse(params);
      if (!parsed.success)
        throw new RpcCallError("PRECONDITION_FAILED", "expected { pluginId?, key, value }", false);
      const caller = settingsCaller(ctx, parsed.data.pluginId);
      // D29′ — provenance rides every write ("who turned this knob")
      await settings.set(
        caller.pluginId,
        parsed.data.key,
        parsed.data.value,
        caller.ownerPlugin ? `plugin:${caller.pluginId}` : "pane",
      );
      return { ok: true };
    });
    api.register("storage.settings.reset", async (ctx, params) => {
      const parsed = SettingsResetParams.safeParse(params);
      if (!parsed.success)
        throw new RpcCallError("PRECONDITION_FAILED", "expected { pluginId?, key }", false);
      const caller = settingsCaller(ctx, parsed.data.pluginId);
      await settings.reset(
        caller.pluginId,
        parsed.data.key,
        caller.ownerPlugin ? `plugin:${caller.pluginId}` : "pane",
      );
      return { ok: true };
    });
    // -- distribution (PLUG-P7, §5.3.1/§22.1): install/uninstall recycle every
    // principal exactly like reload — a new module version never inherits a
    // stale token (§18.3), and an uninstalled plugin's runtime dies whole. --
    const teardownPluginWithResult = async (id: string) => {
      await serviceHost?.stop(id);
      const revoked = tokens.revokeByPlugin(id);
      api.dropPluginConnections(id);
      await processes.killPlugin(id);
      endpoints.withdrawPlugin(id);
      mcp.withdrawPlugin(id);
      return revoked;
    };
    const teardownPlugin = async (id: string): Promise<void> => {
      await teardownPluginWithResult(id);
    };
    api.register("plugins.install", async (ctx, params) => {
      const parsed = PluginsInstallParams.safeParse(params);
      if (!parsed.success)
        throw new RpcCallError("PRECONDITION_FAILED", "expected { id, version? }", false);
      const upgrading = parsed.data.id !== undefined && plugins.get(parsed.data.id) !== undefined;
      const targetId = parsed.data.id ?? "sideload-request";
      const result = await audit.required(
        ctx,
        {
          action: upgrading ? "plugin.update" : "plugin.install",
          target: { kind: "plugin", id: targetId },
          attrs: {
            requestedVersion: parsed.data.version ?? "latest",
            source: parsed.data.artifactPath === undefined ? "registry" : "sideload",
          },
        },
        async () => {
          const revoked =
            upgrading && parsed.data.id !== undefined
              ? await teardownPluginWithResult(parsed.data.id)
              : { count: 0, tokenIds: [] };
          const { id } = await installer.install(parsed.data); // refresh() inside
          const record = plugins.get(id);
          if (record?.enabled === true && record.service !== "none")
            void serviceHost?.restartFresh(id).catch(() => undefined);
          if (record !== undefined) void reconciler?.publish(record, "install"); // §16.6
          return { record: record ?? { id }, revoked };
        },
        ({ record, revoked }) => {
          const installed = record as {
            id: string;
            version?: string;
            source?: string;
            manifestHash?: string;
            registry?: { artifactSha256?: string; publisher?: string };
          };
          return {
            attrs: {
              version: installed.version ?? "unknown",
              source: installed.source ?? "registry",
              manifestHash: installed.manifestHash ?? "unknown",
              artifactSha256: installed.registry?.artifactSha256 ?? "unknown",
              publisher: installed.registry?.publisher ?? "unknown",
              revokedGrantCount: revoked.count,
              revokedGrantIds: revoked.tokenIds,
            },
          };
        },
      );
      return result.record;
    });
    api.register("plugins.uninstall", async (ctx, params) => {
      const parsed = PluginsUninstallParams.safeParse(params);
      if (!parsed.success)
        throw new RpcCallError("PRECONDITION_FAILED", "expected { id, removeData? }", false);
      const before = plugins.get(parsed.data.id);
      await audit.required(
        ctx,
        {
          action: "plugin.uninstall",
          target: { kind: "plugin", id: parsed.data.id },
          attrs: {
            removeData: parsed.data.removeData === true,
            source: before?.source ?? "unknown",
            manifestHash: before?.manifestHash ?? "unknown",
            artifactSha256: before?.registry?.artifactSha256 ?? "unknown",
          },
        },
        async () => {
          const revoked = await teardownPluginWithResult(parsed.data.id);
          await installer.uninstall(parsed.data.id, parsed.data.removeData === true);
          void reconciler?.unpublish(parsed.data.id, "uninstall"); // §16.6 — everywhere
          return revoked;
        },
        (revoked) => ({
          attrs: {
            removeData: parsed.data.removeData === true,
            revokedGrantCount: revoked.count,
            revokedGrantIds: revoked.tokenIds,
          },
        }),
      );
      return { ok: true };
    });
    api.register("plugins.updates.check", () => installer.updatesCheck());

    // D29′ — the undo surface. A USER affordance: pane-only in v1 (plugin
    // principals refused honestly; per-section stacks are a later
    // refinement). The doc enforces law 2 — install-set/grants never move.
    api.register("storage.settings.undo", (ctx, _params) => {
      manageCaller(ctx);
      return settings.undoUser();
    });
    api.register("storage.settings.redo", (ctx, _params) => {
      manageCaller(ctx);
      return settings.redoUser();
    });
    api.registerSubscription("storage.settings.subscribe", async (ctx, params, emit) => {
      const parsed = SettingsSubscribeParams.safeParse(params);
      if (!parsed.success)
        throw new RpcCallError("PRECONDITION_FAILED", "expected { pluginId? }", false);
      const caller = settingsCaller(ctx, parsed.data.pluginId);
      const fn = (snap: { pluginId: string }) => {
        if (snap.pluginId === caller.pluginId) emit(snap);
      };
      settings.on("changed", fn);
      return {
        snapshot: await settings.snapshot(caller.pluginId),
        dispose: () => settings.off("changed", fn),
      };
    });
    api.register("storage.kv.get", async (ctx, params) => {
      const parsed = KvGetParams.safeParse(params);
      if (!parsed.success) throw new RpcCallError("PRECONDITION_FAILED", "expected { key }", false);
      return { value: await kvStore.get(kvCaller(ctx), parsed.data.key) };
    });
    api.register("storage.kv.set", async (ctx, params) => {
      const parsed = KvSetParams.safeParse(params);
      if (!parsed.success)
        throw new RpcCallError("PRECONDITION_FAILED", "expected { key, value }", false);
      await kvStore.set(kvCaller(ctx), parsed.data.key, parsed.data.value);
      return { ok: true };
    });
    api.register("storage.kv.delete", async (ctx, params) => {
      const parsed = KvDeleteParams.safeParse(params);
      if (!parsed.success) throw new RpcCallError("PRECONDITION_FAILED", "expected { key }", false);
      await kvStore.delete(kvCaller(ctx), parsed.data.key);
      return { ok: true };
    });
    api.register("storage.kv.list", async (ctx, params) => {
      const parsed = KvListParams.safeParse(params);
      if (!parsed.success)
        throw new RpcCallError("PRECONDITION_FAILED", "expected { prefix? }", false);
      return { keys: await kvStore.list(kvCaller(ctx), parsed.data.prefix) };
    });

    // -- supervised processes (PLUG-P6, §17.1/§22.4): spawn/signal are plugin
    // surfaces gated on the process.spawn lease scope; stat/subscribe add a
    // plugins.manage read view (owner=null sees every plugin) for doctor/UX. --
    const pluginCaller = (
      ctx: { principal: { kind: string; id?: string; scopes?: string[] } },
      capability: Scope,
    ): string => {
      if (ctx.principal.kind !== "plugin")
        throw new RpcCallError("FORBIDDEN_SCOPE", `${capability} is a plugin surface`, false);
      const principal = ctx.principal as { id: string; scopes: string[] };
      if (!principal.scopes.includes(capability))
        throw new RpcCallError("FORBIDDEN_SCOPE", `requires ${capability}`, false, {
          pluginKind: "PLUGIN_CAPABILITY_DENIED",
        });
      const record = plugins.get(principal.id);
      if (record === undefined || !record.enabled)
        throw new RpcCallError("PRECONDITION_FAILED", `${principal.id} is disabled`, false, {
          pluginKind: "PLUGIN_DISABLED",
        });
      return principal.id;
    };
    const processViewer = (ctx: {
      principal: { kind: string; id?: string; scopes?: string[] };
    }): string | null => {
      if (ctx.principal.kind === "plugin") return pluginCaller(ctx, "process.spawn");
      const scopes = (ctx.principal as { scopes?: string[] }).scopes ?? [];
      if (ctx.principal.kind === "local-token" && scopes.includes("plugins.manage")) return null;
      throw new RpcCallError("FORBIDDEN_SCOPE", "process views are owner or plugins.manage", false);
    };
    api.register("process.spawn", (ctx, params) => {
      const pluginId = pluginCaller(ctx, "process.spawn");
      return { proc: processes.spawnFor(pluginId, params) };
    });
    api.register("process.signal", (ctx, params) => {
      return { proc: processes.signal(processViewer(ctx), params) };
    });
    api.register("process.stat", (ctx, params) => {
      const parsed = ProcessStatParams.safeParse(params);
      if (!parsed.success)
        throw new RpcCallError("PRECONDITION_FAILED", "expected { procId? }", false);
      return { processes: processes.stat(processViewer(ctx), parsed.data.procId) };
    });
    api.registerSubscription("process.subscribe", (ctx, _params, emit) => {
      const owner = processViewer(ctx);
      const fn = (ev: ProcessSubEvent): void => {
        if (ev.kind === "delta" && owner !== null && ev.proc.pluginId !== owner) return;
        emit(ev);
      };
      processes.on("changed", fn);
      return {
        snapshot: processes.snapshotFor(owner),
        dispose: () => {
          processes.off("changed", fn);
        },
      };
    });

    // -- endpoint adoption (PLUG-P6, §17.3) + MCP (§17.4/§22.4) --
    const manageCaller = (ctx: { principal: { kind: string; scopes?: string[] } }): void => {
      const scopes = (ctx.principal as { scopes?: string[] }).scopes ?? [];
      if (ctx.principal.kind !== "local-token" || !scopes.includes("plugins.manage"))
        throw new RpcCallError("FORBIDDEN_SCOPE", "requires a local plugins.manage caller", false);
    };
    api.register("services.registerEndpoint", (ctx, params) =>
      endpoints.register(pluginCaller(ctx, "services.provide"), params),
    );
    api.register("services.unregisterEndpoint", (ctx, params) =>
      endpoints.unregister(pluginCaller(ctx, "services.provide"), params),
    );
    api.register("services.health", () => endpoints.snapshot());
    api.register("mcp.servers.add", (ctx, params) => {
      manageCaller(ctx); // §17.4 — user policy surface, never an agent's
      return mcp.serversAdd(params);
    });
    api.register("mcp.servers.remove", (ctx, params) => {
      manageCaller(ctx);
      mcp.serversRemove(params);
      return { ok: true };
    });
    api.register("mcp.servers.list", () => mcp.serversList());
    api.register("mcp.tools.list", () => mcp.toolsList());
    api.register("mcp.tools.call", (_ctx, params) => mcp.toolsCall(params));
    api.register("mcp.contribute.set", (ctx, params) => {
      mcp.contributeSet(pluginCaller(ctx, "mcp.contribute"), params);
      return { ok: true };
    });
    // provider liveness drives tool availability; registry changes drive
    // projection, endpoint withdrawal (a worker that left "active" took its
    // registrations with it — re-activation re-registers), and declared-server
    // presence for enabled plugins.
    services.on("changed", () => mcp.refreshContributed());
    plugins.on("changed", () => {
      for (const record of plugins.list()) {
        const workerGone =
          !record.enabled || (record.service !== "none" && record.service !== "active");
        if (workerGone) endpoints.withdrawPlugin(record.id);
        if (!record.enabled) {
          mcp.withdrawPlugin(record.id);
          continue;
        }
        const declared = plugins.declaredContributes(record.id)?.mcp?.servers ?? [];
        const live = new Set(mcp.serversList().servers.map((s) => s.serverKey));
        for (const server of declared) {
          if (live.has(`${record.id}/${server.id}`)) continue;
          // resolveSetting bridge is sync; plugin settings are async — until a
          // first-party plugin declares an MCP server, an unset reference
          // fails the START honestly (visible state), never a silent guess.
          mcp.addDeclaredServer(record.id, server, () => undefined);
        }
      }
      mcp.refreshContributed();
    });

    // -- per-capability grants (PLUG-P6, §15.2/§15.4): one device-local
    // decision, then the LIVE cascade — old leases die at the mint table,
    // plugin connections sever, children die, the service restarts fresh so
    // its new lease carries exactly the post-decision scopes. --
    api.register("plugins.grants.set", async (ctx, params) => {
      const parsed = PluginsGrantsSetParams.safeParse(params);
      if (!parsed.success)
        throw new RpcCallError(
          "PRECONDITION_FAILED",
          "expected { id, capability, granted }",
          false,
        );
      const { id, capability, granted } = parsed.data;
      const result = await audit.required(
        ctx,
        {
          action: granted ? "capability.grant" : "capability.revoke",
          target: { kind: "capability", id: capability, parentId: id },
          attrs: { pluginId: id, granted },
        },
        async () => {
          const { record, changed } = await plugins.setGrant(id, capability, granted);
          let revoked = { count: 0, tokenIds: [] as string[] };
          if (changed) {
            revoked = tokens.revokeByPlugin(id);
            api.dropPluginConnections(id);
            await processes.killPlugin(id);
            await serviceHost?.stop(id);
            endpoints.withdrawPlugin(id); // §15.4 — endpoints/MCP tools withdraw
            mcp.refreshContributed();
            if (record.enabled) void serviceHost?.restartFresh(id).catch(() => undefined);
            logger
              .child({ component: "plugin.grants" })
              .info("fieldd.plugin_grants.changed", "Plugin grant changed; principals recycled", {
                pluginId: id,
                capability,
                granted,
                grantGeneration: record.grantGeneration,
              });
          }
          const latest = plugins.get(id) ?? record;
          void reconciler?.publish(latest, "grants"); // §16.6 — decisions sync
          return { record: latest, changed, revoked };
        },
        ({ record, changed, revoked }) => ({
          attrs: {
            pluginId: id,
            capability,
            granted,
            changed,
            grantGeneration: record.grantGeneration,
            revokedGrantCount: revoked.count,
            revokedGrantIds: revoked.tokenIds,
          },
        }),
      );
      return result.record;
    });

    // -- dynamic services (PLUG-P4, §14/§22.2) --
    api.setDynamicRouter(services);
    api.register("services.list", () => services.snapshot());
    api.registerSubscription("services.subscribe", (_ctx, _params, emit) => {
      const fn = (snap: unknown) => emit(snap);
      services.on("changed", fn);
      return { snapshot: services.snapshot(), dispose: () => services.off("changed", fn) };
    });
    // §16.5 — disable deactivates providers (data untouched); the service host
    // adds worker teardown when it attaches (bootstrap tail).
    plugins.on("changed", () => {
      for (const record of plugins.list()) if (!record.enabled) services.withdrawPlugin(record.id);
    });

    // -- PeerLink (C5, design-04 D32): the device?-routing substrate --
    const peers = new PeerLink({
      ownDeviceId: () => devices.currentDeviceId(),
      // endpoint truth = the peer's slice (the store, via the parsed roster)
      endpointFor: (deviceId) => devices.get(deviceId)?.productEndpoint?.url,
      ...(config.peerWebSocket !== undefined ? { webSocket: config.peerWebSocket } : {}),
    });
    // C6-5/D35 — the subscription half: one ref-counted upstream per
    // {device, method, params}, re-snapshot on recovery; quiet during an
    // outage (the roster carries liveness, the topic stream never lies).
    const federatedSubs = new FederatedSubscriptionManager({
      link: peers,
      logger: logger.child({ component: "federated.subs" }),
    });
    api.setDeviceRouting(
      () => devices.currentDeviceId(),
      (device, method, params) => peers.request(device, method, params),
      (device, method, params, _ctx, emit) => federatedSubs.attach(device, method, params, emit),
    );
    devices.attachPeerLink(peers); // C5/D32 — fold link state into the roster

    // C6-6 — the artifact hub. Constructed HERE (before the supersession
    // closure below references it — a superseding takeover can fire before
    // bootstrap's tail runs); its serves are declared later via start(), once
    // the control port is bound. The bridge reads controlPort lazily, and the
    // product serve's secret never enters the service.
    const artifacts = new ArtifactService({
      dataDir: config.dataDir,
      bridge: {
        declare: async (specs) => {
          await mesh.setServes([
            {
              name: "product",
              target: { kind: "port", port: controlPort },
              tls: false,
              pathSecret: servePathSecret,
            },
            ...specs,
          ]);
        },
        states: () => mesh.serves(),
        on: (cb) => {
          mesh.on("serves-changed", cb);
          return () => mesh.off("serves-changed", cb);
        },
      },
      logger: logger.child({ component: "artifacts" }),
    });

    // SUPERSEDED = another fieldd owns the native plane now; this one is done.
    // The flag also closes the small gap where takeover happens before this
    // listener is attached or while ProductApi is still binding its port.
    let fatalReason: string | null = null;
    const stopForSupersession = () => {
      if (fatalReason) return;
      fatalReason = "superseded: another fieldd took over this device's native plane";
      logger.fatal(
        "fieldd.lifecycle.superseded",
        "fieldd was superseded by another native-plane owner",
      );
      // Refuse new work immediately, then preserve teardown audit ordering:
      // service leases revoke before the audit writer and logger close.
      api.close();
      docLane.close();
      const reason = fatalReason;
      void (async () => {
        await Promise.allSettled([
          serviceHost?.stopAll() ?? Promise.resolve(),
          processes.stopAll(),
        ]);
        detachHealthSources?.();
        docSync?.stop();
        laneLink.close();
        docs.dispose();
        artifacts.dispose();
        federatedSubs.dispose(); // before peers: a dying link must not trigger recovery
        peers.dispose();
        devices.dispose();
        services.dispose();
        settings.dispose();
        plugins.dispose();
        diagnosticsService.dispose();
        native.close();
        await audit.close().catch(() => undefined);
        await closeLogging();
      })().finally(() => config.onFatal?.(reason));
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
      detachHealthSources?.();
      api.close();
      docLane.close(); // release the lane port before the outer rollback runs
      docSync?.stop();
      laneLink.close();
      docs.dispose();
      devices.dispose();
      services.dispose();
      settings.dispose();
      plugins.dispose();
      diagnosticsService.dispose();
      throw e;
    }

    // C3 — the first real serve (design-00 §4.1 / foundations §2.9): fieldd's
    // own product API over the tailnet, plain-HTTP-in-WireGuard, gated by the
    // secret route the ProductApi's tailnet door verifies. C6-6 — the serve
    // SET is now composed: ArtifactService (constructed above, before the
    // supersession closure could ever reach it) owns the artifact serves, the
    // daemon prepends the product serve, and one declarative set replays on
    // every native (re)connect. Fire-and-forget: with mesh disabled every
    // entry sits `pending` honestly.
    void artifacts.start();
    api.register("artifact.publish", async (_ctx, params) => {
      const parsed = ArtifactPublishParams.safeParse(params);
      if (!parsed.success)
        throw new RpcCallError(
          "PRECONDITION_FAILED",
          "expected { name: slug, target: {kind:'port',port} | {kind:'dir',path} }",
          false,
          { issue: parsed.error.issues[0]?.message },
        );
      // the entry is built from named fields inside the service — routing keys
      // (device) and future passthrough params never enter the registry
      return await artifacts.publish(parsed.data);
    });
    api.register("artifact.unpublish", async (_ctx, params) => {
      const parsed = ArtifactUnpublishParams.safeParse(params);
      if (!parsed.success)
        throw new RpcCallError("PRECONDITION_FAILED", "expected { name: slug }", false);
      return await artifacts.unpublish(parsed.data.name);
    });
    api.register("artifact.list", () => ({ artifacts: artifacts.statuses() }));
    api.registerSubscription("artifact.subscribe", (_ctx, _params, emit) => {
      const off = artifacts.onChanged((statuses) => emit(statuses));
      return { snapshot: artifacts.statuses(), dispose: off };
    });
    mesh.on("reconciled", emitHealth);
    mesh.on("serves-changed", emitHealth);
    // C4: first roster sync (identity + publish); later syncs ride the mesh
    // events DeviceService wires itself. Fire-and-forget — mesh-down is normal.
    void devices.sync();

    // -- ServiceHost (PLUG-P4, §14.2/§18): workers for service entries --
    serviceHost = new ServiceHost({
      registry: services,
      plugins,
      tokens,
      controlPort: () => controlPort,
      ...(config.serviceHarnessPath !== undefined
        ? { harnessPath: config.serviceHarnessPath }
        : {}),
      mintServiceLease: async (pluginId, scopes) => {
        const tokenId = tokens.reserveTokenId();
        return await audit.requiredSystem(
          {
            action: "token.plugin_service.mint",
            target: { kind: "token", id: tokenId, parentId: pluginId },
            attrs: { pluginId, scopeCount: scopes.length },
          },
          () =>
            tokens.mint(scopes, `plugin:${pluginId}:service`, {
              pluginId,
              tokenId,
            }),
          (grant) => ({
            attrs: {
              pluginId,
              grantId: grant.tokenId,
              scopeCount: grant.scopes.length,
            },
          }),
          (grant) => {
            tokens.revoke(grant.tokenId);
          },
        );
      },
      revokeServiceLease: async (pluginId, tokenId, reason) => {
        try {
          await audit.requiredSystem(
            {
              action: "token.plugin_service.revoke",
              target: { kind: "token", id: tokenId, parentId: pluginId },
              attrs: { pluginId, reason },
            },
            () => tokens.revoke(tokenId),
            (revoked) => ({
              outcome: revoked ? "succeeded" : "cancelled",
              ...(revoked ? {} : { reasonCode: "TOKEN_ALREADY_REVOKED" }),
              attrs: { pluginId, revoked, reason },
            }),
          );
        } catch (error) {
          // Revocation is safety-preserving: audit failure may never keep a
          // service credential live. The writer health still reports the gap.
          tokens.revoke(tokenId);
          throw error;
        }
      },
      logger: logger.child({ component: "plugin.service.host" }),
      pluginLog: emitPluginLog,
    });
    // fire-and-forget: activation states surface honestly through the registry
    void serviceHost.startEligible();
    // P7 §16.6 — converge toward the doc's desired set (idempotent; a failed
    // entry parks honestly and retries on the next movement)
    reconciler = new InstallSetReconciler({
      settingsDoc,
      plugins,
      installer,
      teardown: teardownPlugin,
      restart: (id) => void serviceHost?.restartFresh(id).catch(() => undefined),
      audit,
      logger: logger.child({ component: "plugin.install.reconciler" }),
    });
    reconciler.attach();
    void reconciler.reconcile();

    // -- run files (shell bootstrap contract) --
    const runDir = join(config.dataDir, "fieldd", "run");
    mkdirSync(runDir, { recursive: true });
    const shellTokenId = tokens.reserveTokenId();
    const shellGrant = await audit.requiredSystem(
      {
        action: "token.shell.mint",
        target: { kind: "token", id: shellTokenId },
        attrs: { scopeCount: SCOPES.length },
      },
      () => tokens.mint([...SCOPES], "shell", { tokenId: shellTokenId }),
      (grant) => ({
        attrs: {
          grantId: grant.tokenId,
          scopeCount: grant.scopes.length,
        },
      }),
      (grant) => {
        tokens.revoke(grant.tokenId);
      },
    );
    const tokenPath = join(runDir, "shell.token");
    const productPath = join(runDir, "product.json");
    writeFileSync(tokenPath, shellGrant.token, { mode: 0o600 });
    chmodSync(tokenPath, 0o600); // umask-proof
    writeFileSync(
      productPath,
      `${JSON.stringify(
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
      )}\n`,
    );

    logger.info("fieldd.lifecycle.ready", "fieldd is ready", { controlPort, dataPort });
    let stopPromise: Promise<void> | null = null;
    const stop = (): Promise<void> => {
      stopPromise ??= (async () => {
        logger.info("fieldd.lifecycle.stopping", "fieldd is stopping");
        try {
          await serviceHost?.stopAll(); // §18.6 — service deactivation before the API falls
          await processes.stopAll(); // §17.1 — children die no later than fieldd shutdown
          detachHealthSources?.();
          endpoints.dispose();
          mcp.dispose();
          await settingsDoc.dispose(); // D29′ — the doc's writes are already durable
          api.close();
          docLane.close();
          docs.dispose();
          artifacts.dispose();
          federatedSubs.dispose(); // before peers: a dying link must not trigger recovery
          peers.dispose();
          devices.dispose();
          services.dispose();
          settings.dispose();
          plugins.dispose();
          diagnosticsService.dispose();
          native.close();
          // a superseding fieldd rewrites these for the same dataDir — never
          // delete what is no longer ours
          if (!native.superseded) {
            rmSync(tokenPath, { force: true });
            rmSync(productPath, { force: true });
          }
          await audit.close();
          logger.info("fieldd.lifecycle.stopped", "fieldd stopped");
        } catch (error) {
          logger.error("fieldd.lifecycle.stop_failed", "fieldd resource shutdown failed", error);
          throw error;
        } finally {
          await closeLogging();
        }
      })();
      return stopPromise;
    };

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
      federatedSubs,
      artifacts,
      plugins,
      services,
      logging,
      pluginLogging,
      audit,
      diagnostics: diagnosticsService,
      shellToken: shellGrant.token,
      health,
      nativeHealth: () => latestHealth,
      stop,
    };
  } catch (e) {
    detachHealthSources?.();
    diagnostics?.dispose();
    native.close(); // rollback: release the mgmt client slot
    logger.fatal("fieldd.lifecycle.bootstrap_failed", "fieldd bootstrap failed", e);
    await Promise.allSettled([audit.close(), closeLogging()]);
    throw e;
  }
}
