import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir, release, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { GhostteaElectronBackend } from "@vibecook/ghosttea-electron/main";
import {
  APP_PREFERENCE_KEYS,
  AppPreferences,
  CONTRACTS_VERSION,
  DESKTOP_APP_ID,
  type DesktopShellState,
  DesktopShellState as DesktopShellStateSchema,
  IPC_CHANNELS,
  PluginModuleResolution,
  type ShellCommand,
  ShellCommandRequest,
  type UserRecord,
  type UsersCreateParams,
} from "@vibefield/contracts";
import { SupportBundleExportV1 } from "@vibefield/contracts/diagnostics";
import type { FielddHandle, FielddSupervisor } from "@vibefield/fieldd-supervisor";
import { type Logger, resolvePlatformLogRoot } from "@vibefield/logging";
import {
  createUser,
  ensureUsersRoot,
  mutateUsersFile,
  readUsersFile,
  setLastAttached,
  userRootFor,
} from "@vibefield/users";
import {
  app,
  BrowserWindow,
  clipboard,
  crashReporter,
  dialog,
  MessageChannelMain,
  nativeImage,
  session,
  shell,
} from "electron";
import { applyDevelopmentDockIcon } from "./app-branding";
import { installAppMenu } from "./app-menu";
import { installAppProtocol } from "./app-protocol";
import { ArtifactPreviewCapture, isArtifactPreviewSession } from "./artifact-preview-capture";
import { runAuditedSupportExport } from "./audited-support-export";
import { installDurableClose } from "./close";
import { CrashArtifactManager, startLocalCrashReporter } from "./crash-artifacts";
import { installDevSignalQuit } from "./dev-signals";
import { installLocalDiagnosticsPort } from "./diagnostics-port";
import { buildSupervisor, dataRoot } from "./fieldd";
import { FielddDaemonBootFence, FielddHandleCoordinator } from "./fieldd-handle-coordinator";
import { GodviewRegistry, installGodviewDoubleShift } from "./godview";
import {
  registerGodviewToggle,
  registerTerminalBackend,
  registerUsersRoster,
  registerUsersUpdate,
  registerWindowBootstrap,
} from "./ipc";
import { installLifecycle } from "./lifecycle";
import { isGuardedBrowserSurfaceSession } from "./live-surfaces/browser-security";
import { createElectronLiveSurfaceTextureTransferApi } from "./live-surfaces/electron-texture-transfer";
import type { LiveSurfaceRuntimeAuthority } from "./live-surfaces/runtime";
import {
  LiveSurfaceTextureForwarder,
  type LiveSurfaceTextureTransferBudget,
} from "./live-surfaces/texture-forwarder";
import { LiveSurfaceTicketTable } from "./live-surfaces/ticket-table";
import { LiveSurfaceWindowHost } from "./live-surfaces/window-host";
import { ElectronLocalDiagnostics } from "./local-diagnostics";
import { createElectronLogging, type ElectronLogging } from "./logging";
import { isSmokeLike, parseDirectTerminalDoor, parseMode } from "./modes";
import { installPluginProtocol } from "./plugin-protocol";
import { RendererPluginProvenanceCatalog } from "./plugin-provenance";
import { RecoveringFielddObservers } from "./recovering-fieldd-observers";
import { installRendererLogging } from "./renderer-logging";
import {
  assertPackagedResources,
  resolveDevelopmentRepoRoot,
  resolveDevelopmentResources,
  resolvePackagedResources,
} from "./resources";
import { registerShellSchemes } from "./scheme-registration";
import {
  installCsp,
  installNavigationPolicy,
  installPermissionPolicy,
  installWebContentsBackstop,
} from "./security";
import { buildCsp, importMapHashesFromHtml } from "./security-policy";
import { backfillMigratedSetupVariant } from "./setup-variant";
import { RecoveringShellProvider } from "./shell-provider";
import { SupportBundleError, SupportBundleService } from "./support-bundle";
import { TerminalBackendRegistry } from "./terminal-backend";
import { TrayController } from "./tray-controller";
import { TrayEvidenceMonitor } from "./tray-evidence";
import type { TrayLinkState } from "./tray-model";
import { createElectronTrayRuntime } from "./tray-native";
import { WindowRegistry } from "./window-policy";
import { createMainWindow, loadRenderer } from "./windows";

// The composition root (ESR §5.2.1): mode → lock → lifecycle → CSP → supervisor
// → windows/IPC. Nothing else lives here — no discovery, no polling, no payload
// construction, no product logic. Smoke/spike implementations are a SEPARATE
// build artifact (dist/testing/smoke.cjs) reached only through the dynamic
// import below, which esbuild leaves external: the production main bundle
// contains none of that code (ESR-12), and packaging simply omits the file.

const MODE = parseMode(process.argv);
// TP-S3a — the direct terminal door (TP-D1 as ratified): a rollback flag, OFF
// until S3e; it widens the production CSP to the cells' loopback ports and, at
// S3b, routes the pool's transport. Parsed once, beside the mode.
const DIRECT_TERMINAL_DOOR = parseDirectTerminalDoor(process.argv, process.env);
// Smoke/headless runs have no GPU to talk to — a CI runner or an ssh session on
// Windows has no window station, and over ssh Chromium's GPU init fails outright.
// Force software rendering for smoke-like modes (harmless when a GPU is present);
// this is what lets `pnpm smoke` run over ssh and gate the Windows boot in CI.
// The Live Surfaces lab is smoke-like for isolation but deliberately exercises
// a real WebGPU device and its loss/replacement path, so it is the sole exception.
// Must precede `app.whenReady()`, so it lives here at module load.
// TP-S0c: `terminal-perf-lab` joins `live-surfaces-lab` in KEEPING hardware
// acceleration. A perf lab that measured a software rasteriser would publish
// numbers for a renderer nobody runs — the GPU path is the thing under test.
if (isSmokeLike(MODE) && MODE !== "live-surfaces-lab" && MODE !== "terminal-perf-lab") {
  app.disableHardwareAcceleration();
}
// TP-S0c: an OCCLUDED Chromium window stops presenting. Chromium suspends rAF
// and backgrounds the renderer when a window is covered or unfocused, which for
// a perf lab does not mean "slow" — it means zero: the lab's `single-pane` run
// collected frame samples in rotation 0 and none in rotations 1–3, from a window
// something else had come to sit on top of. These two switches keep the renderer
// awake so a measured zero is the terminal's and not the compositor's. They are
// mode-gated because a PRODUCTION shell should absolutely background an occluded
// window — that is a battery feature, and only the lab wants it off.
if (MODE === "terminal-perf-lab") {
  app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
  app.commandLine.appendSwitch("disable-renderer-backgrounding");
}
const VITE_URL = process.env["VITE_DEV_SERVER_URL"] ?? "http://localhost:5173";
const PRELOAD_PATH = join(__dirname, "..", "preload", "index.cjs");
const DESKTOP_BOOT_ID = `desktop-${randomBytes(8).toString("hex")}`;

let supervisor: FielddSupervisor | null = null;
let fielddHandles: FielddHandleCoordinator | null = null;
/** P8b-2 — the live fieldd client the plugin protocol authorizes against. Null
 * until the pair is up, which is the honest state: with no authority reachable,
 * no plugin module is servable. */
