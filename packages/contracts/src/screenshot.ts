import { z } from "zod";

// SNAP-D2 — the native screenshot helper's one-line stdout protocol, and the
// shell's answer to a caller. Wire-only: nothing here names Electron, Node, a
// child process or a clipboard. The helper (Swift on macOS, Rust on Windows)
// writes ONE JSON object per line to stdout; Electron main reads it through
// `@vibefield/screenshot`. TS-only by design — never in the Rust gen bundle:
// field-native has no reader, and the Windows helper keeps its own serde shape,
// pinned by the SAME fixtures under packages/contracts/fixtures (EL9 in three
// languages: zod here, the Swift test harness, the Rust crate's tests).

export const SCREENSHOT_HELPER_PROTOCOL_VERSION = 1 as const;

export const SCREENSHOT_LIMITS = {
  /** The helper must have its overlay on screen — and have said `ready` —
   * within this budget. The Windows capture chain (WGC → DXGI → GDI) budgets
   * 12 s on its own, which is why this is not smaller. */
  PRE_OVERLAY_TIMEOUT_MS: 20_000,
  /** Longest stdout line the host buffers before calling the helper broken. */
  MAX_LINE_BYTES: 64 * 1024,
  /** A still wider or taller than this is not a screenshot. */
  MAX_DIMENSION: 16_384,
  /** Backing scale (macOS) or DPI ÷ 96 (Windows); nothing real exceeds 8. */
  MAX_SCALE: 8,
  MAX_PATH_CHARS: 4_096,
  MAX_MESSAGE_CHARS: 1_024,
  /** How many finished stills the host keeps on disk before unlinking the
   * oldest (SNAP-D4 — the still is a file and the clipboard, nothing more). */
  RETAINED_STILLS: 12,
} as const;

/** The helper's command-line vocabulary — spelled once, spawned from here. */
export const SCREENSHOT_HELPER_ARGS = {
  /** Capture now, overlay, print ONE result line, exit (the host's mode). */
  once: "--once",
  /** No overlay: a PNG per display under the OS temp dir, `ok` names the first. */
  captureTest: "--capture-test",
} as const;

function hasNoControlCharacters(value: string): boolean {
  return ![...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });
}

const ScreenshotFinite = z.number().finite();

/** The selection in the display's native screen coordinates — points with a
 * bottom-left, display-relative origin on macOS; virtual-screen physical pixels
 * (an origin may be negative) on Windows. Informational, never authority. */
export const ScreenshotBounds = z
  .object({
    x: ScreenshotFinite,
    y: ScreenshotFinite,
    width: ScreenshotFinite.nonnegative(),
    height: ScreenshotFinite.nonnegative(),
  })
  .passthrough();
export type ScreenshotBounds = z.infer<typeof ScreenshotBounds>;

/** An absolute path the helper wrote the PNG to. Both slash conventions are
 * real (the Windows helper answers `C:\…`); control characters are not. */
export const ScreenshotStillPath = z
  .string()
  .min(1)
  .max(SCREENSHOT_LIMITS.MAX_PATH_CHARS)
  .refine(hasNoControlCharacters, "control characters are forbidden in a still path");
export type ScreenshotStillPath = z.infer<typeof ScreenshotStillPath>;

const ScreenshotMessage = z
  .string()
  .min(1)
  .max(SCREENSHOT_LIMITS.MAX_MESSAGE_CHARS)
  .refine(hasNoControlCharacters, "control characters are forbidden in a message");

const ScreenshotPixelDimension = z.number().int().positive().max(SCREENSHOT_LIMITS.MAX_DIMENSION);
const ScreenshotScale = ScreenshotFinite.positive().max(SCREENSHOT_LIMITS.MAX_SCALE);
/** CGDirectDisplayID on macOS, the `\\.\DISPLAYN` index on Windows: a u32. */
const ScreenshotDisplayId = z.number().int().nonnegative().max(0xffff_ffff);

/** Why the helper could not answer with a still. Typed at the source (the
 * prototype's host classified free text with a regex). */
export const ScreenshotHelperErrorCode = z.enum([
  "permission-denied",
  "capture-failed",
  "no-displays",
  "write-failed",
]);
export type ScreenshotHelperErrorCode = z.infer<typeof ScreenshotHelperErrorCode>;

const ProtocolVersion = z.literal(SCREENSHOT_HELPER_PROTOCOL_VERSION);

/** Printed once the overlays are on screen; lifts the host's pre-overlay timer. */
export const ScreenshotHelperReady = z
  .object({ v: ProtocolVersion, status: z.literal("ready") })
  .passthrough();
export type ScreenshotHelperReady = z.infer<typeof ScreenshotHelperReady>;

/** The still exists at `path` (PNG) and is on the clipboard. `width`/`height`
 * are PNG pixels. */
export const ScreenshotHelperOk = z
  .object({
    v: ProtocolVersion,
    status: z.literal("ok"),
    path: ScreenshotStillPath,
    width: ScreenshotPixelDimension,
    height: ScreenshotPixelDimension,
    scale: ScreenshotScale,
    displayId: ScreenshotDisplayId,
    bounds: ScreenshotBounds,
  })
  .passthrough();
