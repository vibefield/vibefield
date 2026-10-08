import type { ThemePreference } from "@vibefield/contracts";
import { emitGodviewPerfLabMarker } from "../../../development-console";
import { type GodviewPerfProbe, installGodviewPerfProbe } from "./godview-perf-probe";
import { createReplayPlayer, type ReplayPlayer } from "./replay-player";
import { freezeWallClock, restoreWallClock, wallClockState } from "./wall-clock";

// THE LAB'S RENDERER BRIDGE (MV-0, step 6) — the two window globals the Electron
// lab (`electron-shell/src/testing/godview-perf-lab.ts`) drives over
// `executeJavaScript`, published ONLY when the renderer's URL carries
// `godviewPerf=1` (the renderer host checks; the lab's `loadRenderer` sets it).
// The same two objects feed `door-instruments.ts`'s model client and roster
// port, so a deck built before the lab loads a corpus hears the roster when it does.
//
//   window.__vfGodviewPerf    the probe: reset · report · observeStage
//   window.__vfGodviewReplay  the player: load · push · start · stop · state
//
// The capture bridge controls this lab's theme, animations and wall clock.
// The shipping window itself is the model witness; no second replica is installed.

export interface GodviewCaptureBridge {
  setTheme(preference: ThemePreference): Promise<void>;
  setAnimations(on: boolean): Promise<void>;
  freezeClock(wallMs: number): void;
  restoreClock(): void;
  clock(): { now: number; shifted: boolean };
}

declare global {
  interface Window {
    __vfGodviewPerf?: GodviewPerfProbe;
    __vfGodviewReplay?: ReplayPlayer;
    __vfGodviewCapture?: GodviewCaptureBridge;
  }
}

function createCaptureBridge(): GodviewCaptureBridge {
  return {
    async setTheme(preference) {
      const { setAppTheme } = await import("../../../theme");
      setAppTheme(preference);
    },
    async setAnimations(on) {
      const { getLabSwitches, setLabSwitches } = await import("../../lab-switches");
      setLabSwitches({ ...getLabSwitches(), animations: on });
    },
    freezeClock: (wallMs) => freezeWallClock(wallMs),
    restoreClock: () => restoreWallClock(),
    clock: () => wallClockState(),
  };
}

export const GODVIEW_PERF_PARAM = "godviewPerf";

let lab: { probe: GodviewPerfProbe; player: ReplayPlayer } | null = null;

/** Whether the URL asks for the lab (`godviewPerf=1`). */
export function godviewPerfLabRequested(search: string): boolean {
  return new URLSearchParams(search).get(GODVIEW_PERF_PARAM) === "1";
}

/** Install once; later calls return the same pair. */
export function installGodviewPerfLab(): { probe: GodviewPerfProbe; player: ReplayPlayer } {
  if (lab !== null) return lab;
  const probe = installGodviewPerfProbe();
  const player = createReplayPlayer();
  player.onMark((frame, at) => probe.mark(frame.name, at));
  lab = { probe, player };
  if (typeof window !== "undefined") {
    window.__vfGodviewPerf = probe;
    window.__vfGodviewReplay = player;
    window.__vfGodviewCapture = createCaptureBridge();
    emitGodviewPerfLabMarker({ installed: true });
  }
  return lab;
}

/** The lab's pair when one is installed. */
export function godviewPerfLab(): { probe: GodviewPerfProbe; player: ReplayPlayer } | null {
  return lab;
}

/** Test seam. */
export function resetGodviewPerfLabForTest(): void {
  lab?.player.stop();
  lab?.probe.dispose();
  lab = null;
  if (typeof window !== "undefined") {
    delete window.__vfGodviewPerf;
    delete window.__vfGodviewReplay;
    delete window.__vfGodviewCapture;
  }
}
