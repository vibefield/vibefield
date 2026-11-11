import { z } from "zod";
import { ARTIFACT_LIMITS, ArtifactId, ArtifactTitle, MadeAppReach, Sha256Hex } from "./artifacts";
import { ClientKind, SemverString } from "./envelope";
import { ErrorKind, UnavailableDetails } from "./errors";
import {
  CoreSimulatorRuntimeIdV1,
  LiveSurfaceAttachTicketV1,
  LiveSurfaceIdV1,
  LiveSurfaceSimulatorDeviceRowV1,
  LiveSurfaceSourceSpecV1,
  SURFACE_LIMITS,
  SurfaceEnumerationKindV1,
  SurfaceReuseKeyV1,
  SurfaceSourceDescriptorV1,
} from "./live-surfaces";
import { isAbsoluteDesktopPath } from "./paths";
import { PluginId } from "./plugins";
import { SHELL_CLIPBOARD } from "./registries";
import { ScreenshotShortcutState } from "./screenshot";
import { TERMINAL_LINK_MAX_CHARS } from "./terminal";
import { UpdateView } from "./update-policy";

// Shell-boundary contracts (ESR spec §6.1): the shapes that cross the Electron
// seam — the daemon's on-disk discovery descriptor and the closed contextBridge
// IPC surface. TS-only by design (never in the Rust gen bundle): fieldd writes
// and Electron reads on the same machine. Channel names live in
// registries.IPC_CHANNELS. Contracts describe the wire that ships today; future
// controlUrl work remains additive to this envelope.

/** `<dataRoot>/fieldd/run/product.json` — written by fieldd on boot (and
 * rewritten, atomically, whenever the floor it is linked to changes:
 * `nativePid`), read by the shell/supervisor for adopt-or-spawn (design-02
 * §3.6/D10). Tolerant: future daemons may add fields; readers must survive
 * them. */
export const ProductInfo = z
  .object({
    /** actual bound control port (ephemeral in tests — never inferred, always read) */
    port: z.number().int().positive(),
    pid: z.number().int().positive(),
    bootId: z.string().min(1),
    contractsVersion: SemverString,
    startedAt: z.number(),
    /** The floor this fieldd is linked to: the pid it spawned, or the one the
     * paired floor stated in its hello ack (WG-D6) — rewritten whenever that
     * floor changes. null when native is disabled or no floor is identified. */
    nativePid: z.number().int().positive().nullable(),
    /** Development build identity. Production writes null; optional keeps
     * adoption compatible with product files written by older daemons. */
    buildId: z.string().min(1).max(128).nullable().optional(),
    /** UA-2 — the user this daemon serves (users.json userId). The supervisor
     * probe refuses a mismatch the way it refuses incompatible-build; null =
     * unconfigured, optional keeps pre-UA-2 product files adoptable. */
    userId: z.string().min(1).nullable().optional(),
  })
  .passthrough();
export type ProductInfo = z.infer<typeof ProductInfo>;

const RendererParticipantPart = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

/** PRC-D14 — an identity minted by Electron main, never selected by renderer
 * code. `participantId` is stable for one logical BrowserWindow within a shell
 * boot; `incarnation` changes for every cross-document renderer generation. */
export const RendererParticipantIdentity = z
  .object({
    participantId: RendererParticipantPart,
    incarnation: RendererParticipantPart,
  })
  .passthrough();
export type RendererParticipantIdentity = z.infer<typeof RendererParticipantIdentity>;

/**
 * Terminal policy fixed for one renderer generation.
 *
 * Main is the authority: it is the only process allowed to read the login
 * shell/home, and it states the transport on the authenticated bootstrap.
 * Since TP-S3e the selector is the literal — the rollback flag and the bridge
 * it selected are gone; the field stays so a reader keeps one shape across
 * the era boundary (tolerant reader).
 */
export const WindowTerminalBootstrap = z
  .object({
    transport: z.literal("routed"),
    defaultShell: z.string().min(1),
    home: z.string().min(1),
  })
  .passthrough();
export type WindowTerminalBootstrap = z.infer<typeof WindowTerminalBootstrap>;

/** Reply to the window-bootstrap invoke: the loopback control endpoint, the
 * per-window scoped token, and the exact identity bound into that token (D27,
 * PRC-D14 — main brokers this once and relays nothing). */
export const WindowConnection = z
  .object({
    port: z.number().int().positive(),
    token: z.string().min(1), // opaque bearer token, same treatment as hello credential
    rendererParticipant: RendererParticipantIdentity,
    /** Optional only for compatibility with an older Electron host. */
    terminal: WindowTerminalBootstrap.optional(),
  })
  .passthrough();
export type WindowConnection = z.infer<typeof WindowConnection>;

export const CloseReason = z.enum(["window", "app-quit", "restart", "update"]);
export type CloseReason = z.infer<typeof CloseReason>;

/** main → renderer: drain the document session for a durable close. One attempt
 * active per window; requestId binds the eventual CloseResult to it. */
export const CloseRequest = z
  .object({
    requestId: z.string().min(1),
    reason: CloseReason,
  })
  .passthrough();
export type CloseRequest = z.infer<typeof CloseRequest>;

/** renderer → main: the drain verdict. `ok:false` carries an honest error and
 * keeps the window open for the user's Retry / Quit Without Saving decision. */
export const CloseResult = z
  .object({
    requestId: z.string().min(1),
    ok: z.boolean(),
    error: z.string().optional(),
  })
  .passthrough();
export type CloseResult = z.infer<typeof CloseResult>;

/** Presentation commands the native shell may route into the one field
 * renderer. They carry no authority: the renderer decides how to reveal its
 * existing Settings surface. */
/** TS-5 — `open-devices` is a link notice's click: Settings → Devices. TS-4 —
 * `open-connect` is the status item's Connect Your Devices… and the away notice's
 * Connect…: the Connect door the face menu's row opens. */
export const ShellCommand = z.enum([
  "open-settings",
  "open-diagnostics",
  "open-devices",
  "open-connect",
]);
export type ShellCommand = z.infer<typeof ShellCommand>;

export const ShellCommandRequest = z
  .object({
    command: ShellCommand,
  })
  .passthrough();
export type ShellCommandRequest = z.infer<typeof ShellCommandRequest>;

/** The frame's four views (One Frame FR-1; FC-D2, FV-D7), in the views
 * track's order. The canvas is the ground floor (FV-D1) and the others are
 * drawn as one cover over it. The fourth is Chat (SP-1b, 2026-10-31), whose
 * wire id stays `assistant`. Every view is built: FC-D2's waiting cell retired
 * with SP-1b, and with it the predicate main and the frame asked of it. */
