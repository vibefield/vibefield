import { defineRendererPlugin } from "@vibefield/plugin-sdk";
import { createElement } from "react";
import { ArtifactPanel } from "./ArtifactPanel";
import { createBrowserPageWidget } from "./BrowserPageWidget";
import { ARTIFACT_SURFACE, BROWSER_PAGE_TYPE } from "./manifest";

export default defineRendererPlugin({
  activate(ctx) {
    ctx.logger.info("Renderer plugin activated");
    ctx.surfaces?.register(ARTIFACT_SURFACE, (props) =>
      createElement(ArtifactPanel, { client: ctx.client, surface: props }),
    );
    // The widget component is built ONCE, here, closing over the pool — the
    // only way a card gets one, since `ctx` reaches activation and the canvas
    // reaches the component. Building it per render would change the component
    // identity and remount every card (and with it the canvas that holds the
    // last painted frame).
    ctx.widgets.register({
      type: BROWSER_PAGE_TYPE,
      binding: { component: createBrowserPageWidget(ctx.pool) },
    });
  },
});
