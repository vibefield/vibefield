import {
  BrowserDataClearResult,
  FrameViewSetRequest,
  FrameViewState as FrameViewStateSchema,
  GodviewDeckSetRequest,
  IPC_CHANNELS,
  RendererReplaceRequest,
  RendererReplaceResult,
  type ScreenshotCaptureResult,
  ScreenshotPreviewResult,
  ThemeSetRequest,
  ThemeState as ThemeStateSchema,
  type UpdateChannel,
  UpdateCheckResult,
  UpdateConfirmRequest,
  UpdateConfirmResult,
  UpdateDeclineRequest,
  UpdateDoctorResult,
  UpdateDownloadRequest,
  UpdateDownloadResult,
  UpdateMoveResult,
  UpdatePrepareResult,
  UpdateSetChannelRequest,
  UpdateSetEnabledRequest,
  type UserRecord,
  UsersCreateParams,
  type UsersListSnapshot,
  UsersSwitchParams,
  UsersUpdateParams,
  WindowLightsState as WindowLightsStateSchema,
} from "@vibefield/contracts";
import type { FielddSupervisor } from "@vibefield/fieldd-supervisor";
import type { Logger } from "@vibefield/logging";
import { ipcMain, type WebContents } from "electron";
import { createBootstrapHandler, type WindowRendererBoundary } from "./bootstrap";
import {
  type ClipboardDoorOptions,
  type ClipboardImageDoorOptions,
  createClipboardDoor,
  createClipboardImageDoor,
} from "./clipboard-door";
import { shellIdentity } from "./login-shell";
import { createScreenshotDoor } from "./screenshot-door";
import { createScreenshotPreviewDoor } from "./screenshot-preview";
import {
  createScreenshotStillBytesDoor,
  createScreenshotStillKeptDoor,
  type StillOpened,
} from "./screenshot-still-bytes";
import type { StillResolution } from "./still-protocol";
import type { ThemeOwner } from "./theme";
import type { ViewRegistry } from "./view";
import type { LightsRegistry } from "./window-lights";
import type { WindowRegistry } from "./window-policy";

// The closed IPC surface, main side (ESR §6.2–6.3): handlers wiring pure policy
// to ipcMain. The bootstrap handler awaits supervisor.ensure() itself —
// window creation never waits for daemon readiness (ESR-8), ensure() is
// in-flight-deduped with failure clearing its cache, so a failed boot
// surfaces honestly to the renderer and a later retry re-attempts
// adoption/spawn for real (§6.3).

export function registerWindowBootstrap(
  registry: WindowRegistry,
  ensure: FielddSupervisor["ensure"],
  desktopBootId: string,
  logger?: Logger,
): WindowRendererBoundary {
  const handle = createBootstrapHandler({
    owns: (sender) => registry.owns(sender),
    ensure,
    desktopBootId,
    terminal: {
      // TP-S3e: the transport IS routed — the rollback flag and the bridge it
      // selected are gone; policy still rides the authenticated bootstrap.
      transport: "routed",
      ...shellIdentity(),
    },
    onRevokeError: (error, details) => {
      logger?.error(
        "desktop.ipc.window_token_revoke_failed",
        "Electron could not confirm renderer token revocation",
        error,
        details,
      );
    },
    onReplacementError: (error, details) => {
      logger?.error(
        "desktop.ipc.renderer_replacement_failed",
        "Electron could not request renderer process replacement",
        error,
        details,
      );
    },
  });
  ipcMain.handle(IPC_CHANNELS.windowBootstrap, async (event) => {
    try {
      const result = await handle(event);
      logger?.info(
        "desktop.ipc.window_bootstrap_completed",
        "A registered renderer received its fieldd connection",
        { webContentsId: event.sender.id },
      );
      return result;
    } catch (error) {
      logger?.warn(
        "desktop.ipc.window_bootstrap_rejected",
        "Electron rejected or failed a renderer bootstrap request",
        { webContentsId: event.sender.id, error },
      );
      throw error;
    }
  });
  return handle;
}