let pluginModuleClient: FielddHandle["client"] | null = null;
let logging: ElectronLogging | null = null;
let localDiagnostics: ElectronLocalDiagnostics | null = null;
let crashArtifacts: CrashArtifactManager | null = null;
let supportBundles: SupportBundleService | null = null;
let trayController: TrayController | null = null;
let terminalBackends: TerminalBackendRegistry | null = null;
let godviewStates: GodviewRegistry | null = null;
let primaryWindowOpener: (() => Promise<Electron.BrowserWindow>) | null = null;
const shellDisposers = new Set<() => void>();
const getSupervisor = () => supervisor;
const registry = new WindowRegistry();
const liveSurfaceTickets = new LiveSurfaceTicketTable<LiveSurfaceRuntimeAuthority>();
const liveSurfaceWindowHosts = new Map<number, LiveSurfaceWindowHost>();
const liveSurfaceTextureBudgets = new Map<string, LiveSurfaceTextureTransferBudget>();
const ensureFieldd: FielddSupervisor["ensure"] = (options) => {
  if (fielddHandles !== null) return fielddHandles.ensure(options);
  if (supervisor !== null) return supervisor.ensure(options);
  return Promise.reject(new Error("fieldd supervisor is unavailable"));
};

async function revealPrimaryWindow(): Promise<Electron.BrowserWindow> {
  if (primaryWindowOpener === null) {
    throw new Error("the primary window operation is not ready");
  }
  return primaryWindowOpener();
}

function disposeShellState(): void {
  trayController?.dispose();
  trayController = null;
  terminalBackends?.dispose();
  terminalBackends = null;
  godviewStates?.dispose();
  godviewStates = null;
  primaryWindowOpener = null;
  for (const dispose of shellDisposers) dispose();
  shellDisposers.clear();
  liveSurfaceWindowHosts.clear();
  liveSurfaceTextureBudgets.clear();
  liveSurfaceTickets.clear();
  fielddHandles?.dispose();
  fielddHandles = null;
}

function installLiveSurfaceHost(window: Electron.BrowserWindow, logger: Logger): void {
  const host = new LiveSurfaceWindowHost(
    window,
    liveSurfaceTickets,
    () => new MessageChannelMain(),
    logger.child({ component: "live-surfaces.window", windowId: String(window.id) }),
    (surfaceId, attachmentId, budget) =>
      new LiveSurfaceTextureForwarder(
        surfaceId,
        attachmentId,
        createElectronLiveSurfaceTextureTransferApi(window.webContents),
        2,
        budget,
      ),
    liveSurfaceTextureBudgets,
  ).install();
  liveSurfaceWindowHosts.set(window.id, host);
  const dispose = (): void => {
    host.dispose();
    liveSurfaceWindowHosts.delete(window.id);
    shellDisposers.delete(dispose);
  };
  shellDisposers.add(dispose);
  window.webContents.once("destroyed", dispose);
}

const testing = () =>
  // @ts-expect-error TS2307 — dist/testing/smoke.cjs is a runtime-external
  // build artifact (package.json build --external); types ride the cast.
  import("../testing/smoke.cjs") as Promise<typeof import("../testing/smoke")>;

async function closeEvidence(): Promise<void> {
  try {
    await crashArtifacts?.markClean();
  } catch (error) {
    logging?.logger.error(
      "desktop.crash.clean_marker_failed",
      "Electron could not record its clean shutdown",
      error,
    );
  }
  crashArtifacts = null;
  supportBundles = null;
  localDiagnostics?.dispose();
  localDiagnostics = null;
  await logging?.close();
}