export type ScreenshotHelperOk = z.infer<typeof ScreenshotHelperOk>;

export const ScreenshotHelperCancel = z
  .object({ v: ProtocolVersion, status: z.literal("cancel") })
  .passthrough();
export type ScreenshotHelperCancel = z.infer<typeof ScreenshotHelperCancel>;

export const ScreenshotHelperError = z
  .object({
    v: ProtocolVersion,
    status: z.literal("error"),
    code: ScreenshotHelperErrorCode,
    message: ScreenshotMessage,
  })
  .passthrough();
export type ScreenshotHelperError = z.infer<typeof ScreenshotHelperError>;

/** Every line the helper may print. `status` is the discriminant; `v` is the
 * version every line carries so a future shape can announce itself. */
export const ScreenshotHelperEvent = z.discriminatedUnion("status", [
  ScreenshotHelperReady,
  ScreenshotHelperOk,
  ScreenshotHelperCancel,
  ScreenshotHelperError,
]);
export type ScreenshotHelperEvent = z.infer<typeof ScreenshotHelperEvent>;

// ---- the shell's answer -------------------------------------------------------

/** The helper's own codes plus what only the HOST can know. */
export const ScreenshotErrorCode = z.enum([
  ...ScreenshotHelperErrorCode.options,
  /** no helper exists for this platform (SNAP-D5 — present, disabled, honest) */
  "unsupported-platform",
  /** a helper should exist here and does not (a development tree before its
   * first `build:screenshot-helper`, or an incomplete stage) */
  "helper-missing",
  /** one capture at a time; the overlay is modal by nature */
  "busy",
  "helper-spawn-failed",
  /** no `ready` inside SCREENSHOT_LIMITS.PRE_OVERLAY_TIMEOUT_MS */
  "helper-timeout",
  /** the process ended without a terminal line */
  "helper-exited",
  /** a stdout line the contract does not admit */
  "helper-protocol",
  /** the host disposed the tool while a capture was live (app quit) */
  "disposed",
]);
export type ScreenshotErrorCode = z.infer<typeof ScreenshotErrorCode>;

export const ScreenshotCaptureOk = z
  .object({
    status: z.literal("ok"),
    path: ScreenshotStillPath,
    width: ScreenshotPixelDimension,
    height: ScreenshotPixelDimension,
    scale: ScreenshotScale,
    displayId: ScreenshotDisplayId,
    bounds: ScreenshotBounds,
  })
  .passthrough();
export type ScreenshotCaptureOk = z.infer<typeof ScreenshotCaptureOk>;

export const ScreenshotCaptureCancel = z.object({ status: z.literal("cancel") }).passthrough();
export type ScreenshotCaptureCancel = z.infer<typeof ScreenshotCaptureCancel>;

export const ScreenshotCaptureError = z
  .object({
    status: z.literal("error"),
    code: ScreenshotErrorCode,
    message: ScreenshotMessage,
  })
  .passthrough();
export type ScreenshotCaptureError = z.infer<typeof ScreenshotCaptureError>;

/** What `window.vibefield.screenshot.capture()` resolves with, and what the
 * View ▸ Take Screenshot action logs. Validated on both sides of the seam. */
export const ScreenshotCaptureResult = z.discriminatedUnion("status", [
  ScreenshotCaptureOk,
  ScreenshotCaptureCancel,
  ScreenshotCaptureError,
]);
export type ScreenshotCaptureResult = z.infer<typeof ScreenshotCaptureResult>;

/** renderer → main. Empty today; tolerant so a later `{ mode }` is additive. */
export const ScreenshotCaptureRequest = z.object({}).passthrough();

/** SNAP-3 — the shell-owned scheme a retained still is SHOWN through. The
 * renderer's CSP admits no file access and EL2 keeps bytes off JSON-RPC, so a
 * still reaches an `<img>` by a scheme main serves from its own retained
 * list, by basename — the page never names a path. The spelling is wire
 * truth: the CSP, the scheme registration, the handler and the URL a tile
 * shows all read it here. */
export const SCREENSHOT_STILL_SCHEME = "vibefield-still";
/** The ONLY host the still scheme serves. */
export const SCREENSHOT_STILL_HOST = "stills";
export const SCREENSHOT_STILL_ORIGIN = `${SCREENSHOT_STILL_SCHEME}://${SCREENSHOT_STILL_HOST}`;

/** The final component of a still path under either slash convention (the
 * contract admits both) — the name the scheme matches a request against. */
export function screenshotStillBasename(path: string): string {
  const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return cut < 0 ? path : path.slice(cut + 1);
}

/** The URL a renderer shows a retained still through. PURE. */
export function screenshotStillUrl(path: string): string {
  return `${SCREENSHOT_STILL_ORIGIN}/${encodeURIComponent(screenshotStillBasename(path))}`;
}
export type ScreenshotCaptureRequest = z.infer<typeof ScreenshotCaptureRequest>;