/** UA-3 — the Account page's profile door. Main owns users.json (UA-D10:
 * fieldd never writes it); the sender gate is bootstrap's and the payload is
 * schema-validated before it may touch anything. One door, two verbs: an
 * update with no recognized fields is an honest READ of the current record —
 * no lock, no write — which is how the page loads the profile it edits.
 * UA-7: `face` replaced `color` among the recognized fields. A `color` from an
 * older page is unrecognized now, so on its own it reads. */
export function registerUsersUpdate(
  registry: WindowRegistry,
  handlers: {
    apply: (params: UsersUpdateParams) => Promise<UserRecord>;
    read: () => Promise<UserRecord>;
  },
  logger?: Logger,
): void {
  ipcMain.handle(IPC_CHANNELS.usersUpdate, async (event, raw: unknown) => {
    if (!registry.owns(event.sender)) {
      throw new Error("users update refused: unregistered sender");
    }
    const params = UsersUpdateParams.parse(raw);
    const empty =
      params.name === undefined &&
      params.face === undefined &&
      params.resident === undefined &&
      params.onboarded === undefined;
    if (empty) return handlers.read();
    const record = await handlers.apply(params);
    logger?.info("desktop.users.updated", "The attached user's profile was updated", {
      webContentsId: event.sender.id,
      fields: Object.keys(params).join(","),
    });
    return record;
  });
}

/** UA-5 — the roster surface: list / create / switch, one sender gate. The
 * handlers are injected because main owns the attachment machinery (pair
 * bundles, window reload); this file owns only the wire. The create/switch
 * answers deliberately RACE the reload main performs on success — the calling
 * context may be torn down before the resolution lands, and that is fine:
 * the reload is the outcome, not the response. */
export function registerUsersRoster(
  registry: WindowRegistry,
  handlers: {
    list: () => Promise<UsersListSnapshot>;
    create: (params: UsersCreateParams) => Promise<UserRecord>;
    switchTo: (params: UsersSwitchParams) => Promise<UserRecord>;
  },
  logger?: Logger,
): void {
  ipcMain.handle(IPC_CHANNELS.usersList, async (event) => {
    if (!registry.owns(event.sender)) throw new Error("users list refused: unregistered sender");
    return handlers.list();
  });
  ipcMain.handle(IPC_CHANNELS.usersCreate, async (event, raw: unknown) => {
    if (!registry.owns(event.sender)) throw new Error("users create refused: unregistered sender");
    const params = UsersCreateParams.parse(raw);
    const record = await handlers.create(params);
    logger?.info("desktop.users.created", "A new user was minted and attached", {
      webContentsId: event.sender.id,
      fuid: record.fuid,
    });
    return record;
  });
  ipcMain.handle(IPC_CHANNELS.usersSwitch, async (event, raw: unknown) => {
    if (!registry.owns(event.sender)) throw new Error("users switch refused: unregistered sender");
    const params = UsersSwitchParams.parse(raw);
    const record = await handlers.switchTo(params);
    logger?.info("desktop.users.switched", "The shell attached a different user", {
      webContentsId: event.sender.id,
      fuid: record.fuid,
    });
    return record;
  });
}

/** The Backend door (GT-D3). Same sender gate as bootstrap: only a window THIS
 * shell registered may hand main a connection to dial. The ticket itself is
 * never inspected beyond its schema — main forwards transport coordinates and
 * holds no terminal product logic (design-03 A1).
 *
 * The answer also carries the shell identity (GT-D10). That is not product
 * logic sneaking in: `SHELL`, the passwd entry and `$HOME` are facts about the
 * machine that a sandboxed page cannot read, and the deck needs them before it
 * may mount a workspace. Composed HERE rather than inside the Backend host,
 * which stays exactly what it was — a ticket in, a bridge out. */
