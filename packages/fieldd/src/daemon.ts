import { spawn as spawnChild } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
  AppPreferenceSetParams,
  ArtifactPublishParams,
  ArtifactPublishV2Params,
  ArtifactRefreshPreviewParams,
  ArtifactUnpublishParams,
  ArtifactUpdateParams,
  CONTRACTS_VERSION,
  DeviceGetParams,
  DocCreateParams,
  type DocListResult,
  DocOpenParams,
  type DocOpenResult,
  DocRenameParams,
  DocSetSyncIntentParams,
  KvDeleteParams,
  KvGetParams,
  KvListParams,
  KvSetParams,
  LAYOUT,
  LegacyArtifactPublishParams,
  LOG_STREAMS,
  METHODS,
  type MeshSyncPosture,
  type NativeHealth,
  type NativeLinkState,
  PluginsDisableParams,
  PluginsEnableParams,
  PluginsGetParams,
  PluginsGrantsSetParams,
  PluginsInstallParams,
  PluginsOpenRendererSessionParams,
  type PluginsOpenRendererSessionResult,
  PluginsReloadParams,
  PluginsResolveModuleParams,
  PluginsUninstallParams,
  ProcessStatParams,
  type ProcessSubEvent,
  type ProductInfo,
  RendererParticipantIdentity,
  SCOPES,
  type Scope,
  SettingsGetParams,
  SettingsResetParams,
  SettingsSetParams,
  SettingsSubscribeParams,
  ShellDialogPickFolderParams,
  type ShellDialogPickFolderResult,
  ShellOpenExternalParams,
  type ShellOpenExternalResult,
  STORES,
  type TerminalConfigDocument,
  TerminalConfigReadParams,
  TerminalConfigWriteParams,
  type TerminalConfigWriteResult,
  type TerminalCreateOpenResponse,
  TerminalCreateParams,
  type TerminalListResult,
  TerminalRenewAttachParams,
  type TerminalRosterResult,
  type TerminalRuntimeSessionsResult,
  TerminalSessionParams,
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
import { projectPluginAuthority } from "@vibefield/plugin-runtime";
import {
  DEFAULT_APP_PREFERENCES,
  effectiveAppPreferences,
  resolveSyncIntent,
} from "./app-preferences";
import { ArtifactService, type ArtifactServiceHealth } from "./artifact-service";
import { AuditService, type AuditWriterTestHooks } from "./audit-service";
import { nativeAlive, nativeMgmtEndpoint } from "./boot-env";
import { DeviceService } from "./device-service";
import { DiagnosticsService } from "./diagnostics-service";
import { DocLane } from "./doc-lane";
import { DocumentService } from "./doc-service";
import { DocSyncService, type LaneInfo } from "./doc-sync";
import { EndpointService } from "./endpoint-service";
import { FederatedSubscriptionManager } from "./federated-subs";
import { InstallSetReconciler } from "./install-reconciler";
import { OutboundLaneIdAllocator } from "./lane-id";
import { LinkService } from "./link-service";
import { McpService } from "./mcp-service";
import { MeshClient, type ServeSpec } from "./mesh-client";
import { MeshLaneLink } from "./mesh-lane";
import { NativeLink, RpcCallError } from "./native-link";
import { NativeSupervisor } from "./native-supervisor";
import { PeerLink } from "./peer-link";
import { RegistryInstallService } from "./plugin-install";
import { PluginModuleAuthority } from "./plugin-modules";
import { PluginRegistryService } from "./plugin-registry";
import { PluginRuntimeDiagnostics } from "./plugin-runtime-diagnostics";
import { PluginSettingsService, type SecretStore } from "./plugin-settings";
import { PluginKvStore } from "./plugin-storage";
import type { PluginUpdateDeadlines } from "./plugin-update-coordinator";
import { PluginUpdateManager } from "./plugin-update-manager";
import { PluginUpdateTransport } from "./plugin-update-transport";
import { PresenceRoomRouter } from "./presence-room";
import { ProcessService, pluginChildEnv } from "./process-service";
import { ProductApi } from "./product-api";
import {
  type PluginServiceLogRecord,
  ServiceHost,
  type ServiceHostCensus,
  type ServiceLeaseObservation,
} from "./service-host";
import { ServiceRegistry } from "./service-registry";
import { SettingsDocService } from "./settings-doc";
import { shimSpawn } from "./spawn-shim";
import { TerminalService } from "./terminal-service";
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
  controlPort?: number; // default 0 = ephemeral (UA-D12; product.json records the actual)
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
  /** TC-S2 test seam: the terminal cell-birth wait budget (production
   * defaults to the cell's genned hello deadline). */
  terminalBirthWaitMs?: number;
  /** pid of a field-native the caller spawned (recorded in product.json for cleanup tooling) */
  nativePid?: number;
  /** TC-D1 — re-runs the caller's spawn (bin.ts's exact env composition) so
   * the supervisor can respawn a dead floor. Absent = adopted/external floor:
   * no respawn authority, and the supervisor says so instead of guessing. */
  nativeSpawner?: () => number | undefined;
  /** Development-only identity used to prevent adopting output from a stale build. */
  buildId?: string;
  /** UA-2 — the user this daemon serves (users.json userId). Recorded in
   * product.json and asserted in every hello ack; the supervisor probe refuses
   * a mismatch. Unset for embedded/unit daemons. */
  userId?: string;
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
  /** Deterministic PRC-5f test seam. Production uses the contract-pinned
   * budgets; tests may shorten them without sleeping through wall-clock policy. */
  pluginUpdateDeadlines?: Partial<PluginUpdateDeadlines>;
}

