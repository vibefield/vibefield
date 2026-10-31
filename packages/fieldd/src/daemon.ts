import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
  AGENT_CATALOG,
  AGENT_FIELD,
  AgentCatalogParams,
  AgentInterruptParams,
  type AgentLastRunForgetResult,
  type AgentLastRunResult,
  AgentModelsParams,
  AgentRecordedLanesParams,
  AgentReportShownParams,
  type AgentReportShownResult,
  AgentResumeParams,
  AgentSpawnParams,
  AgentSubscribeParams,
  AgentsExtensionsActParams,
  AgentsExtensionsAddParams,
  AgentsExtensionsAddSkillParams,
  AgentsExtensionsCatalogParams,
  AgentsExtensionsCheckParams,
  AgentsExtensionsListParams,
  AgentsExtensionsPlanParams,
  AgentsExtensionsPlanSkillParams,
  AgentsExtensionsPlanSourceParams,
  AgentsExtensionsSignInParams,
  AgentsExtensionsSubscribeParams,
  AgentsExtensionsTerminalParams,
  AgentsInstallsParams,
  AgentsProfileSetsCreateParams,
  AgentsProfileSetsDeleteParams,
  AgentsProfileSetsDiscardParams,
  AgentsProfileSetsListParams,
  AgentsProfileSetsRevealParams,
  AgentsProfileSetsUpdateParams,
  AgentsProfilesCreateParams,
  AgentsProfilesDeleteParams,
  AgentsProfilesListParams,
  AgentsProfilesLoginParams,
  AgentsProfilesVerifyParams,
  AgentsReleasesParams,
  AgentsRevealParams,
  AgentsSetActiveParams,
  AgentsUpdateParams,
  AgentsUpdateStopParams,
  AgentsUsageParams,
  AppPreferenceSetParams,
  ArtifactPublishParams,
  ArtifactPublishV2Params,
  ArtifactRefreshPreviewParams,
  ArtifactUnpublishParams,
  ArtifactUpdateParams,
  appVersionOfBuildId,
  type CallerContext,
  CONTRACTS_VERSION,
  createAgentCatalogReaders,
  DEVICE_LIMITS,
  DeviceGetParams,
  DeviceRenameParams,
  DocCreateParams,
  DocDeleteParams,
  DocHoldersParams,
  type DocHoldersResult,
  type DocListResult,
  DocOpenParams,
  type DocOpenResult,
  DocRenameParams,
  DocSetSyncIntentParams,
  IdempotencyKey,
  INDEX_MESH,
  INDEX_RECENT_DEFAULT_LIMIT,
  INDEX_STATUS_FEED,
  INDEX_TIMELINE,
  IndexActivityParams,
  IndexCatalogSubscribeParams,
  IndexChangesSubscribeParams,
  IndexEnrollParams,
  IndexProjectDayParams,
  IndexProjectParams,
  IndexProjectsParams,
  IndexRecentParams,
  IndexRetireParams,
  IndexSearchParams,
  type IndexSearchResult,
  IndexSessionParams,
  IndexSessionSubscribeParams,
  IndexSessionsParams,
  type IndexStatus,
  IndexTimelineParams,
  isAgentResumeRun,
  KvDeleteParams,
  KvGetParams,
  KvListParams,
  KvSetParams,
  LAYOUT,
  LegacyArtifactPublishParams,
  LOG_STREAMS,
  METHODS,
  type MeshSyncPosture,
  MONITOR_AUDIENCE,
  NATIVE_SUPERVISION,
  type NativeHealth,
  type NativeLastExit,
  type NativeLinkHealth,
  type NativeLinkState,
  type NativeRestartReason,
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
  PORTS,
  PROJECT_DOORS,
  type Principal,
  ProcessStatParams,
  type ProcessSubEvent,
  type ProductInfo,
  ProjectFiguresDayParams,
  ProjectFiguresParams,
  ProjectGetParams,
  ProjectIntentParams,
  ProjectListParams,
  ProjectSessionsParams,
  ProjectSubscribeParams,
  RendererParticipantIdentity,
  type RestartScheduled,
  ROWS,
  SCOPES,
  type Scope,
  SETUP_STEPS,
  SettingsGetParams,
  SettingsResetParams,
  SettingsSetParams,
  SettingsSubscribeParams,
  SetupAnswerParams,
  SetupHideParams,
  SetupMomentParams,
  ShellDialogPickFolderParams,
  type ShellDialogPickFolderResult,
  ShellOpenExternalParams,
  type ShellOpenExternalResult,
  SOCKETS,
  STORES,
  SystemNativeRestartParams,
  type SystemNativeRestartResult,
  type SystemShellAttachResult,
  SystemShellLeaveParams,
  type SystemShellLeaveResult,
  SystemShutdownParams,
  TERMINAL_INVENTORY_REFUSALS,
  type TerminalConfigDocument,
  TerminalConfigExportRequest,
  type TerminalConfigExportResult,
  type TerminalConfigImportResult,
  TerminalConfigReadParams,
  type TerminalConfigRevealResult,
  TerminalConfigValidateParams,
  type TerminalConfigValidation,
  TerminalConfigWriteParams,
  type TerminalConfigWriteResult,
  type TerminalCreateOpenResponse,
  TerminalCreateParams,
  type TerminalListResult,
  TerminalRenewAttachParams,
  type TerminalRosterResult,
  type TerminalRuntimeSessionsResult,
  TerminalSessionParams,
  TerminalTakeGeometryParams,
  UserLinkBeginParams,
  UserLinkLogsParams,
  WorkspaceFileActionParams,
} from "@vibefield/contracts";
import type { AuditHealthV1 } from "@vibefield/contracts/diagnostics";
import type { LoggingHealthV1 } from "@vibefield/contracts/logging";
import type { WsCtor } from "@vibefield/fieldd-client";
import {
  createNodeLogging,
  createNoopLogger,
  createPrivateDir,
  durableRenameSync,
  type NodeLogging,
  PluginLogRouter,
  pluginLogProvenance,
} from "@vibefield/logging";
import { projectPluginAuthority } from "@vibefield/plugin-runtime";
// the bare wire number (RO-4): the client entry is a DOM program, and fieldd
// needs only the version its supervisor holds a spawned rosettad to
import { PROTOCOL_VERSION as ROSETTA_PROTOCOL_VERSION } from "@vibefield/rosetta-protocol/protocol-version";
import {
  agentListFor,
  clipRecordedLanes,
  createFieldSubscription,
  deskProjector,
  malformedBoardAsk,
  projectFieldRow,
  refuseBoardAsk,
  wireRecordedLanes,
} from "./agent-field";
import {
  type AgentGatewayOptions,
  AgentGatewayService,
  type ShellIntegration,
} from "./agent-gateway";
import { DEFAULT_SEARCH_LIMIT, EnrollmentStore, IndexService } from "./agent-index";
import { LastRunKeeper, modelBoardSource } from "./agent-last-run";
import { createModelSubscription } from "./agent-model-board";
import { type AgentMonitorService, createAgentMonitorService } from "./agent-monitor";
import { AgentRuntimeService, type AgentRuntimeServiceOptions } from "./agent-runtime";
import { type AccountUsagePollOptions, AccountUsageService } from "./agent-usage";
import {
  DEFAULT_APP_PREFERENCES,
  effectiveAppPreferences,
  resolveSyncIntent,
} from "./app-preferences";
import { ArtifactService, type ArtifactServiceHealth } from "./artifact-service";
import { AuditService, type AuditWriterTestHooks } from "./audit-service";
import { nativeAlive, nativeEndpoint, nativeMgmtEndpoint, splitPathList } from "./boot-env";
import { DeviceService, localDeviceIdAt } from "./device-service";
import { DiagnosticsService } from "./diagnostics-service";
import { DocLane } from "./doc-lane";
import { DocumentService } from "./doc-service";
import { DocSyncService, docHostPeers, isDocHostPeer, type LaneInfo } from "./doc-sync";
import { EgressRoutes, FloorEgress, resolveEgressPath } from "./egress";
import { EgressCellRewriter } from "./egress-cell-rewriter";
import { EndpointService } from "./endpoint-service";
import { FederatedSubscriptionManager } from "./federated-subs";
import { platformOsWaits } from "./floor-os-waits";
import {
  FREEWAY_SERVE_ID,
  FreewayApprover,
  FreewayFloor,
  FreewayServeDriver,
  freewayDeclaration,
} from "./freeway";
import { clipActivity, createActivityReader, monitorHistoryPort } from "./index-activity";
import { IndexCatalog } from "./index-catalog";
import { IndexMesh } from "./index-mesh";
import { INDEX_SERVE_ID, IndexServeDriver, IndexTicketMinter, indexPlaneLive } from "./index-serve";
import { IndexStatusFeed } from "./index-status-feed";
import { IndexTailService } from "./index-tail";
import { checkThreadsCaller, createThreadsPager } from "./index-threads";
import { InstallSetReconciler } from "./install-reconciler";
import { OutboundLaneIdAllocator } from "./lane-id";
import {
  carryLocalProjects,
  DocHoldersService,
  LibraryDocService,
  systemAccount,
  systemDocId,
} from "./library-doc";
import { LinkService, otherUserLinks } from "./link-service";
import { McpService } from "./mcp-service";
import { type BoardDelta, type BoardProjection, type LocalBoard, MeshBoard } from "./mesh-board";
import { MESH_BUS_CARRIES_CONTENT } from "./mesh-bus";
import { MeshClient, meshNodeUp, type ServeSpec } from "./mesh-client";
import { MeshLaneLink } from "./mesh-lane";
import { NativeLink, RpcCallError } from "./native-link";
import {
  type FloorCensus,
  type FloorOfRecord,
  type NativeSupervisionTimings,
  NativeSupervisor,
  UNKNOWN_FLOOR_CENSUS,
} from "./native-supervisor";
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
import { ProcessService, spawnMcpStdio } from "./process-service";
import { ProductApi } from "./product-api";
import { ProfileDraftsStore } from "./profile-drafts";
import { createProjectIdentityStore } from "./project-identity";
import { atFloor, wholeValueDoor } from "./projection";
import { KeyJournal } from "./projects/key-journal";
import { PlaceScanner } from "./projects/place-scanner";
import {
  admitProjectReader,
  admitProjectWriter,
  ProjectDoors,
  parseProjectAsk,
  readsProjects,
} from "./projects/project-doors";
import { ProjectGroups } from "./projects/project-groups";
import { ProjectRecords, projectIntentWriter } from "./projects/project-records";
import { NO_EGRESS, type RemoteCellRewriter } from "./remote-cell-rewriter";
import {
  ROSETTAD_UNCONFIGURED,
  type RosettadHealth,
  RosettadSupervisor,
  type RosettadSupervisorOptions,
} from "./rosettad-supervisor";
import {
  type PluginServiceLogRecord,
  ServiceHost,
  type ServiceHostCensus,
  type ServiceLeaseObservation,
} from "./service-host";
import { ServiceRegistry } from "./service-registry";
import { SettingsDocService } from "./settings-doc";
import { SetupLedgerStore } from "./setup-ledger";
import { appBundleOf, relaunchFromBundle, type SHELL_ABSENCE, ShellAbsence } from "./shell-absence";
import { ShellLease } from "./shell-lease";
import { createSurfaceService } from "./surface-service";
import { oweSyncQuestion } from "./sync-question";
import { peerAnswerBytes, tailnetRowLimit } from "./tailnet-rows";
import { runtimeProfileBinding, TerminalBindingStore } from "./terminal-bindings";
import { createTerminalLinkDoor } from "./terminal-links";
import {
  cellEndpointsFrom,
  publishedTerminalRoutes,
  serveAllowGlob,
  TERMINAL_SERVE_ID,
  TerminalServeDriver,
} from "./terminal-serve";
import {
  type TerminalInventoryTimings,
  type TerminalProfileBinding,
  TerminalService,
} from "./terminal-service";
import { TokenService } from "./token-service";
import { userMe } from "./user-me";
import type { BrowseFacts } from "./workspace/browse-exports";
import type { FilesHostLaunch } from "./workspace/launch";
import { WorkspacePicker } from "./workspace/picker";
import { createWorkspaceService, type WorkspaceService } from "./workspace/service";
import type { FilesHostHealth, FilesHostTimings } from "./workspace/supervisor";
import { workspaceError } from "./workspace/tickets";

// fieldd bootstrap (design-02 §3.6, P0 slice): tokens → NativeLink (pair +
// health subscription) → ProductAPI listen → run files → ready. SUPERSEDED is
// fatal for this product plane: the API stops immediately (never a zombie
// serving cached truth). Bootstrap is transactional: any failure after pairing
// releases the native single-client slot before rejecting.
//
// Track A adds the shell bootstrap contract: after listen, fieldd writes
// <dataDir>/fieldd/run/shell.token (0600, all scopes — the shell is the trusted
// root that mints narrower per-window tokens via system.mintWindowToken) and
// product.json (port/pid/bootId discovery metadata for adopt-or-spawn, and the
// floor this fieldd is linked to, rewritten whenever that floor changes).

/** DS-5d — how long a stopping fieldd waits for the holders ledger's last
 * write before it goes on without it (M176 item 7): the supervisor's default
 * TERM grace, and the bound the egress drain beside it already keeps. */
export const DOC_HOLDERS_STOP_MS = 2_000;

export interface FielddConfig {
  dataDir: string;
  /** AL-5 (AL-D8) — how this fieldd relaunches the app after an unplanned exit that left sessions; undefined = derived
   * from its own path (a packaged fieldd inside the .app), null = never. Tests inject a recorder. */
  shellRelaunch?: (() => Promise<boolean>) | null;
  /** AL-5 — the orphan bound's timings, scaled down by tests (`SHELL_ABSENCE` in shell-absence.ts) */
  shellAbsenceTimings?: Partial<Record<keyof typeof SHELL_ABSENCE, number>>;
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
  /** IL-D4 test seam: fieldd's own half of the inventory bound, over
   * `TERMINAL_INVENTORY` (a row runs a 10 s bound in a fraction of a second).
   * The tick bound it shares with the supervision is `nativeSupervisionTimings`'
   * `TICK_STALE_MS`. */
  terminalInventoryTimings?: Partial<Pick<TerminalInventoryTimings, "staleMs" | "sampleMs">>;
  /** DS-5d test seam: the bound on the holders ledger's last write at stop
   * (`DOC_HOLDERS_STOP_MS` by default). */
  docHoldersStopMs?: number;
  /** DS-4 seam: how a terminal ticket forwarded from another desktop becomes
   * doors a window here dials (`TerminalServiceOptions.remoteCellRewriter`).
   * Absent = production's `EgressCellRewriter` (DS-1b, 2026-10-01): one egress
   * route per owner desktop to its cell serve, both doors re-homed onto its
   * loopback listener; it answers UNAVAILABLE `egress_unavailable` while the
   * floor's sidecar predates RFC 026. (Before DS-1b, absent was `NO_EGRESS`.) */
  terminalRemoteCellRewriter?: RemoteCellRewriter;
  /** AR-7d test seam: what a free shell this daemon births adds to its
   * environment (`TerminalServiceOptions.shellIntegration`). Production
   * answers from the gateway service (AR-7b) through `shellIntegrationRef`. */
  terminalShellIntegration?: (shell: string) => Record<string, string> | undefined;
  /** SB-2 test seam: how a shell born under an Agent Profile is bound
   * (`TerminalServiceOptions.profileBinding`). Production answers from the
   * agent runtime (`runtimeProfileBinding`, terminal-bindings.ts). */
  terminalProfileBinding?: (profileSet: string) => Promise<TerminalProfileBinding>;
  /** pid of a field-native the caller spawned: the supervisor's first floor of
   * record, which product.json names until a respawn or the floor's hello ack
   * names another (`NativeSupervisor.recordedFloorPid`) */
  nativePid?: number;
  /** TC-D1 — re-runs the caller's spawn (bin.ts's exact env composition) so
   * the supervisor can respawn a dead floor. Absent = adopted/external floor:
   * no respawn authority, and the supervisor says so instead of guessing. */
  nativeSpawner?: () => number | undefined;
  /** WG-D1 test seam: the floor supervision's timings, over NATIVE_SUPERVISION
   * (the kill matrix runs the wedge ladder's rows in seconds, not minutes). */
  nativeSupervisionTimings?: Partial<NativeSupervisionTimings>;
  /** AR-0 — the rosettad binary to supervise for this user's agent index
   * (FIELDD_ROSETTAD_BIN). Absent or empty = no index daemon; health says so. */
  rosettadBin?: string;
  /** AR-0 test seam: how the index daemon is spawned (the kill matrix's
   * scripted rosettad); production spawns `rosettadBin` directly. */
  rosettadSpawn?: RosettadSupervisorOptions["spawnProcess"];
  /** AR-1 test seam: the home rosettad's discovery scans (`--home`).
   * Production passes the OS user's own home, explicitly (topology R7). */
  rosettadHome?: string;
  /** F1 (thinking-freeway.md v0.3 §4.3) — the owner's word on off-device terminals over the
   * freeway (`exposure.terminals`; today's `FIELD_NATIVE_TERMINAL_MESH`, moved into fieldd's
   * policy). ON unless this says `false`, per the bump's interim ruling; off, the host refuses the
   * terminal kinds `KIND_NOT_SERVED`. A code seam: no environment variable reaches it. */
  freewayTerminals?: boolean;
  /** SP-3 — publish rosettad's loopback listener on the tailnet as ONE serve
   * on `PORTS.INDEX_SERVE` (the route-per-process driver's second user,
   * index-serve.ts). OFF unless set, and nothing sets it: bin.ts passes no
   * value and no environment variable reaches it, because the pinned rosettad
   * verifies no credential (RO-1/RO-10 unmerged) — a serve here would put every
   * transcript one same-login node away. DS-7's pin move, which starts rosettad
   * with RO-1's bearer and RO-10's grant key, turns it on by a code edit. Tests
   * set it to witness the driver.
   * *AR-8b (2026-10-03): that edit is made. The direct plane — this serve and
   * `index.openTicket`'s mint — is ON unless this says `false`, and stands only
   * on a generation whose ready line says it enforces a bearer and verifies
   * grants (`indexPlaneLive`). Still no environment variable reaches it; `false`
   * is a code seam whose answer is `direct-plane-off`, never a silent blank.* */
  indexDirectPlane?: boolean;
  /** AR-8b test seam: the life of a minted index grant (production:
   * `INDEX_TICKET.TTL_MS`), so a row can watch one expire. */
  indexTicketTtlMs?: number;
  /** DS-6 test seams: the history catalog's cadences (the epoch, the
   * re-snapshot and batch windows, the reconnect backoff, the journal and page
   * budgets) and the digest heartbeat its peer subscribers hear. Production
   * takes INDEX_MESH's and ROWS' numbers. */
  /** DS-6 test seams: the aggregator's cadences (the search fan-out budget,
   * the stale horizon, the persist interval, the replica's delta floor and
   * re-attach backoff, the change pings' floor). Production takes INDEX_MESH's
   * numbers. */
  indexMesh?: {
    searchTimeoutMs?: number;
    staleAfterMs?: number;
    persistIntervalMs?: number;
    replicaMinIntervalMs?: number;
    retryMinMs?: number;
    retryMaxMs?: number;
    changesMinIntervalMs?: number;
  };
  indexCatalog?: {
    epoch?: string;
    resnapshotMs?: number;
    batchMs?: number;
    reconnectMinMs?: number;
    reconnectMaxMs?: number;
    journalDepth?: number;
    pageBytes?: number;
    digestIntervalMs?: number;
  };
  /** AR-2 — the VibeField ROOT above this user's root: the machine scope
   * (`LAYOUT.MACHINE_DIR`, AR-D15) hangs off it. Absent = no machine scope
   * (embedded and unit daemons): the distribution doors that would write it
   * refuse honestly. bin.ts derives it from the layout (`rootAboveUserRoot`). */
  vibefieldRoot?: string;
  /** AR-2 test seams: the PATH the agent install inventory searches, and the
   * fetch the release detectors use. Production: the process PATH, global fetch.
   * Setting the search path also isolates the home the inventory searches each
   * provider's install directories under (`agentInstallHome`, puppeteer 0.3.1). */
  agentSearchPath?: string;
  agentFetch?: typeof fetch;
  /** AR-S1c — read the agents' installs in the background once boot has
   * committed (every agent's version command: seconds), so Settings → Agents
   * and the deck's launcher answer at once. bin.ts — the product — sets it;
   * an embedded or unit daemon does not, so it never runs a machine's agents
   * unasked. */
  agentInventoryWarm?: boolean;
  /** AR-3 test seam: compose providers beside (or instead of) puppeteer's
   * built-ins — a scripted adapter that spawns through the real host. */
  agentProviders?: AgentRuntimeServiceOptions["providers"];
  /** AC-3 test seam: the catalog (default: THE table) — a test composes rows
   * for its scripted provider beside the real ones */
  agentCatalog?: AgentRuntimeServiceOptions["catalog"];
  /** AR-4 test seam: resume-when-idle's thresholds (production: 30 s still,
   * asked every 5 s). */
  agentResumeWhenIdle?: AgentRuntimeServiceOptions["resumeWhenIdle"];
  /** AR-5d test/product seam: the account-usage polling cadence. Unset ⇒ each
   * adapter's own `refresh.pollIntervalMs` (the provider knows its quota). */
  agentUsage?: AccountUsagePollOptions;
  /** AR-7b — the agent gateway (agent-gateway.ts): a typed agent is a managed
   * agent. Production passes NOTHING here and the gateway is on; what is
   * here are the test seams, and the way a layout names the program its
   * launchers run. Nothing here reaches strictness: fieldd is a strict host
   * and has no word that says otherwise. */
  agentGateway?: {
    /** false = this daemon hosts no gateway at all (a unit daemon's choice) */
    enabled?: boolean;
    /** the bundled shim (default: `agent-shim.cjs` beside the daemon's bundle) */
    shimScript?: AgentGatewayOptions["shimScript"];
    /** the launcher's runtime, named by the caller (case 1 of the rule) */
    launcher?: AgentGatewayOptions["launcher"];
    /** how long a launcher in one of our panes waits for a fieldd that does
     * not answer (default: the kit's) */
    retryMs?: AgentGatewayOptions["retryMs"];
    /** the process table typed runs are placed, proven and ended against */
    processTable?: AgentGatewayOptions["processTable"];
    /** this process's facts for the launcher's runtime */
    runtimeFacts?: AgentGatewayOptions["runtimeFacts"];
    /** a typed run's pid watch: its cadence and its grace */
    watch?: AgentRuntimeServiceOptions["typedWatch"];
    /** the gateway's start waits here before its first write (A2's row: a
     * pane born before the integration exists) */
    hold?: AgentGatewayOptions["hold"];
  };
  /** The build identity recorded in product.json: the dev runner's in development, the staged identity's in a
   * packaged app (WP12 D10) — the supervisor adopts only its own build and replaces any other. */
  buildId?: string;
  /** UA-2 — the user this daemon serves (users.json userId). Recorded in
   * product.json and asserted in every hello ack; the supervisor probe refuses
   * a mismatch. Unset for embedded/unit daemons. */
  userId?: string;
  /** PLUG-P2 — plugin discovery roots (§9.1): dirs whose children are plugin
   * dirs. Unset ⇒ an empty registry (honest, never a scan of guessed paths). */
  pluginRoots?: { bundled?: string[]; devLinked?: string[] };
  /** WP8c / TD-2 — the app's trust anchor for bundled roots: the staged trust-root document and the root keys it
   * must be signed by, both handed over by the shell (FIELDD_TRUST_ROOT, FIELDD_TRUST_ROOT_KEYS). Set ⇒ every
   * bundled root is keyed (verified, fail closed); unset ⇒ the development walk by manifest. */
  bundledTrust?: { trustRootPath: string; rootKeys: string[] };
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
  /** FS-1a — the files worker (workspace/service.ts; FS-D11 (b): always on,
   * started with this daemon and stopped with it). Absent = resolved from this
   * process: the `files-host.cjs` bundle and mille's engine beside fieldd's
   * bundle, or the packaged executable's `files-host` role — a source run has
   * neither and reads `unconfigured`, honestly. `false` = OFF: L6's test-only
   * knob for a daemon that does not exercise files (its doors answer
   * UNAVAILABLE `off`); bin.ts never sets it and no environment variable
   * reaches it, so it is never a user setting. A launch = a test's own worker. */
  filesHost?: false | FilesHostLaunch;
  /** FS-1a test seams: the worker's supervision timings; the browse
   * enumerator's facts, the roots subscription's re-read cadence, and the rule
   * that keeps the system's folders from being places (a test's temporary
   * folder on macOS lives under `/private`, which is never exported). */
  filesHostTimings?: Partial<FilesHostTimings>;
  workspace?: {
    browse?: () => BrowseFacts;
    rootsPollMs?: number;
  };
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
   * facts and the product says which one it means. WG-D1 — the contract's
   * block (`NativeLinkHealth`, `NativeSupervisor.health()`): the state and its
   * detail with their numbers — since when, the last reply's and tick's age,
   * fieldd's own loop lag, the sessions at risk, the requests timed out,
   * whether the person's restart is offered, and when the headless clause
   * would proceed. */
  nativeLink: NativeLinkHealth;
  /** the floor pid this fieldd can vouch for (spawned this boot or by the
   * supervisor since); null for adopted floors. The pid an adopted floor
   * stated in its hello is `nativeLink.pid`; product.json's `nativePid` names
   * the floor of record, either kind (`NativeSupervisor.recordedFloorPid`). */
  nativePid: number | null;
  /** GT-2d — the build label the paired field-native gave in its hello ack.
   * The native plane outlives fieldd and is ADOPTED, so the floor answering
   * this socket can be many builds older than the tree that started us; without
   * this, a stale floor is visible only as capabilities it honestly lacks.
   * `null` = it did not say, which means a daemon predating GT-2d — itself the
   * tell, and never a claim that the build is unknowable. */
  nativeBuild: string | null;
  /** WP12 L2b (`build-wp12-updater.md` §9 R3) — how the floor before this one ended, in its own word
   * (`HelloAck.lastExit`): `planned` = it was stopped for an update. `null` = it did not say. */
  nativeLastExit: NativeLastExit | null;
  /** WP12 L2b (§9 R3, the PM's correction 12:22Z) — a planned restart, announced here BEFORE the floor is asked to
   * stop: the local carrier (D36 keeps this stream on its device). `null` = none scheduled. */
  restartScheduled: RestartScheduled | null;
  native: NativeHealth | null;
  /** AR-0 — fieldd's EXTERNAL judgment of the agent-index daemon (rosettad):
   * unconfigured / starting / ready / restarting / failed / stopped and the
   * reason. The PROJECTION only: the loopback origin stays inside fieldd
   * (EL7 — rosettad is unauthenticated and this stream is scope-null). The
   * index doors (AR-1) answer UNAVAILABLE {service:"index", state} from the
   * same phase. *Corrected 2026-10-03 (AR-8b): rosettad is authenticated now
   * (a bearer per start, rosettad-supervisor.ts); the projection still carries
   * neither the origin nor any credential.* */
  rosettad: RosettadHealth;
  workspace: FilesHostHealth;
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
  /** DS-1 — the egress ROUTES port (E2): a loopback address that reaches a
   * door on a peer through this desktop's node, ref-counted per {peer, port}.
   * Built for the terminal rewriter (DS-4); `egress.ts` states its rules. */
  egressRoutes: EgressRoutes;
  /** C6-5/D35 — the federated subscription proxy (tests drive it directly;
   * the product path is a `device?` on any subscribe method). */
  federatedSubs: FederatedSubscriptionManager;
  /** DS-3 — the mesh board (`agent.subscribe {scope: "mesh"}`); tests read
   * how many hubs, and so how many sets of upstreams, are standing. */
  meshBoard: MeshBoard;
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
  /** AR-0 — the index daemon's supervisor; null when no binary was configured.
   * Tests drive start/stop/requestRestart directly. */
  rosettad: RosettadSupervisor | null;
  /** AR-1 — this user's enrollment record (consent + persona ↔ runtime) and
   * the service behind the index.* doors. AR-2's persona path enrolls through
   * `index.enrollRuntime`. */
  enrollment: EnrollmentStore;
  index: IndexService;
  /** DS-6 — this desktop's history catalog: rosetta's `/ws/meta` followed into
   * two rows tables (`projects`, `sessions`) the peers replicate. Tests read
   * its tables and drive `resnapshot` directly. */
  indexCatalog: IndexCatalog;
  /** DS-6 — the aggregator: every self peer's catalog replicated (persisted
   * under `mesh/catalog`), the merged doors and search by asking. */
  indexMesh: IndexMesh;
  /** PJ-1/PJ-3 — the projects this desktop groups (the `project.*` doors'
   * source); tests regroup it directly rather than wait out the settle. */
  projects: ProjectGroups;
  /** PJ-2/PJ-6 — the person's acts on projects, written as records; a launch
   * reaches it through the agents' birth hook (tests watch what it is told). */
  projectRecords: ProjectRecords;
  /** SP-6 — the session tails (`index.session.subscribe`): one rosetta socket
   * per tailed session, shared by its subscribers; tests count them. */
  indexTail: IndexTailService;
  /** AR-2 — the agent runtime (puppeteer) and the service behind the
   * agents.* doors; tests read its runtime directly. */
  agents: AgentRuntimeService;
  /** AR-5d — the account-usage reading behind `agents.usage(.subscribe)`;
   * tests drive its refresh directly. */
  agentUsage: AccountUsageService;
  /** AR-7b — the agent gateway; null when this daemon hosts none. Its start
   * is not a boot gate: `start()` answers the same promise the boot began. */
  agentGateway: AgentGatewayService | null;
  /** NF-3 — the floor's terminal service (tests type into a pane through it). */
  terminals: TerminalService;
  /** FS-1a — the files service: the roots registry, the worker's supervisor
   * and the doors (tests kill the worker and watch its generation move). */
  workspace: WorkspaceService;
  stop(): Promise<void>;
  /** WIN-D5 — the process owner (bin.ts) registers what "please stop" means
   * (its own graceful shutdown: stop() then exit). The `system.shutdown`
   * handler invokes it AFTER the response flushes; unregistered, the verb
   * answers honestly that nothing is listening. */
  onShutdownRequest(callback: () => void): void;
}

