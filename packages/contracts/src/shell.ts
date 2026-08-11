import { z } from "zod";
import { ARTIFACT_LIMITS, ArtifactId, ArtifactTitle } from "./artifacts";
import { ClientKind, SemverString } from "./envelope";
import { ErrorKind } from "./errors";
import { PluginId } from "./plugins";

// Shell-boundary contracts (ESR spec §6.1): the shapes that cross the Electron
// seam — the daemon's on-disk discovery descriptor and the closed contextBridge
// IPC surface. TS-only by design (never in the Rust gen bundle): fieldd writes
// and Electron reads on the same machine. Channel names live in
// registries.IPC_CHANNELS; slice 4's bootstrap semantics evolve WindowConnection
// into the WindowBootstrap envelope (controlUrl instead of a bare port) — until
// that wire exists, only today's shapes ship (contracts describe reality).

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

/** Reply to the window-bootstrap invoke: the loopback control endpoint + the
 * per-window scoped token (D27 — main brokers this once, relays nothing). */
export const WindowConnection = z
  .object({
    port: z.number().int().positive(),
    token: z.string().min(1), // opaque bearer token, same treatment as hello credential
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

/** main → renderer: whether THIS window's Godview overlay is open (GT-D2).
 *
 * Main owns this bit rather than the renderer because the toggle is answered
 * above the page: ⇧⇧ is detected in main before any renderer sees a keystroke,
 * so a renderer-owned flag would be a second copy that main must be told about
 * to keep its own menu honest. One owner, one truth, and the menu's checkmark
 * is a fact instead of a guess. */
export const GodviewState = z.object({ open: z.boolean() }).passthrough();
export type GodviewState = z.infer<typeof GodviewState>;

/** renderer → main: the toolbar button asking for the transition ⇧⇧ asks for.
 * `open` omitted means "flip whatever it is" — the button and the accelerator
 * are the same request, so neither can drift by holding its own idea of the
 * current value. */
export const GodviewSetRequest = z.object({ open: z.boolean().optional() }).passthrough();
export type GodviewSetRequest = z.infer<typeof GodviewSetRequest>;

/** Small host fact used only to describe platform-specific desktop behavior in
 * Settings. Unknown Electron platforms collapse to `other` at the preload
 * boundary rather than leaking Node's process object into the renderer. */
export const ShellPlatform = z.enum(["darwin", "win32", "linux", "other"]);
export type ShellPlatform = z.infer<typeof ShellPlatform>;

/** Main-owned desktop capability truth. Preferences describe user intent;
 * this state describes whether the native shell actually realized it. */
export const DesktopShellState = z
  .object({
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
  MESH_SYNC_POSTURE: "mesh.syncPosture",
} as const;

export const AppPreferenceKey = z.enum([
  APP_PREFERENCE_KEYS.SHOW_TRAY,
  APP_PREFERENCE_KEYS.BACKGROUND_SHELL,
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
  .passthrough();
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
  .refine(
    (path) =>
      !path.includes("\0") &&
      (path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path) || /^\\\\[^\\/]+[\\/]/.test(path)),
    "expected an absolute desktop folder path",
  );

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