export const FrameView = z.enum(["canvas", "godview", "history", "assistant"]);
export type FrameView = z.infer<typeof FrameView>;

/** main → renderer: THIS window's active view (FR-1; GT-D2's Godview bit,
 * grown into the four views and retired into them).
 *
 * Main owns it, per window, because main also has to KNOW it: the View menu
 * marks the view it names, and the close item gives ⌘W to Godview's panes
 * only while Godview is the view. A renderer-owned view would be a second copy
 * main had to be told about to keep its own menu honest. One owner, one
 * truth; the views track, the keys and the menu all ask it, and draw what it
 * answers. Not persisted: a window opens on the canvas, the ground floor. */
export const FrameViewState = z.object({ view: FrameView }).passthrough();
export type FrameViewState = z.infer<typeof FrameViewState>;

/** renderer → main: ask for a view — the views track's cells and ⌘1–⌘4 send
 * the view they name, never a flip, so a request cannot argue with a value main
 * already changed. Answered with the resulting state (a refused view answers
 * with the unchanged one). */
export const FrameViewSetRequest = z.object({ view: FrameView }).passthrough();
export type FrameViewSetRequest = z.infer<typeof FrameViewSetRequest>;

/** The View menu's zoom (One Frame FR-4, 3b): Actual Size, Zoom In, Zoom Out —
 * the three items that replaced Electron's `resetZoom`/`zoomIn`/`zoomOut`
 * roles, which zoomed the WHOLE WINDOW wherever nothing claimed their keys. */
export const FrameZoomAct = z.enum(["in", "out", "actual"]);
export type FrameZoomAct = z.infer<typeof FrameZoomAct>;

/** main → renderer: the act a View menu item names, for the window's head to
 * answer — on Canvas, as it answers ⌘+ ⌘− ⌘0. An act, never a zoom level: the
 * camera is the page's, and main never learns it. Under a cover the items are
 * disabled, so none is sent; a page that is not on Canvas when one arrives
 * does nothing with it. */
export const FrameZoomRequest = z.object({ act: FrameZoomAct }).passthrough();
export type FrameZoomRequest = z.infer<typeof FrameZoomRequest>;

/** The app's ONE theme setting (One Frame FR-4, FC-D5): Light, Dark, or Auto,
 * which follows the OS. Main owns it — one value per device, kept by the shell
 * — and projects what it resolves to into Electron's `nativeTheme`; the Me
 * menu's Theme, Settings → Appearance and the Setup Assistant's button all ask
 * it, and every window is told. A renderer never keeps a theme of its own. */
export const ThemePreference = z.enum(["light", "dark", "auto"]);
export type ThemePreference = z.infer<typeof ThemePreference>;

/** What a preference resolves to: the two themes a surface is drawn in. */
export const ThemeName = z.enum(["light", "dark"]);
export type ThemeName = z.infer<typeof ThemeName>;

/** Auto is the OS's theme; Light and Dark are themselves. One reading, so the
 * owner and a harness without one can never resolve the same choice two ways. */
export function resolveTheme(preference: ThemePreference, osDark: boolean): ThemeName {
  if (preference === "auto") return osDark ? "dark" : "light";
  return preference;
}

/** main → renderer: the theme as main's owner holds it — what was chosen and
 * what it resolves to now (Auto's answer moves when the OS flips). */
export const ThemeState = z
  .object({ preference: ThemePreference, resolved: ThemeName })
  .passthrough();
export type ThemeState = z.infer<typeof ThemeState>;

/** renderer → main: choose the theme by name, never a flip. Answered with the
 * resulting state. */
export const ThemeSetRequest = z.object({ preference: ThemePreference }).passthrough();
export type ThemeSetRequest = z.infer<typeof ThemeSetRequest>;

/** Godview's terminal deck, as the page names it (Godview round 3 — GV-D6,
 * GV-D11): fully away, up as a sheet over the monitor, or maximized, where its
 * bar is the window's title bar. Three names and no geometry: where the deck's
 * edge stands is the page's business and never crosses. */
export const GodviewDeckState = z.enum(["away", "up", "maximized"]);
export type GodviewDeckState = z.infer<typeof GodviewDeckState>;

/** renderer → main: THIS window's deck, said by name — or `null`, the page
 * saying it has none to speak of (Godview is not its view, or its deck is not
 * mounted). Never a position: main owns the window's lights and the two places
 * they stand, and composes this fact with the view it already owns
 * ({@link FrameViewState}), so a change of view moves them with no word from
 * the page. The same fact decides whether ⌘W is lent to the deck's panes. */
export const GodviewDeckSetRequest = z.object({ deck: GodviewDeckState.nullable() }).passthrough();
export type GodviewDeckSetRequest = z.infer<typeof GodviewDeckSetRequest>;

/** Where a window's lights (macOS's close · minimize · zoom) stand, by name:
 * on the HEAD's axis, where a window is built with them; on the deck's BAR,
 * while Godview's deck is maximized and that bar is the title bar; or NONE —
 * the window has no inset lights (not a Mac, or a default title bar), and main
 * moved nothing. */
export const WindowLights = z.enum(["head", "bar", "none"]);
export type WindowLights = z.infer<typeof WindowLights>;

/** main → renderer: the answer to {@link GodviewDeckSetRequest} — the deck as
 * main now holds it for this window, and where its lights stand for it. */
export const WindowLightsState = z
  .object({ deck: GodviewDeckState.nullable(), lights: WindowLights })
  .passthrough();
export type WindowLightsState = z.infer<typeof WindowLightsState>;

/** Why a window asks main to replace its renderer (DK-9), by name:
 *  · `plugin-kinds` — a plugin's KINDS changed in a way this realm cannot take: an update's
 *    new code or schema, or a type a board's ghost stub defined faceless (field-app
 *    window-kinds.ts);
 *  · `field-service` — the person's Try again on the status line's field-service notice
 *    (item 212, RV #29): the reloaded window's bootstrap is the person's ask, which starts
 *    fieldd again after main stopped trying (`FIELDD_LINK.STATE_CRASH_LOOP`). */
export const RendererReplaceReason = z.enum(["plugin-kinds", "field-service"]);
export type RendererReplaceReason = z.infer<typeof RendererReplaceReason>;

/** renderer → main: replace THIS window's renderer (`IPC_CHANNELS.rendererReplace`). */
export const RendererReplaceRequest = z.object({ reason: RendererReplaceReason }).passthrough();
export type RendererReplaceRequest = z.infer<typeof RendererReplaceRequest>;

/** main → renderer: the replacement is under way — main reloads the page right after
 * this answer, which the page may never see. */
