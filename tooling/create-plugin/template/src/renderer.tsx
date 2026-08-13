import { defineRendererPlugin } from "@vibefield/plugin-sdk";
import { useWidgetProps, type WidgetComponentProps } from "@vibefield/plugin-sdk/canvas";
import { CardShell } from "@vibefield/plugin-sdk/ui";
import type { ReactElement } from "react";
import "./renderer.css";

// The renderer MODULE (spec §10.1) and the card it binds, in one file.
//
// Two rules this file obeys, and they are the two that catch people first:
//  - top-level code stays PURE. The host imports this module before it decides
//    whether to activate it, so registration, I/O and timers all start in
//    `activate` — never here.
//  - the SDK is the only door (wall R10). `@vibefield/plugin-sdk` (plus `/ui`
//    and `/canvas`), `@vibefield/contracts` types, and `react`. Importing
//    `@vibecook/ice` or a host package directly is refused by
//    `pnpm plugin check` with `wall-violation`, even though the canvas hooks
//    below ultimately come from ICE — reaching them THROUGH the SDK is the
//    whole point of the door.

const TYPE = "{{widgetType}}";

interface {{className}}Props extends Record<string, unknown> {
  text: string;
}

function {{className}}({ entity, world }: WidgetComponentProps): ReactElement {
  // The canvas read hook takes the world, the entity and the widget TYPE — the
  // component is mounted by the host, so all three arrive as props rather than
  // from an ambient context. Props are undefined for one frame while the widget
  // is being spawned, which is what the `??` below is for.
  const props = useWidgetProps<{{className}}Props>(world, entity, TYPE);
  const text = props?.text ?? "";

  return (
    <CardShell world={world} entity={entity}>
      <div className="vf-scaffold-card">
        {text.length > 0 ? (
          text
        ) : (
          <span className="vf-scaffold-card__empty">
            Empty — set this card's text prop, or edit src/renderer.tsx
          </span>
        )}
      </div>
    </CardShell>
  );
}

export default defineRendererPlugin({
  activate(ctx) {
    // ctx.logger, never console: the host stamps provenance on plugin logs, and
    // a bare console.* bypasses the sink that carries it.
    ctx.logger.info("{{title}} activated");
    ctx.widgets.register({ type: TYPE, binding: { component: {{className}} } });
  },
});
