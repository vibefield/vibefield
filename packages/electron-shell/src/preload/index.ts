import {
  CloseRequest,
  CloseResult,
  type DesktopShellState,
  type FrameView,
  FrameViewSetRequest,
  type FrameViewState,
  FrameViewState as FrameViewStateSchema,
  type FrameZoomAct,
  GodviewDeckSetRequest,
  type GodviewDeckState,
  IPC_CHANNELS,
  LIVE_SURFACE_PORT_BRIDGE_MESSAGE_V1,
  type RendererReplaceReason,
  RendererReplaceRequest,
  type RendererReplaceResult,
  RendererReplaceResult as RendererReplaceResultSchema,
  ScreenshotCaptureRequest,
  type ScreenshotCaptureResult,
  ScreenshotCaptureResult as ScreenshotCaptureResultSchema,
  ScreenshotPreviewRequest,
  ScreenshotPreviewResult,
  type ShellCommand,
  ShellPlatform,
  type ThemePreference,
  ThemeSetRequest,
  type ThemeState,
  ThemeState as ThemeStateSchema,
  type UpdateChannel,
  UpdateConfirmRequest,
  UpdateConfirmResult,
  UpdateDeclineRequest,
  UpdateDoctorResult,
  UpdatePrepareResult,
  UpdateSetChannelRequest,
  UpdateSetEnabledRequest,
  type UserRecord,
  UserRecord as UserRecordSchema,
  UsersCreateParams,
  UsersListSnapshot,
  UsersSwitchParams,
  UsersUpdateParams,
  WindowConnection,
  type WindowLightsState,
  WindowLightsState as WindowLightsStateSchema,
} from "@vibefield/contracts";
import { contextBridge, ipcRenderer, sharedTexture } from "electron";
import { PreloadDesktopStateBridge } from "./desktop-state";
import { type DiagnosticsRendererPort, PreloadDiagnosticsBridge } from "./diagnostics";
import {
  PreloadLiveSurfaceFrameMux,
  type PreloadLiveSurfacePort,
  type PreloadReceivedSharedTexture,
} from "./live-surfaces";
import { PreloadLogBridge, type RendererLogPort } from "./logging";
import { PreloadScreenshotResultBridge } from "./screenshot-result";
import { PreloadShellCommandBridge } from "./shell-commands";
import { PreloadThemeStateBridge } from "./theme";
import { PreloadViewStateBridge, PreloadZoomActBridge } from "./view";

// The bridge (ESR §5.2.5): contextBridge adaptation + validation, nothing else.
// Product traffic flows over the loopback WS (D27), never over IPC. BOTH
// directions validate against the contract schemas — a malformed main→renderer
// payload never reaches a handler, and a malformed renderer→main payload
// throws at its call site instead of crossing the boundary. No ipcRenderer,
// channel string, or Electron object escapes into the page.

const logging = new PreloadLogBridge();
const isolatedWindow = globalThis as unknown as {
  readonly location: { readonly origin: string };
  postMessage(message: unknown, targetOrigin: string, transfer: readonly object[]): void;
};
const bridgeNonceBytes = new Uint8Array(32);
(
  globalThis as unknown as {
    crypto: { getRandomValues<T extends ArrayBufferView>(array: T): T };
  }
).crypto.getRandomValues(bridgeNonceBytes);
const liveSurfaceBridgeNonce = [...bridgeNonceBytes]
  .map((byte) => byte.toString(16).padStart(2, "0"))
  .join("");