export const RendererReplaceResult = z.object({ replacing: z.literal(true) }).passthrough();
export type RendererReplaceResult = z.infer<typeof RendererReplaceResult>;

/** main → renderer: Settings › General's "Clear browsing data" (`IPC_CHANNELS.browserDataClear`; BP-D4,
 * thinking-browser-profile.md §3·3, 2026-10-26). Main cleared the desk's browser profile — its cookies, every site
 * storage, the HTTP and auth caches — and any other persistent profile this shell opened, then reloaded the open pages
 * on them, so none keeps a session it no longer has. Counts only: no path, no site, no size crosses. The request
 * carries nothing. */
export const BrowserDataClearResult = z
  .object({
    profiles: z.number().int().min(0).max(64),
    pages: z.number().int().min(0).max(4096),
  })
  .passthrough();
export type BrowserDataClearResult = z.infer<typeof BrowserDataClearResult>;

/** The UTF-8 bytes of a text: the measure `SHELL_CLIPBOARD.READ_MAX_BYTES` and the
 * pane's own paste refusal (D6) both state. */
export function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

/** renderer → main: a paste's read (`IPC_CHANNELS.clipboardRead`; item 102). It
 * carries nothing: main reads the system clipboard's text, and the page never says
 * what it holds. */
export const ClipboardReadRequest = z.object({}).passthrough();
export type ClipboardReadRequest = z.infer<typeof ClipboardReadRequest>;

/** main → renderer: the clipboard's text, or why it was not read. Both refusals are
 * honest states of a product window's life:
 *  · `unfocused` — the window or its page is not the one in front of the person,
 *    and a paste is that person's chord, so nothing was read for it;
 *  · `too-large` — the text is over `SHELL_CLIPBOARD.READ_MAX_BYTES`; it is refused
 *    whole with its size, never cut.
 * A sender this shell did not register is no state of a product window: main
 * throws for it and reads nothing. */
export const ClipboardReadResult = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("read"),
      text: z
        .string()
        .refine(
          (text) => utf8ByteLength(text) <= SHELL_CLIPBOARD.READ_MAX_BYTES,
          "clipboard text over SHELL_CLIPBOARD.READ_MAX_BYTES",
        ),
    })
    .passthrough(),
  z
    .object({
      status: z.literal("refused"),
      reason: z.enum(["unfocused", "too-large"]),
      bytes: z.number().int().min(0).optional(),
    })
    .passthrough(),
]);
export type ClipboardReadResult = z.infer<typeof ClipboardReadResult>;
export type ClipboardReadRefusal = Extract<ClipboardReadResult, { status: "refused" }>["reason"];

/** main → renderer: a copy's picture put on the system clipboard, with its words when
 * the copy has any (`IPC_CHANNELS.clipboardWriteImage`; HN-5, LC-19), or why it was
 * not. The request is the PNG's bytes themselves and the words beside them, the
 * invoke's two arguments, checked in main: neither is a field here. Each refusal is
 * an honest state of a product window's copy, and nothing of it is written:
 *  · `too-large` — the bytes are over `SHELL_CLIPBOARD.WRITE_IMAGE_MAX_BYTES`, or
 *    the words over `SHELL_CLIPBOARD.WRITE_TEXT_MAX_BYTES`; refused whole with the
 *    size that was too large, never cut;
 *  · `not-an-image` — the bytes decode to no picture.
 * No focus is asked (LC-18): a write reads nothing, and the words' copy door asks
 * none. A sender this shell did not register, or a request that is not bytes and
 * words, is no state of a product window: main throws for it and writes nothing. */
export const ClipboardWriteImageResult = z.discriminatedUnion("status", [
  z.object({ status: z.literal("written") }).passthrough(),
  z
    .object({
      status: z.literal("refused"),
      reason: z.enum(["too-large", "not-an-image"]),
      bytes: z.number().int().min(0).optional(),
    })
    .passthrough(),
]);
export type ClipboardWriteImageResult = z.infer<typeof ClipboardWriteImageResult>;
export type ClipboardWriteImageRefusal = Extract<
  ClipboardWriteImageResult,
  { status: "refused" }
>["reason"];

/** preload → page: why a copy's write was refused, typed (HN-5) — the one shape both copy
 * doors reject with, the words' (`copyText`, over the diagnostics port) and the picture's
 * (`writeImage`), for the page to say in Copy's voice, its sizes as §9 counts them, and never
 * a bridge's error (DESIGN.md §8 "Copy"). A plain record, never an Error: the context bridge
 * carries an Error across as its message alone, so a refusal's terms would not reach the page.
 *  · `too-large` — `bytes` is past `max`: the words' UTF-8 (`words`) or the picture's PNG
 *    (`picture`) against the clipboard's bound (`SHELL_CLIPBOARD`), or the words as the words'
 *    door sends them (`words-as-sent`) against what one request carries of them, the port's
 *    cap (`LOG_TRANSPORT_LIMITS.DIAGNOSTIC_PORT_REQUEST_BYTES`) less its envelope. JSON spends
 *    two bytes on a line break and six on a control character, so words within the clipboard's
 *    bound can be past the port's. A size within its bound is no refusal of this kind;
 *  · `not-an-image` — main found no picture in the PNG it was given. */
export const ClipboardCopyRefusal = z
  .discriminatedUnion("reason", [
    z
      .object({
        reason: z.literal("too-large"),
        what: z.enum(["words", "picture", "words-as-sent"]),
        bytes: z.number().int().min(0),
        max: z.number().int().min(0),
      })
      .passthrough(),
    z.object({ reason: z.literal("not-an-image") }).passthrough(),
  ])
  .refine(
    (refusal) => refusal.reason !== "too-large" || refusal.bytes > refusal.max,
    "a size refused as too large is past its bound",
  );
export type ClipboardCopyRefusal = z.infer<typeof ClipboardCopyRefusal>;
/** A copy past its bound: the refusal's `too-large` arm, which the copy door says in sizes. */
export type ClipboardCopyTooLarge = Extract<ClipboardCopyRefusal, { reason: "too-large" }>;

/** Item 102 — the read door's audit action, appended by main through fieldd's
 * `audit.append` (wall R17), which admits only registered shell-owned actions. One
 * outcome for every answer and every refusal, with the bytes and the asking page's
 * id, never the text. */
export const SHELL_CLIPBOARD_AUDIT_ACTIONS = {
  READ: "shell.clipboard.read",
} as const;

/** Small host fact used only to describe platform-specific desktop behavior in
 * Settings. Unknown Electron platforms collapse to `other` at the preload
 * boundary rather than leaking Node's process object into the renderer. */
export const ShellPlatform = z.enum(["darwin", "win32", "linux", "other"]);
export type ShellPlatform = z.infer<typeof ShellPlatform>;

