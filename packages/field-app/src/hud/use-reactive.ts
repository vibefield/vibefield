import type { CanvasEngine, Resource } from "@vibecook/ice";
import { useCallback, useSyncExternalStore } from "react";

// Chrome reads as REAL engine subscriptions (the 3b amendment): strata's
// reactive layer fires at engine.step()'s world.reactive.notify() — once per
// frame, at a settled point, and only for stamps that actually changed
// (Tier-3 observeResource / Tier-1 observeQuery). ICE's own React hooks
// (useTool et al) are exactly this pattern, and the r3f reflectors already
// armed the layer at engine construction — a chrome subscription adds zero
// marginal cost. Hidden windows pause FOR FREE: no rAF → no step → no
// notify. This replaces the paced chrome ticker 6711a17 introduced (deleted
// — the reactive layer is strictly stronger: event-driven AND
// visibility-correct by construction).
//
// The one non-subscription survivor is the session's framing retry: a
// BOUNDED interval on the loading path, visibility-EXEMPT by law (§5.4.5) —
// a hidden boot must still present.

// Resource's second generic is field-spec plumbing ICE exports no name for
// (FieldInput/FieldSpec are strata-internal); the alias erases it so callers
// pass any concrete resource (ActiveTool, Camera, …) and S still infers.
// biome-ignore lint/suspicious/noExplicitAny: the meta parameter has no exported name to constrain by.
type AnyResource<S> = Resource<S, any>;

/** Subscribe a PRIMITIVE projection of a world resource. The snapshot is a
 * string/number/boolean, so useSyncExternalStore's Object.is gate suppresses
 * re-renders (a Camera pan re-fires the observer; an unchanged zoom percent
 * re-renders nothing). `select` must be module-stable — an inline closure
 * would resubscribe every render. */
export function useReactiveResource<S, T extends string | number | boolean>(
  ce: CanvasEngine,
  resource: AnyResource<S>,
  select: (value: S | undefined) => T,
): T {
  const subscribe = useCallback(
    (onChange: () => void) => ce.world.reactive.observeResource(resource, onChange),
    [ce, resource],
  );
  const read = useCallback(() => select(ce.world.getResource(resource)), [ce, resource, select]);
  return useSyncExternalStore(subscribe, read, read);
}
