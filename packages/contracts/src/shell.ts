import { z } from "zod";
import { SemverString } from "./envelope";

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
} as const;

export const AppPreferenceKey = z.enum([
  APP_PREFERENCE_KEYS.SHOW_TRAY,
  APP_PREFERENCE_KEYS.BACKGROUND_SHELL,
]);
export type AppPreferenceKey = z.infer<typeof AppPreferenceKey>;

export const AppPreferences = z
  .object({
    showTray: z.boolean(),
    backgroundShell: z.boolean(),
  })
  .passthrough();
export type AppPreferences = z.infer<typeof AppPreferences>;

export const AppPreferenceSetParams = z
  .object({
    key: AppPreferenceKey,
    value: z.boolean(),
  })
  .passthrough();
export type AppPreferenceSetParams = z.infer<typeof AppPreferenceSetParams>;