async function main(
  root: string,
  logRoot: string,
  shellLogging: ElectronLogging,
  diagnostics: ElectronLocalDiagnostics,
  crashes: CrashArtifactManager,
  support: SupportBundleService,
  /** UA-2/UA-3 — the attached user (users.json): identity for the supervisor
   * gate, name for the tray, canonical root for the profile-write IPC. */
  user: { userId: string; name: string; rootReal: string },
): Promise<void> {
  const logger = shellLogging.logger;
  let crashEvidenceAvailable = true;
  let supportEvidenceAvailable = true;
  const appendShellAudit = async (record: Record<string, unknown>): Promise<void> => {
    const handle = await ensureFieldd().catch(() => {
      throw Object.assign(new Error("fieldd audit service is unavailable"), {
        kind: "AUDIT_UNAVAILABLE",
      });
    });
    await handle.client.request("audit.append", record);
  };
  const installDiagnostics = (window: Electron.BrowserWindow): void => {
    let supportDialogOpen = false;
    installLocalDiagnosticsPort({
      window,
      diagnostics,
      logger: logger.child({
        component: "diagnostics.port",
        windowId: String(window.id),
      }),
      actions: {
        openLogs: async () => {
          const error = await shell.openPath(logRoot);
          if (error !== "") {
            throw Object.assign(new Error("the logs directory could not be opened"), {
              kind: "INTERNAL",
            });
          }
          logger.info(
            "desktop.diagnostics.logs_opened",
            "The user opened the local logs directory",
          );
          return { opened: true };
        },
        listCrashes: () => crashes.refresh(),
        markCrashViewed: (request) => crashes.markViewed(request),
        previewSupport: (selection) => support.preview(selection),
        exportSupport: async (raw) => {
          if (supportDialogOpen) {
            throw new SupportBundleError(
              "RESOURCE_EXHAUSTED",
              "a support export is already active for this window",
            );
          }
          const request = SupportBundleExportV1.safeParse(raw);
          if (!request.success) {
            throw new SupportBundleError(
              "PRECONDITION_FAILED",
              "expected a valid support preview id",
            );
          }
          supportDialogOpen = true;
          try {
            return await runAuditedSupportExport({
              previewId: request.data.previewId,
              support,
              appendAudit: appendShellAudit,
              chooseDestination: () =>
                dialog.showSaveDialog(window, {
                  title: "Export VibeField Support Bundle",
                  defaultPath: join(
                    app.getPath("downloads"),
                    `VibeField-support-${new Date().toISOString().replace(/[:.]/g, "-")}.tar.gz`,
                  ),
                  buttonLabel: "Export",
                  filters: [{ name: "Compressed support bundle", extensions: ["gz"] }],
                  properties: ["createDirectory", "showOverwriteConfirmation"],
                }),
            });
          } finally {
            supportDialogOpen = false;
          }
        },
        copyText: (raw) => {
          const text =
            typeof raw === "object" && raw !== null && "text" in raw ? raw.text : undefined;
          if (typeof text !== "string" || Buffer.byteLength(text, "utf8") > 64 * 1024) {
            throw Object.assign(new Error("expected bounded clipboard text"), {
              kind: "PRECONDITION_FAILED",
            });
          }
          clipboard.writeText(text);
          return { copied: true };
        },
      },
    });
  };
  await app.whenReady();
  logger.info("desktop.lifecycle.ready", "Electron app is ready");
  try {
    await crashes.initialize();
  } catch (error) {
    crashEvidenceAvailable = false;
    logger.error(
      "desktop.crash.manifest_unavailable",
      "Electron crash artifacts are unavailable",
      error,
    );
  }
  try {
    await support.initialize();
  } catch (error) {
    supportEvidenceAvailable = false;
    logger.error(
      "desktop.support.initialization_failed",
      "Electron support bundle staging is unavailable",
      error,
    );
  }
  // ESP §6.2 — every session gate and contents guard is armed BEFORE the first
  // window exists, so no renderer can outrun its own policy.
  // P8b-3 (§11.6): the singleton import map is an inline script in the BUILT
  // index.html, admitted by its exact hash — computed here from the very file
  // the app protocol serves, so the policy and the document cannot drift
  // (build-deterministic bytes; a rebuilt map re-hashes on next boot). Dev has
  // no built html and a null CSP; absent file ⇒ no hashes ⇒ policy unchanged.
  // TP-S0c: the perf lab builds the SAME product renderer — same entry, same
  // plugins, same chunks, same production React — under a vite mode whose only
  // effects are one `define` and this output directory, under the ignored dev
  // root. So a lab build can never leave instrumented bytes sitting in the path
  // packaging picks up, and what it measures is the renderer that ships.
  // (`--mode` alone does NOT make `import.meta.env.DEV` true: mode and NODE_ENV
  // are separate in Vite and `build` pins the latter to production. The sampler
  // is admitted by an explicit door instead — `allowSamplingForPerfLab`.)
  // The driver passes the absolute path; the fallback keeps the mode runnable by
  // hand from a default build.
  const rendererRoot =
    MODE === "terminal-perf-lab"
      ? (process.env["VF_TERMINAL_PERF_LAB_RENDERER"] ??
        join(__dirname, "..", "..", "..", "..", ".vibefield", "terminal-perf-lab", "renderer"))
      : join(__dirname, "..", "renderer");
  let importMapHashes: string[] = [];
  try {
    importMapHashes = importMapHashesFromHtml(
      readFileSync(join(rendererRoot, "index.html"), "utf8"),
    );
  } catch {
    importMapHashes = [];
  }
  installCsp(MODE, importMapHashes, { directTerminalDoor: DIRECT_TERMINAL_DOOR });
  // The renderer's own origin. Dev serves from Vite instead, so the handler is
  // pointless there; every other mode loads vibefield-app://shell and would show
  // a blank window without it. Root is the built renderer beside dist/main.
  // P8b-2 (ESP §8.4) — the plugin module origin. Installed in EVERY mode
  // including dev: the app scheme is skipped in dev because Vite serves the
  // renderer, but plugin modules never come from Vite, and a staged plugin must
  // load the same way in dev as in production or the staged path is only ever
  // exercised at packaging time.
  installPluginProtocol({
    // The authority is fieldd, always asked, never cached (§8.4: a URL dies on
    // disable/reload/quarantine/revision change, and a cache here would be
    // exactly the staleness window that clause forbids).
    authorize: async (token) => {
      const client = pluginModuleClient;
      if (client === null || client.status !== "ready") return undefined;
      try {
        const raw = await client.request("plugins.resolveModule", { token });
        const parsed = PluginModuleResolution.safeParse(raw);
        if (!parsed.success) return undefined;
        return { path: parsed.data.path, contentType: parsed.data.contentType };
      } catch {
        // A refused token arrives as an RPC error; main treats "no" and "could
        // not ask" identically, because serving on a failure to reach the
        // authority would be serving without one.
        return undefined;
      }
    },
    onRefusal: (reason, url) => {
      logger.warn("desktop.security.plugin_module_refused", "A plugin-scheme request was refused", {
        reason,
        url,
      });
    },
  });
  const appCsp = buildCsp(MODE, importMapHashes, { directTerminalDoor: DIRECT_TERMINAL_DOOR });
  if (MODE !== "dev") {
    installAppProtocol({
      root: rendererRoot,
      ...(appCsp !== null ? { csp: appCsp } : {}),
      onRefusal: (reason, url) => {
        logger.warn("desktop.security.app_asset_refused", "An app-scheme request was refused", {
          reason,
          url,
        });
      },
    });
  }
  installPermissionPolicy(session.defaultSession, (permission) => {
    logger.warn(
      "desktop.security.permission_denied",
      "A Chromium permission request was denied by policy",
      { permission },
    );
  });
  installWebContentsBackstop(
    MODE,
    (contents) => {
      if (registry.owns(contents)) return;
      logger.warn(
        "desktop.security.unregistered_webcontents",
        "A WebContents was created outside the window factory and received the backstop policy",
        { webContentsId: contents.id, type: contents.getType() },
      );
    },
    (contents) =>
      isArtifactPreviewSession(contents.session) ||
      isGuardedBrowserSurfaceSession(contents.session),
  );
  app.on("child-process-gone", (_event, details) => {
    logger.warn("desktop.process.child_gone", "An Electron child process exited", {
      type: details.type,
      reason: details.reason,
      exitCode: details.exitCode,
      ...(details.serviceName !== undefined ? { serviceName: details.serviceName } : {}),
      ...(details.name !== undefined ? { name: details.name } : {}),
    });
    void crashes.refresh(details.type).catch((error) => {
      logger.error(
        "desktop.crash.refresh_failed",
        "Electron could not refresh crash evidence after a child exited",
        error,
        { type: details.type },
      );
    });
  });

  // §4.3 — resolve paths once, without discovery. Development points at the
  // checkout; a packaged app hangs every resource directly off Resources.
  const resources = app.isPackaged
    ? resolvePackagedResources({
        resourcesPath: process.resourcesPath,
        electronExecPath: process.execPath,
      })
    : resolveDevelopmentResources({
        repoRoot: resolveDevelopmentRepoRoot(
          app.getAppPath(),
          process.env["VIBEFIELD_DEV_REPO_ROOT"],
        ),
        electronExecPath: process.execPath,
      });
  // Fatal and typed before anything spawns: a missing or wrong-architecture
  // sidecar must read as a packaging failure with a doctor code, not as an exec
  // error later that looks like a missing file (§4.3, §14).
  assertPackagedResources(resources);

  let sckLabPaths:
    | {
        readonly kind: "fixture";
        readonly helperPath: string;
        readonly adapterPath: string;
        readonly fixturePath: string;
        readonly sessionCount: number;
      }
    | {
        readonly kind: "simulator";
        readonly helperPath: string;
        readonly adapterPath: string;
        readonly udid: string;
        readonly developerDir?: string;
        readonly rotate: boolean;
        readonly requireInactiveSpace: boolean;
      }
    | {
        readonly kind: "mixed";
        readonly helperPath: string;
        readonly adapterPath: string;
        readonly fixturePath: string;
        readonly fixtureCount: number;
        readonly udid: string;
        readonly developerDir?: string;
        readonly rotate: boolean;
        readonly requireInactiveSpace: boolean;
      }
    | undefined;
  const sckFixtureLab = process.env["VF_LIVE_SURFACES_SCK_LAB"] === "1";
  const simulatorLabUdid = process.env["VF_LIVE_SURFACES_SIMULATOR_UDID"];
  const rawSckSessionCount = process.env["VF_LIVE_SURFACES_SCK_SESSIONS"];
  const rawHelperCrashCount = process.env["VF_LIVE_SURFACES_HELPER_CRASHES"];
  const rawContinuousSoakMs = process.env["VF_LIVE_SURFACES_CONTINUOUS_SOAK_MS"];
  let continuousSoakMs: number | undefined;
  if (MODE === "live-surfaces-lab" && rawContinuousSoakMs !== undefined) {
    const parsed = Number(rawContinuousSoakMs);
    if (!Number.isSafeInteger(parsed) || parsed < 1_000 || parsed > 30 * 60_000) {
      throw new Error(
        "VF_LIVE_SURFACES_CONTINUOUS_SOAK_MS must be an integer from 1000 through 1800000",
      );
    }
    continuousSoakMs = parsed;
  }
  let sckSessionCount = 1;
  if (MODE === "live-surfaces-lab" && rawSckSessionCount !== undefined) {
    const parsed = Number(rawSckSessionCount);
    if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 4) {
      throw new Error("VF_LIVE_SURFACES_SCK_SESSIONS must be an integer from 1 through 4");
    }
    sckSessionCount = parsed;
  }
  let helperCrashCount = 0;
  if (MODE === "live-surfaces-lab" && rawHelperCrashCount !== undefined) {
    const parsed = Number(rawHelperCrashCount);
    if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 2) {
      throw new Error("VF_LIVE_SURFACES_HELPER_CRASHES must be an integer from 0 through 2");
    }
    helperCrashCount = parsed;
  }
  if (
    MODE === "live-surfaces-lab" &&
    !sckFixtureLab &&
    simulatorLabUdid !== undefined &&
    sckSessionCount !== 1
  ) {
    throw new Error("a Simulator-only lab owns exactly one SCK session");
  }
  if (MODE === "live-surfaces-lab" && helperCrashCount > 0 && continuousSoakMs === undefined) {
    throw new Error("helper crash recovery requires a continuous soak interval");
  }
  if (
    MODE === "live-surfaces-lab" &&
    helperCrashCount > 0 &&
    !sckFixtureLab &&
    simulatorLabUdid === undefined
  ) {
    throw new Error("helper crash recovery requires an SCK lab mode");
  }
  if (MODE === "live-surfaces-lab" && sckFixtureLab && simulatorLabUdid !== undefined) {
    const capture = resources.macosLiveSurfaceCapture;
    if (capture === null) throw new Error("the mixed SCK lab is available only on macOS");
    if (sckSessionCount < 2) throw new Error("a mixed SCK lab requires at least two sessions");
    sckLabPaths = {
      kind: "mixed",
      ...capture,
      fixturePath: join(dirname(capture.helperPath), "live-surface-capture-fixture"),
      fixtureCount: sckSessionCount - 1,
      udid: simulatorLabUdid,
      ...(process.env["DEVELOPER_DIR"] === undefined
        ? {}
        : { developerDir: process.env["DEVELOPER_DIR"] }),
      rotate: process.env["VF_LIVE_SURFACES_SIMULATOR_ROTATE"] === "1",
      requireInactiveSpace:
        process.env["VF_LIVE_SURFACES_SIMULATOR_REQUIRE_INACTIVE_SPACE"] === "1",
    };
  } else if (MODE === "live-surfaces-lab" && sckFixtureLab) {
    const capture = resources.macosLiveSurfaceCapture;
    if (capture === null) throw new Error("the ScreenCaptureKit lab is available only on macOS");
    sckLabPaths = {
      kind: "fixture",
      ...capture,
      fixturePath: join(dirname(capture.helperPath), "live-surface-capture-fixture"),
      sessionCount: sckSessionCount,
    };
  } else if (MODE === "live-surfaces-lab" && simulatorLabUdid !== undefined) {
    const capture = resources.macosLiveSurfaceCapture;
    if (capture === null)
      throw new Error("the Simulator Live Surface lab is available only on macOS");
    sckLabPaths = {
      kind: "simulator",
      ...capture,
      udid: simulatorLabUdid,
      ...(process.env["DEVELOPER_DIR"] === undefined
        ? {}
        : { developerDir: process.env["DEVELOPER_DIR"] }),
      rotate: process.env["VF_LIVE_SURFACES_SIMULATOR_ROTATE"] === "1",
      requireInactiveSpace:
        process.env["VF_LIVE_SURFACES_SIMULATOR_REQUIRE_INACTIVE_SPACE"] === "1",
    };
  }

  if (MODE === "live-surfaces-lab") {
    await (await testing()).runLiveSurfacesLab({
      root,
      registry,
      preloadPath: PRELOAD_PATH,
      beforeExit: closeEvidence,
      ...(continuousSoakMs === undefined ? {} : { continuousSoakMs }),
      ...(helperCrashCount === 0 ? {} : { helperCrashCount }),
      ...(sckLabPaths === undefined ? {} : { sck: sckLabPaths }),
    });
    return;
  }

  if (MODE === "spike-loro") {
    await (await testing()).runSpikeLoro({
      root,
      beforeExit: closeEvidence,
    });
    return;
  }

  try {
    const dockIcon = applyDevelopmentDockIcon(resources, {
      platform: process.platform,
      dock: process.platform === "darwin" ? (app.dock ?? null) : null,
      loadImage: (path) => nativeImage.createFromPath(path),
    });
    if (dockIcon.status === "applied") {
      logger.info(
        "desktop.identity.dock_icon_applied",
        "The development Electron bundle received VibeField's Dock icon",
        dockIcon,
      );
    }
  } catch (error) {
    logger.error(
      "desktop.identity.dock_icon_failed",
      "The development Electron bundle could not apply VibeField's Dock icon",
      error,
    );
  }
  const pluginProvenance = new RendererPluginProvenanceCatalog();
  let observedLink: TrayLinkState = "starting";
  const observedSnapshots: {
    preferences?: unknown;
    health?: unknown;
    hasPreferences: boolean;
    hasHealth: boolean;
  } = { hasPreferences: false, hasHealth: false };
  let healthObservationUnavailable = false;
  let evidenceMonitor: TrayEvidenceMonitor | null = null;
  let enforceBackgroundEscapeHatch = (): void => undefined;
  const publishLink = (status: string): void => {
    observedLink =
      status === "ready"
        ? "ready"
        : status === "reconnecting"
          ? "reconnecting"
          : status === "failed" || status === "closed"
            ? "unavailable"
            : "starting";
    trayController?.update({ link: observedLink });
  };
  const applyPreferences = (raw: unknown): void => {
    observedSnapshots.preferences = raw;
    observedSnapshots.hasPreferences = true;
    const parsed = AppPreferences.safeParse(raw);
    if (!parsed.success) {
      logger.warn(
        "desktop.tray.preferences_rejected",
        "The app-preference stream returned an invalid snapshot",
        { issueCount: parsed.error.issues.length },
      );
      return;
    }
    trayController?.update({
      showTray: parsed.data.showTray,
      backgroundShell: parsed.data.backgroundShell,
    });
    enforceBackgroundEscapeHatch();
  };
  const applyEvidenceHealth = (raw: unknown): void => {
    observedSnapshots.health = raw;
    observedSnapshots.hasHealth = true;
    healthObservationUnavailable = false;
    evidenceMonitor?.updateRemote(raw);
  };

  // ---- UA-5 — the per-user pair bundles and the attachment wiring ----
  // A PairBundle is the DURABLE half: supervisor + coordinator, one per user,
  // cached so a resident user's pair survives switch-away headless (UA-D3/
  // UA-D15). The attachment wiring — observers, shell provider, preview
  // capture — belongs to the ATTACHED user alone and is rebuilt every switch;
  // background pairs run headless with no shell.* provider (the AH-3
  // provider-absence honesty is the renderer-side face of that).
  interface PairBundle {
    supervisor: FielddSupervisor;
    handles: FielddHandleCoordinator;
  }
  const pairBundles = new Map<string, PairBundle>();
  let windowRendererBoundary: ReturnType<typeof registerWindowBootstrap> | null = null;
  const ensurePairBundle = (userId: string, userRoot: string): PairBundle => {
    const existing = pairBundles.get(userId);
    if (existing !== undefined) return existing;
    const sup = buildSupervisor({
      mode: MODE,
      root: userRoot,
      resources,
      viteUrl: VITE_URL,
      logRoot,
      logger,
      userId,
    });
    const handles = new FielddHandleCoordinator(
      (options) => sup.ensure(options),
      (error) => {
        publishLink("failed");
        pluginProvenance.invalidate();
        healthObservationUnavailable = true;
        evidenceMonitor?.markRemoteUnavailable();
        logger.error(
          "desktop.fieldd.ensure_failed",
          "A fieldd adoption/spawn attempt failed",
          error,
        );
      },
      (error) => {
        logger.error(
          "desktop.fieldd.observer_bind_failed",
          "A main-process fieldd observer could not bind",
          error,
        );
      },
    );
    const bundle = { supervisor: sup, handles };
    pairBundles.set(userId, bundle);
    return bundle;
  };
  const wireAttachment = (bundle: PairBundle, userRoot: string): { dispose(): void } => {
    const observers = new RecoveringFielddObservers(bundle.handles, {
      onStatus: (status) => {
        if (status !== "ready") pluginProvenance.invalidate();
        publishLink(status);
        logger.info("desktop.fieldd.link_state_changed", "fieldd link state changed", {
          status,
        });
      },
      observePlugins: (client) => pluginProvenance.observe(client),
      onPreferences: applyPreferences,
      onHealth: applyEvidenceHealth,
      onError: (kind, error) => {
        if (kind === "health") {
          healthObservationUnavailable = true;
          evidenceMonitor?.markRemoteUnavailable();
        }
        const [event, message] =
          kind === "plugins"
            ? [
                "desktop.plugins.log_provenance_unavailable",
                "Plugin log provenance could not follow the fieldd registry",
              ]
            : kind === "preferences"
              ? [
                  "desktop.tray.preferences_unavailable",
                  "Desktop behavior preferences could not be observed",
                ]
              : [
                  "desktop.tray.evidence_health_unavailable",
                  "The tray could not observe diagnostic evidence health",
                ];
        logger.error(event, message, error);
      },
    });
    const artifactPreviewCapture = new ArtifactPreviewCapture({
      dataDir: userRoot,
      native: {
        createSession: (partition) => session.fromPartition(partition, { cache: false }),
        createWindow: ({ width, height, partition, webPreferences }) =>
          new BrowserWindow({
            show: false,
            frame: false,
            focusable: false,
            resizable: false,
            skipTaskbar: true,
            width,
            height,
            useContentSize: true,
            paintWhenInitiallyHidden: true,
            webPreferences: {
              partition,
              ...webPreferences,
              experimentalFeatures: false,
              spellcheck: false,
              backgroundThrottling: false,
            },
          }),
        decodeImage: (bytes) => nativeImage.createFromBuffer(bytes),
      },
    });
    // P8b-2: keep the plugin protocol's authority pointed at the LIVE client.
    // Read at call time rather than captured, for the same reason the roster
    // reads its attachment at call time — a user switch or a daemon bounce
    // replaces the handle, and a captured one would authorize against a
    // connection that is no longer this device's fieldd.
    const stopPluginModuleClient = bundle.handles.onHandle((handle) => {
      pluginModuleClient = handle.client;
    });
    const daemonBootFence = new FielddDaemonBootFence();
    const stopDaemonBootFence = bundle.handles.onHandle((handle) => {
      const transition = daemonBootFence.observe(handle);
      if (transition === null) return;
      const replacement = windowRendererBoundary?.requestAllReplacements() ?? {
        requested: 0,
        unavailable: 0,
      };
      logger.warn(
        "desktop.fieldd.boot_authority_changed",
        "fieldd restarted; every surviving renderer document was fenced",
        { ...transition, ...replacement },
      );
    });
    const shellProvider = new RecoveringShellProvider(
      bundle.handles,
      {
        parentWindow: () => BrowserWindow.getFocusedWindow() ?? registry.primary(),
        showOpenDialog: (parent, options) => dialog.showOpenDialog(parent, options),
        openExternal: (url) => shell.openExternal(url),
        captureArtifactPreview: (params, signal) => artifactPreviewCapture.capture(params, signal),
        requestRendererReplacement: ({ rendererParticipant }) => ({
          requested: windowRendererBoundary?.requestReplacement(rendererParticipant) === true,
        }),
      },
      logger.child({ component: "shell.provider" }),
    );
    return {
      dispose: () => {
        observers.dispose();
        shellProvider.dispose();
        stopDaemonBootFence();
        stopPluginModuleClient();
        pluginModuleClient = null;
      },
    };
  };

  /** The live attachment — usersUpdate and the roster read it at CALL time,
   * never a captured boot value (the switch reassigns it). rootReal is the
   * VibeField root and never moves. */
  let attached = user;
  const bootBundle = ensurePairBundle(user.userId, root);
  supervisor = bootBundle.supervisor;
  fielddHandles = bootBundle.handles;
  let attachmentWiring = wireAttachment(bootBundle, root);
  let attachmentDisposer = (): void => attachmentWiring.dispose();
  shellDisposers.add(attachmentDisposer);
  // Quit path: background bundles are not reachable through the module-lets
  // disposeShellState/lifecycle own — the attached bundle is skipped here
  // because those paths already dispose it (and the supervisor via
  // getSupervisor).
  shellDisposers.add(() => {
    for (const bundle of pairBundles.values()) {
      if (bundle.handles === fielddHandles) continue;
      bundle.handles.dispose();
      void bundle.supervisor.dispose().catch(() => undefined);
    }
    pairBundles.clear();
  });

  // ensure() starts NOW; the window never waits for it (ESR-8 / design-03
  // §4.3 v0.3 — the splash is the honest face while the daemon comes up).
  // Every later retry uses the same coordinator, so recovery rebinds main too.
  const fielddReady = fielddHandles.ensure();
  void fielddReady.catch(() => undefined);

  if (MODE === "smoke") {
    await (await testing()).runSmoke(await fielddReady, supervisor, root, closeEvidence);
    return;
  }

  windowRendererBoundary = registerWindowBootstrap(
    registry,
    (options) => fielddHandles!.ensure(options),
    DESKTOP_BOOT_ID,
    logger.child({ component: "ipc.bootstrap" }),
  );

  // UA-3 — the Account page's profile write: main owns users.json (UA-D10),
  // mutates under the §3.3 lock, and refreshes the tray label in step.
  // UA-5: the handlers read `attached` at CALL time — a switch re-targets
  // them without re-registration.
  registerUsersUpdate(
    registry,
    {
      read: async () => {
        const file = readUsersFile(attached.rootReal);
        const record = file?.users.find((u) => u.userId === attached.userId);
        if (record === undefined) {
          throw new Error("the attached user vanished from users.json");
        }
        return record;
      },
      apply: async (params) => {
        const updated = await mutateUsersFile(attached.rootReal, {}, (file) => {
          const record = file.users.find((u) => u.userId === attached.userId);
          if (record === undefined) {
            throw new Error("the attached user vanished from users.json");
          }
          if (params.name !== undefined) record.name = params.name;
          if (params.color !== undefined) record.color = params.color;
          if (params.resident !== undefined) record.resident = params.resident;
          if (params.onboarded !== undefined) record.onboarded = params.onboarded;
        });
        const record = updated.users.find((u) => u.userId === attached.userId);
        if (record === undefined) {
          throw new Error("the attached user vanished from users.json");
        }
        if (params.name !== undefined) {
          trayController?.update({ userName: record.name, users: rosterFor() });
        }
        return record;
      },
    },
    logger.child({ component: "ipc.users" }),
  );

  // ---- UA-5 — attach/switch (UA-D15) and the roster surface ----
  const rosterFor = (): { userId: string; name: string; attached: boolean }[] => {
    const file = readUsersFile(attached.rootReal);
    return (file?.users ?? []).map((u) => ({
      userId: u.userId,
      name: u.name,
      attached: u.userId === attached.userId,
    }));
  };
  /** Attach = build-before-break: the target pair must answer ensure() before
   * anything detaches; a failed spawn/adopt leaves the current user whole
   * (the bundle stays cached for a retry). On success the module-lets swap —
   * every late-bound reader (windowBootstrap, ensureFieldd, tray prefs,
   * support context) follows — the attachment wiring rebuilds, the previous
   * pair stays headless when resident and stops (owned children only) when
   * not, and the window reloads: the renderer bootstrap generation re-mints
   * against the new pair for free. */
  let switching = false;
  const attachUser = async (targetUserId: string): Promise<UserRecord> => {
    const file = readUsersFile(attached.rootReal);
    if (file === null) throw new Error("users.json is unreadable");
    const target = file.users.find((u) => u.userId === targetUserId);
    if (target === undefined) throw new Error(`no such user: ${targetUserId}`);
    if (target.userId === attached.userId) return target;
    if (switching) throw new Error("a user switch is already in flight");
    switching = true;
    try {
      const previousId = attached.userId;
      const previousRecord = file.users.find((u) => u.userId === previousId);
      const targetRoot = userRootFor(attached.rootReal, target);
      const bundle = ensurePairBundle(target.userId, targetRoot);
      await bundle.handles.ensure();
      shellDisposers.delete(attachmentDisposer);
      attachmentWiring.dispose();
      supervisor = bundle.supervisor;
      fielddHandles = bundle.handles;
      attached = { userId: target.userId, name: target.name, rootReal: attached.rootReal };
      attachmentWiring = wireAttachment(bundle, targetRoot);
      attachmentDisposer = (): void => attachmentWiring.dispose();
      shellDisposers.add(attachmentDisposer);
      if (previousRecord !== undefined && previousRecord.resident === false) {
        const previous = pairBundles.get(previousId);
        pairBundles.delete(previousId);
        if (previous !== undefined) {
          previous.handles.dispose();
          // dispose stops OWNED children under a stop-owned policy; an
          // adopted external pair is not ours to kill — it stays, honestly
          void previous.supervisor.dispose().catch(() => undefined);
        }
      }
      void setLastAttached(attached.rootReal, target.userId, {}, (error) => {
        logger.warn(
          "desktop.users.last_attached_skipped",
          "The lastAttached hint could not be written (best-effort, never blocking)",
          { error: String(error) },
        );
      });
      trayController?.update({ userName: target.name, users: rosterFor() });
      logger.info("desktop.users.attached", "The shell re-targeted to another user", {
        userId: target.userId,
        fuid: target.fuid,
      });
      registry.primary()?.webContents.reload();
      return target;
    } finally {
      switching = false;
    }
  };
  const createAndAttach = async (params: UsersCreateParams): Promise<UserRecord> => {
    const { user: minted } = await createUser(
      attached.rootReal,
      {},
      {
        ...(params.name !== undefined ? { name: params.name } : {}),
        ...(params.color !== undefined ? { color: params.color } : {}),
        // the reloaded window runs the wizard's §6.2 second-user variant —
        // identity is decided THERE, the mint only needs to exist
        extras: { setupVariant: "second-user" },
      },
    );
    trayController?.update({ users: rosterFor() });
    return attachUser(minted.userId);
  };
  registerUsersRoster(
    registry,
    {
      list: async () => {
        const file = readUsersFile(attached.rootReal);
        if (file === null) throw new Error("users.json is unreadable");
        return { attachedUserId: attached.userId, users: file.users };
      },
      create: (params) => createAndAttach(params),
      switchTo: (params) => attachUser(params.userId),
    },
    logger.child({ component: "ipc.users" }),
  );

  // GT-D3: external mode, never the supervisor — field-native embeds the floor
  // and outlives this process. The registry builds nothing until a renderer
  // hands over a ticket, so a window with no deck forks no bridge.
  terminalBackends = new TerminalBackendRegistry({
    bridgeEntryPoint: join(__dirname, "bridge-entry.mjs"),
    createBackend: (options) => new GhostteaElectronBackend(options),
    logger: logger.child({ component: "terminal.backend" }),
  });
  registerTerminalBackend(registry, terminalBackends, logger.child({ component: "ipc.terminal" }));

  // GT-D2: main owns the overlay bit, the menu draws it, the renderer reads it.
  // `redrawMenu` is assigned below for the modes that have a menu; the states
  // exist in every windowed mode because the renderer needs its truth either
  // way.
  let redrawMenu: (state: { godviewOpen: boolean }) => void = () => undefined;
  godviewStates = new GodviewRegistry({
    logger: logger.child({ component: "godview" }),
    onChanged: (state) => redrawMenu({ godviewOpen: state.open }),
  });
  registerGodviewToggle(registry, godviewStates, logger.child({ component: "ipc.godview" }));
  /** The accelerator's and the menu item's one action. The focused window is
   * the subject — that is what "toggle" means from a menu — falling back to the
   * primary window, which is the only one v1 has and the one a hidden harness
   * drives. */
  const toggleGodview = (): void => {
    const window = BrowserWindow.getFocusedWindow() ?? registry.primary();
    if (window === null || window.isDestroyed()) return;
    godviewStates?.ensure(window.webContents).set();
  };
  /** Close Window's action, needed only while the overlay is open: the item
   * drops `role: "close"` there to release ⌘W for the deck's panes, and the
   * role's own close behaviour has to be supplied by hand with it
   * (`app-menu-model`'s `closeWindowItem`). Same subject as the toggle. */
  const closeWindow = (): void => {
    const window = BrowserWindow.getFocusedWindow() ?? registry.primary();
    if (window === null || window.isDestroyed()) return;
    window.close();
  };

  // THE APPLICATION MENU, installed before the godview harness rather than
  // after it (GT-5a).
  //
  // It used to be installed below both smoke branches, on the reasoning that a
  // harness presents no UI — true of `smoke` and `smoke-canvas`, and false of
  // `smoke-godview`, whose window is SHOWN and typed into. The cost was that the
  // one function whose entire reason for existing is the ⌘W arbitration between
  // window and pane was never in place while the smoke pressed ⌘W: `redrawMenu`
  // stayed a no-op, so making the accelerator unconditional would have closed
  // the window in production with every row still green.
  //
  // The rule is a window somebody can press a key in — production, dev, and the
  // godview harness. `smoke` and `spike-loro` have already returned by here;
  // `smoke-canvas`'s window is hidden, so it would be installing accelerators
  // for nobody.
  if (MODE !== "smoke-canvas" && MODE !== "smoke-plugin-restart") {
    redrawMenu = installAppMenu(process.platform === "darwin" ? "darwin" : "other", {
      toggleGodview,
      closeWindow,
    });
  }

  // TP-S0c — the perf lab. Wired exactly like the godview smoke (the driving
  // pattern it reuses): a SHOWN window on the production factory, the real
  // daemon pair against an isolated data root, real panes through the
  // workspace's own doors. It differs in what it does with them — it drives a
  // scenario and reads the TP-S0a sampler instead of asserting rows.
  if (MODE === "terminal-perf-lab") {
    await (await testing()).runTerminalPerfLab({
      handle: await fielddReady,
      supervisor,
      root,
      registry,
      preloadPath: PRELOAD_PATH,
      viteUrl: VITE_URL,
      toggleGodview,
      beforeExit: closeEvidence,
      onWindow: (window) => {
        installRendererLogging({
          window,
          sink: shellLogging.renderer,
          pluginRouter: shellLogging.pluginRendererRouter,
          pluginResolver: pluginProvenance,
          desktopLogger: logger,
          onProcessGone: () => {
            void crashes.refresh("renderer").catch(() => undefined);
          },
        });
      },
    });
    return;
  }

  // TP-S3a — the door probe: the real pair, one session through fieldd's own
  // door, the renderer DOCUMENT and a WORKER dialing the cell's T1 doors with
  // the ticket's grant. `ConnectionAccepted` from both is the gate line.
  if (MODE === "terminal-door-probe") {
    await (await testing()).runTerminalDoorProbe({
      handle: await fielddReady,
      supervisor,
      root,
      registry,
      preloadPath: PRELOAD_PATH,
      viteUrl: VITE_URL,
      beforeExit: closeEvidence,
      onWindow: (window) => {
        installRendererLogging({
          window,
          sink: shellLogging.renderer,
          pluginRouter: shellLogging.pluginRendererRouter,
          pluginResolver: pluginProvenance,
          desktopLogger: logger,
          onProcessGone: () => {
            void crashes.refresh("renderer").catch(() => undefined);
          },
        });
      },
    });
    return;
  }

  if (MODE === "smoke-godview") {
    await (await testing()).runSmokeGodview({
      handle: await fielddReady,
      supervisor,
      root,
      registry,
      preloadPath: PRELOAD_PATH,
      viteUrl: VITE_URL,
      // The accelerator's own action, handed over rather than re-implemented:
      // the harness must exercise the path ⇧⇧ takes, not a parallel one.
      toggleGodview,
      beforeExit: closeEvidence,
      onWindow: (window) => {
        installLiveSurfaceHost(window, logger);
        installRendererLogging({
          window,
          sink: shellLogging.renderer,
          pluginRouter: shellLogging.pluginRendererRouter,
          pluginResolver: pluginProvenance,
          desktopLogger: logger,
          onProcessGone: () => {
            void crashes.refresh("renderer").catch((error) => {
              logger.error(
                "desktop.crash.refresh_failed",
                "Electron could not refresh crash evidence after a renderer exited",
                error,
              );
            });
          },
        });
        installDiagnostics(window);
      },
    });
    return;
  }

  if (MODE === "smoke-canvas") {
    await (await testing()).runSmokeCanvas({
      handle: await fielddReady,
      supervisor,
      root,
      registry,
      preloadPath: PRELOAD_PATH,
      viteUrl: VITE_URL,
      beforeExit: closeEvidence,
      onWindow: (window) => {
        installLiveSurfaceHost(window, logger);
        installRendererLogging({
          window,
          sink: shellLogging.renderer,
          pluginRouter: shellLogging.pluginRendererRouter,
          pluginResolver: pluginProvenance,
          desktopLogger: logger,
          onProcessGone: () => {
            void crashes.refresh("renderer").catch((error) => {
              logger.error(
                "desktop.crash.refresh_failed",
                "Electron could not refresh crash evidence after a renderer exited",
                error,
              );
            });
          },
        });
        installDiagnostics(window);
      },
    });
    return;
  }

  if (MODE === "smoke-plugin-restart") {
    await (await testing()).runSmokePluginRestart({
      handle: await fielddReady,
      onHandle: (listener) => fielddHandles!.onHandle(listener),
      supervisor,
      rendererBoundary: windowRendererBoundary!,
      logging: shellLogging,
      root,
      registry,
      preloadPath: PRELOAD_PATH,
      viteUrl: VITE_URL,
      beforeExit: closeEvidence,
      onWindow: (window) => {
        installLiveSurfaceHost(window, logger);
        installRendererLogging({
          window,
          sink: shellLogging.renderer,
          pluginRouter: shellLogging.pluginRendererRouter,
          pluginResolver: pluginProvenance,
          desktopLogger: logger,
          onProcessGone: () => {
            void crashes.refresh("renderer").catch((error) => {
              logger.error(
                "desktop.crash.refresh_failed",
                "Electron could not refresh crash evidence after a renderer exited",
                error,
              );
            });
          },
        });
        installDiagnostics(window);
      },
    });
    return;
  }

  let latestDesktopState: DesktopShellState | null = null;
  const publishDesktopState = (raw: DesktopShellState): void => {
    const state = DesktopShellStateSchema.parse(raw);
    latestDesktopState = state;
    const window = registry.primary();
    if (window !== null && !window.isDestroyed()) {
      window.webContents.send(IPC_CHANNELS.desktopState, state);
    }
  };

  primaryWindowOpener = () =>
    registry.revealPrimary(() => {
      performance.mark("vf:shell:window-created");
      const window = createMainWindow({ mode: MODE, preloadPath: PRELOAD_PATH, show: true });
      return {
        window,
        prepare: async () => {
          installLiveSurfaceHost(window, logger);
          installRendererLogging({
            window,
            sink: shellLogging.renderer,
            pluginRouter: shellLogging.pluginRendererRouter,
            pluginResolver: pluginProvenance,
            desktopLogger: logger,
            onProcessGone: () => {
              void crashes.refresh("renderer").catch((error) => {
                logger.error(
                  "desktop.crash.refresh_failed",
                  "Electron could not refresh crash evidence after a renderer exited",
                  error,
                );
              });
            },
          });
          installDiagnostics(window);
          // ⇧⇧ — the whole binding, since a double tap is a rhythm and no menu
          // accelerator can express one. Installed per window and dies with its
          // webContents, so it cannot outlive what it toggles.
          installGodviewDoubleShift(window.webContents, toggleGodview);
          installNavigationPolicy(window, MODE);
          installDurableClose(
            window,
            logger.child({ component: "window.close", windowId: String(window.id) }),
            () => {
              registry.markClosing(window);
            },
          );
          await loadRenderer(window, MODE, VITE_URL);
          if (latestDesktopState !== null) {
            window.webContents.send(IPC_CHANNELS.desktopState, latestDesktopState);
          }
          // A fresh document believes the overlay is closed; main knows whether
          // it is. Correcting it here means a reload never leaves the toolbar
          // button and the menu checkmark disagreeing.
          godviewStates?.ensure(window.webContents).republish();
          logger.info("desktop.window.renderer_loaded", "The main renderer finished loading", {
            windowId: String(window.id),
            webContentsId: window.webContents.id,
          });
        },
      };
    });

  const revealSurface = async (command: ShellCommand): Promise<void> => {
    const window = await revealPrimaryWindow();
    if (!window.isDestroyed()) {
      window.webContents.send(IPC_CHANNELS.shellCommand, ShellCommandRequest.parse({ command }));
    }
  };
  const setAppPreference = async (
    key: (typeof APP_PREFERENCE_KEYS)[keyof typeof APP_PREFERENCE_KEYS],
    value: boolean,
  ): Promise<void> => {
    const handle = await ensureFieldd();
    await handle.client.request("storage.appPreferences.set", { key, value });
  };

  evidenceMonitor = new TrayEvidenceMonitor({
    writers: [
      shellLogging.desktop,
      shellLogging.renderer,
      shellLogging.utility,
      shellLogging.pluginRenderer,
    ],
    localAvailable: crashEvidenceAvailable && supportEvidenceAvailable,
    onChange: (evidence) => trayController?.update({ evidence }),
  });
  if (observedSnapshots.hasHealth) evidenceMonitor.updateRemote(observedSnapshots.health);
  else if (healthObservationUnavailable) evidenceMonitor.markRemoteUnavailable();
  shellDisposers.add(() => evidenceMonitor?.dispose());

  trayController = new TrayController({
    runtime: createElectronTrayRuntime(resources),
    initial: {
      link: observedLink,
      evidence: evidenceMonitor.current(),
      update: { kind: "idle" },
      userName: attached.name,
      users: rosterFor(),
      backgroundShell: true,
      // Preference truth belongs to fieldd's D29′ settings document. Starting
      // absent avoids flashing a status item a returning user explicitly hid;
      // the snapshot below creates it moments later on the default path.
      showTray: false,
      windowOpen: registry.primary() !== null,
      quitting: false,
    },
    actions: {
      openPrimaryWindow: async () => {
        await revealPrimaryWindow();
      },
      openSettings: () => revealSurface("open-settings"),
      openDiagnostics: () => revealSurface("open-diagnostics"),
      setBackgroundShell: (enabled) =>
        setAppPreference(APP_PREFERENCE_KEYS.BACKGROUND_SHELL, enabled),
      setTrayVisible: (enabled) => setAppPreference(APP_PREFERENCE_KEYS.SHOW_TRAY, enabled),
      switchUser: async (userId: string) => {
        await attachUser(userId);
      },
      newUser: async () => {
        await createAndAttach({});
      },
      quit: () => app.quit(),
    },
    onError: (stage, error) => {
      logger.error(
        "desktop.tray.operation_failed",
        "The native tray could not complete an operation",
        error,
        { stage },
      );
    },
    onNativeState: (state) => {
      const attrs = {
        reason: state.reason,
        platform: state.platform,
        guid: state.guid,
        imageKind: state.imageKind,
        image: state.image,
        bounds: state.native.bounds,
        displayBounds: state.native.displayBounds,
        placement: state.native.placement,
      };
      if (state.native.placement === "offscreen") {
        logger.warn(
          "desktop.tray.native_state",
          "The native status item exists but is outside every visible display",
          attrs,
        );
      } else {
        logger.info(
          "desktop.tray.native_state",
          "The native status item was created and inspected",
          attrs,
        );
      }
    },
    onDesktopState: publishDesktopState,
  });
  let primaryHasOpened = registry.primary() !== null;
  enforceBackgroundEscapeHatch = (): void => {
    const controller = trayController;
    if (
      primaryHasOpened &&
      process.platform !== "darwin" &&
      registry.primary() === null &&
      controller !== null &&
      !controller.current().quitting &&
      !controller.keepsAliveWithoutWindows()
    ) {
      logger.info(
        "desktop.lifecycle.background_escape_lost",
        "The shell is quitting because no window or usable tray escape hatch remains",
      );
      app.quit();
    }
  };
  const stopWindowObservation = registry.onPrimaryChanged((windowOpen) => {
    if (windowOpen) primaryHasOpened = true;
    trayController?.update({ windowOpen });
  });
  shellDisposers.add(stopWindowObservation);
  if (observedSnapshots.hasPreferences) applyPreferences(observedSnapshots.preferences);

  await revealPrimaryWindow();
}

