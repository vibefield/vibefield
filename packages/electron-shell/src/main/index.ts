import { randomBytes } from "node:crypto";
import { homedir, release, tmpdir } from "node:os";
import { join } from "node:path";
import {
  APP_PREFERENCE_KEYS,
  AppPreferences,
  CONTRACTS_VERSION,
  DESKTOP_APP_ID,
  IPC_CHANNELS,
  type ShellCommand,
  ShellCommandRequest,
} from "@vibefield/contracts";
import { SupportBundleExportV1 } from "@vibefield/contracts/diagnostics";
import type { FielddSupervisor } from "@vibefield/fieldd-supervisor";
import { resolvePlatformLogRoot } from "@vibefield/logging";
import { app, clipboard, crashReporter, dialog, session, shell } from "electron";
import { installAppProtocol, registerAppScheme } from "./app-protocol";
import { runAuditedSupportExport } from "./audited-support-export";
import { installDurableClose } from "./close";
import { CrashArtifactManager, startLocalCrashReporter } from "./crash-artifacts";
import { installDevSignalQuit } from "./dev-signals";
import { installLocalDiagnosticsPort } from "./diagnostics-port";
import { buildSupervisor, dataRoot } from "./fieldd";
import { registerWindowBootstrap } from "./ipc";
import { installLifecycle } from "./lifecycle";
import { ElectronLocalDiagnostics } from "./local-diagnostics";
import { createElectronLogging, type ElectronLogging } from "./logging";
import { isSmokeLike, parseMode } from "./modes";
import { RendererPluginProvenanceCatalog } from "./plugin-provenance";
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
import { SupportBundleError, SupportBundleService } from "./support-bundle";
import { TrayController } from "./tray-controller";
import type { TrayEvidenceState, TrayLinkState } from "./tray-model";
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
let logging: ElectronLogging | null = null;
let localDiagnostics: ElectronLocalDiagnostics | null = null;
let crashArtifacts: CrashArtifactManager | null = null;
let supportBundles: SupportBundleService | null = null;
let trayController: TrayController | null = null;
let primaryWindowOpener: (() => Promise<Electron.BrowserWindow>) | null = null;
const shellDisposers = new Set<() => void>();
const getSupervisor = () => supervisor;
const registry = new WindowRegistry();

async function revealPrimaryWindow(): Promise<Electron.BrowserWindow> {
  if (primaryWindowOpener === null) {
    throw new Error("the primary window operation is not ready");
  }
  return primaryWindowOpener();
}

