// CONTROL FIXTURE — a widget that renders for one state and throws for another.
//
// The point is the CONTRAST: if this plugin's `boom` row did not go red, a green
// table would mean nothing, because a runner that mounts nothing also reports no
// failures. The two rows are rendered by the same component through the same
// path, so the only difference between them is the state's props.

import { defineRendererPlugin } from "@vibefield/plugin-sdk";
import { useWidgetProps, type WidgetComponentProps } from "@vibefield/plugin-sdk/canvas";
import type { ReactElement } from "react";

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