app.setName("VibeField");
if (process.platform === "win32") app.setAppUserModelId(DESKTOP_APP_ID);
// ESP §6.1 step 2 — privileged schemes MUST be declared before ready; Electron
// refuses the registration afterwards, and a scheme that is not `standard`
// cannot host the renderer's ES-module graph. Registered in every mode so the
// declaration cannot drift from the mode that serves it.
// ONE call for all shell schemes — a second registerSchemesAsPrivileged call
// strips `secure` from the first call's schemes while `standard` survives (the
// P8b-2 smoke:canvas regression; account in scheme-registration.ts).
registerShellSchemes();
// ESP-4/§6.1 — process-wide renderer sandboxing, before ready and before any
// window policy runs. Independent of per-window `sandbox:true` (which stays)
// and of the RunAsNode fuse: three controls, three surfaces, no substitutes.
app.enableSandbox();
if (!isSmokeLike(MODE)) {
  try {
    startLocalCrashReporter({
      start: (config) => crashReporter.start(config),
      bootId: DESKTOP_BOOT_ID,
      appVersion: app.getVersion(),
      contractsVersion: CONTRACTS_VERSION,
      channel: MODE,
    });
  } catch {
    process.stderr.write("VibeField local crash reporter failed to initialize\n");
  }
}