/** BP-1c (BP-D9 (a), `thinking-browser-profile.md` §3·8) — whether the desk browser keeps a person's sign-ins across a
 * restart. Chromium writes a desk profile's cookie database only when the profile lies inside Electron's userData
 * (measured, Electron 43.1.1), so main checks where this shell's profiles lie, once, at start
 * (`live-surfaces/browser-profiles-placement.ts`): `kept` — inside (the packaged default, `pnpm dev`, every smoke home);
 * `until-quit` — outside (a FIELDD_DATA_DIR or `--user-data-dir` set apart): the pages work, and their sites stay signed
 * in only until VibeField quits. */
export const DesktopBrowserSignIns = z.enum(["kept", "until-quit"]);
export type DesktopBrowserSignIns = z.infer<typeof DesktopBrowserSignIns>;

/** Item 212 (RV #29) — the field service as Electron main holds it for the ATTACHED pair (`main/fieldd-link.ts`):
 * `UnavailableDetails.service` and `.state` on the window's status line and the status item's service row. Main
 * starts fieldd again after it goes away, at most `max` automatic attempts in its intensity window (the house rule:
 * NATIVE_SUPERVISION's RESPAWN_MAX, WG-D1's restart intensity), and past that stops until a person asks. TS-only:
 * main writes it, the window reads it (`DesktopShellState.fieldd`). */
export const FIELDD_LINK = {
  SERVICE: "fieldd",
  /** fieldd went away and an automatic attempt to start it again failed: the next one waits its spacing.
   * `attempt` is how many automatic attempts the window holds, `of` how many it allows */
  STATE_RECOVERING: "recovering",
  /** the intensity tripped: `failures` automatic attempts inside the window did not keep fieldd up, and nothing
   * starts it again until a person asks (the status line's Try again, the status item's Try Again, a window
   * opening). Its terminal sessions keep running: the floor outlives fieldd */
  STATE_CRASH_LOOP: "crash-loop",
  /** RV #67 — fieldd is up and stopped answering: main measures its reply silence */
  STATE_UNRESPONSIVE: "unresponsive",
} as const;

export const FielddLinkState = z.enum([
  FIELDD_LINK.STATE_RECOVERING,
  FIELDD_LINK.STATE_CRASH_LOOP,
  FIELDD_LINK.STATE_UNRESPONSIVE,
]);
export type FielddLinkState = z.infer<typeof FielddLinkState>;

/** The field service not there for the attached pair, by name (`FIELDD_LINK`); `progress` keeps its 0..1 meaning and
 * is never set here. */
export const FielddLinkUnavailable = UnavailableDetails.extend({
  service: z.literal(FIELDD_LINK.SERVICE),
  state: FielddLinkState,
  /** `recovering`: the automatic attempts inside the intensity window so far */
  attempt: z.number().int().nonnegative().optional(),
  /** `crash-loop`: the automatic attempts inside the window that did not keep fieldd up */
  failures: z.number().int().positive().optional(),
  /** `recovering`: the most automatic attempts the window allows */
  of: z.number().int().positive().optional(),
}).passthrough();
export type FielddLinkUnavailable = z.infer<typeof FielddLinkUnavailable>;

/** Main-owned desktop capability truth. Preferences describe user intent;
 * this state describes whether the native shell actually realized it. */
export const DesktopShellState = z
  .object({
    screenshotHotkey: ScreenshotShortcutState.optional(),
    tray: z
      .object({
        availability: z.enum(["available", "hidden", "unavailable"]),
        /** Native construction and visible placement are separate facts. The OS
         * can retain a real Tray while moving it outside the visible menu bar. */
        placement: z.enum(["visible", "offscreen", "unknown"]),
        backgroundShellEffective: z.boolean(),
        issue: z
          .union([
            z.object({
              code: z.literal("DESKTOP_TRAY_UNAVAILABLE"),
              message: z.string().min(1).max(512),
            }),
            z.object({
              code: z.literal("DESKTOP_TRAY_OFFSCREEN"),
              message: z.string().min(1).max(512),
            }),
          ])
          .nullable(),
      })
      .passthrough(),
    /** WP12d (L3c-i) — the desktop updater, as the tray and the Settings card render it (`UpdateController.view()`);
     * absent where no updater runs (a development or unpackaged build) */
    update: UpdateView.optional(),
    /** BP-1c — the desk browser, as Settings › General's Browsing data card says it (`DesktopBrowserSignIns`); absent
     * from a shell older than BP-1c, where the card says nothing of it. Never a path: the log names the folders. */
    browser: z.object({ signIns: DesktopBrowserSignIns }).passthrough().optional(),
    /** Item 212 (RV #29) — the field service for the attached pair (`FielddLinkUnavailable`), said on the window's
     * status line: null while it is up or coming up; absent from a shell older than item 212, which the window reads
     * as unknown and says nothing of. */
    fieldd: FielddLinkUnavailable.nullable().optional(),
    /** Item 315 — a person's quit has gone ahead: true from the quit gate's hold until its release, so the window
     * ignores a switch or a new user pressed meanwhile. Absent from a shell older than item 315, which the window reads
     * as not quitting. */
    quitting: z.boolean().optional(),
  })
  .passthrough();
export type DesktopShellState = z.infer<typeof DesktopShellState>;

/** D29′ app section: user-scoped desktop preferences live in the same settings
 * document as other spine preferences. The daemon returns effective values so
 * every caller applies the same defaults. */
export const APP_PREFERENCE_KEYS = {
  SHOW_TRAY: "desktop.showTray",
  BACKGROUND_SHELL: "desktop.backgroundShell",
  SCREENSHOT_HOTKEY: "desktop.screenshotHotkey",
  MESH_SYNC_POSTURE: "mesh.syncPosture",
  /** AL-3 — a quit that would end terminal sessions asks first (`quit-gate.ts`); the box's "Do not ask again" turns it
   * off, Settings turns it back on */
  CONFIRM_QUIT: "desktop.confirmQuit",
  /** TS-4 (TS-D7) — the one switch in Settings → Devices that stops the asks to
   * connect after Not now; on until the person turns it off */
  CONNECT_ASKS: "mesh.connectAsks",
  /** AL-6 (AL-D2, §5.8) — macOS: a person's quit closes the windows and keeps VibeField in the menu bar, its terminal
   * service running; the status item's Quit VibeField is the quit. Off until the person turns it on */
  KEEP_RUNNING_ON_QUIT: "desktop.keepRunningOnQuit",
  /** SD-2 (SD-D19; DESIGN.md §8 "Settings → Sound") — Play sounds: on from the first run, the person's, so off on each
   * of their desktops */
  SOUNDS: "desktop.sounds",
  /** SD-2 (SD-D22; DESIGN.md §14 "Quiet") — the moment Quiet ends, in epoch milliseconds; null ends it now. It rides
   * the same settings doc as every preference, so the person's desktops go quiet together */
  SOUNDS_QUIET_UNTIL: "desktop.soundsQuietUntil",
} as const;