/** The daemon's own version, published in the device slice (package version). */
const FIELDD_VERSION = "0.1.0";

// RETIRED 2026-09-14 (TM-3, `thinking-terminal-mesh-cells.md` §7 / TM-D3):
// `MIRROR_WRITE_GRANT_ADMITTED_PRINCIPALS` and `mirrorWriteGrantRefusal`, FD-2's
// default-refuse allow-list for `terminal.mirrorWriteGrant`. It existed because
// the door handed out a DURABLE write key — a secret whose holder could type
// into this floor's sessions until a human deleted the file — so the question
// "who may hold it?" had to be answered by enumeration, and a kind nobody had
// thought about had to be refused rather than admitted.
//
// The question is gone, not merely answered elsewhere. The write right is a
// claim in the attach grant minted per ticket, and `rightsFor`
// (`terminal-grants.ts`) reads it off the PRINCIPAL: a window and a
// WhoIs-verified SELF peer are minted `input`, and everything else — a plugin,
// an unlinked tailnet peer, a guest, a peer-fieldd — is minted `["read"]`. A
// caller the allow-list would have refused now receives a grant that cannot
// type, which is the same refusal delivered as a capability rather than as an
// error, and it expires either way.
//
// One clause has NO counterpart and is not meant to: `agent-claim`, which
// refused a caller whose hello claimed `mcp-agent`. A ticket binds to the
// principal and never to a UI claim (`openTicket` below), so an agent's claim
// has never changed what a ticket grants — it only ever cost that caller the
// durable key. Nothing regresses: the ticket path's posture on a claiming
// caller is the one it already had before this slice.

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
  // WG-D1 — the wedge ladder's two late-bound witnesses: the census reads the
  // terminal service's cells, and presence the window tokens; both are built
  // further down this boot, so the supervisor reads them through these refs
  // (unknown, and nobody, until they exist).
  let floorCensus: ((forStop: boolean) => Promise<FloorCensus>) | null = null;
  let windowPresent: (() => boolean) | null = null;
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
    // the drain ladder's exit witness: signal 0 asks the kernel and delivers nothing
    pidAlive: (pid) => {
      try {
        return process.kill(pid, 0);
      } catch (error) {
        return (error as NodeJS.ErrnoException).code === "EPERM";
      }
    },
    census: (forStop) => floorCensus?.(forStop) ?? Promise.resolve(UNKNOWN_FLOOR_CENSUS),
    // WG-E5 — the floor's OS waits where the platform says them (Linux procfs, WG-D3)
    osWaits: platformOsWaits(),
    personPresent: () => windowPresent?.() ?? false,
    ...(config.nativePid !== undefined ? { nativePid: config.nativePid } : {}),
    ...(config.nativeSupervisionTimings !== undefined
      ? { timings: { ...NATIVE_SUPERVISION, ...config.nativeSupervisionTimings } }
      : {}),
    logger: logger.child({ component: "native_supervisor" }),
  });
  // WG-D4 — the doors that ride the floor's mgmt path answer UNAVAILABLE
  // {service: "native", state: "unresponsive"} at once while it is held there
  native.setDoorGate(() => supervisor.doorRefusal());
  // AR-0 — one rosettad per user root, fieldd-lifetime (AR-D6 v1). Constructed
  // here so health can project it from the first snapshot; STARTED only once
  // boot has committed (a boot rollback must never leave an index daemon
  // behind). The db lives under the user root at LAYOUT.INDEX_DB.
  // AR-1 — the enrollment record (AR-D17): loaded now, published before the
  // daemon's first launch, rewritten by the index.* doors. It exists whether
  // or not a daemon is configured — it is this user's consent, not a cache.
  const enrollment = new EnrollmentStore({
    path: join(config.dataDir, ...LAYOUT.INDEX_ENROLLMENT_FILE),
    logger: logger.child({ component: "index_enrollment" }),
  });
  // AO-2 — the Setup Assistant's ledger (design-03 §4.3's `setup.*`): which of
  // its steps this user answered and which they put off. Loaded now; written
  // only by the setup.* doors below.
  const setupLedger = new SetupLedgerStore({
    path: join(config.dataDir, ...LAYOUT.SETUP_LEDGER_FILE),
    logger: logger.child({ component: "setup_ledger" }),
  });
  // AO-5a (AO-D14) — the profiles Add a profile… made and no sign-in has kept:
  // noted at create, cleared at the first sign-in, swept at every start.
  const profileDrafts = new ProfileDraftsStore({
    path: join(config.dataDir, ...LAYOUT.AGENT_PROFILE_DRAFTS_FILE),
    logger: logger.child({ component: "profile_drafts" }),
  });
  const rosettad =
    config.rosettadBin === undefined || config.rosettadBin === ""
      ? null
      : new RosettadSupervisor({
          bin: config.rosettadBin,
          dbPath: join(config.dataDir, ...LAYOUT.INDEX_DB),
          // fieldd's PRIVATE announce dir (EL7 — never rosetta's shared one);
          // also where the next fieldd finds an orphan of this one
          announceDir: join(config.dataDir, ...LAYOUT.INDEX_DAEMONS_DIR),
          expectedProtocolVersion: ROSETTA_PROTOCOL_VERSION,
          // the OS user's own home, explicitly (topology R7: never a persona root)
          home: config.rosettadHome ?? homedir(),
          enrollFile: enrollment.path(),
          // AR-8b (RO-1, RO-10) — every generation behind a bearer, with a grant
          // key, both per start under this user's index directory (owner-only,
          // removed once the daemon is ready); the renderer's origins are the
          // ones this daemon's own door admits — one allow-list, one authority
          tokenFile: join(config.dataDir, ...LAYOUT.INDEX_TOKEN_FILE),
          grantKeyFile: join(config.dataDir, ...LAYOUT.INDEX_GRANT_KEY_FILE),
          allowOrigins: config.allowedOrigins ?? [],
          ...(config.rosettadSpawn !== undefined ? { spawnProcess: config.rosettadSpawn } : {}),
          logger: logger.child({ component: "rosettad_supervisor" }),
        });
  const index = new IndexService({
    supervisor: rosettad,
    store: enrollment,
    expectedProtocolVersion: ROSETTA_PROTOCOL_VERSION,
    ...(config.agentCatalog !== undefined ? { catalog: config.agentCatalog } : {}),
    logger: logger.child({ component: "index_service" }),
  });
  // SP-6 — one session's live tail over the door (index-tail.ts): rosetta's
  // session socket followed through rosetta's own client with the generation's
  // bearer, republished as rows at the registry's floor; one socket per
  // session however many subscribers. Re-aims itself at the daemon's next
  // generation (a restart resets every open tail).
  const indexTail = new IndexTailService({
    supervisor: rosettad,
    expectedProtocolVersion: ROSETTA_PROTOCOL_VERSION,
    logger: logger.child({ component: "index_tail" }),
  });
  // AR-8b — `index.openTicket`'s minter (index-serve.ts): the direct plane is
  // the owner's word (ON unless config says false) standing on a generation
  // that enforces access; the device id is read at each mint — the device
  // service is bound further down, before any door can be called.
  const indexTickets = new IndexTicketMinter({
    enabled: config.indexDirectPlane !== false,
    supervisor: rosettad,
    deviceId: () => devicesForAgents?.currentDeviceId() ?? "local",
    ...(config.indexTicketTtlMs !== undefined ? { ttlMs: config.indexTicketTtlMs } : {}),
  });
  // DS-6 — the history catalog's source (index-catalog.ts): rosetta's topology
  // stream followed into rows. Constructed beside the index service, STARTED
  // with the daemon it follows (after boot commits); the device id is read at
  // every stamp — the device service is bound further down.
  const indexCatalog = new IndexCatalog({
    supervisor: rosettad,
    expectedProtocolVersion: ROSETTA_PROTOCOL_VERSION,
    deviceId: () => devicesForAgents?.currentDeviceId() ?? "local",
    ...(config.agentCatalog !== undefined ? { catalog: config.agentCatalog } : {}),
    ...catalogCadences(config.indexCatalog),
    logger,
  });
  // TL (docket v9, T4/T5) — the record's sessions in a window (index-activity.ts):
  // `index.activity`'s reader and the monitor backend's history port —
  // rosettad's turns through its route, the catalog's bounds when the route
  // cannot answer; never a transcript page.
  const activity = createActivityReader({ catalog: indexCatalog, route: index });
  // DS-6 — the aggregator needs the roster and the peer link, which are built
  // further down; the doors registered before them read it through this ref
  // (every door is reachable only after the API listens, when it is bound).
  let indexMesh: IndexMesh | null = null;
  const requireMesh = (): IndexMesh => {
    if (indexMesh === null)
      throw new RpcCallError("UNAVAILABLE", "the history mesh is not up yet", true, {
        service: "index",
        state: "starting",
      });
    return indexMesh;
  };
  // AR-2 — the agent runtime (puppeteer's first import): one per fieldd, its
  // registry and managed roots under THIS user's root, its update transcripts
  // under the machine scope. Constructed here so the reconcile can subscribe
  // to the index daemon's readiness before the daemon ever starts; touches no
  // disk until a persona door is called (puppeteer's registry is lazy).
  // AR-3 — the host is the floor (agent-host.ts over TerminalService), which
  // is built later in this boot; the runtime holds the host object from
  // construction, so the service is late-bound to the terminals through a
  // getter and refuses typed until they exist. The device id likewise: the
  // device service is constructed after the api.
  let terminalsRef: TerminalService | null = null;
  // AR-7b — the gateway service is built once the floor is lent (below); the
  // runtime answers `invoke` from the launchers it holds, through this ref
  let gatewayRef: AgentGatewayService | null = null;
  // AR-7d — THE SEAM FOR AR-7b. What a free shell this daemon births adds to
  // its environment so the agent launchers lead its PATH: the spawn-through
  // kit's `shellIntegrationEnvironment` over the shim home, which the gateway
  // service (AR-7b, `agent-gateway.ts`) materializes. That service assigns
  // this ref once the shim home is written (and back to null when it stops:
  // `onShellIntegration`, where the service is built below); the terminal
  // service reads it through a getter at every birth. Until then — and in
  // every composition without it — a shell is born exactly as before.
  let shellIntegrationRef: ShellIntegration | null = null;
  let devicesForAgents: DeviceService | null = null;
  /** MV-3a (MV-D22) — the monitor backend beside the runtime; built once the
   * device roster exists. Null only in the window before that, and read by
   * the door's `model` projection and the stop paths. */
  let monitor: AgentMonitorService | null = null;
  /** LR (2026-10-15) — the board's one picture and what the last run left
   * (`agent-last-run.ts`); built with the monitor it pictures. */
  let lastRun: LastRunKeeper | null = null;
  // Show in Finder reaches Electron main through the shell provider, which
  // the api owns — built later in this boot, so bound through a ref too. GT-7:
  // Settings → Terminal's file actions (the terminal service) reach it here.
  let shellApi: ProductApi | null = null;
  // FS-1a — the files service (workspace/service.ts): the roots registry, the
  // worker's supervisor and the doors. Built here so every run that enters the
  // fold below adds its folder as a place; the worker STARTS once boot has
  // committed and stops with the daemon (FS-D11 (b)). The device id is read at
  // every answer — the device service is bound further down.
  const workspace = createWorkspaceService({
    dataDir: config.dataDir,
    deviceId: () => devicesForAgents?.currentDeviceId() ?? "local",
    filesHost: config.filesHost,
    bundleDir: typeof __dirname === "string" ? __dirname : undefined,
    timings: config.filesHostTimings,
    browse: config.workspace?.browse,
    rootsPollMs: config.workspace?.rootsPollMs,
    // R6 — each attachment's establish and end, beside its mint
    audit,
    logger,
  });
  // PJ-1 (L1–L3, L7) — the place scanner: the catalog's project rows enriched
  // with what the files worker reads of each root and its worktrees; a peer's
  // places (the replica, bound below) are the samples its hits look for.
  // Started with the files worker; idle while either has nothing to say.
  // PJ-2 §0 — a placeId hashes this user root's PERSISTED local id, which no
  // link or relink moves (the roster id does: device-service.ts), so the
  // anchors, links and splits a record keeps by placeId never orphan.
  const placeDeviceId = localDeviceIdAt(config.dataDir);
  const placeScanner = new PlaceScanner({
    catalog: indexCatalog,
    worker: workspace.supervisor,
    deviceId: () => placeDeviceId,
    taskRoots: () => createAgentCatalogReaders(config.agentCatalog ?? AGENT_CATALOG).taskRoots(),
    peerPlaces: () => indexMesh?.peerPlaces() ?? [],
    actedRoots: () => workspace.registry.roots(),
    logger,
  });
  // PJ-1 §4 (PJ-D20 (a)) — the projects: the grouping engine over this
  // desktop's places and every peer's (the replica, bound below), held for
  // PJ-3's doors; it follows this desktop's tables itself, and hears the
  // peers' and the person's acts through the hooks below.
  // PJ-2 (D4) — the library is mounted further down (and re-mounted on a
  // relink, mountSystemDocs): the person's records reach the grouping through
  // this ref, and the grouping follows each library mounted.
  let projectLibrary: LibraryDocService | null = null;
  /** false while a relink swaps the library: an act then is refused, not lost */
  let projectsWritable = false;
  const projectGroups = new ProjectGroups({
    deviceId: () => devicesForAgents?.currentDeviceId() ?? "local",
    local: indexCatalog,
    peers: () => indexMesh?.peerRows() ?? [],
    acted: () => placeScanner.acted(),
    // PJ-3 (D9) — the key memory: a key that regrouped answers `movedTo`,
    // across a restart
    journal: new KeyJournal({ file: join(config.dataDir, ...LAYOUT.PROJECT_KEYS_FILE), logger }),
    intents: () => projectLibrary?.projectIntents() ?? null,
    logger,
  });
  const offActed = workspace.registry.onChange(() => projectGroups.regroupSoon());
  // PJ-2 (D7) — the person's acts on projects, written as records in the
  // library: PJ-3's `project.intent` door writes through it, and a launch or
  // a resume the person made records its place (D6, `onPlace` below).
  const projectRecords = new ProjectRecords({
    library: () => (projectsWritable ? projectLibrary : null),
    groups: projectGroups,
    placeOf: (cwd) => placeScanner.placeOf(cwd),
    logger,
  });
  const projectIntents = projectIntentWriter(projectRecords);
  const agents = new AgentRuntimeService({
    userRoot: config.dataDir,
    vibefieldRoot: config.vibefieldRoot ?? null,
    index,
    supervisor: rosettad,
    terminals: () => terminalsRef,
    deviceId: () => devicesForAgents?.currentDeviceId() ?? "local",
    onProfileSignedIn: async (profileId): Promise<void> => {
      await agentUsage.signedIn(profileId);
    },
    profileDrafts,
    revealPath: () => {
      const shell = shellApi;
      if (shell === null || !shell.revealPathAvailable()) return null;
      return async (path) => {
        await shell.revealPath({ path });
      };
    },
    ...(config.agentProviders !== undefined ? { providers: config.agentProviders } : {}),
    ...(config.agentCatalog !== undefined ? { catalog: config.agentCatalog } : {}),
    ...(config.agentSearchPath !== undefined
      ? {
          searchPath: config.agentSearchPath,
          installHome: agentInstallHome(config.agentSearchPath, config.dataDir),
        }
      : {}),
    ...(config.agentFetch !== undefined ? { fetchFn: config.agentFetch } : {}),
    ...(config.agentResumeWhenIdle !== undefined
      ? { resumeWhenIdle: config.agentResumeWhenIdle }
      : {}),
    // AR-4 — the daemon's own acts on a session (the re-attach at boot, a
    // resume-when-idle) are ledgered as the system actor
    audit: (mutation, effect, describe) => audit.requiredSystem(mutation, effect, describe),
    // AR-S4d — a profile's server values sit beside the plugins' secrets, in the keychain
    ...(config.secretStore !== undefined ? { secretStore: config.secretStore } : {}),
    // AR-7 — `invoke` is answered from the launchers that stand; a typed run
    // is proven and watched against the same seams the gateway places it by
    launchers: () => gatewayRef?.launchers() ?? null,
    // FS-1a (L2) — every run's folder is a place of the files service; PJ-2
    // (D6) — and a run started there (not one the daemon re-attached at
    // boot) is an act in its place
    // — PJ-6 — and a launch from VibeField's own controls brings its recipe
    // — PJ-7 — and a launch by place, the place it named
    onPlace: (cwd, at, how) => {
      workspace.registry.touchPlace(cwd, at);
      if (how?.system !== true)
        projectRecords.actedIn(cwd, Date.parse(at), how?.recipe, how?.place);
    },
    // PJ-7 (Q1 (a)) — a launch by place reads this desktop's own place facts
    place: (ref) => projectGroups.ownPlace(ref),
    ...(config.agentGateway?.processTable !== undefined
      ? { processTable: config.agentGateway.processTable }
      : {}),
    ...(config.agentGateway?.watch !== undefined ? { typedWatch: config.agentGateway.watch } : {}),
    logger: logger.child({ component: "agent_runtime" }),
  });
  // AR-5d — account usage beside the runtime that owns the adapters: one
  // reading per provider and per persona, polled on the adapter's cadence.
  // Constructed here (not started) so a provider push and a persona change
  // are already listened for; `start()` is after `fieldd.lifecycle.ready`,
  // because a quota is never a boot gate.
  const agentUsage = new AccountUsageService({
    // AC-3 — the catalog's word applied: only providers whose row offers usage
    runtime: agents.usageRuntime(),
    ...(config.agentUsage !== undefined ? { poll: config.agentUsage } : {}),
    logger: logger.child({ component: "agent_usage" }),
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
    // WG-D4 — while the floor was held unresponsive its doors were refused, a
    // reconcile's among them: when it answers again, what they would have
    // placed is placed now
    let floorHeld = false;
    supervisor.on("transition", (state: NativeLinkState) => {
      if (state === "up" && floorHeld) void mesh.reconcile();
      floorHeld = state === "unresponsive";
    });
    // UA-3 — the link lifecycle (spec §7.1/§7.2): capture the S1 self-whois
    // login once the node is Running; the stored login is UA-4's trust
    // comparison value. link.json lives under this user's root.
    const linkLogger = logger.child({ component: "link" });
    const links = new LinkService({
      dataDir: config.dataDir,
      native,
      logger: linkLogger,
      // UA-P-0b (D8) — one local user per tailscale account. Read at CAPTURE,
      // not cached at boot: another user may link or unlink while this daemon
      // is resident (UA-D3 — background pairs keep running), and the answer
      // that matters is the one true at the moment a login enters this tree.
      otherUserLinks: () => otherUserLinks(config.dataDir, linkLogger),
      // TS-6 (TS-D13) — a new link keeps the fields made before it on this Mac
      // and owes the sync question, before link.json is written. `docs` is
      // declared below with no await between; a capture lands only after the
      // floor answers, so the binding is live by then.
      beforeLinked: () =>
        oweSyncQuestion({
          ledger: setupLedger,
          docs,
          logger: logger.child({ component: "sync-question" }),
        }),
    });
    links.start();
    // UA-P-0j — the first dial already happened above, so this hears only the
    // re-dials: a floor respawned under this daemon (a crash, a wedge restart)
    // boots holding no posture, and the link service is the one that asks.
    native.on("connected", () => links.floorReconnected());
    // C6-3g: sync is constructed after docs but has to be reachable from its
    // commit hook, so the hook reads a binding that is filled in below. It is
    // optional the whole way down — with the mesh off (the default) `docSync`
    // stays null and every commit takes the same path it always did.
    let docSync: DocSyncService | null = null;
    let presenceRooms: PresenceRoomRouter | null = null;
    // DS-5 (DS-D6) — the holders slice, bound once DeviceService exists below.
    let docHolders: DocHoldersService | null = null;
    // DS-5d — both stop ladders below wait for the ledger's last write (the
    // owner may remove its data root only after it, M162), but BOUNDED (M176):
    // the write is small and best-effort, so a filesystem that never answers
    // costs that write and never the shutdown, and says so.
    const settleDocHolders = async (): Promise<void> => {
      const holders = docHolders;
      if (holders === null) return;
      const budgetMs = config.docHoldersStopMs ?? DOC_HOLDERS_STOP_MS;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const outcome = await Promise.race([
        holders.stop().then(
          () => "settled" as const,
          () => "settled" as const,
        ),
        new Promise<"expired">((resolve) => {
          timer = setTimeout(() => resolve("expired"), budgetMs);
        }),
      ]);
      clearTimeout(timer);
      if (outcome === "expired") {
        logger.warn(
          "fieldd.docs.holders_stop_timeout",
          "The holders ledger did not settle in time; shutdown continues without it",
          { budgetMs },
        );
      }
    };
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
      // DS-5c (DS-D7) — the home a `local` canvas is given here, and what tells
      // one living elsewhere apart; the roster binds further down (lazy read).
      selfDevice: () => devicesForAgents?.currentDeviceId(),
      onCommit: (commit) => {
        docSync?.onCommit(commit);
        docHolders?.schedule();
      },
    });
    const laneLink = new MeshLaneLink({
      // WIN-D1, same law as the mgmt dial above: field-native binds this lane
      // as a named pipe on win32, so a joined LAYOUT path could only ENOENT —
      // and it would do so inside connect()'s best-effort catch, taking mesh
      // doc sync down silently rather than loudly. (`socketPath` is the option's
      // pre-pipe name, shared with NativeLink; it carries an ENDPOINT.)
      socketPath: nativeEndpoint(config.dataDir, SOCKETS.MESHDATA),
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
    // UA-P-0f (D5) — "documents sync only among VibeField DESKTOPS that share
    // the same tailscale login identity." This closure is the ONE peer source
    // both doc-sync and presence fan out over, so narrowing it here narrows
    // both, and there is no second list for a caller to reach past it.
    //
    // It reads DeviceService's self-peer set (UA-P-0e), which is built from the
    // tailnet's own WhoIs rather than from anything a peer published. The
    // roster keys by the durable ULID and lanes key by the tailscale node id —
    // the two never collide (T1 §6) — so `selfSyncPeers` hands back the DIAL
    // keyspace and the liveness fold below stays in it too. It reads that set
    // rather than intersecting a SECOND read of the floor's peer list, so there
    // is exactly one place the account boundary is applied.
    //
    // A phone is in this set and has no doc-sync listener: nothing on the phone
    // binds `PORTS.DOC_SYNC_QUIC`. A dial toward one therefore fails at the
    // transport, which `#openLane` already treats as ordinary — logged at info,
    // the peer marked unreachable for that doc, no queue, no retry storm. D5's
    // "a phone never receives a document" holds by the phone having no door,
    // and the failure is quiet by the path that reaches it already being the
    // mesh-down path.
    //
    // CORRECTED 2026-09-30 (DS-5, DS-D7): quiet was not harmless — every commit
    // re-dialed the phone and folded the doc to `peer-offline` (DS §1.2). The
    // closure now keeps only self peers whose roster row says `docHost`; a
    // phone publishes no device slice and leaves it (`docHostPeers`).
    const meshPeers = async (): Promise<Array<{ id: string; online: boolean }>> => {
      const roster = devicesForAgents;
      if (roster === null) return [];
      return docHostPeers(roster.list(), roster.selfSyncPeers());
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
      ...(config.bundledTrust !== undefined ? { bundledTrust: config.bundledTrust } : {}),
    });
    await plugins.refresh();
    // P8b (ESP §8.4): the module authority reads the registry and mints opaque
    // plugin-local tokens. Registry generation orders rebuild observations;
    // each plugin's serving identity decides whether its URLs carry or die.
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
      // UA-P-0f (D5) — the INBOUND half. `peers` above is already the self-peer
      // set, but a lane that ARRIVES never consults it, so the gate is asked
      // here per lane.
      //
      // Both closures read `devicesForAgents`, which is bound further down —
      // after this service starts. That window refuses (`?? false`) rather than
      // admits, which is the correct direction and costs a peer that dials in
      // the first beats of a boot one retry: doc-sync re-opens a lane on the
      // next commit or the next peer-returns re-greet, and a lane is cheap and
      // mortal by design (D5).
      isSelfPeer: (peer) => devicesForAgents?.isSelfPeer(peer) ?? false,
      // DS-5c (D3; UA-P-D5) — and the inbound half of the DOC peer set: the
      // account gate admits a phone, the roster row's `docHost` does not. Same
      // dial keyspace (`tailscaleId`), same predicate as `meshPeers` above, and
      // the same boot window: refused until the roster is bound.
      isDocHost: (peer) => {
        const roster = devicesForAgents;
        return roster !== null && isDocHostPeer(roster.list(), peer);
      },
      // UA-D7 — the one place per-doc intent and user posture are folded
      // together; the service itself never learns that a posture exists.
      resolveIntent: (docId) => resolveSyncIntent(docs.syncIntentOf(docId), syncPosture),
      logger: logger.child({ component: "doc.sync" }),
    });
    presenceRooms = new PresenceRoomRouter({
      control: laneControl,
      bytes: laneLink,
      peers: meshPeers,
      // UA-P-0f — the INBOUND half: a lane arrives without consulting `peers`
      isSelfPeer: (peer) => devicesForAgents?.isSelfPeer(peer) ?? false,
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
    // DS-5 (DS-D6, DS-D18) — the SETTINGS document and the LIBRARY join the
    // Loro-level host as SYSTEM documents, under well-known ids derived from
    // the ACCOUNT (the linked login, else this user root), so every desktop of
    // one account names the same documents and no two accounts do. They sync
    // among the account's desktops by law, never by intent. A relink is a new
    // account: both are re-mounted under the new ids, and the library for the
    // new account is seeded from this device's canvases (UA-D7: what the link
    // carries is the posture's call). The settings document is ONE file per
    // user root, so a relink carries its content to the new account's
    // desktops; the library is one file per account.
    // DS-5b 2026-10-01: the bias is built; settings cross.
    let systemDocs: {
      account: string;
      library: LibraryDocService;
      unregister: Array<() => void>;
    } | null = null;
    const mountSystemDocs = async (): Promise<void> => {
      const account = systemAccount(links.status().link?.login ?? null, config.userId);
      if (systemDocs?.account === account) return;
      if (systemDocs !== null) {
        projectsWritable = false; // PJ-2 — no act lands on the library leaving
        for (const off of systemDocs.unregister) off();
        await systemDocs.library.dispose();
      }
      const library = new LibraryDocService({
        dataDir: config.dataDir,
        docId: systemDocId("library", account),
        logger: logger.child({ component: "docs.library" }),
      });
      await library.ready();
      // PJ-2 (D5) — a link keeps the records this desktop made unlinked; a
      // carry that fails costs the carry, never the boot (the local library
      // stays as it was, and the next mount carries again)
      try {
        const carried = await carryLocalProjects({
          dataDir: config.dataDir,
          userId: config.userId,
          account,
          into: library,
          logger: logger.child({ component: "docs.library" }),
        });
        if (carried > 0)
          logger.info("fieldd.projects.records_carried", "Project records carried into the link", {
            records: carried,
          });
      } catch (error) {
        logger.warn("fieldd.projects.records_not_carried", "Project records were not carried", {
          error: error instanceof Error ? error.message.slice(0, 200) : String(error),
        });
      }
      projectLibrary = library;
      projectGroups.followLibrary(library);
      projectsWritable = true;
      // Registered only once loaded: its P7 install-set migrates in `ready()`,
      // and no whole entry may cross before it has (`settings-doc.ts`).
      await settingsDoc.ready();
      systemDocs = {
        account,
        library,
        unregister: [
          docs.registerSystemDoc(
            systemDocId("settings", account),
            "Settings",
            settingsDoc.hostDoc(),
            settingsDoc.hostOwner(),
          ),
          docs.registerSystemDoc(library.docId, "Library", library.doc, library.hostOwner()),
        ],
      };
      await docs.attachLibrary(library, (entry) =>
        resolveSyncIntent(entry.syncIntent, syncPosture),
      );
      // DS-5 (DS-D7) — the system documents toward every awake desktop now.
      docSync?.replicate(docs.systemDocIds(), { regreet: true });
    };
    await mountSystemDocs();
    links.on("changed", () => {
      void mountSystemDocs().catch((error) =>
        logger.warn("fieldd.docs.system_remount_failed", "System documents were not re-mounted", {
          error: String(error),
        }),
      );
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
      // The spawn seam is process-service's own MCP door, not a closure here:
      // as a closure it applied the child-env law (EL7) but skipped §17.1's
      // executable policy, so the two doors into one subsystem disagreed about
      // what a config may name. Composition roots wire; policy lives with it.
      spawn: spawnMcpStdio,
    });
    // C3 — the serve route secret (thinking-c3 §1): the provenance proof
    // shared by exactly two parties, this process and the sidecar's route
    // config. 192-bit; base64url is path-safe. Never logged, never in
    // serve.list responses (the Rust side redacts); rotation = restart.
    //
    // UA-P-0d (D7) — AND NEVER IN A URL ANYBODY ELSE HOLDS. It used to be
    // appended here, so the "capability URL" a phone dialled carried the secret
    // — into `field.devices.v1`, which truffle's `FileBackend` then wrote to
    // disk in a directory that was not 0700. A same-uid process that read that
    // file and forged the injected headers had the self grant.
    //
    // The secret is the sidecar's TARGET path now (`build_serve_config`), so
    // the sidecar adds it on forward and a caller dials the bare root. fieldd's
    // door is untouched: the backend sees `/t/<secret>` exactly as before.
    // What a peer holds is a LOCATOR — where the door is — and never a key.
    const servePathSecret = randomBytes(24).toString("base64url");
    const capabilityUrl = (base: string | undefined): string | undefined =>
      base === undefined ? undefined : base.replace(/\/+$/, "");
    // -- health aggregation: native deltas + link liveness, one stream out --
    let latestHealth: NativeHealth | null = null;
    let artifactsRef: ArtifactService | null = null;
    let detachArtifactHealth: (() => void) | null = null;
    const healthListeners = new Set<(h: FielddHealth) => void>();
    // WP12 L2b — set by the consented stop below, the moment before the floor is asked to go
    let restartScheduled: RestartScheduled | null = null;
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
      nativeLink: supervisor.health(),
      nativePid: supervisor.currentPid ?? null,
      nativeBuild: native.nativeBuild ?? null,
      nativeLastExit: native.lastExit ?? null,
      restartScheduled,
      native: latestHealth,
      rosettad: rosettad?.health() ?? ROSETTAD_UNCONFIGURED, // the projection, never state()
      workspace: workspace.supervisor.health(),
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
        // the mesh node's own word reaches the mesh facade, which re-places the
        // desired serves on a turn to up and says so ("node-up")
        mesh.noteNodeState(meshNodeUp(latestHealth));
        // TS-1 (P2) — and the link reads the node at once when its unit moves,
        // so a sign-in finished in the browser lands within a beat, not 15 s
        links.noteFloorHealth(latestHealth.units);
        emitHealth();
      },
    );
    latestHealth = snapshot as NativeHealth;
    mesh.noteNodeState(meshNodeUp(latestHealth));
    links.noteFloorHealth(latestHealth.units);
    // link down/up flips stream immediately (each backoff attempt re-emits; cheap and honest)
    native.on("reconnecting", emitHealth);
    native.on("connected", emitHealth);
    supervisor.on("transition", emitHealth);
    rosettad?.on("transition", emitHealth);
    workspace.supervisor.on("transition", emitHealth);
    detachHealthSources = () => {
      audit.off("health", emitHealth);
      native.off("reconnecting", emitHealth);
      native.off("connected", emitHealth);
      supervisor.off("transition", emitHealth);
      rosettad?.off("transition", emitHealth);
      workspace.supervisor.off("transition", emitHealth);
      mesh.off("reconciled", emitHealth);
      mesh.off("serves-changed", emitHealth);
      plugins.off("changed", emitHealth);
      detachArtifactHealth?.();
      detachArtifactHealth = null;
    };

    // TM-2 (TM-D2, F-H2) — THE ONE READING of "is this device carrying its
    // terminal doors onto the tailnet RIGHT NOW", answered as the live serve
    // itself or `undefined`. The ticket mint and `DeviceCapabilities.terminalMesh`
    // ask the same question, so they ask it here.
    //
    // Three conditions, every one of them about what is SERVING rather than
    // what this daemon asked for:
    //   · the serve is `active` in the fused view. ERRATA (F-L6c, 2026-09-14):
    //     the note that stood here called that "the node reporting the proxy
    //     running, not this daemon's own reconcile verdict", and that is not
    //     what the code does — `MeshClient.fuse` falls back to the reconcile
    //     record whenever the runtime stream has said nothing about this serve,
    //     and a successful `serve.add` writes `active` directly. So `active`
    //     means "the node took it and has not since reported it stopped or
    //     failed", which is weaker than a live liveness proof and is the
    //     strongest thing available without one.
    //   · it carries at least one route — the sidecar was handed a cell.
    //   · the url composes — `remoteCellEndpointsFor` refuses anything that is
    //     not a dialable http(s) origin instead of inventing one.
    //
    // WHY THE CAPABILITY MOVED HERE: it used to answer with
    // `native.terminalMeshPublished()`, the floor's own boolean off the hello.
    // That is only the FIRST of the driver's three gates (a captured login and
    // a routable cell are the other two), so a desktop whose floor publishes
    // and whose login is not captured yet — the whole pre-capture window, or a
    // corrupt `link.json` — advertised "another device can attach here" while
    // ZERO routes were on the tailnet. `devices.ts` promises that field is "the
    // fact a REMOTE reader needs", and a card drawn on it was tappable and dead.
    // SP-3 — the reading itself is the route driver's (`publishedTerminalRoutes`
    // in terminal-serve.ts, over route-serve.ts's `publishedServe`).
    const publishedTerminalServe = () => publishedTerminalRoutes(mesh.serves());

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
    // DS-1b — the production rewriter is built beside the egress routes it
    // rides (below PeerLink); this service is built long before them, so it
    // holds a delegate that reads the rewriter once it exists (NO_EGRESS's
    // honest refusal until then). A test seam's rewriter outranks both.
    let egressCellRewriter: EgressCellRewriter | undefined;
    const terminals = new TerminalService({
      link: native,
      logger: logger.child({ component: "terminal.service" }),
      ...(config.terminalBirthWaitMs !== undefined
        ? { birthWaitMs: config.terminalBirthWaitMs }
        : {}),
      remoteCellRewriter: config.terminalRemoteCellRewriter ?? {
        rewrite: (deviceId, endpoints) =>
          (egressCellRewriter ?? NO_EGRESS).rewrite(deviceId, endpoints),
      },
      // TM-2 (TM-D2) — the doors a TAILNET self peer is told to dial, read off
      // the LIVE terminal serve (`publishedTerminalServe` above) plus one
      // condition only this caller has: THIS cell's route is in the published
      // set. A ticket minted in the window between a cell's birth and its route
      // landing would name a path the sidecar answers 404 for, and a 404 is not
      // a state any client can act on. Anything missing is `doors_not_published`.
      // SP-3 — the route driver builds the set (`cellEndpointsFrom`).
      remoteEndpoints: (cellBootId) => cellEndpointsFrom(mesh.serves(), cellBootId),
      // GT-7 — Import file… / Export… / Reveal: the api's internal shell
      // doors, read at call time (the api is built after this service).
      shell: () => shellApi,
      // AR-7d — read at every birth: the test seam, else the gateway's answer
      // (`shellIntegrationRef` above; null until AR-7b's service sets it).
      shellIntegration: (shell) =>
        (config.terminalShellIntegration ?? shellIntegrationRef)?.(shell),
      // SB-2 (AR-7g) — a shell born under an Agent Profile: the set, its
      // sign-ins and puppeteer's binding over them, from the agent runtime
      // this daemon composed (the test seam, else the runtime's own answer)
      profileBinding: config.terminalProfileBinding ?? runtimeProfileBinding(agents.runtime),
      // SB-2 — which shells were born bound, on disk under this user's root:
      // the floor outlives fieldd, and so must the record of what it holds
      bindings: new TerminalBindingStore({
        file: join(config.dataDir, ...LAYOUT.TERMINAL_BINDINGS_FILE),
        logger: logger.child({ component: "terminal.bindings" }),
      }),
      // item 42 — the roster each attach grant's holder face is named from
      // (`holderFaceFor`), read at the mint: the DeviceService is bound further
      // down, and a mint before it carries no face rather than a guessed one
      holderFaces: () => devicesForAgents,
      // IL-D4 — fieldd's own half of the inventory's age reads the floor's
      // supervision: the stream reaches fieldd only while the link is "up" and
      // the floor ticks; and a stale door names WG-D4's held floor first
      supervision: supervisor,
      inventoryTimings: {
        ...(config.nativeSupervisionTimings?.TICK_STALE_MS !== undefined
          ? { tickStaleMs: config.nativeSupervisionTimings.TICK_STALE_MS }
          : {}),
        ...config.terminalInventoryTimings,
      },
    });
    native.on("connected", () => void terminals.ensureStarted());
    await terminals.ensureStarted();
    // WG-E6 — the wedge ladder's census reads the cells through this service
    floorCensus = (forStop) => terminals.floorCensus(forStop);
    // AR-3 — lend the floor to the agent runtime, and feed the fold: the
    // floor's exit facts become puppeteer's `handleProcessExit` (or verify a
    // login pane's persona), every inventory joins the rows to their cells
    // and backstops an exit the cell's connection never reported.
    terminalsRef = terminals;
    terminals.onSessionExited((event) => void agents.handleTerminalExit(event));
    terminals.onInventory((rows) => agents.handleInventory(rows));
    // AR-4 — the FIRST inventory is the re-attach, and ensureStarted may have
    // applied it before the listener above existed: feed what the floor
    // already said, so a boot onto a quiet floor re-attaches now and not at
    // the floor's next change.
    if (terminals.observation() !== undefined) agents.handleInventory(terminals.list());
    // AR-7b — the agent gateway, over the floor just lent: a typed agent is a
    // managed agent. Its start probes the launcher's runtime, reads the
    // process table and may read an agent's install, so it is begun here and
    // never awaited by the boot; its FIRST write is the shell integration,
    // ahead of all three (A2), so a pane born a moment from now is born
    // integrated and not bare for life. A start that fails leaves fieldd
    // whole and the launchers as they were.
    const gateway =
      config.agentGateway?.enabled === false
        ? null
        : new AgentGatewayService({
            userRoot: config.dataDir,
            runtime: agents.runtime,
            catalog: createAgentCatalogReaders(config.agentCatalog ?? AGENT_CATALOG),
            terminals: () => terminalsRef,
            fold: agents,
            // the install the runtime itself launches, read for the agents
            // that are given a launcher and no other
            executables: (providers) => agents.distribution.launchExecutables(providers),
            // AR-7d — the seam: the service's answer once its home is
            // written, and nothing (a shell born as before) once it stops
            onShellIntegration: (integration) => {
              shellIntegrationRef = integration;
            },
            ...(config.agentGateway?.shimScript !== undefined
              ? { shimScript: config.agentGateway.shimScript }
              : {}),
            ...(config.agentGateway?.launcher !== undefined
              ? { launcher: config.agentGateway.launcher }
              : {}),
            ...(config.agentGateway?.retryMs !== undefined
              ? { retryMs: config.agentGateway.retryMs }
              : {}),
            ...(config.agentGateway?.processTable !== undefined
              ? { processTable: config.agentGateway.processTable }
              : {}),
            ...(config.agentGateway?.runtimeFacts !== undefined
              ? { runtimeFacts: config.agentGateway.runtimeFacts }
              : {}),
            ...(config.agentGateway?.hold !== undefined ? { hold: config.agentGateway.hold } : {}),
            audit: (mutation, effect, describe) => audit.requiredSystem(mutation, effect, describe),
            logger: logger.child({ component: "agent_gateway" }),
          });
    gatewayRef = gateway;
    const startGateway = (): void => {
      gateway
        ?.start()
        .catch((error: unknown) =>
          logger.error(
            "fieldd.agents.gateway_start_failed",
            "The agent gateway did not start; a typed agent is not managed until it does",
            error,
          ),
        );
    };
    startGateway();
    const refreshGateway = (): void => {
      gateway?.refresh().catch((error: unknown) =>
        logger.warn("fieldd.agents.gateway_refresh_failed", "The launchers were not refreshed", {
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    };

    // T1 §1 — the tailnet door's node-id correlation. DeviceService is built
    // AFTER ProductApi, so this is a let-ref, not a closure over the const:
    // a hello racing the bootstrap window resolves to undefined (claim
    // fallback), never a TDZ crash (the C6-6 supersession lesson).
    let devicesRef: DeviceService | null = null;
    // WIN-D5 — what "please stop" means is the process owner's to define
    // (bin.ts: graceful stop then exit); late-bound because stop() closes over
    // resources constructed after the api below.
    let shutdownRequested: (() => void) | null = null;
    // AL-7 — the shell lease reads its holders' closes; late-bound because it counts the floor's sessions, and the
    // terminal service is constructed after the api.
    let shellLeaseRef: ShellLease | null = null;
    let shellAbsenceRef: ShellAbsence | null = null;
    const api = new ProductApi({
      // UA-D12 — ephemeral default; the fixed registry number is legacy
      // documentation, and product.json is the only discovery
      port: config.controlPort ?? 0,
      tokens,
      ...(config.allowedOrigins ? { allowedOrigins: config.allowedOrigins } : {}),
      tailnetPathSecret: servePathSecret,
      correlateNodeId: (nodeId) => devicesRef?.deviceIdByNodeId(nodeId),
      // D1 (2026-10-01) — the peer KIND needs that device's roster row to be a
      // desktop (`docHost`) as well; before the roster exists, nothing is one
      isDocHost: (deviceId) => devicesRef?.isDocHost(deviceId) ?? false,
      logger: logger.child({ component: "product.api" }),
      ...(config.userId !== undefined ? { userId: config.userId } : {}),
      // UA-4 — the door's comparison value (UA-D13): read fresh per hello, so
      // a capture landing mid-uptime activates the law without a restart
      getLinkedLogin: () => links.status().link?.login ?? null,
      onConnectionClosed: (connectionId) => shellLeaseRef?.closed(connectionId),
    });
    diagnosticsService.register(api);
    shellApi = api;
    api.register("audit.append", (ctx, params) => audit.appendFromCaller(ctx, params));

    api.register("shell.dialog.pickFolder", async (ctx, params) => {
      const parsed = ShellDialogPickFolderParams.safeParse(params);
      if (!parsed.success || parsed.data.purpose !== "artifact.publish") {
        throw new RpcCallError(
          "PRECONDITION_FAILED",
          "expected { purpose: artifact.publish }; Files uses workspace.pickFolder",
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
    // GT-8a (GT-D22) — a terminal link, ⌘-clicked in the deck. Registered
    // beside openExternal because it reaches the same provider, but gated by
    // its own scope (`terminal.link`, the window's alone — never the
    // plugin-eligible `shell.open`): terminal-links.ts is the policy (a web
    // link to the default browser through the internal `shell.openLink`, a file
    // link only ever SHOWN through `shell.revealPath`, anything else refused
    // before main is asked), and main the mechanism.
    const openTerminalLink = createTerminalLinkDoor({ shell: api, audit });
    api.register("terminal.link.open", (ctx, params) => openTerminalLink(ctx, params));

    // DT-1b — the live-surface policy door. Registered beside the other
    // shell-dispatching methods because it is one: the service decides whether
    // a surface may exist (the kind→scope matrix on top of the row's
    // `surface.attach`, the local-window binding, idempotent replay, the audit
    // pair) and Electron main mints it. Until DT-1c lands the main-side
    // authority the doors answer UNAVAILABLE, and so does this.
    const surfaces = createSurfaceService({ api, audit, logger });
    api.register("surface.sources", (ctx, params) => surfaces.sources(ctx, params));
    api.register("surface.open", (ctx, params) => surfaces.open(ctx, params));
    api.register("surface.close", (ctx, params) => surfaces.close(ctx, params));
    // PT-S2 (R11) — the attach's device list (a phone's "Attach" binds from it)
    api.register("surface.simulator.devices", (ctx, params) =>
      surfaces.simulatorDevices(ctx, params),
    );

    api.register("system.health", () => health());
    // WIN-D5 — the stop verb. The response flushes first (setImmediate), then
    // the process owner's registered shutdown runs — the same graceful path the
    // unix signal handlers take, now reachable on every platform. Unregistered
    // (a library embedding without a process owner) the verb says so honestly.
    //
    // WP12 L2b (`build-wp12-updater.md` §9 R2; design-00 EL1's 2026-10-15 note) — `native` is the consented exception
    // to the two-planes law: an update that touches field-native stops the floor too, and since AL-2 (2026-10-27,
    // EL1's errata) so does a person's quit or the OS's logout (`reason`). The census is re-verified HERE, at the
    // point of effect, with the terminal service closed to births: only an exact match between the live set and the
    // set the person consented to end (`[]` at census zero), with no birth in flight, stops the floor; anything else
    // refuses and reopens births. The floor then stops itself through `NativeSupervisor.stopFloor` (prepareRestart →
    // shutdown → the socket closing; the ladder only for a floor this fieldd spawned), and fieldd follows. Without
    // `native`, unchanged: fieldd alone, the floor lives on.
    let nativeStopping: NativeRestartReason | null = null;
    const stopNativeConsented = async (
      asked: NonNullable<SystemShutdownParams["native"]>,
      reason: NativeRestartReason,
    ): Promise<"closed" | "forced" | "lingering"> => {
      if (nativeStopping !== null)
        throw new RpcCallError(
          "PRECONDITION_FAILED",
          `a stop (${nativeStopping}) is already underway`,
          false,
        );
      const census = terminals.closeToBirthsForStop();
      if (census === undefined) {
        terminals.reopenToBirths();
        throw new RpcCallError(
          "UNAVAILABLE",
          "the terminal inventory has not been observed, so the floor's sessions cannot be counted",
          true,
          {
            service: TERMINAL_INVENTORY_REFUSALS.SERVICE,
            state: TERMINAL_INVENTORY_REFUSALS.STATE_UNOBSERVED,
          },
        );
      }
      // IL-D5 (a) (`draft/thinking-inventory-latency.md` §5) — a stop never
      // weighs a consent against an old list: while any cell's inventory is
      // older than its bound the census may miss a session a stale cell holds,
      // or name one that has gone, so the stop is refused retryably and births
      // reopen, as for an unobserved floor (WG-D4's {native, unresponsive}
      // while the floor is held). The way out of a cell that stays stale is the
      // person's consented restart, whose census reads the cells themselves.
      const stale = terminals.floorStaleRefusal("system.shutdown");
      if (stale !== undefined) {
        terminals.reopenToBirths();
        logger.info(
          "fieldd.lifecycle.native_stop_refused",
          "A consented stop was refused: the terminal inventory is older than its bound",
          { reason, staleCells: terminals.staleCells().length },
        );
        throw stale;
      }
      const consented = new Set(asked.sessions);
      const exact =
        census.births === 0 &&
        census.live.length === consented.size &&
        census.live.every((sessionId) => consented.has(sessionId));
      if (!exact) {
        terminals.reopenToBirths();
        logger.info(
          "fieldd.lifecycle.native_stop_refused",
          "A consented stop was refused: the live sessions are not the consented set",
          { reason, live: census.live.length, consented: consented.size, births: census.births },
        );
        throw new RpcCallError(
          "PRECONDITION_FAILED",
          census.births > 0
            ? "a session is being born that the consent does not name; ask again"
            : "the live sessions differ from the set consented to end; ask again",
          false,
          { live: census.live, births: census.births },
        );
      }
      nativeStopping = reason;
      // a RESTART is announced (the phone and the peers read `restarting`); a quit or a logout is no restart
      if (reason === "update") {
        restartScheduled = {
          reason,
          planes: ["shell", "fieldd", "field-native"],
          at: Date.now(),
        };
      }
      logger.info(
        "fieldd.lifecycle.native_stop_consented",
        "Stopping the floor: the live sessions are exactly the consented set",
        { reason, sessions: census.live.length },
      );
      emitHealth();
      return await supervisor.stopFloor({
        reason,
        ...(asked.toVersion !== undefined ? { toVersion: asked.toVersion } : {}),
      });
    };
    // AL-5 (`thinking-app-lifecycle.md` §8.2) — the orphan bound: while no shell holds the lease, an empty pair ends
    // itself after the idle span (the consented stop with nothing to end, then the process owner's exit), and an
    // unplanned exit that left sessions relaunches the app into the menu bar, capped.
    const derivedBundle = appBundleOf(process.execPath, process.platform);
    const shellAbsence = new ShellAbsence({
      liveSessions: () => terminals.liveCount(),
      stopForIdle: async () => {
        await stopNativeConsented({ stop: true, sessions: [] }, "idle");
        shutdownRequested?.();
      },
      relaunchShell:
        config.shellRelaunch !== undefined
          ? config.shellRelaunch
          : derivedBundle === null
            ? null
            : relaunchFromBundle(derivedBundle),
      logger: logger.child({ component: "shell.absence" }),
      ...(config.shellAbsenceTimings !== undefined ? { timings: config.shellAbsenceTimings } : {}),
    });
    shellAbsenceRef = shellAbsence;
    // AL-7 (`thinking-app-lifecycle.md` §8.1) — the shell lease. Only the local shell (`shell-main`, the shell token)
    // claims it or leaves it; a probe's hello never claims it, so a probe's close is no shell leaving.
    const shellLease = new ShellLease({
      dataDir: config.dataDir,
      liveSessions: () => terminals.liveCount(),
      logger: logger.child({ component: "shell.lease" }),
      onVacant: (record) => shellAbsence.vacant(record),
      onHeld: () => shellAbsence.held(),
    });
    shellLeaseRef = shellLease;
    // AL-8a (`thinking-app-lifecycle.md` §8.3.1) — a fieldd that crashed before this one, in the floor's word on this
    // process's first hello: handed to the next shell's attach once, beside the shell's own record.
    const noteManagerExit = (): void => {
      const lastManager = native.lastManager;
      if (lastManager === undefined) return;
      native.lastManager = undefined; // said once
      if (!lastManager.planned) {
        shellLease.noteManagerExit({ at: lastManager.at, sessions: lastManager.sessions });
      }
    };
    native.on("connected", noteManagerExit);
    noteManagerExit();
    const leaseConnection = (ctx: {
      transport: string;
      principal: { kind: string };
      connection?: { id: string };
    }): string => {
      if (ctx.transport !== "ws-loopback" || ctx.principal.kind !== "shell-main") {
        throw new RpcCallError(
          "FORBIDDEN_SCOPE",
          "the shell lease is the local shell's alone",
          false,
        );
      }
      if (ctx.connection === undefined) {
        throw new RpcCallError("PRECONDITION_FAILED", "no connection to hold the lease", false);
      }
      return ctx.connection.id;
    };
    api.register("system.shell.attach", async (ctx) => {
      const lastExit = await shellLease.attach(leaseConnection(ctx));
      const result: SystemShellAttachResult = {
        lastExit,
        lastManagerExit: await shellLease.takeManagerExit(),
      };
      return result;
    });
    api.register("system.shell.leave", (ctx, params) => {
      const connectionId = leaseConnection(ctx);
      const parsed = SystemShellLeaveParams.safeParse(params ?? {});
      if (!parsed.success) {
        throw new RpcCallError(
          "PRECONDITION_FAILED",
          "expected { why: quit|restart|user-switch|update }",
          false,
        );
      }
      const result: SystemShellLeaveResult = {
        noted: shellLease.leave(connectionId, parsed.data.why),
      };
      return result;
    });
    api.register("system.shutdown", async (_ctx, params) => {
      if (!shutdownRequested) return { stopping: false, detail: "no shutdown owner registered" };
      const parsed = SystemShutdownParams.safeParse(params ?? {});
      if (!parsed.success)
        throw new RpcCallError(
          "PRECONDITION_FAILED",
          "expected { reason?: update|quit|logout, native?: { stop: true, sessions: string[], toVersion? } }",
          false,
        );
      const reason = parsed.data.reason ?? "update";
      const nativeStop =
        parsed.data.native === undefined
          ? undefined
          : await stopNativeConsented(parsed.data.native, reason);
      logger.info("fieldd.lifecycle.shutdown_requested", "system.shutdown received", {
        reason,
        native: nativeStop ?? null,
      });
      shellLease.seal(); // AL-7 — a shell that drops from here on is fieldd stopping, not a shell leaving
      const callback = shutdownRequested;
      setImmediate(() => callback());
      return { stopping: true, ...(nativeStop === undefined ? {} : { native: nativeStop }) };
    });
    // TC-D1 and WG-D5 — the person's restart of the floor, under `agents.manage`
    // (the window holds it; local only; never plugin-eligible). On a floor that
    // is down it is the escalation after the respawn intensity trips to "gone":
    // nothing is ended, the windows reset and one respawn cycle runs. On a live
    // floor it ends every session there, so it is taken only for a floor held
    // unresponsive past the bound (or "gone"; PRECONDITION_FAILED {state}
    // otherwise) and carries the person's consent: `sessions` must be exactly
    // what the census reads from the cells with births closed, or it refuses
    // PRECONDITION_FAILED {live}, and only where this fieldd can act ("no kill
    // authority over this floor — restart it outside VibeField" otherwise).
    // `NativeSupervisor.requestRestart` decides.
    api.register("system.native.restart", async (_ctx, params) => {
      const parsed = SystemNativeRestartParams.safeParse(params ?? {});
      if (!parsed.success) {
        throw new RpcCallError(
          "PRECONDITION_FAILED",
          "expected { sessions: string[] } — the sessions this restart ends ([] when it ends none)",
          false,
        );
      }
      logger.info("fieldd.native_supervisor.manual_restart", "system.native.restart received", {
        sessions: parsed.data.sessions.length,
      });
      await supervisor.requestRestart({ sessions: parsed.data.sessions });
      const result: SystemNativeRestartResult = {
        state: supervisor.state,
        detail: supervisor.stateDetail,
      };
      return result;
    });
    // AR-0 — the index daemon's escalation affordance, the same shape: after
    // rosettad's restart intensity trips to the permanent honest "failed", a
    // human overrides on purpose (or bounces a live daemon after a rebuild).
    // Answers the health PROJECTION — never the origin.
    api.register("system.index.restart", async () => {
      logger.info("fieldd.rosettad.manual_restart", "system.index.restart received");
      if (rosettad === null) return { rosettad: ROSETTAD_UNCONFIGURED };
      await rosettad.requestRestart();
      return { rosettad: rosettad.health() };
    });
    // AR-1 — the index doors (thinking-ar-data-topology.md §4 flows). Reads
    // fold the daemon's answers with the record; every answer is a projection
    // (no origin, no enrolled root's path). Mutations rewrite THIS user's
    // record, are audited (consent is an act of the person at this device),
    // and bounce the daemon when the record changed.
    // AO-4 — History's room reads its first reading here. The per-project
    // fold, keyed by THIS desktop's grouping as the join column is (PJ-4),
    // rides only to this desktop's own windows: the room is theirs, and
    // rosetta keeps the fold for the daemon's life, so the phone (which keeps
    // no room) is not sent it on every read.
    const ownWindow = (ctx: CallerContext): boolean =>
      ctx.principal.kind === "local-token" || ctx.principal.kind === "shell-main";
    api.register("index.status", (ctx) =>
      index.status(ownWindow(ctx) ? { projects: (rows) => projectDoors.backfills(rows) } : {}),
    );
    // AO-4b — the same status pushed, for the desk's History cell and Setting
    // up: ONE poller while anyone listens (`IndexStatusFeed`), reading as this
    // desktop's windows are answered, and at once when the daemon's phase
    // moves; another caller's frames leave the per-project fold out, as
    // `index.status` does. Whole values at the feed's floor (`wholeValueDoor`):
    // a frame equal to what this reader holds is not sent.
    const indexStatusFeed = new IndexStatusFeed({
      read: () => index.status({ projects: (rows) => projectDoors.backfills(rows) }),
      logger,
    });
    rosettad?.on("transition", () => indexStatusFeed.poke());
    api.registerSubscription("index.status.subscribe", async (ctx, _params, emit) => {
      const lease = await indexStatusFeed.open();
      const view = (status: IndexStatus): IndexStatus => {
        if (ownWindow(ctx)) return status;
        const { projects: _fold, ...rest } = status;
        return rest;
      };
      const door = wholeValueDoor(
        { read: () => view(lease.current()), onChange: lease.onChange },
        emit,
        {
          minIntervalMs: INDEX_STATUS_FEED.IMPORT_TICK_MS,
          onError: streamFrameFailed("index.status.subscribe"),
        },
      );
      return {
        snapshot: door.snapshot,
        dispose: () => {
          door.dispose();
          lease.close();
        },
      };
    });
    api.register("index.discoveries", () => index.discoveries());
    // AR-5e — the find sheet's two reads (thinking-ar-views-port.md §6.3).
    // Projections like the two above: no origin, no enrolled root's path. A
    // daemon that cannot answer a search says so in the answer's state rather
    // than claiming the history holds no matches.
    // DS-6 — two questions on `index.sessions`: the LOOKUP by native id (as
    // ever), and with no ids the LISTING — a keyset page of this desktop's
    // catalog (`scope: "local"`, the default) or of the merged replica of every
    // self desktop (`scope: "mesh"`, DS-D10's one row per native session).
    // `index.search {scope: "mesh"}` ASKS every awake self desktop (DS-D8). A
    // peer daemon's call is always answered from THIS desktop's own index — a
    // mesh question never fans out twice.
    // SP-D13 (a), 2026-10-03 — the phone may search and list its own history,
    // BOUNDED: for a `tailnet` caller each history door below asks its service
    // for at most INDEX_TAILNET_LIMITS.MAX_ROWS rows (`tailnetRowLimit`, the
    // door's own default when nothing is asked), so neither rosettad nor the
    // catalog's pager is asked for more, and the answer stays honest about the
    // cut — `clipped` on a search, a `cursor` on a listing. The clamp is the
    // DOOR's, never the service's: IndexService and IndexMesh know no
    // principal. A window keeps every door's limits, and so does a self peer
    // DAEMON (`peer-fieldd`), deliberately: it asks on behalf of a window on
    // another desktop and carries that window's limits.
    api.register("index.sessions", async (ctx, params) => {
      const parsed = IndexSessionsParams.safeParse(params ?? {});
      if (!parsed.success)
        throw new RpcCallError(
          "PRECONDITION_FAILED",
          'expected { nativeSessionIds: string[] (1..256) } or { scope?: "local" | "mesh", family?, devices?, projectId?, cursor?, limit? }',
          false,
        );
      // the LOOKUP names its rows (at most 256 ids, the schema's ceiling): a
      // question about named runs, not a page, so the SP-D13 bound is the
      // listing's
      if (parsed.data.nativeSessionIds !== undefined)
        return await index.sessions(parsed.data.nativeSessionIds);
      const page = requireMesh().sessions({
        ...parsed.data,
        scope: ctx.principal.kind === "peer-fieldd" ? "local" : parsed.data.scope,
        limit: tailnetRowLimit(ctx.principal, parsed.data.limit, INDEX_MESH.PAGE_DEFAULT_LIMIT),
      });
      // PJ-4 (A-D4) — the join column: each row's PJ project, from THIS
      // desktop's grouping at this moment, for a caller the projects answer
      // (a window, the phone) and never a peer daemon (DS-L4)
      return readsProjects(ctx) ? { ...page, rows: projectDoors.keyed(page.rows) } : page;
    });
    api.register("index.search", async (ctx, params) => {
      const parsed = IndexSearchParams.safeParse(params);
      if (!parsed.success)
        throw new RpcCallError(
          "PRECONDITION_FAILED",
          'expected { q, nativeSessionIds?, afterMs?, limit?, prefix?, kind?, scope?: "local" | "mesh", devices? }',
          false,
        );
      // SP-D13 — one bounded question for every arm: the local search asks
      // rosettad for that many, and a mesh ask forwards it to each desktop and
      // cuts the merge at it (index-mesh.ts)
      const question = {
        ...parsed.data,
        limit: tailnetRowLimit(ctx.principal, parsed.data.limit, DEFAULT_SEARCH_LIMIT),
      };
      // PJ-4 — each hit carries its root's project key, for a caller the
      // projects answer (the Peek's "Every project"); never a peer daemon
      const keyHits = (answer: IndexSearchResult): IndexSearchResult =>
        readsProjects(ctx) ? { ...answer, hits: projectDoors.keyed(answer.hits) } : answer;
      if (question.scope === "mesh" && ctx.principal.kind !== "peer-fieldd")
        return keyHits(await requireMesh().search(question));
      if (ctx.principal.kind !== "peer-fieldd") return keyHits(await index.search(question));
      // a peer's ask is ANSWERED: an index that is not up is the honest
      // `answered: false`, which the asking desktop's `sources` reads as
      // `building` (as index-mesh's `#askPeer` reads UNAVAILABLE {service:
      // "index"}). *Corrected 2026-10-01 (the DS landing review, S3):* this
      // said a refusal would make the asker's PeerLink "drop the shared link"
      // — false since DS-2's `isRemoteAnswer` (peer-link.ts) passes every
      // coded reply through. The answer stays because it is honest, not
      // because a refusal would cut anything.
      try {
        return await index.search(question);
      } catch (error) {
        if (!(error instanceof RpcCallError) || error.kind !== "UNAVAILABLE") throw error;
        return {
          answered: false,
          state: { readiness: "unknown", detail: "this desktop's index is not up" },
          hits: [],
          clipped: false,
        };
      }
    });
    api.register("index.projects", (ctx, params) => {
      const parsed = IndexProjectsParams.safeParse(params ?? {});
      if (!parsed.success)
        throw new RpcCallError(
          "PRECONDITION_FAILED",
          'expected { scope?: "local" | "mesh", family?, devices?, cursor?, limit? (1..500) }',
          false,
        );
      return requireMesh().projects({
        ...parsed.data,
        scope: ctx.principal.kind === "peer-fieldd" ? "local" : parsed.data.scope,
        limit: tailnetRowLimit(ctx.principal, parsed.data.limit, INDEX_MESH.PAGE_DEFAULT_LIMIT),
      });
    });
    /** SP-1 — a whole-value stream's frame that did not land (`wholeValueDoor`),
     * logged rather than thrown into its source's listener. */
    const streamFrameFailed =
      (method: string) =>
      (error: unknown): void =>
        logger.warn("fieldd.stream_frame_failed", "A stream subscriber's frame failed", {
          method,
          error: error instanceof Error ? error.message : String(error),
        });
    // DS-6 — a visible History page's invalidation pings (rows always empty,
    // the revision moves when the scope's catalog or a desktop's standing does)
    // SP-1 — the pings' floor is a FLOOR (methods.ts declares it): a faster ask
    // is served at it, a slower one is honoured. The configured seam stands.
    const changesFloorMs =
      config.indexMesh?.changesMinIntervalMs ?? INDEX_MESH.CHANGES_MIN_INTERVAL_MS;
    api.registerSubscription("index.changes.subscribe", (_ctx, params, emit) => {
      const parsed = IndexChangesSubscribeParams.safeParse(params ?? {});
      if (!parsed.success)
        throw new RpcCallError(
          "PRECONDITION_FAILED",
          'expected { scope?: "local" | "mesh", since?: {epoch, revision}, minIntervalMs? }',
          false,
        );
      const pings = requireMesh().changes(
        { ...parsed.data, minIntervalMs: atFloor(parsed.data.minIntervalMs, changesFloorMs) },
        emit,
      );
      return { snapshot: pings.open, dispose: pings.dispose, start: pings.start };
    });
    // AR-8 (build-hf.md L1) — this desktop's DELEGATED threads, the catalog's
    // local-only table: a window's door alone (index-threads.ts — every other
    // principal is refused before a row is read). The History room hangs each
    // thread under its parent; nothing that leaves the desktop reads them.
    const threadsPage = createThreadsPager(indexCatalog);
    api.register("index.threads", (ctx, params) => {
      checkThreadsCaller(ctx);
      const page = threadsPage(params);
      // PJ-4 (A-D4) — each thread carries its ROOT's project key
      return {
        ...page,
        rows: projectDoors.keyedThreads(page.rows, (id) => indexCatalog.sessions.get(id)),
      };
    });
    // QL (QL-D9) — the empty pane launcher's list: a folder's past sessions
    // (its rosetta project) or every project's. A projection like the two
    // above; a daemon that is not ready refuses UNAVAILABLE as they do.
    api.register("index.recent", async (ctx, params) => {
      const parsed = IndexRecentParams.safeParse(params);
      if (!parsed.success)
        throw new RpcCallError(
          "PRECONDITION_FAILED",
          'expected { cwd? (an absolute folder), scope: "here" | "all", limit? (1..500) }',
          false,
        );
      // SP-D13 — bounded for a tailnet caller like the doors above (a peer
      // daemon never gets here: the door's D36 wall refuses it a `local` door)
      const recent = await index.recent({
        ...parsed.data,
        limit: tailnetRowLimit(ctx.principal, parsed.data.limit, INDEX_RECENT_DEFAULT_LIMIT),
      });
      // PJ-4 — each row carries its project's key (the join column)
      return readsProjects(ctx) ? { ...recent, rows: projectDoors.keyed(recent.rows) } : recent;
    });
    // AR-8b (thinking-ar-history-room.md §3) — the History room's reads:
    // one session's header row, a project's panels folded into one answer, one
    // day of a project's hours. `federate` (a foreign `device` forwards whole;
    // a peer daemon's ask is answered from THIS desktop's index) and, like the
    // doors above, SP-D13-bounded for a tailnet caller where an answer is a
    // per-session list — `index.project`'s contribution rows, cut at the bound
    // with `clipped`; the other figures are bounded by the window asked.
    api.register("index.session", async (_ctx, params) => {
      const parsed = IndexSessionParams.safeParse(params ?? {});
      if (!parsed.success)
        throw new RpcCallError(
          "PRECONDITION_FAILED",
          "expected { sessionId: string, device?: string }",
          false,
        );
      return await index.session(parsed.data.sessionId);
    });
    api.register("index.project", async (ctx, params) => {
      const parsed = IndexProjectParams.safeParse(params ?? {});
      if (!parsed.success)
        throw new RpcCallError(
          "PRECONDITION_FAILED",
          "expected { projectId: string, sinceMs?: ms ≥ 0, offsetMinutes?: −840…840, device?: string }",
          false,
        );
      return await index.project({
        projectId: parsed.data.projectId,
        sinceMs: parsed.data.sinceMs,
        offsetMinutes: parsed.data.offsetMinutes,
        maxContributionRows: tailnetRowLimit(ctx.principal, undefined, Number.MAX_SAFE_INTEGER),
        maxAnswerBytes: peerAnswerBytes(ctx.principal),
      });
    });
    api.register("index.projectDay", async (_ctx, params) => {
      const parsed = IndexProjectDayParams.safeParse(params ?? {});
      if (!parsed.success)
        throw new RpcCallError(
          "PRECONDITION_FAILED",
          "expected { projectId: string, day: YYYY-MM-DD, offsetMinutes?: −840…840, device?: string }",
          false,
        );
      return await index.projectDay(parsed.data);
    });
    // TL (docket v9, RULED 2026-10-09: T4, T5, B-D4) — the record's sessions
    // and turns in a window of at most a day, for Godview's timeline and,
    // later, the phone. `federate`: a foreign `device` forwards whole (an
    // asleep peer is the forwarder's refusal, never an empty day) and a peer's
    // ask is answered from THIS desktop's record. SP-D13-bounded for a tailnet
    // caller, newest sessions first, `clipped` saying so. Never a transcript
    // read: rosettad's turns or the catalog's bounds (index-activity.ts).
    api.register("index.activity", async (ctx, params) => {
      const parsed = IndexActivityParams.safeParse(params ?? {});
      if (!parsed.success)
        throw new RpcCallError(
          "PRECONDITION_FAILED",
          "expected { sinceMs, untilMs (after sinceMs, at most a day later), sessions? (1..256 ids), silenceMs? (60 000..3 600 000 ms), device? }",
          false,
        );
      const { sinceMs, untilMs, sessions, silenceMs } = parsed.data;
      const answer = await activity.read({
        sinceMs,
        untilMs,
        ...(sessions !== undefined ? { sessions } : {}),
        ...(silenceMs !== undefined ? { silenceMs } : {}),
      });
      return clipActivity(
        answer,
        tailnetRowLimit(ctx.principal, undefined, Number.MAX_SAFE_INTEGER),
      );
    });
    // SP-6 (thinking-sync-planes.md §5.4 "until RO-1"; SP-D5 (a)) — one
    // session's transcript over the door until the ticket: the page door and
    // the live tail. SP-D13-bounded for a tailnet caller like the doors above:
    // a phone's page is cut at INDEX_TAILNET_LIMITS.MAX_ROWS and says
    // `clipped`; its tail's snapshot frames carry the newest MAX_ROWS rows
    // (the rows before them are the page door's); a window keeps rosetta's
    // own page and snapshot whole. The tail's floor is the registry's
    // (`atFloor`: a slower ask is honoured, a faster one served at the floor).
    api.register("index.timeline", async (ctx, params) => {
      const parsed = IndexTimelineParams.safeParse(params ?? {});
      if (!parsed.success)
        throw new RpcCallError(
          "PRECONDITION_FAILED",
          `expected { sessionId: string, cursor?: string, limit?: 1..${INDEX_TIMELINE.PAGE_MAX_LIMIT} }`,
          false,
        );
      const asked = parsed.data.limit ?? INDEX_TIMELINE.PAGE_DEFAULT_LIMIT;
      const limit =
        tailnetRowLimit(ctx.principal, parsed.data.limit, INDEX_TIMELINE.PAGE_DEFAULT_LIMIT) ??
        asked;
      return await index.timeline({
        sessionId: parsed.data.sessionId,
        cursor: parsed.data.cursor,
        limit,
        boundedBelow: limit < asked,
      });
    });
    api.registerSubscription("index.session.subscribe", async (ctx, params, emit) => {
      const parsed = IndexSessionSubscribeParams.safeParse(params ?? {});
      if (!parsed.success)
        throw new RpcCallError(
          "PRECONDITION_FAILED",
          "expected { sessionId: string, since?: {epoch, revision}, minIntervalMs? }",
          false,
        );
      // the header first: a session the index does not hold is NOT_FOUND
      // here, in fieldd's own words — rosetta's socket would greet, send an
      // internal error and close, and its client would retry that for ever
      await index.session(parsed.data.sessionId);
      const opened = await indexTail.subscribe(
        parsed.data.sessionId,
        {
          minIntervalMs: atFloor(
            parsed.data.minIntervalMs,
            INDEX_MESH.SESSION_TAIL_MIN_INTERVAL_MS,
          ),
          rowBound:
            tailnetRowLimit(ctx.principal, undefined, Number.MAX_SAFE_INTEGER) ??
            Number.MAX_SAFE_INTEGER,
          since: parsed.data.since,
        },
        emit,
      );
      return { snapshot: opened.open, dispose: opened.dispose, start: opened.start };
    });
    // PJ-3 — the projects' doors (projects/project-doors.ts; PJ-D15 (a);
    // build-pj23.md D8–D10; P1/P2 (a) 2026-10-08): what `projectGroups`
    // groups over every self desktop's places, served from this desktop's
    // merged view. In the order a caller hears its refusals: WHO (a peer
    // daemon, a guest, a plugin, an MCP agent are refused FORBIDDEN_SCOPE —
    // DS-L4 for the peer, whatever its derived preset holds; the act is a
    // desktop window's, P2), WHAT (a path anywhere in the ask is
    // `path-in-request`, P1; then the params), WHICH (a moved key follows the
    // key memory on a read and is refused `key-moved` on an act), WHETHER
    // (UNAVAILABLE {service: "projects"} before this boot's first grouping, and
    // from the act while a relink swaps the library). PJ-2: the act writes the
    // person's record through ProjectRecords (projectIntentWriter maps its
    // refusals to the doors' own). A tailnet caller's pages
    // are cut at INDEX_TAILNET_LIMITS.MAX_ROWS (`tailnetRowLimit`), and its
    // answers carry what D10 and P1 let them.
    const projectDoors = new ProjectDoors({
      groups: projectGroups,
      deviceId: () => devicesForAgents?.currentDeviceId() ?? "local",
      localSessions: () => indexCatalog.sessions.rows(),
      peerSessions: () => indexMesh?.peerRows() ?? [],
      sources: () => indexMesh?.sourcesFor("projects") ?? [],
      records: () => projectIntents,
      // PJ-4 (H2) — a project's merged figures: this desktop's parts from its
      // own index, a peer's through its `federate` door by search's rules
      // (asleep and incompatible desktops are not asked; a silent one times out)
      figures: {
        local: {
          project: (ask) => index.project(ask),
          projectDay: (ask) => index.projectDay(ask),
        },
        peer: (device, method, params) =>
          indexMesh !== null
            ? indexMesh.ask(device, method, params)
            : Promise.resolve({
                answered: false as const,
                source: {
                  device,
                  state: "timeout" as const,
                  tookMs: 0,
                  detail: "this desktop has no mesh to ask it through",
                },
              }),
      },
    });
    const projectPage = (ctx: { principal: Principal }, asked: number | undefined): number =>
      tailnetRowLimit(ctx.principal, asked, PROJECT_DOORS.PAGE_DEFAULT_LIMIT) ??
      PROJECT_DOORS.PAGE_DEFAULT_LIMIT;
    api.register("project.list", (ctx, params) => {
      const view = admitProjectReader(ctx, "project.list");
      const ask = parseProjectAsk(
        ProjectListParams,
        params,
        "expected { cursor?, limit? (1..500), devices?, q? }",
      );
      return projectDoors.list(ask, view, projectPage(ctx, ask.limit));
    });
    api.register("project.get", (ctx, params) => {
      const view = admitProjectReader(ctx, "project.get");
      const ask = parseProjectAsk(
        ProjectGetParams,
        params,
        "expected { key } or { anchor: root:<sha> | remote:<key> | place:<placeId> }",
      );
      return projectDoors.get(ask, view);
    });
    api.register("project.sessions", (ctx, params) => {
      const view = admitProjectReader(ctx, "project.sessions");
      const ask = parseProjectAsk(
        ProjectSessionsParams,
        params,
        "expected { key, places?: {device, placeId}[], devices?, agents?, cursor?, limit? (1..500) }",
      );
      return projectDoors.sessions(ask, view, projectPage(ctx, ask.limit));
    });
    // PJ-4 (H2 (a)) — a project's merged figures: every (desktop, rosetta
    // project) its sessions are filed under, summed, with each desktop's
    // standing and what is partial (projects/project-figures.ts). The reads'
    // gate (D8: never a peer daemon) and P1's; a tailnet caller's contribution
    // rows are cut at its bound with `clipped`.
    api.register("project.figures", async (ctx, params) => {
      admitProjectReader(ctx, "project.figures");
      const ask = parseProjectAsk(
        ProjectFiguresParams,
        params,
        "expected { key, sinceMs?: ms ≥ 0, offsetMinutes?: −840…840 }",
      );
      return await projectDoors.figures(
        ask,
        tailnetRowLimit(ctx.principal, undefined, Number.MAX_SAFE_INTEGER),
      );
    });
    api.register("project.figuresDay", async (ctx, params) => {
      admitProjectReader(ctx, "project.figuresDay");
      const ask = parseProjectAsk(
        ProjectFiguresDayParams,
        params,
        "expected { key, day: YYYY-MM-DD, offsetMinutes?: −840…840 }",
      );
      return await projectDoors.figuresDay(ask);
    });
    api.registerSubscription("project.subscribe", (ctx, params, emit) => {
      admitProjectReader(ctx, "project.subscribe");
      const ask = parseProjectAsk(
        ProjectSubscribeParams,
        params,
        "expected { since?: {epoch, revision}, minIntervalMs? }",
      );
      const pings = projectDoors.subscribe(ask, emit);
      return { snapshot: pings.open, dispose: pings.dispose, start: pings.start };
    });
    api.register("project.intent", async (ctx, params) => {
      admitProjectWriter(ctx, "project.intent");
      const ask = parseProjectAsk(
        ProjectIntentParams,
        params,
        "expected { key, op: rename {name} | pin {pinned} | hide {hidden} | link {place} | split {place} | dismiss {with} }",
      );
      return await projectDoors.intent(ask);
    });
    // SP-3 — the direct plane's door (methods.ts; index-serve.ts). AR-8b: it
    // mints for a window on this desktop — every refusal said first, then the
    // mint inside its audited attempt (a ticket is a grant: D6's rule, the
    // terminal mint's precedent), the record naming the session, what the
    // grant may do (RO-13: `files` for the desktop window) and when it
    // expires, never the grant.
    // FS-1a — the files service's door tier (workspace/doors.ts): bounded rows
    // from the files worker, gated by PRINCIPAL (FS-D6 (a)) — a plugin, an MCP
    // agent and a guest are refused whatever they hold — cut at the tailnet's
    // page for a phone (L4), honest UNAVAILABLE {service: "workspace"} while
    // the worker cannot answer. `federate`: a foreign `device` forwards whole.
    const workspacePicker = new WorkspacePicker({
      registry: workspace.registry,
      audit,
      choose: (ctx) =>
        api.callShellProvider(ctx, "shell.dialog.pickFolder", { purpose: "workspace.export" }),
      isCurrent: (ctx) =>
        ctx.principal.kind === "local-token" && windowTokenIds.has(ctx.principal.tokenId),
    });
    api.register("workspace.pickFolder", (ctx, params) => workspacePicker.pick(ctx, params));
    api.register("workspace.roots", (ctx, params) => workspace.doors.roots(ctx, params));
    api.register("workspace.list", (ctx, params) => workspace.doors.list(ctx, params));
    api.register("workspace.search", (ctx, params) => workspace.doors.search(ctx, params));
    api.register("workspace.gitFacts", (ctx, params) => workspace.doors.gitFacts(ctx, params));
    api.registerSubscription("workspace.subscribe", (ctx, params, emit) =>
      workspace.doors.subscribe(ctx, params, emit),
    );
    api.register("workspace.closeTicket", (ctx, params) => workspace.tickets.close(ctx, params));
    api.register("workspace.openTicket", async (ctx, params) => {
      const ask = workspace.tickets.check(ctx, params);
      return audit.required(
        ctx,
        {
          action: "workspace.ticket.mint",
          target: { kind: "workspace-root", id: ask.root.rootId },
          // R6 — the session's own rows (establish, end) carry the same id
          sessionId: ask.attachId,
        },
        () => workspace.tickets.mint(ask, () => windowTokenIds.has(ask.clientId)),
        (ticket) => ({
          outcome: "succeeded",
          attrs: { expiresAt: ticket.expiresAt, access: ticket.access },
        }),
        (ticket) => workspace.tickets.closeForClient(ask.clientId, ticket.ticket).then(() => {}),
      );
    });
    api.register("workspace.fileAction", async (ctx, params) => {
      const parsed = WorkspaceFileActionParams.safeParse(params);
      if (!parsed.success)
        throw new RpcCallError("PRECONDITION_FAILED", "expected {rootId, path, action}", false);
      const ask = workspace.tickets.check(ctx, parsed.data);
      try {
        const path = await workspace.supervisor.request("resolve", {
          rootPath: ask.root.path,
          segments: ask.segments,
          file: true,
        });
        if (parsed.data.action === "revealInFileManager") {
          if (!api.revealPathAvailable())
            throw new RpcCallError("UNAVAILABLE", "The desktop shell is not answering", true);
          await api.revealPath({ path });
        }
        return { path };
      } catch (error) {
        return workspaceError(error);
      }
    });
    api.register("index.openTicket", async (ctx, params) => {
      const ask = indexTickets.check(ctx, params);
      return await audit.required(
        ctx,
        { action: "index.ticket.mint", target: { kind: "index-session", id: ask.auditId } },
        () => indexTickets.mint(ctx, ask),
        (ticket) => ({
          outcome: "succeeded",
          attrs: { expiresAt: ticket.expiresAt, scope: [...ask.scope] },
        }),
      );
    });
    // DS-6 — the history catalog, as rows (DS-L3): the PEER replication door.
    // A self peer's daemon lists once and watches from its cursor; nothing else
    // is admitted — a window or the phone pages the merged replica through the
    // doors instead (DS-L4), and the rows are `index.search` content. Before
    // this boot's first snapshot the tables do not speak for the index, so the
    // door says so rather than answering an empty table a peer would REPLACE
    // its copy with.
    api.registerSubscription("index.catalog.subscribe", (ctx, params, emit) => {
      if (ctx.principal.kind !== "peer-fieldd") {
        throw new RpcCallError(
          "FORBIDDEN_SCOPE",
          "index.catalog.subscribe is the peer replication door; windows page index.sessions and index.projects",
          false,
          { method: "index.catalog.subscribe" },
        );
      }
      const parsed = IndexCatalogSubscribeParams.safeParse(params ?? {});
      if (!parsed.success)
        throw new RpcCallError(
          "PRECONDITION_FAILED",
          'expected { table: "projects" | "sessions", since?: {epoch, revision}, minIntervalMs? }',
          false,
        );
      // The honest state (SP-L8): UNAVAILABLE {service, state}, retryable —
      // the replica asks again on its backoff, and its link stands.
      // *Corrected 2026-10-01 (the DS landing review, S3):* this door answered
      // PRECONDITION_FAILED on the premise that a peer's PeerLink reads a
      // remote UNAVAILABLE as a dead transport and drops the shared link. The
      // premise was stale before the door landed — DS-2's `isRemoteAnswer`
      // (peer-link.ts) passes any CODED reply through, UNAVAILABLE included,
      // and drops nothing — and the swap did harm: FielddClient replayed its
      // subscriptions inside hello's try, where PRECONDITION_FAILED is
      // TERMINAL, so a desktop restarting with this catalog not yet read
      // failed its peer's whole client — every subscription on the link
      // dropped — again on each re-dial until the catalog was ready. The
      // hazard was the replay, and it is isolated now (fieldd-client: a
      // refused replay ends one subscription; PeerLink hands it to its owner).
      if (!indexCatalog.ready)
        throw new RpcCallError(
          "UNAVAILABLE",
          "the history catalog has not read the index yet",
          true,
          { service: "index", state: indexCatalog.phase },
        );
      const pump = indexCatalog.pump(parsed.data.table, {
        since: parsed.data.since,
        // SP-1 — ROWS' floor is a FLOOR at this door (methods.ts declares it)
        minIntervalMs: atFloor(parsed.data.minIntervalMs, ROWS.MIN_INTERVAL_MS),
        ...(config.indexCatalog?.digestIntervalMs !== undefined
          ? { digestIntervalMs: config.indexCatalog.digestIntervalMs }
          : {}),
        emit,
      });
      return { snapshot: pump.open, dispose: () => pump.dispose(), start: () => pump.start() };
    });
    api.register("index.enroll", async (ctx, params) => {
      const parsed = IndexEnrollParams.safeParse(params);
      if (!parsed.success)
        throw new RpcCallError("PRECONDITION_FAILED", "expected { kinds: string[] }", false);
      const kinds = [...new Set(parsed.data.kinds)].sort();
      return await audit.required(
        ctx,
        {
          action: "index.enroll",
          target: { kind: "index", id: "enrollment" },
          attrs: { kinds, kindCount: kinds.length },
        },
        () => index.enroll(kinds),
        (result) => ({ attrs: { changed: result.changed, phase: result.status.phase } }),
      );
    });
    api.register("index.retire", async (ctx, params) => {
      const parsed = IndexRetireParams.safeParse(params);
      if (!parsed.success)
        throw new RpcCallError("PRECONDITION_FAILED", "expected { runtimeId }", false);
      return await audit.required(
        ctx,
        {
          action: "index.retire",
          target: { kind: "index-runtime", id: parsed.data.runtimeId },
        },
        () => index.retire(parsed.data.runtimeId),
        (result) => ({ attrs: { changed: result.changed, phase: result.status.phase } }),
      );
    });
    // AR-2 — the agent runtime doors (thinking-ar-data-topology.md §4;
    // agent-runtime.ts). Personas ride agent.spawn (a persona is what one
    // spawns as); distribution rides the local-only agents.manage. Every
    // mutation is audited; the persona path enrolls through the index service
    // and a persona's root never leaves fieldd.
    api.register("agents.profiles.list", async (_ctx, params) => {
      const parsed = AgentsProfilesListParams.safeParse(params ?? {});
      if (!parsed.success)
        throw new RpcCallError("PRECONDITION_FAILED", "expected { provider? }", false);
      return await agents.profiles.personas(parsed.data.provider);
    });
    api.register("agents.profiles.create", async (ctx, params) => {
      const parsed = AgentsProfilesCreateParams.safeParse(params);
      if (!parsed.success)
        throw new RpcCallError("PRECONDITION_FAILED", "expected { set, provider }", false);
      return await audit.required(
        ctx,
        {
          // the id is minted inside the effect; the outcome record names it
          action: "agents.profiles.create",
          target: { kind: "agent-persona", id: "pending" },
          attrs: { provider: parsed.data.provider, set: parsed.data.set },
        },
        () => agents.profiles.createPersona(parsed.data),
        (result) => ({
          outcome: "succeeded",
          attrs: {
            profileId: result.persona.profileId,
            indexed: result.persona.runtimeId !== undefined,
          },
        }),
      );
    });
    api.register("agents.profiles.delete", async (ctx, params) => {
      const parsed = AgentsProfilesDeleteParams.safeParse(params);
      if (!parsed.success)
        throw new RpcCallError("PRECONDITION_FAILED", "expected { profileId }", false);
      return await audit.required(
        ctx,
        {
          action: "agents.profiles.delete",
          target: { kind: "agent-persona", id: parsed.data.profileId },
        },
        // AR-D25 — sign out: retired now, finished when its sessions end
        () => agents.profiles.signOut(parsed.data.profileId),
        (result) => ({
          attrs: {
            deleted: result.deleted,
            ...(result.waiting !== undefined ? { waiting: result.waiting } : {}),
          },
        }),
      );
    });
    api.register("agents.profiles.verify", async (ctx, params) => {
      const parsed = AgentsProfilesVerifyParams.safeParse(params);
      if (!parsed.success)
        throw new RpcCallError("PRECONDITION_FAILED", "expected { profileId }", false);
      return await audit.required(
        ctx,
        {
          action: "agents.profiles.verify",
          target: { kind: "agent-persona", id: parsed.data.profileId },
        },
        () => agents.profiles.verifyPersona(parsed.data.profileId),
        (result) => ({
          attrs: {
            ...(result.persona.identity !== undefined
              ? { loggedIn: result.persona.identity.loggedIn }
              : {}),
            ...(result.failure !== undefined ? { failure: result.failure.status } : {}),
          },
        }),
      );
    });
    // AR-S2 — Agent Profiles (agent-profiles.ts): puppeteer's profile sets,
    // each one folder under this user. The list and its subscription are
    // reads; create, update and delete are audited; Show in Finder changes
    // nothing. A delete stops the profile's sessions first.
    api.register("agents.profileSets.list", async (_ctx, params) => {
      const parsed = AgentsProfileSetsListParams.safeParse(params ?? {});
      if (!parsed.success)
        throw new RpcCallError("PRECONDITION_FAILED", "expected { refresh? }", false);
      // a refresh is an ask: This Mac's sign-ins are read again, and the
      // frames that follow carry them (the answer says `reading`)
      if (parsed.data.refresh === true) void agents.profiles.readNativeIdentities();
      return await agents.profiles.sets();
    });
    api.registerSubscription("agents.profileSets.subscribe", async (_ctx, _params, emit) => {
      // The snapshot first: a frame emitted before the reply names a
      // subscription the client does not know yet, and would be dropped; and a
      // read that throws leaves no subscriber behind. What changed while it was
      // read arrives as the next frame.
      // SP-1 — the frames are PUSHED whole (the sets' own 16 ms publisher), so
      // the newest one stands and the stream floor coalesces them
      // (`wholeValueDoor`); a frame equal to what this reader holds is not sent.
      let latest = await agents.profiles.sets();
      const door = wholeValueDoor(
        {
          read: () => latest,
          onChange: (listener) =>
            agents.profiles.subscribe((frame) => {
              latest = frame;
              listener();
            }),
        },
        emit,
        { onError: streamFrameFailed("agents.profileSets.subscribe") },
      );
      agents.profiles.publish();
      return door;
    });
    api.register("agents.profileSets.create", async (ctx, params) => {
      const parsed = AgentsProfileSetsCreateParams.safeParse(params);
      if (!parsed.success)
        throw new RpcCallError(
          "PRECONDITION_FAILED",
          "expected { label, glyph?, default? }",
          false,
        );
      return await audit.required(
        ctx,
        {
          // the id is made from the name inside the effect; the outcome names it
          action: "agents.profile_sets.create",
          target: { kind: "agent-profile", id: "pending" },
          attrs: { ...(parsed.data.default === true ? { default: true } : {}) },
        },
        () => agents.profiles.createSet(parsed.data),
        (result) => ({ outcome: "succeeded", attrs: { set: result.set.id } }),
      );
    });
    api.register("agents.profileSets.update", async (ctx, params) => {
      const parsed = AgentsProfileSetsUpdateParams.safeParse(params);
      if (!parsed.success)
        throw new RpcCallError(
          "PRECONDITION_FAILED",
          "expected { set, label?, glyph?, default?: true }",
          false,
        );
      return await audit.required(
        ctx,
        {
          action: "agents.profile_sets.update",
          target: { kind: "agent-profile", id: parsed.data.set },
          attrs: {
            ...(parsed.data.label !== undefined ? { renamed: true } : {}),
            ...(parsed.data.glyph !== undefined ? { glyph: parsed.data.glyph } : {}),
            ...(parsed.data.default === true ? { default: true } : {}),
          },
        },
        () => agents.profiles.updateSet(parsed.data),
      );
    });
    api.register("agents.profileSets.delete", async (ctx, params) => {
      const parsed = AgentsProfileSetsDeleteParams.safeParse(params);
      if (!parsed.success) throw new RpcCallError("PRECONDITION_FAILED", "expected { set }", false);
      return await audit.required(
        ctx,
        {
          action: "agents.profile_sets.delete",
          target: { kind: "agent-profile", id: parsed.data.set },
        },
        () => agents.profiles.deleteSet(parsed.data.set),
        (result) => ({ attrs: { deleted: result.deleted, stopped: result.stopped } }),
      );
    });
    api.register("agents.profileSets.discard", async (ctx, params) => {
      const parsed = AgentsProfileSetsDiscardParams.safeParse(params);
      if (!parsed.success) throw new RpcCallError("PRECONDITION_FAILED", "expected { set }", false);
      return await audit.required(
        ctx,
        {
          action: "agents.profile_sets.discard",
          target: { kind: "agent-profile", id: parsed.data.set },
        },
        () => agents.profiles.discardSet(parsed.data.set),
        (result) => ({ attrs: { discarded: result.discarded, stopped: result.stopped } }),
      );
    });
    api.register("agents.profileSets.reveal", async (_ctx, params) => {
      const parsed = AgentsProfileSetsRevealParams.safeParse(params);
      if (!parsed.success)
        throw new RpcCallError("PRECONDITION_FAILED", "expected { set, provider? }", false);
      return await agents.profiles.reveal(parsed.data);
    });
    // AR-S4b — Extensions (agent-extensions.ts): one Agent Profile's lens,
    // what each of its agents holds, read from the agents' own stores. Reads
    // only; a read runs when asked (`refresh`, or the first time) and its
    // frame reaches the profile's subscribers.
    api.register("agents.extensions.list", async (_ctx, params) => {
      const parsed = AgentsExtensionsListParams.safeParse(params);
      if (!parsed.success)
        throw new RpcCallError("PRECONDITION_FAILED", "expected { set, refresh? }", false);
      return await agents.extensions.list(parsed.data.set, parsed.data.refresh === true);
    });
    api.registerSubscription("agents.extensions.subscribe", async (_ctx, params, emit) => {
      const parsed = AgentsExtensionsSubscribeParams.safeParse(params);
      if (!parsed.success) throw new RpcCallError("PRECONDITION_FAILED", "expected { set }", false);
      // The last read, or the profile's agents while the first runs; the
      // finished read follows as a frame.
      return await agents.extensions.subscribe(parsed.data.set, (frame) => emit(frame));
    });
    // AR-S4c — an act (RFC 006 C2): the agent's own command or protocol
    // changes one thing it holds, so it is audited like an update; its output
    // rides the profile's frames and the answer is the receipt puppeteer
    // read back, never the output.
    api.register("agents.extensions.act", async (ctx, params) => {
      const parsed = AgentsExtensionsActParams.safeParse(params);
      if (!parsed.success)
        throw new RpcCallError(
          "PRECONDITION_FAILED",
          "expected { set, provider, kind, id, act }",
          false,
        );
      // AR-S4e2 — a source a person typed (a folder, an address) is not recorded
      const item = parsed.data.source !== undefined ? "source" : parsed.data.id;
      return await audit.required(
        ctx,
        {
          action: "agents.extensions.act",
          target: {
            kind: "agent-extension",
            id: `${parsed.data.provider}:${parsed.data.kind}:${item}`.slice(0, 256),
          },
          attrs: { set: parsed.data.set, act: parsed.data.act },
        },
        () => agents.extensions.act(parsed.data),
        (result) => ({
          attrs: {
            status: result.receipt.status,
            ...(result.receipt.exitCode !== undefined ? { exitCode: result.receipt.exitCode } : {}),
          },
        }),
      );
    });
    // AR-S4c — a remote server's sign-in: the agent's own login in a pane on
    // the page, as a persona's is (`agents.profiles.login`), so it is audited
    // like one; the receipt follows on the subscription when the pane ends.
    api.register("agents.extensions.signIn", async (ctx, params) => {
      const parsed = AgentsExtensionsSignInParams.safeParse(params);
      if (!parsed.success)
        throw new RpcCallError("PRECONDITION_FAILED", "expected { set, provider, id }", false);
      return await audit.required(
        ctx,
        {
          action: "agents.extensions.sign_in",
          target: {
            kind: "agent-extension",
            id: `${parsed.data.provider}:mcp-server:${parsed.data.id}`.slice(0, 256),
          },
          attrs: { set: parsed.data.set },
        },
        () => agents.extensions.signIn(parsed.data, ctx.principal),
        (result) => ({ outcome: "succeeded", attrs: { sessionId: result.terminal.sessionId } }),
      );
    });
    // AR-S4d — Add server: the definition kept once for the profile and each
    // value it reads (the keychain), then each agent's own add in turn. Audited
    // like an act; the ledger names the values it kept by count, never by value.
    api.register("agents.extensions.add", async (ctx, params) => {
      const parsed = AgentsExtensionsAddParams.safeParse(params);
      if (!parsed.success)
        throw new RpcCallError(
          "PRECONDITION_FAILED",
          "expected { set, name, definition, values?, agents }",
          false,
        );
      return await audit.required(
        ctx,
        {
          action: "agents.extensions.add",
          target: {
            kind: "agent-extension",
            id: `${parsed.data.set}:mcp-server:${parsed.data.name}`.slice(0, 256),
          },
          attrs: {
            set: parsed.data.set,
            agents: parsed.data.agents.join(",").slice(0, 256),
            values: Object.keys(parsed.data.values ?? {}).length,
          },
        },
        () => agents.extensions.add(parsed.data),
        (result) => ({
          attrs: {
            changed: result.receipts.filter((entry) => entry.receipt.status === "changed").length,
          },
        }),
      );
    });
    // AR-S4d — what an Add would run on each agent, before anything is kept: a read
    api.register("agents.extensions.plan", async (_ctx, params) => {
      const parsed = AgentsExtensionsPlanParams.safeParse(params);
      if (!parsed.success)
        throw new RpcCallError("PRECONDITION_FAILED", "expected { set, name, definition }", false);
      return await agents.extensions.plan(parsed.data);
    });
    // AR-S4d2 — Add skill: a folder copied into the profile's skills folder, then
    // each agent given a link to it (audited; the folder a person named is not recorded)
    api.register("agents.extensions.addSkill", async (ctx, params) => {
      const parsed = AgentsExtensionsAddSkillParams.safeParse(params);
      if (!parsed.success)
        throw new RpcCallError("PRECONDITION_FAILED", "expected { set, from, agents }", false);
      return await audit.required(
        ctx,
        {
          action: "agents.extensions.add_skill",
          target: { kind: "agent-extension", id: `${parsed.data.set}:skill`.slice(0, 256) },
          attrs: {
            set: parsed.data.set,
            agents: parsed.data.agents.join(",").slice(0, 256),
          },
        },
        () => agents.extensions.addSkill(parsed.data),
        (result) => ({
          attrs: {
            skill: result.name.slice(0, 128),
            changed: result.receipts.filter((entry) => entry.receipt.status === "changed").length,
          },
        }),
      );
    });
    // AR-S4d2 — the folder read and each agent's line, before anything is copied: a read
    api.register("agents.extensions.planSkill", async (_ctx, params) => {
      const parsed = AgentsExtensionsPlanSkillParams.safeParse(params);
      if (!parsed.success)
        throw new RpcCallError("PRECONDITION_FAILED", "expected { set, from }", false);
      return await agents.extensions.planSkill(parsed.data);
    });
    // AR-S4e2 — what one agent could install, from the catalogs it already fetched: a read
    api.register("agents.extensions.catalog", async (_ctx, params) => {
      const parsed = AgentsExtensionsCatalogParams.safeParse(params);
      if (!parsed.success)
        throw new RpcCallError("PRECONDITION_FAILED", "expected { set, provider }", false);
      return await agents.extensions.catalog(parsed.data);
    });
    // AR-S4e2 — "Check for updates": the agent's own fetch of each catalog, audited like an act
    api.register("agents.extensions.check", async (ctx, params) => {
      const parsed = AgentsExtensionsCheckParams.safeParse(params);
      if (!parsed.success)
        throw new RpcCallError("PRECONDITION_FAILED", "expected { set, provider }", false);
      return await audit.required(
        ctx,
        {
          action: "agents.extensions.check",
          target: {
            kind: "agent-extension",
            id: `${parsed.data.provider}:marketplace:catalogs`.slice(0, 256),
          },
          attrs: { set: parsed.data.set },
        },
        () => agents.extensions.check(parsed.data),
        (result) => ({ attrs: { status: result.receipt.status, updates: result.updates } }),
      );
    });
    // AR-S4e2 — what a typed source would run, before anything runs: a read
    api.register("agents.extensions.planSource", async (_ctx, params) => {
      const parsed = AgentsExtensionsPlanSourceParams.safeParse(params);
      if (!parsed.success)
        throw new RpcCallError(
          "PRECONDITION_FAILED",
          "expected { set, provider, kind, source }",
          false,
        );
      return await agents.extensions.planSource(parsed.data);
    });
    // AR-S4e2 — an act the person answers in a pane (an install that asks first),
    // as a sign-in is: it takes `agent.spawn`, audited; a typed source is not recorded
    api.register("agents.extensions.terminal", async (ctx, params) => {
      const parsed = AgentsExtensionsTerminalParams.safeParse(params);
      if (!parsed.success)
        throw new RpcCallError(
          "PRECONDITION_FAILED",
          "expected { set, provider, kind, id, act }",
          false,
        );
      const item = parsed.data.source !== undefined ? "source" : parsed.data.id;
      return await audit.required(
        ctx,
        {
          action: "agents.extensions.terminal",
          target: {
            kind: "agent-extension",
            id: `${parsed.data.provider}:${parsed.data.kind}:${item}`.slice(0, 256),
          },
          attrs: { set: parsed.data.set, act: parsed.data.act },
        },
        () => agents.extensions.terminal(parsed.data, ctx.principal),
        (result) => ({ outcome: "succeeded", attrs: { sessionId: result.terminal.sessionId } }),
      );
    });
    api.register("agents.installs", async (_ctx, params) => {
      const parsed = AgentsInstallsParams.safeParse(params ?? {});
      if (!parsed.success)
        throw new RpcCallError("PRECONDITION_FAILED", "expected { provider?, refresh? }", false);
      return await agents.distribution.installs(parsed.data.provider, {
        refresh: parsed.data.refresh === true,
      });
    });
    api.register("agents.releases", async (_ctx, params) => {
      const parsed = AgentsReleasesParams.safeParse(params ?? {});
      if (!parsed.success)
        throw new RpcCallError(
          "PRECONDITION_FAILED",
          "expected { provider?, network?, cached? }",
          false,
        );
      return await agents.distribution.releases(parsed.data);
    });
    api.register("agents.update", async (ctx, params) => {
      const parsed = AgentsUpdateParams.safeParse(params);
      if (!parsed.success)
        throw new RpcCallError("PRECONDITION_FAILED", "expected { provider }", false);
      return await audit.required(
        ctx,
        {
          action: "agents.update",
          target: { kind: "agent-provider", id: parsed.data.provider },
        },
        async () => {
          try {
            return await agents.distribution.update(parsed.data.provider);
          } finally {
            // AR-7b — an update can move, replace or remove the executable a
            // launcher names (the install inventory publishes no change of
            // its own): the launchers are written again, whatever the receipt
            refreshGateway();
          }
        },
        (result) => ({
          attrs: {
            status: result.receipt.status,
            ...(result.receipt.exitCode !== undefined ? { exitCode: result.receipt.exitCode } : {}),
          },
        }),
      );
    });
    api.register("agents.setActive", async (ctx, params) => {
      const parsed = AgentsSetActiveParams.safeParse(params);
      if (!parsed.success)
        throw new RpcCallError("PRECONDITION_FAILED", "expected { provider, executable }", false);
      return await audit.required(
        ctx,
        {
          action: "agents.set_active",
          target: { kind: "agent-provider", id: parsed.data.provider },
          attrs: { executable: parsed.data.executable },
        },
        async () => {
          try {
            return await agents.distribution.setActive(parsed.data);
          } finally {
            refreshGateway(); // AR-7b — it read the device again
          }
        },
        (result) => ({ attrs: { changed: result.changed } }),
      );
    });
    // The Agents settings section: an update's own output while it runs
    // (whole snapshots at the tick — display text, the receipt is the
    // outcome), and Show in Finder for a path fieldd's inventory holds. Both
    // are reads; neither is audited (a reveal changes nothing).
    api.registerSubscription("agents.operations.subscribe", (_ctx, _params, emit) => {
      const dispose = agents.distribution.subscribeOperations((snapshot) => emit(snapshot));
      return { snapshot: agents.distribution.operationsSnapshot(), dispose };
    });
    api.register("agents.reveal", async (_ctx, params) => {
      const parsed = AgentsRevealParams.safeParse(params);
      if (!parsed.success)
        throw new RpcCallError("PRECONDITION_FAILED", "expected { provider, executable }", false);
      return await agents.distribution.reveal(parsed.data);
    });
    // Stop ends the updater's whole process tree — a mutation, so audited;
    // the update's own call then answers its receipt, marked stopped.
    api.register("agents.update.stop", async (ctx, params) => {
      const parsed = AgentsUpdateStopParams.safeParse(params);
      if (!parsed.success)
        throw new RpcCallError("PRECONDITION_FAILED", "expected { provider }", false);
      return await audit.required(
        ctx,
        {
          action: "agents.update.stop",
          target: { kind: "agent-provider", id: parsed.data.provider },
        },
        async () => agents.distribution.stop(parsed.data.provider),
        (result) => ({ attrs: { stopped: result.stopped } }),
      );
    });
    // AR-3 — managed sessions (agent-runtime.ts, the fold). A spawn and a
    // resume are audited like a terminal birth (attempt-before-effect; the
    // run id and the terminal id ride the outcome); the login pane like a
    // persona mutation. The reads are the fold, unaudited like terminal.list.
    api.register("agent.providers", async () => await agents.providers());
    // AC-3 — the catalog (thinking-ar-agent-catalog.md §5.1): the visible rows
    // for the caller's surface; `declined` rows never leave fieldd.
    api.register("agent.catalog", (_ctx, params) => {
      const parsed = AgentCatalogParams.safeParse(params ?? {});
      if (!parsed.success)
        throw new RpcCallError("PRECONDITION_FAILED", "expected { surface? }", false);
      return agents.visibleCatalog(parsed.data.surface);
    });
    // PJ-6 — the agent's own model picker for one Agent Profile (agent-models.ts):
    // a read, unaudited like agent.providers
    api.register("agent.models", async (_ctx, params) => {
      const parsed = AgentModelsParams.safeParse(params);
      if (!parsed.success)
        throw new RpcCallError(
          "PRECONDITION_FAILED",
          "expected { provider, profileSet?, cwd?, refresh? }",
          false,
        );
      return await agents.models(parsed.data);
    });
    api.register("agent.spawn", async (ctx, params) => {
      const parsed = AgentSpawnParams.safeParse(params);
      if (!parsed.success)
        throw new RpcCallError(
          "PRECONDITION_FAILED",
          "expected { provider, cwd? | place?, profileId?, profileSet?, title?, modelSelection? } — a place or a cwd, never both",
          false,
        );
      // PJ-6 — the ledger says a launch asked for a model and that it was
      // applied, never which: the ids are the agent's own words (AR-L1)
      const selected = parsed.data.modelSelection !== undefined;
      return await audit.required(
        ctx,
        {
          action: "agent.session.spawn",
          target: { kind: "agent-session", id: "pending" },
          attrs: {
            provider: parsed.data.provider,
            ...(parsed.data.cwd !== undefined ? { cwd: parsed.data.cwd } : {}),
            // PJ-7 — a launch by place is ledgered by its ref, never a path
            ...(parsed.data.place !== undefined
              ? { place: { device: parsed.data.place.device, placeId: parsed.data.place.placeId } }
              : {}),
            ...(parsed.data.profileId !== undefined ? { profileId: parsed.data.profileId } : {}),
            ...(parsed.data.profileSet !== undefined ? { profileSet: parsed.data.profileSet } : {}),
            ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
            ...(selected ? { modelSelection: true } : {}),
          },
        },
        () => agents.spawn(parsed.data, ctx.principal, ctx.onBehalfOf),
        (result) => ({
          outcome: "succeeded",
          attrs: {
            runtimeRunId: result.session.runtimeRunId,
            sessionId: result.terminal.sessionId,
            ...(selected ? { modelSelection: "applied" } : {}),
          },
        }),
      );
    });
    api.register("agent.resume", async (ctx, params) => {
      const parsed = AgentResumeParams.safeParse(params);
      if (!parsed.success)
        throw new RpcCallError(
          "PRECONDITION_FAILED",
          "expected { runtimeRunId, cwd? } or { provider, nativeSessionId, cwd?, profileId? | profileSet?, title? }",
          false,
        );
      const resume = parsed.data;
      // QL-D10 — the native form names a conversation, not a run of ours: the
      // entry's target is pending like a spawn's, and the conversation rides
      // its attributes
      const run = isAgentResumeRun(resume);
      const target = run
        ? { kind: "agent-session", id: resume.runtimeRunId }
        : { kind: "agent-session", id: "pending" };
      const attrs = run
        ? {}
        : {
            provider: resume.provider,
            nativeSessionId: resume.nativeSessionId,
            ...(resume.profileId !== undefined ? { profileId: resume.profileId } : {}),
            ...(resume.profileSet !== undefined ? { profileSet: resume.profileSet } : {}),
          };
      return await audit.required(
        ctx,
        {
          action: "agent.session.resume",
          target,
          attrs: { ...attrs, ...(resume.cwd !== undefined ? { cwd: resume.cwd } : {}) },
        },
        () => agents.resume(resume, ctx.principal, ctx.onBehalfOf),
        (result) => ({
          outcome: "succeeded",
          attrs: {
            runtimeRunId: result.session.runtimeRunId,
            sessionId: result.terminal.sessionId,
            // AR-4b — a resume of a PENDING run replaced its live PTY: the
            // caller's entry says so (the daemon's own idle resume is the one
            // ledgered as the system actor)
            ...(result.session.terminal?.replaced !== undefined
              ? { how: "manual", replaced: result.session.terminal.replaced }
              : {}),
            // PJ-6 — the session's launch model applied again, or the agent's
            // own (its resume cannot take one); never which model
            ...(result.modelSelection !== undefined
              ? { modelSelection: result.modelSelection.state }
              : {}),
          },
        }),
      );
    });
    // AR-6-0 (MF-1 §10.2) — the stop verb, audited like the other two acts on a
    // run (attempt before effect; the run id on the target). The floor's own
    // answer decides the outcome: `succeeded` when it took the interrupt,
    // `denied` with its word when it would not. A refusal here is NOT an error
    // — a run that is mid-conflict with a person's typing is a state, and the
    // caller is told so rather than thrown at.
    api.register("agent.interrupt", async (ctx, params) => {
      const parsed = AgentInterruptParams.safeParse(params);
      if (!parsed.success)
        throw new RpcCallError("PRECONDITION_FAILED", "expected { runtimeRunId }", false);
      return await audit.required(
        ctx,
        {
          action: "agent.session.interrupt",
          target: { kind: "agent-session", id: parsed.data.runtimeRunId },
          attrs: { runtimeRunId: parsed.data.runtimeRunId },
        },
        () => agents.interrupt(parsed.data),
        (result) =>
          result.accepted
            ? { outcome: "succeeded", attrs: { accepted: true } }
            : {
                outcome: "denied",
                reasonCode: "REFUSED",
                // the floor's own word, never a sentence composed here
                attrs: { accepted: false, reason: result.reason },
              },
      );
    });
    // item 60 — the fold's rows whole for a window, their free texts bounded for
    // a caller across the tailnet (`agentListFor`)
    api.register("agent.list", (ctx) => agentListFor(ctx.principal.kind, agents.list()));
    // DS-3 (DS-L3) — every field and desk subscription is its own revision
    // CHAIN, and its epoch says which: this boot plus the chain's ordinal. Two
    // subscriptions in one boot never share an epoch, so no reader can mistake
    // a revision of one chain for a revision of another.
    let boardChains = 0;
    const nextBoardEpoch = (): string => `${bootId}.${++boardChains}`;
    /** One board of THIS device at a projection and a floor: a snapshot on its
     * own chain, then deltas through `emit` (`createFieldSubscription`). */
    const openLocalBoard = (
      projection: BoardProjection,
      minIntervalMs: number,
      emit: (delta: BoardDelta) => void,
      heartbeatMs?: number,
    ): LocalBoard => {
      const epoch = nextBoardEpoch();
      // MV-3a (MV-D18) — the `model` board: this desktop's own windows' cut of
      // the backend's model (`agent-model-board.ts`), at the fold's tick, urgent
      // changes ahead of it (L12). The backend is built once the roster exists;
      // a window that asks before that is told to ask again.
      if (projection === "model") {
        const service = monitor;
        if (service === null)
          throw new RpcCallError("UNAVAILABLE", "the monitor backend is not ready yet", true, {
            service: "agent-monitor",
            state: "starting",
          });
        const board = createModelSubscription({
          fold: { list: () => agents.list(), subscribe: (fn) => agents.subscribe(fn) },
          monitor: service,
          emit,
          epoch,
          minIntervalMs,
          ...(heartbeatMs !== undefined ? { heartbeatMs } : {}),
          onError: (error) =>
            logger.warn("fieldd.agents.model_frame_failed", "A model subscriber's frame failed", {
              error: error instanceof Error ? error.message : String(error),
            }),
        });
        return { snapshot: { ...board.snapshot, epoch }, dispose: board.dispose };
      }
      const board = createFieldSubscription({
        list: () => agents.list(),
        // the desk row carries the backend's model row (a PEER's cut), so a
        // backend change with no fold publish behind it — the 30 s cost step,
        // a recency flip — moves the desk board too
        subscribe:
          projection === "desk"
            ? (fn) => {
                const offFold = agents.subscribe(fn);
                const offModel = monitor?.subscribe(() => fn()) ?? (() => undefined);
                return () => {
                  offFold();
                  offModel();
                };
              }
            : (fn) => agents.subscribe(fn),
        emit,
        epoch,
        project:
          projection === "desk"
            ? deskProjector((runtimeRunId) => monitor?.rowForRun(runtimeRunId))
            : projectFieldRow,
        minIntervalMs,
        ...(heartbeatMs !== undefined ? { heartbeatMs } : {}),
        // TM-2 (F-M4) — the SAME gate the store publisher applies below. The
        // two carriers serve one board, and a row that promises a tap over one
        // leg while refusing it over the other is the false positive MF-1l
        // exists to prevent — the phone folds both legs into one card.
        terminalPublished: () => native.terminalMeshPublished(),
        onError: (error) =>
          logger.warn("fieldd.agents.field_frame_failed", "A field subscriber's frame failed", {
            error: error instanceof Error ? error.message : String(error),
          }),
      });
      return { snapshot: { ...board.snapshot, epoch }, dispose: board.dispose };
    };
    /** DS-3 — the mesh board; built once PeerLink and the federated manager
     * exist (below). Null only in the window before that. */
    let meshBoard: MeshBoard | null = null;
    /** MV-3a (L5, M20) — the screens, one per product connection that holds a
     * model board: opened with the connection's first model board, forgotten
     * with its last (a window opens one; two share the connection's screen).
     * A call with no connection id (none a product door mints) has no screen.
     * Q05: forgetting a screen keeps the unread marks — a reload's new
     * connection and a Godview opened again find them (`agent-monitor.ts`).
     * Q06: only this desktop's own window looks for the person, so only its
     * screen's reports acknowledge a crashed run's failure; a plugin holding
     * `agent.observe` opens a screen that acknowledges nothing. */
    const screens = new Map<string, { count: number; close: () => void }>();
    const openScreen = (ctx: CallerContext): (() => void) | null => {
      const service = monitor;
      const id = ctx.connection?.id;
      if (service === null || id === undefined) return null;
      let held = screens.get(id);
      if (held === undefined) {
        held = { count: 0, close: service.openScreen(id, { acknowledges: ownWindow(ctx) }) };
        screens.set(id, held);
      }
      const screen = held;
      screen.count += 1;
      let open = true;
      return () => {
        if (!open) return;
        open = false;
        screen.count -= 1;
        if (screen.count > 0) return;
        screens.delete(id);
        screen.close();
      };
    };
    // MF-1 (§5, §10.2) — one door, three projections. Absent params or
    // `projection: "full"` is the subscription the desktop has always had,
    // unchanged: whole `AgentListResult` frames at the fold's own 16 ms tick,
    // which the renderer reads as whole `rows` arrays. `projection: "field"`
    // answers the content-free board — a snapshot, then deltas at this
    // subscriber's own trailing-edge floor — which is what a phone on the
    // tailnet can afford. DS-3: `projection: "desk"` is the field row plus the
    // reply line, the blocker's question and the cost (windows, 100 ms floor),
    // and `scope: "mesh"` answers every self desktop's board through this one
    // door (`mesh-board.ts`, DS-D4).
    api.registerSubscription("agent.subscribe", (ctx, params, emit) => {
      const parsed = AgentSubscribeParams.safeParse(params ?? {});
      if (!parsed.success) throw malformedBoardAsk();
      // S2 (the landing review, 2026-10-01) — who may ask which board lives in
      // ONE function, because the subscription forwarder below asks it too, of
      // the caller a routed ask is for (`agent-field.ts` `refuseBoardAsk`): the
      // full fold stays on its device, the desk is for desktops (SP-L4), the
      // mesh is this desktop's clients' (DS-L4), and an unhonourable cadence
      // option is refused (MF-1h).
      const refusal = refuseBoardAsk(ctx.principal.kind, parsed.data);
      if (refusal !== null) throw refusal;
      const { minIntervalMs, heartbeatMs } = parsed.data;
      const projection = parsed.data.projection ?? "full";
      const scope = parsed.data.scope ?? "local";
      if (projection === "full") {
        const dispose = agents.subscribe((rows) => emit(rows));
        return { snapshot: agents.list(), dispose };
      }
      // design-06 §8: "the board's cadence floors (250 / 100 ms)" — a caller
      // may ask SLOWER, never faster, on either projection. The field's was a
      // default and not a floor until 2026-10-01 (the landing review): a 16 ms
      // ask was honoured, and every distinct ask stood up its own mesh hub.
      // MV-3a (L12) — the model board's floor is the fold's own tick.
      const floor =
        projection === "model"
          ? Math.max(minIntervalMs ?? AGENT_FIELD.FULL_TICK_MS, AGENT_FIELD.FULL_TICK_MS)
          : projection === "desk"
            ? Math.max(
                minIntervalMs ?? AGENT_FIELD.DESK_MIN_INTERVAL_MS,
                AGENT_FIELD.DESK_MIN_INTERVAL_MS,
              )
            : Math.max(minIntervalMs ?? AGENT_FIELD.MIN_INTERVAL_MS, AGENT_FIELD.MIN_INTERVAL_MS);
      // MV-3a (L5, M20) — a window's model board IS its screen: what it reports
      // shown clears unread marks, and the screen is forgotten with the board.
      const screen = projection === "model" ? openScreen(ctx) : null;
      try {
        if (scope === "mesh") {
          if (meshBoard === null)
            throw new RpcCallError("UNAVAILABLE", "the mesh board is not ready yet", true, {
              service: "mesh-board",
              state: "starting",
            });
          // `.snapshot` carries the whole mesh (the open, and the client's own
          // replay after a reconnect); `.delta` carries every per-device frame —
          // a device's delta, a device's reset, a device's state.
          const reader = meshBoard.open(projection, floor, (frame) => emit(frame, "delta"));
          return {
            snapshot: reader.open,
            dispose: () => {
              reader.dispose();
              screen?.();
            },
          };
        }
        const board = openLocalBoard(projection, floor, (delta) => emit(delta), heartbeatMs);
        return {
          snapshot: board.snapshot,
          dispose: () => {
            board.dispose();
            screen?.();
          },
        };
      } catch (error) {
        screen?.();
        throw error;
      }
    });
    // MV-3a (L5) — `agent.reportShown {ids}`: which rows the window shows in
    // its active pane, by model id, forwarded to the backend for its unread
    // marks. The screen is the connection's model board — refused without one.
    api.register("agent.reportShown", (ctx, params) => {
      const parsed = AgentReportShownParams.safeParse(params ?? {});
      if (!parsed.success)
        throw new RpcCallError("PRECONDITION_FAILED", "expected { ids: string[] }", false);
      const screenId = ctx.connection?.id;
      if (
        monitor === null ||
        screenId === undefined ||
        !monitor.reportShown(screenId, parsed.data.ids)
      )
        throw new RpcCallError(
          "PRECONDITION_FAILED",
          'no model board is open on this connection — subscribe agent.subscribe {projection: "model"} first; the board is the screen',
          false,
          { state: "no-screen" },
        );
      const result: AgentReportShownResult = { reported: true };
      return result;
    });
    // LR (2026-10-15) — what this desktop's last run left, and the answer that
    // lets it go. This desktop's windows' alone, as the `model` board it
    // pictures is: a peer and a phone are refused as that board refuses them.
    const refuseLastRun = (kind: string): void => {
      if (kind === "peer-fieldd" || kind === "tailnet")
        throw new RpcCallError(
          "FORBIDDEN_SCOPE",
          "what the last run left is this desktop's windows'",
          false,
          { service: "agent-last-run" },
        );
    };
    api.register("agent.lastRun", (ctx) => {
      refuseLastRun(ctx.principal.kind);
      if (lastRun === null)
        throw new RpcCallError("UNAVAILABLE", "the agent monitor is starting", true, {
          service: "agent-last-run",
          state: "starting",
        });
      const result: AgentLastRunResult = lastRun.read();
      return result;
    });
    api.register("agent.lastRunForget", (ctx) => {
      refuseLastRun(ctx.principal.kind);
      const result: AgentLastRunForgetResult = lastRun?.forget() ?? { forgotten: false };
      return result;
    });
    // TL (docket v9, RULED 2026-10-09; B-D6 (a)) — `agent.recordedLanes`: the
    // lanes' past as the backend beside the runtime derives it from the record,
    // asked by a window only while a mounted view asks (PF6). Read through to
    // rosettad at each ask (the backend's history port) and held nowhere — not
    // the removed `agent.history`. Only this desktop's own callers read the
    // colour sequences (M16), as only they read the model's rows: the cut is
    // `MONITOR_AUDIENCE`'s by the caller's kind. Item 100: it was every kind
    // but a peer daemon's, so a phone read this desktop's deal. SP-D13-bounded
    // for a tailnet caller by `index.activity`'s rule (item 105): the newest
    // MAX_ROWS ended lanes by their end, `clipped` saying so; a window and a
    // peer daemon read the whole day.
    api.register("agent.recordedLanes", async (ctx, params) => {
      const parsed = AgentRecordedLanesParams.safeParse(params ?? {});
      if (!parsed.success)
        throw new RpcCallError(
          "PRECONDITION_FAILED",
          "expected { sinceMs, untilMs (after sinceMs, at most a day later), device? }",
          false,
        );
      if (monitor === null)
        throw new RpcCallError("UNAVAILABLE", "the agent monitor is starting", true, {
          service: "agent.monitor",
          state: "starting",
        });
      const past = await monitor.readPast({
        sinceMs: parsed.data.sinceMs,
        untilMs: parsed.data.untilMs,
      });
      // no record source here (no rosettad configured): nothing to lend, said
      // so the window draws today's floor and asks no more (v2 item 9)
      if (past === undefined)
        throw new RpcCallError("NOT_FOUND", "this desktop keeps no record of past runs", false, {
          service: "agent.monitor",
          state: "no-record",
        });
      return clipRecordedLanes(
        wireRecordedLanes(past, MONITOR_AUDIENCE[ctx.principal.kind]),
        tailnetRowLimit(ctx.principal, undefined, Number.MAX_SAFE_INTEGER),
      );
    });
    // AR-5d — the usage column's feed (agent-usage.ts). Both doors answer the
    // PROJECTION and nothing else: percentages, labels, the provider's own
    // sentence for a refusal (EL7). Before the first reading lands the answer
    // is an honest empty batch, never a wait and never a throw.
    api.register("agents.usage", (_ctx, params) => {
      const parsed = AgentsUsageParams.safeParse(params ?? {});
      if (!parsed.success)
        throw new RpcCallError("PRECONDITION_FAILED", "expected { refresh?, profileIds? }", false);
      return parsed.data.refresh === true
        ? agentUsage.refresh({
            force: true,
            ...(parsed.data.profileIds !== undefined ? { profileIds: parsed.data.profileIds } : {}),
          })
        : agentUsage.snapshot();
    });
    api.registerSubscription("agents.usage.subscribe", (_ctx, _params, emit) => {
      const dispose = agentUsage.subscribe((batch) => emit(batch));
      return { snapshot: agentUsage.snapshot(), dispose };
    });
    api.register("agents.profiles.login", async (ctx, params) => {
      const parsed = AgentsProfilesLoginParams.safeParse(params);
      if (!parsed.success)
        throw new RpcCallError(
          "PRECONDITION_FAILED",
          "expected { profileId, cwd?, route? }",
          false,
        );
      return await audit.required(
        ctx,
        {
          action: "agents.profiles.login",
          target: { kind: "agent-persona", id: parsed.data.profileId },
          attrs: {
            ...(parsed.data.cwd !== undefined ? { cwd: parsed.data.cwd } : {}),
            ...(parsed.data.route !== undefined ? { route: parsed.data.route } : {}),
          },
        },
        () => agents.login(parsed.data, ctx.principal),
        (result) => ({ outcome: "succeeded", attrs: { sessionId: result.terminal.sessionId } }),
      );
    });
    api.register("system.capabilities", () => ({
      methods: METHODS.filter((m) => m.surface === "product").map((m) => m.method),
    }));
    // D36 (2026-10-01; DS wave 2's finding 02:15 (3), closed in wave 3) — the
    // health stream is THIS desktop's whole judgment of its own planes (the
    // floor, rosettad's phase, the doc host, plugins, logging): `local` by
    // locality, yet `scope: null` let every hello'd principal open it, the phone
    // included — the door's D36 wall refuses a `local` method to a PEER DAEMON
    // only. So the handler admits the principals that ARE this device — a local
    // window or shell (`local-token`, `shell-main`) and a plugin — and nothing
    // that crossed the tailnet: `tailnet`, `tailnet-guest`, `peer-fieldd` read
    // FORBIDDEN_SCOPE (the guest choke and the D36 wall already refuse the last
    // two at the door; this is the only wall for the phone). WHO the caller is,
    // never what it was granted: a window holding no scope still reads it.
    // SP-1's census (contracts registry.test.ts) names this gate.
    api.registerSubscription("system.health.subscribe", (ctx, _params, emit) => {
      const kind = ctx.principal.kind;
      if (kind !== "local-token" && kind !== "shell-main" && kind !== "plugin")
        throw new RpcCallError(
          "FORBIDDEN_SCOPE",
          "system.health.subscribe is local to its device (D36): this desktop's health streams to its own windows, shell and plugins",
          false,
          { method: "system.health.subscribe" },
        );
      const fn = (h: FielddHealth) => emit(h);
      healthListeners.add(fn);
      return { snapshot: health(), dispose: () => healthListeners.delete(fn) };
    });
    const windowTokenIds = new Set<string>();
    const windowTokenParticipants = new Map<
      string,
      ReturnType<typeof RendererParticipantIdentity.parse>
    >();
    // WG-D1 — a person is here to ask while a window holds a live token: the
    // headless clause waits on nobody else, and the person's restart is
    // offered only where one could press it
    windowPresent = () => windowTokenIds.size > 0;
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
        await workspace.tickets.revokeClient(tokenId);
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
      // DS-5 (DS-D7) — `elsewhere`: library canvases held only on another
      // desktop (a `local` canvas lives on its own), listed, not openable here.
      const elsewhere = docs.elsewhere();
      const result: DocListResult = {
        docs: docs.list(),
        ...(elsewhere.length > 0 ? { elsewhere } : {}),
      };
      return result;
    });
    // DK-9 (DK-5 input (2)) — who holds a board LIVE now: the other desktops whose presence lane reaches
    // its room here. The renderer waits a pack the board lacks while any does (desk-capabilities.ts).
    api.register("doc.holders", (ctx, params) => {
      requireLocalDocumentCaller(ctx);
      const parsed = DocHoldersParams.safeParse(params);
      if (!parsed.success)
        throw new RpcCallError("PRECONDITION_FAILED", "expected { docId: uuid }", false);
      const result: DocHoldersResult = {
        docId: parsed.data.docId,
        live: presenceRooms?.liveElsewhere(parsed.data.docId) ?? [],
      };
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
    // DS-5 (DS-D6) — a tombstone in the library: the canvas leaves every
    // desktop's list and its lanes stop; its bytes stay on disk.
    api.register("doc.delete", async (ctx, params) => {
      requireLocalDocumentCaller(ctx);
      const parsed = DocDeleteParams.safeParse(params);
      if (!parsed.success)
        throw new RpcCallError("PRECONDITION_FAILED", "expected { docId: uuid }", false);
      const entry = await docs.delete(parsed.data.docId);
      emitHealth(); // docCount moved
      return entry;
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
      const entry = await docs.setSyncIntent(parsed.data.docId, parsed.data.intent);
      // DS-5 (DS-D7) — a canvas told to travel replicates now.
      if (parsed.data.intent === "sync") {
        docSync?.replicate([parsed.data.docId], { regreet: true });
      }
      return entry;
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
    // AU-3a (AU-D13 A) — the app version this desktop says on its slice, from
    // the build id its launcher gave (`FIELDD_BUILD_ID`, the staged identity's
    // `<appVersion>+<commit7>`). A dev runner's id names none, so dev says none.
    const appVersion = appVersionOfBuildId(config.buildId);
    const devices = new DeviceService({
      dataDir: config.dataDir,
      mesh,
      bootId,
      fielddVersion: FIELDD_VERSION,
      contractsVersion: CONTRACTS_VERSION,
      ...(appVersion !== undefined ? { appVersion } : {}),
      // NF-3: honest capability — true iff the pairing hello delivered the
      // floor's endpoints (D31; re-synced on the terminal-endpoints event).
      terminalHost: () => native.terminalEndpoints !== undefined,
      // TM-2 (MF-1l), corrected by F-H2 — the REMOTE half: can another device
      // attach here? The same live reading the ticket mint answers with, so
      // the capability and the mint can never disagree. (It was the floor's
      // `terminalMesh` boolean alone, which is true while a pre-capture daemon
      // publishes nothing at all.)
      terminalMesh: () => publishedTerminalServe() !== undefined,
      // UA-P-0e (D2) — the account the roster is scoped to, and the port a
      // peer's door coordinate is derived with. `linkedLogin` is declared
      // further down (the serve machinery owns it); this closure defers to it.
      linkedLogin: () => links.status().link?.login ?? null,
      productServePort: PORTS.FIELDD_PRODUCT_SERVE,
      // UA-P-4 — a slice the peer registry does not vouch for is dropped, and
      // the drop has to be visible: this is the roster quietly disagreeing with
      // the tailnet, which is exactly the class nobody notices without a line.
      logger,
      // The daemon owns the serve secret + the fused serve state, so IT
      // composes the endpoint: url only while the product serve is active.
      productEndpoint: () => {
        const s = mesh.serves().find((x) => x.name === "product");
        const url = s?.status === "active" ? capabilityUrl(s.url) : undefined;
        return { serve: "product", ...(url !== undefined ? { url } : {}) };
      },
    });
    devicesForAgents = devices;
    devicesRef = devices; // arms the tailnet door's node-id correlation (T1 §1)
    // MV-3a (MV-D22, MV-D18) — the monitor backend, hosted beside the runtime
    // (`agent-monitor.ts`): puppeteer's push bus and all-runs snapshot in, the
    // daemon's own facts beside them — the fold's rows, the floor's PTYs with
    // the profile each was born under, this device, the Agent Profiles — and
    // one model out, which the board cuts per audience. Project colours are
    // dealt from the identity file (L4), so a restart reshuffles nothing.
    monitor = createAgentMonitorService({
      runtime: agents.runtime,
      fold: { list: () => agents.list(), subscribe: (emit) => agents.subscribe(emit) },
      terminals: {
        list: () => (terminals.observation() !== undefined ? terminals.list() : undefined),
        onInventory: (listener) => terminals.onInventory(listener),
        profileSetOf: (sessionId) => terminals.profileSetOf(sessionId),
      },
      devices: {
        current: () => {
          const id = devices.currentDeviceId();
          const row = devices.get(id);
          return {
            id,
            ...(row?.name !== undefined ? { name: row.name } : {}),
            ...(row?.platform !== undefined ? { platform: row.platform } : {}),
          };
        },
        onChanged: (listener) => {
          devices.on("changed", listener);
          return () => {
            devices.off("changed", listener);
          };
        },
      },
      profiles: {
        sets: () => agents.profiles.sets(),
        subscribe: (emit) => agents.profiles.subscribe(emit),
      },
      catalog: agents.catalog,
      identity: createProjectIdentityStore({
        file: join(config.dataDir, ...LAYOUT.PROJECT_IDENTITY_FILE),
        logger: logger.child({ component: "agent.monitor.identity" }),
      }),
      // TL — the record, read at each ask and held nowhere (index-activity.ts),
      // beside this runtime's own run records: only those runs are lanes (v2).
      // A desktop with no rosettad keeps no record: no port, so its windows are
      // lent no past at all and draw today's floor (v2 item 9).
      ...(rosettad !== null
        ? { history: monitorHistoryPort(activity, agents.catalog, () => agents.recordedRuns()) }
        : {}),
      logger,
    });
    // LR (James, 2026-10-15) — the board's picture, kept beside the backend it
    // pictures: read before this boot writes anything, then taken as the board
    // moves while the floor is up. What the last run left is held until a
    // window answers restore or start clean.
    lastRun = new LastRunKeeper({
      lastPath: join(config.dataDir, ...LAYOUT.AGENT_LAST_BOARD_FILE),
      leftPath: join(config.dataDir, ...LAYOUT.AGENT_LEFT_BOARD_FILE),
      board: modelBoardSource({
        fold: { list: () => agents.list(), subscribe: (fn) => agents.subscribe(fn) },
        monitor,
      }),
      floorUp: () => native.connected,
      settled: () => agents.reattachSettled(),
      // IL-D5 (a) — an inventory older than its bound is read as an unobserved
      // one: a stale cell may hold a session it has not listed yet, and
      // `goneOf` would offer that live run as left
      liveSessions: () =>
        terminals.observation() !== undefined && terminals.staleCells().length === 0
          ? new Set(terminals.list().map((row) => row.sessionId))
          : undefined,
      liveRuns: () => new Set(agents.list().sessions.map((row) => row.runtimeRunId)),
      continuable: (runtimeRunId) => agents.continuable(runtimeRunId),
      logger: logger.child({ component: "agent.last-run" }),
    });
    lastRun.start();
    // D1 (2026-10-01) — a peer that dialled before the roster could vouch for
    // it was admitted as `tailnet`; once the roster shows its node as a
    // desktop, its connection closes for a fresh hello (ProductApi)
    devices.on("changed", () => api.reconsiderPeerClaims());

    // -- MF-1 (§10.2, D4's hybrid): the agent field's store carrier — RETIRED --
    // DS-D14 (RULED `retire` 2026-09-30; built 2026-10-01, DS wave 3): this
    // daemon no longer publishes `field.agents.v1`. The store carrier existed so
    // a phone joining the tailnet could read every desktop's board with no
    // fieldd in its path; the mesh board (DS-3, `agent.subscribe {scope:
    // "mesh"}`, `mesh-board.ts`) answers every self desktop's board through ONE
    // door, the desktop's Godview reads it, and the phone homes to one desktop
    // and reads the same door (DS-8, DS-D13). The field's one carrier is
    // `agent.subscribe` over the product door, which compares the caller's
    // WhoIs login to the stored link before it answers. `STORES.AGENT_FIELD`
    // stays in the registry, marked retired: the floor's slice cap names it
    // (`field-native` `mgmt/mesh.rs`), and an older desktop may still publish
    // one. `test/agent-field-daemon.test.ts` pins that nothing is written here.
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
    // DS-5 (DS-D6) — the holders slice, `field.docs.v1`, device-owned: what this
    // desktop holds (with the host's version — the compaction watermark's input,
    // DS §5.3) and, from the other slices, where a canvas held only elsewhere
    // lives. `fresh` is the sync fold's own word: nothing known un-synced.
    const holders = new DocHoldersService({
      mesh,
      deviceId: () => devices.currentDeviceId(),
      holdings: () =>
        docs.holdings((docId) => {
          const standing = docSync?.statuses().find((s) => s.docId === docId);
          return standing === undefined || standing.state === "in-step";
        }),
      logger: logger.child({ component: "docs.holders" }),
      // DS-5d — the ledger outlives each slice (a slice leaves with its
      // publisher): the compaction watermark waits for a desktop until
      // DS-D17's horizon, across this daemon's restarts.
      ledgerPath: join(config.dataDir, ...LAYOUT.REGISTRIES_DIR, `${STORES.DOCS}.holders.json`),
    });
    docHolders = holders;
    docs.setHomes((docId) => holders.homesOf(docId));
    // DS-5d — the watermark's holders; and the slice republishes whenever what
    // this desktop acknowledges moves without a commit (a window's floor).
    docs.setAcknowledgements((docId) => holders.acknowledgements(docId));
    docs.onHoldingsChanged(() => holders.schedule());
    docs.onCatalogChanged((change) => {
      holders.schedule();
      // DS-5 (DS-D7) — a canvas another desktop made is fetched on adoption,
      // not on its next commit there.
      if (change.adopted.length > 0) docSync?.replicate(change.adopted, { regreet: true });
    });
    if (MESH_BUS_CARRIES_CONTENT) {
      void holders.start().catch((error) =>
        logger.info("fieldd.docs.holders_unavailable", "The holders slice is not live yet", {
          error: String(error),
        }),
      );
    }
    api.register("device.list", () => ({ devices: devices.list() }));
    // IOS-8f — this desktop's person, read from its own user row at each ask (`user-me.ts`)
    api.register("user.me", () =>
      userMe({ userId: config.userId, root: config.vibefieldRoot, logger }),
    );
    api.register("device.get", (_ctx, params) => {
      const parsed = DeviceGetParams.safeParse(params);
      if (!parsed.success)
        throw new RpcCallError("PRECONDITION_FAILED", "expected { deviceId: string }", false);
      const info = devices.get(parsed.data.deviceId);
      if (!info)
        throw new RpcCallError("NOT_FOUND", `no such device: ${parsed.data.deviceId}`, false);
      return info;
    });
    // SP-1 — whole lists (`DeviceInfo[]`), the newest standing, at the stream
    // floor (`wholeValueDoor`): the wire Godview, the mesh section and the kit
    // read is unchanged; a roster that churns moves a reader once per window.
    api.registerSubscription("device.subscribe", (_ctx, _params, emit) =>
      wholeValueDoor(
        {
          read: () => devices.list(),
          onChange: (listener) => {
            devices.on("changed", listener);
            return () => devices.off("changed", listener);
          },
        },
        emit,
        { onError: streamFrameFailed("device.subscribe") },
      ),
    );

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
    // IL-D5 (a) (`draft/thinking-inventory-latency.md` §5) — the row a door
    // that needs a LISTED session acts on. A session the inventory does not
    // list, while any cell's inventory is older than the bound, is not known
    // yet rather than gone: it may live in that cell, listed by an answer
    // fieldd has not seen, and an agent record names no cell to rule one out.
    // Such a door refuses it retryably (`staleRefusal`: every stale cell, or
    // WG-D4's held floor) where it would say "no such terminal". A listed
    // session is answered as before, stale cell or not: a ticket's cell refuses
    // a session it no longer holds.
    const requireListed = (sessionId: string, operation: string) => {
      const info = terminals.get(sessionId);
      if (info !== undefined) return info;
      throw (
        terminals.staleRefusal(sessionId, operation) ??
        new RpcCallError("NOT_FOUND", `no such terminal: ${sessionId}`, false)
      );
    };
    // GT-5b: `list` REFUSES (UNAVAILABLE `unobserved`) until the first observed
    // snapshot applies rather than answering an empty floor it has not looked
    // at, and carries the observation it IS answering from — see the service.
    // IL-D4/IL-D5 (a): that observation says how old the rows may be — the
    // floor's bound, and the cells older than it — and every row stays.
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
    api.register("terminal.get", (_ctx, params) =>
      requireListed(requireSessionId(params), "terminal.get"),
    );
    // D6: every mint is an audited grant, even while the credential inside is
    // the shared native service token (per-client tokens are the named
    // ghosttea upgrade).
    //
    // DS-4 — routable (`federate`): a window on another desktop reaches this
    // handler through ITS daemon, so `ctx.principal` is that daemon
    // (`peer-fieldd`, a self peer), minted the self set and the tailnet doors
    // (`doorsFor`), and the audit row names the calling node. The window behind
    // it joins the row with `onBehalfOf` (DS-2, lane ds-b).
    // D2 (the landing review, 2026-10-01) — and the mint reads it now: a peer
    // daemon whose call names no one behind it is minted `["read"]`, the self
    // set only for a call that is FOR someone (`rightsFor`; design-06 §6). The
    // same `ctx.onBehalfOf` rides every mint below: renewAttach, create, and
    // the agent births.
    api.register("terminal.openTicket", async (ctx, params) => {
      const sessionId = requireSessionId(params);
      requireListed(sessionId, "terminal.openTicket");
      return await audit.required(
        ctx,
        { action: "terminal.ticket.mint", target: { kind: "terminal", id: sessionId } },
        // TC-S3: the session's OWN cell, via the inventory's `cell` tag — a
        // ticket minted from any other cell would be a credential for a socket
        // that has never heard of this session. TP-S1: the TPv3 route + grants
        // ride beside the legacy trio when the cell carries a grant key; the
        // caller's principal is what the grants are bound to (never UI claims).
        () => terminals.openTicket(ctx.principal, sessionId, ctx.onBehalfOf),
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
      requireListed(parsed.data.sessionId, "terminal.renewAttach");
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
        () => terminals.renewAttach(ctx.principal, parsed.data, ctx.onBehalfOf),
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
            // SB-2 — the Agent Profile asked for: the set's id, never a variable
            ...(parsed.data.profileSet !== undefined ? { profileSet: parsed.data.profileSet } : {}),
          },
        },
        async () => {
          // SB-2 (EL7) — A BOUND BIRTH NEEDS SPAWN RIGHTS. A shell born under
          // a profile runs every agent it starts on that profile's accounts,
          // so the caller must hold `agent.spawn` as well as the door's own
          // `terminal.attach` (the renderer holds both). Read off the principal
          // as daemon.ts reads every in-handler scope: a principal with no
          // `scopes` (a tailnet one — its grant is connection state) holds
          // none here. Inside the effect, so a refused bound birth is a
          // RECORDED attempt with a failed outcome, and nothing reached the floor.
          if (parsed.data.profileSet !== undefined) {
            const scopes = (ctx.principal as { scopes?: string[] }).scopes ?? [];
            if (!scopes.includes("agent.spawn"))
              throw new RpcCallError(
                "FORBIDDEN_SCOPE",
                "opening a terminal under a profile requires agent.spawn",
                false,
                { required: "agent.spawn" },
              );
          }
          return await terminals.create(parsed.data);
        },
        // no `ticketMinted` here any more: nothing has been minted yet, and an
        // attr claiming otherwise was true only because the nesting made it so.
        // AR-7d — `integrated`: whether the shell was born with the shell
        // integration's variables. SB-2 — `bound`: whether it was born under
        // an Agent Profile (the native set included). Facts of the birth, so
        // they ride the outcome; the variables themselves are never recorded.
        (result) => ({
          outcome: "succeeded",
          attrs: {
            sessionId: result.sessionId,
            integrated: result.integrated,
            bound: result.bound,
          },
        }),
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
        () => terminals.createOpenResult(ctx.principal, created, ctx.onBehalfOf),
        () => ({ outcome: "succeeded" }),
      );
      return opened satisfies TerminalCreateOpenResponse;
    });
    // DS-4 — the take for a host that cannot speak a cell's control leg (the
    // phone's kit, DS-4b): declared, answered honestly, never served yet.
    api.register("terminal.takeGeometry", (_ctx, params) => {
      const parsed = TerminalTakeGeometryParams.safeParse(params ?? {});
      if (!parsed.success)
        throw new RpcCallError("PRECONDITION_FAILED", "expected { sessionId: string }", false);
      return terminals.takeGeometry(parsed.data.sessionId);
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
    // GT-7 — the dry run, the file actions. validate and import write nothing
    // anywhere (a dry run; a draft handed back to the editor), so like read
    // they are not audited acts. export WRITES a file where the user's save
    // dialog says: audited like write, by size and never by contents or path.
    // reveal only shows the file manager.
    api.register(
      "terminal.config.validate",
      async (_ctx, params): Promise<TerminalConfigValidation> => {
        const parsed = TerminalConfigValidateParams.safeParse(params);
        if (!parsed.success)
          throw new RpcCallError("PRECONDITION_FAILED", "expected { text: string }", false);
        return await terminals.validateConfig(parsed.data.text);
      },
    );
    api.register(
      "terminal.config.import",
      async (_ctx, params): Promise<TerminalConfigImportResult> => {
        // read's shape: the caller names nothing — the user picks the file
        if (!TerminalConfigReadParams.safeParse(params ?? {}).success)
          throw new RpcCallError("PRECONDITION_FAILED", "expected an object or no params", false);
        return await terminals.importConfig();
      },
    );
    api.register("terminal.config.export", async (ctx, params) => {
      const parsed = TerminalConfigExportRequest.safeParse(params);
      if (!parsed.success)
        throw new RpcCallError("PRECONDITION_FAILED", "expected { text: string }", false);
      return await audit.required(
        ctx,
        {
          action: "terminal.config.export",
          target: { kind: "terminal", id: "config" },
          attrs: { bytes: Buffer.byteLength(parsed.data.text, "utf8") },
        },
        async (): Promise<TerminalConfigExportResult> =>
          await terminals.exportConfig(parsed.data.text),
        (result) =>
          result.status === "cancelled"
            ? { outcome: "cancelled" }
            : { outcome: "succeeded", attrs: { bytes: result.bytes } },
      );
    });
    api.register(
      "terminal.config.reveal",
      async (_ctx, params): Promise<TerminalConfigRevealResult> => {
        // the path is the floor's own document's — the caller hands none
        if (!TerminalConfigReadParams.safeParse(params ?? {}).success)
          throw new RpcCallError("PRECONDITION_FAILED", "expected an object or no params", false);
        return await terminals.revealConfig();
      },
    );

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
      // A token whose plugin-local serving identity died is indistinguishable
      // from one that never existed: the caller learns only "not authorized".
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
    // D29′ app-section preferences — and every settings.manage door since
    // (the link, the setup ledger). The method registry supplies the
    // settings.manage capability gate; this additional caller-kind check is
    // restrict-only, keeping a copied token from turning a plugin worker or
    // debug client into a desktop settings principal.
    const requireDesktopCaller = (ctx: {
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
          "this door requires a trusted desktop caller (the shell or a window)",
          false,
        );
      }
    };
    // UA-3 — the user's tailscale link (spec §7.1): trusted-desktop posture,
    // identical to the app-preference rows below. Unlink is identity
    // retirement — audited attempt-before-effect, and there is no rollback:
    // a retired node key cannot be un-retired, only relinked fresh.
    api.register("user.link.get", (ctx) => {
      requireDesktopCaller(ctx);
      return links.status();
    });
    api.registerSubscription("user.link.subscribe", (ctx, _params, emit) => {
      requireDesktopCaller(ctx);
      const fn = (status: unknown) => emit(status);
      links.on("changed", fn);
      return { snapshot: links.status(), dispose: () => links.off("changed", fn) };
    });
    // UA-P-0a (D1) — the LINK ACT. Audited beside unlink because it is the
    // same kind of event from the other side: this is the moment a desktop
    // stops being a default local account and asks for a tailnet identity, and
    // every mesh surface it will ever open descends from it.
    //
    // TS-1 (P7) — an auth key may ride the ask, for a machine with no browser.
    // It goes to the floor on the one `native.mesh.start` and nowhere else: the
    // audit records how the link was asked for, never the key.
    api.register("user.link.begin", async (ctx, params) => {
      requireDesktopCaller(ctx);
      const parsed = UserLinkBeginParams.safeParse(params ?? {});
      if (!parsed.success) {
        throw new RpcCallError(
          "PRECONDITION_FAILED",
          "user.link.begin takes {authKey?, sendLogs?}: an auth key is a non-empty string",
          false,
        );
      }
      const authKey = parsed.data.authKey;
      // TS-D16 — a capture begun again with "Send logs on this network"
      const sendLogs = parsed.data.sendLogs === true;
      return audit.requiredSystem(
        {
          action: "user.link.begin",
          target: { kind: "mesh", id: "tailnet-link" },
        },
        () =>
          links.begin({
            ...(authKey !== undefined ? { authKey } : {}),
            ...(sendLogs ? { sendLogs } : {}),
          }),
        (result) => ({
          attrs: {
            linkState: result.linkState,
            signIn: authKey !== undefined ? "auth_key" : "browser",
            sendLogs,
          },
        }),
      );
    });
    // TS-1 — the capture's way out, and the signed-out link's way back. Audited
    // beside begin, as the same family of act.
    api.register("user.link.cancel", async (ctx) => {
      requireDesktopCaller(ctx);
      return audit.requiredSystem(
        {
          action: "user.link.cancel",
          target: { kind: "mesh", id: "tailnet-link" },
        },
        () => links.cancel(),
        (result) => ({ attrs: { linkState: result.linkState } }),
      );
    });
    api.register("user.link.renew", async (ctx) => {
      requireDesktopCaller(ctx);
      return audit.requiredSystem(
        {
          action: "user.link.renew",
          target: { kind: "mesh", id: "tailnet-link" },
        },
        () => links.renew(),
        (result) => ({ attrs: { linkState: result.linkState } }),
      );
    });
    // TS-D14 — the device is signed out of its tailnet before the identity is
    // archived; the audit says whether Tailscale took the sign-out.
    api.register("user.link.unlink", async (ctx) => {
      requireDesktopCaller(ctx);
      return audit.requiredSystem(
        {
          action: "user.link.unlink",
          target: { kind: "mesh", id: "tailnet-link" },
        },
        () => links.unlink(),
        (result) => ({ attrs: { retired: result.retired, signedOut: result.signedOut === true } }),
      );
    });
    // TS-D16 (ruled A) — "Send logs on this network" for the standing link, on
    // or off. Audited: it changes what this desktop tells Tailscale, whose
    // default here is nothing (TS-D15).
    api.register("user.link.logs", async (ctx, params) => {
      requireDesktopCaller(ctx);
      const parsed = UserLinkLogsParams.safeParse(params);
      if (!parsed.success) {
        throw new RpcCallError(
          "PRECONDITION_FAILED",
          "user.link.logs takes {send: boolean}",
          false,
        );
      }
      const { send } = parsed.data;
      return audit.requiredSystem(
        {
          action: "user.link.logs",
          target: { kind: "mesh", id: "tailnet-link" },
        },
        () => links.logs(send),
        (result) => ({ attrs: { send, linkState: result.linkState } }),
      );
    });
    // TS-3b (P9, TS-D17 A) — the person's own name for THIS device, or null
    // for the computer's. A longer name is refused with its count, never
    // clipped; the audit says whether it was a reset, never the name itself
    // (a name is a person's words).
    api.register("device.rename", async (ctx, params) => {
      requireDesktopCaller(ctx);
      const parsed = DeviceRenameParams.safeParse(params);
      if (!parsed.success) {
        const raw = (params as { name?: unknown } | null | undefined)?.name;
        const length = typeof raw === "string" ? raw.trim().length : null;
        throw new RpcCallError(
          "PRECONDITION_FAILED",
          length === 0
            ? "a device name can't be empty"
            : length !== null && length > DEVICE_LIMITS.NAME_CHARS
              ? `a device name is at most ${DEVICE_LIMITS.NAME_CHARS} characters (this one is ${length})`
              : "expected { name: string (1–128 characters) | null }",
          false,
        );
      }
      const name = parsed.data.name;
      return audit.requiredSystem(
        { action: "device.rename", target: { kind: "device", id: "self" } },
        () => devices.rename(name),
        () => ({ attrs: { reset: name === null } }),
      );
    });
    const appPreferencesSnapshot = async () =>
      effectiveAppPreferences(await settingsDoc.appValues());
    api.register("storage.appPreferences.get", async (ctx, _params) => {
      requireDesktopCaller(ctx);
      return appPreferencesSnapshot();
    });
    api.register("storage.appPreferences.set", async (ctx, params) => {
      requireDesktopCaller(ctx);
      const parsed = AppPreferenceSetParams.safeParse(params);
      if (!parsed.success) {
        throw new RpcCallError(
          "PRECONDITION_FAILED",
          "expected { key: desktop.showTray|desktop.backgroundShell|desktop.screenshotHotkey|desktop.confirmQuit|mesh.connectAsks (boolean) | mesh.syncPosture (automatic|opt-in) }",
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
      requireDesktopCaller(ctx);
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
    // AO-2 — the Setup Assistant's ledger. The same trusted-desktop posture as
    // the preferences above: the wizard writes its answers here, and Settings'
    // "Finish setting up" reads what was put off. Not audited: an answer is a
    // person's place in a setup, never a grant.
    api.register("setup.get", (ctx) => {
      requireDesktopCaller(ctx);
      return setupLedger.snapshot();
    });
    api.registerSubscription("setup.subscribe", (ctx, _params, emit) => {
      requireDesktopCaller(ctx);
      const off = setupLedger.onChange((ledger) => emit(ledger));
      return { snapshot: setupLedger.snapshot(), dispose: off };
    });
    api.register("setup.answer", (ctx, params) => {
      requireDesktopCaller(ctx);
      const parsed = SetupAnswerParams.safeParse(params);
      if (!parsed.success) {
        throw new RpcCallError(
          "PRECONDITION_FAILED",
          `expected { step: ${SETUP_STEPS.join("|")}, state: answered|later }`,
          false,
        );
      }
      setupLedger.answer(parsed.data.step, parsed.data.state);
      return setupLedger.snapshot();
    });
    api.register("setup.moment", (ctx, params) => {
      requireDesktopCaller(ctx);
      const parsed = SetupMomentParams.safeParse(params);
      if (!parsed.success) {
        throw new RpcCallError(
          "PRECONDITION_FAILED",
          "expected { moment: <name> or <name>:<key>, state: retired|asked }",
          false,
        );
      }
      setupLedger.moment(parsed.data.moment, parsed.data.state);
      return setupLedger.snapshot();
    });
    api.register("setup.hide", (ctx, params) => {
      requireDesktopCaller(ctx);
      const parsed = SetupHideParams.safeParse(params);
      if (!parsed.success) {
        throw new RpcCallError("PRECONDITION_FAILED", "expected { hidden: boolean }", false);
      }
      setupLedger.hide(parsed.data.hidden);
      return setupLedger.snapshot();
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
          // §16.6 — decisions sync: THIS decision, never the record's whole
          // grant state (DS-5b, PA-32)
          void reconciler?.publish(latest, "grants", { capability, granted, changed });
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
    // SP-1 — whole snapshots, the newest standing, at the stream floor
    api.registerSubscription("services.subscribe", (_ctx, _params, emit) =>
      wholeValueDoor(
        {
          read: () => services.snapshot(),
          onChange: (listener) => {
            services.on("changed", listener);
            return () => services.off("changed", listener);
          },
        },
        emit,
        { onError: streamFrameFailed("services.subscribe") },
      ),
    );
    // §16.5 / PRC-2 — durable disable enters the SAME synchronous host-owned route drain as
    // reload/revocation/shutdown. The command path then joins it for worker teardown.
    plugins.on("changed", () => {
      for (const record of plugins.list()) if (!record.enabled) serviceHost?.beginDrain(record.id);
    });

    // -- PeerLink (C5, design-04 D32): the device?-routing substrate --
    // DS-1b (D4 + D5) — the floor's egress answer, asked once per FLOOR BOOT
    // (`NativeHealth.bootId` off the health stream above, which re-snapshots on
    // every mgmt reconnect) and failing closed on anything but "unsupported".
    // The dial and the routes read the same cache.
    const floorEgress = new FloorEgress({
      floor: mesh,
      bootId: () => {
        const bootId = (latestHealth as { bootId?: unknown } | null)?.bootId;
        return typeof bootId === "string" && bootId !== "" ? bootId : undefined;
      },
      logger: logger.child({ component: "mesh.egress" }),
    });
    const peers = new PeerLink({
      ownDeviceId: () => devices.currentDeviceId(),
      // UA-P-0e — endpoint truth is the roster's DERIVED locator (it was the
      // peer's published slice). Same call, and now it can only ever answer for
      // a peer the tailnet says shares this account.
      endpointFor: (deviceId) => devices.get(deviceId)?.productEndpoint?.url,
      ...(config.peerWebSocket !== undefined ? { webSocket: config.peerWebSocket } : {}),
      // DS-1 — every dial asks how to reach the tailnet: the node's own SOCKS5
      // when it has egress; the OS network only when the floor cannot carry
      // egress at all; otherwise the dial fails closed (DS-1b)
      egress: () => resolveEgressPath(floorEgress),
      logger: logger.child({ component: "peer.link" }),
    });
    // DS-1 — the egress ROUTES port (E2), for the terminal rewriter (DS-4).
    // Idle until something ensures a route; its roster listener goes with
    // `devices.dispose()`, and a route it placed outlives fieldd the way a
    // serve does — the next fieldd's identical route id re-answers it.
    const egressRoutes = new EgressRoutes({
      facade: floorEgress,
      roster: {
        hostFor: (deviceId) => devices.get(deviceId)?.tailnetDnsName,
        onChange: (listener) => {
          devices.on("changed", listener);
          return () => devices.off("changed", listener);
        },
      },
      logger: logger.child({ component: "mesh.egress" }),
    });
    // DS-1b — the production rewriter over that port: a window's forwarded
    // ticket rides ONE route per owner desktop to its cell serve, both doors
    // re-homed onto the route's loopback listener (egress-cell-rewriter.ts)
    if (config.terminalRemoteCellRewriter === undefined) {
      egressCellRewriter = new EgressCellRewriter({
        routes: egressRoutes,
        logger: logger.child({ component: "terminal.egress" }),
      });
    }
    // C6-5/D35 — the subscription half: one ref-counted upstream per
    // {device, method, params}, re-snapshot on recovery; quiet during an
    // outage (the roster carries liveness, the topic stream never lies).
    const federatedSubs = new FederatedSubscriptionManager({
      link: peers,
      logger: logger.child({ component: "federated.subs" }),
    });
    api.setDeviceRouting(
      () => devices.currentDeviceId(),
      // DS-L7/DS-D15 — the envelope (who the call is for, and a mutation's
      // idempotency key) rides beside the params; this closure used to drop
      // the calling context, so the owner recorded two devices as one.
      // DS-4 — a forwarded terminal mint is carried only for a self principal,
      // and a forwarded ticket's doors are adopted for the caller on the way back
      // (`TerminalService.forwardVia`); every other forward passes through.
      terminals.forwardVia((device, method, params, _ctx, envelope) =>
        peers.request(device, method, params, envelope),
      ),
      // S2 (the landing review, 2026-10-01) — a routed board ask is judged for
      // the CALLER here, before it is carried: the owner sees this daemon's
      // `peer-fieldd` principal, never the phone behind it, so a phone asking
      // `desk` of another desktop through its home would otherwise be served
      // the content SP-L4 withholds. A routed `field` from the phone, and a
      // window's routed `desk`, are carried as before.
      (device, method, params, ctx, emit) => {
        if (method === "agent.subscribe") {
          const ask = AgentSubscribeParams.safeParse(params ?? {});
          if (!ask.success) throw malformedBoardAsk();
          const refusal = refuseBoardAsk(ctx.principal.kind, ask.data);
          if (refusal !== null) throw refusal;
        }
        return federatedSubs.attach(device, method, params, emit);
      },
    );
    devices.attachPeerLink(peers); // C5/D32 — fold link state into the roster
    // DS-2 (DS-D15) — the receipt of one of THIS daemon's keyed forwards, so a
    // UI can show applied / refused / outcome-unknown; the retry is the same
    // call carrying the same key (forward-receipts.ts), never this door.
    api.register("forward.receipt", (_ctx, params) => {
      const key = IdempotencyKey.safeParse(
        (params as { idempotencyKey?: unknown } | null | undefined)?.idempotencyKey,
      );
      if (!key.success)
        throw new RpcCallError("PRECONDITION_FAILED", "expected { idempotencyKey }", false);
      const receipt = peers.receipts.get(key.data);
      if (receipt === undefined)
        throw new RpcCallError("NOT_FOUND", "no forward with that key is journaled here", false, {
          idempotencyKey: key.data,
        });
      return receipt;
    });

    // DS-3 (DS-D4) — the mesh board: every self desktop's agents through this
    // one door, multiplexed per device over the federated manager above, each
    // desktop's chain relayed as its owner numbered it (`mesh-board.ts`).
    const board = new MeshBoard({
      selfDevice: () => devices.currentDeviceId(),
      roster: devices,
      links: peers,
      upstreams: federatedSubs,
      openLocal: (projection, minIntervalMs, emit) =>
        openLocalBoard(projection, minIntervalMs, emit),
      logger,
    });
    meshBoard = board;
    // DS-6 — history across desktops: every self peer's catalog replicated,
    // the merged doors, search by asking. Started once boot commits.
    indexMesh = new IndexMesh({
      local: indexCatalog,
      roster: devices,
      link: peers,
      searchLocal: (question) => index.search(question),
      dir: join(config.dataDir, ...LAYOUT.MESH_CATALOG_DIR),
      ...(config.indexMesh ?? {}),
      logger,
    });
    // PJ-1 — a peer's project rows moved: its places' samples may have, and
    // the projects regroup over its places and sessions
    indexMesh.on("change", (event: { scope: string; table?: string; device?: string }) => {
      // PJ-3 — a visible projects page re-asks on any catalog's move (its
      // sessions, its standing), as the History page's pings do
      projectDoors.catalogChanged(event.device, event.table);
      if (event.scope !== "mesh") return;
      if (event.table === "projects") placeScanner.peersChanged();
      projectGroups.regroupSoon();
    });

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
    // UA-P-0a (D1) — THE PRODUCT SERVE IS NOT DECLARED WITHOUT AN ACCOUNT.
    // `null` here means the serve is absent from the desired set entirely, not
    // present with an empty allow: an unlinked desktop is offline and a
    // capturing one has no account to scope a door to yet. (What it did before:
    // declared the serve with NO allow, which the sidecar reads as "anyone the
    // tailnet verified" — an open door under a UI that said "not linked". The
    // cells serve already refused this shape; the product serve does now too.)
    const productServeSpec = (): ServeSpec | null => {
      const login = linkedLogin();
      if (login === null) return null;
      return {
        name: "product",
        target: { kind: "port", port: controlPort },
        // UA-P-0e (D2) — the TAILNET listener is the registry's fixed port, not
        // whatever ephemeral number the loopback control plane bound. With
        // nothing content-bearing on the bus there is no published slice to
        // learn a port from, so a peer DERIVES the coordinate — and a
        // derivation needs a number that is the same on every device. The two
        // planes are separate now: loopback stays ephemeral (UA-D12).
        listenPort: PORTS.FIELDD_PRODUCT_SERVE,
        tls: false,
        pathSecret: servePathSecret,
        // the sidecar matches with Go path.Match, lowercased both sides — a
        // login is a LITERAL here, so its glob metacharacters are escaped
        allow: [serveAllowGlob(login)],
      };
    };
    let lastArtifactServeSpecs: ServeSpec[] | null = null;
    let lastServeAllowLogin: string | null = null;
    // TM-2 — the terminal-cell listener's spec, owned by the driver below and
    // held here because `setServes` replaces the DESIRED SET wholesale: every
    // declaration has to carry the whole set or it withdraws the rest.
    let lastTerminalServeSpec: ServeSpec | null = null;
    // SP-3 — rosettad's serve, held for the same reason (index-serve.ts); null
    // forever while `indexDirectPlane` is off, because nothing declares it
    let lastIndexServeSpec: ServeSpec | null = null;
    // F1 — the freeway host's serve, held for the same reason (freeway.ts)
    let lastFreewayServeSpec: ServeSpec | null = null;
    const desiredServes = (): ServeSpec[] => {
      const product = productServeSpec();
      return [
        ...(product === null ? [] : [product]),
        ...(lastTerminalServeSpec === null ? [] : [lastTerminalServeSpec]),
        ...(lastIndexServeSpec === null ? [] : [lastIndexServeSpec]),
        ...(lastFreewayServeSpec === null ? [] : [lastFreewayServeSpec]),
        ...(lastArtifactServeSpecs ?? []),
      ];
    };
    links.on("changed", () => {
      const login = linkedLogin();
      if (login === lastServeAllowLogin) return;
      lastServeAllowLogin = login;
      // UA-P-0a — a link transition now includes null in BOTH directions, so
      // this runs before the artifact service has declared anything: a capture
      // completing must declare the product serve, and an unlink must withdraw
      // it, neither of which can wait on an unrelated subsystem's first pass.
      // (It used to return early while `lastArtifactServeSpecs` was null,
      // which was safe only because the allow was cosmetic then.)
      void (async () => {
        // the sidecar has no upsert (same-id add = PROXY_EXISTS) and the
        // reconcile SKIPS live serveIds — re-gating a live serve is
        // remove-then-add, or the old gate keeps running while the reported
        // state adopts the new spec (the mesh-client skip is recorded C3
        // debt; the brief serve blink here is once per link transition)
        await mesh.removeServe("product").catch(() => {});
        await mesh.setServes(desiredServes());
      })().catch((error: unknown) => {
        // mesh down/degraded: the next declare re-runs the reconcile; the
        // door's comparison still refuses guests meanwhile
        serveLog.debug("fieldd.serve.allow_refresh_deferred", "product allow refresh deferred", {
          error: String(error),
        });
      });
    });
    // TM-2 (TM-D2) — one serve route per live cell, driven off the floor's
    // route snapshot and its `terminalMesh` word. The driver is pure policy;
    // this closure is the only I/O, and it is remove-then-add for the reason
    // the product serve's own comment above states.
    const terminalServe = new TerminalServeDriver({
      routes: () => native.terminalRoutes,
      published: () => native.terminalMeshPublished(),
      linkedLogin,
      declare: async (spec) => {
        // F-M5 — A FAILED REMOVAL IS NOT A FRESH START. The old proxy is still
        // live on the listener, and `MeshClient`'s reconcile SKIPS a serveId
        // the node already lists: swapping the remembered spec here would have
        // it recorded `active` over a proxy serving the PREVIOUS routes, so
        // `mesh.serves()` would advertise routes the sidecar is not serving and
        // `remoteEndpoints` would mint tickets for paths it answers 404 for.
        // So the desired set keeps naming what is really up, and the driver is
        // told the declaration did not land, which is what re-arms its retry.
        try {
          await mesh.removeServe(TERMINAL_SERVE_ID);
        } catch (error) {
          // At warn (2026-10-17): this is the step a fresh pair start failed
          // at while the mesh node was still coming up, and at debug it left
          // nothing to read.
          serveLog.warn(
            "fieldd.terminal_serve.remove_deferred",
            "The terminal listener could not be taken down; the previous routes stay declared",
            { error: String(error) },
          );
          return false;
        }
        lastTerminalServeSpec = spec;
        const states = await mesh.setServes(desiredServes());
        // A withdrawal has nothing to place: the removal above IS the landing.
        if (spec === null) return true;
        const placed = states.find((state) => (state.serveId ?? state.name) === TERMINAL_SERVE_ID);
        return placed?.status === "active";
      },
      serves: () => mesh.serves(),
      logger: logger.child({ component: "terminal.serve" }),
    });
    native.on("terminal-endpoints", () => void terminalServe.refresh());
    links.on("changed", () => void terminalServe.refresh());
    // 2026-10-17 — the mesh node coming UP is a reading this driver depends on:
    // a declaration the down node refused is declared again then, or the doors
    // stayed unpublished until fieldd restarted (a fresh pair start, twice).
    mesh.on("node-up", () => void terminalServe.refresh());
    // the hello may already have landed before this driver existed — the
    // route snapshot is STATE, so reading it once here is the same answer the
    // event would have carried, and a second read is free (idempotent by
    // signature).
    void terminalServe.refresh();
    // SP-3 — rosettad's serve on `PORTS.INDEX_SERVE`, the route driver's second
    // user, driven off the supervisor's transitions (a restart is a new loopback
    // port) and the link. BEHIND `indexDirectPlane`, OFF: with the flag off no
    // driver exists and this daemon makes no index serve call at all; the
    // pinned rosettad verifies no credential (index-serve.ts says why that
    // decides it). The declaration is the terminal's remove-then-add, for the
    // same truffle reason and with the same F-M5 answer.
    // *AR-8b (2026-10-03): ON unless config says false — and only for a
    // configured daemon (no daemon, no driver: a boot without one stays
    // byte-for-byte what it was). `enabled` reads the generation, so the serve
    // stands only on one whose ready line enforces a bearer and grants.*
    const indexServe =
      config.indexDirectPlane !== false && rosettad !== null
        ? new IndexServeDriver({
            enabled: () => indexPlaneLive(rosettad.state()),
            origin: () => rosettad.state().origin,
            linkedLogin,
            declare: async (spec) => {
              try {
                await mesh.removeServe(INDEX_SERVE_ID);
              } catch (error) {
                serveLog.warn(
                  "fieldd.index_serve.remove_deferred",
                  "The index listener could not be taken down; the previous target stays declared",
                  { error: String(error) },
                );
                return false;
              }
              lastIndexServeSpec = spec;
              const states = await mesh.setServes(desiredServes());
              if (spec === null) return true;
              const placed = states.find(
                (state) => (state.serveId ?? state.name) === INDEX_SERVE_ID,
              );
              return placed?.status === "active";
            },
            serves: () => mesh.serves(),
            logger: logger.child({ component: "index.serve" }),
          })
        : null;
    if (indexServe !== null) {
      rosettad?.on("transition", () => void indexServe.refresh());
      links.on("changed", () => void indexServe.refresh());
      // the terminal's own reason, the same mechanism
      mesh.on("node-up", () => void indexServe.refresh());
      void indexServe.refresh();
    }
    // F1 (thinking-freeway.md v0.3 §3, §4.3) — THE FREEWAY: fieldd's one declaration to the floor
    // (who the host admits and with which hello, and the owner's word on off-device terminals),
    // the floor's state back, and the serve that puts the host on the tailnet. The declaration is
    // re-sent at every connect (a new floor boot forgets it) and on every roster change (this
    // desktop's id moves when the mesh identity lands; a desktop's slice turns a "phone" row into
    // a desktop one, FW-DF-1).
    // FW-L3 — fieldd is the only audit writer: a row for each join and leave the host reports, in
    // the floor's order, and one saying how many rows the floor could not hold (or read) while
    // fieldd was away — the audit says what it lost, never pretends. The floor lets a row go only
    // once it is written here (FreewayFloor's joins law).
    const freewayFloor = new FreewayFloor({
      native,
      declaration: () => freewayDeclaration(devices, config.freewayTerminals !== false),
      audit: {
        join: async (floorBootId, row) => {
          await audit.requiredSystem(
            {
              action: row.kind === "joined" ? "freeway.session.join" : "freeway.session.leave",
              target: { kind: "terminal", id: row.sessionId },
            },
            () => row,
            () => ({
              outcome: "succeeded",
              attrs: {
                clientId: row.clientId,
                rights: [...row.rights],
                at: row.at,
                cursor: row.cursor,
                floorBootId,
              },
            }),
          );
        },
        lost: async (floorBootId, lost) => {
          await audit.requiredSystem(
            { action: "freeway.joins.lost", target: { kind: "freeway", id: floorBootId } },
            () => lost,
            () => ({
              outcome: "failed",
              reasonCode: lost.dropped > 0 ? "BACKLOG_FULL" : "MALFORMED",
              attrs: { ...lost },
            }),
          );
        },
      },
      logger: logger.child({ component: "freeway" }),
    });
    const freewayServe = new FreewayServeDriver({
      state: () => freewayFloor.state(),
      linkedLogin,
      declare: async (spec) => {
        if (spec === null) {
          // the terminal's F-M5 answer for a withdrawal: a removal that failed did not land
          try {
            await mesh.removeServe(FREEWAY_SERVE_ID);
          } catch (error) {
            serveLog.warn(
              "fieldd.freeway_serve.remove_deferred",
              "The freeway listener could not be taken down; it stays declared",
              { error: String(error) },
            );
            return false;
          }
          lastFreewayServeSpec = null;
          await mesh.setServes(desiredServes());
          return true;
        }
        // NO remove-then-add (FW-L10): MeshClient adopts the serve the node lists when it is this
        // spec, and replaces it when it is not, so a restarted fieldd leaves every link standing.
        lastFreewayServeSpec = spec;
        const states = await mesh.setServes(desiredServes());
        const placed = states.find((state) => (state.serveId ?? state.name) === FREEWAY_SERVE_ID);
        return placed?.status === "active";
      },
      serves: () => mesh.serves(),
      logger: logger.child({ component: "freeway.serve" }),
    });
    // FW-D1 — the phone's approval: fieldd's one mint for a link (the host mints every grant after
    // it), audited like a ticket. The roster decides who is a phone; the floor's state holds the key.
    const freewayApprover = new FreewayApprover({
      state: () => freewayFloor.state(),
      roster: devices,
    });
    api.register("freeway.approve", async (ctx, params) => {
      const ask = freewayApprover.check(ctx, params);
      return await audit.required(
        ctx,
        { action: "freeway.approval.mint", target: { kind: "device", id: ask.deviceId } },
        () => freewayApprover.mint(ask),
        (approved) => ({
          outcome: "succeeded",
          attrs: { expiresAt: approved.expiresAt, rights: [...ask.rights] },
        }),
      );
    });
    // Unlink, sign-out, another account: every phone link the old login's approvals opened closes,
    // and the host walls every keyring it holds, so the cells floor the grants already out (§6).
    let freewayLogin = linkedLogin();
    links.on("changed", () => {
      const was = freewayLogin;
      freewayLogin = linkedLogin();
      if (was !== null && freewayLogin !== was) void freewayFloor.revokeAll();
    });
    freewayFloor.on("state", () => void freewayServe.refresh());
    links.on("changed", () => void freewayServe.refresh());
    mesh.on("node-up", () => void freewayServe.refresh());
    devices.on("changed", () => void freewayFloor.declare());
    native.on("connected", () => void freewayFloor.connected());
    void freewayFloor.connected();
    const artifacts = new ArtifactService({
      dataDir: config.dataDir,
      // UA-P-0c (D6) — the account an artifact's audience defaults to. The same
      // reader the product serve's allow and the door's comparison use, so all
      // three can only ever agree about who this desktop belongs to.
      linkedLogin,
      bridge: {
        declare: async (specs) => {
          lastArtifactServeSpecs = specs;
          lastServeAllowLogin = linkedLogin();
          await mesh.setServes(desiredServes());
        },
        remove: async (serveId) => await mesh.removeServe(serveId),
        states: () => mesh.serves(),
        observed: async () => await mesh.observedServes(),
        on: (cb) => {
          mesh.on("serves-changed", cb);
          return () => mesh.off("serves-changed", cb);
        },
      },
      // UA-P-0e (D2) — the bridge stays WIRED and the service decides what it
      // uses: its `subscribe`/`publish` legs are the bus and are off, while the
      // same bridge's device correlation and local refresh are what make this
      // desktop's OWN artifacts listable at all. (Dropping the bridge here was
      // the first shape and it was wrong — `artifacts()` returns nothing
      // without one, so turning off the public catalog hid the user's own work.)
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
      placeScanner.dispose(); // PJ-1 — no scan asks a worker that is leaving
      void projectRecords.dispose();
      projectGroups.dispose();
      offActed();
      void (async () => {
        await Promise.allSettled([
          updateManager.dispose(),
          serviceHost?.stopAll() ?? Promise.resolve(),
          processes.stopAll(),
          Promise.resolve(agentUsage.stop()), // AR-5d — stop asking before the runtime goes
          // AR-7b — the gateway closes and withdraws ITS rendezvous (never the
          // successor's) before the runs are released
          (gateway?.stop() ?? Promise.resolve())
            .catch(() => undefined)
            .then(() => {
              lastRun?.dispose(); // LR — the last picture, taken while the board still stands
              monitor?.dispose(); // MV-3a — off the runtime's bus before the runs go
              return agents.dispose();
            }),
          // the successor spawns its own rosettad over the SAME db — ours must
          // be gone first, and stop() resolves only after the real exit
          rosettad?.stop() ?? Promise.resolve(),
          workspace.stop(), // FS-1a — the files worker leaves with the daemon
        ]);
        await settleDocHolders(); // DS-5d — the holders ledger's last write, bounded (M176)
        indexTail.dispose(); // SP-6 — the session sockets close with the daemon they follow
        indexCatalog.dispose();
        runtimeDiagnostics.dispose();
        detachHealthSources?.();
        links.stop();
        await presenceRooms?.stop();
        docSync?.stop();
        laneLink.close();
        docs.dispose();
        const artifactDrain = artifacts.dispose();
        board.dispose(); // DS-3 — its hubs' upstreams close before the manager goes
        indexMesh?.dispose(); // DS-6 — the replicas are written before the links go
        federatedSubs.dispose(); // before peers: a dying link must not trigger recovery
        peers.dispose();
        indexServe?.dispose(); // SP-3 — stop re-aiming rosettad's serve before the mesh goes
        freewayServe.dispose(); // F1 — the floor keeps the serve: FW-L10
        freewayFloor.dispose();
        // DS-1b — a superseded daemon KEEPS its egress routes: the floor answers
        // only the successor now, which re-answers each route by its id
        egressCellRewriter?.dispose({ keepFloorRoutes: true });
        terminalServe.dispose(); // TM-2 — stop reconciling routes before the mesh goes
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
      board.dispose();
      indexTail.dispose();
      placeScanner.dispose();
      void projectRecords.dispose();
      projectGroups.dispose();
      offActed();
      indexCatalog.dispose();
      indexMesh?.dispose();
      federatedSubs.dispose();
      peers.dispose();
      indexServe?.dispose(); // SP-3 — stop re-aiming rosettad's serve before the mesh goes
      freewayServe.dispose(); // F1 — the floor keeps the serve: FW-L10
      freewayFloor.dispose();
      egressCellRewriter?.dispose(); // DS-1b — the last release takes each route off the floor
      void egressRoutes.dispose();
      terminalServe.dispose(); // TM-2 — stop reconciling routes before the mesh goes
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
    // SP-1 — whole lists (`ArtifactView[]`), the newest standing, at the
    // stream floor: the wire the kit and the browser plugin read is unchanged.
    api.registerSubscription("artifact.subscribe", (_ctx, _params, emit) =>
      wholeValueDoor(
        {
          read: () => artifacts.artifacts(),
          onChange: (listener) => artifacts.onCatalogChanged(() => listener()),
        },
        emit,
        { onError: streamFrameFailed("artifact.subscribe") },
      ),
    );
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
    // WIN-D4/EL7 — this directory holds the crown jewel: `shell.token` grants
    // FULL daemon adoption, and the `0o600` two dozen lines below is a NO-OP on
    // Windows (Node maps `mode` to the read-only attribute; NTFS has no
    // permission bits), so on that platform the credential's whole privacy is
    // whatever the parent happened to inherit — under %TEMP% or %LOCALAPPDATA%,
    // SYSTEM and Administrators at minimum. `createPrivateDir` is the Windows
    // expression of the same intent: inherited ACEs dropped, this account alone
    // granted, and the (OI)(CI) inheritance carries it to every file created
    // afterwards — so the token is born private with NO window between its
    // creation and its restriction. On POSIX it is mkdir(0o700) plus a
    // umask-proof chmod, which also tightens what the bare mkdir here used to
    // leave at the umask's mercy.
    const runDir = join(config.dataDir, ...LAYOUT.FIELDD_RUN_DIR);
    await createPrivateDir(runDir);
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
    // POSIX keeps its own true statement of the same law; on win32 both lines
    // are inert and the private run dir above is what is actually holding.
    writeFileSync(tokenPath, shellGrant.token, { mode: 0o600 });
    chmodSync(tokenPath, 0o600); // umask-proof
    // No per-FILE ACL edit on top: `restrictToCurrentUser` grants
    // `<account>:(OI)(CI)F`, which are CONTAINER inheritance flags. Applied to a
    // file, icacls reports success and leaves an EMPTY DACL — measured on
    // win32: the owner then gets EPERM on read, rewrite AND delete, i.e. it
    // bricks the credential it was meant to protect (and would break both the
    // shell's adoption read and this daemon's own cleanup on stop). The
    // directory grant is the mechanism that works; the helper needs a
    // non-container form before any file may call it.
    // product.json rides the same inherited ACL and asks for nothing more: it
    // is the discovery contract, not a secret — port, pid, bootId — and the
    // control port answers nothing without a scoped bearer token anyway (EL7).
    // Its temp file is born in the same directory, so it inherits the same.
    //
    // ONE writer, for the boot's write and every rewrite after it. From the
    // boot's write on, the file existing is the adoption contract; its
    // `nativePid` is the supervisor's floor of record, rewritten whenever that
    // floor changes (a respawn, a hello stating another pid) and only then.
    // Never once stop has begun (stop removes the file), and never once another
    // fieldd has superseded this one (the file is the successor's then).
    let productNativePid: number | null = null;
    let productClosed = false;
    const writeProductRecord = (nativePid: number | null): void => {
      // the successor's file, the boot's write included: a takeover can land
      // while the boot awaits above, after its last supersession check
      if (native.superseded) return;
      const record = {
        port: controlPort,
        pid: process.pid,
        bootId,
        contractsVersion: CONTRACTS_VERSION,
        startedAt,
        nativePid,
        buildId: config.buildId ?? null,
        userId: config.userId ?? null,
      } satisfies ProductInfo; // the shell/supervisor adoption contract (shell.ts)
      // atomic: a reader finds the record before or after, never a torn one
      const tmp = `${productPath}.${process.pid}.tmp`;
      try {
        writeFileSync(tmp, `${JSON.stringify(record, null, 2)}\n`);
        durableRenameSync(tmp, productPath);
      } catch (error) {
        try {
          rmSync(tmp, { force: true });
        } catch {
          // the write's own error is the one to report
        }
        throw error;
      }
      productNativePid = nativePid;
    };
    writeProductRecord(supervisor.recordedFloorPid);
    const onFloorOfRecord = ({ pid }: FloorOfRecord): void => {
      if (productClosed || native.superseded || pid === productNativePid) return;
      try {
        writeProductRecord(pid);
        logger.info(
          "fieldd.lifecycle.product_rewritten",
          "product.json names the floor this fieldd is linked to now",
          { nativePid: pid },
        );
      } catch (error) {
        // never fatal: the record still names the floor it named before
        logger.error(
          "fieldd.lifecycle.product_rewrite_failed",
          "product.json could not be rewritten for the floor this fieldd is linked to",
          error,
          { nativePid: pid },
        );
      }
    };
    supervisor.on("floor-of-record", onFloorOfRecord);

    logger.info("fieldd.lifecycle.ready", "fieldd is ready", { controlPort, dataPort });
    // AR-5d — boot has committed: account usage may be read from here. The
    // POLL itself is demand-driven (it runs while `agents.usage.subscribe` has
    // a subscriber) because a reading spends an authenticated call on the
    // person's own quota — see the note on `AccountUsageService.start`. A
    // provider that cannot be read degrades its own row (an honest state with
    // the adapter's sentence), never the daemon.
    agentUsage.start();
    // AR-S1c — boot has committed: the agents' installs are read now, in the
    // background (every agent's version command, seconds), so Settings →
    // Agents and the deck's launcher answer at once. Never a boot gate; the
    // product's daemon only (see `agentInventoryWarm`).
    if (config.agentInventoryWarm === true) {
      agents.distribution.warm();
      // AR-S2 — and This Mac's sign-ins (each installed agent's own status
      // command), so Settings → Agent Profiles opens on who is signed in
      void agents.profiles.readNativeIdentities();
    }
    // AR-0 — boot has committed: the index daemon starts now, in the
    // background. Readiness is a health transition, never a boot gate: a
    // missing or broken rosettad degrades the index, not the daemon.
    if (rosettad !== null) {
      // AR-1 — the record is on disk before the daemon can read it: `--enroll`
      // names it, and a missing file is a refused start. A publish failure is
      // logged and the launch still happens — the daemon's own refusal then
      // names the cause in the health detail, honestly.
      try {
        enrollment.publish();
      } catch (error) {
        logger.error(
          "fieldd.index.enrollment_publish_failed",
          "Enrollment record could not be written before the index daemon launch",
          error,
        );
      }
    }
    indexCatalog.start(); // DS-6 — follows the daemon's transitions from its first
    indexMesh?.start(); // DS-6 — the replicas load, then follow the roster
    void rosettad?.start();
    // FS-1a — boot has committed: the files worker starts with the daemon
    // (FS-D11 (b), always on; readiness is a transition, never a boot gate),
    // and the places this user's runs already recorded are seeded once.
    workspace.start();
    placeScanner.start(); // PJ-1 — scans once the catalog and the worker are both ready
    projectGroups.start(); // PJ-1 §4 — regroups as the places and sessions move
    try {
      workspace.registry.seedPlaces(agents.recordedPlaces());
    } catch (error) {
      logger.warn(
        "fieldd.workspace.seed_failed",
        "Places could not be seeded from the session records",
        {
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }
    let stopPromise: Promise<void> | null = null;
    const stop = (): Promise<void> => {
      stopPromise ??= (async () => {
        logger.info("fieldd.lifecycle.stopping", "fieldd is stopping");
        try {
          shellAbsenceRef?.dispose(); // AL-5 — a stopping pair watches for nothing
          // AL-7 — the sockets this stop closes are no shell leaving, and a record already owed is on disk first
          shellLeaseRef?.seal();
          await shellLeaseRef?.flush();
          // the record is this stop's to remove below, never to rewrite again
          productClosed = true;
          supervisor.off("floor-of-record", onFloorOfRecord);
          supervisor.stop(); // stop watching FIRST: a teardown is not a wedge
          await updateManager.dispose();
          await serviceHost?.stopAll(); // §18.6 — service deactivation before the API falls
          runtimeDiagnostics.dispose();
          await processes.stopAll(); // §17.1 — children die no later than fieldd shutdown
          agentUsage.stop(); // AR-5d — the polling ends before the runtime it asks
          // AR-7b — no launch is taken from here on: the gateway closes and its
          // rendezvous is withdrawn, and the list of our shells STAYS (a
          // launcher in a pane waits for the fieldd that comes next)
          await gateway?.stop();
          lastRun?.dispose(); // LR — the last picture, taken while the board still stands
          monitor?.dispose(); // MV-3a — the backend leaves the runtime's bus before the runs are released
          await agents.dispose(); // AR-2/AR-4 — the runs RELEASED (their PTYs outlive us) before the index
          indexTail.dispose(); // SP-6 — every session socket closes before its daemon stops
          index.dispose(); // AC-D8 — stop reacting to the daemon's transitions
          indexCatalog.dispose(); // DS-6 — the stream closes before its daemon stops
          await rosettad?.stop(); // AR-0 — the index daemon is fieldd-lifetime (AR-D6 v1)
          placeScanner.dispose(); // PJ-1 — no scan asks a worker that is stopping
          await projectRecords.dispose(); // PJ-2 — an act already running lands before the library closes
          projectGroups.dispose();
          offActed();
          await workspace.stop(); // FS-1a — the files worker stops with the daemon (FS-D11 (b))
          detachHealthSources?.();
          endpoints.dispose();
          mcp.dispose();
          await settingsDoc.dispose(); // D29′ — the doc's writes are already durable
          await settleDocHolders(); // DS-5d — the slice closes, its ledger settled or bounded
          for (const off of systemDocs?.unregister ?? []) off();
          await systemDocs?.library.dispose(); // DS-5 — every library write is durable
          api.close();
          docLane.close();
          await presenceRooms?.stop();
          docSync?.stop();
          laneLink.close();
          docs.dispose();
          const artifactDrain = artifacts.dispose();
          board.dispose(); // DS-3 — its hubs' upstreams close before the manager goes
          indexMesh?.dispose(); // DS-6 — the replicas are written before the links go
          federatedSubs.dispose(); // before peers: a dying link must not trigger recovery
          peers.dispose();
          indexServe?.dispose(); // SP-3 — stop re-aiming rosettad's serve before the mesh goes
          freewayServe.dispose(); // F1 — the floor keeps the serve: FW-L10
          freewayFloor.dispose();
          // DS-1b — the egress routes this daemon placed come off the floor
          // while the mgmt link still stands: the rewriter gives back its
          // references (the last release removes each route), and the port
          // waits, bounded, for the floor to answer the removals
          egressCellRewriter?.dispose();
          await Promise.race([
            egressRoutes.dispose(),
            new Promise<void>((resolve) => setTimeout(resolve, 2_000).unref()),
          ]);
          terminalServe.dispose(); // TM-2 — stop reconciling routes before the mesh goes
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
          await native.detach(); // AL-8a — the floor records this stop planned, never as a crash
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
      egressRoutes,
      federatedSubs,
      meshBoard: board,
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
      rosettad,
      enrollment,
      index,
      indexCatalog,
      indexTail,
      indexMesh: indexMesh as IndexMesh,
      projects: projectGroups,
      projectRecords,
      agents,
      agentUsage,
      agentGateway: gateway,
      terminals,
      workspace,
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
    // AR-0 — no index daemon outlives a failed boot. It is started only after
    // `fieldd.lifecycle.ready`, so this never has a child to stop today; the
    // guard is stated so a later start-before-ready cannot leave an orphan.
    agentUsage.stop(); // AR-5d — a failed boot leaves no poller and no listener
    await gatewayRef?.stop().catch(() => undefined); // AR-7b — nor a listener of the gateway's
    lastRun?.dispose(); // LR — nor the picture's listeners
    monitor?.dispose(); // MV-3a — nor the backend's listeners on the runtime's bus
    await agents.dispose();
    await rosettad?.stop();
    placeScanner.dispose(); // PJ-1 — likewise never started before ready
    void projectRecords.dispose();
    projectGroups.dispose();
    offActed();
    await workspace.stop(); // FS-1a — started only after ready; the guard is stated
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

/** AO-7 — the home puppeteer searches each provider's install directories under
 * (`distribution.home`, 0.3.1) when a harness isolates the search path: the
 * path's first directory, the stub's own in every harness, so the machine
 * owner's `~/.local/bin` and the like are never read. An empty list falls to the
 * user root, which here is fieldd's data directory, never $HOME. Production
 * passes no search path, so its inventory reads the person's own home. */
function agentInstallHome(searchPath: string, userRoot: string): string {
  return splitPathList(searchPath)[0] ?? userRoot;
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

/** DS-6 — the follower's own cadences out of the config seam (the digest
 * heartbeat is the door's, handed to each subscriber's pump instead). */
function catalogCadences(
  seam: FielddConfig["indexCatalog"],
): Omit<NonNullable<FielddConfig["indexCatalog"]>, "digestIntervalMs"> {
  if (seam === undefined) return {};
  const { digestIntervalMs: _heartbeat, ...cadences } = seam;
  return cadences;
}
