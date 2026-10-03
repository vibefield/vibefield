import { z } from "zod";
import { ARTIFACT_LIMITS, ArtifactId, ArtifactTitle } from "./artifacts";
import { ClientKind, SemverString } from "./envelope";
import { ErrorKind } from "./errors";
import {
  LiveSurfaceAttachTicketV1,
  LiveSurfaceIdV1,
  LiveSurfaceSourceSpecV1,
  SURFACE_LIMITS,
  SurfaceEnumerationKindV1,
  SurfaceReuseKeyV1,
  SurfaceSourceDescriptorV1,
} from "./live-surfaces";
import { isAbsoluteDesktopPath } from "./paths";
import { PluginId } from "./plugins";
import { ScreenshotShortcutState } from "./screenshot";
import { TERMINAL_LINK_MAX_CHARS } from "./terminal";

// Shell-boundary contracts (ESR spec §6.1): the shapes that cross the Electron
// seam — the daemon's on-disk discovery descriptor and the closed contextBridge
// IPC surface. TS-only by design (never in the Rust gen bundle): fieldd writes
// and Electron reads on the same machine. Channel names live in
// registries.IPC_CHANNELS. Contracts describe the wire that ships today; future
// controlUrl work remains additive to this envelope.

/** `<dataRoot>/fieldd/run/product.json` — written by fieldd on boot, read by the
 * shell/supervisor for adopt-or-spawn (design-02 §3.6/D10). Tolerant: future
 * daemons may add fields; readers must survive them. */
export const ProductInfo = z
  .object({
    /** actual bound control port (ephemeral in tests — never inferred, always read) */
    port: z.number().int().positive(),
    pid: z.number().int().positive(),
    bootId: z.string().min(1),
    contractsVersion: SemverString,
    startedAt: z.number(),
    /** pid of the field-native the daemon ensured; null when native is disabled */
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
export const ShellCommand = z.enum(["open-settings", "open-diagnostics"]);
export type ShellCommand = z.infer<typeof ShellCommand>;

export const ShellCommandRequest = z
  .object({
    command: ShellCommand,
  })
  .passthrough();
export type ShellCommandRequest = z.infer<typeof ShellCommandRequest>;

/** The frame's four views (One Frame FR-1; FC-D2, FV-D7), in the views
 * track's order. The canvas is the ground floor (FV-D1) and the others are
 * drawn as one cover over it. The Assistant's cell exists and waits: it is not
 * built, so no window is ever in it ({@link frameViewBuilt}). */
export const FrameView = z.enum(["canvas", "godview", "history", "assistant"]);
export type FrameView = z.infer<typeof FrameView>;

/** Whether a view can be the active one yet — every view but the Assistant
 * (FC-D2: its cell is drawn, faint, "not built yet"). Main refuses the rest,
 * and the frame says so instead of asking. */
export function frameViewBuilt(view: FrameView): boolean {
  return view !== "assistant";
}

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

/** Small host fact used only to describe platform-specific desktop behavior in
 * Settings. Unknown Electron platforms collapse to `other` at the preload
 * boundary rather than leaking Node's process object into the renderer. */
export const ShellPlatform = z.enum(["darwin", "win32", "linux", "other"]);
export type ShellPlatform = z.infer<typeof ShellPlatform>;

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
} as const;

export const AppPreferenceKey = z.enum([
  APP_PREFERENCE_KEYS.SHOW_TRAY,
  APP_PREFERENCE_KEYS.BACKGROUND_SHELL,
  APP_PREFERENCE_KEYS.SCREENSHOT_HOTKEY,
  APP_PREFERENCE_KEYS.MESH_SYNC_POSTURE,
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
  })
  .passthrough();
export type AppPreferences = z.infer<typeof AppPreferences>;

export const AppPreferenceSetParams = z
  .object({
    key: AppPreferenceKey,
    // Not every preference is a switch any more (UA-6): the posture is a word.
    // A union rather than `z.any()` — the setter still refuses what no key can hold.
    value: z.union([z.boolean(), MeshSyncPosture]),
  })
  .passthrough()
  .refine(
    ({ key, value }) =>
      key === APP_PREFERENCE_KEYS.MESH_SYNC_POSTURE
        ? typeof value === "string"
        : typeof value === "boolean",
    "preference value does not match its key",
  );
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
  .object({ purpose: z.literal("artifact.publish") })
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

export const ShellWebContentsCaptureArtifactPreviewParams = z
  .object({ artifactId: ArtifactId, url: ShellArtifactPreviewUrl })
  .passthrough();
export type ShellWebContentsCaptureArtifactPreviewParams = z.infer<
  typeof ShellWebContentsCaptureArtifactPreviewParams
>;

export const ShellWebContentsCaptureArtifactPreviewResult = z
  .object({ captured: z.literal(true), title: ArtifactTitle.optional() })
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