export const AppPreferenceKey = z.enum([
  APP_PREFERENCE_KEYS.SHOW_TRAY,
  APP_PREFERENCE_KEYS.BACKGROUND_SHELL,
  APP_PREFERENCE_KEYS.SCREENSHOT_HOTKEY,
  APP_PREFERENCE_KEYS.MESH_SYNC_POSTURE,
  APP_PREFERENCE_KEYS.CONFIRM_QUIT,
  APP_PREFERENCE_KEYS.CONNECT_ASKS,
  APP_PREFERENCE_KEYS.KEEP_RUNNING_ON_QUIT,
  APP_PREFERENCE_KEYS.SOUNDS,
  APP_PREFERENCE_KEYS.SOUNDS_QUIET_UNTIL,
]);
export type AppPreferenceKey = z.infer<typeof AppPreferenceKey>;

/** UA-D7 — what a doc that has said nothing means by its silence. `automatic`
 * is today's behavior and stays the default; `opt-in` makes every doc local
 * until its owner says otherwise. User-scope: it rides the settings doc and
 * converges across the user's devices (D29′), unlike per-doc intent. */
export const MeshSyncPosture = z.enum(["automatic", "opt-in"]);
export type MeshSyncPosture = z.infer<typeof MeshSyncPosture>;

export const AppPreferences = z
  .object({
    showTray: z.boolean(),
    backgroundShell: z.boolean(),
    // SNAP-1: global by default, including snapshots from an older daemon.
    screenshotHotkey: z.boolean().default(true),
    syncPosture: MeshSyncPosture,
    // AL-3: on by default, including snapshots from an older daemon.
    confirmQuit: z.boolean().default(true),
    // TS-4: on by default, including snapshots from an older daemon.
    connectAsks: z.boolean().default(true),
    // AL-6: off by default, including snapshots from an older daemon.
    keepRunningOnQuit: z.boolean().default(false),
    // SD-2 (SD-D19): on by default, including snapshots from an older daemon.
    sounds: z.boolean().default(true),
    // SD-2 (SD-D22): OPTIONAL, never required — absent is no Quiet, as an older daemon's snapshot says. An integer
    // count of epoch milliseconds; Quiet holds while now is before it, and ends by itself at it.
    soundsQuietUntil: z.number().int().nonnegative().optional(),
  })
  .passthrough();
export type AppPreferences = z.infer<typeof AppPreferences>;

export const AppPreferenceSetParams = z
  .object({
    key: AppPreferenceKey,
    // Not every preference is a switch any more (UA-6): the posture is a word,
    // and Quiet (SD-2) a moment, or null to end it.
    // A union rather than `z.any()` — the setter still refuses what no key can hold.
    value: z.union([z.boolean(), MeshSyncPosture, z.number().int().nonnegative(), z.null()]),
  })
  .passthrough()
  .refine(
    ({ key, value }) =>
      key === APP_PREFERENCE_KEYS.MESH_SYNC_POSTURE
        ? typeof value === "string"
        : key === APP_PREFERENCE_KEYS.SOUNDS_QUIET_UNTIL
          ? typeof value === "number" || value === null
          : typeof value === "boolean",
    "preference value does not match its key",
  );

// SD-2 (DESIGN.md §14 "Where it plays", §8 "Settings → Sound") — what the window and main trade about sound, over
// IPC_CHANNELS.soundAttention, .soundPreview and .soundState. The cues are the family's ids in `@vibefield/sound`,
// written out here because contracts imports nothing of it (both are zero-dependency roots).

/** The attention door's bounds: one id's length, and the most places one window shows. */
export const SOUND_ATTENTION = {
  MAX_ID: 256,
  MAX_PLACES: 64,
} as const;

const SoundSessionId = z.string().min(1).max(SOUND_ATTENTION.MAX_ID);

/** Which floor session the person is typing into (none while the window lacks the keyboard), and where each shown
 * session sits across the window, −1 (left) … 1 (right). Main maps sessions to runs (`terminal.runtimeSessionId`). */
export const SoundAttention = z
  .object({
    focused: SoundSessionId.nullable(),
    places: z.record(SoundSessionId, z.number().min(-1).max(1)),
  })
  .passthrough()
  .refine(
    ({ places }) => Object.keys(places).length <= SOUND_ATTENTION.MAX_PLACES,
    "more places than a window shows",
  );
export type SoundAttention = z.infer<typeof SoundAttention>;

/** What a Play in Settings may play: the family, never the mark (SD-D18). */
export const SoundPreviewCue = z.enum(["failed", "done", "question", "approval", "settle"]);
export type SoundPreviewCue = z.infer<typeof SoundPreviewCue>;

export const SoundPreviewParams = z.object({ cue: SoundPreviewCue }).passthrough();
export type SoundPreviewParams = z.infer<typeof SoundPreviewParams>;

/** Played, or why not: Play sounds is off, there is no player, or the system refused the file. */
export const SoundPreviewResult = z.union([
  z.object({ played: z.literal(true) }).passthrough(),
  z
    .object({ played: z.literal(false), reason: z.enum(["off", "unavailable", "failed"]) })
    .passthrough(),
]);
export type SoundPreviewResult = z.infer<typeof SoundPreviewResult>;

/** Whether this Mac can play the sounds: ready, or off macOS, a build without the player, or one it would not
 * start (§8 says each in the switch's own line). */
export const SoundPlayerState = z.enum(["ready", "unsupported", "missing", "failed"]);
export type SoundPlayerState = z.infer<typeof SoundPlayerState>;
export type AppPreferenceSetParams = z.infer<typeof AppPreferenceSetParams>;

// AH-3 — the static Electron-main provider. These are ProductAPI contracts,
// not renderer IPC: main registers on its existing authenticated shell link,
// receives bounded notifications, and resolves them on the same connection.