/** The view door (FR-1). The views track's cells and ⌘1–⌘4 ask for a view by
 * name and main's owner answers (`view.ts`) — this handler exists so the page
 * can reach the owner, not so the renderer can hold an opinion. Same
 * registered-sender gate as the others: a window this shell did not make cannot
 * move a window it does not own. */
export function registerViewSet(
  registry: WindowRegistry,
  views: ViewRegistry,
  logger?: Logger,
): void {
  ipcMain.handle(IPC_CHANNELS.viewSet, async (event, raw: unknown) => {
    if (!registry.owns(event.sender)) {
      logger?.warn(
        "desktop.ipc.view_set_refused",
        "Electron refused a view request from an unregistered sender",
        { webContentsId: event.sender.id },
      );
      throw new Error("view set refused: unregistered sender");
    }
    const request = FrameViewSetRequest.parse(raw);
    return FrameViewStateSchema.parse(views.ensure(event.sender).set(request.view));
  });
}

/** DK-9 — THE WINDOW'S RENDERER REPLACED AT ITS OWN ASKING (the runtime with kinds: a
 * plugin update whose kinds the page's realm defined otherwise — ICE's catalog cannot
 * re-define a type in a realm — is carried by a new document, which reopens the
 * window's board, `vf-window-doc`, with the new kinds). The page saves its board
 * FIRST and then asks; main answers and reloads it FROM MAIN — a page's own
 * `location.reload()` is a navigation the contents policy refuses in every mode but
 * dev (security-policy.ts `decideNavigation`), and a main-made reload is the users
 * switch's road (UA-D15): bootstrap's `did-start-navigation` retires the old
 * generation's token before the new document mints. Same registered-sender gate as
 * every door; the answer RACES the reload, as the users doors' do. */
export function registerRendererReplace(
  registry: WindowRegistry,
  logger?: Logger,
  reload: (sender: WebContents) => void = (sender) => {
    setImmediate(() => {
      if (!sender.isDestroyed()) sender.reload();
    });
  },
): void {
  ipcMain.handle(IPC_CHANNELS.rendererReplace, async (event, raw: unknown) => {
    if (!registry.owns(event.sender)) {
      logger?.warn(
        "desktop.ipc.renderer_replace_refused",
        "Electron refused a renderer replacement from an unregistered sender",
        { webContentsId: event.sender.id },
      );
      throw new Error("renderer replace refused: unregistered sender");
    }
    const request = RendererReplaceRequest.parse(raw);
    logger?.info(
      "desktop.ipc.renderer_replace",
      "A window's renderer is replaced at its own asking: main reloads it",
      { webContentsId: event.sender.id, reason: request.reason },
    );
    reload(event.sender);
    return RendererReplaceResult.parse({ replacing: true });
  });
}

/** BP-D4 (thinking-browser-profile.md §3·3, 2026-10-26) — Settings › General's "Clear browsing data". Main clears this
 * shell's browser profiles (the desk's, and any other a page opened) and reloads their open pages; the answer is counts
 * only. Same registered-sender gate as every door here: a window this shell did not make clears nobody's sessions. */
export function registerBrowserDataClear(
  registry: WindowRegistry,
  clear: () => Promise<BrowserDataClearResult>,
  logger?: Logger,
): void {
  ipcMain.handle(IPC_CHANNELS.browserDataClear, async (event) => {
    if (!registry.owns(event.sender)) {
      logger?.warn(
        "desktop.ipc.browser_data_clear_refused",
        "Electron refused a browsing-data clear from an unregistered sender",
        { webContentsId: event.sender.id },
      );
      throw new Error("browser data clear refused: unregistered sender");
    }
    return BrowserDataClearResult.parse(await clear());
  });
}

