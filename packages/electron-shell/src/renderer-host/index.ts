import { mountFieldApp } from "@vibefield/field-app";
import {
  type LiveSurfaceWindowMessageTarget,
  receiveLiveSurfaceRendererTransport,
} from "@vibefield/live-surfaces/renderer";
import { createRendererLoggingClient } from "./renderer-logger";

// The one Electron-specific renderer adapter (ESR §5.2.5): read the preload
// global, adapt it to FieldHost, mount. It knows nothing about ICE, documents,
// plugins, or HUD — the field app is a black box behind its public entry.

// TP-S0c — the perf lab's renderer bridge, and the ONLY lines of this file that
// are not production. The flag is a vite `define` (the same mechanism
// `__VIBEFIELD_FORCE_ONBOARDING__` already uses), so outside the lab build this
// reads `if (false)` and rollup drops both the branch and the chunk it names;
// `verify-production-renderer.mjs` asserts the module's marker is absent from
// `dist/renderer`, which makes the exclusion a gate rather than a comment.
if (__VIBEFIELD_TERMINAL_PERF_LAB__) {
  void import("@vibefield/field-app/terminal-perf-lab").then((lab) => {
    lab.installTerminalPerfLab();
  });
}

const root = document.getElementById("root");
if (root === null) throw new Error("renderer host: #root missing from index.html");

// Installed before product/plugin activation. The capability ports stay in
// this adapter's closure; field-app and plugins receive no generic port/global.
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
    logging.close();
  },
  { once: true },
);

mountFieldApp({
  container: root,
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
    getConnection: () => window.vibefield.getConnection(),
    // UA-3 — the Account page's profile door (host.ts declares it optional;
    // this adapter is the one place the preload global becomes FieldHost)
    usersUpdate: (params) => window.vibefield.usersUpdate(params),
    // UA-5 — the rest of the same door: read the roster, mint, re-target. The
    // last two reload this window, so the app treats them as fire-and-forget
    // (host.ts states the rule).
    usersList: () => window.vibefield.usersList(),
    usersCreate: (params) => window.vibefield.usersCreate(params),
    usersSwitch: (params) => window.vibefield.usersSwitch(params),
    onPrepareClose: (handler) => window.vibefield.onPrepareClose(handler),
    completeClose: (result) => window.vibefield.completeClose(result),
    onShellCommand: (handler) => window.vibefield.onShellCommand(handler),
    onDesktopState: (handler) => window.vibefield.onDesktopState(handler),
    terminal: {
      connect: (ticket) => window.vibefield.terminal.connect(ticket),
      onStatus: (handler) => window.vibefield.terminal.onStatus(handler),
    },
    godview: {
      set: (open) => window.vibefield.godview.set(open),
      onState: (handler) => window.vibefield.godview.onState(handler),
    },
  },
});
