import { screenshotStillBasename, screenshotStillUrl } from "@vibefield/contracts";
import {
  type AppearanceOverrideSource,
  mountFieldApp,
  type ProductPresentationContextReporter,
} from "@vibefield/field-app";
import {
  type LiveSurfaceWindowMessageTarget,
  receiveLiveSurfaceRendererTransport,
} from "@vibefield/live-surfaces/renderer";
import { createRendererLoggingClient } from "./renderer-logger";

/** The shared Electron product adapter behind production and Studio entries. */
export function mountProductHost(
  opts: {
    appearanceOverrideSource?: AppearanceOverrideSource;
    disposeAppearanceOverride?: () => void;
    onPresentationContextChange?: ProductPresentationContextReporter;
  } = {},
): void {
  if (__VIBEFIELD_TERMINAL_PERF_LAB__) {
    void import("@vibefield/field-app/terminal-perf-lab").then((lab) => {
      lab.installTerminalPerfLab();
    });
  }
  // MV-0 — the Godview perf lab's bridges, only when the URL main built asks
  // (`godviewPerf=1`, set by `loadRenderer` for `--godview-perf-lab`); the
  // module is not even imported otherwise.
  if (new URLSearchParams(location.search).get("godviewPerf") === "1") {
    void import("@vibefield/field-app/godview-perf-lab").then((lab) => {
      lab.installGodviewPerfLab();
    });
  }

  const root = document.getElementById("root");
  if (root === null) throw new Error("renderer host: #root missing from product document");

  const liveSurfaceBridgeNonce = window.vibefield.claimLiveSurfacePortBridge();
  const liveSurfaceReceiver = receiveLiveSurfaceRendererTransport<VideoFrame>(
    window as unknown as LiveSurfaceWindowMessageTarget,
    liveSurfaceBridgeNonce,
  );
  let liveSurfaceTransport: Awaited<typeof liveSurfaceReceiver.transport> | null = null;
  let pageHidden = false;
  void liveSurfaceReceiver.transport.then((transport) => {
    if (pageHidden) transport.dispose();
    else liveSurfaceTransport = transport;
  });

  const logging = createRendererLoggingClient({
    send: (serializedBatch) => window.vibefield.submitRendererLogs(serializedBatch),
  });
  window.addEventListener(
    "pagehide",
    () => {
      pageHidden = true;
      liveSurfaceReceiver.dispose();
      liveSurfaceTransport?.dispose();
      liveSurfaceTransport = null;
      opts.disposeAppearanceOverride?.();
      logging.close();
    },
    { once: true },
  );

  mountFieldApp({
    container: root,
    ...(opts.appearanceOverrideSource === undefined
      ? {}
      : { appearanceOverrideSource: opts.appearanceOverrideSource }),
    ...(opts.onPresentationContextChange === undefined
      ? {}
      : { onPresentationContextChange: opts.onPresentationContextChange }),
    host: {
      forceOnboarding: __VIBEFIELD_FORCE_ONBOARDING__,
      platform: window.vibefield.platform,
      logger: logging.logger,
      diagnostics: {
        query: (query) => window.vibefield.diagnostics.query(query),
        subscribe: async (query, onEvent) => {
          const subscription = await window.vibefield.diagnostics.subscribe(query, onEvent);
          return {
            snapshot: subscription.snapshot,
            dispose: async () => {
              await window.vibefield.diagnostics.unsubscribe(subscription.subId);
            },
          };
        },
        createLease: (request) => window.vibefield.diagnostics.createLease(request),
        listLeases: () => window.vibefield.diagnostics.listLeases(),
        revokeLease: (request) => window.vibefield.diagnostics.revokeLease(request),
        openLogs: () => window.vibefield.diagnostics.openLogs(),
        listCrashes: () => window.vibefield.diagnostics.listCrashes(),
        markCrashViewed: (request) => window.vibefield.diagnostics.markCrashViewed(request),
        previewSupport: (selection) => window.vibefield.diagnostics.previewSupport(selection),
        exportSupport: (request) => window.vibefield.diagnostics.exportSupport(request),
        copyText: (text) => window.vibefield.diagnostics.copyText(text),
      },
      // WP12d (L3c-i) — the desktop updater's doors, straight onto the preload's narrow set
      updates: {
        check: () => window.vibefield.update.check(),
        setEnabled: (enabled) => window.vibefield.update.setEnabled(enabled),
        setChannel: (channel) => window.vibefield.update.setChannel(channel),
        decline: (version) => window.vibefield.update.decline(version),
        prepareRestart: () => window.vibefield.update.prepareRestart(),
        confirmRestart: (token) => window.vibefield.update.confirmRestart(token),
        doctor: () => window.vibefield.update.doctor(),
      },
      getConnection: async () => {
        const connection = await window.vibefield.getConnection();
        const { terminal, ...required } = connection;
        return terminal === undefined ? required : { ...required, terminal };
      },
      usersUpdate: (params) => window.vibefield.usersUpdate(params),
      usersList: () => window.vibefield.usersList(),
      usersCreate: (params) => window.vibefield.usersCreate(params),
      usersSwitch: (params) => window.vibefield.usersSwitch(params),
      replaceRenderer: (reason) => window.vibefield.replaceRenderer(reason),
      screenshotCapture: () => window.vibefield.screenshot.capture(),
      onScreenshotResult: (handler) => window.vibefield.screenshot.onResult(handler),
      screenshotStillUrl: (path) => screenshotStillUrl(path),
      screenshotPreview: (path) =>
        window.vibefield.screenshot.preview(screenshotStillBasename(path)),
      screenshotStillBytes: (path) =>
        window.vibefield.screenshot.stillBytes(screenshotStillBasename(path)),
      screenshotStillKept: (path) =>
        window.vibefield.screenshot.stillKept(screenshotStillBasename(path)),
      onPrepareClose: (handler) => window.vibefield.onPrepareClose(handler),
      completeClose: (result) => window.vibefield.completeClose(result),
      onShellCommand: (handler) => window.vibefield.onShellCommand(handler),
      onDesktopState: (handler) => window.vibefield.onDesktopState(handler),
      view: {
        set: (view) => window.vibefield.view.set(view),
        onState: (handler) => window.vibefield.view.onState(handler),
        onZoom: (handler) => window.vibefield.view.onZoom(handler),
      },
      theme: {
        set: (preference) => window.vibefield.theme.set(preference),
        onState: (handler) => window.vibefield.theme.onState(handler),
      },
      deck: {
        set: (deck) => window.vibefield.deck.set(deck),
      },
      // BP-D4 — Settings' Clear browsing data, straight onto the preload's one door
      browserData: {
        clear: () => window.vibefield.browserData.clear(),
      },
      // Item 102 — a terminal's paste reads through main's door; the web's read is denied here
      clipboard: {
        readText: () => window.vibefield.clipboard.readText(),
      },
      // DT-2a: the claimed transport reaches the product instead of only being
      // parked here. The promise is handed over as-is — the pool behind the seam
      // awaits it — while the LIFETIME stays this adapter's: pagehide above
      // still disposes the receiver and the transport, in that order, because
      // the window generation that claimed the ports is what ends.
      liveSurfaces: { transport: liveSurfaceReceiver.transport },
    },
  });
}