export interface FielddHealth {
  fieldd: {
    state: "up";
    bootId: string;
    contractsVersion: string;
    startedAt: number;
    pid: number;
    /** TC-D6(a), fieldd half: Node cannot setrlimit itself, so fieldd MEASURES
     * and surfaces (field-native raises its own; the packaged app's launchd
     * plist is the spawner-side lever). null = unlimited or unreadable. */
    fdSoftLimit: number | null;
  };
  nativeConnected: boolean;
  /** TC-D2 — fieldd's EXTERNAL judgment of the floor: "crashed" (socket gone)
   * and "unresponsive" (alive, not answering the control path) are different
   * facts and the product says which one it means. */
  nativeLink: NativeLinkState;
  nativeLinkDetail: string;
  /** the floor pid this fieldd can vouch for (spawned this boot or by the
   * supervisor since); null for adopted floors. product.json's record goes
   * stale after the first respawn — this is the live answer. */
  nativePid: number | null;
  /** GT-2d — the build label the paired field-native gave in its hello ack.
   * The native plane outlives fieldd and is ADOPTED, so the floor answering
   * this socket can be many builds older than the tree that started us; without
   * this, a stale floor is visible only as capabilities it honestly lacks.
   * `null` = it did not say, which means a daemon predating GT-2d — itself the
   * tell, and never a claim that the build is unknowable. */
  nativeBuild: string | null;
  native: NativeHealth | null;
  docs: { state: string; docCount: number };
  plugins: { count: number; enabled: number; invalid: number };
  logging: LoggingHealthV1 | null;
  pluginLogging: LoggingHealthV1 | null;
  /** PRC-6c — counts-only live ownership. This projection contains no
   * reports, schemas, workers, ports, promises, disposers, or credentials. */
  pluginRuntime: {
    serviceHost: ServiceHostCensus | null;
    serviceRegistry: ReturnType<ServiceRegistry["state"]>;
    diagnostics: ReturnType<PluginRuntimeDiagnostics["state"]> | null;
  };
  audit: AuditHealthV1;
  /** AH-1 — private-intent durability and source-probe truth are not mesh
   * health, so they have a first-class projection of their own. */
  artifacts: ArtifactServiceHealth;
  /** C3: the declared serves with their fused reconcile+runtime state. `url`
   * is authoritative per serve: product carries its private capability path;
   * artifacts carry Truffle's exact root URL. The Settings mesh section is
   * where the user reads it; never log it. */
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
  /** TC-D1/TC-D2 — floor supervision (tests drive requestRestart directly;
   * the product path is system.native.restart). */
  nativeSupervisor: NativeSupervisor;
  stop(): Promise<void>;
  /** WIN-D5 — the process owner (bin.ts) registers what "please stop" means
   * (its own graceful shutdown: stop() then exit). The `system.shutdown`
   * handler invokes it AFTER the response flushes; unregistered, the verb
   * answers honestly that nothing is listening. */
  onShutdownRequest(callback: () => void): void;
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
    // WIN-D1: path on unix, pipe name on win32 — one law, boot-env owns it
    socketPath: nativeMgmtEndpoint(config.dataDir),
    pairingFile: join(config.dataDir, ...LAYOUT.PAIRING_FILE),
    bootId,
    ...(config.userId !== undefined ? { userId: config.userId } : {}),
    logger: logger.child({ component: "native_link" }),
  });
  // TC-D1/TC-D2 (terminal-custody TC-S1): fieldd owns floor respawn + wedge
  // detection. Constructed before connect() so no lifecycle event is missed.
  const supervisor = new NativeSupervisor({
    link: native,
    probeAlive: () => nativeAlive(nativeMgmtEndpoint(config.dataDir)),
    ...(config.nativeSpawner !== undefined ? { spawnNative: config.nativeSpawner } : {}),
    killNative: (pid, signal) => {
      try {
        return process.kill(pid, signal);
      } catch {
        return false; // already gone — the ladder's job is done
      }
    },
    ...(config.nativePid !== undefined ? { nativePid: config.nativePid } : {}),
    logger: logger.child({ component: "native_supervisor" }),
  });
  // TC-D6(a), fieldd half — measure-and-surface (Node has no setrlimit).
  const fdSoftLimit = readFdSoftLimit();
  if (fdSoftLimit !== null && fdSoftLimit < 1024) {
    logger.warn(
      "fieldd.boot.fd_soft_limit_low",
      "The fd soft limit is low for a daemon (launchd's 256 default?); raise it at the spawner",
      { fdSoftLimit },
    );
  }
  let diagnostics: DiagnosticsService | null = null;
  let pluginUpdatesForCleanup: PluginUpdateManager | null = null;
  /** Set once supersession has ALREADY been reported through `onFatal`, so the
   * boot rollback can report the window only it can see without calling the
   * spawner's fatal hook twice. */
  let supersessionReported = false;

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
    // UA-3 — the link lifecycle (spec §7.1/§7.2): capture the S1 self-whois
    // login once the node is Running; the stored login is UA-4's trust
    // comparison value. link.json lives under this user's root.
    const links = new LinkService({
      dataDir: config.dataDir,
      native,
      logger: logger.child({ component: "link" }),
    });
    links.start();
    // C6-3g: sync is constructed after docs but has to be reachable from its
    // commit hook, so the hook reads a binding that is filled in below. It is
    // optional the whole way down — with the mesh off (the default) `docSync`
    // stays null and every commit takes the same path it always did.
    let docSync: DocSyncService | null = null;
    let presenceRooms: PresenceRoomRouter | null = null;
    // UA-D7 — the user's posture, CACHED because the three sync gates ask
    // synchronously (a commit hook cannot await a settings-document read) and
    // because the settings doc is constructed further down. It starts at the
    // product default, so the window before the first read behaves exactly as
    // fieldd always has; `refreshSyncPosture` below primes it and keeps it
    // current on every settings change.
    let syncPosture: MeshSyncPosture = DEFAULT_APP_PREFERENCES.syncPosture;
    const docs = new DocumentService({
      dataDir: config.dataDir,
      logger: logger.child({ component: "docs.service" }),
      onCommit: (commit) => docSync?.onCommit(commit),
    });
    const laneLink = new MeshLaneLink({
      socketPath: join(config.dataDir, ...LAYOUT.MESHDATA_SOCKET),
      pairingFile: join(config.dataDir, ...LAYOUT.PAIRING_FILE),
      bootId,
      logger: logger.child({ component: "mesh.lane" }),
    });
    const laneIds = new OutboundLaneIdAllocator();
    const laneControl = {
      open: async (req: {
        laneId: number;
        class: "reliable" | "lossy";
        peer: string;
        protocol: "doc-sync" | "presence";
        docId?: string;
      }): Promise<void> => {
        await native.request("native.mesh.lane.open", req);
      },
      close: async (laneId: number): Promise<void> => {
        await native.request("native.mesh.lane.close", { laneId });
      },
      subscribe: async (
        onEvent: (payload: unknown, kind: "snapshot" | "delta") => void,
      ): Promise<{ lanes: LaneInfo[] }> => {
        const { snapshot } = await native.subscribe("native.mesh.lane.subscribe", {}, onEvent);
        return (snapshot as { lanes: LaneInfo[] } | undefined) ?? { lanes: [] };
      },
    };
    const meshPeers = async (): Promise<Array<{ id: string; online: boolean }>> => {
      const peers = (await mesh.peers()) as { id?: unknown; online?: unknown }[];
      return peers
        .filter((peer): peer is { id: string; online?: unknown } => typeof peer.id === "string")
        .map((peer) => ({ id: peer.id, online: peer.online !== false }));
    };
    // PLUG-P2 — the plugin registry (§9): manifest-only discovery, pre-listen
    // so the first snapshot is warm. No module code loads here (§19.1).
    // P7 — the installed root is fieldd-OWNED: absent on first boot is the
    // normal empty state, so create it rather than report it as a problem
    const installedRoot = join(config.dataDir, ...LAYOUT.PLUGINS_INSTALLED_DIR);
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
    // P8b (ESP §8.4): the module authority reads the registry and mints
    // generation-bound tokens. It holds no state worth restoring — the
    // registry's generation IS its cache key.
    const pluginModules = new PluginModuleAuthority({ plugins });

    // C6-3g — cross-device doc sync. BEST EFFORT, and that is the honest shape:
    // the mesh is off by default, so the byte socket usually is not there at
    // all. A failure here must never fail boot — fieldd's local plane works
    // exactly the same without it, which is the whole point of the two-plane
    // split. The next daemon start retries; nothing degrades silently because
    // `lane.open` already answers UNAVAILABLE with the mesh unit's real state.
    docSync = new DocSyncService({
      docs,
      control: laneControl,
      bytes: laneLink,
      allocateLaneId: laneIds.allocate,
      // A peer that does not SAY offline gets the attempt (tolerant reader); a
      // failed open records the truth either way.
      peers: meshPeers,
      // UA-D7 — the one place per-doc intent and user posture are folded
      // together; the service itself never learns that a posture exists.
      resolveIntent: (docId) => resolveSyncIntent(docs.syncIntentOf(docId), syncPosture),
      logger: logger.child({ component: "doc.sync" }),
    });
    presenceRooms = new PresenceRoomRouter({
      control: laneControl,
      bytes: laneLink,
      peers: meshPeers,
      allocateLaneId: laneIds.allocate,
      logger: logger.child({ component: "presence.room" }),
    });
    try {
      await laneLink.connect();
      await docSync.start();
      logger.info("fieldd.doc_sync.started", "Cross-device document sync is live");
      try {
        await presenceRooms.start();
        logger.info("fieldd.presence.started", "Document-room presence routing is live");
      } catch (error) {
        presenceRooms = null;
        logger.info(
          "fieldd.presence.unavailable",
          "Document-room presence is not available on this boot",
          { error: String(error) },
        );
      }
    } catch (error) {
      docSync = null;
      presenceRooms = null;
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
    await installer.recover();
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
    // Assigned with the update manager below. Health may be emitted during
    // bootstrap, so pre-composition is represented as null rather than a
    // fabricated empty owner.
    let runtimeDiagnostics: PluginRuntimeDiagnostics | null = null;
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
    // UA-D7 — keep the cached posture honest. A read failure LEAVES the last
    // known value rather than reverting to the default: silently starting to
    // sync docs a user asked to keep home is the one outcome this must not have.
    const refreshSyncPosture = async (): Promise<void> => {
      try {
        syncPosture = effectiveAppPreferences(await settingsDoc.appValues()).syncPosture;
      } catch (error) {
        logger.warn(
          "fieldd.doc_sync.posture_unreadable",
          "The mesh sync posture could not be read; the last known value stands",
          { error: String(error) },
        );
      }
    };
    settingsDoc.on("changed", (event: { section: string }) => {
      if (event.section === "app") void refreshSyncPosture();
    });
    await refreshSyncPosture();
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
        const env = pluginChildEnv(req.env);
        // WIN-3 (§4.5) — `npx`/`uvx`, the practical MCP config, ARE `.cmd` shims
        // on Windows and node refuses a batch file without a shell
        // (CVE-2024-27980). The shim quotes them into `cmd.exe /d /s /c` itself;
        // it is a passthrough on unix and for real executables.
        const cmd = shimSpawn(req.executable, req.args, process.platform, {
          env,
          ...(req.cwd !== undefined ? { cwd: req.cwd } : {}),
        });
        const child = spawnChild(cmd.command, cmd.args, {
          ...(req.cwd !== undefined ? { cwd: req.cwd } : {}),
          env,
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: true,
          ...(cmd.windowsVerbatimArguments ? { windowsVerbatimArguments: true } : {}),
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
    let artifactsRef: ArtifactService | null = null;
    let detachArtifactHealth: (() => void) | null = null;
    const healthListeners = new Set<(h: FielddHealth) => void>();
    const health = (): FielddHealth => ({
      fieldd: {
        state: "up",
        bootId,
        contractsVersion: CONTRACTS_VERSION,
        startedAt,
        pid: process.pid,
        fdSoftLimit,
      },
      nativeConnected: native.connected,
      nativeLink: supervisor.state,
      nativeLinkDetail: supervisor.stateDetail,
      nativePid: supervisor.currentPid ?? null,
      nativeBuild: native.nativeBuild ?? null,
      native: latestHealth,
      docs: docs.health(),
      plugins: plugins.health(),
      logging: logging?.health() ?? null,
      pluginLogging: pluginLogging?.health() ?? null,
      pluginRuntime: {
        serviceHost: serviceHost?.census() ?? null,
        serviceRegistry: services.state(),
        diagnostics: runtimeDiagnostics?.state() ?? null,
      },
      audit: audit.health(),
      artifacts: artifactsRef?.health() ?? {
        count: 0,
        storage: "ready",
        sources: { ready: 0, unavailable: 0, pending: 0 },
        retiring: 0,
      },
      mesh: {
        // serves() is the FUSED view (reconcile ∘ runtime — mesh-client C3)
        serves: mesh.serves().map((s) => {
          // The provenance secret belongs only to the product serve. Artifact
          // URLs are exact Truffle results with a root route.
          const url = s.name === "product" ? capabilityUrl(s.url) : s.url;
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
    supervisor.on("transition", emitHealth);
    detachHealthSources = () => {
      audit.off("health", emitHealth);
      native.off("reconnecting", emitHealth);
      native.off("connected", emitHealth);
      supervisor.off("transition", emitHealth);
      mesh.off("reconciled", emitHealth);
      mesh.off("serves-changed", emitHealth);
      plugins.off("changed", emitHealth);
      detachArtifactHealth?.();
      detachArtifactHealth = null;
    };

    // -- Terminal floor (NF-3, native-floor spec §6): the observed inventory +
    // the D6 ticket seam. Tolerant of a floor-less native (no endpoints on the
    // hello → honest UNAVAILABLE at the ticket methods) and of the mock mgmt
    // server (its generic subscribe snapshot parses as no inventory).
    //
    // NF-6: ensureStarted never throws and never fatals the boot. The old
    // try/catch here had BOTH failure modes the review named: a refused
    // subscribe killed the whole daemon, and a transient link drop was
    // swallowed with the failed subscribe DELETED from NativeLink's replay map
    // — a daemon booting through that window had a dead inventory forever
    // (list = [], every openTicket NOT_FOUND). Re-arming on every "connected"
    // keeps trying until it takes; once armed, NativeLink's own replay owns it.
    const terminals = new TerminalService({
      link: native,
      logger: logger.child({ component: "terminal.service" }),
      ...(config.terminalBirthWaitMs !== undefined
        ? { birthWaitMs: config.terminalBirthWaitMs }
        : {}),
    });
    native.on("connected", () => void terminals.ensureStarted());
    await terminals.ensureStarted();

    // T1 §1 — the tailnet door's node-id correlation. DeviceService is built
    // AFTER ProductApi, so this is a let-ref, not a closure over the const:
    // a hello racing the bootstrap window resolves to undefined (claim
    // fallback), never a TDZ crash (the C6-6 supersession lesson).
    let devicesRef: DeviceService | null = null;
    // WIN-D5 — what "please stop" means is the process owner's to define
    // (bin.ts: graceful stop then exit); late-bound because stop() closes over
    // resources constructed after the api below.
    let shutdownRequested: (() => void) | null = null;
    const api = new ProductApi({
      // UA-D12 — ephemeral default; the fixed registry number is legacy
      // documentation, and product.json is the only discovery
      port: config.controlPort ?? 0,
      tokens,
      ...(config.allowedOrigins ? { allowedOrigins: config.allowedOrigins } : {}),
      tailnetPathSecret: servePathSecret,
      correlateNodeId: (nodeId) => devicesRef?.deviceIdByNodeId(nodeId),
      ...(config.userId !== undefined ? { userId: config.userId } : {}),
      // UA-4 — the door's comparison value (UA-D13): read fresh per hello, so
      // a capture landing mid-uptime activates the law without a restart
      getLinkedLogin: () => links.status().link?.login ?? null,
    });
    diagnosticsService.register(api);
    api.register("audit.append", (ctx, params) => audit.appendFromCaller(ctx, params));

    api.register("shell.dialog.pickFolder", async (ctx, params) => {
      const parsed = ShellDialogPickFolderParams.safeParse(params);
      if (!parsed.success) {
        throw new RpcCallError(
          "PRECONDITION_FAILED",
          "expected { purpose: artifact.publish }",
          false,
        );
      }
      return await audit.required(
        ctx,
        {
          action: "shell.dialog.pick_folder",
          target: { kind: "shell-operation", id: "artifact-folder-picker" },
        },
        async (): Promise<ShellDialogPickFolderResult> =>
          (await api.callShellProvider(
            ctx,
            "shell.dialog.pickFolder",
            parsed.data,
          )) as ShellDialogPickFolderResult,
        (result) => ({ outcome: result.canceled ? "cancelled" : "succeeded" }),
      );
    });
    api.register("shell.openExternal", async (ctx, params) => {
      const parsed = ShellOpenExternalParams.safeParse(params);
      if (!parsed.success) {
        throw new RpcCallError(
          "PRECONDITION_FAILED",
          "expected a bounded credential-free HTTPS URL",
          false,
        );
      }
      return await audit.required(
        ctx,
        {
          action: "shell.open.external",
          target: { kind: "shell-operation", id: "system-browser" },
        },
        async (): Promise<ShellOpenExternalResult> =>
          (await api.callShellProvider(
            ctx,
            "shell.openExternal",
            parsed.data,
          )) as ShellOpenExternalResult,
        () => ({ outcome: "succeeded" }),
      );
    });

    api.register("system.health", () => health());
    // WIN-D5 — the stop verb. The response flushes first (setImmediate), then
    // the process owner's registered shutdown runs — the same graceful path the
    // unix signal handlers take, now reachable on every platform. Unregistered
    // (a library embedding without a process owner) the verb says so honestly.
    api.register("system.shutdown", () => {
      if (!shutdownRequested) return { stopping: false, detail: "no shutdown owner registered" };
      logger.info("fieldd.lifecycle.shutdown_requested", "system.shutdown received");
      const callback = shutdownRequested;
      setImmediate(() => callback());
      return { stopping: true };
    });
    // TC-D1 — the escalation affordance: after respawn intensity trips to the
    // permanent honest "gone", a human (or the shell's restart button)
    // overrides ON PURPOSE. Resets the window, runs one respawn cycle.
    api.register("system.native.restart", async () => {
      logger.info("fieldd.native_supervisor.manual_restart", "system.native.restart received");
      await supervisor.requestRestart();
      return { state: supervisor.state, detail: supervisor.stateDetail };
    });
    api.register("system.capabilities", () => ({
      methods: METHODS.filter((m) => m.surface === "product").map((m) => m.method),
    }));
    api.registerSubscription("system.health.subscribe", (_ctx, _params, emit) => {
      const fn = (h: FielddHealth) => emit(h);
      healthListeners.add(fn);
      return { snapshot: health(), dispose: () => healthListeners.delete(fn) };
    });
    const windowTokenIds = new Set<string>();
    const windowTokenParticipants = new Map<
      string,
      ReturnType<typeof RendererParticipantIdentity.parse>
    >();
    const requireShellWindowTokenAuthority = (ctx: {
      transport: string;
      principal: { kind: string };
    }): void => {
      if (ctx.transport !== "ws-loopback" || ctx.principal.kind !== "shell-main") {
        throw new RpcCallError(
          "FORBIDDEN_SCOPE",
          "window-token lifecycle methods are available only to the local shell",
          false,
        );
      }
    };
    const revokeWindowToken = async (
      ctx: Parameters<Parameters<typeof api.register>[1]>[0],
      tokenId: string,
      reason: "generation-ended" | "render-process-gone" | "shell-restarted",
    ): Promise<{ revoked: boolean; droppedConnections: number }> => {
      if (!windowTokenIds.has(tokenId)) {
        return { revoked: false, droppedConnections: 0 };
      }
      const participant = windowTokenParticipants.get(tokenId);
      let lifecycleTask: Promise<number> | undefined;
      const effect = async () => {
        windowTokenIds.delete(tokenId);
        windowTokenParticipants.delete(tokenId);
        const revoked = tokens.revoke(tokenId);
        const droppedConnections = api.dropTokenConnections(tokenId);
        if (participant !== undefined && pluginUpdatesForCleanup !== null) {
          lifecycleTask ??=
            reason === "render-process-gone"
              ? pluginUpdatesForCleanup.crashRendererEverywhere(participant)
              : pluginUpdatesForCleanup.retireRendererEverywhere(participant);
          await lifecycleTask;
        }
        return { revoked, droppedConnections };
      };
      try {
        return await audit.required(
          ctx,
          {
            action: "token.window.revoke",
            target: { kind: "token", id: tokenId },
            attrs: { reason },
          },
          effect,
          (result) => ({
            outcome: result.revoked ? "succeeded" : "cancelled",
            ...(result.revoked ? {} : { reasonCode: "TOKEN_ALREADY_REVOKED" }),
            attrs: { reason, droppedConnections: result.droppedConnections },
          }),
        );
      } catch (error) {
        // Revocation is safety-preserving. Evidence failure is still surfaced
        // to the shell, but may never leave a bearer live.
        await effect();
        throw error;
      }
    };
    api.register("system.mintWindowToken", async (ctx, params) => {
      requireShellWindowTokenAuthority(ctx);
      const p = params as
        | { scopes?: unknown; label?: unknown; rendererParticipant?: unknown }
        | undefined;
      const scopes = p?.scopes;
      const label = p?.label;
      const rendererParticipant = RendererParticipantIdentity.safeParse(p?.rendererParticipant);
      if (
        !Array.isArray(scopes) ||
        !scopes.every((s) => typeof s === "string") ||
        typeof label !== "string" ||
        !rendererParticipant.success
      )
        throw new RpcCallError(
          "PRECONDITION_FAILED",
          "expected { scopes: string[], label: string, rendererParticipant }",
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
          attrs: {
            scopes: scopes as string[],
            scopeCount: scopes.length,
            participantId: rendererParticipant.data.participantId,
            incarnation: rendererParticipant.data.incarnation,
          },
        },
        () =>
          tokens.mint(scopes as Scope[], label, {
            tokenId,
            rendererParticipant: rendererParticipant.data,
          }),
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
      windowTokenIds.add(grant.tokenId);
      windowTokenParticipants.set(grant.tokenId, rendererParticipant.data);
      return {
        token: grant.token,
        tokenId: grant.tokenId,
        scopes: grant.scopes,
        rendererParticipant: grant.rendererParticipant,
      };
    });
    api.register("system.revokeWindowToken", async (ctx, params) => {
      requireShellWindowTokenAuthority(ctx);
      const p = params as { tokenId?: unknown; cause?: unknown } | undefined;
      const tokenId = p?.tokenId;
      if (typeof tokenId !== "string" || !/^tk_[0-9a-f]{12}$/.test(tokenId)) {
        throw new RpcCallError(
          "PRECONDITION_FAILED",
          "expected { tokenId: window token id }",
          false,
        );
      }
      const cause = p?.cause ?? "generation-ended";
      if (cause !== "generation-ended" && cause !== "render-process-gone") {
        throw new RpcCallError(
          "PRECONDITION_FAILED",
          "window token revocation cause is invalid",
          false,
        );
      }
      return await revokeWindowToken(ctx, tokenId, cause);
    });
    api.register("system.revokeStaleWindowTokens", async (ctx) => {
      requireShellWindowTokenAuthority(ctx);
      let revoked = 0;
      let droppedConnections = 0;
      let firstError: unknown;
      for (const tokenId of [...windowTokenIds]) {
        try {
          const result = await revokeWindowToken(ctx, tokenId, "shell-restarted");
          if (result.revoked) revoked += 1;
          droppedConnections += result.droppedConnections;
        } catch (error) {
          firstError ??= error;
        }
      }
      if (firstError !== undefined) throw firstError;
      return { revoked, droppedConnections };
    });

    // -- doc lane (the :9411-class binary data plane) + doc.* handlers --
    const docLane = new DocLane({
      dataPort: config.dataPort ?? 0,
      docs,
      ...(presenceRooms === null ? {} : { rooms: presenceRooms }),
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
    // UA-D7 — "may this doc leave the device?". The registry write is the whole
    // mutation: the three sync gates read the resolver on every decision, so
    // the next commit, the next lane, and the next status fold all see the new
    // answer without anything being told about it.
    api.register("doc.setSyncIntent", async (ctx, params) => {
      requireLocalDocumentCaller(ctx);
      const parsed = DocSetSyncIntentParams.safeParse(params);
      if (!parsed.success)
        throw new RpcCallError(
          "PRECONDITION_FAILED",
          "expected { docId: uuid, intent: sync|local }",
          false,
        );
      // posture, not content — docCount and updatedAt both stand
      return docs.setSyncIntent(parsed.data.docId, parsed.data.intent);
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
    // (also the tailnet door's node-id correlator via devicesRef, assigned below)
    const devices = new DeviceService({
      dataDir: config.dataDir,
      mesh,
      bootId,
      fielddVersion: FIELDD_VERSION,
      contractsVersion: CONTRACTS_VERSION,
      // NF-3: honest capability — true iff the pairing hello delivered the
      // floor's endpoints (D31; re-synced on the terminal-endpoints event).
      terminalHost: () => native.terminalEndpoints !== undefined,
      // The daemon owns the serve secret + the fused serve state, so IT
      // composes the endpoint: url only while the product serve is active.
      productEndpoint: () => {
        const s = mesh.serves().find((x) => x.name === "product");
        const url = s?.status === "active" ? capabilityUrl(s.url) : undefined;
        return { serve: "product", ...(url !== undefined ? { url } : {}) };
      },
    });
    devicesRef = devices; // arms the tailnet door's node-id correlation (T1 §1)
    // NF-3: the terminalHost capability follows the hello — republish when the
    // floor appears or a new native boot rotates the endpoints.
    native.on("terminal-endpoints", () => void devices.sync());
    // C6-4 — doc sync folds roster liveness per doc-peer: offline flips
    // reachability promptly (the transport keep-alive beats the lane's own
    // minutes-late death, F-C6-22), and a RETURNING peer re-greets every doc
    // that was waiting on it. The rows MUST arrive keyed by tailscaleId —
    // doc-sync's peer keyspace is the dial key (PeerInfo.id), and feeding the
    // roster ULID here is the T1 §6 bug that left the whole fold inert. A
    // device the registry has not correlated contributes no row (absent, not
    // a guessed key), which doc-sync treats as no-signal.
    docSync?.attachLiveness({
      list: () =>
        devices
          .list()
          .flatMap((d) =>
            !d.self && d.tailscaleId !== undefined ? [{ id: d.tailscaleId, online: d.online }] : [],
          ),
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

    // -- Terminal floor (NF-3, native-floor spec §6): list/get read the
    // observed inventory; openTicket/create/terminate are audited (attempt
    // before effect). Scope terminal.attach across the board (NF-D5 v1 —
    // the terminal.manage split is the named upgrade).
    const requireSessionId = (params: unknown): string => {
      const parsed = TerminalSessionParams.safeParse(params);
      if (!parsed.success)
        throw new RpcCallError("PRECONDITION_FAILED", "expected { sessionId: string }", false);
      return parsed.data.sessionId;
    };
    // GT-5b: `list` REFUSES (UNAVAILABLE `unobserved`) until the first observed
    // snapshot applies rather than answering an empty floor it has not looked
    // at, and carries the observation it IS answering from — see the service.
    api.register("terminal.list", (): TerminalListResult => {
      const rows = terminals.list();
      const observation = terminals.observation();
      return { terminals: rows, ...(observation !== undefined ? { observation } : {}) };
    });
    // TP-S3/G23 — exact Ghosttea summaries for the routed runtime. This is not
    // a UI roster and not the mgmt observation: the decimal engine handle is a
    // transport identity and is why the separate read exists.
    api.register(
      "terminal.sessions",
      async (): Promise<TerminalRuntimeSessionsResult> => await terminals.runtimeSessions(),
    );
    api.register("terminal.get", (_ctx, params) => {
      const sessionId = requireSessionId(params);
      const info = terminals.get(sessionId);
      if (!info) throw new RpcCallError("NOT_FOUND", `no such terminal: ${sessionId}`, false);
      return info;
    });
    // D6: every mint is an audited grant, even while the credential inside is
    // the shared native service token (per-client tokens are the named
    // ghosttea upgrade).
    api.register("terminal.openTicket", async (ctx, params) => {
      const sessionId = requireSessionId(params);
      if (terminals.get(sessionId) === undefined)
        throw new RpcCallError("NOT_FOUND", `no such terminal: ${sessionId}`, false);
      return await audit.required(
        ctx,
        { action: "terminal.ticket.mint", target: { kind: "terminal", id: sessionId } },
        // TC-S3: the session's OWN cell, via the inventory's `cell` tag — a
        // ticket minted from any other cell would be a credential for a socket
        // that has never heard of this session. TP-S1: the TPv3 route + grants
        // ride beside the legacy trio when the cell carries a grant key; the
        // caller's principal is what the grants are bound to (never UI claims).
        () => terminals.openTicket(ctx.principal, sessionId),
        () => ({ outcome: "succeeded" }),
      );
    });
    // TP-S1 — renew a session's attach grant: a CAS on the generation the
    // caller holds, idempotent by requestId. Audited like a mint — it IS one.
    api.register("terminal.renewAttach", async (ctx, params) => {
      const parsed = TerminalRenewAttachParams.safeParse(params ?? {});
      if (!parsed.success)
        throw new RpcCallError(
          "PRECONDITION_FAILED",
          "malformed terminal.renewAttach params",
          false,
        );
      if (terminals.get(parsed.data.sessionId) === undefined)
        throw new RpcCallError("NOT_FOUND", `no such terminal: ${parsed.data.sessionId}`, false);
      return await audit.required(
        ctx,
        {
          action: "terminal.attach.renew",
          target: { kind: "terminal", id: parsed.data.sessionId },
          attrs: {
            expectGeneration: parsed.data.expectGeneration,
            requestId: parsed.data.requestId,
          },
        },
        () => terminals.renewAttach(ctx.principal, parsed.data),
        () => ({ outcome: "succeeded" }),
      );
    });
    // TP-D4 — the UI's roster: ids, class, health, title and NO placement
    // (terminal.list stays the transport-facing inventory). Refuses before the
    // first observation exactly like list.
    api.register("terminal.roster", (): TerminalRosterResult => terminals.roster());
    // GT-D10's `terminal.connectTicket` RETIRED at TP-S3e with the bridge it
    // fed: the routed transport is per SESSION (openTicket/create); there is
    // no sessionless credential to mint.
    // GT-1: create ALSO mints. openTicket gates on the observed inventory,
    // which is a mgmt round trip behind the spawn — so create-then-ticket
    // raced a session that certainly existed (GT-0's measured 62-117ms window).
    // create knows its own session, so the mint here waits on nothing. It is
    // still a privilege grant and still gets its own attempt-before-effect
    // record, nested inside the create it belongs to: two audited actions,
    // one call, no silent credential.
    api.register("terminal.create", async (ctx, params) => {
      const parsed = TerminalCreateParams.safeParse(params ?? {});
      if (!parsed.success)
        throw new RpcCallError("PRECONDITION_FAILED", "malformed terminal.create params", false);
      // GT-5b: the mint is SEQUENCED AFTER the create's own outcome, not nested
      // inside its effect. Nested, a mint that threw (the floor died between
      // the spawn and the mint; the audit ledger degraded) made the outer
      // record say `session.create → failed` for a PTY that exists — a lie in
      // the one log whose whole job is to be the record of what happened, and
      // it named no session, so the birth was unrecoverable from the log.
      //
      // `audit.required`'s `rollbackOnOutcomeFailure` does NOT cover this, the
      // review's suggested fix notwithstanding: it fires only when the OUTCOME
      // APPEND fails on a successful effect (`audit-service.ts:360-372`), never
      // when the effect itself throws. Ordering is the fix that fits.
      //
      // The session is NOT terminated when the mint fails. It exists, the log
      // now names it, `terminal.list` shows it and `openTicket` can mint for it
      // later — killing a live PTY because a credential grant hiccuped destroys
      // the user's work to tidy our bookkeeping.
      const created = await audit.required(
        ctx,
        {
          // the session id does not exist until the effect runs; the outcome
          // record carries it (attempt-before-effect, honest both ways).
          // `title` has no upstream spawn option — the audit attr IS where
          // "accepted, recorded, unapplied" becomes true (NF-6).
          action: "terminal.session.create",
          target: { kind: "terminal", id: "pending" },
          attrs: {
            ...(parsed.data.shell !== undefined ? { shell: parsed.data.shell } : {}),
            ...(parsed.data.cwd !== undefined ? { cwd: parsed.data.cwd } : {}),
            ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
            // TC-D6(c) — accepted + recorded; enforcement pends the upstream
            // scrollback option (terminal-service.ts says why, honestly).
            ...(parsed.data.workloadClass !== undefined
              ? { workloadClass: parsed.data.workloadClass }
              : {}),
          },
        },
        async () => await terminals.create(parsed.data),
        // no `ticketMinted` here any more: nothing has been minted yet, and an
        // attr claiming otherwise was true only because the nesting made it so.
        (result) => ({ outcome: "succeeded", attrs: { sessionId: result.sessionId } }),
      );
      const opened = await audit.required(
        ctx,
        { action: "terminal.ticket.mint", target: { kind: "terminal", id: created.sessionId } },
        // TC-S3: from the cell the session actually LANDED on, which create
        // reports — a workloadClass:"agent" birth lands on the agent cell, and
        // the inventory that would otherwise say so is a mgmt round trip behind
        // (GT-1's window, the reason this mint exists at all).
        // TP-S1: the legacy `ticket` beside the spread route + grants, bound
        // to the caller's principal.
        () => terminals.createOpenResult(ctx.principal, created),
        () => ({ outcome: "succeeded" }),
      );
      return opened satisfies TerminalCreateOpenResponse;
    });
    api.register("terminal.terminate", async (ctx, params) => {
      const sessionId = requireSessionId(params);
      // audit.required records outcome "failed" when the effect throws, so the
      // NF-6 UNAVAILABLE paths (dead floor mid-terminate) land honestly — the
      // old success-only record was half the finding.
      return await audit.required(
        ctx,
        {
          action: "terminal.session.terminate",
          target: { kind: "terminal", id: sessionId },
        },
        () => terminals.terminate(sessionId),
        (result) => ({ outcome: "succeeded", attrs: { terminated: result.terminated } }),
      );
    });

    // GT-3 rider — the `config.ghostty` surface (scope settings.manage, the
    // trusted desktop shell). Reading is a read; WRITING changes how every
    // terminal on this device is configured, including sessions this caller
    // never opened, so it is an audited act like create and terminate. The
    // attrs record the shape of the edit (bytes, the revision it replaced) and
    // never its CONTENTS — a config file can hold a shell path or a font name,
    // and the audit log is not the place to copy a user's file into.
    api.register("terminal.config.read", async (_ctx, params): Promise<TerminalConfigDocument> => {
      // connectTicket's reasoning (GT-5b): the declared shape is parsed.
      if (!TerminalConfigReadParams.safeParse(params ?? {}).success)
        throw new RpcCallError("PRECONDITION_FAILED", "expected an object or no params", false);
      return await terminals.readConfig();
    });
    api.register("terminal.config.write", async (ctx, params) => {
      const parsed = TerminalConfigWriteParams.safeParse(params);
      if (!parsed.success)
        throw new RpcCallError(
          "PRECONDITION_FAILED",
          "expected { text: string, revision: string }",
          false,
        );
      return await audit.required(
        ctx,
        {
          action: "terminal.config.write",
          target: { kind: "terminal", id: "config" },
          // BYTES, measured (GT-5b). `.length` counts UTF-16 code units, so an
          // attr named `bytes` under-reported every non-ASCII config — an emoji
          // in a comment counted 2 for 4 — and the file is written as UTF-8.
          attrs: {
            bytes: Buffer.byteLength(parsed.data.text, "utf8"),
            replaces: parsed.data.revision,
          },
        },
        async (): Promise<TerminalConfigWriteResult> =>
          await terminals.writeConfig(parsed.data.text, parsed.data.revision),
        (result) => ({
          outcome: "succeeded",
          // The effect landed either way; `ok` says whether the LOADER accepted
          // what landed, which is a different question and worth recording as
          // its own fact rather than collapsing into the outcome.
          attrs: {
            accepted: result.ok,
            effectiveChanged: result.effectiveChanged,
            diagnostics: result.diagnostics.length,
          },
        }),
      );
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
    const updateRetirements = new Map<string, ReturnType<TokenService["revokeByPlugin"]>>();
    const updateManager = new PluginUpdateManager({
      plugins,
      modules: pluginModules,
      serviceHost: () => serviceHost,
      retireOldAuthority: async (pluginId, updateId) => {
        const revoked = tokens.revokeByPlugin(pluginId);
        api.dropPluginConnections(pluginId);
        await processes.killPlugin(pluginId);
        endpoints.withdrawPlugin(pluginId);
        mcp.withdrawPlugin(pluginId);
        updateRetirements.set(updateId, revoked);
      },
      mintSourceLease: async ({ updateId, purpose, identity, record }) => {
        const scopes = projectPluginAuthority(
          "renderer",
          record.grantedCapabilities,
        ).capabilities.filter((capability): capability is Scope =>
          (SCOPES as readonly string[]).includes(capability),
        );
        const tokenId = tokens.reserveTokenId();
        const grant = await audit.requiredSystem(
          {
            action: "token.plugin_update_source.mint",
            target: { kind: "token", id: tokenId, parentId: record.id },
            attrs: {
              pluginId: record.id,
              updateId,
              purpose,
              participantId: identity.participantId,
              incarnation: identity.incarnation,
              manifestHash: record.manifestHash,
              grantGeneration: record.grantGeneration,
              scopeCount: scopes.length,
              ttlMs: LEASE_TTL_MS,
            },
          },
          () =>
            tokens.mint(scopes, `plugin:${record.id}:update:${purpose}`, {
              ttlMs: LEASE_TTL_MS,
              pluginId: record.id,
              tokenId,
            }),
          (minted) => ({
            attrs: {
              pluginId: record.id,
              updateId,
              purpose,
              grantId: minted.tokenId,
              scopeCount: minted.scopes.length,
              expiresAt: minted.expiresAt ?? Date.now() + LEASE_TTL_MS,
            },
          }),
          (minted) => {
            tokens.revoke(minted.tokenId);
          },
        );
        return {
          tokenId: grant.tokenId,
          token: grant.token,
          pluginId: record.id,
          expiresAt: grant.expiresAt ?? Date.now() + LEASE_TTL_MS,
        };
      },
      revokeSourceLease: async ({ tokenId, pluginId, updateId, purpose, reason }) => {
        const effect = async () => {
          const revoked = tokens.revoke(tokenId);
          const droppedConnections = api.dropTokenConnections(tokenId);
          if (reason === "candidate-failed") {
            await processes.killPlugin(pluginId);
            endpoints.withdrawPlugin(pluginId);
            mcp.withdrawPlugin(pluginId);
          }
          return { revoked, droppedConnections };
        };
        try {
          await audit.requiredSystem(
            {
              action: "token.plugin_update_source.revoke",
              target: { kind: "token", id: tokenId, parentId: pluginId },
              attrs: { pluginId, updateId, purpose, reason },
            },
            effect,
            (result) => ({
              outcome: result.revoked ? "succeeded" : "cancelled",
              ...(result.revoked ? {} : { reasonCode: "TOKEN_ALREADY_REVOKED" }),
              attrs: {
                pluginId,
                updateId,
                purpose,
                reason,
                droppedConnections: result.droppedConnections,
              },
            }),
          );
        } catch (error) {
          // The audit writer may fail, but token and authenticated-connection revocation are
          // unconditional safety effects. Candidate cleanup is idempotent as well.
          await effect();
          throw error;
        }
      },
      requestRendererReplacement: async ({ pluginId, updateId, phase, identity }) => {
        const result = await audit.requiredSystem(
          {
            action: "plugin.update.renderer_replacement_requested",
            target: {
              kind: "renderer",
              id: identity.participantId,
              parentId: pluginId,
            },
            attrs: {
              pluginId,
              updateId,
              phase,
              incarnation: identity.incarnation,
            },
          },
          async () =>
            await api.requestRendererReplacement({
              rendererParticipant: identity,
              reason: "plugin-update-deadline",
            }),
          (requested) => ({
            outcome: requested.requested ? "succeeded" : "cancelled",
            ...(requested.requested ? {} : { reasonCode: "RENDERER_GENERATION_NOT_FOUND" }),
            attrs: { pluginId, updateId, phase },
          }),
        );
        if (!result.requested) {
          throw new RpcCallError(
            "UNAVAILABLE",
            `${identity.participantId}: Electron does not own the requested renderer generation`,
            true,
          );
        }
      },
      ...(config.pluginUpdateDeadlines === undefined
        ? {}
        : { deadlines: config.pluginUpdateDeadlines }),
    });
    pluginUpdatesForCleanup = updateManager;
    runtimeDiagnostics = new PluginRuntimeDiagnostics({
      plugins,
      serviceDiagnostic: (pluginId) => serviceHost?.diagnostic(pluginId) ?? null,
      existingCoordinatorFor: (pluginId) => updateManager.existingCoordinatorFor(pluginId),
    });
    runtimeDiagnostics.register(api);
    updateManager.subscribeDiagnostics(() => runtimeDiagnostics.notifyHostChanged());
    updateManager.subscribeRendererRetirements((pluginId, identity) =>
      runtimeDiagnostics.retireRenderer(pluginId, identity),
    );
    new PluginUpdateTransport({
      coordinatorFor: (pluginId) => updateManager.coordinatorFor(pluginId),
      acquireSource: async (request) => await updateManager.acquireSource(request),
      releaseSource: async (request) => await updateManager.releaseSource(request),
      retireRenderer: async (pluginId, identity) =>
        await updateManager.retireRenderer(pluginId, identity),
    }).register(api);
    // P8b (ESP §8.4) — approved module URLs. The safe projection carries no
    // filesystem path, so it rides the same principals as the registry snapshot
    // the renderer already holds.
    api.register("plugins.modules", async () => await pluginModules.modules());
    // …and its privileged twin. `plugins.serve` is a scope the renderer never
    // holds, and the shell-main gate is on top of it: this is the one method
    // that returns a path, so scope is necessary and not sufficient (§11.2's
    // rule, applied where it matters most).
    api.register("plugins.resolveModule", async (ctx, params) => {
      const parsed = PluginsResolveModuleParams.safeParse(params);
      if (!parsed.success)
        throw new RpcCallError("PRECONDITION_FAILED", "expected { token }", false);
      if (ctx.transport !== "ws-loopback" || ctx.principal.kind !== "shell-main")
        throw new RpcCallError(
          "FORBIDDEN_SCOPE",
          "module bytes resolve only for the local shell principal (ESP §8.4)",
          false,
        );
      const resolution = await pluginModules.resolve(parsed.data.token);
      // A token from a superseded generation is indistinguishable from one that
      // never existed — the caller learns "not authorized now", nothing more.
      if (resolution === undefined)
        throw new RpcCallError("NOT_FOUND", "no such module token", false);
      return resolution;
    });
    api.register("plugins.openRendererSession", async (ctx, params) => {
      const parsed = PluginsOpenRendererSessionParams.safeParse(params);
      if (!parsed.success)
        throw new RpcCallError(
          "PRECONDITION_FAILED",
          "expected { pluginId, manifestHash?, grantGeneration? }",
          false,
        );
      if (
        ctx.transport !== "ws-loopback" ||
        !(
          ctx.principal.kind === "shell-main" ||
          (ctx.principal.kind === "local-token" && ctx.clientKind === "renderer")
        )
      )
        throw new RpcCallError(
          "FORBIDDEN_SCOPE",
          "renderer sessions open only for local renderer/shell principals (§11.2)",
          false,
        );
      const currentRecord = () => {
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
        if (
          parsed.data.grantGeneration !== undefined &&
          parsed.data.grantGeneration !== record.grantGeneration
        )
          throw new RpcCallError("CONFLICT", `grant generation mismatch for ${record.id}`, false, {
            pluginKind: "PLUGIN_GRANT_GENERATION_MISMATCH",
            expected: parsed.data.grantGeneration,
            actual: record.grantGeneration,
          });
        return record;
      };
      const record = currentRecord();
      // P4: the lease is a PLUGIN-BOUND grant — hello with it derives the
      // {kind:"plugin"} principal, so custom-capability gates bind (D20).
      const tokenId = tokens.reserveTokenId();
      const minted = await audit.required(
        ctx,
        {
          action: "token.plugin_renderer.mint",
          target: { kind: "token", id: tokenId, parentId: record.id },
          attrs: {
            pluginId: record.id,
            manifestHash: record.manifestHash,
            grantGeneration: record.grantGeneration,
            ttlMs: LEASE_TTL_MS,
          },
        },
        () => {
          // The mandatory audit attempt above is asynchronous. Recheck the caller's observation
          // at the exact mint edge so a grant/artifact move during that write cannot mint from a
          // record the caller did not ask for.
          const observed = currentRecord();
          const scopes = projectPluginAuthority(
            "renderer",
            observed.grantedCapabilities,
          ).capabilities.filter((capability): capability is Scope =>
            (SCOPES as readonly string[]).includes(capability),
          );
          return {
            grant: tokens.mint(scopes, `plugin:${observed.id}`, {
              ttlMs: LEASE_TTL_MS,
              pluginId: observed.id,
              tokenId,
            }),
            observed,
          };
        },
        ({ grant, observed }) => ({
          attrs: {
            grantId: grant.tokenId,
            pluginId: observed.id,
            grantGeneration: observed.grantGeneration,
            scopeCount: grant.scopes.length,
            expiresAt: grant.expiresAt ?? Date.now() + LEASE_TTL_MS,
          },
        }),
        ({ grant }) => {
          tokens.revoke(grant.tokenId);
        },
      );
      const result: PluginsOpenRendererSessionResult = {
        token: minted.grant.token,
        scopes: minted.grant.scopes,
        pluginId: minted.observed.id,
        grantGeneration: minted.observed.grantGeneration,
        expiresAt: minted.grant.expiresAt ?? Date.now() + LEASE_TTL_MS,
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
      if (principal.kind === "local-token" || principal.kind === "shell-main") {
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
          const existing = parsed.data.id === undefined ? undefined : plugins.get(parsed.data.id);
          // Disabled installs have no runtime authority to coordinate. First installs and this
          // code-absent fast path keep the compatibility wrapper; every enabled replacement widens
          // the pointer gap only inside the exact participant barrier.
          if (existing === undefined || !existing.enabled) {
            const { id } = await installer.install(parsed.data);
            const record = plugins.get(id);
            if (record?.enabled === true && record.service !== "none")
              void serviceHost?.restartFresh(id).catch(() => undefined);
            if (record !== undefined) void reconciler?.publish(record, "install");
            return { record: record ?? { id }, revoked: { count: 0, tokenIds: [] } };
          }

          const prepared = await installer.prepare(parsed.data);
          let started: ReturnType<PluginUpdateManager["beginRegistryUpdate"]>;
          try {
            started = updateManager.beginRegistryUpdate({
              runtime: prepared.runtime,
              commitArtifact: async (commitEpoch) => {
                await installer.commit(prepared, commitEpoch);
              },
              discardArtifact: async () => {
                await installer.discard(prepared);
              },
            });
          } catch (error) {
            await installer.discard(prepared).catch(() => false);
            throw error;
          }
          let outcome: Awaited<typeof started.completion>;
          try {
            outcome = await started.completion;
          } catch (error) {
            updateRetirements.delete(started.updateId);
            throw error;
          }
          const revoked = updateRetirements.get(started.updateId) ?? {
            count: 0,
            tokenIds: [],
          };
          updateRetirements.delete(started.updateId);
          if (outcome.outcome !== "committed") {
            throw new RpcCallError(
              "PRECONDITION_FAILED",
              `${prepared.id}: candidate failed; retained old recovered`,
              true,
              { pluginKind: "PLUGIN_ACTIVATION_FAILED", updateId: started.updateId },
            );
          }
          const id = prepared.id;
          const record = plugins.get(id);
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
          runtimeDiagnostics.retirePlugin(parsed.data.id);
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
    // D29′ app-section preferences. The method registry supplies the
    // settings.manage capability gate; this additional caller-kind check is
    // restrict-only, keeping a copied token from turning a plugin worker or
    // debug client into a desktop settings principal.
    const requireAppPreferencesCaller = (ctx: {
      principal: { kind: string };
      clientKind?: string;
    }): void => {
      if (
        !(
          ctx.principal.kind === "shell-main" ||
          (ctx.principal.kind === "local-token" && ctx.clientKind === "renderer")
        )
      ) {
        throw new RpcCallError(
          "FORBIDDEN_SCOPE",
          "app preferences require a trusted desktop caller",
          false,
        );
      }
    };
    // UA-3 — the user's tailscale link (spec §7.1): trusted-desktop posture,
    // identical to the app-preference rows below. Unlink is identity
    // retirement — audited attempt-before-effect, and there is no rollback:
    // a retired node key cannot be un-retired, only relinked fresh.
    api.register("user.link.get", (ctx) => {
      requireAppPreferencesCaller(ctx);
      return links.status();
    });
    api.registerSubscription("user.link.subscribe", (ctx, _params, emit) => {
      requireAppPreferencesCaller(ctx);
      const fn = (status: unknown) => emit(status);
      links.on("changed", fn);
      return { snapshot: links.status(), dispose: () => links.off("changed", fn) };
    });
    api.register("user.link.unlink", async (ctx) => {
      requireAppPreferencesCaller(ctx);
      return audit.requiredSystem(
        {
          action: "user.link.unlink",
          target: { kind: "mesh", id: "tailnet-link" },
        },
        () => links.unlink(),
        (result) => ({ attrs: { retired: result.retired } }),
      );
    });
    const appPreferencesSnapshot = async () =>
      effectiveAppPreferences(await settingsDoc.appValues());
    api.register("storage.appPreferences.get", async (ctx, _params) => {
      requireAppPreferencesCaller(ctx);
      return appPreferencesSnapshot();
    });
    api.register("storage.appPreferences.set", async (ctx, params) => {
      requireAppPreferencesCaller(ctx);
      const parsed = AppPreferenceSetParams.safeParse(params);
      if (!parsed.success) {
        throw new RpcCallError(
          "PRECONDITION_FAILED",
          "expected { key: desktop.showTray|desktop.backgroundShell (boolean) | mesh.syncPosture (automatic|opt-in) }",
          false,
        );
      }
      await settingsDoc.setAppValue(
        parsed.data.key,
        parsed.data.value,
        ctx.clientKind === "shell-main" ? "shell" : "pane",
      );
      return { ok: true };
    });
    api.registerSubscription("storage.appPreferences.subscribe", async (ctx, _params, emit) => {
      requireAppPreferencesCaller(ctx);
      let disposed = false;
      const onChanged = (event: { section: string; pluginId?: string }) => {
        if (
          event.section === "app" ||
          (event.section === "settings" && event.pluginId === undefined)
        ) {
          void appPreferencesSnapshot().then(
            (snapshot) => {
              if (!disposed) emit(snapshot);
            },
            (error) =>
              logger.error(
                "fieldd.app_preferences.snapshot_failed",
                "The app preference stream could not refresh its snapshot",
                error,
              ),
          );
        }
      };
      settingsDoc.on("changed", onChanged);
      return {
        snapshot: await appPreferencesSnapshot(),
        dispose: () => {
          disposed = true;
          settingsDoc.off("changed", onChanged);
        },
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
      if (
        (ctx.principal.kind === "local-token" || ctx.principal.kind === "shell-main") &&
        scopes.includes("plugins.manage")
      )
        return null;
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
      if (
        (ctx.principal.kind !== "local-token" && ctx.principal.kind !== "shell-main") ||
        !scopes.includes("plugins.manage")
      )
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
    // decision, then the LIVE cascade — old leases die at the mint table and
    // plugin connections sever. The service controller replaces only when its
    // projected authority changes; observation-only movement rotates its lease. --
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
          const previous = plugins.get(id);
          const { record, changed } = await plugins.setGrant(id, capability, granted);
          let revoked = { count: 0, tokenIds: [] as string[] };
          if (changed) {
            revoked = tokens.revokeByPlugin(id);
            api.dropPluginConnections(id);
            const priorServiceAuthority =
              previous === undefined
                ? undefined
                : projectPluginAuthority("service", previous.grantedCapabilities).fingerprint;
            const nextServiceAuthority = projectPluginAuthority(
              "service",
              record.grantedCapabilities,
            ).fingerprint;
            const serviceAuthorityChanged = priorServiceAuthority !== nextServiceAuthority;
            const serviceReconcile = serviceHost?.start(id).catch((error) => {
              logger
                .child({ component: "plugin.service.host" })
                .error(
                  "fieldd.plugin_service.grant_reconcile_failed",
                  "Plugin service could not converge after a grant change",
                  error,
                  { pluginId: id, grantGeneration: record.grantGeneration },
                );
            });
            if (serviceAuthorityChanged) {
              await processes.killPlugin(id);
              endpoints.withdrawPlugin(id); // §15.4 — service-owned endpoints withdraw
            }
            mcp.refreshContributed();
            await serviceReconcile;
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
    // §16.5 / PRC-2 — durable disable enters the SAME synchronous host-owned route drain as
    // reload/revocation/shutdown. The command path then joins it for worker teardown.
    plugins.on("changed", () => {
      for (const record of plugins.list()) if (!record.enabled) serviceHost?.beginDrain(record.id);
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

    // AH-1 — the artifact serving foundation. Constructed HERE (before the supersession
    // closure below references it — a superseding takeover can fire before
    // bootstrap's tail runs); its serves are declared later via start(), once
    // the control port is bound. The bridge reads controlPort lazily, and the
    // product serve's secret never enters the service.
    // UA-4 — the serve-allow belt (UA-D13): the product serve carries
    // allow:[login] so the sidecar's verified-login glob refuses guests before
    // the upgrade ever reaches fieldd (the door's comparison stays the
    // suspenders). Login is read live at declare time; a capture or unlink
    // mid-uptime re-issues the LAST declared set with the product spec
    // rebuilt — setServes replaces the whole desired set, so the remembered
    // artifact specs ride along intact (mesh-client C3). Artifact serves keep
    // their own per-artifact allow semantics — those are the deliberate guest
    // surfaces (spec §7.3).
    const serveLog = logger.child({ component: "mesh.serves" });
    const linkedLogin = (): string | null => links.status().link?.login ?? null;
    const productServeSpec = (): ServeSpec => {
      const login = linkedLogin();
      return {
        name: "product",
        target: { kind: "port", port: controlPort },
        tls: false,
        pathSecret: servePathSecret,
        // the sidecar matches with Go path.Match, lowercased both sides — a
        // login is a LITERAL here, so its glob metacharacters are escaped
        ...(login !== null ? { allow: [login.replace(/[\\*?[]/g, (c) => `\\${c}`)] } : {}),
      };
    };
    let lastArtifactServeSpecs: ServeSpec[] | null = null;
    let lastServeAllowLogin: string | null = null;
    links.on("changed", () => {
      const login = linkedLogin();
      if (lastArtifactServeSpecs === null || login === lastServeAllowLogin) return;
      lastServeAllowLogin = login;
      const specs = [productServeSpec(), ...lastArtifactServeSpecs];
      void (async () => {
        // the sidecar has no upsert (same-id add = PROXY_EXISTS) and the
        // reconcile SKIPS live serveIds — re-gating a live serve is
        // remove-then-add, or the old gate keeps running while the reported
        // state adopts the new spec (the mesh-client skip is recorded C3
        // debt; the brief serve blink here is once per link transition)
        await mesh.removeServe("product").catch(() => {});
        await mesh.setServes(specs);
      })().catch((error: unknown) => {
        // mesh down/degraded: the next declare re-runs the reconcile; the
        // door's comparison still refuses guests meanwhile
        serveLog.debug("fieldd.serve.allow_refresh_deferred", "product allow refresh deferred", {
          error: String(error),
        });
      });
    });
    const artifacts = new ArtifactService({
      dataDir: config.dataDir,
      bridge: {
        declare: async (specs) => {
          lastArtifactServeSpecs = specs;
          lastServeAllowLogin = linkedLogin();
          await mesh.setServes([productServeSpec(), ...specs]);
        },
        remove: async (serveId) => await mesh.removeServe(serveId),
        states: () => mesh.serves(),
        observed: async () => await mesh.observedServes(),
        on: (cb) => {
          mesh.on("serves-changed", cb);
          return () => mesh.off("serves-changed", cb);
        },
      },
      catalog: {
        bootId,
        currentDeviceId: () => devices.currentDeviceId(),
        devices: () => devices.list(),
        subscribe: async (cb) => await mesh.subscribeStoreManaged(STORES.ARTIFACTS, cb),
        publish: async (slice) => {
          await mesh.setSlice(STORES.ARTIFACTS, slice);
        },
        onMeshWake: (cb) => {
          // On a first transition from meshless local identity, the catalog
          // must not publish until DeviceService has adopted the real store
          // owner. Its sync queue is the ordering barrier.
          const wake = () => void devices.sync().then(cb, cb);
          mesh.on("reconciled", wake);
          return () => mesh.off("reconciled", wake);
        },
        onDevicesChanged: (cb) => {
          devices.on("changed", cb);
          return () => devices.off("changed", cb);
        },
      },
      logger: logger.child({ component: "artifacts" }),
      capturePreviewAvailable: () => api.artifactPreviewCaptureAvailable(),
      capturePreview: async (params) =>
        await audit.requiredSystem(
          {
            action: "artifact.preview.capture",
            target: { kind: "artifact", id: params.artifactId },
          },
          async () => await api.captureArtifactPreview(params),
          () => ({ outcome: "succeeded" }),
        ),
    });
    artifactsRef = artifacts;

    // SUPERSEDED = another fieldd owns the native plane now; this one is done.
    // The flag also closes the small gap where takeover happens before this
    // listener is attached or while ProductApi is still binding its port.
    let fatalReason: string | null = null;
    const stopForSupersession = () => {
      if (fatalReason) return;
      fatalReason = "superseded: another fieldd took over this device's native plane";
      supersessionReported = true;
      logger.fatal(
        "fieldd.lifecycle.superseded",
        "fieldd was superseded by another native-plane owner",
      );
      // Refuse new work immediately, then preserve teardown audit ordering:
      // service leases revoke before the audit writer and logger close.
      supervisor.stop(); // the new owner supervises the plane now, not us
      api.close();
      docLane.close();
      const reason = fatalReason;
      void (async () => {
        await Promise.allSettled([
          updateManager.dispose(),
          serviceHost?.stopAll() ?? Promise.resolve(),
          processes.stopAll(),
        ]);
        runtimeDiagnostics.dispose();
        detachHealthSources?.();
        links.stop();
        await presenceRooms?.stop();
        docSync?.stop();
        laneLink.close();
        docs.dispose();
        const artifactDrain = artifacts.dispose();
        federatedSubs.dispose(); // before peers: a dying link must not trigger recovery
        peers.dispose();
        devices.dispose();
        terminals.dispose();
        services.dispose();
        settings.dispose();
        plugins.dispose();
        diagnosticsService.dispose();
        native.close();
        await artifactDrain;
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
      // Bind is intentionally included in the same rollback scope as the
      // post-bind service initialization. A migration/storage failure may not
      // leave a zombie ProductAPI listener behind.
      await devices.sync();
      await artifacts.start();
      if (fatalReason || native.superseded || native.closed)
        throw new Error(fatalReason ?? "native link closed during service initialization");
    } catch (e) {
      detachHealthSources?.();
      api.close();
      docLane.close(); // release the lane port before the outer rollback runs
      await updateManager.dispose();
      runtimeDiagnostics.dispose();
      await presenceRooms?.stop();
      docSync?.stop();
      laneLink.close();
      docs.dispose();
      const artifactDrain = artifacts.dispose();
      federatedSubs.dispose();
      peers.dispose();
      devices.dispose();
      terminals.dispose();
      services.dispose();
      settings.dispose();
      plugins.dispose();
      diagnosticsService.dispose();
      native.close();
      await artifactDrain;
      throw e;
    }

    // C3 — the first real serve (design-00 §4.1 / foundations §2.9): fieldd's
    // own product API over the tailnet, plain-HTTP-in-WireGuard, gated by the
    // secret route the ProductApi's tailnet door verifies. AH-1 — the serve
    // SET is now composed: ArtifactService (constructed above, before the
    // supersession closure could ever reach it) owns the artifact serves, the
    // daemon prepends the product serve, and one declarative set replays on
    // every native (re)connect. Initialization is awaited so a one-time C6
    // migration is durable before the product methods become callable; mesh
    // disabled still resolves promptly into honest `starting` states.
    // AH-2 binds every public slice to the durable mesh device id. Resolve and
    // publish DeviceService first; mesh-down still resolves into its stable
    // local fallback and a later reconnect moves/re-publishes the self slice.
    detachArtifactHealth = artifacts.onChanged(() => emitHealth());
    api.register("artifact.publish", async (ctx, params) => {
      const parsed = ArtifactPublishParams.safeParse(params);
      if (!parsed.success)
        throw new RpcCallError(
          "PRECONDITION_FAILED",
          "expected artifactId/title/source (or the one-window legacy name/target shape)",
          false,
          { issue: parsed.error.issues[0]?.message },
        );
      const v2 = ArtifactPublishV2Params.safeParse(parsed.data);
      const legacy = v2.success ? null : LegacyArtifactPublishParams.parse(parsed.data);
      const targetId = v2.success ? v2.data.artifactId : legacy!.name;
      const kind = v2.success ? v2.data.source.kind : legacy!.target.kind;
      return await audit.required(
        ctx,
        {
          action: "artifact.publish",
          target: { kind: "artifact", id: targetId },
          attrs: { kind },
        },
        () => artifacts.publish(parsed.data),
        (status) => ({
          outcome: "succeeded",
          attrs: { artifactId: status.artifactId, status: status.status },
        }),
      );
    });
    api.register("artifact.update", async (ctx, params) => {
      const parsed = ArtifactUpdateParams.safeParse(params);
      if (!parsed.success)
        throw new RpcCallError("PRECONDITION_FAILED", "malformed artifact.update params", false, {
          issue: parsed.error.issues[0]?.message,
        });
      return await audit.required(
        ctx,
        { action: "artifact.update", target: { kind: "artifact", id: parsed.data.artifactId } },
        () => artifacts.update(parsed.data),
        (status) => ({ outcome: "succeeded", attrs: { status: status.status } }),
      );
    });
    api.register("artifact.unpublish", async (ctx, params) => {
      const parsed = ArtifactUnpublishParams.safeParse(params);
      if (!parsed.success)
        throw new RpcCallError(
          "PRECONDITION_FAILED",
          "expected { artifactId } (or one-window legacy { name })",
          false,
        );
      const targetId =
        typeof parsed.data.artifactId === "string"
          ? parsed.data.artifactId
          : String(parsed.data.name);
      return await audit.required(
        ctx,
        { action: "artifact.unpublish", target: { kind: "artifact", id: targetId } },
        () => artifacts.unpublish(parsed.data),
        (result) => ({
          outcome: result.removed ? "succeeded" : "cancelled",
          ...(!result.removed ? { reasonCode: "ARTIFACT_NOT_FOUND" } : {}),
        }),
      );
    });
    api.register("artifact.refreshPreview", (_ctx, params) => {
      const parsed = ArtifactRefreshPreviewParams.safeParse(params);
      if (!parsed.success)
        throw new RpcCallError("PRECONDITION_FAILED", "expected { artifactId: ULID }", false);
      return artifacts.refreshPreview(parsed.data.artifactId);
    });
    api.register("artifact.list", () => ({ artifacts: artifacts.artifacts() }));
    api.registerSubscription("artifact.subscribe", (_ctx, _params, emit) => {
      const off = artifacts.onCatalogChanged((catalog) => emit(catalog));
      return { snapshot: artifacts.artifacts(), dispose: off };
    });
    mesh.on("reconciled", emitHealth);
    mesh.on("serves-changed", emitHealth);

    // -- ServiceHost (PLUG-P4, §14.2/§18): workers for service entries --
    serviceHost = new ServiceHost({
      registry: services,
      plugins,
      tokens,
      controlPort: () => controlPort,
      deviceId: () => devices.currentDeviceId(),
      ...(config.serviceHarnessPath !== undefined
        ? { harnessPath: config.serviceHarnessPath }
        : {}),
      mintServiceLease: async (
        pluginId: string,
        _scopes: Scope[],
        observation: ServiceLeaseObservation,
      ) => {
        const currentScopes = (): Scope[] => {
          const record =
            observation.updateId === undefined
              ? plugins.get(pluginId)
              : updateManager.serviceCandidateRecord(pluginId, observation.updateId);
          const authority =
            record === undefined
              ? undefined
              : projectPluginAuthority("service", record.grantedCapabilities);
          if (
            record === undefined ||
            !record.enabled ||
            record.installRevision !== observation.installRevision ||
            record.manifestHash !== observation.manifestHash ||
            record.grantGeneration !== observation.grantGeneration ||
            authority?.fingerprint !== observation.authorityFingerprint
          )
            throw new RpcCallError(
              "CONFLICT",
              `service lease observation superseded for ${pluginId}`,
              false,
              { pluginKind: "PLUGIN_GRANT_GENERATION_MISMATCH" },
            );
          return authority.capabilities.filter((capability): capability is Scope =>
            (SCOPES as readonly string[]).includes(capability),
          );
        };
        const scopes = currentScopes();
        const tokenId = tokens.reserveTokenId();
        return await audit.requiredSystem(
          {
            action: "token.plugin_service.mint",
            target: { kind: "token", id: tokenId, parentId: pluginId },
            attrs: { pluginId, scopeCount: scopes.length },
          },
          () =>
            tokens.mint(currentScopes(), `plugin:${pluginId}:service`, {
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
      onDiagnosticsChanged: () => runtimeDiagnostics.notifyHostChanged(),
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
    const runDir = join(config.dataDir, ...LAYOUT.FIELDD_RUN_DIR);
    mkdirSync(runDir, { recursive: true });
    const shellTokenId = tokens.reserveTokenId();
    const shellGrant = await audit.requiredSystem(
      {
        action: "token.shell.mint",
        target: { kind: "token", id: shellTokenId },
        attrs: { scopeCount: SCOPES.length },
      },
      () =>
        tokens.mint([...SCOPES], "shell", {
          tokenId: shellTokenId,
          shellMain: true,
        }),
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
    const tokenPath = join(config.dataDir, ...LAYOUT.SHELL_TOKEN);
    const productPath = join(config.dataDir, ...LAYOUT.PRODUCT_JSON);
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
          buildId: config.buildId ?? null,
          userId: config.userId ?? null,
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
          supervisor.stop(); // stop watching FIRST: a teardown is not a wedge
          await updateManager.dispose();
          await serviceHost?.stopAll(); // §18.6 — service deactivation before the API falls
          runtimeDiagnostics.dispose();
          await processes.stopAll(); // §17.1 — children die no later than fieldd shutdown
          detachHealthSources?.();
          endpoints.dispose();
          mcp.dispose();
          await settingsDoc.dispose(); // D29′ — the doc's writes are already durable
          api.close();
          docLane.close();
          await presenceRooms?.stop();
          docSync?.stop();
          laneLink.close();
          docs.dispose();
          const artifactDrain = artifacts.dispose();
          federatedSubs.dispose(); // before peers: a dying link must not trigger recovery
          peers.dispose();
          devices.dispose();
          // The fatal and rollback ladders always dropped the terminal control
          // client; this one did not, so a cleanly stopping fieldd left its
          // socket to the floor open and made the floor read a clean shutdown
          // as an abrupt disconnect (found by GT-1's fake-floor test, which
          // hung waiting for the connection fieldd never closed).
          terminals.dispose();
          services.dispose();
          settings.dispose();
          plugins.dispose();
          diagnosticsService.dispose();
          native.close();
          await artifactDrain;
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
      nativeSupervisor: supervisor,
      stop,
      onShutdownRequest(callback) {
        shutdownRequested = callback;
      },
    };
  } catch (e) {
    detachHealthSources?.();
    diagnostics?.dispose();
    await pluginUpdatesForCleanup?.dispose();
    native.close(); // rollback: release the mgmt client slot
    // The earliest supersession window, which the `stopForSupersession` listener
    // is not yet in scope to see: a takeover that lands while the services are
    // still being built kills the mgmt socket under whatever request is in
    // flight, so the boot fails with that request's transport error — "not
    // connected", a closed link — for the ONE state the spawner must not treat
    // as a crash to retry. Named here, with the same reason string and the same
    // onFatal contract the listener uses, and only when nothing has reported it
    // already (that path calls the hook from its own teardown).
    const supersededDuringBoot = native.superseded && !supersessionReported;
    logger.fatal("fieldd.lifecycle.bootstrap_failed", "fieldd bootstrap failed", e);
    await Promise.allSettled([audit.close(), closeLogging()]);
    if (supersededDuringBoot) {
      const reason = "superseded: another fieldd took over this device's native plane";
      config.onFatal?.(reason);
      throw new Error(reason, { cause: e });
    }
    throw e;
  }
}

/** TC-D6(a) — Node's diagnostic report is the only stdlib window onto rlimits.
 * "unlimited" (or an unreadable report) answers null: no pressure claim. */
function readFdSoftLimit(): number | null {
  try {
    const report = process.report?.getReport() as unknown as
      | { userLimits?: { open_files?: { soft?: number | string } } }
      | undefined;
    const soft = report?.userLimits?.open_files?.soft;
    return typeof soft === "number" ? soft : null;
  } catch {
    return null;
  }
}