export const SHELL_CLIENT_PROVIDER_METHODS = [
  "shell.dialog.pickFolder",
  "shell.openExternal",
] as const;
export const SHELL_INTERNAL_PROVIDER_METHODS = [
  "shell.webcontents.captureArtifactPreview",
  "shell.renderer.requestReplacement",
  // DT-1 (thinking-devtools-pack.md DT-D2) — the live-surface authority doors.
  // Internal like the capture door: only fieldd's SurfaceService dispatches
  // them, with an explicit fieldd caller; no client reaches them directly.
  "shell.surfaces.enumerate",
  "shell.surfaces.mint",
  "shell.surfaces.release",
  // PT-S2 (R11) — the attach's device list (`surface.simulator.devices`): this
  // Mac's simulator devices, REDACTED to the ids a binding is made of. Internal
  // like its siblings: only the SurfaceService dispatches it.
  "shell.surfaces.simulatorDevices",
  // The Agents settings section — show a path in the OS file manager. Internal:
  // only fieldd's agent service dispatches it, for a path its own inventory
  // holds; no caller hands main a path to reveal. GT-7: the terminal service
  // dispatches it too, for the overlay path the floor itself reports.
  "shell.revealPath",
  // GT-7 — Settings → Terminal's Import file… and Export…: a native open or
  // save dialog, each locked to one purpose. Internal: only fieldd's terminal
  // service dispatches them, and fieldd — not main — reads or writes the file.
  "shell.dialog.pickFile",
  "shell.dialog.saveFile",
  // GT-8a (GT-D22) — a terminal link's web half: an http(s) URL to the
  // default browser. Internal: only fieldd's `terminal.link.open` dispatches
  // it, after its own policy has classified the link, so main opens exactly
  // what that policy sends. `shell.openExternal` keeps its HTTPS-only rule for
  // the callers that rely on it.
  "shell.openLink",
] as const;
export const SHELL_PROVIDER_METHODS = [
  ...SHELL_CLIENT_PROVIDER_METHODS,
  ...SHELL_INTERNAL_PROVIDER_METHODS,
] as const;

export const ShellProviderMethod = z.enum(SHELL_PROVIDER_METHODS);
export type ShellProviderMethod = z.infer<typeof ShellProviderMethod>;
export const ShellClientProviderMethod = z.enum(SHELL_CLIENT_PROVIDER_METHODS);
export type ShellClientProviderMethod = z.infer<typeof ShellClientProviderMethod>;
export const ShellInternalProviderMethod = z.enum(SHELL_INTERNAL_PROVIDER_METHODS);
export type ShellInternalProviderMethod = z.infer<typeof ShellInternalProviderMethod>;

export const ARTIFACT_PREVIEW_LIMITS = {
  WIDTH: 640,
  HEIGHT: 400,
  JPEG_BYTES: 256 * 1024,
  DEADLINE_MS: 8_000,
  JPEG_QUALITIES: [82, 70, 55, 40],
} as const;

export const ShellDialogPickFolderParams = z
  .object({ purpose: z.enum(["artifact.publish", "workspace.export"]) })
  .passthrough();
export type ShellDialogPickFolderParams = z.infer<typeof ShellDialogPickFolderParams>;

const ShellAbsoluteFolderPath = z
  .string()
  .min(1)
  .max(4096)
  .refine(isAbsoluteDesktopPath, "expected an absolute desktop folder path");

const ShellAbsolutePath = z
  .string()
  .min(1)
  .max(4096)
  .refine(isAbsoluteDesktopPath, "expected an absolute desktop path");

export const ShellDialogPickFolderResult = z.union([
  z.object({ canceled: z.literal(true) }).passthrough(),
  z.object({ canceled: z.literal(false), path: ShellAbsoluteFolderPath }).passthrough(),
]);
export type ShellDialogPickFolderResult = z.infer<typeof ShellDialogPickFolderResult>;

export const ShellExternalUrl = z
  .string()
  .min(1)
  .max(2048)
  .superRefine((raw, ctx) => {
    if (
      raw !== raw.trim() ||
      !raw.startsWith("https://") ||
      raw.includes("\\") ||
      Array.from(raw).some((character) => {
        const codePoint = character.codePointAt(0);
        return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
      })
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "expected an unambiguous absolute HTTPS URL",
      });
      return;
    }
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "expected an absolute HTTPS URL" });
      return;
    }
    if (url.protocol !== "https:") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "only HTTPS URLs may open externally" });
    }
    if (url.username !== "" || url.password !== "") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "URL credentials are forbidden" });
    }
  });
export type ShellExternalUrl = z.infer<typeof ShellExternalUrl>;

export const ShellOpenExternalParams = z.object({ url: ShellExternalUrl }).passthrough();
export type ShellOpenExternalParams = z.infer<typeof ShellOpenExternalParams>;

export const ShellOpenExternalResult = z.object({ opened: z.literal(true) }).passthrough();
export type ShellOpenExternalResult = z.infer<typeof ShellOpenExternalResult>;

/** GT-D22 — link text holding nothing a URL parser would silently repair or
 * drop: whitespace, control characters, invisible format characters (a
 * zero-width space inside a host is erased by the parser, so `exa\u200Bmple.com`
 * opens example.com), and backslashes (read as `/` in some parts of a URL and
 * kept in others). Each is a place where what a person saw and what opens can
 * differ, so a link carrying one is refused rather than repaired. */
export function isUnambiguousLinkText(raw: string): boolean {
  return !/[\s\p{Cc}\p{Cf}\\]/u.test(raw);
}

/** GT-8a (GT-D22) — the link `shell.openLink` hands the default browser: an
 * `http:` or `https:` URL with a host and no credentials, in the URL
 * standard's own spelling (fieldd's `terminal.link.open` spells it so before
 * it asks), unambiguous as above, and bounded like the terminal's own links.
 * Wider than `ShellExternalUrl` by exactly `http:` — the link a terminal
 * prints most is a dev server on localhost — and kept apart from it, because
 * `shell.openExternal`'s callers rely on HTTPS-only. A hostless http(s) URL
 * never parses, so "a host" is the parser's rule before it is this one's. */
export const ShellLinkUrl = z
  .string()
  .min(1)
  .max(TERMINAL_LINK_MAX_CHARS)
  .superRefine((raw, ctx) => {
    if (!/^https?:\/\//u.test(raw) || !isUnambiguousLinkText(raw)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "expected an unambiguous absolute http(s) URL",
      });
      return;
    }
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "expected an absolute http(s) URL" });
      return;
    }
    if (url.href !== raw) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "expected the URL in its canonical spelling",
      });
    }
    if (url.username !== "" || url.password !== "") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "URL credentials are forbidden" });
    }
  });
export type ShellLinkUrl = z.infer<typeof ShellLinkUrl>;

export const ShellOpenLinkParams = z.object({ url: ShellLinkUrl }).passthrough();
export type ShellOpenLinkParams = z.infer<typeof ShellOpenLinkParams>;

export const ShellOpenLinkResult = z.object({ opened: z.literal(true) }).passthrough();
export type ShellOpenLinkResult = z.infer<typeof ShellOpenLinkResult>;

