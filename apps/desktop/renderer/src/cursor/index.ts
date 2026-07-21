/**
 * installCursorHalo — one call wires the halo into a live widgetlab canvas:
 * tick systems into their pointerlab-proven phase slots (react spawn,
 * simulate follow/morph, cleanup reap) + the overlay reflector on the
 * engine. Returns a disposer (unregisters everything, removes the DOM).
 * Halo ENTITIES are deliberately left alive on dispose: the engine outlives
 * the mount (StrictMode remount re-adds systems and the spawn dedupe —
 * reverse `Follows` — finds them again; destroying them here would just
 * churn).
 */
import type { CanvasEngine } from "@vibecook/ice";
import { createHaloOverlay } from "./overlay";
import { createHaloSystems } from "./systems";

export function installCursorHalo(ce: CanvasEngine, container: HTMLElement): () => void {
  const systems = createHaloSystems();
  const removers = [
    ce.engine.addSystems("react", systems.haloSpawn),
    ce.engine.addSystems("simulate", systems.haloFollower, systems.haloVisual),
    ce.engine.addSystems("cleanup", systems.haloReap),
  ];
  const overlay = createHaloOverlay(container);
  const unregister = ce.engine.registerReflector(overlay.reflector);
  return () => {
    unregister();
    overlay.dispose();
    for (const remove of removers) remove();
  };
}
