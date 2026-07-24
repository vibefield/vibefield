import type { CanvasEngine } from "@vibecook/ice";

// The active-canvas-engine module ref (P6, spec §12.7 stopgap). ctx.canvas is
// the A2-tier STOPGAP (PA-27 supersedes it): a declared command needs to reach
// the engine that is mounted RIGHT NOW, but the engine is remounted per doc
// generation (use-workspace-session's ONE ENGINE PER DOC law) and plugin
// activation is process-permanent (P3c). A module ref bridges the two: the
// session publishes the live engine on create and clears it on teardown, and
// the command registry / ctx.canvas.engine() read it lazily at invoke time —
// never captured, so a stale post-switch engine is never handed out.
//
// null = no engine mounted (daemon-away boot before the first doc lands, or the
// gap between a doc switch's teardown and the next attach). Readers treat null
// as "no canvas — no-op honestly", never a throw.

let active: CanvasEngine | null = null;

/** Publish the engine the session just created (or clear it on teardown). The
 * session owns both calls; passing null on dispose keeps the ref from outliving
 * its engine (the stale-handle guard). */
export function setActiveCanvasEngine(engine: CanvasEngine | null): void {
  active = engine;
}

/** The engine mounted right now, or null. Read lazily — command handlers and
 * ctx.canvas.engine() call this at invoke time, so a doc switch that swapped
 * the engine is reflected immediately. */
export function getActiveCanvasEngine(): CanvasEngine | null {
  return active;
}
