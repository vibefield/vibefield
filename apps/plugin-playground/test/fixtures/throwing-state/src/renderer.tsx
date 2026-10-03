// CONTROL FIXTURE — a widget that renders for one state and throws for another.
//
// The point is the CONTRAST: if this plugin's `boom` row did not go red, a green
// table would mean nothing, because a runner that mounts nothing also reports no
// failures. The two rows are rendered by the same component through the same
// path, so the only difference between them is the state's props.

import { defineRendererPlugin } from "@vibefield/plugin-sdk";
import { type Entity, useWidgetProps, type World } from "@vibefield/plugin-sdk/canvas";
import type { ReactElement } from "react";

/** The retired React face's props (the SDK cut `WidgetComponentProps` at DK-2); this
 * fixture's face is the old runner's subject — DK-7 replaces both. */
interface WidgetComponentProps {
  readonly entity: Entity;
  readonly world: World;
}

const TYPE = "vibefield.fixture-throwing.card";

function ThrowingCard({ entity, world }: WidgetComponentProps): ReactElement {
  const props = useWidgetProps<{ mode: string }>(world, entity, TYPE);
  if (props?.mode === "boom") throw new Error("fixture: this state throws on purpose");
  return <div className="fixture-card">calm</div>;
}

export default defineRendererPlugin({
  activate(ctx) {
    ctx.widgets.register({ type: TYPE, binding: { component: ThrowingCard } });
  },
});