/** Item 102 — the clipboard read door (design-03 §5.1's `shell.clipboard.*`, the
 * product window's read half). Policy in clipboard-door.ts; this is the ipcMain
 * wiring only. The registered-sender gate is `registry.owns`, as at every door
 * here, and the focus fact is the caller's: the sender's window and its page. */
export function registerClipboardRead(
  registry: WindowRegistry,
  options: Omit<ClipboardDoorOptions<WebContents>, "owns" | "onRefused">,
  logger?: Logger,
): void {
  const door = createClipboardDoor<WebContents>({
    ...options,
    owns: (sender) => registry.owns(sender),
    onRefused: (sender, reason, bytes) => {
      logger?.warn("desktop.ipc.clipboard_read_refused", "Electron refused a clipboard read", {
        webContentsId: sender.id,
        reason,
        ...(bytes === undefined ? {} : { bytes }),
      });
    },
  });
  ipcMain.handle(IPC_CHANNELS.clipboardRead, (event, raw: unknown) => door(event.sender, raw));
}

/** HN-5 — the clipboard's picture write (design-03 §5.1's `shell.clipboard.*`, the product
 * window's write half beside item 102's read): the PNG's bytes and the copy's words, the
 * invoke's two arguments. Policy in clipboard-door.ts; this is the ipcMain wiring only. The
 * registered-sender gate is `registry.owns`, as at every door here — the text copy's rule,
 * no focus asked (LC-18); the decode and the one write are the caller's. */
export function registerClipboardWriteImage<Picture>(
  registry: WindowRegistry,
  options: Omit<ClipboardImageDoorOptions<WebContents, Picture>, "owns" | "onRefused">,
  logger?: Logger,
): void {
  const door = createClipboardImageDoor<WebContents, Picture>({
    ...options,
    owns: (sender) => registry.owns(sender),
    onRefused: (sender, reason, bytes) => {
      logger?.warn(
        "desktop.ipc.clipboard_write_refused",
        "Electron refused a clipboard picture write",
        { webContentsId: sender.id, reason, ...(bytes === undefined ? {} : { bytes }) },
      );
    },
  });
  ipcMain.handle(IPC_CHANNELS.clipboardWriteImage, (event, raw: unknown, text?: unknown) =>
    door(event.sender, raw, text),
  );
}

/** WP12d (L3c-i; `build-wp12-updater.md` §13 C1, the PM's ruling 2026-10-15 18:17Z) — the updater's host doors. The
 * Settings card reaches main's ONE updater here, not through fieldd: an updater must work with fieldd broken (EDP §11.3).
 * Same registered-sender gate as every door; every payload parsed by its contract in both directions; no door carries
 * a path or a URL (EDP-38). The state itself rides `desktopState` (`update`, the controller's one projection). */
export interface UpdateDoorHandlers {
  /** AU-1 (LC-5) — answered when the CHECK settles; a found update's download goes on (the view says it) */
  check(): Promise<UpdateCheckResult>;
  setEnabled(enabled: boolean): void;
  setChannel(channel: UpdateChannel): void;
  decline(version: string): void;
  /** AU-1 (AU-G5, AU-G6) — a person's download of ONE found version; a refusal in main's words */
  download(version: string): Promise<UpdateDownloadResult>;
  prepareRestart(): Promise<UpdatePrepareResult>;
  confirmRestart(token: string): Promise<{ ok: true } | { ok: false; reason: string }>;
  doctor(): string[];
  /** AU-7 (AU-G8) — Move to Applications through the quit gate: answered when the gate decides, or a refusal before
   * anything stops */
  moveToApplications(): Promise<UpdateMoveResult>;
}

