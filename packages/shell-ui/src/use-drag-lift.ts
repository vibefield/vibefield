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
 * Chrome-grade 60ms poll, no ECS writes (CardShell's pattern, hoisted).
 */
import {
  Captures,
  ChromeSettings,
  Drag,
  type Entity,
  GesturePhases,
  Grab,
  HadSequence,
  type World,
} from "@vibecook/ice";
import { useEffect, useState } from "react";

function armedByHold(world: World, entity: Entity): boolean {
  for (const rec of world.getReverse(entity, Captures)) {
    if (!world.has(rec, Drag) || !world.hasTag(rec, HadSequence)) continue;
    if (
      world.hasTag(rec, GesturePhases.tags.Possible) ||
      world.hasTag(rec, GesturePhases.tags.Active)
    ) {
      return true;
    }
  }
  return false;
}

export function useDragLift(world: World, entity: Entity): { lifted: boolean; scale: number } {
  const [lifted, setLifted] = useState(false);
  useEffect(() => {
    const id = setInterval(() => {
      setLifted(world.has(entity, Grab) || armedByHold(world, entity));
    }, 60); // snappy — the lift must read as an immediate response to the hold
    return () => clearInterval(id);
  }, [world, entity]);
  return { lifted, scale: world.getResource(ChromeSettings)?.liftScale ?? 1.05 };
}
