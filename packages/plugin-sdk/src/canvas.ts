// The canvas RENDER vocabulary, as SDK re-exports — the curated door to ICE
// (§11.3 forbids raw @vibecook/ice in plugins; §12.7's ctx.canvas shipped at P6 as the
// least-power stopgap that PA-27 retires). This list is the union of what the shipped plugins
// legitimately use to RENDER and to run their host-invoked commands: component
// read hooks, the widget component prop contract, island frame plumbing for GL
// cards, and the core symbols command functions read. The deep target
// (PluginWidgetProps — 03·A) replaces most of this; until then the door is
// explicit and additions are deliberate SDK changes.

export {
  CameraLimits,
  type CanvasEngine,
  ChildOf,
  type Entity,
  FIT_DEFAULTS,
  MeasuredSize,
  Position,
  PrefabId,
  Selected,
  Size,
  type SpawnWidgetOpts,
  selectedEntities,
  Viewport,
  // W1 (the mind map pack, 2026-08-13) — the wire vocabulary joins the door.
  // A mind map's edges ARE engine wires (design-001 §5.3: a Wire-tagged entity
  // carrying WirePorts + WireFrom/WireTo endpoint relations); without these a
  // plugin can neither create nor read an edge. Paved creation is
  // `tx.spawnPrefab(WirePrefab, [[WirePorts, {from, to}]])` + two setRelations —
  // the doc commit sink's own path. `widgetSpawnInits(type, opts)` builds the
  // Position/Size + whole-group prop inits for composite widget spawns
  // (spawnWidget's own helper, so the two can never diverge). This list is
  // PA-27 evidence: each name here is a place the curated tier must cover.
  type WidgetType,
  Wire,
  WireFrom,
  WirePorts,
  WirePrefab,
  WireTo,
  type World,
  widgetSpawnInits,
} from "@vibecook/ice";
export { useIslandFrame, useIslandInvalidate } from "@vibecook/ice/r3f";
export {
  useCommit,
  useOps,
  useWidgetProps,
  useWorldComponent,
  type WidgetComponentProps,
} from "@vibecook/ice/react";

import type { WidgetType } from "@vibecook/ice";
import { widgets } from "@vibecook/ice";
import { useCanvasEngine, useUndoStatus } from "@vibecook/ice/react";
import { useMemo } from "react";

/** Read-only lookup into the engine's widget catalog (the ShapesCard/TodoList
 * runtime-groups idiom). A read HELPER instead of re-exporting the raw global
 * registry map — plugins never hold the mutable catalog itself. */
export function getWidgetType(type: string): WidgetType | undefined {
  return widgets.get(type);
}

/** Engine undo for keyboard-claiming widgets (S3, the mind map pack,
 * 2026-08-13). Under an exclusive claim the engine keymap cedes EVERY chord —
 * ⌘Z/⇧⌘Z included (gate 2 of the widget input contract) — so the widget must
 * forward them itself. This is the sanctioned door: `docs.undo`/`docs.redo`,
 * the SAME stack every canvas edit rides. A curated wrapper, deliberately not
 * the raw CanvasEngine facade — plugins never hold the engine. Both triggers
 * return whether a step actually applied (the engine's own contract). */
export function useUndo(): {
  undo: () => boolean;
  redo: () => boolean;
  canUndo: boolean;
  canRedo: boolean;
} {
  const engine = useCanvasEngine();
  const { canUndo, canRedo } = useUndoStatus();
  return useMemo(
    () => ({
      undo: () => engine.docs.undo(),
      redo: () => engine.docs.redo(),
      canUndo,
      canRedo,
    }),
    [engine, canUndo, canRedo],
  );
}
