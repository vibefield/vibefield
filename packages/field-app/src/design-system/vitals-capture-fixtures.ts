import type { VitalsCaptureProps } from "../vitals/VitalsCapture";
import { VITALS_FIXTURE_END } from "./vitals-fixtures";

// VT-5 (track VT, 2026-11-24) — the capture control's fixture states (docs/UI_SYSTEM.md): what the Vitals window's
// host would say, one a plate. Fixed values, no clock: a plate is the same every run. The control, its words and its
// CSS are the product's.

type CaptureState = VitalsCaptureProps["state"];

export const VITALS_CAPTURE_FIXTURE_STATES = [
  "capture-idle",
  "capture-running",
  "capture-saved",
  "capture-failed",
] as const;
export type VitalsCaptureFixtureState = (typeof VITALS_CAPTURE_FIXTURE_STATES)[number];

const STATES: Readonly<Record<VitalsCaptureFixtureState, CaptureState>> = {
  // nothing armed yet, App trace chosen: the trace's line says what a trace holds
  "capture-idle": { state: "idle" },
  "capture-running": {
    state: "running",
    kind: "trace",
    seconds: 20,
    endsAt: VITALS_FIXTURE_END + 12_000,
  },
  "capture-saved": {
    state: "saved",
    kind: "frames",
    seconds: 10,
    name: "frames-20261124T140700000Z.json",
    bytes: 214,
    frames: {
      frames: 581,
      seconds: 10.02,
      meanFps: 58,
      longestMs: 41.2,
      slowFrames: 12,
      longFrames: 2,
      gaps: 0,
    },
  },
  "capture-failed": { state: "failed", kind: "profile", reason: "no-fieldd" },
};

const ignore = (): void => undefined;

/** The control's props for a plate: its state, the seconds a running one has left, and intents that go nowhere. */
export function vitalsCaptureFixture(state: VitalsCaptureFixtureState): VitalsCaptureProps {
  return {
    state: STATES[state],
    ...(state === "capture-running" ? { secondsLeft: 12 } : {}),
    initialKind: state === "capture-saved" ? "frames" : "trace",
    onArm: ignore,
    onReveal: ignore,
  };
}
