import { z } from "zod";
import { VITALS_CAPTURES } from "./registries";

// VT-5 (track VT, 2026-11-24; VT-D5, VT-D9, VT-D12 A; DESIGN.md §8 "Vitals", "Captures") — THE ARMED CAPTURES. The
// recorder is cheap on purpose: one reading a second, no frame counted, no profiler. A person chasing something arms
// a deep capture by hand from the Vitals window; it runs one length from a closed list and switches itself off.
//
//   trace     a Chromium trace of the whole app (Electron main's `contentTracing`), a `.json` Perfetto opens;
//   profile   a CPU profile of fieldd, taken from INSIDE it (`node:inspector`'s in-process session: no debugging
//             port is ever opened), a `.cpuprofile` Chrome's DevTools open;
//   frames    the desk's window counts its own frames for the length, a small `.json`.
//
// One capture at a time, for the whole app: Electron main holds the one in hand and refuses a second. The files are
// this device's (`LAYOUT.VITALS_CAPTURES_DIR`), the newest `VITALS_CAPTURES.KEEP`, sent nowhere. A trace can hold the
// addresses and titles of the pages open in the app; the window says so beside the control.
//
// The window holds no fieldd token (EL7): it asks main, over its own preload, and main checks every field here.

const count = () => z.number().int().nonnegative();
const unixMs = () => z.number().int().nonnegative();

export const VITALS_CAPTURE_KINDS = ["trace", "profile", "frames"] as const;
export const VitalsCaptureKind = z.enum(VITALS_CAPTURE_KINDS);
export type VitalsCaptureKind = z.infer<typeof VitalsCaptureKind>;

/** A length from `VITALS_CAPTURES.SECONDS`, and nothing else. */
export const VitalsCaptureSeconds = z
  .number()
  .int()
  .refine((seconds) => (VITALS_CAPTURES.SECONDS as readonly number[]).includes(seconds), {
    message: "a capture runs 10, 20 or 30 seconds",
  });
export type VitalsCaptureSeconds = (typeof VITALS_CAPTURES.SECONDS)[number];

/** Why a capture was not made, from a closed list the window words (DESIGN.md §9 "Vitals' words"):
 *  - busy — another capture is running;
 *  - no-fieldd — fieldd is not attached, or did not answer in time;
 *  - no-desk — the desk's window is not open;
 *  - cut-short — it ended before its time (the desk's page went away, the window closed, the app quit);
 *  - not-saved — it ran, and its file could not be written;
 *  - not-started — the tool it needs refused to begin. */
export const VITALS_CAPTURE_FAILURES = [
  "busy",
  "no-fieldd",
  "no-desk",
  "cut-short",
  "not-saved",
  "not-started",
] as const;
export const VitalsCaptureFailure = z.enum(VITALS_CAPTURE_FAILURES);
export type VitalsCaptureFailure = z.infer<typeof VitalsCaptureFailure>;

// ---------------------------------------------------------------------------------------------------------------
// The files
// ---------------------------------------------------------------------------------------------------------------

const EXTENSION: Readonly<Record<VitalsCaptureKind, string>> = {
  trace: ".json",
  profile: ".cpuprofile",
  frames: ".json",
};

/** `<kind>-<UTC stamp to the millisecond>.<ext>`, e.g. `trace-20261124T101500123Z.json`: fixed width, so names sort
 * by time. */
const NAME = /^(trace|profile|frames)-(\d{8}T\d{9}Z)(\.json|\.cpuprofile)$/;
export const VITALS_CAPTURE_NAME_MAX = 48;

/** A capture file's name: its kind and when it began. */
export function vitalsCaptureName(kind: VitalsCaptureKind, at: number): string {
  const stamp = new Date(at).toISOString().replace(/[-:.]/g, "");
  return `${kind}-${stamp}${EXTENSION[kind]}`;
}

/** What a name says, or null when it is not a capture's own name (a path, a stranger's file, a temporary). */
export function parseVitalsCaptureName(
  name: string,
): { kind: VitalsCaptureKind; stamp: string } | null {
  if (name.length > VITALS_CAPTURE_NAME_MAX) return null;
  const match = NAME.exec(name);
  if (match === null) return null;
  const kind = match[1] as VitalsCaptureKind;
  if (EXTENSION[kind] !== match[3]) return null;
  return { kind, stamp: match[2] as string };
}

/** THE ONE RETENTION RULE, whoever wrote the newest file: of the captures' own names in the folder, the newest `keep`
 * stay and the rest are named for removal. A name that is not a capture's own is never named. */
export function vitalsCapturesToRemove(
  names: readonly string[],
  keep: number = VITALS_CAPTURES.KEEP,
): string[] {
  const own = names
    .map((name) => ({ name, parsed: parseVitalsCaptureName(name) }))
    .filter((entry) => entry.parsed !== null)
    .sort((a, b) =>
      a.parsed?.stamp === b.parsed?.stamp
        ? a.name.localeCompare(b.name)
        : (a.parsed?.stamp ?? "") < (b.parsed?.stamp ?? "")
          ? -1
          : 1,
    );
  return own.slice(0, Math.max(0, own.length - Math.max(0, keep))).map((entry) => entry.name);
}

export const VitalsCaptureFileName = z
  .string()
  .max(VITALS_CAPTURE_NAME_MAX)
  .refine((name) => parseVitalsCaptureName(name) !== null, {
    message: "a capture's own file name",
  });

// ---------------------------------------------------------------------------------------------------------------
// The desk window's frame count
// ---------------------------------------------------------------------------------------------------------------