export function registerUpdateDoors(
  registry: WindowRegistry,
  handlers: UpdateDoorHandlers,
  logger?: Logger,
): void {
  const gate = (door: string, sender: WebContents): void => {
    if (registry.owns(sender)) return;
    logger?.warn(
      "desktop.ipc.update_refused",
      "Electron refused an update door from an unregistered sender",
      {
        door,
        webContentsId: sender.id,
      },
    );
    throw new Error(`update ${door} refused: unregistered sender`);
  };
  ipcMain.handle(IPC_CHANNELS.updateCheck, async (event) => {
    gate("check", event.sender);
    return UpdateCheckResult.parse(await handlers.check());
  });
  ipcMain.handle(IPC_CHANNELS.updateSetEnabled, async (event, raw: unknown) => {
    gate("set-enabled", event.sender);
    handlers.setEnabled(UpdateSetEnabledRequest.parse(raw).enabled);
  });
  ipcMain.handle(IPC_CHANNELS.updateSetChannel, async (event, raw: unknown) => {
    gate("set-channel", event.sender);
    handlers.setChannel(UpdateSetChannelRequest.parse(raw).channel);
  });
  ipcMain.handle(IPC_CHANNELS.updateDecline, async (event, raw: unknown) => {
    gate("decline", event.sender);
    handlers.decline(UpdateDeclineRequest.parse(raw).version);
  });
  ipcMain.handle(IPC_CHANNELS.updateDownload, async (event, raw: unknown) => {
    gate("download", event.sender);
    return UpdateDownloadResult.parse(
      await handlers.download(UpdateDownloadRequest.parse(raw).version),
    );
  });
  ipcMain.handle(IPC_CHANNELS.updatePrepareRestart, async (event) => {
    gate("prepare-restart", event.sender);
    return UpdatePrepareResult.parse(await handlers.prepareRestart());
  });
  ipcMain.handle(IPC_CHANNELS.updateConfirmRestart, async (event, raw: unknown) => {
    gate("confirm-restart", event.sender);
    return UpdateConfirmResult.parse(
      await handlers.confirmRestart(UpdateConfirmRequest.parse(raw).token),
    );
  });
  ipcMain.handle(IPC_CHANNELS.updateDoctor, async (event) => {
    gate("doctor", event.sender);
    return UpdateDoctorResult.parse({ lines: handlers.doctor() });
  });
  ipcMain.handle(IPC_CHANNELS.updateMoveToApplications, async (event) => {
    gate("move-to-applications", event.sender);
    return UpdateMoveResult.parse(await handlers.moveToApplications());
  });
}

/** The theme door (FR-4, FC-D5). The Me menu's Theme, Settings → Appearance and
 * the Setup Assistant's button ask main's one owner (`theme.ts`) by name and
 * draw what it answers. Same registered-sender gate; a window that asks is told
 * every change from then on, whichever window made it. */
export function registerThemeSet(
  registry: WindowRegistry,
  theme: ThemeOwner,
  logger?: Logger,
): void {
  ipcMain.handle(IPC_CHANNELS.themeSet, async (event, raw: unknown) => {
    if (!registry.owns(event.sender)) {
      logger?.warn(
        "desktop.ipc.theme_set_refused",
        "Electron refused a theme request from an unregistered sender",
        { webContentsId: event.sender.id },
      );
      throw new Error("theme set refused: unregistered sender");
    }
    const request = ThemeSetRequest.parse(raw);
    theme.watch(event.sender);
    return ThemeStateSchema.parse(theme.set(request.preference));
  });
}

/** The deck door (Godview round 3 — GV-D6, GV-D11). Godview's deck says its
 * state BY NAME — away, up, maximized, or none — and main's owner
 * (`window-lights.ts`) answers with what it holds: the word, and where the
 * window's lights stand for it. No position crosses in either direction; the
 * two positions are main's, composed with the view main already owns. Same
 * registered-sender gate as the others: a window this shell did not make moves
 * no window's lights and lends nobody's ⌘W. */
