import type { ThemePreference } from "@vibefield/contracts";
import { emitGodviewPerfLabMarker } from "../../../development-console";
import type { GodviewMonitorFeed } from "../model-replica";
import { type GodviewPerfProbe, installGodviewPerfProbe } from "./godview-perf-probe";
import { createReplayPlayer, type ReplayPlayer } from "./replay-player";
import { freezeWallClock, restoreWallClock, wallClockState } from "./wall-clock";

// THE LAB'S RENDERER BRIDGE (MV-0, step 6) — the two window globals the Electron
// lab (`electron-shell/src/testing/godview-perf-lab.ts`) drives over
// `executeJavaScript`, published ONLY when the renderer's URL carries
// `godviewPerf=1` (the renderer host checks; the lab's `loadRenderer` sets it).
// The same two objects feed `door-instruments.ts`'s replay door, so a deck built
// before the lab loads a corpus still hears the roster when it does.
//
//   window.__vfGodviewPerf    the probe: reset · report · observeStage
//   window.__vfGodviewReplay  the player: load · push · start · stop · state
//
// MV-3c adds two more, as dormant as these:
//
//   window.__vfGodviewModelWitness  a SECOND window adapter over the model
//       replay (`createGodviewMonitorFeed`, the window's own code), and a check
//       that its replica's rows are the stream's rows as delivered. A proof for
//       a build whose window does not read the model yet; never in a gate run
//       (it doubles the replica's work).
//   window.__vfGodviewCapture  what a deterministic capture needs from inside:
//       the app's theme, the stage's ambient animations, and a frozen clock.
//
// Both reach the window adapter and the app's theme by dynamic import: the
// door's instruments import this module, so a static edge back would be a cycle.

/** The witness's verdict: the replica's rows against the stream's, window-only
 * joins aside, compared key-order-blind. */
export interface ModelWitnessCheck {
  open: boolean;
  state: string;
  rows: number;
  expected: number;
  equal: boolean;
  mismatched: string[];
  missing: string[];
  extra: string[];
  revision: number;
}

export interface ModelWitness {
  open(): Promise<{ state: string }>;
  check(): ModelWitnessCheck;
  close(): void;
}

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
    __vfGodviewModelWitness?: ModelWitness;
    __vfGodviewCapture?: GodviewCaptureBridge;
  }
}

/** Keys sorted all the way down: two rows built in different orders compare. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, held: unknown) =>
    held !== null && typeof held === "object" && !Array.isArray(held)
      ? Object.fromEntries(
          Object.entries(held as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)),
        )
      : held,
  );
}

const VIEW_ONLY = new Set(["colour", "active", "receded", "attachment", "spawnHint"]);

function createModelWitness(): ModelWitness {
  let feed: GodviewMonitorFeed | null = null;
  let replay: import("./model-replay-client").ModelReplayClient | null = null;
  return {
    async open() {
      if (feed === null) {
        const [{ createGodviewMonitorFeed }, { godviewModelReplay }] = await Promise.all([
          import("../model-replica"),
          import("./door-instruments"),
        ]);
        replay = godviewModelReplay();
        feed = createGodviewMonitorFeed({ client: replay });
        await new Promise((settled) => setTimeout(settled, 0));
      }
      return { state: feed.state().state };
    },
    check() {
      if (feed === null || replay === null) {
        return {
          open: false,
          state: "closed",
          rows: 0,
          expected: 0,
          equal: false,
          mismatched: [],
          missing: [],
          extra: [],
          revision: 0,
        };
      }
      const board = replay.current();
      const here = board.devices[0]?.device;
      const expected = new Map<string, string>();
      for (const device of board.devices) {
        for (const row of device.snapshot?.rows ?? []) {
          const model = row.monitorRow;
          if (model === undefined) continue;
          expected.set(
            model.id,
            canonical({ ...model, device: { ...model.device, self: model.device.id === here } }),
          );
        }
      }
      const model = feed.replica.getSnapshot().model;
      const mismatched: string[] = [];
      const extra: string[] = [];
      for (const view of model.agents) {
        const want = expected.get(view.id);
        if (want === undefined) {
          extra.push(view.id);
          continue;
        }
        const row = Object.fromEntries(Object.entries(view).filter(([key]) => !VIEW_ONLY.has(key)));
        if (canonical(JSON.parse(JSON.stringify(row))) !== want) mismatched.push(view.id);
      }
      const missing = [...expected.keys()].filter((id) => !model.byId.has(id));
      return {
        open: true,
        state: feed.state().state,
        rows: model.agents.length,
        expected: expected.size,
        equal: mismatched.length === 0 && missing.length === 0 && extra.length === 0,
        mismatched: mismatched.slice(0, 5),
        missing: missing.slice(0, 5),
        extra: extra.slice(0, 5),
        revision: model.revision,
      };
    },
    close() {
      feed?.dispose();
      feed = null;
    },
  };
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
export const GODVIEW_REPLAY_PARAM = "godviewReplay";

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
    window.__vfGodviewModelWitness = createModelWitness();
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
  lab?.probe.dispose();
  lab = null;
  if (typeof window !== "undefined") {
    window.__vfGodviewModelWitness?.close();
    delete window.__vfGodviewPerf;
    delete window.__vfGodviewReplay;
    delete window.__vfGodviewModelWitness;
    delete window.__vfGodviewCapture;
  }
}
