import type { Splash } from "./vibefield-splash.js";

// The field held on one frame (track FG, FG-6's frozen frame; `docs/desk-gates.md` row 32): a harness holds the
// live field on its last frame to set the field's glass beside the browser's over the same pixels (DESIGN.md §8
// "Held to the browser's glass"). The vendored splash holds without a patch of its own: `stop()` ends its loop on
// the frame it last drew, and its redraw (the boot's `redraw` patch, `tooling/splash/patches.json`) draws that frame
// again, so a glass handed in meanwhile is drawn over the same field. `start(at)` runs it on from `at` seconds, a
// clock the splash keeps to itself, so the hold keeps its own, set when the field starts.

export interface FieldHold {
  /** Run the field from its start: under reduced motion its one frame at rest. */
  start(): void;
  /** Hold the field on the frame it last drew. */
  freeze(): void;
  /** Run the held field on from where it was held. */
  thaw(): void;
}

export function fieldHold(
  splash: Pick<Splash, "start" | "stop">,
  reducedMotion: boolean,
): FieldHold {
  let from = 0;
  let held: number | null = null;
  return {
    start() {
      from = performance.now();
      splash.start();
    },
    freeze() {
      if (held !== null) return;
      // under reduced motion the field never runs: it stands at rest, at its start
      held = reducedMotion ? 0 : (performance.now() - from) / 1000;
      splash.stop();
    },
    thaw() {
      if (held === null) return;
      const at = held;
      held = null;
      from = performance.now() - at * 1000;
      splash.start(at);
    },
  };
}