/** What the desk's window counted while armed. An interval of `FRAME_GAP_MS` or more is a window that was not drawing
 * (hidden, asleep): it is a `gap`, never a frame.
 *  - `frames` — frames drawn; `seconds` — the span they were counted over;
 *  - `meanFps` — frames a second over the span, gaps left out; absent with no frame;
 *  - `longestMs` — the longest frame; absent with no frame;
 *  - `slowFrames` — frames over `FRAME_BUDGET_MS` (a 60 Hz frame); `longFrames` — over `FRAME_LONG_MS`. */
export const VitalsFrameCountV1 = z
  .object({
    frames: count().max(VITALS_CAPTURES.FRAMES_MAX),
    seconds: z.number().nonnegative().max(60),
    meanFps: z.number().nonnegative().max(1_000).optional(),
    longestMs: z.number().nonnegative().optional(),
    slowFrames: count().max(VITALS_CAPTURES.FRAMES_MAX),
    longFrames: count().max(VITALS_CAPTURES.FRAMES_MAX),
    gaps: count(),
  })
  .passthrough();
export type VitalsFrameCountV1 = z.infer<typeof VitalsFrameCountV1>;

const requestId = () => z.string().min(1).max(VITALS_CAPTURES.REQUEST_ID_MAX);

/** main → the desk window's preload (`VITALS_CAPTURE_CHANNELS.frameCount`). */
export const VitalsFrameCountRequest = z
  .object({ requestId: requestId(), seconds: VitalsCaptureSeconds })
  .passthrough();
export type VitalsFrameCountRequest = z.infer<typeof VitalsFrameCountRequest>;

/** the desk window's preload → main (`VITALS_CAPTURE_CHANNELS.frameCountResult`): the count, or why there is none. */
export const VitalsFrameCountReply = z
  .object({
    requestId: requestId(),
    count: VitalsFrameCountV1.optional(),
    refused: z.literal("busy").optional(),
  })
  .passthrough();
export type VitalsFrameCountReply = z.infer<typeof VitalsFrameCountReply>;

/** The saved count's file. */
export const VitalsFrameCountFileV1 = VitalsFrameCountV1.extend({
  v: z.literal(1),
  kind: z.literal("frames"),
  /** when the count was armed, unix ms */
  at: unixMs(),
}).passthrough();
export type VitalsFrameCountFileV1 = z.infer<typeof VitalsFrameCountFileV1>;

// ---------------------------------------------------------------------------------------------------------------
// fieldd's profile door (product, local; scope `vitals.report`, Electron main alone)
// ---------------------------------------------------------------------------------------------------------------

/** `vitals.profile.capture` — profile fieldd from inside for `seconds`, then answer. One at a time. */
export const VitalsProfileCaptureParams = z.object({ seconds: VitalsCaptureSeconds }).passthrough();
export type VitalsProfileCaptureParams = z.infer<typeof VitalsProfileCaptureParams>;

/** The written `.cpuprofile`: its name in the captures folder (never a path), its size, and how many samples V8
 * took. */
export const VitalsProfileCaptureResult = z
  .object({
    name: VitalsCaptureFileName,
    bytes: count(),
    seconds: VitalsCaptureSeconds,
    samples: count().optional(),
  })
  .passthrough();
export type VitalsProfileCaptureResult = z.infer<typeof VitalsProfileCaptureResult>;

// ---------------------------------------------------------------------------------------------------------------
// The Vitals window ↔ main
// ---------------------------------------------------------------------------------------------------------------

/** The capture as the window sees it. */
export const VitalsCaptureState = z.discriminatedUnion("state", [
  z.object({ state: z.literal("idle") }).passthrough(),
  z
    .object({
      state: z.literal("running"),
      kind: VitalsCaptureKind,
      seconds: VitalsCaptureSeconds,
      /** when it is due to end, unix ms: the window counts down to it */
      endsAt: unixMs(),
    })
    .passthrough(),
  z
    .object({
      state: z.literal("saved"),
      kind: VitalsCaptureKind,
      seconds: VitalsCaptureSeconds,
      name: VitalsCaptureFileName,
      bytes: count(),
      frames: VitalsFrameCountV1.optional(),
      samples: count().optional(),
    })
    .passthrough(),
  z
    .object({ state: z.literal("failed"), kind: VitalsCaptureKind, reason: VitalsCaptureFailure })
    .passthrough(),
]);
export type VitalsCaptureState = z.infer<typeof VitalsCaptureState>;

/** `VITALS_CAPTURE_CHANNELS.arm` */
export const VitalsCaptureArmParams = z
  .object({ kind: VitalsCaptureKind, seconds: VitalsCaptureSeconds })
  .passthrough();
export type VitalsCaptureArmParams = z.infer<typeof VitalsCaptureArmParams>;

export const VitalsCaptureArmResult = z
  .object({ accepted: z.boolean(), reason: VitalsCaptureFailure.optional() })
  .passthrough();
export type VitalsCaptureArmResult = z.infer<typeof VitalsCaptureArmResult>;

/** `VITALS_CAPTURE_CHANNELS.reveal` — a name, never a path: main joins it to the captures folder itself. */
export const VitalsCaptureRevealParams = z.object({ name: VitalsCaptureFileName }).passthrough();
export type VitalsCaptureRevealParams = z.infer<typeof VitalsCaptureRevealParams>;

export const VitalsCaptureRevealResult = z.object({ revealed: z.boolean() }).passthrough();
export type VitalsCaptureRevealResult = z.infer<typeof VitalsCaptureRevealResult>;
