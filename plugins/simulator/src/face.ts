// THE HONEST FACES (the PT-S design §3; DESIGN.md §9 "The simulator's honest faces") — what the phone's screen says of its
// device, read off its live face: the host's word for the state (the SDK's `liveSimulatorFace` — `LiveInfo.extra.simulator`),
// and, where a host says no word, the face's own coarse state (`LiveState`). Pure: the words (quoted EXACTLY from DESIGN.md
// §9 — test/design.test.ts reads that table), the act each state offers, and how the screen draws it — the stream, a still
// at the pane's two dims (0.7; 0.16 under words) with its mark, or the dark panel with the words alone. A still is never
// passed off as live. WHAT SETS a state is the host's producer (PT-S2); the kind only shows it.

import {
  type LiveInfo,
  type LiveSimulatorFace,
  type LiveSimulatorState,
  type LiveState,
  liveSimulatorFace,
} from "@vibefield/plugin-sdk/desk";
import { PHONE, type PhoneLaw } from "./law";
import type { MarkName } from "./layout";

/** Each state's line (DESIGN.md §9, verbatim) — `device` the device's name; null: the state says nothing. */
export const FACE_LINES: Readonly<Record<LiveSimulatorState, ((device: string) => string) | null>> =
  {
    "no-simulator": () => "The iOS Simulator isn't on this Mac",
    "no-permission": () => "VibeField needs Screen Recording to show the Simulator",
    "no-device": (device) => `There's no ${device} on this Mac`,
    off: (device) => `${device} is off`,
    booting: null,
    "no-window": () => "The Simulator's window is closed",
    live: null,
    "at-rest": null,
    stopped: () => "The Simulator stopped",
  };

/** Each state's act (DESIGN.md §9, verbatim): the capsule's word — null: it offers none. */
export const FACE_ACTS: Readonly<Record<LiveSimulatorState, string | null>> = {
  "no-simulator": null,
  "no-permission": "Open Settings",
  "no-device": "Create it",
  off: "Boot",
  booting: null,
  "no-window": "Show it",
  live: null,
  "at-rest": null,
  stopped: "Try again",
};

/** What a state shows of the screen: the stream, the device's last still, or nothing (the dark panel). */
export const FACE_SHOWS: Readonly<Record<LiveSimulatorState, "stream" | "still" | "none">> = {
  "no-simulator": "none",
  "no-permission": "none",
  "no-device": "none",
  off: "still",
  booting: "still",
  "no-window": "still",
  live: "stream",
  "at-rest": "still",
  stopped: "still",
};

/** The mark a state's still carries (DESIGN.md §5.1): the boot mark while it boots, the rest mark at rest. */
export const FACE_MARKS: Readonly<Record<LiveSimulatorState, MarkName>> = {
  "no-simulator": "none",
  "no-permission": "none",
  "no-device": "none",
  off: "none",
  booting: "boot",
  "no-window": "none",
  live: "none",
  "at-rest": "rest",
  stopped: "none",
};

/** The VIEW-ONLY word the held bar says (DESIGN.md §9): the phone takes no tap, key or button until PT-S4's touch lands. */
export const VIEW_ONLY = "View only";

/** How the screen draws a face: its state, whether the texture shows, how bright, its mark, its words and its act. */
export interface FacePlan {
  /** The state shown — undefined: nothing to say (no face yet, or a face starting with nothing in it). */
  readonly state: LiveSimulatorState | undefined;
  /** Whether the face's texture is shown (the stream, or its last still). */
  readonly frame: boolean;
  /** 1 the stream; `display.still` a still; `display.stillUnder` a still under words. */
  readonly brightness: number;
  readonly mark: MarkName;
  /** The face's line, or null. */
  readonly line: string | null;
  /** The act's word and the act itself — offered only where the host can run it. */
  readonly act: { readonly label: string; readonly run: () => void } | null;
}

/** No face: the dark panel, nothing said. */
export const NO_FACE: FacePlan = {
  state: undefined,
  frame: false,
  brightness: 1,
  mark: "none",
  line: null,
  act: null,
};

/**
 * The state a face is in: the host's word when it says one (the SDK's `liveSimulatorFace`); else its coarse state — `live`
 * live, `paused` at rest, `failed` stopped (the face's own retry its act), and `starting` or `closed` nothing to say yet.
 */
export function faceState(
  info: Pick<LiveInfo, "extra"> | undefined,
  state: LiveState,
): { readonly face: LiveSimulatorFace; readonly retry?: () => void } | undefined {
  const said = liveSimulatorFace(info);
  if (said !== undefined) return { face: said };
  if (state.is === "live") return { face: { is: "live" } };
  if (state.is === "paused") return { face: { is: "at-rest" } };
  if (state.is === "failed")
    return state.retry === undefined
      ? { face: { is: "stopped" } }
      : { face: { is: "stopped" }, retry: state.retry };
  return undefined;
}

/**
 * How the screen draws a face (the PT-S design §3, the pane's laws): `device` the name to say (the host's word for it, else
 * the bound device type's name — a face is planned only for a bound phone), `texture` whether the face holds a frame to
 * show. A still shows only where the face holds one; words over a still dim it to 0.16, a mark over it to 0.7; the act is
 * offered only where it can be run.
 */
export function facePlan(
  info: Pick<LiveInfo, "extra"> | undefined,
  state: LiveState,
  device: string,
  texture: boolean,
  law: PhoneLaw = PHONE,
): FacePlan {
  const read = faceState(info, state);
  if (read === undefined) return NO_FACE;
  const { face } = read;
  const is = face.is;
  const name = face.device ?? device;
  const line = FACE_LINES[is]?.(name) ?? null;
  const label = FACE_ACTS[is];
  const run = face.act ?? read.retry;
  const shows = FACE_SHOWS[is];
  const frame = texture && shows !== "none";
  return {
    state: is,
    frame,
    brightness: shows === "stream" ? 1 : line !== null ? law.display.stillUnder : law.display.still,
    mark: frame ? FACE_MARKS[is] : "none",
    line,
    act: label !== null && run !== undefined ? { label, run } : null,
  };
}