function disposeShellState(): void {
  trayController?.dispose();
  trayController = null;
  primaryWindowOpener = null;
  for (const dispose of shellDisposers) dispose();
  shellDisposers.clear();
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
  let evidenceState: TrayEvidenceState = [
    shellLogging.desktop,
    shellLogging.renderer,
    shellLogging.utility,
    shellLogging.pluginRenderer,
  ].some((stream) => stream.health().writerState !== "healthy")
    ? "degraded"
    : "healthy";
  const appendShellAudit = async (record: Record<string, unknown>): Promise<void> => {
    const handle = await getSupervisor()?.ensure();
    if (handle === undefined) {
      throw Object.assign(new Error("fieldd audit service is unavailable"), {
        kind: "AUDIT_UNAVAILABLE",
      });
    }
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
    evidenceState = "degraded";
    logger.error(
      "desktop.crash.manifest_unavailable",
      "Electron crash artifacts are unavailable",
      error,
    );
  }
  try {
    await support.initialize();
  } catch (error) {
    evidenceState = "degraded";
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
  installWebContentsBackstop(MODE, (contents) => {
    if (registry.owns(contents)) return;
    logger.warn(
      "desktop.security.unregistered_webcontents",
      "A WebContents was created outside the window factory and received the backstop policy",
      { webContentsId: contents.id, type: contents.getType() },
    );
  });
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
  supervisor = buildSupervisor({
    mode: MODE,
    root,
    resources,
    viteUrl: VITE_URL,
    logRoot,
    logger,
  });
  // ensure() starts NOW; the window never waits for it (ESR-8 / design-03
  // §4.3 v0.3 — the splash is the honest face while the daemon comes up).
  const fielddReady = supervisor.ensure();
  const pluginProvenance = new RendererPluginProvenanceCatalog();
  let observedLink: TrayLinkState = "starting";
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
  let stopPluginObservation: (() => void) | null = null;
  let stopFielddStatusObservation: (() => void) | null = null;
  let pluginObservationClosed = false;
  app.once("will-quit", () => {
    pluginObservationClosed = true;
    stopFielddStatusObservation?.();
    stopFielddStatusObservation = null;
    stopPluginObservation?.();
    stopPluginObservation = null;
  });
  fielddReady.then(
    (handle) => {
      if (pluginObservationClosed) return;
      publishLink(handle.client.status);
      stopFielddStatusObservation = handle.client.onStatusChange(() => {
        if (handle.client.status !== "ready") pluginProvenance.invalidate();
        publishLink(handle.client.status);
        logger.info("desktop.fieldd.link_state_changed", "fieldd link state changed", {
          status: handle.client.status,
        });
      });
      void pluginProvenance
        .observe(handle.client)
        .then((stop) => {
          if (pluginObservationClosed) {
            stop();
            return;
          }
          stopPluginObservation?.();
          stopPluginObservation = stop;
        })
        .catch((error) => {
          logger.error(
            "desktop.plugins.log_provenance_unavailable",
            "Plugin log provenance could not follow the fieldd registry",
            error,
          );
        });
    },
    (error) => {
      publishLink("failed");
      logger.error(
        "desktop.fieldd.ensure_failed",
        "The initial fieldd adoption/spawn attempt failed",
        error,
      );
      // observed: the renderer's bootstrap invoke surfaces the failure with an
      // honest retry (each invoke re-runs ensure); nothing to crash here
    },
  );

  if (MODE === "smoke") {
    await (await testing()).runSmoke(await fielddReady, supervisor, root, closeEvidence);
    return;
  }

  registerWindowBootstrap(registry, supervisor, logger.child({ component: "ipc.bootstrap" }));

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
          installNavigationPolicy(window, MODE);
          installDurableClose(
            window,
            logger.child({ component: "window.close", windowId: String(window.id) }),
          );
          await loadRenderer(window, MODE, VITE_URL);
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
    const handle = await supervisor?.ensure();
    if (handle === undefined) throw new Error("fieldd app-preference service is unavailable");
    await handle.client.request("storage.appPreferences.set", { key, value });
  };

  trayController = new TrayController({
    runtime: createElectronTrayRuntime(resources),
    initial: {
      link: observedLink,
      evidence: evidenceState,
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
  });
  let primaryHasOpened = registry.primary() !== null;
  const enforceBackgroundEscapeHatch = (): void => {
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

  let preferenceObservationClosed = false;
  let stopPreferenceObservation: (() => void) | null = null;
  const disposePreferenceObservation = (): void => {
    preferenceObservationClosed = true;
    stopPreferenceObservation?.();
    stopPreferenceObservation = null;
  };
  shellDisposers.add(disposePreferenceObservation);
  const applyPreferences = (raw: unknown): void => {
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
  void fielddReady
    .then((handle) =>
      handle.client.subscribe("storage.appPreferences.subscribe", {}, (payload) => {
        if (!preferenceObservationClosed) applyPreferences(payload);
      }),
    )
    .then((subscription) => {
      if (preferenceObservationClosed) {
        subscription.unsubscribe();
        return;
      }
      applyPreferences(subscription.snapshot);
      stopPreferenceObservation = subscription.unsubscribe;
    })
    .catch((error) => {
      if (preferenceObservationClosed) return;
      logger.error(
        "desktop.tray.preferences_unavailable",
        "Desktop behavior preferences could not be observed",
        error,
      );
    });

  let healthObservationClosed = false;
  let stopHealthObservation: (() => void) | null = null;
  const disposeHealthObservation = (): void => {
    healthObservationClosed = true;
    stopHealthObservation?.();
    stopHealthObservation = null;
  };
  shellDisposers.add(disposeHealthObservation);
  const localEvidenceDegraded = evidenceState === "degraded";
  const applyEvidenceHealth = (raw: unknown): void => {
    const health =
      typeof raw === "object" && raw !== null
        ? (raw as {
            audit?: { state?: unknown };
            logging?: { writerState?: unknown } | null;
          })
        : {};
    const auditDegraded = health.audit?.state !== "healthy";
    const fielddLoggingDegraded = health.logging?.writerState !== "healthy";
    evidenceState =
      localEvidenceDegraded || auditDegraded || fielddLoggingDegraded ? "degraded" : "healthy";
    trayController?.update({ evidence: evidenceState });
  };
  void fielddReady
    .then((handle) =>
      handle.client.subscribe("system.health.subscribe", {}, (payload) => {
        if (!healthObservationClosed) applyEvidenceHealth(payload);
      }),
    )
    .then((subscription) => {
      if (healthObservationClosed) {
        subscription.unsubscribe();
        return;
      }
      applyEvidenceHealth(subscription.snapshot);
      stopHealthObservation = subscription.unsubscribe;
    })
    .catch((error) => {
      if (healthObservationClosed) return;
      logger.error(
        "desktop.tray.evidence_health_unavailable",
        "The tray could not observe diagnostic evidence health",
        error,
      );
    });

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
          const handle = await supervisor?.ensure();
          if (handle !== undefined) fieldd = await handle.client.request("system.health");
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
      onQuitRequested: () => trayController?.update({ quitting: true }),
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
