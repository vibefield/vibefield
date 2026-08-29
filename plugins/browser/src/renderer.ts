import { defineRendererPlugin } from "@vibefield/plugin-sdk";
import { createElement } from "react";
import { ArtifactPanel } from "./ArtifactPanel";
import { BrowserPagePreviewTile } from "./BrowserPagePreviewTile";
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
      // `preview` is DELIBERATE, not decoration: with it absent the tray
      // sandbox-mounts the REAL card with default props, and the real card's
      // mount acquires a live browser runtime — a hidden producer behind a
      // closed tray (found live by the DT-3e validation smoke). The preview
      // is a picture of a page; only a spawned card ever costs a surface.
      binding: {
        component: createBrowserPageWidget(ctx.pool),
        preview: { component: BrowserPagePreviewTile },
      },
    });
  },
});