let liveSurfaceBridgeClaimed = false;
const claimLiveSurfacePortBridge = (): string => {
  if (liveSurfaceBridgeClaimed) throw new Error("Live Surfaces port bridge was already claimed");
  liveSurfaceBridgeClaimed = true;
  return liveSurfaceBridgeNonce;
};
const liveSurfaceFrames = new PreloadLiveSurfaceFrameMux({
  forwardPorts: (bootstrap, controlPort, framePort) => {
    if (!liveSurfaceBridgeClaimed) {
      throw new Error("Live Surfaces port bridge was not claimed by the renderer host");
    }
    isolatedWindow.postMessage(
      { type: LIVE_SURFACE_PORT_BRIDGE_MESSAGE_V1, bootstrap, bridgeNonce: liveSurfaceBridgeNonce },
      isolatedWindow.location.origin,
      [controlPort, framePort],
    );
  },
  onRejected: (reason) => {
    logging.submit(
      JSON.stringify({
        v: 1,
        records: [
          {
            v: 1,
            time: Date.now(),
            level: "error",
            event: "renderer.preload.live_surface_frame_rejected",
            msg: "Preload rejected a Live Surface frame or port handoff",
            component: "preload.live-surfaces",
            attrs: { reason },
          },
        ],
      }),
    );
  },
});
const diagnostics = new PreloadDiagnosticsBridge();
const desktopState = new PreloadDesktopStateBridge((issueCount) => {
  logging.submit(
    JSON.stringify({
      v: 1,
      records: [
        {
          v: 1,
          time: Date.now(),
          level: "error",
          event: "renderer.preload.desktop_state_rejected",
          msg: "Preload rejected malformed desktop capability state",
          component: "preload.shell",
          attrs: { issueCount },
        },
      ],
    }),
  );
});
const shellCommands = new PreloadShellCommandBridge((issueCount) => {
  logging.submit(
    JSON.stringify({
      v: 1,
      records: [
        {
          v: 1,
          time: Date.now(),
          level: "error",
          event: "renderer.preload.shell_command_rejected",
          msg: "Preload rejected a malformed shell command",
          component: "preload.shell",
          attrs: { issueCount },
        },
      ],
    }),
  );
});
const screenshotResults = new PreloadScreenshotResultBridge((issueCount) => {
  logging.submit(
    JSON.stringify({
      v: 1,
      records: [
        {
          v: 1,
          time: Date.now(),
          level: "error",
          event: "renderer.preload.screenshot_result_rejected",
          msg: "Preload rejected a malformed screenshot result",
          component: "preload.screenshot",
          attrs: { issueCount },
        },
      ],
    }),
  );
});
const viewState = new PreloadViewStateBridge((issueCount) => {
  logging.submit(
    JSON.stringify({
      v: 1,
      records: [
        {
          v: 1,
          time: Date.now(),
          level: "error",
          event: "renderer.preload.view_state_rejected",
          msg: "Preload rejected a malformed view state",
          component: "preload.view",
          attrs: { issueCount },
        },
      ],
    }),
  );
});
const viewZoom = new PreloadZoomActBridge((issueCount) => {
  logging.submit(
    JSON.stringify({
      v: 1,
      records: [
        {
          v: 1,
          time: Date.now(),
          level: "error",
          event: "renderer.preload.view_zoom_rejected",
          msg: "Preload rejected a malformed zoom act",
          component: "preload.view",
          attrs: { issueCount },
        },
      ],
    }),
  );
});
const themeState = new PreloadThemeStateBridge((issueCount) => {
  logging.submit(
    JSON.stringify({
      v: 1,
      records: [
        {
          v: 1,
          time: Date.now(),
          level: "error",
          event: "renderer.preload.theme_state_rejected",
          msg: "Preload rejected a malformed theme state",
          component: "preload.theme",
          attrs: { issueCount },
        },
      ],
    }),
  );
});
/** A rejected `ipcMain.handle` reaches the page as `Error invoking remote method
 * '<channel>': Error: <message>`: main replies with the error's `toString()` and
 * `invoke` rewraps it (Electron #24427, verified in 43.1.1's own bundle). A users
 * refusal is a SENTENCE the page shows as written, e.g. "Work already wears 🐙 on
 * this machine." (UA-7), so the bridge hands back the handler's own words —
 * whichever Error class threw them: a `UsersError` from the §3.3 lock ("another
 * VibeField process is using this data folder…") is a sentence too. Every
 * users verb goes through it. */
const REMOTE_ERROR_PREFIX = /^Error invoking remote method '[^']*': (?:[A-Za-z]*Error: )?/u;