/** GT-7 — a native open dialog for one file, locked to one purpose. */
export const ShellDialogPickFileParams = z
  .object({ purpose: z.literal("terminal.config.import") })
  .passthrough();
export type ShellDialogPickFileParams = z.infer<typeof ShellDialogPickFileParams>;

export const ShellDialogPickFileResult = z.union([
  z.object({ canceled: z.literal(true) }).passthrough(),
  z.object({ canceled: z.literal(false), path: ShellAbsolutePath }).passthrough(),
]);
export type ShellDialogPickFileResult = z.infer<typeof ShellDialogPickFileResult>;

/** A suggested file NAME for a save dialog — a bare basename, never a path. */
const ShellSuggestedFileName = z
  .string()
  .min(1)
  .max(255)
  .refine(
    (name) => !/[\\/\0]/.test(name) && name !== "." && name !== "..",
    "expected a bare file name",
  );

/** GT-7 — a native save dialog, locked to one purpose; `defaultName` is only
 * the name the dialog proposes. */
export const ShellDialogSaveFileParams = z
  .object({
    purpose: z.literal("terminal.config.export"),
    defaultName: ShellSuggestedFileName,
  })
  .passthrough();
export type ShellDialogSaveFileParams = z.infer<typeof ShellDialogSaveFileParams>;

export const ShellDialogSaveFileResult = z.union([
  z.object({ canceled: z.literal(true) }).passthrough(),
  z.object({ canceled: z.literal(false), path: ShellAbsolutePath }).passthrough(),
]);
export type ShellDialogSaveFileResult = z.infer<typeof ShellDialogSaveFileResult>;

/** An absolute path on this device, as fieldd's own inventory named it. */
export const ShellRevealPathParams = z.object({ path: ShellAbsolutePath }).passthrough();
export type ShellRevealPathParams = z.infer<typeof ShellRevealPathParams>;

export const ShellRevealPathResult = z.object({ revealed: z.literal(true) }).passthrough();
export type ShellRevealPathResult = z.infer<typeof ShellRevealPathResult>;

/** The exact root-authority form returned by an AH Truffle listener. The
 * ArtifactService additionally proves this is the local intent's own last
 * published URL before dispatch; Electron independently rejects any broader
 * URL so a compromised daemon call cannot turn capture into a web crawler. */
export const ShellArtifactPreviewUrl = z
  .string()
  .min(1)
  .max(ARTIFACT_LIMITS.URL_CHARS)
  .superRefine((raw, ctx) => {
    const match =
      /^https:\/\/([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.ts\.net):(\d{5})\/?$/.exec(
        raw,
      );
    const hostname = match?.[1];
    const portText = match?.[2];
    const port = Number(portText);
    if (
      match === null ||
      hostname === undefined ||
      hostname.length > 253 ||
      portText === undefined ||
      !Number.isInteger(port) ||
      String(port) !== portText ||
      port < ARTIFACT_LIMITS.LISTEN_PORT_MIN ||
      port > ARTIFACT_LIMITS.LISTEN_PORT_MAX
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "expected a canonical root Artifact Hub HTTPS URL",
      });
    }
  });
export type ShellArtifactPreviewUrl = z.infer<typeof ShellArtifactPreviewUrl>;

/** MA-1a (MA-D10 (b); the build plan's §2.3 and L11) — a made app's capture photographs the page as it runs, so its
 * guard must admit what the page loads besides its own origin. `allowHosts` names those hosts: the union of the
 * export's `environment.hosts`, as data (MA-L9). Each is a BARE canonical DNS name (`MadeAppReachHost`: no scheme, no
 * port, no wildcard, no IP literal, no tailnet name), at most MADE_APP_LIMITS.REACH_HOSTS, and the guard admits HTTPS
 * to exactly those hosts on their default port, beside the target's own origin. Absent (every live artifact's capture):
 * the target's origin alone, as before. `artifactId` stays a ULID: a made app's capture is keyed by the preview id
 * fieldd mints for it (`MadeAppPreviewId`), so the capture's folder rule is unchanged. */
export const ShellWebContentsCaptureArtifactPreviewParams = z
  .object({
    artifactId: ArtifactId,
    url: ShellArtifactPreviewUrl,
    allowHosts: MadeAppReach.optional(),
  })
  .passthrough();
export type ShellWebContentsCaptureArtifactPreviewParams = z.infer<
  typeof ShellWebContentsCaptureArtifactPreviewParams
>;

/** MA-1a (MA-D10 (b)) — `digest` is the SHA-256 of the JPEG the capture wrote, lowercase hex: the key every device
 * keeps a made app's preview by (`MadeAppPreview.digest`). Optional, because a shell that predates MA-3c answers
 * without it; fieldd then has no preview to stamp on a made app's row, and a live artifact's capture never needs one. */
export const ShellWebContentsCaptureArtifactPreviewResult = z
  .object({
    captured: z.literal(true),
    title: ArtifactTitle.optional(),
    digest: Sha256Hex.optional(),
  })
  .passthrough();
export type ShellWebContentsCaptureArtifactPreviewResult = z.infer<
  typeof ShellWebContentsCaptureArtifactPreviewResult
>;

/** PRC-5f: fieldd may ask Electron to terminate one exact renderer generation
 * after an update phase deadline. `requested` is NOT death evidence; only the
 * later Electron render-process-gone event can retire the coordinator member. */
export const ShellRendererRequestReplacementParams = z
  .object({
    rendererParticipant: RendererParticipantIdentity,
    reason: z.literal("plugin-update-deadline"),
  })
  .strict();
export type ShellRendererRequestReplacementParams = z.infer<
  typeof ShellRendererRequestReplacementParams
>;

export const ShellRendererRequestReplacementResult = z.object({ requested: z.boolean() }).strict();
export type ShellRendererRequestReplacementResult = z.infer<
  typeof ShellRendererRequestReplacementResult
>;

// DT-1 — the live-surface authority (thinking-devtools-pack.md DT-D2). fieldd
// is the policy door (scopes/audit/idempotency on `surface.*`); these shapes
// carry the mechanism half into Electron main, which owns producers and the
// one-use ticket table. LSF-D6/D14: no caller-supplied identifier becomes
// authority — the renderer participant comes from fieldd's own token
// derivation (PRC-D14), and `owner` is log provenance, never authority.

export const SURFACE_AUTHORITY_LIMITS = {
  ENUMERATE_DEADLINE_MS: 5_000,
  MINT_DEADLINE_MS: 10_000,
  RELEASE_DEADLINE_MS: 5_000,
  /** PT-S2: one `simctl list --json` (main's own bound is 8 s), after the Xcode probe that precedes every simctl (5 s, on a
   * cold service) — above main's worst case, 13 s, by an IPC margin, so a slow CoreSimulator's answer is never discarded. */
  SIMULATOR_DEVICES_DEADLINE_MS: 15_000,
} as const;

