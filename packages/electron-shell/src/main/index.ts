import { randomBytes } from "node:crypto";
import { homedir, release, tmpdir } from "node:os";
import { join } from "node:path";
import { GhostteaElectronBackend } from "@vibecook/ghosttea-electron/main";
import {
  APP_PREFERENCE_KEYS,
  AppPreferences,
  CONTRACTS_VERSION,
  DESKTOP_APP_ID,
  type DesktopShellState,
  DesktopShellState as DesktopShellStateSchema,
  IPC_CHANNELS,
  type ShellCommand,
  ShellCommandRequest,
} from "@vibefield/contracts";
import { SupportBundleExportV1 } from "@vibefield/contracts/diagnostics";
import type { FielddSupervisor } from "@vibefield/fieldd-supervisor";
import { resolvePlatformLogRoot } from "@vibefield/logging";
import {
  app,
  BrowserWindow,
  clipboard,
  crashReporter,
  dialog,
  nativeImage,
  session,
  shell,
} from "electron";
import { applyDevelopmentDockIcon } from "./app-branding";
import { installAppMenu } from "./app-menu";
import { installAppProtocol, registerAppScheme } from "./app-protocol";
import { ArtifactPreviewCapture, isArtifactPreviewSession } from "./artifact-preview-capture";
import { runAuditedSupportExport } from "./audited-support-export";
import { installDurableClose } from "./close";
import { CrashArtifactManager, startLocalCrashReporter } from "./crash-artifacts";
import { installDevSignalQuit } from "./dev-signals";
import { installLocalDiagnosticsPort } from "./diagnostics-port";
import { buildSupervisor, dataRoot } from "./fieldd";
import { FielddHandleCoordinator } from "./fieldd-handle-coordinator";
import { GodviewRegistry, installGodviewChord } from "./godview";
import { registerGodviewToggle, registerTerminalBackend, registerWindowBootstrap } from "./ipc";
import { installLifecycle } from "./lifecycle";
import { ElectronLocalDiagnostics } from "./local-diagnostics";
import { createElectronLogging, type ElectronLogging } from "./logging";
import { isSmokeLike, parseMode } from "./modes";
import { RendererPluginProvenanceCatalog } from "./plugin-provenance";
import { RecoveringFielddObservers } from "./recovering-fieldd-observers";
import { installRendererLogging } from "./renderer-logging";
import {
  assertPackagedResources,
  resolveDevelopmentRepoRoot,
  resolveDevelopmentResources,
  resolvePackagedResources,
} from "./resources";
import {
  installCsp,
  installNavigationPolicy,
  installPermissionPolicy,
  installWebContentsBackstop,
} from "./security";
import { buildCsp } from "./security-policy";
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
const VITE_URL = process.env["VITE_DEV_SERVER_URL"] ?? "http://localhost:5173";
const PRELOAD_PATH = join(__dirname, "..", "preload", "index.cjs");
const DESKTOP_BOOT_ID = `desktop-${randomBytes(8).toString("hex")}`;

