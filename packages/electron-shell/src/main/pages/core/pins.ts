// EY-1 (2026-11-19) — A CALL WINDOW'S PACING PINS (track EY; BU:427-430). A desktop page now renders at a capture
// scale of 1 or less, fitted to the pane's displayed pixels, and a paused page runs a 1 Hz compositor with painting
// stopped (browser-electron-native.ts:1031-1043; browser-producer.ts:3158-3164). Inside a call window the agent must
// meet the page at its own size, awake and painting: so a window pins scale 1 (a mobile page keeps its own: it lays
// itself out at its own width), lifts the frame rate to a floor (never past the transport's ceiling), and paints. At
// the window's close the page returns to the demand as it then stands, never to a value saved at open.
//
// The owner reads `pacingFor` at EVERY send, not once at open: its metrics are re-sent at each raster change, and a
// demand pause sets the frame rate and painting, inside a window as outside one. `pacingSteps` orders a change as the
// producer does (browser-producer.ts:2765-2767, :3163-3164): waking, frame rate, metrics, then painting; resting,
// metrics, frame rate, then painting. `device` re-sends the person's own device (browser-electron-native.ts:1066-1078)
// only when the journal's emulation row is non-empty, since a client's `Emulation.*` is refused (it acts on the page).
//
// Pure.

import {
  CALL_WINDOW_PINS,
  type CallWindowPins,
  type Pacing,
  type PacingDemand,
  type PacingStep,
} from "./types";

/** The page's pacing: the demand's own while no window is open; the pins' inside one. */
export function pacingFor(
  demand: PacingDemand,
  windowOpen: boolean,
  pins: CallWindowPins = CALL_WINDOW_PINS,
): Pacing {
  if (!windowOpen) {
    if (demand.mode === "paused") {
      return { captureScale: demand.captureScale, frameRate: demand.fps, painting: false };
    }
    return {
      captureScale: demand.captureScale,
      frameRate: Math.min(demand.fps, demand.maxFps),
      painting: true,
    };
  }
  return {
    captureScale: demand.mobile ? demand.captureScale : pins.captureScale,
    frameRate: Math.min(Math.max(demand.fps, pins.minFrameRate), demand.maxFps),
    painting: true,
  };
}

/** The owner's steps from one pacing to another, only for what differs (and `device` when the journal's emulation row
 * is non-empty), in the producer's order. */
export function pacingSteps(
  from: Pacing,
  to: Pacing,
  o?: { readonly emulationTouched?: boolean },
): readonly PacingStep[] {
  const frameRate: PacingStep[] =
    from.frameRate !== to.frameRate ? [{ kind: "frame-rate", fps: to.frameRate }] : [];
  const metrics: PacingStep[] =
    from.captureScale !== to.captureScale
      ? [{ kind: "metrics", captureScale: to.captureScale }]
      : [];
  const device: PacingStep[] = o?.emulationTouched === true ? [{ kind: "device" }] : [];
  const painting: PacingStep[] =
    from.painting !== to.painting ? [{ kind: "painting", on: to.painting }] : [];
  const resting = from.painting && !to.painting;
  return resting
    ? [...metrics, ...device, ...frameRate, ...painting]
    : [...frameRate, ...metrics, ...device, ...painting];
}
