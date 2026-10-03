// CONTROL FIXTURE — the WIDGET is correct; its state fixtures are not.
//
// This card renders anything the engine hands it, so every red row this plugin
// produces is the fixture's fault. That is the distinction the runner has to be
// able to make: `state-invalid` (your fixture contradicts your declaration)
// diagnoses, `state-render-failed` (your component threw) only describes.

import { defineRendererPlugin } from "@vibefield/plugin-sdk";
import { type Entity, useWidgetProps, type World } from "@vibefield/plugin-sdk/canvas";
import type { ReactElement } from "react";

/** The retired React face's props (the SDK cut `WidgetComponentProps` at DK-2); this
 * fixture's face is the old runner's subject — DK-7 replaces both. */
interface WidgetComponentProps {
  readonly entity: Entity;
  readonly world: World;
}

const TYPE = "vibefield.fixture-invalid.card";

function StrictCard({ entity, world }: WidgetComponentProps): ReactElement {
  const props = useWidgetProps<{ count: number; label: string }>(world, entity, TYPE);
  return (
    <div className="fixture-card">
      {props?.label ?? ""}:{props?.count ?? 0}
    </div>
  );
}

export default defineRendererPlugin({
  activate(ctx) {
    ctx.widgets.register({ type: TYPE, binding: { component: StrictCard } });
  },
});