async function invokeInHandlerWords(channel: string, payload: unknown): Promise<unknown> {
  try {
    return await ipcRenderer.invoke(channel, payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(message.replace(REMOTE_ERROR_PREFIX, ""));
  }
}

const platform = ShellPlatform.parse(
  process.platform === "darwin" || process.platform === "win32" || process.platform === "linux"
    ? process.platform
    : "other",
);
ipcRenderer.on(IPC_CHANNELS.rendererLogPort, (event) => {
  const port = event.ports[0] as RendererLogPort | undefined;
  if (port !== undefined) logging.attach(port);
});
ipcRenderer.on(IPC_CHANNELS.diagnosticsPort, (event) => {
  const port = event.ports[0] as DiagnosticsRendererPort | undefined;
  if (port !== undefined) diagnostics.attach(port);
});
ipcRenderer.on(IPC_CHANNELS.liveSurfacePorts, (event, rawBootstrap: unknown) => {
  liveSurfaceFrames.bind(rawBootstrap, event.ports as unknown as readonly PreloadLiveSurfacePort[]);
});
sharedTexture.setSharedTextureReceiver(async (received, ...args) => {
  await liveSurfaceFrames.acceptSharedTexture(
    received as unknown as PreloadReceivedSharedTexture,
    args[0],
  );
});
ipcRenderer.on(IPC_CHANNELS.shellCommand, (_event, raw: unknown) => {
  shellCommands.accept(raw);
});
ipcRenderer.on(IPC_CHANNELS.screenshotResult, (_event, raw: unknown) => {
  screenshotResults.accept(raw);
});
ipcRenderer.on(IPC_CHANNELS.desktopState, (_event, raw: unknown) => {
  desktopState.accept(raw);
});
ipcRenderer.on(IPC_CHANNELS.viewState, (_event, raw: unknown) => {
  viewState.accept(raw);
});
ipcRenderer.on(IPC_CHANNELS.viewZoom, (_event, raw: unknown) => {
  viewZoom.accept(raw);
});
ipcRenderer.on(IPC_CHANNELS.themeState, (_event, raw: unknown) => {
  themeState.accept(raw);
});

contextBridge.exposeInMainWorld("vibefield", {
  platform,
  // One-shot same-world bridge authentication. renderer-host claims this
  // synchronously before mounting field-app; later plugin code can neither
  // recover the nonce nor forge the preload's transferred-port message.
  claimLiveSurfacePortBridge,
  submitRendererLogs: (serializedBatch: string): boolean => logging.submit(serializedBatch),
  getConnection: async (): Promise<WindowConnection> =>
    WindowConnection.parse(await ipcRenderer.invoke(IPC_CHANNELS.windowBootstrap)),
  /** UA-3 — the Account page's profile write (name/face/resident/onboarded).
   * Validated both directions; main owns users.json and refuses empty or
   * unregistered-sender updates. UA-7: a face main refuses (another user's, a
   * refused emoji, not one emoji) rejects with main's sentence, unwrapped. */
  usersUpdate: async (params: UsersUpdateParams): Promise<UserRecord> =>
    UserRecordSchema.parse(
      await invokeInHandlerWords(IPC_CHANNELS.usersUpdate, UsersUpdateParams.parse(params)),
    ),
  /** UA-5 — the roster read: every user on this machine plus main's LIVE
   * attachment (never `lastAttached`, which is only the next-boot hint). The
   * one read behind both the Account switcher and the tray submenu, so they
   * cannot disagree about who is current. */
  usersList: async (): Promise<UsersListSnapshot> =>
    UsersListSnapshot.parse(await invokeInHandlerWords(IPC_CHANNELS.usersList, {})),
  /** UA-5 — mint user N under the §3.3 lock, then ATTACH to it. Identity is not
   * decided here: the mint only needs to exist, and the reloaded window runs
   * the Setup Assistant's second-user variant (§6.2) to ask for a name.
   *
   * THE RELOAD RACE (shared with `usersSwitch`): attaching re-targets this
   * window and reloads it (UA-D15), which tears down the very context this
   * promise would resolve into. It may resolve, or it may never settle — both
   * are correct. Callers fire-and-forget: disable the control that was pressed,
   * and gate nothing else on the answer. The reload IS the feedback. */
  usersCreate: async (params: UsersCreateParams): Promise<UserRecord> =>
    UserRecordSchema.parse(
      await invokeInHandlerWords(IPC_CHANNELS.usersCreate, UsersCreateParams.parse(params)),
    ),
  /** UA-5 — re-target the attachment to an existing user and reload (UA-D15).
   * Switching to the user already attached is main's no-op, not this bridge's
   * business. Same reload race as `usersCreate` — see it for the rule. */
  usersSwitch: async (params: UsersSwitchParams): Promise<UserRecord> =>
    UserRecordSchema.parse(
      await invokeInHandlerWords(IPC_CHANNELS.usersSwitch, UsersSwitchParams.parse(params)),
    ),
  /** DK-9 — replace THIS window's renderer (a plugin's kinds changed in a way the
   * page's realm cannot take): main reloads the page, which reopens its own board.
   * The page saves its board BEFORE asking. Same reload race as `usersCreate`. */
  replaceRenderer: async (reason: RendererReplaceReason): Promise<RendererReplaceResult> =>
    RendererReplaceResultSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.rendererReplace,
        RendererReplaceRequest.parse({ reason }),
      ),
    ),
  onPrepareClose: (handler: (requestId: string) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, raw: unknown) => {
      const request = CloseRequest.safeParse(raw);
      if (!request.success) {
        logging.submit(
          JSON.stringify({
            v: 1,
            records: [
              {
                v: 1,
                time: Date.now(),
                level: "error",
                event: "renderer.preload.close_payload_rejected",
                msg: "Preload rejected a malformed prepare-close payload",
                component: "preload.close",
                attrs: { issueCount: request.error.issues.length },
              },
            ],
          }),
        );
        return;
      }
      handler(request.data.requestId);
    };
    ipcRenderer.on(IPC_CHANNELS.prepareClose, listener);
    return () => ipcRenderer.off(IPC_CHANNELS.prepareClose, listener);
  },
  completeClose: (result: { requestId: string; ok: boolean; error?: string }): void => {
    ipcRenderer.send(IPC_CHANNELS.closeResult, CloseResult.parse(result));
  },
  onShellCommand: (handler: (command: ShellCommand) => void): (() => void) =>
    shellCommands.subscribe(handler),
  onDesktopState: (handler: (state: DesktopShellState) => void): (() => void) =>
    desktopState.subscribe(handler),
  // TP-S3e: the `terminal` namespace (bridge connect + status) retired — the
  // renderer dials the cells' T1 doors itself; shell/home policy rides the
  // window bootstrap.
  view: {
    /** Ask for a view by name; main owns the window's view (FR-1) and the
     * answer is what it holds now — a refused view answers unchanged. */
    set: async (view: FrameView): Promise<FrameViewState> =>
      FrameViewStateSchema.parse(
        await ipcRenderer.invoke(IPC_CHANNELS.viewSet, FrameViewSetRequest.parse({ view })),
      ),
    onState: (handler: (state: FrameViewState) => void): (() => void) =>
      viewState.subscribe(handler),
    /** The View menu's Actual Size, Zoom In and Zoom Out (FR-4, 3b), as the
     * act main sends for the head to answer on Canvas. */
    onZoom: (handler: (act: FrameZoomAct) => void): (() => void) => viewZoom.subscribe(handler),
  },
  theme: {
    /** Choose the app's one theme by name (FR-4, FC-D5); main owns it and the
     * answer is what it holds now. */
    set: async (preference: ThemePreference): Promise<ThemeState> =>
      ThemeStateSchema.parse(
        await ipcRenderer.invoke(IPC_CHANNELS.themeSet, ThemeSetRequest.parse({ preference })),
      ),
    onState: (handler: (state: ThemeState) => void): (() => void) => themeState.subscribe(handler),
  },
  /** WP12d (L3c-i; §13 C1) — the desktop updater's host doors, the narrow set the Settings card needs: no path, no
   * URL, every payload parsed both ways (a malformed one throws here instead of crossing). Its state rides
   * `onDesktopState` (`update`). */
  update: {
    check: async (): Promise<void> => {
      await ipcRenderer.invoke(IPC_CHANNELS.updateCheck);
    },
    setEnabled: async (enabled: boolean): Promise<void> => {
      await ipcRenderer.invoke(
        IPC_CHANNELS.updateSetEnabled,
        UpdateSetEnabledRequest.parse({ enabled }),
      );
    },
    setChannel: async (channel: UpdateChannel): Promise<void> => {
      await ipcRenderer.invoke(
        IPC_CHANNELS.updateSetChannel,
        UpdateSetChannelRequest.parse({ channel }),
      );
    },
    decline: async (version: string): Promise<void> => {
      await ipcRenderer.invoke(IPC_CHANNELS.updateDecline, UpdateDeclineRequest.parse({ version }));
    },
    prepareRestart: async (): Promise<UpdatePrepareResult> =>
      UpdatePrepareResult.parse(await ipcRenderer.invoke(IPC_CHANNELS.updatePrepareRestart)),
    confirmRestart: async (token: string): Promise<UpdateConfirmResult> =>
      UpdateConfirmResult.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.updateConfirmRestart,
          UpdateConfirmRequest.parse({ token }),
        ),
      ),
    doctor: async (): Promise<UpdateDoctorResult> =>
      UpdateDoctorResult.parse(await ipcRenderer.invoke(IPC_CHANNELS.updateDoctor)),
  },
  deck: {
    /** Say Godview's deck state by name — or null for none — never a position
     * (Godview round 3, GV-D11). Main owns the window's lights and answers
     * with the word it now holds and where the lights stand for it. */
    set: async (deck: GodviewDeckState | null): Promise<WindowLightsState> =>
      WindowLightsStateSchema.parse(
        await ipcRenderer.invoke(IPC_CHANNELS.deckSet, GodviewDeckSetRequest.parse({ deck })),
      ),
  },
  /** SNAP-D3 — one native screenshot through main: the still's path on disk
   * (it is on the clipboard too), a cancel, or a typed error. Main serialises
   * captures — a second call while one is live answers `busy` — and the View
   * menu's item runs the same capture. Validated both ways, like every door. */
  screenshot: {
    preview: async (name: string): Promise<ScreenshotPreviewResult> =>
      ScreenshotPreviewResult.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.screenshotPreview,
          ScreenshotPreviewRequest.parse({ name }),
        ),
      ),
    capture: async (): Promise<ScreenshotCaptureResult> =>
      ScreenshotCaptureResultSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.screenshotCapture,
          ScreenshotCaptureRequest.parse({}),
        ),
      ),
    /** SNAP-3 — the View menu's capture, told to the page that holds the
     * still; validated at this boundary, the latest retained until the
     * renderer's one handler exists. */
    onResult: (handler: (result: ScreenshotCaptureResult) => void): (() => void) =>
      screenshotResults.subscribe(handler),
  },
  diagnostics: {
    query: (query: unknown) => diagnostics.query(query),
    subscribe: (query: unknown, onEvent: Parameters<typeof diagnostics.subscribe>[1]) =>
      diagnostics.subscribe(query, onEvent),
    unsubscribe: (subId: string) => diagnostics.unsubscribe(subId),
    createLease: (request: unknown) => diagnostics.createLease(request),
    listLeases: () => diagnostics.listLeases(),
    revokeLease: (request: unknown) => diagnostics.revokeLease(request),
    openLogs: () => diagnostics.openLogs(),
    listCrashes: () => diagnostics.listCrashes(),
    markCrashViewed: (request: unknown) => diagnostics.markCrashViewed(request),
    previewSupport: (selection: unknown) => diagnostics.previewSupport(selection),
    exportSupport: (request: unknown) => diagnostics.exportSupport(request),
    copyText: (text: unknown) => diagnostics.copyText(text),
  },
});