// D10 — establish shell ownership synchronously, before any stream writer can
// race. The primary logs both acquisition and the second-instance callback;
// a rejected secondary cannot append to the primary's physical stream.
const hasInstanceLock = isSmokeLike(MODE) || app.requestSingleInstanceLock();
if (!hasInstanceLock) {
  app.quit();
} else {
  void (async () => {
    performance.mark("vf:shell:boot-start");
    const root = dataRoot(MODE);
    const logRoot = isSmokeLike(MODE)
      ? join(root, "logs")
      : resolvePlatformLogRoot({ allowOverride: MODE === "dev" });
    app.setAppLogsPath(logRoot);
    logging = await createElectronLogging({
      logRoot,
      dataRoot: root,
      bootId: DESKTOP_BOOT_ID,
    });
    localDiagnostics = new ElectronLocalDiagnostics(logging);
    // UA-1 — resolve the attached user BEFORE anything touches product state:
    // migrate-or-mint under the users.json lock (§3.3/§4). Everything holding
    // product state below (crash, support, previews, the daemon pair) roots at
    // the USER root; logging and the instance lock stay on the VibeField root
    // above it. Smoke-like runs with an INJECTED root may not mint — an
    // injected FIELDD_DATA_DIR is someone else's data (the smoke.ts law,
    // extended from deletion to writing).
    const usersLogger = logging.logger.child({ component: "users" });
    // The same condition twice, named once: a smoke-like run with an INJECTED
    // root may neither mint into nor amend someone else's users.json.
    const mayWriteUsers = !(isSmokeLike(MODE) && process.env["FIELDD_DATA_DIR"] !== undefined);
    const ensured = await ensureUsersRoot(root, {
      allowMint: mayWriteUsers,
      // UA-3w — a test harness never meets the Setup Assistant: it has no hands
      // to answer it with, and a held boot would read as a hung smoke.
      mintOnboarded: isSmokeLike(MODE),
      onEvent: (event, attrs) => usersLogger.info(event, "user-directory event", attrs),
    });
    const userRoot = ensured.userRoot;
    if (mayWriteUsers) {
      // UA-3w — roots migrated before the marker existed still deserve the
      // welcome-back wording. Awaited (it is one lock round-trip on a path that
      // just took several) but never fatal — it swallows its own failures.
      await backfillMigratedSetupVariant(ensured.rootReal, ensured.user.userId, {
        onEvent: (event, message, attrs) => usersLogger.info(event, message, attrs),
      });
    }
    if (ensured.migrated || ensured.created) {
      usersLogger.info(
        ensured.migrated ? "desktop.users.migrated" : "desktop.users.minted",
        ensured.migrated
          ? "The flat-v1 tree moved under users/<fuid>"
          : "A fresh user was minted for this machine",
        { userId: ensured.user.userId, fuid: ensured.user.fuid },
      );
    }
    crashArtifacts = new CrashArtifactManager({
      dataRoot: userRoot,
      crashDumpsRoot: isSmokeLike(MODE) ? join(root, "crashes") : app.getPath("crashDumps"),
      bootId: DESKTOP_BOOT_ID,
      appVersion: app.getVersion(),
      logger: logging.logger.child({ component: "crash.artifacts" }),
    });
    const evidenceLogging = logging;
    supportBundles = new SupportBundleService({
      dataRoot: userRoot,
      logRoot,
      crashArtifacts,
      logger: logging.logger.child({ component: "support.bundle" }),
      aliases: {
        home: homedir(),
        temp: tmpdir(),
        logs: logRoot,
        data: root,
      },
      versions: {
        vibeField: app.getVersion(),
        pluginHostBuild: app.getVersion(),
        fielddBuild: app.getVersion(),
        fieldNativeBuild: app.getVersion(),
        electron: process.versions.electron ?? "unknown",
        node: process.versions.node,
        rustToolchain: "not-reported",
        contracts: CONTRACTS_VERSION,
        os: `${process.platform}-${release()}`,
        arch: process.arch,
      },
      collectContext: async () => {
        let fieldd: unknown = { state: "unavailable" };
        try {
          const handle = await ensureFieldd();
          fieldd = await handle.client.request("system.health");
        } catch {
          fieldd = { state: "unavailable" };
        }
        return {
          electronLogging: [
            evidenceLogging.desktop.health(),
            evidenceLogging.renderer.health(),
            evidenceLogging.utility.health(),
            evidenceLogging.pluginRenderer.health(),
          ],
          fieldd,
        };
      },
    });
    const logger = logging.logger;
    logger.info("desktop.lifecycle.boot_started", "Electron shell boot started", {
      mode: MODE,
      electronVersion: process.versions.electron ?? "unknown",
    });
    if (!isSmokeLike(MODE)) {
      logger.info("desktop.lifecycle.instance_lock_acquired", "Primary app instance lock acquired");
    }
    const flow = installLifecycle({
      registry,
      getSupervisor,
      openPrimaryWindow: async () => {
        await revealPrimaryWindow();
      },
      keepAliveWithoutWindows: () =>
        process.platform === "darwin" || (trayController?.keepsAliveWithoutWindows() ?? false),
      onQuitRequested: () => {
        registry.beginShutdown();
        trayController?.update({ quitting: true });
      },
      disposeShell: disposeShellState,
      logger,
      closeLogging: closeEvidence,
    });
    if (MODE === "dev") {
      installDevSignalQuit(process, () => app.quit());
    }
    try {
      await main(userRoot, logRoot, logging, localDiagnostics, crashArtifacts, supportBundles, {
        userId: ensured.user.userId,
        name: ensured.user.name,
        rootReal: ensured.rootReal,
      });
    } catch (error) {
      flow.fatal(error);
    }
  })().catch(async () => {
    // Static emergency only: this path means the desktop writer itself could
    // not initialize, so it must never recurse through logging or echo errors.
    process.stderr.write("VibeField shell failed before logging initialized\n");
    await closeEvidence();
    app.exit(1);
  });
}
