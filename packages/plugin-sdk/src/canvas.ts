// The canvas RENDER vocabulary, as SDK re-exports — the curated door to ICE
// (§11.3 forbids raw @vibecook/ice in plugins; §12.7's ctx.canvas mutation
// tier arrives at P4). This list is the union of what the shipped plugins
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
  selectedEntities,
  Viewport,
  type WidgetType,
  type World,
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

/** Read-only lookup into the engine's widget catalog (the ShapesCard/TodoList
 * runtime-groups idiom). A read HELPER instead of re-exporting the raw global
 * registry map — plugins never hold the mutable catalog itself. */
export function getWidgetType(type: string): WidgetType | undefined {
  return widgets.get(type);
}