export const ShellSurfacesEnumerateParams = z
  .object({ kind: SurfaceEnumerationKindV1 })
  .passthrough();
export type ShellSurfacesEnumerateParams = z.infer<typeof ShellSurfacesEnumerateParams>;

export const ShellSurfacesEnumerateResult = z
  .object({
    sources: z.array(SurfaceSourceDescriptorV1).max(SURFACE_LIMITS.MAX_ENUMERATED_SOURCES),
  })
  .passthrough();
export type ShellSurfacesEnumerateResult = z.infer<typeof ShellSurfacesEnumerateResult>;

export const ShellSurfacesMintParams = z
  .object({
    rendererParticipant: RendererParticipantIdentity,
    source: LiveSurfaceSourceSpecV1,
    reuseKey: SurfaceReuseKeyV1.optional(),
    owner: z.object({ pluginId: PluginId.optional() }).passthrough().optional(),
  })
  .passthrough();
export type ShellSurfacesMintParams = z.infer<typeof ShellSurfacesMintParams>;

export const ShellSurfacesMintResult = z
  .object({ surfaceId: LiveSurfaceIdV1, ticket: LiveSurfaceAttachTicketV1 })
  .passthrough();
export type ShellSurfacesMintResult = z.infer<typeof ShellSurfacesMintResult>;

export const ShellSurfacesReleaseParams = z
  .object({ surfaceId: LiveSurfaceIdV1, rendererParticipant: RendererParticipantIdentity })
  .passthrough();
export type ShellSurfacesReleaseParams = z.infer<typeof ShellSurfacesReleaseParams>;

export const ShellSurfacesReleaseResult = z.object({ released: z.boolean() }).passthrough();
export type ShellSurfacesReleaseResult = z.infer<typeof ShellSurfacesReleaseResult>;

/** PT-S2 (R11) — the attach's device list asks nothing: no window, no participant (a list of what this Mac holds binds
 * no authority, and the row's `surface.capture` is the whole gate). */
export const ShellSurfacesSimulatorDevicesParams = z.object({}).passthrough();
export type ShellSurfacesSimulatorDevicesParams = z.infer<
  typeof ShellSurfacesSimulatorDevicesParams
>;

/** PT-S2 (R11) — this Mac's simulator devices, the booted first, REDACTED at main's boundary to the row (a UDID on a
 * row is refused here too: it can never reach fieldd, let alone a window). Empty: no Simulator here, or none of its
 * devices. With them the runtimes installed here, the newest first (ids only): the attach's third pick. */
export const ShellSurfacesSimulatorDevicesResult = z
  .object({
    devices: z.array(LiveSurfaceSimulatorDeviceRowV1).max(SURFACE_LIMITS.MAX_SIMULATOR_DEVICES),
    runtimes: z
      .array(CoreSimulatorRuntimeIdV1)
      .max(SURFACE_LIMITS.MAX_SIMULATOR_RUNTIMES)
      .optional(),
  })
  .passthrough();
export type ShellSurfacesSimulatorDevicesResult = z.infer<
  typeof ShellSurfacesSimulatorDevicesResult
>;

export const ShellProviderRegisterParams = z
  .object({ methods: z.array(ShellProviderMethod).min(1).max(SHELL_PROVIDER_METHODS.length) })
  .passthrough()
  .superRefine((value, ctx) => {
    if (new Set(value.methods).size !== value.methods.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["methods"], message: "duplicate method" });
    }
  });
export type ShellProviderRegisterParams = z.infer<typeof ShellProviderRegisterParams>;

export const ShellProviderRegisterResult = z
  .object({
    registered: z
      .array(ShellProviderMethod)
      .length(SHELL_PROVIDER_METHODS.length)
      .superRefine((methods, ctx) => {
        const registered = new Set(methods);
        if (
          registered.size !== SHELL_PROVIDER_METHODS.length ||
          !SHELL_PROVIDER_METHODS.every((method) => registered.has(method))
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "expected the exact enabled shell provider method set",
          });
        }
      }),
  })
  .passthrough();
export type ShellProviderRegisterResult = z.infer<typeof ShellProviderRegisterResult>;

export const ShellProviderCaller = z
  .object({
    // tailnet-guest is total-type honesty, not a reachable path: the UA-4
    // guest choke refuses every method before a handler could dial a provider
    kind: z.enum([
      "local-token",
      "shell-main",
      "tailnet",
      "tailnet-guest",
      "mcp-agent",
      "peer-fieldd",
      "plugin",
    ]),
    pluginId: PluginId.optional(),
    clientKind: ClientKind.optional(),
  })
  .passthrough();
export type ShellProviderCaller = z.infer<typeof ShellProviderCaller>;

export const ShellProviderCallParams = z
  .object({
    callId: z.string().regex(/^shell-[A-Za-z0-9_-]{16,64}$/),
    method: ShellProviderMethod,
    params: z.unknown(),
    caller: ShellProviderCaller,
    deadlineAt: z.number().int().nonnegative().safe(),
  })
  .passthrough();
export type ShellProviderCallParams = z.infer<typeof ShellProviderCallParams>;

export const ShellProviderError = z
  .object({
    kind: ErrorKind,
    message: z.string().min(1).max(256),
    retryable: z.boolean().default(false),
  })
  .passthrough();
export type ShellProviderError = z.infer<typeof ShellProviderError>;

export const ShellProviderOutcome = z.union([
  z.object({ error: ShellProviderError, result: z.never().optional() }).passthrough(),
  z
    .object({
      result: z.unknown().refine((value) => value !== undefined, "result is required"),
      error: z.never().optional(),
    })
    .passthrough(),
]);
export type ShellProviderOutcome = z.infer<typeof ShellProviderOutcome>;

export const ShellProviderResolveParams = z
  .object({
    callId: z.string().regex(/^shell-[A-Za-z0-9_-]{16,64}$/),
    outcome: ShellProviderOutcome,
  })
  .passthrough();
export type ShellProviderResolveParams = z.infer<typeof ShellProviderResolveParams>;

export const ShellProviderResolveResult = z.object({ accepted: z.boolean() }).passthrough();
export type ShellProviderResolveResult = z.infer<typeof ShellProviderResolveResult>;

export const ShellProviderCancelParams = z
  .object({ callId: z.string().regex(/^shell-[A-Za-z0-9_-]{16,64}$/) })
  .passthrough();
export type ShellProviderCancelParams = z.infer<typeof ShellProviderCancelParams>;