let supervisor: FielddSupervisor | null = null;
let fielddHandles: FielddHandleCoordinator | null = null;
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
  fielddHandles?.dispose();
  fielddHandles = null;
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
  installCsp(MODE);
  // The renderer's own origin. Dev serves from Vite instead, so the handler is
  // pointless there; every other mode loads vibefield-app://shell and would show
  // a blank window without it. Root is the built renderer beside dist/main.
  const appCsp = buildCsp(MODE);
  if (MODE !== "dev") {
    installAppProtocol({
      root: join(__dirname, "..", "renderer"),
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
    (contents) => isArtifactPreviewSession(contents.session),
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

  if (MODE === "spike-loro") {
    await (await testing()).runSpikeLoro({
      root,
      beforeExit: closeEvidence,
    });
    return;
  }

  // §4.3 — two explicit constructors, chosen by app.isPackaged, never a single
  // "find it somehow" path. app.getAppPath()/../.. is a SOURCE-CHECKOUT
  // assumption (a packaged app.asar is not a repo), so it stays on the
  // development branch where it is true.
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
  supervisor = buildSupervisor({
    mode: MODE,
    root,
    resources,
    viteUrl: VITE_URL,
    logRoot,
    logger,
  });
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

  fielddHandles = new FielddHandleCoordinator(
    (options) => supervisor!.ensure(options),
    (error) => {
      publishLink("failed");
      pluginProvenance.invalidate();
      healthObservationUnavailable = true;
      evidenceMonitor?.markRemoteUnavailable();
      logger.error("desktop.fieldd.ensure_failed", "A fieldd adoption/spawn attempt failed", error);
    },
    (error) => {
      logger.error(
        "desktop.fieldd.observer_bind_failed",
        "A main-process fieldd observer could not bind",
        error,
      );
    },
  );
  const fielddObservers = new RecoveringFielddObservers(fielddHandles, {
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
  shellDisposers.add(() => fielddObservers.dispose());
  const artifactPreviewCapture = new ArtifactPreviewCapture({
    dataDir: root,
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
  const shellProvider = new RecoveringShellProvider(
    fielddHandles,
    {
      parentWindow: () => BrowserWindow.getFocusedWindow() ?? registry.primary(),
      showOpenDialog: (parent, options) => dialog.showOpenDialog(parent, options),
      openExternal: (url) => shell.openExternal(url),
      captureArtifactPreview: (params, signal) => artifactPreviewCapture.capture(params, signal),
    },
    logger.child({ component: "shell.provider" }),
  );
  shellDisposers.add(() => shellProvider.dispose());

  // ensure() starts NOW; the window never waits for it (ESR-8 / design-03
  // §4.3 v0.3 — the splash is the honest face while the daemon comes up).
  // Every later retry uses the same coordinator, so recovery rebinds main too.
  const fielddReady = fielddHandles.ensure();
  void fielddReady.catch(() => undefined);

  if (MODE === "smoke") {
    await (await testing()).runSmoke(await fielddReady, supervisor, root, closeEvidence);
    return;
  }

  registerWindowBootstrap(
    registry,
    (options) => fielddHandles!.ensure(options),
    logger.child({ component: "ipc.bootstrap" }),
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

  if (MODE === "smoke-godview") {
    await (await testing()).runSmokeGodview({
      handle: await fielddReady,
      supervisor,
      root,
      registry,
      preloadPath: PRELOAD_PATH,
      viteUrl: VITE_URL,
      // The accelerator's own action, handed over rather than re-implemented:
      // the harness must exercise the path ⌘⎋ takes, not a parallel one.
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

  // The application menu exists only where there is a menu bar to hold it —
  // the harness modes present no UI and would only be installing accelerators
  // for nobody. Assigning `redrawMenu` here is what makes the checkmark and the
  // conditional ⌘W follow the overlay from this point on.
  redrawMenu = installAppMenu(process.platform === "darwin" ? "darwin" : "other", {
    toggleGodview,
  });

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
          // ⌘⎋'s live binding on darwin — the View item's accelerator is only
          // the label there (see installGodviewChord). Installed per window and
          // dies with its webContents, so it cannot outlive what it toggles.
          installGodviewChord(window.webContents, toggleGodview);
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
registerAppScheme();
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
    crashArtifacts = new CrashArtifactManager({
      dataRoot: root,
      crashDumpsRoot: isSmokeLike(MODE) ? join(root, "crashes") : app.getPath("crashDumps"),
      bootId: DESKTOP_BOOT_ID,
      appVersion: app.getVersion(),
      logger: logging.logger.child({ component: "crash.artifacts" }),
    });
    const evidenceLogging = logging;
    supportBundles = new SupportBundleService({
      dataRoot: root,
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
      await main(root, logRoot, logging, localDiagnostics, crashArtifacts, supportBundles);
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