export function registerDeckSet(
  registry: WindowRegistry,
  lights: LightsRegistry,
  logger?: Logger,
): void {
  ipcMain.handle(IPC_CHANNELS.deckSet, async (event, raw: unknown) => {
    if (!registry.owns(event.sender)) {
      logger?.warn(
        "desktop.ipc.deck_set_refused",
        "Electron refused a deck state from an unregistered sender",
        { webContentsId: event.sender.id },
      );
      throw new Error("deck set refused: unregistered sender");
    }
    const request = GodviewDeckSetRequest.parse(raw);
    return WindowLightsStateSchema.parse(lights.ensure(event.sender).say(request.deck));
  });
}

/** The screenshot door (SNAP-D3). `capture` is the ONE capture main owns —
 * the View menu's item calls the same function — so the page and the menu can
 * never hold different ideas of whether a helper is live. Policy in
 * screenshot-door.ts; this is the ipcMain wiring only. */
export function registerScreenshotCapture(
  registry: WindowRegistry,
  capture: () => Promise<ScreenshotCaptureResult>,
  logger?: Logger,
): void {
  const door = createScreenshotDoor<WebContents>({
    owns: (sender) => registry.owns(sender),
    capture,
    onRefused: (sender) => {
      logger?.warn(
        "desktop.ipc.screenshot_refused",
        "Electron refused a screenshot capture from an unregistered sender",
        { webContentsId: sender.id },
      );
    },
    onFinished: (result, sender) => {
      logger?.info("desktop.ipc.screenshot_finished", "A renderer's screenshot capture finished", {
        webContentsId: sender.id,
        status: result.status,
        ...(result.status === "error" ? { code: result.code } : {}),
      });
    },
  });
  ipcMain.handle(IPC_CHANNELS.screenshotCapture, (event, raw: unknown) => door(event.sender, raw));
}

export function registerScreenshotPreview(
  registry: WindowRegistry,
  resolve: (url: string) => StillResolution,
  preview: (sender: WebContents, path: string) => Promise<void>,
): void {
  const door = createScreenshotPreviewDoor({
    owns: (sender: WebContents) => registry.owns(sender),
    resolve,
    preview,
  });
  ipcMain.handle(IPC_CHANNELS.screenshotPreview, async (event, raw: unknown) =>
    ScreenshotPreviewResult.parse(await door(event.sender, raw)),
  );
}

/** HN-D7 — a retained still's bytes, for the desk's print of a snapshot played onto it: found by
 * name in the tool's ring, and read from the handle it is judged by (policy in
 * screenshot-still-bytes.ts; the wiring here). */
export function registerScreenshotStillBytes(
  registry: WindowRegistry,
  find: (url: string) => StillResolution,
  read: (path: string) => Promise<StillOpened<Uint8Array>>,
  logger?: Logger,
): void {
  const door = createScreenshotStillBytesDoor({
    owns: (sender: WebContents) => registry.owns(sender),
    find,
    read,
    onRefused: (reason) => {
      logger?.warn(
        "desktop.ipc.still_bytes_refused",
        "A retained still's bytes were not handed to the page",
        { reason },
      );
    },
  });
  ipcMain.handle(IPC_CHANNELS.screenshotStillBytes, (event, raw: unknown) =>
    door(event.sender, raw),
  );
}

/** HN-4 — whether a still is still kept, for a snapshot's card played onto a pane: the bytes door's
 * lookup and handle check above, answered as a boolean (policy in screenshot-still-bytes.ts). */
export function registerScreenshotStillKept(
  registry: WindowRegistry,
  find: (url: string) => StillResolution,
  check: (path: string) => Promise<StillOpened<true>>,
  logger?: Logger,
): void {
  const door = createScreenshotStillKeptDoor({
    owns: (sender: WebContents) => registry.owns(sender),
    find,
    check,
    onRefused: (reason) => {
      logger?.warn("desktop.ipc.still_not_kept", "A still asked about is not kept", { reason });
    },
  });
  ipcMain.handle(IPC_CHANNELS.screenshotStillKept, (event, raw: unknown) =>
    door(event.sender, raw),
  );
}
