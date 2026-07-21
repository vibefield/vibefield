/**
 * useDragLift — ONE lift signal for every widgetlab widget (2026-07-18,
 * James: "let's unify this … so that all the widget in widgetlab has this
 * lift behavior and other demos won't need to have this").
 *
 * Deliberately APP-side: the lift LOOK (scale curve, shadow, dimming) is
 * theme chrome, and chrome is the app's concern (design-004) — an engine
 * DragLift would push v1's iOS look on every embedder. The engine's two
 * contributions stay engine-side and are consumed here:
 *  - the TRUTH: a live `Grab` rider, or the armed-hold state after a
 *    Sequence hand-off (iOS: the hold IS the "you can drag now" signal);
 *  - the NUMBER: ChromeSettings.liftScale (facade settings.chrome.liftScale)
 *    — the same value selectionChrome uses to keep the P4 union box wrapping
 *    lifted members, so CSS and chrome math cannot drift. Previously
 *    hardcoded 1.05 in CardShell AND GlLiftGroup.
 *
 * Change-driven projection, no ECS writes. DOM and GL consumers for the same
 * entity share one stable snapshot through chrome-projection.ts.
 */
import type { Entity, World } from "@vibecook/ice";
import { useProjectedDragLift } from "./chrome-projection";

export function useDragLift(world: World, entity: Entity): { lifted: boolean; scale: number } {
  return useProjectedDragLift(world, entity);
}
